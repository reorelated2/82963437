import { parseBudget } from "./money.js";
import type { ConversationStage, ExtractedLead, FieldStatus, PropertyUse } from "./types.js";

const AREAS = [
  "North Miami Beach",
  "Sunny Isles Beach",
  "Hallandale Beach",
  "Pembroke Pines",
  "Pompano Beach",
  "Deerfield Beach",
  "Bay Harbor Islands",
  "Miami Gardens",
  "Miami Shores",
  "Miami Lakes",
  "Miami Beach",
  "Coral Springs",
  "Coral Gables",
  "Coconut Grove",
  "Fort Lauderdale",
  "Downtown Miami",
  "Key Biscayne",
  "Palmetto Bay",
  "Cooper City",
  "North Miami",
  "Sunny Isles",
  "Bal Harbour",
  "Plantation",
  "Lighthouse Point",
  "Wilton Manors",
  "Oakland Park",
  "Cutler Bay",
  "Lauderhill",
  "Southwest Ranches",
  "Pinecrest",
  "Brickell",
  "Surfside",
  "Aventura",
  "Hollywood",
  "Hallandale",
  "Homestead",
  "Florida City",
  "Miramar",
  "Hialeah",
  "Kendall",
  "Weston",
  "Sunrise",
  "Davie",
  "Doral",
];

const LABEL_MAP: Record<string, keyof ExtractedLead> = {
  name: "name",
  buyer: "name",
  client: "name",
  contact: "name",
  phone: "phone",
  mobile: "phone",
  cell: "phone",
  email: "email",
  "e-mail": "email",
  source: "leadSource",
  "lead source": "leadSource",
  agent: "assignedAgent",
  "assigned agent": "assignedAgent",
  address: "address",
  property: "address",
  "property address": "address",
  mls: "mls",
  "mls number": "mls",
  "requested showing": "requestedShowing",
  "showing requested": "requestedShowing",
  "requested time": "requestedShowing",
  "showing time": "requestedShowing",
  showing: "requestedShowing",
  available: "availableShowing",
  "available time": "availableShowing",
  "confirmed showing": "confirmedShowing",
  "confirmed time": "confirmedShowing",
  area: "areas",
  areas: "areas",
  "preferred areas": "areas",
  neighborhoods: "areas",
  budget: "budgetLabel",
  price: "budgetLabel",
  "price range": "budgetLabel",
  use: "propertyUse",
  "property use": "propertyUse",
  occupancy: "propertyUse",
  financing: "financing",
  "financing status": "financing",
  timeline: "timeline",
  "purchase timeline": "timeline",
  motivation: "motivation",
  "must haves": "mustHaves",
  "must-haves": "mustHaves",
  needs: "mustHaves",
  "deal breakers": "dealBreakers",
  dealbreakers: "dealBreakers",
  "previous communication": "previousCommunication",
  previous: "previousCommunication",
  "next action": "nextAction",
  next: "nextAction",
};

const TRACKED = [
  "name",
  "phone",
  "email",
  "leadSource",
  "assignedAgent",
  "address",
  "mls",
  "requestedShowing",
  "availableShowing",
  "confirmedShowing",
  "areas",
  "budget",
  "propertyUse",
  "financing",
  "timeline",
  "motivation",
  "mustHaves",
  "dealBreakers",
  "previousCommunication",
  "nextAction",
] as const;

export function extractLead(raw: string, options?: { lowConfidence?: boolean }): ExtractedLead {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const lead = blankLead();
  const labeledLines: string[] = [];
  const freeLines: string[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([^:]{2,40}):\s*(.*)$/);
    const key = match ? normalizeLabel(match[1]) : "";
    const field = key ? LABEL_MAP[key] : undefined;
    if (match && field) {
      labeledLines.push(line);
      applyLabeled(lead, field, match[2].trim(), key);
    } else if (line.trim()) {
      freeLines.push(line.trim());
    }
  }

  const free = freeLines.join("\n");
  applyFreeform(lead, free);
  lead.conversation = detectConversation(text);
  if (options?.lowConfidence) {
    lead.lowConfidence = true;
    lead.unclearNotes.push("Screenshot text is unclear. Do not treat it as confirmed.");
  }
  fillMissing(lead);
  return lead;
}

export function eventHashSource(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function blankLead(): ExtractedLead {
  return {
    name: null,
    phone: null,
    email: null,
    leadSource: null,
    assignedAgent: null,
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
    previousCommunication: null,
    nextAction: null,
    conversation: "new",
    fieldStatus: {},
    unclearNotes: [],
    inlineConflicts: [],
    lowConfidence: false,
  };
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/#/g, "").replace(/\s+/g, " ").trim();
}

function unclearValue(value: string): boolean {
  return /\?\?\?|\[(?:unclear|illegible)\]|\billegible\b/i.test(value);
}

function applyLabeled(lead: ExtractedLead, field: keyof ExtractedLead, value: string, label: string): void {
  if (!value || /^(n\/a|na|unknown|tbd|none|-)$/i.test(value)) return;
  if (unclearValue(value)) {
    lead.fieldStatus[statusKey(field)] = "unclear";
    lead.unclearNotes.push(`${label} could not be read.`);
    return;
  }
  if (field === "name") return setString(lead, "name", cleanName(value));
  if (field === "phone") return setString(lead, "phone", parsePhone(value));
  if (field === "email") return setString(lead, "email", parseEmail(value));
  if (field === "budgetLabel") return applyBudget(lead, value);
  if (field === "propertyUse") return applyUse(lead, value);
  if (field === "financing") return applyFinancing(lead, value);
  if (field === "confirmedShowing") {
    if (/^(no|not confirmed|unconfirmed)$/i.test(value)) return;
    return setString(lead, "confirmedShowing", cleanTime(value));
  }
  if (field === "requestedShowing" || field === "availableShowing") {
    return setString(lead, field, cleanTime(value));
  }
  if (field === "mls") return setString(lead, "mls", value.replace(/^#/, "").trim());
  if (typeof lead[field] === "string" || lead[field] === null) {
    setString(lead, field as "address", value);
  }
}

function applyFreeform(lead: ExtractedLead, text: string): void {
  if (!text) return;
  if (!lead.email) {
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email) setString(lead, "email", email[0].toLowerCase());
  }
  if (!lead.phone) {
    const phone = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
    if (phone) setString(lead, "phone", parsePhone(phone[0]));
  }
  if (!lead.name) {
    const speaker = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}):\s/m);
    if (speaker) setString(lead, "name", cleanName(speaker[1]));
  }
  if (!lead.budgetLabel) applyFreeBudget(lead, text);
  if (!lead.areas) {
    const found = AREAS.filter((area) => new RegExp(`\\b${escapeRegExp(area)}\\b`, "i").test(text));
    if (found.length) setString(lead, "areas", unique(found).join(", "));
  }
  if (!lead.leadSource && /\b(redfin lead|from redfin|source redfin)\b/i.test(text)) {
    setString(lead, "leadSource", "Redfin");
  }
  if (!lead.fieldStatus.propertyUse) applyUse(lead, text);
  if (!lead.fieldStatus.financing) applyFinancing(lead, text);
  if (!lead.timeline) {
    const timeline = text.match(/\b(ASAP|within\s+\d+\s+days|\d+\s*-\s*\d+\s+days|lease ends[^.\n]{0,40})/i);
    if (timeline) setString(lead, "timeline", timeline[0].replace(/\s+/g, " ").trim());
  }
  if (!lead.motivation && /\b(relocat\w*|downsiz\w*|lease ends[^.\n]{0,40})\b/i.test(text)) {
    const motivation = text.match(/\b(relocat\w*|downsiz\w*|lease ends[^.\n]{0,40})\b/i);
    if (motivation) setString(lead, "motivation", motivation[0]);
  }
  applyShowingSentences(lead, text);
}

function applyShowingSentences(lead: ExtractedLead, text: string): void {
  const sentences = text.split(/\n|(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (!/showing|tour|walkthrough|see it/i.test(sentence)) continue;
    const time = extractTime(sentence);
    if (!time) continue;
    const negated = /not confirmed|unconfirmed|if (?:i|you) can (?:get it )?confirm|once it is confirmed|once it's confirmed/i.test(sentence);
    const confirmed = /confirmed|locked in|see you at|we(?:'re| are) set/i.test(sentence) && !negated;
    if (confirmed && !lead.confirmedShowing) setString(lead, "confirmedShowing", time);
    else if (/i can do|works for me|i(?:'m| am) available|available/i.test(sentence) && !lead.availableShowing) {
      setString(lead, "availableShowing", time);
    } else if (!lead.requestedShowing && !confirmed) setString(lead, "requestedShowing", time);
  }
}

function applyFreeBudget(lead: ExtractedLead, text: string): void {
  const matches = text.match(/\$\s?\d[\d,]*(?:\.\d+)?\s*[kKmM]?|\b\d+(?:\.\d+)?\s*[kKmM]\b/g) ?? [];
  for (const raw of matches) {
    const parsed = parseBudget(raw);
    if (!parsed) continue;
    const dollars = parsed.cents / 100;
    const hasUnit = /[kKmM]/.test(raw);
    if (dollars >= 50_000 || hasUnit) {
      lead.budgetLabel = parsed.label;
      lead.budgetCents = parsed.cents;
      lead.fieldStatus.budget = "stated";
      return;
    }
  }
}

function applyBudget(lead: ExtractedLead, value: string): void {
  const parsed = parseBudget(value);
  if (!parsed) {
    lead.fieldStatus.budget = "unclear";
    lead.unclearNotes.push("A budget was mentioned, but the amount was not clear.");
    return;
  }
  lead.budgetLabel = parsed.label;
  lead.budgetCents = parsed.cents;
  lead.fieldStatus.budget = "stated";
}

function applyUse(lead: ExtractedLead, value: string): void {
  const uses = classifyUses(value);
  if (uses.length > 1) {
    lead.propertyUse = null;
    lead.fieldStatus.propertyUse = "conflict";
    lead.inlineConflicts.push({ field: "propertyUse", values: uses });
    lead.unclearNotes.push("Primary residence, second home, and investment were not a single clear choice.");
    return;
  }
  if (uses.length === 1) {
    lead.propertyUse = uses[0];
    lead.fieldStatus.propertyUse = "stated";
  }
}

function applyFinancing(lead: ExtractedLead, value: string): void {
  const status = classifyFinancing(value);
  if (status) {
    lead.financing = status;
    lead.fieldStatus.financing = "stated";
    return;
  }
  if (/\b(financ\w*|mortgage|lender|loan)\b/i.test(value) && !lead.financing) {
    lead.financingMentionedWithoutApproval = true;
    lead.unclearNotes.push("Financing was mentioned. Approval was not stated.");
  }
}

function classifyFinancing(value: string): string | null {
  const text = value.toLowerCase();
  if (/not pre-?approved|need(?:s)? (?:a )?lender|no lender/.test(text)) return "Need lender";
  if (/pre-?approved|preapproved/.test(text)) return "Pre-approved";
  if (/pre-?qualified|prequalified/.test(text)) return "Pre-qualified";
  if (/\bcash\b/.test(text)) return "Cash";
  return null;
}

function classifyUses(value: string): PropertyUse[] {
  const text = value.toLowerCase();
  const uses: PropertyUse[] = [];
  if (/\binvest\w*\b|\brental\b|\btenant\b/.test(text) && !/\bnot an investment\b/.test(text)) uses.push("investment");
  if (/\bsecond home\b|\bvacation home\b/.test(text)) uses.push("second");
  if (/\bprimary residence\b|\bowner occupy\b|\blive in\b/.test(text) || (/\bresidence\b/.test(text) && !/\bsecond\b/.test(text))) {
    uses.push("primary");
  }
  return unique(uses);
}

function detectConversation(text: string): ConversationStage {
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z][A-Za-z'’ .-]{1,40}):\s+\S/);
    if (!match) continue;
    const label = normalizeLabel(match[1]);
    if (LABEL_MAP[label]) continue;
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(match[1].trim())) return "continuing";
  }
  if (/\b(still interested|following up|as we discussed|you asked)\b/i.test(text)) return "continuing";
  return "new";
}

function fillMissing(lead: ExtractedLead): void {
  for (const field of TRACKED) {
    if (lead.fieldStatus[field]) continue;
    const present = field === "budget" ? Boolean(lead.budgetLabel) : Boolean(valueFor(lead, field));
    lead.fieldStatus[field] = present ? "stated" : "data_needed";
  }
}

function valueFor(lead: ExtractedLead, field: string): string | null {
  const map: Record<string, string | null> = {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    leadSource: lead.leadSource,
    assignedAgent: lead.assignedAgent,
    address: lead.address,
    mls: lead.mls,
    requestedShowing: lead.requestedShowing,
    availableShowing: lead.availableShowing,
    confirmedShowing: lead.confirmedShowing,
    areas: lead.areas,
    budget: lead.budgetLabel,
    propertyUse: lead.propertyUse,
    financing: lead.financing,
    timeline: lead.timeline,
    motivation: lead.motivation,
    mustHaves: lead.mustHaves,
    dealBreakers: lead.dealBreakers,
    previousCommunication: lead.previousCommunication,
    nextAction: lead.nextAction,
  };
  return map[field] ?? null;
}

function statusKey(field: keyof ExtractedLead): string {
  if (field === "budgetLabel") return "budget";
  return String(field);
}

function setString<K extends "name" | "phone" | "email" | "leadSource" | "assignedAgent" | "address" | "mls" | "requestedShowing" | "availableShowing" | "confirmedShowing" | "areas" | "timeline" | "motivation" | "mustHaves" | "dealBreakers" | "previousCommunication" | "nextAction">(
  lead: ExtractedLead,
  field: K,
  value: string | null,
): void {
  if (!value) {
    lead.fieldStatus[statusKey(field)] = "unclear";
    lead.unclearNotes.push(`${field} was present but not clear.`);
    return;
  }
  lead[field] = value;
  lead.fieldStatus[statusKey(field)] = "stated";
}

function cleanName(value: string): string | null {
  const cleaned = value.trim().replace(/\s+/g, " ").replace(/[.,]$/, "");
  if (!/^[A-Za-z][A-Za-z'’. -]{1,60}$/.test(cleaned)) return null;
  if (/\b(ignore|instruction|instructions|system|prompt|previous)\b/i.test(cleaned)) return null;
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return null;
  const stop = new Set(["ignore", "redfin", "new", "lead", "showing", "budget", "the", "hey"]);
  if (parts.some((part) => stop.has(part.toLowerCase()))) return null;
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function parsePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return null;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function phoneKey(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? local : null;
}

function parseEmail(value: string): string | null {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractTime(sentence: string): string | null {
  const match = sentence.match(
    /\b((?:today|tomorrow|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\s+at)?\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(today|tomorrow|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)))?/i,
  );
  if (!match) return null;
  return match[0].replace(/\s+/g, " ").trim();
}

function cleanTime(value: string): string | null {
  const cleaned = value.replace(/\s+/g, " ").replace(/[.]+$/, "").trim();
  if (!cleaned || /^(no|not confirmed|unconfirmed)$/i.test(cleaned)) return null;
  return cleaned;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function fieldStatusOf(lead: ExtractedLead, field: string): FieldStatus {
  return lead.fieldStatus[field] ?? "data_needed";
}
