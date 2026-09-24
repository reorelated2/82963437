import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataFile, openDatabase, Store, type ContactRow } from "./db.js";
import { eventHashSource, extractLead, phoneKey } from "./extract.js";
import { integrationMatrix } from "./integrations.js";
import { readScreenshot } from "./ocr.js";
import { etClock, etParts, formatEt, sameEtDay, suggestFollowUp } from "./time.js";
import type { AttentionItem, ExtractedLead, IntakeResult, Settings, Workspace } from "./types.js";
import { buyerSummary, crmNote, draftClientMessage, internalNote, summaryLine } from "./voice.js";

const NATE_DEMO = `Name: Nate Alvarez
Phone: (305) 555-0148
Source: Redfin
Agent: Kyle Kleinman
Area: North Miami
Property: North Miami property
Requested showing: 5:30
Budget: $650,000
Use: primary residence
Timeline: 30-60 days
Motivation: lease ends in May
Must haves: garage, impact windows
Deal breakers: HOA under $400 a month
`;

export interface Desk {
  intakeText(input: { text: string; isDemo?: boolean; now?: Date }): IntakeResult;
  intakeScreenshot(input: {
    filename: string;
    bytes: Buffer;
    ocrText?: string;
    ocrConfidence?: number;
    ocrError?: string;
    isDemo?: boolean;
    now?: Date;
  }): Promise<IntakeResult>;
  workspace(now?: Date): Workspace;
  contact(id: string): ReturnType<Desk["presentContact"]>;
  presentContact(id: string): {
    contact: {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      financingStatus: string | null;
      budgetLabel: string | null;
      demo: boolean;
      stage: string;
      areas: string | null;
      leadSource: string | null;
      language: string | null;
      suppressed: boolean;
      householdId: string | null;
      priorityReason: string | null;
    };
    attributions: { source: string; at: string; original: boolean }[];
    messages: { id: string; body: string; status: string; sentAt: string | null; contactId: string; recipient: string | null; purpose: string; context: string; scheduledFor: string | null; channel: string }[];
    notes: { id: string; body: string; contactId: string }[];
    tasks: { id: string; title: string; detail: string | null; dueAt: string | null; status: string; kind: string }[];
    showings: { requestedTime: string | null; availableTime: string | null; confirmedTime: string | null; status: string }[];
    facts: { field: string; value: string | null; status: string; origin: string }[];
    conflicts: { field: string; value: string | null; status: string }[];
    activity: { eventType: string; payload: string; createdAt: string }[];
  } | null;
  search(q: string): { id: string; name: string; phone: string | null; demo: boolean; stage: string }[];
  acceptReview(id: string): void;
  dismissReview(id: string): void;
  approveDraft(id: string): { sent: false; status: string };
  completeTask(id: string): void;
  setStage(id: string, stage: string): void;
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): Settings;
  queueOutbound(messageId: string): { sent: false; job: { id: string; status: string; lastError: string | null } };
  recordSpend(amountUsd: number): { allowed: boolean; message: string };
  backup(): { file: string };
  restore(file: string): void;
  exportAll(): unknown;
  retryJob(id: string): { id: string; status: string; lastError: string | null };
  seedDemo(now?: Date): { created: boolean };
  removeDemo(): void;
  counts(): { contacts: number; messages: number; tasks: number };
  jobs(): { id: string; type: string; status: string; lastError: string | null }[];
  integrations(): ReturnType<typeof integrationMatrix>;
  close(): void;
}

export function openDesk(dbPath = dataFile()): Desk {
  const box = { db: openDatabase(dbPath), file: dbPath };
  const store = new Store(box);

  function nowIso(now = new Date()): string {
    return now.toISOString();
  }

  function settings(): Settings {
    return {
      outboundPaused: store.setting("outbound_paused", "true") !== "false",
      spendingLimitUsd: Number(store.setting("spending_limit_usd", "0")),
      spendMonthUsd: Number(store.setting("spend_month_usd", "0")),
    };
  }

  function rebuild(sourceId: string, contactId: string): IntakeResult {
    const file = store.contactFile(contactId);
    const review = file?.reviews.find((item) => item.source_id === sourceId);
    const message = file?.messages.find((item) => item.idempotency_key === `msg:${sourceId}`);
    const note = file?.notes.find((item) => item.idempotency_key === `note:${sourceId}`);
    const task = file?.tasks.find((item) => item.idempotency_key === `task:${sourceId}`);
    const showing = file?.showings[0];
    return {
      duplicateEvent: true,
      contactId,
      reviewId: String(review?.id ?? ""),
      createdContact: false,
      possibleDuplicateOf: null,
      conflicts: [],
      unclear: false,
      failure: null,
      summary: String(review?.summary ?? "This exact lead was already added. No second contact, note, or follow up was created."),
      internalNote: "Duplicate import ignored.",
      buyerSummary: { known: [], needed: [] },
      draft: message
        ? {
            id: String(message.id),
            body: String(message.body),
            channel: "text",
            recipient: String(message.recipient ?? "Phone number needed"),
            scheduledFor: (message.scheduled_for as string | null) ?? null,
            purpose: String(message.purpose ?? ""),
            context: String(message.context ?? ""),
          }
        : null,
      note: note ? { id: String(note.id), body: String(note.body) } : null,
      followUp: task
        ? {
            id: String(task.id),
            title: String(task.title),
            dueAt: String(task.due_at ?? ""),
            detail: String(task.detail ?? ""),
          }
        : null,
      showing: {
        requested: (showing?.requested_time as string | null) ?? null,
        available: (showing?.available_time as string | null) ?? null,
        confirmed: (showing?.confirmed_time as string | null) ?? null,
      },
    };
  }

  function commit(input: {
    hash: string;
    kind: "paste" | "screenshot";
    rawText: string;
    filePath: string | null;
    ocrConfidence: number | null;
    lead: ExtractedLead;
    isDemo: boolean;
    now: Date;
    failure: string | null;
  }): IntakeResult {
    const existing = store.sourceByHash(input.hash);
    if (existing?.contact_id) return rebuild(existing.id, existing.contact_id);

    return store.transaction(() => {
      const again = store.sourceByHash(input.hash);
      if (again?.contact_id) return rebuild(again.id, again.contact_id);

      const createdAt = nowIso(input.now);
      const sourceId = randomUUID();
      const unclear = input.lead.lowConfidence || Boolean(input.failure);
      const lead = input.lead;
      const phone = !unclear ? phoneKey(lead.phone) : null;
      const email = !unclear && lead.email ? lead.email.toLowerCase() : null;
      let contact = phone ? store.contactByIdentifier("phone", phone) : undefined;
      const emailMatch = !contact && email ? store.contactByIdentifier("email", email) : undefined;
      if (!contact && emailMatch) contact = emailMatch;
      let createdContact = false;
      let possibleDuplicateOf: { id: string; name: string } | null = null;

      if (!contact && lead.name && !unclear) {
        const sameName = store.contactsByName(lead.name).filter((row) => row.display_name.toLowerCase() === lead.name?.toLowerCase());
        if (sameName.length) {
          possibleDuplicateOf = { id: sameName[0].id, name: sameName[0].display_name };
        }
      }

      const conflicts: { field: string; existing: string; incoming: string }[] = [];
      if (!contact) {
        createdContact = true;
        const id = randomUUID();
        const row = contactFromLead(id, lead, input.isDemo, createdAt, unclear);
        store.insertContact(row);
        contact = row;
      } else if (!unclear) {
        const patch = mergeLead(contact, lead, conflicts);
        if (Object.keys(patch).length) store.updateContact(contact.id, patch, createdAt);
        contact = store.contact(contact.id) ?? contact;
      }

      if (phone) {
        try {
          store.insertIdentifier(randomUUID(), contact.id, "phone", phone);
        } catch {
          // Already stored for this contact, or it belongs to the matched contact.
        }
      }
      if (email) {
        try {
          store.insertIdentifier(randomUUID(), contact.id, "email", email);
        } catch {
          // Same as phone.
        }
      }
      if (!unclear && lead.leadSource) store.rememberSource(randomUUID(), contact.id, lead.leadSource, createdAt);
      if (!unclear && lead.language) store.setLanguageIfEmpty(contact.id, lead.language);
      if (!unclear && lead.householdName) {
        const existingHousehold = store.householdByName(lead.householdName);
        const householdId = existingHousehold?.id ?? randomUUID();
        if (!existingHousehold) store.insertHousehold(householdId, lead.householdName, createdAt);
        store.linkHousehold(contact.id, householdId);
      }
      if (!unclear && lead.optOut) store.suppress(contact.id, "They asked not to be contacted.");
      contact = store.contact(contact.id) ?? contact;
      if (!createdContact && !unclear) {
        store.completeOpenFollowUps(contact.id);
        store.cancelOpenDrafts(contact.id);
      }

      store.insertSource({
        id: sourceId,
        contactId: contact.id,
        kind: input.kind,
        rawText: input.rawText,
        filePath: input.filePath,
        contentHash: input.hash,
        ocrConfidence: input.ocrConfidence,
        unclear: unclear ? 1 : 0,
        createdAt,
      });

      for (const fact of factRows(lead, unclear)) {
        store.insertFact(randomUUID(), contact.id, fact.field, fact.value, fact.status, sourceId, createdAt, fact.origin);
      }
      for (const conflict of conflicts) {
        store.insertFact(randomUUID(), contact.id, conflict.field, `${conflict.existing} | incoming: ${conflict.incoming}`, "conflict", sourceId, createdAt);
      }
      for (const conflict of lead.inlineConflicts) {
        store.insertFact(randomUUID(), contact.id, conflict.field, conflict.values.join(" | "), "conflict", sourceId, createdAt);
        conflicts.push({ field: conflict.field, existing: conflict.values[0] ?? "", incoming: conflict.values[1] ?? "" });
      }

      if (lead.address || lead.mls || lead.areas) {
        store.insertProperty(randomUUID(), contact.id, unclear ? null : lead.address, unclear ? null : lead.mls, unclear ? null : lead.areas, createdAt);
      }
      if (!unclear && (lead.requestedShowing || lead.availableShowing || lead.confirmedShowing)) {
        store.insertShowing({
          id: randomUUID(),
          contactId: contact.id,
          requested: lead.requestedShowing,
          available: lead.availableShowing,
          confirmed: lead.confirmedShowing,
          status: lead.confirmedShowing ? "confirmed" : lead.requestedShowing ? "requested" : "available",
          createdAt,
        });
      }

      const follow = suggestFollowUp(input.now, Boolean(lead.requestedShowing || lead.availableShowing) && !lead.confirmedShowing);
      const blocked = unclear || lead.optOut || contact.suppressed === 1;
      const draft = blocked ? null : draftClientMessage(lead);
      const noteBody = unclear
        ? `${input.failure ?? "Screenshot text is unclear. Nothing below is confirmed."}\n\nUnclear reading:\n${input.rawText.slice(0, 2000)}`
        : crmNote(lead, follow.label, input.isDemo || contact.is_demo === 1);
      const summary = input.failure ?? summaryLine(lead);
      const noteId = ensureNote(store, contact.id, sourceId, noteBody, createdAt);
      const messageId = draft
        ? ensureMessage(store, {
            contactId: contact.id,
            sourceId,
            recipient: lead.phone ?? "Phone number needed",
            body: draft.body,
            purpose: draft.purpose,
            context: `${summary} ${follow.label}`,
            scheduledFor: follow.dueAt,
            createdAt,
          })
        : null;
      const taskTitle = lead.optOut || contact.suppressed === 1
        ? "Do not message. They opted out."
        : unclear
          ? "Reread this screenshot before texting"
          : lead.conversation === "continuing"
            ? `Reply to ${contact.display_name}`
            : `Follow up with ${contact.display_name}`;
      const taskId = ensureTask(store, {
        contactId: contact.id,
        sourceId,
        title: taskTitle,
        detail: lead.optOut || contact.suppressed === 1 ? "Permission withdrawn. No draft was created." : `${follow.label} Nothing is sent automatically.`,
        dueAt: unclear || lead.optOut || contact.suppressed === 1 ? null : follow.dueAt,
        kind: lead.optOut || contact.suppressed === 1 ? "suppression" : unclear ? "review" : lead.conversation === "continuing" ? "reply" : "follow_up",
        createdAt,
      });
      const reviewId = randomUUID();
      const matchReason = possibleDuplicateOf
        ? `Possible duplicate of ${possibleDuplicateOf.name}. Not merged, because the phone and email did not match.`
        : conflicts.length
          ? "Some new facts conflict with the record. Nothing was overwritten."
          : createdContact
            ? "New record, waiting for your review."
            : "Matched an existing contact by phone or email.";
      store.insertReview({
        id: reviewId,
        contactId: contact.id,
        sourceId,
        summary: possibleDuplicateOf ? `${summary} ${matchReason}` : conflicts.length ? `${summary} Conflicting facts were kept for review.` : summary,
        messageId,
        noteId,
        taskId,
        matchReason,
        createdAt,
      });
      const shortNote = internalNote(lead, follow.label);
      store.insertActivity(randomUUID(), contact.id, "intake", { sourceId, unclear, createdContact, conflicts, internalNote: shortNote }, createdAt);
      const jobKey = `job:intake:${input.hash}`;
      if (!store.jobByKey(jobKey)) {
        store.insertJob({
          id: randomUUID(),
          type: "intake",
          status: unclear ? "failed" : "succeeded",
          lastError: unclear ? input.failure ?? "Screenshot text is unclear." : null,
          payload: { sourceId, contactId: contact.id },
          key: jobKey,
          demo: input.isDemo ? 1 : 0,
          createdAt,
        });
      }

      const saved = store.contactFile(contact.id);
      const showing = saved?.showings[0];
      return {
        duplicateEvent: false,
        contactId: contact.id,
        reviewId,
        createdContact,
        possibleDuplicateOf,
        conflicts,
        unclear,
        failure: input.failure,
        summary: possibleDuplicateOf ? `${summary} ${matchReason}` : summary,
        internalNote: shortNote,
        buyerSummary: buyerSummary(unclear ? blankPublicLead(lead) : lead),
        draft: draft && messageId
          ? {
              id: messageId,
              body: draft.body,
              channel: "text",
              recipient: lead.phone ?? "Phone number needed",
              scheduledFor: follow.dueAt,
              purpose: draft.purpose,
              context: `${summary} Facts used for this draft are on the contact. ${follow.label}`,
            }
          : null,
        note: { id: noteId, body: noteBody },
        followUp: {
          id: taskId,
          title: taskTitle,
          dueAt: lead.optOut || contact.suppressed === 1 ? "" : unclear ? createdAt : follow.dueAt,
          detail: `${follow.label} Nothing is sent automatically.`,
        },
        showing: {
          requested: (showing?.requested_time as string | null) ?? null,
          available: (showing?.available_time as string | null) ?? null,
          confirmed: (showing?.confirmed_time as string | null) ?? null,
        },
      };
    });
  }

  const desk: Desk = {
    intakeText({ text, isDemo = false, now = new Date() }) {
      const clean = text ?? "";
      if (!clean.trim()) {
        throw new Error("Paste the lead text or upload a screenshot.");
      }
      const lead = extractLead(clean);
      return commit({
        hash: `text:${sha(eventHashSource(clean))}`,
        kind: "paste",
        rawText: clean,
        filePath: null,
        ocrConfidence: null,
        lead,
        isDemo,
        now,
        failure: null,
      });
    },

    async intakeScreenshot({ filename, bytes, ocrText, ocrConfidence, ocrError, isDemo = false, now = new Date() }) {
      const hash = `img:${sha(bytes)}`;
      const existing = store.sourceByHash(hash);
      if (existing?.contact_id) return rebuild(existing.id, existing.contact_id);
      const sourceId = randomUUID();
      const uploads = path.join(path.dirname(box.file), "uploads");
      fs.mkdirSync(uploads, { recursive: true });
      const safe = (filename || "screenshot").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
      const filePath = path.join(uploads, `${sourceId}-${safe}`);
      fs.writeFileSync(filePath, bytes);

      let text = ocrText?.trim() ?? "";
      let confidence = ocrConfidence ?? null;
      let failure: string | null = ocrError ?? null;
      if (!text && !failure) {
        const read = await readScreenshot(filePath);
        if ("error" in read) failure = read.error;
        else {
          text = read.text;
          confidence = read.confidence;
        }
      }
      const lowConfidence = confidence !== null && confidence < 0.75;
      if (!text) {
        failure = failure ?? "No readable words were found in the screenshot.";
      } else if (lowConfidence) {
        failure = "Screenshot text is unclear. Check it before you use it.";
      }
      const lead = extractLead(text || "", { lowConfidence: lowConfidence || !text });
      if (lowConfidence || !text) lead.lowConfidence = true;
      return commit({
        hash,
        kind: "screenshot",
        rawText: text || failure || "",
        filePath,
        ocrConfidence: confidence,
        lead,
        isDemo,
        now,
        failure: lowConfidence || !text ? failure : null,
      });
    },

    workspace(now = new Date()) {
      return buildWorkspace(store, settings(), now);
    },

    contact(id) {
      return this.presentContact(id);
    },

    presentContact(id: string) {
      const file = store.contactFile(id);
      if (!file) return null;
      const contact = file.contact;
      return {
        contact: {
          id: contact.id,
          name: contact.display_name,
          phone: contact.phone,
          email: contact.email,
          financingStatus: contact.financing_status,
          budgetLabel: contact.budget_label,
          demo: contact.is_demo === 1,
          stage: contact.stage,
          areas: contact.preferred_areas,
          leadSource: contact.original_lead_source ?? contact.lead_source,
          language: contact.preferred_language,
          suppressed: contact.suppressed === 1,
          householdId: contact.household_id,
          priorityReason: movementReason(contact.timeline, file.showings[0] as { requested_time?: string | null; confirmed_time?: string | null } | undefined),
        },
        attributions: store.attributions(contact.id).map((row) => ({
          source: row.source,
          at: row.observed_at,
          original: row.is_original === 1,
        })),
        messages: file.messages.map((message) => ({
          id: String(message.id),
          body: String(message.body),
          status: String(message.status),
          sentAt: (message.sent_at as string | null) ?? null,
          contactId: String(message.contact_id),
          recipient: (message.recipient as string | null) ?? null,
          purpose: String(message.purpose ?? ""),
          context: String(message.context ?? ""),
          scheduledFor: (message.scheduled_for as string | null) ?? null,
          channel: String(message.channel ?? "text"),
        })),
        notes: file.notes.map((note) => ({
          id: String(note.id),
          body: String(note.body),
          contactId: String(note.contact_id),
        })),
        tasks: file.tasks.map((task) => ({
          id: String(task.id),
          title: String(task.title),
          detail: (task.detail as string | null) ?? null,
          dueAt: (task.due_at as string | null) ?? null,
          status: String(task.status),
          kind: String(task.kind),
        })),
        showings: file.showings.map((showing) => ({
          requestedTime: (showing.requested_time as string | null) ?? null,
          availableTime: (showing.available_time as string | null) ?? null,
          confirmedTime: (showing.confirmed_time as string | null) ?? null,
          status: String(showing.status),
        })),
        facts: file.facts.map((fact) => ({
          field: String(fact.field),
          value: (fact.value as string | null) ?? null,
          status: String(fact.status),
          origin: String(fact.origin ?? "said"),
        })),
        conflicts: file.facts
          .filter((fact) => fact.status === "conflict")
          .map((fact) => ({
            field: String(fact.field),
            value: (fact.value as string | null) ?? null,
            status: "conflict",
          })),
        activity: file.activity.map((item) => ({
          eventType: String(item.event_type),
          payload: String(item.payload),
          createdAt: String(item.created_at),
        })),
      };
    },

    search(q) {
      return store.search(q).map((row) => ({
        id: row.id,
        name: row.display_name,
        phone: row.phone,
        demo: row.is_demo === 1,
        stage: row.stage,
      }));
    },

    acceptReview(id) {
      store.setReviewStatus(id, "accepted");
    },

    dismissReview(id) {
      store.setReviewStatus(id, "dismissed");
    },

    approveDraft(id) {
      const message = store.message(id);
      if (!message) throw new Error("Draft not found.");
      store.setMessageStatus(id, "approved");
      store.insertActivity(randomUUID(), message.contact_id, "draft_approved", { messageId: id, sent: false }, nowIso());
      return { sent: false as const, status: "approved" };
    },

    completeTask(id) {
      store.completeTask(id);
    },

    setStage(id: string, stage: string) {
      const allowed = ["new", "qualifying", "consultation", "search", "showing", "offer", "under_contract", "closing", "past", "paused"];
      if (!allowed.includes(stage)) throw new Error("That stage is not on the buyer path.");
      if (!store.contact(id)) throw new Error("That client is not on this desk.");
      store.setStage(id, stage, nowIso());
      store.insertActivity(randomUUID(), id, "stage", { stage }, nowIso());
    },

    getSettings: settings,

    updateSettings(patch) {
      if (patch.outboundPaused !== undefined) store.setSetting("outbound_paused", patch.outboundPaused ? "true" : "false");
      if (patch.spendingLimitUsd !== undefined) store.setSetting("spending_limit_usd", String(patch.spendingLimitUsd));
      if (patch.spendMonthUsd !== undefined) store.setSetting("spend_month_usd", String(patch.spendMonthUsd));
      return settings();
    },

    queueOutbound(messageId) {
      const existing = store.jobByKey(`outbound:${messageId}`);
      if (existing) return { sent: false as const, job: { id: existing.id, status: existing.status, lastError: existing.last_error } };
      const message = store.message(messageId);
      if (!message) throw new Error("Draft not found.");
      const current = settings();
      const authorized = store.authorization("send_text");
      const lastError = current.outboundPaused
        ? "Outbound automations are paused. Nothing was sent."
        : authorized
          ? "A send workflow is recorded, but no channel is connected. Nothing was sent."
          : "No send workflow is authorized. Nothing was sent.";
      const createdAt = nowIso();
      const id = randomUUID();
      store.insertJob({
        id,
        type: "send_message",
        status: "failed",
        lastError,
        payload: { messageId, sent: false },
        key: `outbound:${messageId}`,
        demo: 0,
        createdAt,
      });
      store.setMessageStatus(messageId, message.status);
      return { sent: false as const, job: { id, status: "failed", lastError } };
    },

    recordSpend(amountUsd) {
      const current = settings();
      if (current.spendMonthUsd + amountUsd > current.spendingLimitUsd) {
        const createdAt = nowIso();
        store.insertJob({
          id: randomUUID(),
          type: "spend",
          status: "failed",
          lastError: `Stopped. $${amountUsd} would pass the $${current.spendingLimitUsd} limit.`,
          payload: { amountUsd },
          key: `spend:${randomUUID()}`,
          demo: 0,
          createdAt,
        });
        return { allowed: false, message: "Spending limit reached. No paid call was made." };
      }
      store.setSetting("spend_month_usd", String(current.spendMonthUsd + amountUsd));
      return { allowed: true, message: "Recorded." };
    },

    backup() {
      const dir = path.join(path.dirname(box.file), "backups");
      fs.mkdirSync(dir, { recursive: true });
      const name = `os-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
      const dest = path.join(dir, name);
      box.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      return { file: name };
    },

    restore(file) {
      const backup = path.join(path.dirname(box.file), "backups", path.basename(file));
      if (!/^os-[\w.-]+\.sqlite$/.test(path.basename(file)) || !fs.existsSync(backup)) {
        throw new Error("That backup was not found.");
      }
      box.db.close();
      fs.copyFileSync(backup, box.file);
      fs.rmSync(`${box.file}-wal`, { force: true });
      fs.rmSync(`${box.file}-shm`, { force: true });
      store.reopen(openDatabase(box.file));
    },

    exportAll() {
      return store.exportBundle();
    },

    retryJob(id) {
      const job = store.job(id);
      if (!job) throw new Error("Job not found.");
      const attempts = job.attempts + 1;
      if (attempts > job.max_attempts) {
        store.updateJob(id, "dead", job.attempts, job.last_error ?? "Retry limit reached.", nowIso());
        return { id, status: "dead", lastError: "Retry limit reached." };
      }
      const stillBlocked = job.type === "send_message" || job.type === "spend" || job.type === "intake";
      const lastError = stillBlocked ? job.last_error ?? "Still blocked." : null;
      const status = stillBlocked ? (attempts >= job.max_attempts ? "dead" : "failed") : "succeeded";
      store.updateJob(id, status, attempts, lastError, nowIso());
      return { id, status, lastError };
    },

    seedDemo(now = new Date()) {
      const before = store.demoCount();
      commit({
        hash: `text:${sha(eventHashSource(NATE_DEMO))}`,
        kind: "paste",
        rawText: NATE_DEMO,
        filePath: null,
        ocrConfidence: null,
        lead: extractLead(NATE_DEMO),
        isDemo: true,
        now,
        failure: null,
      });
      const nate = store.contactsByName("Nate Alvarez")[0];
      if (nate && !store.taskByKey("demo-appointment-nate")) {
        const parts = etParts(now);
        const starts = etClock(parts.year, parts.month, parts.day, 17, 30);
        store.insertAppointment(
          randomUUID(),
          nate.id,
          "Requested showing, not confirmed",
          starts.toISOString(),
          "requested",
          "DEMO. Nate asked about 5:30. The listing has not confirmed it.",
          nowIso(now),
        );
        store.insertTask({
          id: randomUUID(),
          contactId: nate.id,
          title: "Demo marker",
          detail: "Marks the demo appointment as already seeded.",
          dueAt: null,
          kind: "review",
          key: "demo-appointment-nate",
          createdAt: nowIso(now),
        });
      }
      if (!store.contactByIdentifier("phone", "9545550101")) {
        const createdAt = nowIso(now);
        const id = randomUUID();
        store.insertContact({
          ...contactFromLead(id, extractLead("Name: Jordan Blake\nPhone: (954) 555-0101\nArea: Hollywood\n"), true, createdAt, false),
          phone: "(954) 555-0101",
          preferred_areas: "Hollywood",
          stage: "active",
        });
        store.insertIdentifier(randomUUID(), id, "phone", "9545550101");
        store.insertTask({
          id: randomUUID(),
          contactId: id,
          title: "Reply to Jordan Blake",
          detail: "DEMO. Jordan wrote yesterday. This reply is overdue. Nothing is sent automatically.",
          dueAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          kind: "reply",
          key: "demo-jordan-reply",
          createdAt,
        });
        store.insertMessage({
          id: randomUUID(),
          contactId: id,
          recipient: "(954) 555-0101",
          body: "Still want to see Hollywood this week?",
          context: "DEMO continuing conversation. No showing is confirmed.",
          purpose: "Reply to the open conversation.",
          scheduledFor: createdAt,
          idempotencyKey: "demo-jordan-draft",
          createdAt,
        });
      }
      if (!store.jobByKey("demo-failed-connection")) {
        store.insertJob({
          id: randomUUID(),
          type: "redfin_import",
          status: "failed",
          lastError: "Redfin is not connected. No mail was imported.",
          payload: { demo: true },
          key: "demo-failed-connection",
          demo: 1,
          createdAt: nowIso(now),
        });
      }
      if (!store.milestones().some((row) => row.id === "demo-milestone")) {
        store.insertMilestone(
          "demo-milestone",
          nate?.id ?? null,
          "Inspection period",
          new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          "DEMO only. No contract is on file, so this is not a real deadline.",
          1,
          nowIso(now),
        );
      }
      return { created: store.demoCount() >= before };
    },

    removeDemo() {
      store.removeDemo();
    },

    counts() {
      return store.counts();
    },

    jobs() {
      return store.allJobs().map((job) => ({ id: job.id, type: job.type, status: job.status, lastError: job.last_error }));
    },

    integrations() {
      return integrationMatrix();
    },

    close() {
      store.close();
    },
  };

  return desk;
}

function sha(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function blankPublicLead(lead: ExtractedLead): ExtractedLead {
  return {
    ...lead,
    name: null,
    phone: null,
    email: null,
    address: null,
    mls: null,
    requestedShowing: null,
    availableShowing: null,
    confirmedShowing: null,
    areas: null,
    budgetLabel: null,
    budgetCents: null,
    propertyUse: null,
    financing: null,
    financingMentionedWithoutApproval: false,
    timeline: null,
    motivation: null,
    mustHaves: null,
    dealBreakers: null,
  };
}

function contactFromLead(id: string, lead: ExtractedLead, isDemo: boolean, createdAt: string, unclear: boolean): ContactRow {
  const name = unclear ? "Unclear screenshot" : lead.name ?? "Unnamed lead";
  return {
    id,
    display_name: name,
    first_name: unclear ? null : name.split(" ")[0] ?? null,
    phone: unclear ? null : lead.phone,
    email: unclear ? null : lead.email,
    lead_source: unclear ? null : lead.leadSource,
    assigned_agent: unclear ? null : lead.assignedAgent,
    stage: "new",
    property_use: unclear ? null : lead.propertyUse,
    financing_status: unclear ? null : lead.financing,
    budget_cents: unclear ? null : lead.budgetCents,
    budget_label: unclear ? null : lead.budgetLabel,
    timeline: unclear ? null : lead.timeline,
    motivation: unclear ? null : lead.motivation,
    must_haves: unclear ? null : lead.mustHaves,
    deal_breakers: unclear ? null : lead.dealBreakers,
    preferred_areas: unclear ? null : lead.areas,
    is_demo: isDemo ? 1 : 0,
    suppressed: !unclear && lead.optOut ? 1 : 0,
    suppression_reason: !unclear && lead.optOut ? "They asked not to be contacted." : null,
    preferred_language: unclear ? null : lead.language,
    relationship_type: "buyer",
    household_id: null,
    original_lead_source: unclear ? null : lead.leadSource,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function mergeLead(contact: ContactRow, lead: ExtractedLead, conflicts: { field: string; existing: string; incoming: string }[]): Partial<ContactRow> {
  const patch: Partial<ContactRow> = {};
  const take = (field: string, existing: string | number | null, incoming: string | number | null, column: keyof ContactRow) => {
    if (incoming === null || incoming === undefined || incoming === "") return;
    if (existing === null || existing === undefined || existing === "" || existing === "Unnamed lead" || existing === "Unclear screenshot") {
      patch[column] = incoming as never;
      return;
    }
    if (String(existing).trim().toLowerCase() !== String(incoming).trim().toLowerCase()) {
      conflicts.push({ field, existing: String(existing), incoming: String(incoming) });
    }
  };
  take("name", contact.display_name, lead.name, "display_name");
  take("phone", contact.phone, lead.phone, "phone");
  take("email", contact.email, lead.email, "email");
  take("assignedAgent", contact.assigned_agent, lead.assignedAgent, "assigned_agent");
  take("propertyUse", contact.property_use, lead.propertyUse, "property_use");
  take("financing", contact.financing_status, lead.financing, "financing_status");
  take("budget", contact.budget_label, lead.budgetLabel, "budget_label");
  if (lead.budgetCents !== null && contact.budget_cents !== null && contact.budget_cents !== lead.budgetCents) {
    if (!conflicts.some((item) => item.field === "budget")) {
      conflicts.push({ field: "budget", existing: contact.budget_label ?? String(contact.budget_cents), incoming: lead.budgetLabel ?? String(lead.budgetCents) });
    }
  } else if (lead.budgetCents !== null && contact.budget_cents === null) {
    patch.budget_cents = lead.budgetCents;
  }
  take("timeline", contact.timeline, lead.timeline, "timeline");
  take("motivation", contact.motivation, lead.motivation, "motivation");
  take("mustHaves", contact.must_haves, lead.mustHaves, "must_haves");
  take("dealBreakers", contact.deal_breakers, lead.dealBreakers, "deal_breakers");
  take("areas", contact.preferred_areas, lead.areas, "preferred_areas");
  if (lead.name && patch.display_name) patch.first_name = lead.name.split(" ")[0];
  return patch;
}

function factRows(lead: ExtractedLead, unclear: boolean): { field: string; value: string | null; status: string; origin: string }[] {
  const rows: { field: string; value: string | null; status: string; origin: string }[] = [
    { field: "name", value: lead.name, status: lead.fieldStatus.name ?? "data_needed" },
    { field: "phone", value: lead.phone, status: lead.fieldStatus.phone ?? "data_needed" },
    { field: "email", value: lead.email, status: lead.fieldStatus.email ?? "data_needed" },
    { field: "leadSource", value: lead.leadSource, status: lead.fieldStatus.leadSource ?? "data_needed" },
    { field: "assignedAgent", value: lead.assignedAgent, status: lead.fieldStatus.assignedAgent ?? "data_needed" },
    { field: "address", value: lead.address, status: lead.fieldStatus.address ?? "data_needed" },
    { field: "mls", value: lead.mls, status: lead.fieldStatus.mls ?? "data_needed" },
    { field: "requestedShowing", value: lead.requestedShowing, status: lead.fieldStatus.requestedShowing ?? "data_needed" },
    { field: "availableShowing", value: lead.availableShowing, status: lead.fieldStatus.availableShowing ?? "data_needed" },
    { field: "confirmedShowing", value: lead.confirmedShowing, status: lead.confirmedShowing ? "stated" : "data_needed" },
    { field: "areas", value: lead.areas, status: lead.fieldStatus.areas ?? "data_needed" },
    { field: "budget", value: lead.budgetLabel, status: lead.fieldStatus.budget ?? "data_needed" },
    { field: "propertyUse", value: lead.propertyUse, status: lead.fieldStatus.propertyUse ?? "data_needed" },
    { field: "financing", value: lead.financing, status: lead.fieldStatus.financing ?? "data_needed" },
    { field: "timeline", value: lead.timeline, status: lead.fieldStatus.timeline ?? "data_needed" },
    { field: "motivation", value: lead.motivation, status: lead.fieldStatus.motivation ?? "data_needed" },
    { field: "mustHaves", value: lead.mustHaves, status: lead.fieldStatus.mustHaves ?? "data_needed" },
    { field: "dealBreakers", value: lead.dealBreakers, status: lead.fieldStatus.dealBreakers ?? "data_needed", origin: "" },
  ].map((row) => ({ ...row, origin: originFor(row.status) }));
  if (!unclear) return rows;
  return rows.map((row) => {
    const status = row.value ? "unclear" : "data_needed";
    return { ...row, status, origin: originFor(status) };
  });
}

function originFor(status: string): string {
  if (status === "data_needed") return "missing";
  if (status === "unclear") return "unclear";
  if (status === "conflict") return "said";
  return "said";
}

function ensureNote(store: Store, contactId: string, sourceId: string, body: string, createdAt: string): string {
  const key = `note:${sourceId}`;
  const existing = store.noteByKey(key);
  if (existing) return existing.id;
  const id = randomUUID();
  store.insertNote(id, contactId, body, key, createdAt);
  return id;
}

function ensureMessage(
  store: Store,
  row: { contactId: string; sourceId: string; recipient: string; body: string; purpose: string; context: string; scheduledFor: string; createdAt: string },
): string {
  const key = `msg:${row.sourceId}`;
  const existing = store.messageByKey(key);
  if (existing) return existing.id;
  const id = randomUUID();
  store.insertMessage({ ...row, id, idempotencyKey: key });
  return id;
}

function ensureTask(
  store: Store,
  row: { contactId: string; sourceId: string; title: string; detail: string; dueAt: string | null; kind: string; createdAt: string },
): string {
  const key = `task:${row.sourceId}`;
  const existing = store.taskByKey(key);
  if (existing) return existing.id;
  const id = randomUUID();
  store.insertTask({ id, contactId: row.contactId, title: row.title, detail: row.detail, dueAt: row.dueAt, kind: row.kind, key, createdAt: row.createdAt });
  return id;
}

function buildWorkspace(store: Store, current: Settings, now: Date): Workspace {
  const alerts: Workspace["alerts"] = [];
  if (current.spendMonthUsd > current.spendingLimitUsd) {
    alerts.push({
      level: "bad",
      title: "Spending limit",
      detail: `Recorded spend $${current.spendMonthUsd} is above the $${current.spendingLimitUsd} limit.`,
    });
  }
  const failed = store.failedJobs().map((job) => ({
    contactId: null,
    title: job.demo ? `DEMO: ${labelJob(job.type)}` : labelJob(job.type),
    reason: job.last_error ?? "This automation failed.",
    action: "Open settings and read the failure. Nothing was sent.",
    href: "#/settings",
    demo: job.demo === 1,
    tone: "failed" as const,
  }));
  for (const job of store.failedJobs()) {
    alerts.push({ level: "bad", title: labelJob(job.type), detail: job.last_error ?? "Failed." });
  }

  const overdue = store
    .openTasks()
    .filter((task) => task.due_at && new Date(String(task.due_at)).getTime() < now.getTime() && task.kind !== "review" && task.kind !== "suppression")
    .map((task) => itemFromTask(task, "overdue", "This follow up is overdue."));
  const replies = store
    .openTasks()
    .filter((task) => task.kind === "reply" && (!task.due_at || new Date(String(task.due_at)).getTime() >= now.getTime()))
    .map((task) => itemFromTask(task, "reply", "This conversation needs a reply."));
  const leads = store
    .openReviews()
    .filter((review) => review.stage === "new")
    .map((review) => ({
      contactId: String(review.contact_id),
      title: String(review.display_name),
      reason: String(review.summary),
      action: "Open the lead, check the draft, and send it yourself if it is right.",
      href: `#/contact/${review.contact_id}`,
      demo: review.is_demo === 1,
      tone: "new" as const,
    }));
  const drafts = store.drafts().map((draft) => ({
    contactId: String(draft.contact_id),
    title: String(draft.display_name),
    reason: "Draft waiting for your review.",
    action: "Read the exact text. Approving it does not send it.",
    href: `#/contact/${draft.contact_id}`,
    demo: draft.is_demo === 1,
    tone: "draft" as const,
  }));
  const today = store
    .appointments()
    .filter((appointment) => sameEtDay(new Date(String(appointment.starts_at)), now))
    .map((appointment) => ({
      contactId: String(appointment.contact_id),
      title: String(appointment.display_name),
      reason:
        appointment.status === "confirmed"
          ? `Confirmed ${formatEt(String(appointment.starts_at))}. ${appointment.detail ?? ""}`
          : `Requested ${formatEt(String(appointment.starts_at))}. Not confirmed. ${appointment.detail ?? ""}`,
      action: "Treat a requested time as requested until the listing confirms it.",
      href: `#/contact/${appointment.contact_id}`,
      demo: appointment.is_demo === 1,
      tone: "today" as const,
    }));
  const soon = now.getTime() + 14 * 24 * 60 * 60 * 1000;
  const milestones = store
    .milestones()
    .filter((milestone) => milestone.due_at && new Date(String(milestone.due_at)).getTime() <= soon)
    .map((milestone) => ({
      contactId: milestone.contact_id ? String(milestone.contact_id) : null,
      title: String(milestone.title),
      reason: `${milestone.source_clause ?? "No source clause on file."} Due ${formatEt(String(milestone.due_at))}.`,
      action: "Do not treat this as a contract deadline unless the source is an executed document you reviewed.",
      href: milestone.contact_id ? `#/contact/${milestone.contact_id}` : "#/settings",
      demo: milestone.demo === 1 || milestone.contact_demo === 1,
      tone: "milestone" as const,
    }));

  const sections: Workspace["sections"] = [
    { id: "failed", title: "Needs attention", empty: "No failed automations.", items: failed },
    { id: "overdue", title: "Overdue follow ups", empty: "No overdue follow ups.", items: overdue },
    { id: "leads", title: "New leads", empty: "No new leads waiting.", items: leads },
    { id: "replies", title: "Needs a reply", empty: "No open replies.", items: replies },
    { id: "drafts", title: "Drafts to review", empty: "No drafts waiting.", items: drafts },
    { id: "today", title: "Today", empty: "Nothing on today's calendar.", items: today },
    { id: "milestones", title: "Upcoming milestones", empty: "No milestones in the next 14 days.", items: milestones },
  ];
  const people = store.contactsOverview();
  const showings = store.showingFlags();
  const openIds = new Set(store.openTaskContactIds());
  const likely: AttentionItem[] = [];
  for (const person of people) {
    if (person.suppressed === 1) continue;
    const showing = showings.find((row) => row.contact_id === person.id && row.requested_time && !row.confirmed_time);
    const reason = movementReason(person.timeline, showing);
    if (!reason) continue;
    likely.push({
      contactId: person.id,
      title: person.display_name,
      reason,
      action: "Open them and send the next text yourself if it is still right.",
      href: `#/contact/${person.id}`,
      demo: person.is_demo === 1,
      tone: "new",
    });
  }
  const noNext = people
    .filter((person) => person.suppressed !== 1 && !openIds.has(person.id))
    .map((person) => ({
      contactId: person.id,
      title: person.display_name,
      reason: "No open follow up is on this record.",
      action: "Choose the next step before this person goes quiet.",
      href: `#/contact/${person.id}`,
      demo: person.is_demo === 1,
      tone: "reply" as const,
    }));
  const gaps = people
    .filter((person) => person.suppressed !== 1 && !person.financing_status)
    .map((person) => ({
      contactId: person.id,
      title: person.display_name,
      reason: "Financing was not stated. Prequalification is not approval, and blank is not a no.",
      action: "Ask only when it is the useful next question. Do not treat it as approved.",
      href: `#/contact/${person.id}`,
      demo: person.is_demo === 1,
      tone: "draft" as const,
    }));
  sections.splice(3, 0, { id: "likely", title: "Most likely to move", empty: "Nobody has a stated showing request or a near timeline.", items: likely });
  sections.push({ id: "gaps", title: "Financing still unknown", empty: "Every live record has a stated financing status, or the desk is empty.", items: gaps });
  sections.push({ id: "no-next", title: "No next action", empty: "Every active person has a next step.", items: noNext });

  const heroItem = [...overdue, ...leads, ...replies, ...likely, ...drafts, ...today, ...milestones, ...noNext][0];
  const live = people.filter((person) => person.is_demo !== 1);
  const demo = people.filter((person) => person.is_demo === 1);
  const stages = ["new", "qualifying", "consultation", "search", "showing", "offer", "under_contract", "closing", "past", "paused"];
  const actions = [...overdue, ...leads, ...likely, ...noNext].slice(0, 3).map((item) => `${item.title}: ${item.action}`);
  return {
    generatedAt: now.toISOString(),
    outboundPaused: current.outboundPaused,
    demoOnDesk: store.demoCount() > 0,
    spendingLimitUsd: current.spendingLimitUsd,
    spendMonthUsd: current.spendMonthUsd,
    hero: heroItem
      ? { title: heroItem.title, why: heroItem.reason, action: heroItem.action, href: heroItem.href }
      : null,
    sections,
    alerts,
    metrics: {
      liveContacts: live.length,
      demoContacts: demo.length,
      byStage: stages
        .map((stage) => ({
          stage,
          live: live.filter((person) => person.stage === stage).length,
          demo: demo.filter((person) => person.stage === stage).length,
        }))
        .filter((row) => row.live + row.demo > 0),
      requestedShowings: showings.filter((row) => row.requested_time && !row.confirmed_time).length,
      confirmedShowings: showings.filter((row) => row.confirmed_time).length,
      heldAppointments: null,
      responseTime: null,
      income: {
        netTarget: "$250K net a year is a planning target, not a forecast.",
        grossCommission: "Data needed.",
        brokerageCompensation: "Data needed.",
        expenses: "Data needed.",
        taxes: "Data needed.",
        netIncome: "Data needed.",
      },
      weekly: {
        moved: live.length ? `${live.length} live record${live.length === 1 ? "" : "s"} on the desk. Demo records are excluded from this count.` : "No live records yet. Demo people are not counted here.",
        stuck: gaps.filter((item) => !item.demo).length
          ? `${gaps.filter((item) => !item.demo).length} live record${gaps.filter((item) => !item.demo).length === 1 ? "" : "s"} still missing a stated financing status.`
          : "No live financing gap is on file.",
        actions: actions.length ? actions : ["Paste the next real lead you are allowed to keep on this computer."],
      },
    },
  };
}

function movementReason(
  timeline: string | null,
  showing: { requested_time?: string | null; confirmed_time?: string | null } | undefined,
): string | null {
  if (showing?.requested_time && !showing.confirmed_time) {
    return `They requested ${showing.requested_time}. It is not confirmed, so this is the next conversation.`;
  }
  if (timeline && /\b(asap|this month|30)\b/i.test(timeline)) {
    return `They said the timeline is ${timeline}. That is why this is near the top.`;
  }
  return null;
}

function itemFromTask(task: Record<string, unknown>, tone: "overdue" | "reply", reason: string) {
  return {
    contactId: task.contact_id ? String(task.contact_id) : null,
    title: String(task.display_name ?? task.title),
    reason: `${reason} ${task.detail ?? ""}`.trim(),
    action: "Open the client and send the reply yourself if it is still right.",
    href: task.contact_id ? `#/contact/${task.contact_id}` : "#/",
    demo: task.is_demo === 1,
    tone,
  };
}

function labelJob(type: string): string {
  if (type === "send_message") return "Outbound send blocked";
  if (type === "redfin_import") return "Redfin import failed";
  if (type === "intake") return "Lead reading failed";
  if (type === "spend") return "Spending blocked";
  return type;
}
