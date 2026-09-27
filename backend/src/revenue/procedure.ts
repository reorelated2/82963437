import { clientCopy, formatMoney } from "../os/money.js";
import { formatEt, suggestFollowUp } from "../os/time.js";
import { blank, clean, positiveNumber, validDate } from "./facts.js";

export type Payment = "cash" | "financing";
export type Preapproval = "preapproved" | "prequalified" | "none";
export type ContactActor = "kyle" | "coordinator" | "client" | "homeowner" | "none" | "unknown";

export interface ContactEvent {
  at?: string | null;
  actor?: ContactActor | null;
  channel?: "text" | "email" | "call" | "portal" | "unknown" | null;
  summary?: string | null;
}

export interface HistoryEvent {
  at?: string | null;
  text?: string | null;
}

export interface Conflict {
  field?: string | null;
  values?: string[] | null;
}

export interface LeadPacket {
  person?: string | null;
  phone?: string | null;
  email?: string | null;
  leadSource?: string | null;
  agentGenerated?: boolean | null;
  lenderIntroduced?: boolean | null;
  property?: string | null;
  reason?: string | null;
  motivation?: string | null;
  location?: string | null;
  criteria?: string | null;
  budget?: string | null;
  payment?: Payment | "unknown" | null;
  preapproval?: Preapproval | "unknown" | null;
  timeline?: string | null;
  decisionMakers?: string | null;
  tourRequested?: string | null;
  tourConfirmed?: string | null;
  lastContact?: ContactEvent | null;
  activity?: string | null;
  motivationProven?: boolean | null;
  stage?: string | null;
  language?: "en" | "es" | null;
  conversation?: "new" | "continuing" | null;
  preferredChannel?: "text" | "email" | "call" | null;
  optOut?: boolean | null;
  likelyValueUsd?: number | null;
  valueBasis?: "verified" | "estimate" | null;
  conflicts?: Conflict[] | null;
  history?: HistoryEvent[] | null;
}

export interface ProcedureDraft {
  channel: "text" | "email" | "call";
  objective: string;
  subject: string | null;
  body: string;
  copyReady: boolean;
  sent: false;
}

export interface ProcedureResult {
  sent: false;
  stored: false;
  person: string;
  leadSource: string;
  property: string;
  reason: string;
  lastActualContact: string;
  kyleHasContacted: boolean;
  stage: string;
  stageBasis: "stated" | "derived";
  urgency: string;
  urgencyBasis: "stated" | "derived" | "not stated";
  likelyValue: string;
  likelyValueBasis: "verified" | "estimate" | "data needed";
  nextAction: string;
  draft: ProcedureDraft | null;
  agentToolsNote: string;
  followUp: { dueAt: string | null; label: string; trigger: string };
  facts: string[];
  estimates: string[];
  dataNeeded: string[];
  distinctions: string[];
}

const STATED_STAGES = new Set([
  "new",
  "qualifying",
  "search",
  "tour_requested",
  "tour_confirmed",
  "offer",
  "contract",
  "closing",
  "past",
  "paused",
]);

function firstName(person: string | null): string | null {
  if (!person) return null;
  return person.split(/\s+/)[0] ?? null;
}

function whenLabel(value: string | null | undefined): string {
  const date = validDate(value);
  return date ? formatEt(date.toISOString()) : "time not stated";
}

function lastContactLine(contact: ContactEvent | null | undefined): { line: string; kyle: boolean; coordinatorOnly: boolean } {
  if (!contact || contact.actor === "none" || (!contact.actor && !clean(contact.summary))) {
    return { line: "No contact is recorded.", kyle: false, coordinatorOnly: false };
  }
  const actor = contact.actor ?? "unknown";
  const who =
    actor === "kyle"
      ? "Kyle"
      : actor === "coordinator"
        ? "Coordinator, not Kyle"
        : actor === "client"
          ? "Client"
          : actor === "homeowner"
            ? "Homeowner"
            : "Someone, actor not stated";
  const summary = clean(contact.summary) ?? "No summary was supplied.";
  const channel = contact.channel ?? "unknown";
  return {
    line: `${who} by ${channel}. ${whenLabel(contact.at)}. ${summary}`,
    kyle: actor === "kyle",
    coordinatorOnly: actor === "coordinator",
  };
}

function urgencyFrom(input: LeadPacket, tourOpen: boolean): { text: string; basis: ProcedureResult["urgencyBasis"] } {
  const timeline = clean(input.timeline);
  if (timeline && /asap|today|immediately|this week/i.test(timeline)) {
    return { text: `High, because they said "${timeline}".`, basis: "derived" };
  }
  if (tourOpen) {
    return { text: "High, because a tour was requested and is not confirmed.", basis: "derived" };
  }
  return { text: "Not stated", basis: "not stated" };
}

function valueFrom(input: LeadPacket): { text: string; basis: ProcedureResult["likelyValueBasis"] } {
  const amount = positiveNumber(input.likelyValueUsd);
  if (amount === null || (input.valueBasis !== "verified" && input.valueBasis !== "estimate")) {
    return { text: "Data needed. No fee or commission figure with a basis was supplied.", basis: "data needed" };
  }
  const label = input.valueBasis === "verified" ? "Verified figure you supplied." : "Estimate you supplied. Not a commission calculation.";
  return { text: `${formatMoney(amount)}. ${label}`, basis: input.valueBasis };
}

interface Question {
  objective: string;
  ask: string;
}

function nextQuestion(input: LeadPacket, motivation: string | null): Question | null {
  if (!motivation) return { objective: "Learn why they reached out.", ask: "What has you looking right now?" };
  if (!clean(input.location)) return { objective: "Confirm the location.", ask: "Which areas do you want to be in?" };
  if (!clean(input.criteria)) return { objective: "Confirm the property criteria.", ask: "What does the property need to have?" };
  if (!clean(input.budget)) return { objective: "Confirm the budget.", ask: "What price range should I stay inside?" };
  if (input.payment !== "cash" && input.payment !== "financing") {
    return { objective: "Learn whether this is cash or financing.", ask: "Are you paying cash or using financing?" };
  }
  if (input.payment === "financing" && input.preapproval !== "preapproved" && input.preapproval !== "prequalified" && input.preapproval !== "none") {
    return { objective: "Learn the preapproval status.", ask: "Are you preapproved, prequalified, or still talking to a lender?" };
  }
  if (!clean(input.timeline)) return { objective: "Confirm the timeline.", ask: "When do you want to be in a place?" };
  if (!clean(input.decisionMakers)) return { objective: "Confirm the decision makers.", ask: "Who else is part of the decision?" };
  return null;
}

function qualifiedSearch(input: LeadPacket, motivation: string | null): boolean {
  return nextQuestion(input, motivation) === null;
}

export function runProcedure(input: LeadPacket, now = new Date()): ProcedureResult {
  const person = clean(input.person);
  const phone = clean(input.phone);
  const email = clean(input.email);
  const source = clean(input.leadSource);
  const property = clean(input.property);
  const motivation = clean(input.motivation) ?? clean(input.reason);
  const location = clean(input.location);
  const criteria = clean(input.criteria);
  const budget = clean(input.budget);
  const tourRequested = clean(input.tourRequested);
  const tourConfirmed = clean(input.tourConfirmed);
  const tourOpen = Boolean(tourRequested) && !tourConfirmed;
  const contact = lastContactLine(input.lastContact);
  const value = valueFrom(input);
  const urgency = urgencyFrom(input, tourOpen);
  const statedStage = clean(input.stage);
  const stageBasis: ProcedureResult["stageBasis"] = statedStage && STATED_STAGES.has(statedStage) ? "stated" : "derived";
  const spanish = input.language === "es";
  const continuing = input.conversation === "continuing" || contact.kyle || input.lastContact?.actor === "client";

  const facts: string[] = [];
  const estimates: string[] = [];
  const dataNeeded: string[] = [];
  const distinctions: string[] = [];

  const pushFact = (label: string, valueText: string | null) => {
    if (valueText) facts.push(`${label}: ${valueText}.`);
    else dataNeeded.push(label);
  };

  pushFact("Person", person);
  pushFact("Phone", phone);
  pushFact("Email", email);
  pushFact("Lead source", source);
  pushFact("Property", property);
  pushFact("Reason", motivation);
  pushFact("Location", location);
  pushFact("Criteria", criteria);
  pushFact("Budget", budget);
  pushFact("Timeline", clean(input.timeline));
  pushFact("Decision makers", clean(input.decisionMakers));
  if (input.payment === "cash" || input.payment === "financing") facts.push(`Payment: ${input.payment}.`);
  else dataNeeded.push("Cash or financing");
  if (input.payment === "financing") {
    if (input.preapproval === "preapproved" || input.preapproval === "prequalified" || input.preapproval === "none") {
      facts.push(`Preapproval: ${input.preapproval}.`);
    } else dataNeeded.push("Preapproval");
  }
  if (input.agentGenerated === true) facts.push("Attribution supplied: agent generated.");
  else if (input.agentGenerated === false) facts.push("Attribution supplied: not agent generated.");
  else dataNeeded.push("Agent generated attribution");
  if (input.lenderIntroduced === true) facts.push("A lender introduction was marked done in this packet.");
  else if (input.lenderIntroduced === false) facts.push("No lender introduction is marked.");
  else dataNeeded.push("Lender introduction");

  if (tourConfirmed) {
    facts.push(`Tour confirmed: ${tourConfirmed}.`);
    distinctions.push("A confirmed tour is not the same as a request.");
  } else if (tourRequested) {
    facts.push(`Tour requested: ${tourRequested}. Confirmed: no.`);
    distinctions.push("A tour request is not a confirmed appointment.");
  } else {
    dataNeeded.push("Tour time");
  }

  facts.push(`Last contact: ${contact.line}`);
  if (contact.coordinatorOnly) distinctions.push("Coordinator contact is not your contact.");
  if (!contact.kyle) distinctions.push("You have not contacted this person in the packet.");

  const activity = clean(input.activity);
  if (activity) {
    facts.push(`Activity supplied: ${activity}.`);
    if (input.motivationProven !== true) {
      distinctions.push("Client activity is not proven motivation.");
    }
  }

  const conflicts = (input.conflicts ?? [])
    .map((item) => ({
      field: clean(item.field) ?? "field",
      values: (item.values ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value)),
    }))
    .filter((item) => item.values.length >= 2);

  if (conflicts.length) {
    for (const item of conflicts) facts.push(`Conflict on ${item.field}: ${item.values.join(" / ")}.`);
  }

  let stage = statedStage && STATED_STAGES.has(statedStage) ? statedStage : "qualifying";
  if (stageBasis === "derived") {
    if (tourConfirmed) stage = "tour_confirmed";
    else if (tourOpen) stage = "tour_requested";
    else if (qualifiedSearch(input, motivation)) stage = "search";
    estimates.push(`Stage ${stage} was derived from the packet. It was not a stated stage.`);
  }

  const followBase = suggestFollowUp(now, tourOpen);
  let followUp: ProcedureResult["followUp"] = {
    dueAt: followBase.dueAt,
    label: followBase.label,
    trigger: tourOpen ? "Follow up if the tour is still not confirmed." : "Follow up if there is no reply.",
  };

  let nextAction = "Contact them and ask one question.";
  let question: Question | null = nextQuestion(input, motivation);
  let draft: ProcedureDraft | null = null;

  if (input.optOut === true) {
    nextAction = "Do not contact this person. They opted out.";
    question = null;
    followUp = { dueAt: null, label: "No follow up.", trigger: "Do not follow up." };
    distinctions.push("Opt out applies to this person only.");
  } else if (conflicts.length) {
    const first = conflicts[0];
    nextAction = `Resolve the conflict on ${first.field} before you act on it.`;
    question = {
      objective: `Resolve the ${first.field} conflict.`,
      ask: `I have two notes for ${first.field}: ${first.values[0]} and ${first.values[1]}. Which one is right?`,
    };
  } else if (!person) {
    nextAction = "Identify the person on the inquiry before you write them.";
    question = null;
    followUp = { dueAt: null, label: "No client follow up.", trigger: "Write them after the inquiry names the person." };
  } else if (statedStage === "paused") {
    nextAction = "This file is paused. Do not reach out until you reopen it.";
    question = null;
    followUp = { dueAt: null, label: "No follow up while paused.", trigger: "Reopen the file before any contact." };
  } else if (statedStage === "past") {
    nextAction = "No reactivation draft. Confirm they are eligible before you contact them.";
    question = null;
    followUp = { dueAt: null, label: "No reactivation follow up.", trigger: "Contact them only after you confirm they are eligible." };
  } else if (tourOpen) {
    nextAction = `Ask ${firstName(person)} to confirm ${tourRequested}. It is a request, not an appointment.`;
    question = {
      objective: "Turn the tour request into a confirmed time, or learn it does not work.",
      ask: `Does ${tourRequested} work for you if I can get it confirmed?`,
    };
  } else if (tourConfirmed && statedStage !== "offer" && statedStage !== "contract" && statedStage !== "closing") {
    nextAction = `Hold the confirmed tour at ${tourConfirmed}. Do not call a request confirmed.`;
    question = {
      objective: "Prepare for the confirmed tour.",
      ask: `Anything you want me to know before ${tourConfirmed}?`,
    };
  } else if (statedStage === "offer") {
    nextAction = "Open the offer worksheet. Recommend only terms that are already in the packet.";
    question = null;
    followUp = { ...followUp, trigger: "Follow up when a required offer term is still blank." };
  } else if (statedStage === "contract") {
    nextAction = "Track the next contract milestone that has a date and a source clause.";
    question = null;
    followUp = { ...followUp, trigger: "Follow up on the next sourced contract date." };
  } else if (statedStage === "closing") {
    nextAction = "Confirm the next closing deadline that is actually on the contract.";
    question = null;
    followUp = { ...followUp, trigger: "Follow up on the closing deadline that has a source." };
  } else if (!question) {
    nextAction = "Create the property search and alerts from the confirmed criteria. No listings were supplied, so none are attached.";
    question = {
      objective: "Confirm the criteria, then create the search and alerts.",
      ask: `I am setting your search to ${blank(location)}, ${blank(criteria)}, ${blank(budget)}. Tell me if any of that is off.`,
    };
    followUp = { ...followUp, trigger: "Follow up if they do not correct the search criteria." };
  } else if (!contact.kyle) {
    nextAction = `Contact ${person} yourself. ${contact.coordinatorOnly ? "The coordinator's touch does not count as yours. " : ""}${question.objective}`;
  } else {
    nextAction = question.objective;
  }

  if (input.optOut !== true && person && question && statedStage !== "paused" && statedStage !== "past") {
    draft = buildDraft({
      person,
      phone,
      email,
      property,
      spanish,
      continuing,
      question,
      preferred: input.preferredChannel ?? null,
    });
  }

  if (value.basis !== "data needed") {
    if (value.basis === "verified") facts.push(`Likely value: ${value.text}`);
    else estimates.push(`Likely value: ${value.text}`);
  } else {
    dataNeeded.push("Likely value");
  }
  if (urgency.basis === "derived") estimates.push(`Urgency: ${urgency.text}`);

  const note = agentNote({
    now,
    history: input.history ?? [],
    person: blank(person),
    source: blank(source),
    property: blank(property),
    reason: blank(motivation),
    lastContact: contact.line,
    stage: `${stage} (${stageBasis})`,
    urgency: urgency.text,
    value: value.text,
    distinctions,
    facts,
    estimates,
    dataNeeded,
    nextAction,
    followUp,
  });

  return {
    sent: false,
    stored: false,
    person: blank(person),
    leadSource: blank(source),
    property: blank(property),
    reason: blank(motivation),
    lastActualContact: contact.line,
    kyleHasContacted: contact.kyle,
    stage,
    stageBasis,
    urgency: urgency.text,
    urgencyBasis: urgency.basis,
    likelyValue: value.text,
    likelyValueBasis: value.basis,
    nextAction,
    draft,
    agentToolsNote: note,
    followUp,
    facts,
    estimates,
    dataNeeded,
    distinctions,
  };
}

function buildDraft(input: {
  person: string;
  phone: string | null;
  email: string | null;
  property: string | null;
  spanish: boolean;
  continuing: boolean;
  question: Question;
  preferred: "text" | "email" | "call" | null;
}): ProcedureDraft {
  const channel =
    input.preferred ??
    (input.phone ? "text" : input.email ? "email" : "call");
  const name = firstName(input.person);
  const ask = input.spanish ? spanishAsk(input.question.ask) : input.question.ask;
  let body: string;
  if (input.continuing) {
    body = ask;
  } else if (input.spanish) {
    const place = input.property ? ` sobre ${input.property}` : "";
    body = name
      ? `Hola ${name}, soy Kyle Kleinman con Redfin. Vi tu solicitud${place}. ${ask}`
      : `Hola, soy Kyle Kleinman con Redfin. Vi tu solicitud${place}. ${ask}`;
  } else {
    const place = input.property ? ` for ${input.property}` : "";
    body = name
      ? `Hey ${name}, Kyle Kleinman with Redfin. I saw your request${place}. ${ask}`
      : `Hey, Kyle Kleinman with Redfin. I saw your request${place}. ${ask}`;
  }
  if (channel === "call" && !input.phone) body = `Call script. Number was not in this packet. ${body}`;
  const copyReady = channel === "call" ? true : channel === "text" ? Boolean(input.phone) : Boolean(input.email);
  return {
    channel,
    objective: input.question.objective,
    subject: channel === "email" ? "Your home search" : null,
    body: clientCopy(body),
    copyReady,
    sent: false,
  };
}

function spanishAsk(ask: string): string {
  const map: Record<string, string> = {
    "What has you looking right now?": "¿Qué te tiene buscando ahora?",
    "Which areas do you want to be in?": "¿En qué zonas quieres estar?",
    "What does the property need to have?": "¿Qué necesita tener la propiedad?",
    "What price range should I stay inside?": "¿En qué rango de precio debo quedarme?",
    "Are you paying cash or using financing?": "¿Pagas de contado o con financiamiento?",
    "Are you preapproved, prequalified, or still talking to a lender?": "¿Estás preaprobado, precalificado, o todavía hablando con un prestamista?",
    "When do you want to be in a place?": "¿Para cuándo quieres estar en la propiedad?",
    "Who else is part of the decision?": "¿Quién más decide contigo?",
  };
  if (map[ask]) return map[ask];
  if (ask.startsWith("Does ") && ask.endsWith(" work for you if I can get it confirmed?")) {
    const time = ask.slice(5, -" work for you if I can get it confirmed?".length);
    return `¿Te funciona ${time} si lo puedo confirmar?`;
  }
  if (ask.startsWith("Anything you want me to know before ")) {
    const time = ask.slice("Anything you want me to know before ".length).replace(/\?$/, "");
    return `¿Hay algo que quieras que sepa antes de ${time}?`;
  }
  if (ask.startsWith("I am setting your search to ")) {
    const detail = ask.slice("I am setting your search to ".length).replace(/ Tell me if any of that is off\.$/, "");
    return `Estoy armando tu búsqueda: ${detail} Si algo está mal, dímelo.`;
  }
  const conflict = ask.match(/^I have two notes for (.+): (.+) and (.+)\. Which one is right\?$/);
  if (conflict) return `Tengo dos notas para ${conflict[1]}: ${conflict[2]} y ${conflict[3]}. ¿Cuál es la correcta?`;
  return ask;
}

function agentNote(input: {
  now: Date;
  history: HistoryEvent[];
  person: string;
  source: string;
  property: string;
  reason: string;
  lastContact: string;
  stage: string;
  urgency: string;
  value: string;
  distinctions: string[];
  facts: string[];
  estimates: string[];
  dataNeeded: string[];
  nextAction: string;
  followUp: ProcedureResult["followUp"];
}): string {
  const history = input.history
    .map((event) => ({ at: validDate(event.at), text: clean(event.text) }))
    .filter((event): event is { at: Date; text: string } => Boolean(event.at && event.text))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((event) => `${formatEt(event.at.toISOString())}. ${event.text}`);

  const follow = input.followUp.dueAt
    ? `${formatEt(input.followUp.dueAt)}. ${input.followUp.trigger}`
    : input.followUp.trigger;

  return [
    "Agent Tools note",
    ...history,
    `${formatEt(input.now.toISOString())}. Packet reviewed. Nothing was sent and nothing was written to Redfin.`,
    `Person: ${input.person}.`,
    `Lead source: ${input.source}.`,
    `Property: ${input.property}.`,
    `Reason they raised their hand: ${input.reason}.`,
    `Last actual contact: ${input.lastContact}`,
    `Stage: ${input.stage}.`,
    `Urgency: ${input.urgency}`,
    `Likely value: ${input.value}`,
    input.distinctions.length ? `Distinctions: ${input.distinctions.join(" ")}` : null,
    `Facts: ${input.facts.join(" ")}`,
    input.estimates.length ? `Estimates, not facts: ${input.estimates.join(" ")}` : null,
    `Data needed: ${input.dataNeeded.join(", ") || "None"}.`,
    `Next: ${input.nextAction}`,
    `Follow up: ${follow}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
