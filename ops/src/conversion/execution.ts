import { enqueueApproval } from './approval.ts';
import { isOpportunityDoNotContact } from './guards.ts';
import { nextBestAction } from './engine.ts';
import { QUESTIONS, detectHandoff, screenNextAction, type IntakeField } from './policy.ts';
import { isChannelOptOut } from '../comms/consent.ts';
import { recordCanonicalEvent } from '../canonical.ts';
import { liveChannelPermitted, sendFlags } from '../mode.ts';
import { text, type SqlDb } from '../sql.ts';
import { formatPhone, phoneKey } from '../money.ts';
import { appointmentInstant, formatEt, sameEtDay, weekdayLong, zonedLocalToUtc, zonedParts } from '../time.ts';

/**
 * Human execution cards sit on the existing opportunity, next-best-action, and
 * approval queue. Held records never receive an engine score, so the card is
 * stored beside next_best_actions instead of forcing a shadow score.
 */

const KYLE_PHONE = '(305) 972-4118';
const INTAKE_ORDER: IntakeField[] = [
  'motivation', 'area', 'timeframe', 'occupancy', 'cash_vs_finance', 'preapproval', 'current_home', 'sale_dependency',
];

export type ActionChannel = 'sms' | 'email' | 'call' | 'manual' | 'none';

export interface ManualMark {
  mark: string;
  at: string;
  providerConfirmed: false;
  note: string;
}

export interface ExecutionAction {
  priority: number | null;
  opportunityId: string;
  clientId: string;
  client_name: string;
  isDemo: boolean;
  held: boolean;
  engineScore: number | null;
  hotScore: number | null;
  dueAt: string | null;
  internal_action_type: string;
  client_stage: string;
  current_objective: string;
  why_now: string;
  verified_phone: string | null;
  verified_email: string | null;
  preferred_channel: string;
  language: string;
  property_address: string | null;
  property_address_verified: boolean;
  property_mls: string | null;
  property_price: string | null;
  price_note: string | null;
  property_redfin_url: string | null;
  agent_tools_url: string | null;
  mls_url: string | null;
  property_status: string;
  customer_property_state: string;
  tour_date_time: string | null;
  tour_owner: string | null;
  tour_confirmation_state: string;
  listing_agent_name: string | null;
  listing_agent_brokerage: string | null;
  listing_agent_phone: string | null;
  listing_agent_email: string | null;
  listing_agent_source: string | null;
  repeat_property_request: string | null;
  buyer_type: string;
  occupancy_type: string;
  funding_type: string;
  preapproval_state: string;
  sell_side_dependency: string;
  human_headline: string;
  primary_action: string;
  where: string;
  action_channel: ActionChannel;
  client_draft: string | null;
  listing_agent_draft: string | null;
  email_subject: string | null;
  email_draft: string | null;
  call_opening: string | null;
  wait_for: string;
  if_yes_next: string;
  if_no_next: string;
  if_unclear_next: string;
  qualification_known: string[];
  qualification_missing: string[];
  next_qualification_question: string | null;
  ask_qualification_now: boolean;
  agent_tools_note_draft: string;
  follow_up_trigger: string;
  follow_up_date: string | null;
  owner: string;
  blocked_reason: string | null;
  conflicts: string[];
  unknowns: string[];
  verified_facts: string[];
  source_provenance: string[];
  manual_action_required: true;
  approval_required: boolean;
  draft_status: 'DRAFT' | 'BLOCKED' | 'NONE';
  sent: false;
  provider_confirmed: false;
  lead_source: string;
  lead_source_history: string[];
  summary_buckets: string[];
  manual_marks: ManualMark[];
  approval_id: string | null;
  priority_tier: 'T0' | 'T1' | 'T2' | 'T3';
  horizon: 'short' | 'mid' | 'long';
  waiting_on: 'CLIENT' | 'LISTING_SIDE' | 'LENDER' | 'TITLE' | 'VENDOR' | 'KYLE' | null;
  waiting_reason: string | null;
  waiting_next_check: string | null;
  execution_adapter: string;
  execution_steps: string;
  call_href: string | null;
  evidence_label: 'NONE' | 'MARKED BY KYLE' | 'VERIFIED BY INTEGRATION';
  workflow_drift: boolean;
  promise: string | null;
}

export interface MorningBrief {
  text: string;
  generatedAt: string;
  generatedAtEt: string;
  clock: 'production' | 'test';
  timezone: 'America/New_York';
  live: false;
  sent: false;
  providerConfirmed: false;
  integrations: {
    sms: 'draft_only';
    email: 'draft_only';
    voice: 'unavailable';
    agentToolsWrite: 'unverified';
    calendarWrite: 'unavailable';
  };
  cards: ExecutionAction[];
}

interface FactRow {
  field: string;
  value: string;
  kind: string;
  verification: string;
  source: string;
  observedAt: string;
}

interface Loaded {
  opportunityId: string;
  clientId: string;
  name: string;
  isDemo: boolean;
  stage: string;
  financing: string;
  sellerStage: string;
  noAction: string;
  held: boolean;
  dnc: boolean;
  dueAt: string | null;
  followUpTrigger: string;
  engineType: string;
  engineReason: string;
  engineScore: number | null;
  phone: string | null;
  email: string | null;
  facts: FactRow[];
  answers: Map<string, string>;
  classes: Array<{ axis: string; value: string }>;
  flags: string[];
  handoffReason: string;
  handoffLevel: number;
  priorMarks: ManualMark[];
  manualStatus: string;
}

export function prepareExecution(db: SqlDb, opportunityId: string, now = new Date()): ExecutionAction {
  const loaded = loadOne(db, opportunityId, now);
  const action = decide(loaded, now);
  const approvalId = storeDraft(db, action, now);
  action.approval_id = approvalId;
  db.run(
    `INSERT INTO execution_actions (opportunity_id, client_id, payload_json, manual_status, updated_at, live)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(opportunity_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at,
       live = 0`,
    action.opportunityId,
    action.clientId,
    JSON.stringify(action),
    loaded.manualStatus || 'draft',
    now.toISOString(),
  );
  return action;
}

/** The production desk clock. Tests pass their own Date. Production never uses a fixture instant. */
export function productionClock(): Date {
  return new Date();
}

export function buildMorningBrief(db: SqlDb, now = productionClock(), clock: 'production' | 'test' = 'production'): MorningBrief {
  const sellerIds = new Set(db.all(`SELECT seller_opportunity_id FROM opportunity_links`).map((row) => text(row, 'seller_opportunity_id')));
  const ids = db.all(`SELECT id FROM opportunities WHERE status = 'open'`).map((row) => text(row, 'id')).filter((id) => !sellerIds.has(id));
  const cards = ids.map((id) => prepareExecution(db, id, now));
  const ranked = rankCards(cards);
  ranked.forEach((card, index) => {
    card.priority = index + 1;
  });
  return {
    text: renderMorningBrief(ranked, now, clock),
    generatedAt: now.toISOString(),
    generatedAtEt: formatEt(now),
    clock,
    timezone: 'America/New_York',
    live: false,
    sent: false,
    providerConfirmed: false,
    integrations: {
      sms: 'draft_only',
      email: 'draft_only',
      voice: 'unavailable',
      agentToolsWrite: 'unverified',
      calendarWrite: 'unavailable',
    },
    cards: ranked,
  };
}

export function markManual(db: SqlDb, opportunityId: string, mark: string, now = new Date()): {
  ok: boolean;
  message: string;
  providerConfirmed: false;
  sent: false;
} {
  const allowed = new Set([
    'sent', 'called', 'agent_tools_updated', 'waiting', 'showing_completed', 'showing_cancelled', 'offer_submitted',
    'client_replied', 'no_reply', 'call_completed', 'showing_occurred', 'showing_did_not_occur',
    'interested', 'not_interested', 'wants_offer', 'needs_financing', 'needs_to_sell',
    'contact_found', 'property_unavailable', 'listing_appointment_set',
  ]);
  if (!allowed.has(mark)) {
    return { ok: false, message: 'That mark is not a KyleOS manual status.', providerConfirmed: false, sent: false };
  }
  const row = db.get(`SELECT * FROM execution_actions WHERE opportunity_id = ?`, opportunityId);
  if (!row) return { ok: false, message: 'No execution card exists for that client.', providerConfirmed: false, sent: false };
  const action = JSON.parse(text(row, 'payload_json')) as ExecutionAction;
  const note = manualNote(mark);
  const entry: ManualMark = { mark, at: now.toISOString(), providerConfirmed: false, note };
  action.manual_marks = [...(action.manual_marks ?? []), entry];
  action.sent = false;
  action.provider_confirmed = false;
  db.run(
    `UPDATE execution_actions SET payload_json = ?, manual_status = ?, updated_at = ?, live = 0 WHERE opportunity_id = ?`,
    JSON.stringify(action),
    `kyle_reported_${mark}`,
    now.toISOString(),
    opportunityId,
  );
  recordCanonicalEvent(db, {
    idempotencyKey: `manual:${opportunityId}:${mark}:${now.toISOString()}`,
    clientId: action.clientId,
    opportunityId,
    kind: 'manual_mark',
    now,
    payload: { mark, providerConfirmed: false, sent: false, writtenToAgentTools: false, evidence: 'MARKED BY KYLE', note },
  });
  const refreshed = prepareExecution(db, opportunityId, now);
  return {
    ok: true,
    message: `${note} Next: ${refreshed.human_headline}. Evidence: MARKED BY KYLE. Not verified by an integration.`,
    providerConfirmed: false,
    sent: false,
  };
}

export function renderMorningBrief(cards: ExecutionAction[], now: Date, clock: 'production' | 'test' = 'production'): string {
  const lines: string[] = [
    'KYLEOS MORNING BRIEF',
    `Date: ${formatEt(now)}`,
    `Current Eastern Time: ${formatEt(now)}`,
    clock === 'production'
      ? 'Clock: production. America/New_York. This is the real current time.'
      : 'Clock: test freeze. America/New_York. Not the production clock.',
    'Mode: DRY_RUN. Nothing in this brief was sent.',
    `Actionable clients: ${cards.length}`,
    `Showings today: ${count(cards, 'showings_today')}`,
    `Showings requiring confirmation: ${count(cards, 'showings_to_confirm')}`,
    `Hot post tour clients: ${count(cards, 'post_tour')}`,
    `Offers or offer requests: ${count(cards, 'offers')}`,
    `Financing blockers: ${count(cards, 'financing')}`,
    `Buy after sell clients: ${count(cards, 'buy_after_sell')}`,
    `Listing opportunities: ${count(cards, 'listing_opportunity')}`,
    `Listing agents needing contact: ${count(cards, 'listing_agent')}`,
    `Agent Tools records needing updates: ${count(cards, 'agent_tools')}`,
    `Missing contact information: ${count(cards, 'missing_contact')}`,
    `Overdue actions: ${count(cards, 'overdue')}`,
    `Waiting on client: ${count(cards, 'waiting_client')}`,
    `Waiting on listing side: ${count(cards, 'waiting_listing')}`,
    '',
    'DO THESE FIRST',
    '',
  ];
  for (const card of cards) lines.push(renderCard(card), '');
  lines.push('SUMMARY');
  for (const bucket of SUMMARY_LABELS) {
    const names = cards.filter((card) => card.summary_buckets.includes(bucket.key)).map((card) => card.client_name);
    lines.push(`${bucket.label}: ${names.length ? names.join('; ') : 'none'}`);
  }
  lines.push('', 'No draft above is a sent message. No requested showing is confirmed. No scheduled showing is completed.');
  return lines.join('\n');
}

const SUMMARY_LABELS: Array<{ key: string; label: string }> = [
  { key: 'calls', label: 'CALLS TO MAKE' },
  { key: 'texts', label: 'TEXTS TO SEND' },
  { key: 'emails', label: 'EMAILS TO SEND' },
  { key: 'listing_agent', label: 'LISTING AGENTS TO CONTACT' },
  { key: 'showings_to_confirm', label: 'SHOWINGS TO CONFIRM' },
  { key: 'showings_today', label: 'SHOWINGS TODAY' },
  { key: 'post_tour', label: 'POST TOUR FOLLOW UPS' },
  { key: 'financing', label: 'FINANCING ITEMS' },
  { key: 'buy_after_sell', label: 'BUY AFTER SELL ITEMS' },
  { key: 'cma', label: 'CMAS NEEDED' },
  { key: 'offers', label: 'OFFERS AND OFFER REQUESTS' },
  { key: 'under_contract', label: 'UNDER CONTRACT ITEMS' },
  { key: 'missing_contact', label: 'CONTACT INFORMATION TO FIND' },
  { key: 'agent_tools', label: 'AGENT TOOLS UPDATES' },
  { key: 'waiting_client', label: 'WAITING ON CLIENT' },
  { key: 'waiting_listing', label: 'WAITING ON LISTING SIDE' },
  { key: 'overdue', label: 'OVERDUE ACTIONS' },
  { key: 'promises', label: 'PROMISES OWED BY KYLE' },
  { key: 'workflow_drift', label: 'WORKFLOW DRIFT' },
  { key: 'waiting_kyle', label: 'WAITING ON KYLE' },
];

function renderCard(card: ExecutionAction): string {
  const lines = [
    `PRIORITY ${card.priority ?? '-'} — ${card.client_name.toUpperCase()}${card.isDemo ? ' (DEMO FIXTURE)' : ''}`,
    `STAGE: ${card.client_stage}`,
    `WHY NOW: ${card.why_now}`,
    'WHAT WE KNOW:',
    ...(card.verified_facts.length ? card.verified_facts.map((line) => `- ${line}`) : ['- DATA NEEDED']),
    'WHAT IS STILL UNKNOWN:',
    ...(card.unknowns.length ? card.unknowns.map((line) => `- ${line}`) : ['- None that changes the next step.']),
    `CURRENT OBJECTIVE: ${card.current_objective}`,
    `PROPERTY: ${card.property_address ?? 'DATA NEEDED'}`,
    `PROPERTY SOURCE: ${card.property_address ? (card.property_address_verified ? 'Verified fact' : 'Unverified note. Not confirmed against MLS.') : 'DATA NEEDED'}`,
    `MLS: ${card.property_mls ?? 'DATA NEEDED'}`,
    `PRICE: ${card.property_price ?? (card.price_note ? `DATA NEEDED. Unverified note: ${card.price_note}` : 'DATA NEEDED')}`,
    `PROPERTY STATUS: ${card.property_status}`,
    `CUSTOMER PROPERTY STATE: ${card.customer_property_state}`,
    `REDFIN: ${card.property_redfin_url ?? 'LINK NOT FOUND'}`,
    `AGENT TOOLS: ${card.agent_tools_url ?? 'LINK NOT FOUND'}`,
    `MLS LINK: ${card.mls_url ?? 'LINK NOT FOUND'}`,
    `SHOWING: ${card.tour_date_time ? `${card.customer_property_state}. ${card.tour_date_time}. Showing agent: ${card.tour_owner ?? 'DATA NEEDED'}` : 'DATA NEEDED'}`,
    `OUTCOME: ${card.tour_confirmation_state}`,
    `LISTING AGENT: ${card.listing_agent_name ?? 'LISTING AGENT CONTACT NEEDED'}`,
    `BROKERAGE: ${card.listing_agent_brokerage ?? 'DATA NEEDED'}`,
    `LISTING PHONE: ${card.listing_agent_phone ?? 'DATA NEEDED'}`,
    `LISTING EMAIL: ${card.listing_agent_email ?? 'DATA NEEDED'}`,
    `LISTING SOURCE: ${card.listing_agent_source ?? 'DATA NEEDED'}`,
    `DO THIS NOW: ${card.human_headline}`,
    `WHERE: ${card.where}`,
    `PHONE: ${card.verified_phone ?? 'DATA NEEDED'}`,
    `EMAIL: ${card.verified_email ?? 'DATA NEEDED'}`,
    `COPY: ${copyText(card)}`,
    `EMAIL SUBJECT: ${card.email_subject ?? 'none'}`,
    `EMAIL COPY: ${card.email_draft ? card.email_draft : 'none'}`,
    `LISTING AGENT COPY: ${card.listing_agent_draft ?? 'none'}`,
    `CALL OPENING: ${card.call_opening ?? 'none'}`,
    `WAIT FOR: ${card.wait_for}`,
    `IF YES: ${card.if_yes_next}`,
    `IF NO: ${card.if_no_next}`,
    `IF UNCLEAR: ${card.if_unclear_next}`,
    `NEXT QUALIFICATION: ${card.next_qualification_question ?? 'None open.'} ${card.ask_qualification_now ? '' : 'DO NOT ASK YET.'}`.trim(),
    `AGENT TOOLS NOTE: ${card.agent_tools_note_draft}`,
    `FOLLOW UP: ${card.follow_up_trigger}${card.follow_up_date ? ` at ${formatEt(new Date(card.follow_up_date))}` : ''}`,
    `OWNER: ${card.owner}`,
    `BLOCKED: ${card.blocked_reason ?? 'none'}`,
    `DRAFT STATUS: ${card.draft_status} / MANUAL ACTION REQUIRED`,
    `TIER: ${card.priority_tier} ${card.horizon}`,
    `HOW: ${card.execution_steps}`,
    `WAITING: ${card.waiting_on ? `${card.waiting_on}. ${card.waiting_reason ?? ''}`.trim() : 'none'}`,
    `PROMISE: ${card.promise ?? 'none'}`,
    `EVIDENCE: ${card.evidence_label}`,
    `CALL LINK: ${card.call_href ?? 'none'}`,
    `DRIFT: ${card.workflow_drift ? 'WORKFLOW DRIFT' : 'no'}`,
    'SENT: no. Provider confirmation: no.',
    `FUNDING: ${card.funding_type}`,
    `PREAPPROVAL: ${card.preapproval_state}`,
    `OCCUPANCY: ${card.occupancy_type}`,
    `SELL SIDE: ${card.sell_side_dependency}`,
    `LEAD SOURCE: ${card.lead_source}`,
  ];
  if (card.repeat_property_request) lines.push(`REPEAT PROPERTY REQUEST: ${card.repeat_property_request}`);
  for (const conflict of card.conflicts) lines.push(`DATA CONFLICT: ${conflict}`);
  for (const mark of card.manual_marks) lines.push(`KYLE REPORTED: ${mark.note}`);
  lines.push(`ENGINE (internal, not the action): ${card.internal_action_type}`);
  return lines.join('\n');
}

function decide(loaded: Loaded, now: Date): ExecutionAction {
  const base = blank(loaded, now);
  const message = valueOf(loaded, 'customer_message');
  const buckets = new Set<string>(['agent_tools']);
  if (loaded.dueAt && loaded.dueAt < now.toISOString()) buckets.add('overdue');

  const safety = safetyDecision(loaded, message);
  const choice = safety ?? recordedPassChoice(loaded) ?? contentDecision(loaded, message, now) ?? serviceDecision(loaded, now) ?? qualificationDecision(loaded, message, now);
  Object.assign(base, choice.fields);
  base.summary_buckets = [...new Set([...choice.buckets, ...buckets, ...choice.fields.summary_buckets ?? []])];
  base.agent_tools_note_draft = choice.note ?? defaultNote(base, now);
  fillEmailDraft(loaded, base);
  if (base.client_draft) base.client_draft = cleanCopy(base.client_draft);
  if (base.email_draft) base.email_draft = cleanCopy(base.email_draft);
  if (base.listing_agent_draft) base.listing_agent_draft = cleanCopy(base.listing_agent_draft);
  if (base.call_opening) base.call_opening = cleanCopy(base.call_opening);
  applyChannelBlocks(base);
  applyOperations(loaded, base, now);
  return base;
}

interface Choice {
  fields: Partial<ExecutionAction>;
  buckets: string[];
  note?: string;
}

function safetyDecision(loaded: Loaded, message: string | null): Choice | null {
  const opted = loaded.dnc || (message ? isStop(message) : false) || loaded.facts.some((fact) => fact.field === 'opt_out' && /stop|do not contact/i.test(fact.value));
  if (opted) {
    return {
      buckets: [],
      fields: {
        human_headline: `DO NOT CONTACT ${loaded.name.split(' ')[0]?.toUpperCase() ?? 'CLIENT'}`,
        current_objective: 'Honor the opt out.',
        why_now: 'Contact is suppressed. No routine text, email, or call.',
        primary_action: 'Do not contact this client. No draft is queued.',
        where: 'Nowhere. Leave the file alone.',
        action_channel: 'none',
        client_draft: null,
        wait_for: 'Nothing. An opt out is not a prompt for another message.',
        if_yes_next: 'No outreach.',
        if_no_next: 'No outreach.',
        if_unclear_next: 'No outreach.',
        ask_qualification_now: false,
        next_qualification_question: null,
        owner: 'Kyle',
        follow_up_trigger: 'do_not_contact',
        approval_required: false,
        draft_status: 'NONE',
        customer_property_state: 'Unknown',
        tour_confirmation_state: 'NOT CONFIRMED',
      },
      note: 'Opt out or do-not-contact is on the file. No message was drafted as a send. Agent Tools was not written.',
    };
  }
  const handoff = message ? detectHandoff(message) : { needed: false, reason: loaded.handoffReason, level: loaded.handoffLevel };
  if (loaded.engineType === 'kyle_handoff' || handoff.needed || loaded.handoffLevel > 0) {
    const level = handoff.needed ? handoff.level : loaded.handoffLevel;
    const reason = handoff.needed ? handoff.reason : loaded.handoffReason;
    if (level >= 4 && /offer|contract|commission|legal/i.test(reason)) {
      return offerChoice(loaded, message, 'The customer used offer, contract, commission, or legal language. Kyle has the file. A draft is not a submitted offer.');
    }
    return {
      buckets: ['calls'],
      fields: {
        human_headline: `CALL ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Kyle takes the conversation.',
        why_now: reason || 'The customer asked for Kyle.',
        primary_action: `Call ${firstName(loaded.name)}. Do not keep this in a text thread.`,
        where: loaded.phone ? `Phone ${loaded.phone}. Kyle places the call. KyleOS cannot dial.` : 'DATA NEEDED. No verified phone. Retrieve it from Agent Tools or Redfin before calling.',
        action_channel: 'call',
        call_opening: callOpening(loaded, message),
        client_draft: null,
        wait_for: 'What they say on the call.',
        if_yes_next: 'Listen, then one next step from their answer.',
        if_no_next: 'Offer a time later today. Do not dump a script.',
        if_unclear_next: 'Ask them to say the one thing they want handled first.',
        ask_qualification_now: false,
        owner: 'Kyle',
        follow_up_trigger: 'kyle_handoff',
        customer_property_state: loaded.engineType,
        tour_confirmation_state: 'NOT CONFIRMED',
      },
    };
  }
  return null;
}

function contentDecision(loaded: Loaded, message: string | null, now: Date): Choice | null {
  if (!message) return milestoneChoice(loaded, now);
  if (/good schools|safe neighborhood|family neighborhood|best type of people|good neighborhood/i.test(message)) {
    return {
      buckets: ['texts'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Turn a subjective area comment into an objective need.',
        why_now: 'The customer used subjective neighborhood language. Do not steer.',
        primary_action: 'Ask for the objective need. Do not rank areas by who lives there.',
        client_draft: spanish(loaded, `${firstName(loaded.name)}, I can't pick an area based on that. If you want school information, use the district or another source you choose. What commute or property feature is the real must have?`, `${firstName(loaded.name)}, no puedo elegir la zona por eso. Si quieres datos de escuelas, usa el distrito u otra fuente que tu elijas. Que es lo que de verdad necesitas, el trayecto o algo de la casa?`),
        wait_for: 'An objective must have.',
        if_yes_next: 'Use that objective feature in the search.',
        if_no_next: 'Leave the area open.',
        if_unclear_next: 'Ask them to name one feature.',
        ask_qualification_now: false,
      }),
    };
  }
  if (/\b(str|short[\s-]?term|airbnb)\b/i.test(message)) {
    const known = verifiedValue(loaded, 'str_legality');
    return {
      buckets: ['texts'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Do not invent short-term rental legality.',
        why_now: known ? 'A verified source already states the rental rule.' : 'STR legality is unknown.',
        primary_action: known ? `Use only the verified rule: ${known}` : 'Tell them the rule is unknown until the listing, HOA, and city are checked.',
        client_draft: known
          ? `${firstName(loaded.name)}, the verified note says: ${known}. I won't add anything past that.`
          : `${firstName(loaded.name)}, I can't confirm short term rental rules on that one. That needs the listing, the HOA, and the city. I won't treat it as allowed.`,
        wait_for: 'Whether they want those sources checked.',
        if_yes_next: 'Pull the published rule and label it verified or not found.',
        if_no_next: 'Leave STR as unknown.',
        if_unclear_next: 'Ask if this home is for living in or for renting.',
        ask_qualification_now: false,
      }),
    };
  }
  if (/cash flow|cap rate|roi|arv/i.test(message)) {
    return {
      buckets: ['texts'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Do not invent investment numbers.',
        why_now: 'They asked for a figure that is not verified.',
        primary_action: 'Say the number is not in the file. Do not calculate a fake cash flow.',
        client_draft: `${firstName(loaded.name)}, I don't have verified rent, taxes, insurance, or HOA for that, so I won't guess cash flow. I can pull the published figures and label anything missing as DATA NEEDED.`,
        wait_for: 'Whether they want the published figures pulled.',
        if_yes_next: 'Collect verified taxes, HOA, and rent. Label estimates as ESTIMATE.',
        if_no_next: 'Leave the investment math unknown.',
        if_unclear_next: 'Ask which number they actually need first.',
        ask_qualification_now: false,
      }),
    };
  }
  return milestoneChoice(loaded, now);
}

function milestoneChoice(loaded: Loaded, now: Date): Choice | null {
  const offer = (valueOf(loaded, 'offer_state') ?? '').toLowerCase();
  const provider = verifiedValue(loaded, 'offer_provider_confirmation');
  const milestone = (valueOf(loaded, 'transaction_milestone') ?? '').toLowerCase();
  const stage = loaded.stage;
  if (provider) {
    return {
      buckets: ['offers', 'under_contract'],
      fields: {
        human_headline: `OFFER SUBMITTED FOR ${firstName(loaded.name).toUpperCase()}`,
        current_objective: 'Track the submitted offer from the provider confirmation.',
        why_now: 'A provider confirmation is on file. A draft is not what made this submitted.',
        primary_action: 'Read the confirmation and set the next contract step from that document.',
        where: 'The provider confirmation already in the file. Do not mark a new send.',
        action_channel: 'manual',
        client_draft: null,
        wait_for: 'The other side, or the next verified deadline.',
        if_yes_next: 'Move only the verified milestone.',
        if_no_next: 'Leave the offer as submitted and wait.',
        if_unclear_next: 'HUMAN REVIEW REQUIRED before any deadline is stated.',
        ask_qualification_now: false,
        owner: 'Kyle',
        follow_up_trigger: 'offer_submitted',
        customer_property_state: 'Offer submitted',
        tour_confirmation_state: 'NOT CONFIRMED',
        draft_status: 'NONE',
      },
      note: `Offer submitted only because provider confirmation is on file: ${provider}. Agent Tools was not written.`,
    };
  }
  if (offer.includes('accepted') && verifiedValue(loaded, 'offer_accepted')) {
    return transactionFields(loaded, 'OFFER ACCEPTED', 'Offer accepted is verified. Start transaction tracking from the executed document, not from a draft.', 'under_contract');
  }
  if (stage === 'CLOSED' || milestone.includes('closed')) {
    return {
      buckets: [],
      fields: {
        human_headline: `CLOSED FILE FOR ${firstName(loaded.name).toUpperCase()}`,
        current_objective: 'Confirm keys or possession if that is still open.',
        why_now: 'Closing is verified. Do not blast a referral request.',
        primary_action: 'Confirm possession, write the closing facts, and leave referral asks for later.',
        where: 'The closing file. KyleOS cannot update the transaction system.',
        action_channel: 'manual',
        client_draft: null,
        wait_for: 'Possession confirmed.',
        if_yes_next: 'Record the closing facts.',
        if_no_next: 'Resolve the open possession issue before any relationship ask.',
        if_unclear_next: 'Check with the closing agent.',
        ask_qualification_now: false,
        owner: 'Kyle',
        follow_up_trigger: 'post_closing',
        draft_status: 'NONE',
        customer_property_state: 'Closed',
      },
    };
  }
  if (milestone.includes('walkthrough')) {
    return transactionFields(loaded, 'FINAL WALKTHROUGH', 'The walkthrough is scheduled. Scheduled is not completed.', 'under_contract');
  }
  if (milestone.includes('inspection_unknown') || milestone.includes('inspection status unknown')) {
    return transactionFields(loaded, 'INSPECTION STATUS UNKNOWN', 'Do not invent the inspection deadline. HUMAN REVIEW REQUIRED. Check the executed contract.', 'under_contract');
  }
  if (verifiedValue(loaded, 'inspection_deadline')) {
    return transactionFields(loaded, 'INSPECTION DEADLINE', `Verified inspection deadline: ${verifiedValue(loaded, 'inspection_deadline')}. Do not move it from memory.`, 'under_contract');
  }
  if (verifiedValue(loaded, 'effective_date')) {
    return transactionFields(loaded, 'EFFECTIVE DATE VERIFIED', `Effective date on file: ${verifiedValue(loaded, 'effective_date')}. Other deadlines stay unknown until the contract supports them.`, 'under_contract');
  }
  if (milestone.includes('not clear') || milestone.includes('loan')) {
    return {
      buckets: ['financing', 'under_contract'],
      fields: transactionFields(loaded, 'LOAN NOT CLEAR TO CLOSE', 'The loan is not clear to close. Ask the lender which condition is still open. Do not tell the buyer they are clear.', 'financing').fields,
    };
  }
  if (stage === 'UNDER_CONTRACT' || loaded.sellerStage === 'SELLER_UNDER_CONTRACT') {
    return transactionFields(loaded, 'UNDER CONTRACT', 'Name the milestone, the owner, and the verified deadline. Do not say a step is done because it was discussed.', 'under_contract');
  }
  if (offer.includes('draft')) {
    return offerChoice(loaded, null, 'An offer draft exists. Drafted is not submitted.');
  }
  if (offer.includes('request') || stage === 'OFFER_READY' || loaded.engineType === 'review_offer_with_kyle') {
    return offerChoice(loaded, null, 'An offer is being discussed. Discussion is not submission.');
  }
  if (loaded.engineType === 'review_closing_risk') {
    return transactionFields(loaded, 'REVIEW THE CONTRACT RISK', loaded.engineReason || 'Review the closing risk before any other outreach.', 'under_contract');
  }
  const calendar = valueOf(loaded, 'calendar_conflict');
  if (calendar) {
    return {
      buckets: [],
      fields: {
        human_headline: 'CALENDAR CONFLICT',
        current_objective: 'Do not book over the existing appointment.',
        why_now: calendar,
        primary_action: 'Do not book over the existing appointment. Resolve the overlap before recommending a call, showing, or consult.',
        where: 'Kyle\'s calendar. KyleOS cannot write calendar events.',
        action_channel: 'manual',
        client_draft: null,
        wait_for: 'Which appointment moves.',
        if_yes_next: 'Book only the open time.',
        if_no_next: 'Leave both as they are and tell the client the conflict.',
        if_unclear_next: 'Ask Kyle which one stays.',
        ask_qualification_now: false,
        owner: 'Kyle',
        follow_up_trigger: 'calendar_conflict',
        draft_status: 'NONE',
      },
    };
  }
  return null;
}

const WEEKDAY_WINDOW_DAYS = 6;
const TOUR_HISTORY_DAYS = 21;

function calendarAgeDays(instant: Date, now: Date): number {
  const tour = zonedParts(instant);
  const today = zonedParts(now);
  const tourUtc = Date.UTC(tour.year, tour.month - 1, tour.day);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((todayUtc - tourUtc) / 86400000);
}

function showingWhenPhrase(instant: Date, now: Date): { phrase: string; history: boolean } {
  const age = calendarAgeDays(instant, now);
  const parts = zonedParts(instant);
  const date = `${parts.month}/${parts.day}`;
  if (age > TOUR_HISTORY_DAYS) return { phrase: `on ${date}`, history: true };
  if (age >= 0 && age <= WEEKDAY_WINDOW_DAYS) return { phrase: `on ${weekdayLong(instant)}`, history: false };
  return { phrase: `on ${date}`, history: false };
}

function primaryTourInstant(loaded: Loaded, now: Date): Date | null {
  const direct = valueOf(loaded, 'tour_datetime');
  if (direct) {
    const parsed = appointmentInstant(direct, now);
    if (parsed) return parsed;
  }
  for (const key of ['recent_tour_note', 'past_tour_note', 'tours_summary']) {
    const row = loaded.facts.find((fact) => fact.field === key);
    if (!row) continue;
    const parsed = appointmentInstant(row.value, now);
    if (parsed) return parsed;
    const observed = Date.parse(row.observedAt);
    if (Number.isNaN(observed)) continue;
    if (calendarAgeDays(new Date(observed), now) > 1) return new Date(observed);
  }
  return null;
}

function searchSummary(raw: string | null): string | null {
  if (!raw) return null;
  const lines = raw.split(/\n+/).map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
  const piece = lines[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!piece) return null;
  const clipped = piece.length > 120 ? piece.slice(0, 117).trim() : piece;
  return clipped.replace(/[—–]/g, ', ');
}

function recordedPass(loaded: Loaded): { text: string; verified: boolean } | null {
  const fields = ['tour_outcome', 'recent_tour_note', 'past_tour_note', 'showing_note', 'client_note', 'outcome_note'];
  for (const field of fields) {
    const row = loaded.facts.find((fact) => fact.field === field);
    if (!row) continue;
    if (!/\b(passed on|passed because|client passed|they passed|buyer passed|declined|not interested|no longer interested|walked away)\b/i.test(row.value)) continue;
    return { text: row.value, verified: row.kind === 'fact' && row.verification === 'verified' };
  }
  return null;
}

function recordedPassChoice(loaded: Loaded): Choice | null {
  const pass = recordedPass(loaded);
  if (!pass) return null;
  const name = firstName(loaded.name);
  const address = valueOf(loaded, 'property_address');
  const place = address ? streetLine(address) : 'that one';
  const cashOnly = /cash[- ]only/i.test(pass.text);
  const draft = cashOnly
    ? `${name}, I have a note that you passed on ${place} because it is cash only. Want me to send a couple that fit financing?`
    : `${name}, I have a note that you passed on ${place}. Want me to send a couple that fit how you're paying?`;
  return {
    buckets: ['texts'],
    fields: draftFields(loaded, {
      human_headline: `TEXT ${name.toUpperCase()} NOW`,
      current_objective: 'They passed on that property. Offer a next option that fits how they pay.',
      why_now: pass.verified
        ? 'The file records a pass. Do not ask what they thought, and do not leave the showing as outcome unknown.'
        : 'An unverified note says they passed. That is an inference, not a verified outcome. Do not ask what they thought.',
      primary_action: 'Offer comparable options that fit their financing. Do not ask whether they saw it.',
      client_draft: draft,
      customer_property_state: pass.verified ? 'Passed on the property' : 'Inference: passed on the property. Not verified.',
      tour_confirmation_state: pass.verified
        ? 'PASSED. RECORDED ON THE FILE. NOT A PROVIDER CONFIRMATION.'
        : 'NOT CONFIRMED. INFERENCE SAYS PASSED. NOT VERIFIED.',
      ask_qualification_now: false,
      follow_up_trigger: 'passed_property',
    }),
    note: pass.verified
      ? 'Pass is a recorded fact. It is not a provider confirmation and Agent Tools was not written.'
      : 'Pass is an inference. It is not verified and Agent Tools was not written.',
  };
}

function historyChoice(loaded: Loaded, instant: Date, now: Date): Choice {
  const parts = zonedParts(instant);
  const date = `${parts.month}/${parts.day}`;
  const name = firstName(loaded.name);
  const summary = searchSummary(valueOf(loaded, 'saved_search'));
  const draft = summary
    ? `${name}, the ${date} showing is behind us. Are you still focused on ${summary}?`
    : `${name}, the ${date} showing is behind us. What do you want to see next?`;
  return {
    buckets: ['texts'],
    fields: draftFields(loaded, {
      human_headline: `TEXT ${name.toUpperCase()} NOW`,
      current_objective: 'The old tour is history. Ask what they want next.',
      why_now: `The tour date ${date} is more than 21 days old. Do not ask if they just saw it.`,
      primary_action: 'One question about what they want next. Do not ask whether they saw that old tour.',
      client_draft: draft,
      customer_property_state: 'Past history',
      tour_confirmation_state: 'NOT AN OPEN SHOWING',
      ask_qualification_now: false,
      follow_up_trigger: 'past_history',
      tour_date_time: date,
    }),
    note: `${shortDate(now)} The ${date} showing is past history. No attendance text was drafted. Agent Tools was not written.`,
  };
}

function copyText(card: ExecutionAction): string {
  if (card.action_channel === 'email' && card.verified_email && card.email_draft) {
    const subject = card.email_subject ? `Subject: ${card.email_subject}. ` : '';
    return `"${subject}${card.email_draft.replace(/\s*\n+\s*/g, ' ')}"`;
  }
  if (card.client_draft) return `"${card.client_draft}"`;
  return 'DATA NEEDED';
}

function fillEmailDraft(loaded: Loaded, action: ExecutionAction): void {
  if (action.action_channel !== 'email' || !loaded.email) return;
  if (action.email_draft && action.email_subject) return;
  const question = action.next_qualification_question || 'What should I handle next on this search?';
  const built = emailFor(loaded, question.endsWith('?') ? question : `${question}?`);
  action.email_subject = action.email_subject ?? built.subject;
  if (!action.email_draft) {
    const spoken = action.client_draft?.trim();
    action.email_draft = spoken
      ? [`Hi ${firstName(loaded.name)},`, '', spoken, '', 'Kyle Kleinman', 'Redfin, Miami-Dade and Broward', KYLE_PHONE].join('\n')
      : built.body;
  }
}

function serviceDecision(loaded: Loaded, now: Date): Choice | null {
  const tour = tourFacts(loaded, now);
  const pending = /pending|sold|off market|cancelled|canceled/i.test(baseStatus(loaded));
  const pastTour = (tour.past && !tour.outcomeKnown) || (loaded.engineType === 'tour_follow_up' && !tour.outcomeKnown);
  const timed = primaryTourInstant(loaded, now);
  const aged = timed ? showingWhenPhrase(timed, now) : null;
  if (pastTour && aged?.history) return historyChoice(loaded, timed!, now);
  if (pastTour) {
    const street = tour.address ? streetLine(tour.address) : null;
    const claimed = /completed|happened|already showed|\btoured\b/i.test(`${valueOf(loaded, 'recent_tour_note') ?? ''} ${valueOf(loaded, 'tour_outcome') ?? ''}`)
      && !/unconfirmed|not confirmed|outcome unknown/i.test(`${valueOf(loaded, 'recent_tour_note') ?? ''} ${valueOf(loaded, 'tour_outcome') ?? ''}`);
    const whenPhrase = aged?.phrase ?? null;
    const copy = claimed
      ? `${firstName(loaded.name)}, what did you think of ${street ?? 'the place'}?`
      : street && whenPhrase
        ? `${firstName(loaded.name)}, did you end up seeing ${street} ${whenPhrase}?`
        : street
          ? `${firstName(loaded.name)}, did you end up seeing ${street}?`
          : whenPhrase
            ? `${firstName(loaded.name)}, did you end up seeing it ${whenPhrase}?`
            : `${firstName(loaded.name)}, did you end up seeing it?`;
    const when = tour.label ?? 'the scheduled time';
    const noteDate = shortDate(now);
    const happened = tour.rawWhen ? shortWhen(tour.rawWhen, now) : when;
    const whenLabel = aged && !aged.history ? aged.phrase.replace(/^on /, '') : (tour.weekday ?? 'The');
    return {
      buckets: ['post_tour', 'texts'],
      note: `Do not mark the previous tour completed until verified. After Kyle confirms the text was sent, paste: "${noteDate} Kyle texted customer to verify whether the ${happened} showing at ${tour.address ?? 'the property'} occurred. Outcome pending customer response." Do not paste that note before the text is actually sent. Nothing has been sent.`,
      fields: {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Learn whether the showing happened.',
        why_now: claimed
          ? 'A showing-agent or coordinator note is not a tour with Kyle and does not confirm the outcome.'
          : `${whenLabel} showing outcome remains unknown. Do not assume the client attended.`,
        primary_action: `Text ${firstName(loaded.name)}. Ask only whether they saw the property.`,
        where: loaded.phone ? `Messages. New text to ${loaded.phone}. KyleOS cannot send it.` : 'DATA NEEDED. No verified phone.',
        action_channel: 'sms',
        client_draft: copy,
        wait_for: 'Whether they actually attended.',
        if_yes_next: 'Next question: "What did you think once you got inside?"',
        if_no_next: 'If they still want it: verify current availability and access. Then coordinate another showing.',
        if_unclear_next: 'Ask if they got inside or if the time changed.',
        ask_qualification_now: false,
        next_qualification_question: 'Motivation',
        owner: 'Kyle',
        follow_up_trigger: 'tour_follow_up',
        follow_up_date: nextDayNoon(now),
        customer_property_state: 'Scheduled, outcome unknown',
        tour_confirmation_state: 'NOT CONFIRMED. POST TOUR VERIFICATION NEEDED',
        tour_date_time: tour.label,
        tour_owner: tour.agent,
      },
    };
  }
  if (loaded.engineType === 'confirm_tour_details' || (tour.scheduled && !tour.past)) {
    return {
      buckets: ['showings_to_confirm', 'texts'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Confirm the tour details without calling the showing confirmed.',
        why_now: 'A tour is on the file and nobody has confirmed it. A schedule note is not confirmation.',
        primary_action: 'Text the client one question about the time. Do not tell them it is confirmed.',
        client_draft: `${firstName(loaded.name)}, Kyle with Redfin. I have ${tour.address ? streetLine(tour.address) : 'the property'} on a tour request and the time is not confirmed. What time should I try to lock?`,
        wait_for: 'A usable time.',
        if_yes_next: 'Check access with the listing side before telling the buyer it is set.',
        if_no_next: 'Ask for one other time.',
        if_unclear_next: 'Repeat the time back once.',
        ask_qualification_now: false,
        next_qualification_question: 'Motivation',
        customer_property_state: 'Scheduled, not confirmed',
        tour_confirmation_state: 'NOT CONFIRMED',
        follow_up_trigger: 'tour_details',
      }),
    };
  }
  if (loaded.engineType === 'respond_to_tour_request' || valueOf(loaded, 'showing_request')) {
    const address = tour.address ?? valueOf(loaded, 'property_address');
    const listing = listingDraft(loaded, address);
    return {
      buckets: ['showings_to_confirm', 'texts', ...(listing ? ['listing_agent'] : ['waiting_listing'])],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Advance the showing request. It is not confirmed.',
        why_now: 'The buyer asked to see a property. Listing access is still open.',
        primary_action: listing
          ? 'Text the client. The listing agent text is ready too. CLIENT CONTACT READY.'
          : 'Text the client. CLIENT CONTACT READY / LISTING AGENT CONTACT PENDING.',
        client_draft: `${firstName(loaded.name)}, Kyle with Redfin. I have your request for ${address ? streetLine(address) : 'the property'}. I'm confirming access now.`,
        listing_agent_draft: listing,
        wait_for: 'The time they can do, and access from the listing side.',
        if_yes_next: 'Hold the time only after access is actually confirmed.',
        if_no_next: 'Ask for one other time.',
        if_unclear_next: 'Ask them to pick one time.',
        ask_qualification_now: false,
        customer_property_state: 'Requested, not confirmed',
        tour_confirmation_state: 'NOT CONFIRMED',
        follow_up_trigger: 'tour_request',
      }),
    };
  }
  if (pending && !pastTour) {
    const openNearby = /open|nearby|flexible/i.test(valueOf(loaded, 'area_flexibility') ?? '');
    return {
      buckets: ['texts'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'The property changed. Find out why they wanted it before sending other homes.',
        why_now: `Property status is ${baseStatus(loaded)}. That does not end the lead.`,
        primary_action: 'One question about the property. Do not send a list of replacements yet.',
        client_draft: openNearby
          ? `${firstName(loaded.name)}, that one isn't available anymore. What was it about that place that caught your eye?`
          : `${firstName(loaded.name)}, that one went ${baseStatus(loaded).toLowerCase()}. Are you set on this area, or open to nearby options too?`,
        wait_for: openNearby ? 'What they liked about it.' : 'Whether the area is fixed.',
        if_yes_next: 'Use that reason for the next search. Do not send ten listings.',
        if_no_next: 'Ask what about it mattered.',
        if_unclear_next: 'Ask them to name the one feature.',
        ask_qualification_now: false,
        customer_property_state: 'Unavailable',
        property_status: baseStatus(loaded),
      }),
    };
  }
  const cma = valueOf(loaded, 'cma_reminder');
  if (cma && !/completed|done/i.test(cma)) {
    const home = verifiedValue(loaded, 'current_home_address') ?? valueOf(loaded, 'current_home_address');
    return {
      buckets: ['cma', 'buy_after_sell', 'listing_opportunity', ...(loaded.phone || loaded.email ? [] : ['missing_contact'])],
      fields: {
        human_headline: `CMA NEEDED FOR ${firstName(loaded.name).toUpperCase()}`,
        current_objective: 'Get a verified property address, then hand off the CMA. Do not create a CMA for an assumed house.',
        why_now: cma,
        primary_action: home
          ? `Hand the CMA for ${home} to the seller desk.`
          : `Pull ${firstName(loaded.name)}'s current home address from Agent Tools or Redfin. DATA NEEDED before any CMA.`,
        where: 'Agent Tools or Redfin for the address. KyleOS cannot write Agent Tools.',
        action_channel: 'manual',
        client_draft: loaded.phone || loaded.email
          ? `${firstName(loaded.name)}, Kyle with Redfin. The purchase still depends on selling first. Is that still the plan?`
          : `${firstName(loaded.name)}, Kyle with Redfin. Last we had, the plan was to sell first and then buy. Is that still the plan?`,
        wait_for: 'The property address and whether the sale still controls the purchase.',
        if_yes_next: 'Hand off the CMA the same day the address is verified.',
        if_no_next: 'Update the sell-side dependency from their answer. Do not pressure a listing.',
        if_unclear_next: 'Ask if they still need to sell before they buy.',
        ask_qualification_now: false,
        next_qualification_question: 'Current home address',
        owner: 'Kyle',
        follow_up_trigger: 'cma_needed',
        sell_side_dependency: 'CMA NEEDED',
        blocked_reason: home ? null : 'Current home address is unknown. Do not create a CMA yet.',
        draft_status: loaded.phone || loaded.email ? 'DRAFT' : 'BLOCKED',
        customer_property_state: 'Unknown',
      },
    };
  }
  if (loaded.held && !loaded.phone && !loaded.email) {
    const property = valueOf(loaded, 'property_address');
    const summary = searchSummary(valueOf(loaded, 'saved_search'));
    const summaryLine = summary ? (summary.endsWith('.') ? summary : `${summary}.`) : null;
    return {
      buckets: ['missing_contact', ...(valueOf(loaded, 'offer_note') ? ['offers'] : [])],
      fields: {
        human_headline: `GET ${firstName(loaded.name).toUpperCase()}'S CELL`,
        current_objective: 'Find a verified phone or email before any outreach.',
        why_now: valueOf(loaded, 'offer_note')
          ? `No verified phone or email. An offer request is on file and was not submitted. ${valueOf(loaded, 'offer_note')}`
          : 'No verified phone or email is on file. Other facts can still be read.',
        primary_action: `GET ${firstName(loaded.name).toUpperCase()}'S CELL. Look in Agent Tools or Redfin. Do not invent a number.${/text/i.test(valueOf(loaded, 'preferred_channel') ?? '') ? ' Prefers text, so text first once the cell is verified. Do not call first.' : ''}`,
        where: 'Agent Tools, then Redfin. RETRIEVE FROM: the client record. LOOK FOR: cell phone and email.',
        action_channel: 'manual',
        client_draft: property
          ? `${firstName(loaded.name)}, Kyle with Redfin. I have your request on ${streetLine(property)} and we have not spoken. Are you still after that one?`
          : summaryLine
            ? `${firstName(loaded.name)}, Kyle with Redfin. ${summaryLine} Which area is the priority right now?`
            : `${firstName(loaded.name)}, Kyle with Redfin. Which search is the priority right now?`,
        wait_for: 'A verified phone or email.',
        if_yes_next: 'Return them to the text or email queue the same day. Still do not send without approval.',
        if_no_next: 'Keep the enrichment task open until end of day, then escalate to the buyer desk.',
        if_unclear_next: 'Check the same record for a second identifier.',
        ask_qualification_now: false,
        owner: 'Kyle',
        blocked_reason: 'No verified phone or email. The draft cannot be sent.',
        draft_status: 'BLOCKED',
        follow_up_trigger: 'pending_enrichment',
        follow_up_date: sameDayEvening(now),
        customer_property_state: property ? 'Offer or search on file, contact missing' : 'Unknown',
      },
    };
  }
  return null;
}

function qualificationDecision(loaded: Loaded, message: string | null, now: Date): Choice {
  const next = nextMissing(loaded);
  const words = message ? message.trim().split(/\s+/).length : 0;
  const short = message ? words <= 6 : false;
  const detailed = message ? words >= 25 : false;
  const searchRequired = verifiedValue(loaded, 'required_filters');
  const searchPreferred = valueOf(loaded, 'preferred_filters');
  if (searchRequired && !loaded.engineType.startsWith('tour') && loaded.engineType !== 'confirm_tour_details') {
    return {
      buckets: ['texts'],
      fields: draftFields(loaded, {
        human_headline: `CREATE SEARCH NOW FOR ${firstName(loaded.name).toUpperCase()}`,
        current_objective: 'Create the search with hard filters only.',
        why_now: 'Enough criteria exist. A preference is not a requirement.',
        primary_action: `REQUIRED: ${searchRequired}. PREFERRED: ${searchPreferred ?? 'none stated'}. DO NOT FILTER OUT YET: anything that is only a preference.`,
        client_draft: `${firstName(loaded.name)}, I'm setting the search with the must haves only. I'll keep the preferences loose.`,
        wait_for: 'A correction to the must haves.',
        if_yes_next: 'Save the search and keep the old criteria in history.',
        if_no_next: 'Ask which filter is wrong.',
        if_unclear_next: 'Read the required list back once.',
        ask_qualification_now: false,
      }),
    };
  }
  const areaChange = valueOf(loaded, 'area_changed');
  if (areaChange) {
    return {
      buckets: ['texts'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Update the search area and keep the old criteria.',
        why_now: areaChange,
        primary_action: 'Use the new area. Do not erase the prior search.',
        client_draft: `${firstName(loaded.name)}, got it. I'll use the new area and keep the earlier search on file.`,
        wait_for: 'Anything else that changed with the area.',
        if_yes_next: 'Update the active criteria and note why.',
        if_no_next: 'Leave the old search in history.',
        if_unclear_next: 'Ask which area is the one to use now.',
        ask_qualification_now: false,
      }),
    };
  }
  if (loaded.financing === 'CASH' || /cash/.test((loaded.answers.get('cash_vs_finance') ?? '').toLowerCase())) {
    const question = next && next.field !== 'preapproval' ? next.question : 'Do you rent now, or do you own a home?';
    return {
      buckets: ['texts', 'financing'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Cash is known. Do not ask for a preapproval.',
        why_now: 'The buyer said cash. That is a confirmed answer, not a guess from a tag.',
        primary_action: 'One next question that is not about financing approval.',
        client_draft: shortCopy(loaded, `Got it. Cash. ${question}`),
        wait_for: 'The next answer.',
        if_yes_next: 'Store that answer and ask one thing.',
        if_no_next: 'Store it and pick the next unknown.',
        if_unclear_next: 'Ask the same question once, shorter.',
        ask_qualification_now: true,
        next_qualification_question: question,
        funding_type: 'Cash',
        preapproval_state: 'Not applicable',
      }),
    };
  }
  const pre = (loaded.answers.get('preapproval') ?? '').toLowerCase();
  if (/finance/.test((loaded.answers.get('cash_vs_finance') ?? '').toLowerCase()) && !pre) {
    return {
      buckets: ['texts', 'financing'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Learn whether they are already approved.',
        why_now: 'They said financing. Approval is still unknown. Lack of approval is not a disqualification.',
        primary_action: 'Ask the approval question only.',
        client_draft: `${firstName(loaded.name)}, already approved, or do we still need to handle that piece?`,
        wait_for: 'Approved or not yet.',
        if_yes_next: 'If approved, ask who the lender is. Do not ask for documents by text.',
        if_no_next: 'Offer a lender intro. "No problem. I can get you connected with someone and get that piece handled. Want me to make the intro?"',
        if_unclear_next: 'Ask approved or not yet, once.',
        ask_qualification_now: true,
        next_qualification_question: QUESTIONS.preapproval,
        funding_type: 'Financing, status unknown',
        preapproval_state: 'Unknown',
      }),
    };
  }
  if (pre && /not yet|no|need|without/.test(pre)) {
    return {
      buckets: ['texts', 'financing'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Offer a lender introduction. Do not teach a mortgage class by text.',
        why_now: 'Financing is not approved yet.',
        primary_action: 'Offer the intro in one question.',
        client_draft: `${firstName(loaded.name)}, no problem. I can get you connected with someone and get that piece handled. Want me to make the intro?`,
        wait_for: 'Yes or no on the intro.',
        if_yes_next: 'Make the intro only after they agree. Still do not request tax returns by text.',
        if_no_next: 'Leave financing as not approved and continue the property conversation.',
        if_unclear_next: 'Ask if they want the intro.',
        ask_qualification_now: false,
        funding_type: 'Financing, not approved',
        preapproval_state: 'Needs preapproval',
      }),
    };
  }
  if (pre && /approved|preapproved|pre-approved/.test(pre)) {
    const question = next?.question ?? 'Which areas do you want to focus on?';
    return {
      buckets: ['texts', 'financing'],
      fields: draftFields(loaded, {
        human_headline: `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Preapproval is known. Do not ask it again.',
        why_now: 'They already said they are approved.',
        primary_action: 'Move one step past financing.',
        client_draft: shortCopy(loaded, `Got it, you're approved. ${question}`),
        wait_for: 'The next answer.',
        if_yes_next: 'Store it.',
        if_no_next: 'Store it.',
        if_unclear_next: 'Ask once more, shorter.',
        ask_qualification_now: Boolean(next),
        next_qualification_question: question,
        funding_type: 'Financing and approved',
        preapproval_state: 'Preapproved',
      }),
    };
  }
  const dependency = loaded.classes.find((row) => row.axis === 'dependency')?.value ?? '';
  if (dependency === 'proceeds_required') {
    return dependencyChoice(loaded, 'PROCEEDS REQUIRED', 'The purchase needs the sale proceeds. Do not treat that as a listing they asked for.');
  }
  if (dependency === 'sale_required') {
    return dependencyChoice(loaded, 'SALE REQUIRED', 'They have to sell first. Get the address if it is missing. Do not guess it.');
  }
  if (dependency === 'homeowner_no_sale') {
    return dependencyChoice(loaded, 'OWNS, SALE NOT REQUIRED', 'They own and do not need to sell first. Do not open a listing pitch.');
  }
  if (/phone|call/.test((valueOf(loaded, 'preferred_channel') ?? '').toLowerCase()) && loaded.phone) {
    return {
      buckets: ['calls'],
      fields: {
        human_headline: `CALL ${firstName(loaded.name).toUpperCase()} NOW`,
        current_objective: 'Use the channel they asked for.',
        why_now: 'They prefer a call.',
        primary_action: `Call ${firstName(loaded.name)}. Do not also text the same question.`,
        where: `Phone ${loaded.phone}. Kyle places the call.`,
        action_channel: 'call',
        call_opening: `Hey ${firstName(loaded.name)}, it's Kyle. You asked for a call. What's the one thing you want to handle?`,
        client_draft: null,
        wait_for: 'The point of the call.',
        if_yes_next: 'One next step from what they say.',
        if_no_next: 'Set a time.',
        if_unclear_next: 'Ask them to name the one issue.',
        ask_qualification_now: false,
        owner: 'Kyle',
        follow_up_trigger: 'preferred_phone',
        draft_status: 'DRAFT',
      },
    };
  }
  const timeframe = (loaded.answers.get('timeframe') ?? valueOf(loaded, 'timeframe') ?? '').toLowerCase();
  if (/next year|few months|6 months|six months|not now|later/.test(timeframe) && !tourFacts(loaded, now).address) {
    return {
      buckets: [],
      fields: {
        human_headline: `WAIT ON ${firstName(loaded.name).toUpperCase()}`,
        current_objective: 'Keep the timeline. Do not invent urgency.',
        why_now: `Their timeframe is "${timeframe}". A later plan is not a today emergency.`,
        primary_action: 'Set the follow up for when that timeline gets close. Do not send a drip.',
        where: 'The file. No message goes out today unless they asked for something now.',
        action_channel: 'none',
        client_draft: null,
        wait_for: 'The date they named.',
        if_yes_next: 'Bring the file back then.',
        if_no_next: 'Leave it.',
        if_unclear_next: 'Ask for the month once, not a campaign.',
        ask_qualification_now: false,
        owner: 'Client',
        follow_up_trigger: 'future_timeline',
        follow_up_date: futureFollowUp(now),
        draft_status: 'NONE',
      },
    };
  }
  const question = next?.question ?? 'What should I handle next on this search?';
  const field = next?.field ?? 'motivation';
  let draft: string;
  if (detailed && message) {
    draft = `${firstName(loaded.name)}, I read that. I can answer only what is actually in the file. Anything else is DATA NEEDED and I'll go get it. The one thing I need back is: ${question}`;
  } else if (short && message) {
    draft = `Got it. ${question}`;
  } else if (loaded.email && !loaded.phone) {
    draft = '';
  } else if (valueOf(loaded, 'property_address')) {
    draft = `${firstName(loaded.name)}, Kyle with Redfin. I'm checking on ${streetLine(valueOf(loaded, 'property_address') ?? '')} now. Is that the main one you want to see, or are you open to similar places nearby too?`;
  } else {
    draft = `${firstName(loaded.name)}, Kyle with Redfin. ${question}`;
  }
  draft = spanish(loaded, draft, spanishQuestion(loaded, field, question));
  const email = !loaded.phone && loaded.email ? emailFor(loaded, question) : null;
  return {
    buckets: [email ? 'emails' : 'texts'],
    fields: draftFields(loaded, {
      human_headline: email ? `EMAIL ${firstName(loaded.name).toUpperCase()} NOW` : `TEXT ${firstName(loaded.name).toUpperCase()} NOW`,
      current_objective: `One question: ${field.replaceAll('_', ' ')}.`,
      why_now: loaded.engineReason || 'Intake still has one open question.',
      primary_action: email ? 'Send the email yourself after you approve it. There is no cell on file.' : 'Send one question. Do not ask the whole intake.',
      action_channel: email ? 'email' : 'sms',
      client_draft: email ? null : draft,
      email_subject: email?.subject ?? null,
      email_draft: email?.body ?? null,
      wait_for: 'That one answer.',
      if_yes_next: 'Store it and ask the next single question later.',
      if_no_next: 'Store it and stop stacking questions.',
      if_unclear_next: 'Ask the same question once, shorter.',
      ask_qualification_now: true,
      next_qualification_question: question,
      where: email ? `Email to ${loaded.email}. KyleOS cannot send it.` : (loaded.phone ? `Messages to ${loaded.phone}.` : 'DATA NEEDED'),
    }),
  };
}

function offerChoice(loaded: Loaded, message: string | null, why: string): Choice {
  const known = verifiedValue(loaded, 'offer_price');
  const missing = ['buyer legal names', 'financing or cash', 'deposit', 'inspection terms', 'closing date'].filter((item) => {
    if (item.startsWith('financing') && loaded.financing !== 'UNKNOWN') return false;
    return true;
  });
  return {
    buckets: ['offers'],
    fields: {
      human_headline: `OFFER MODE FOR ${firstName(loaded.name).toUpperCase()}`,
      current_objective: 'Collect missing terms. Do not call a draft submitted.',
      why_now: why,
      primary_action: `READY: ${known ? `price ${known}` : 'no verified price'}. MISSING: ${missing.join(', ')}. NEXT ACTION: ask Kyle for the first missing term. Do not tell the other side an offer is in.`,
      where: 'This file. Kyle writes the offer outside KyleOS.',
      action_channel: 'manual',
      client_draft: null,
      call_opening: message && detectHandoff(message).level >= 4
        ? `Hey ${firstName(loaded.name)}, it's Kyle. You want to make an offer. I'm not sending anything until the terms are real.`
        : null,
      wait_for: 'The first missing term, from Kyle or the buyer.',
      if_yes_next: 'Add that term and show the next gap.',
      if_no_next: 'Leave the offer as a draft.',
      if_unclear_next: 'HUMAN REVIEW REQUIRED.',
      ask_qualification_now: false,
      owner: 'Kyle',
      follow_up_trigger: 'offer_mode',
      customer_property_state: 'Offer requested, not submitted',
      tour_confirmation_state: 'NOT CONFIRMED',
      draft_status: 'DRAFT',
    },
    note: 'Offer draft or request only. Not submitted. Agent Tools was not written.',
  };
}

function transactionFields(loaded: Loaded, title: string, why: string, bucket: string): Choice {
  return {
    buckets: [bucket],
    fields: {
        human_headline: `${title}: ${firstName(loaded.name).toUpperCase()}`,
      current_objective: title,
      why_now: why,
      primary_action: why,
      where: 'The transaction file. KyleOS is not the contract system and not legal counsel.',
      action_channel: 'manual',
      client_draft: null,
      wait_for: 'The verified document or the owner of that milestone.',
      if_yes_next: 'Update only the milestone the document supports.',
      if_no_next: 'Leave the status unknown.',
      if_unclear_next: 'HUMAN REVIEW REQUIRED.',
      ask_qualification_now: false,
      owner: 'Kyle',
      follow_up_trigger: 'transaction',
      draft_status: 'NONE',
      customer_property_state: title,
    },
  };
}

function dependencyChoice(loaded: Loaded, label: string, why: string): Choice {
  const address = verifiedValue(loaded, 'current_home_address');
  return {
    buckets: ['buy_after_sell', label === 'OWNS, SALE NOT REQUIRED' ? '' : 'listing_opportunity'].filter(Boolean),
      fields: draftFields(loaded, {
        human_headline: `${label}: ${firstName(loaded.name).toUpperCase()}`,
        current_objective: why,
        why_now: why,
        primary_action: address ? `The home on file is ${address}. ${why}` : `${why} Ask for the address. DATA NEEDED.`,
        client_draft: label === 'OWNS, SALE NOT REQUIRED'
          ? `${firstName(loaded.name)}, you own and a sale is not required. I won't treat it as a listing.`
          : address
            ? `${firstName(loaded.name)}, I'm keeping ${address} as the home in this purchase. Does the timing on that sale still control the purchase?`
            : `${firstName(loaded.name)}, what is the address of the home that has to be part of this? I won't guess it.`,
      wait_for: address ? 'Whether the dependency is still true.' : 'The address.',
      if_yes_next: 'Keep the seller file linked. Do not pitch a listing they did not ask for.',
      if_no_next: 'Update the dependency from their words.',
      if_unclear_next: 'Ask if a sale has to happen before they buy.',
      ask_qualification_now: false,
      sell_side_dependency: label,
    }),
  };
}

function draftFields(loaded: Loaded, fields: Partial<ExecutionAction>): Partial<ExecutionAction> {
  return {
    where: loaded.phone ? `Messages. New text to ${loaded.phone}. Paste it and send it yourself.` : (loaded.email ? `Email ${loaded.email}. Send it yourself.` : 'DATA NEEDED'),
    action_channel: loaded.phone ? 'sms' : (loaded.email ? 'email' : 'manual'),
    owner: 'Kyle',
    follow_up_trigger: loaded.followUpTrigger || 'intake_answer',
    customer_property_state: 'Unknown',
    tour_confirmation_state: 'NOT CONFIRMED',
    draft_status: 'DRAFT',
    ...fields,
  };
}

function applyChannelBlocks(action: ExecutionAction): void {
  if (action.action_channel === 'sms' && !action.verified_phone) {
    action.draft_status = 'BLOCKED';
    action.blocked_reason = action.blocked_reason ?? 'No verified phone. SMS is blocked.';
    action.summary_buckets.push('missing_contact');
  }
  if (action.action_channel === 'email' && !action.verified_email) {
    action.draft_status = 'BLOCKED';
    action.blocked_reason = action.blocked_reason ?? 'No verified email. Email is blocked.';
    action.summary_buckets.push('missing_contact');
  }
  if (action.action_channel === 'call' && !action.verified_phone) {
    action.blocked_reason = action.blocked_reason ?? 'No verified phone. The call cannot be placed from this file.';
    action.summary_buckets.push('missing_contact');
  }
  if (action.draft_status === 'BLOCKED') {
    action.summary_buckets = action.summary_buckets.filter((bucket) => bucket !== 'texts' && bucket !== 'emails');
    action.summary_buckets.push('missing_contact');
  }
  if (action.listing_agent_draft) action.summary_buckets.push('listing_agent');
  else if (/LISTING AGENT CONTACT PENDING|LISTING AGENT CONTACT NEEDED/.test(`${action.primary_action} ${action.human_headline}`)) {
    action.summary_buckets.push('waiting_listing');
  }
  if (action.owner === 'Client') action.summary_buckets.push('waiting_client');
  action.summary_buckets = [...new Set(action.summary_buckets)];
}

function storeDraft(db: SqlDb, action: ExecutionAction, now: Date): string | null {
  if (action.draft_status === 'NONE' || action.action_channel === 'none') {
    db.run(
      `UPDATE approval_queue SET status = 'CANCELLED', updated_at = ?
       WHERE opportunity_id = ? AND source = 'execution_desk' AND status = 'PENDING'`,
      now.toISOString(),
      action.opportunityId,
    );
    return null;
  }
  const content = action.action_channel === 'email'
    ? `${action.email_subject ?? ''}\n${action.email_draft ?? ''}`
    : action.action_channel === 'call'
      ? (action.call_opening ?? action.primary_action)
      : action.draft_status === 'BLOCKED'
        ? `${action.human_headline}\n${action.primary_action}\nBLOCKED COPY, DO NOT SEND:\n${action.client_draft ?? ''}`
        : (action.client_draft ?? action.primary_action);
  const screened = screenNextAction(content);
  if (!screened.allowed) {
    action.blocked_reason = screened.reason;
    action.draft_status = 'BLOCKED';
    return null;
  }
  db.run(
    `UPDATE approval_queue SET status = 'CANCELLED', updated_at = ?
     WHERE opportunity_id = ? AND source = 'execution_desk' AND status = 'PENDING' AND draft_content != ?`,
    now.toISOString(),
    action.opportunityId,
    content,
  );
  const actionType = `human_${action.action_channel}`;
  const channel = action.action_channel === 'email' ? 'email' : action.action_channel === 'call' ? 'voice' : action.action_channel === 'sms' ? 'sms' : 'manual';
  const dedupe = `${action.opportunityId}|${actionType}|${channel}|${content.trim()}`;
  const held = db.get(`SELECT id, status FROM approval_queue WHERE dedupe_key = ?`, dedupe);
  if (held) {
    const heldStatus = text(held, 'status');
    if (heldStatus === 'CANCELLED') {
      db.run(
        `UPDATE approval_queue SET status = 'PENDING', updated_at = ? WHERE id = ?`,
        now.toISOString(),
        text(held, 'id'),
      );
    }
    if (heldStatus === 'PENDING' || heldStatus === 'CANCELLED') {
      action.approval_required = true;
      action.sent = false;
      action.provider_confirmed = false;
      return text(held, 'id');
    }
  }
  const queued = enqueueApproval(db, {
    opportunityId: action.opportunityId,
    clientId: action.clientId,
    actionType: `human_${action.action_channel}`,
    channel: action.action_channel === 'email' ? 'email' : action.action_channel === 'call' ? 'voice' : action.action_channel === 'sms' ? 'sms' : 'manual',
    draftContent: content,
    reason: 'Draft only. Kyle sends this outside KyleOS. Nothing was sent.',
    riskLevel: 'standard',
    source: 'execution_desk',
    createdBy: 'system',
    now,
  });
  action.approval_required = true;
  action.sent = false;
  action.provider_confirmed = false;
  return queued.id || null;
}

function blank(loaded: Loaded, now: Date): ExecutionAction {
  const tour = tourFacts(loaded, now);
  const status = baseStatus(loaded);
  const conflicts = conflictsOf(loaded);
  const phone = loaded.phone ? formatPhone(loaded.phone) ?? loaded.phone : null;
  const verifiedFacts = loaded.facts.filter((fact) => fact.kind === 'fact' && fact.verification === 'verified').map((fact) => `${fact.field}: ${fact.value}`);
  const unknowns = unknownLines(loaded, tour);
  for (const flag of loaded.flags) unknowns.push(`POSSIBLE DUPLICATE CLIENT. ${flag}`);
  if (loaded.facts.some((fact) => fact.field === 'gmail_draft' && /unsent|not sent/i.test(fact.value))) {
    unknowns.push('An email draft exists and is unsent. That is not prior contact.');
  }
  if (loaded.facts.some((fact) => /coordinator/i.test(`${fact.field} ${fact.value}`))) {
    unknowns.push('Coordinator or showing-agent contact is not Kyle contact.');
  }
  const comp = verifiedValue(loaded, 'buyer_agreement_compensation');
  if (comp) verifiedFacts.push(`Buyer agreement compensation: ${comp}. Do not say the seller pays the commission.`);
  else unknowns.push('COMPENSATION NEEDS VERIFICATION. Do not tell the buyer the seller pays.');
  if (/incomplete|missing/i.test(valueOf(loaded, 'buyer_agreement') ?? '')) {
    unknowns.push('FLAG IT BEFORE THE TOUR. The buyer agreement is not complete.');
  }
  const leadSources = loaded.facts.filter((fact) => fact.field === 'lead_source' || fact.field === 'lead_source_conflict').map((fact) => `${fact.verification} ${fact.value}`);
  return {
    priority: null,
    opportunityId: loaded.opportunityId,
    clientId: loaded.clientId,
    client_name: loaded.name,
    isDemo: loaded.isDemo,
    held: loaded.held,
    engineScore: loaded.engineScore,
    hotScore: numberFact(loaded, 'hot_score'),
    dueAt: loaded.dueAt,
    internal_action_type: loaded.held ? 'pending_enrichment' : (loaded.engineType || 'none'),
    client_stage: loaded.stage || 'NEW_INQUIRY',
    current_objective: '',
    why_now: '',
    verified_phone: phone,
    verified_email: loaded.email,
    preferred_channel: valueOf(loaded, 'preferred_channel') ?? (phone ? 'sms' : loaded.email ? 'email' : 'unknown'),
    language: valueOf(loaded, 'language') ?? 'English',
    property_address: tour.address,
    property_address_verified: tour.addressVerified,
    property_mls: verifiedValue(loaded, 'property_mls'),
    property_price: verifiedValue(loaded, 'property_price'),
    price_note: valueOf(loaded, 'price_note'),
    property_redfin_url: verifiedUrl(loaded, 'redfin_url'),
    agent_tools_url: verifiedUrl(loaded, 'agent_tools_url'),
    mls_url: verifiedUrl(loaded, 'mls_url'),
    property_status: status,
    customer_property_state: 'Unknown',
    tour_date_time: tour.label,
    tour_owner: tour.agent,
    tour_confirmation_state: 'NOT CONFIRMED',
    listing_agent_name: verifiedValue(loaded, 'listing_agent_name'),
    listing_agent_brokerage: verifiedValue(loaded, 'listing_agent_brokerage'),
    listing_agent_phone: verifiedPhoneFact(loaded, 'listing_agent_phone'),
    listing_agent_email: verifiedValue(loaded, 'listing_agent_email'),
    listing_agent_source: verifiedValue(loaded, 'listing_agent_source'),
    repeat_property_request: valueOf(loaded, 'repeat_property_request'),
    buyer_type: loaded.classes.find((row) => row.axis === 'occupancy')?.value ?? 'Unknown',
    occupancy_type: loaded.answers.get('occupancy') ?? loaded.classes.find((row) => row.axis === 'occupancy')?.value ?? 'Unknown',
    funding_type: fundingLabel(loaded),
    preapproval_state: preapprovalLabel(loaded),
    sell_side_dependency: sellLabel(loaded),
    human_headline: '',
    primary_action: '',
    where: '',
    action_channel: 'manual',
    client_draft: null,
    listing_agent_draft: null,
    email_subject: null,
    email_draft: null,
    call_opening: null,
    wait_for: '',
    if_yes_next: '',
    if_no_next: '',
    if_unclear_next: '',
    qualification_known: knownQualification(loaded),
    qualification_missing: missingQualification(loaded),
    next_qualification_question: nextMissing(loaded)?.question ?? null,
    ask_qualification_now: false,
    agent_tools_note_draft: '',
    follow_up_trigger: loaded.followUpTrigger || 'intake_answer',
    follow_up_date: null,
    owner: 'Kyle',
    blocked_reason: null,
    conflicts,
    unknowns,
    verified_facts: verifiedFacts,
    source_provenance: loaded.facts.map((fact) => `${fact.field} ${fact.kind}/${fact.verification} ${fact.source} observed ${fact.observedAt}`),
    manual_action_required: true,
    approval_required: true,
    draft_status: 'DRAFT',
    sent: false,
    provider_confirmed: false,
    lead_source: leadSources[0] ?? 'Unknown',
    lead_source_history: leadSources,
    summary_buckets: [],
    manual_marks: loaded.priorMarks,
    approval_id: null,
    priority_tier: 'T2',
    horizon: 'short',
    waiting_on: null,
    waiting_reason: null,
    waiting_next_check: null,
    execution_adapter: 'none',
    execution_steps: '',
    call_href: null,
    evidence_label: 'NONE',
    workflow_drift: false,
    promise: null,
  };
}

function loadOne(db: SqlDb, opportunityId: string, now: Date): Loaded {
  const opp = db.get(`SELECT * FROM opportunities WHERE id = ?`, opportunityId);
  if (!opp) throw new Error('Opportunity not found.');
  const clientId = text(opp, 'client_id');
  const client = db.get(`SELECT * FROM clients WHERE id = ?`, clientId);
  const noAction = text(opp, 'no_action_reason');
  const held = noAction === 'PENDING_ENRICHMENT' || noAction === 'NEEDS_REVIEW';
  const dnc = noAction === 'DO_NOT_CONTACT' || text(opp, 'primary_stage') === 'DO_NOT_CONTACT' || isOpportunityDoNotContact(db, opportunityId);
  if (!held && !dnc) nextBestAction(db, opportunityId, now);
  const nba = db.get(`SELECT * FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 1`, opportunityId);
  const phoneRow = db.get(`SELECT raw_value FROM client_identifiers WHERE client_id = ? AND kind = 'phone'`, clientId);
  const emailRow = db.get(`SELECT raw_value FROM client_identifiers WHERE client_id = ? AND kind = 'email'`, clientId);
  const facts = db.all(`SELECT * FROM client_facts WHERE client_id = ?`, clientId).map((row) => ({
    field: text(row, 'field_key'),
    value: text(row, 'value'),
    kind: text(row, 'kind'),
    verification: text(row, 'verification'),
    source: text(row, 'source'),
    observedAt: text(row, 'observed_at'),
  }));
  for (const row of db.all(
    `SELECT after_json, at FROM audit_log WHERE action = 'fact_inference_rejected' AND entity_type = 'client_fact' AND entity_id = ? ORDER BY at`,
    clientId,
  )) {
    let after: { fieldKey?: string; rejectedValue?: string } = {};
    try {
      after = JSON.parse(text(row, 'after_json')) as { fieldKey?: string; rejectedValue?: string };
    } catch {
      continue;
    }
    if (!after.fieldKey || !after.rejectedValue) continue;
    const already = facts.some((fact) => fact.field === after.fieldKey && fact.value === after.rejectedValue);
    if (already) continue;
    facts.push({
      field: after.fieldKey,
      value: after.rejectedValue,
      kind: 'inference',
      verification: 'unverified',
      source: 'fact_inference_rejected',
      observedAt: text(row, 'at'),
    });
  }
  const answers = new Map<string, string>();
  for (const row of db.all(`SELECT field_key, value, status FROM intake_answers WHERE opportunity_id = ?`, opportunityId)) {
    if (text(row, 'status') === 'known' || text(row, 'status') === 'not_applicable') answers.set(text(row, 'field_key'), text(row, 'value'));
  }
  const classes = db.all(`SELECT axis, value FROM buyer_classifications WHERE opportunity_id = ?`, opportunityId).map((row) => ({
    axis: text(row, 'axis'),
    value: text(row, 'value'),
  }));
  const flags = db.all(
    `SELECT reason FROM identity_flags WHERE client_id = ? OR other_client_id = ?`,
    clientId,
    clientId,
  ).map((row) => text(row, 'reason'));
  const handoff = db.get(`SELECT reason, level FROM handoff_cards WHERE opportunity_id = ? ORDER BY created_at DESC`, opportunityId);
  const existing = db.get(`SELECT payload_json, manual_status FROM execution_actions WHERE opportunity_id = ?`, opportunityId);
  let priorMarks: ManualMark[] = [];
  if (existing) {
    try {
      const parsed = JSON.parse(text(existing, 'payload_json')) as ExecutionAction;
      priorMarks = parsed.manual_marks ?? [];
    } catch {
      priorMarks = [];
    }
  }
  return {
    opportunityId,
    clientId,
    name: text(client, 'display_name') || 'Unknown client',
    isDemo: Number(client?.is_demo ?? 0) === 1,
    stage: text(opp, 'primary_stage') || 'NEW_INQUIRY',
    financing: text(opp, 'financing_state') || 'UNKNOWN',
    sellerStage: text(opp, 'seller_stage'),
    noAction,
    held,
    dnc,
    dueAt: text(opp, 'next_action_due_at') || null,
    followUpTrigger: text(opp, 'follow_up_trigger'),
    engineType: nba ? text(nba, 'action_type') : '',
    engineReason: nba ? text(nba, 'reason') : text(opp, 'next_action'),
    engineScore: nba ? Number(nba.priority_score) : null,
    phone: phoneRow ? text(phoneRow, 'raw_value') : null,
    email: emailRow ? text(emailRow, 'raw_value') : null,
    facts,
    answers,
    classes,
    flags,
    handoffReason: handoff ? text(handoff, 'reason') : '',
    handoffLevel: handoff ? Number(handoff.level) : 0,
    priorMarks,
    manualStatus: existing ? text(existing, 'manual_status') : 'draft',
  };
}

function rankCards(cards: ExecutionAction[]): ExecutionAction[] {
  const tiers = ['T0', 'T1', 'T2', 'T3'] as const;
  return tiers.flatMap((tier) => {
    const group = cards.filter((card) => card.priority_tier === tier);
    const byUrgency = new Map<number, ExecutionAction[]>();
    for (const card of group) {
      const key = urgency(card);
      byUrgency.set(key, [...(byUrgency.get(key) ?? []), card]);
    }
    return [...byUrgency.keys()].sort((a, b) => a - b).flatMap((key) => splitScore(byUrgency.get(key) ?? []));
  });
}

function urgency(card: ExecutionAction): number {
  if (card.waiting_on === 'KYLE' || card.promise) return 0;
  if (card.summary_buckets.includes('showings_today')) return 1;
  if (card.summary_buckets.includes('post_tour')) return 2;
  return 3;
}

function splitScore(cards: ExecutionAction[]): ExecutionAction[] {
  const scored = cards.filter((card) => !card.held && card.engineScore != null);
  const held = cards.filter((card) => card.held || card.engineScore == null);
  scored.sort((a, b) => {
    const score = (b.engineScore ?? 0) - (a.engineScore ?? 0);
    if (score) return score;
    const due = (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999');
    if (due) return due;
    return (b.hotScore ?? -1) - (a.hotScore ?? -1);
  });
  held.sort((a, b) => (b.hotScore ?? -1) - (a.hotScore ?? -1) || a.client_name.localeCompare(b.client_name));
  return [...scored, ...held];
}

interface TourView {
  address: string | null;
  addressVerified: boolean;
  label: string | null;
  weekday: string | null;
  past: boolean;
  scheduled: boolean;
  outcomeKnown: boolean;
  agent: string | null;
  rawWhen: string | null;
}

function tourFacts(loaded: Loaded, now: Date): TourView {
  const addressRow = pick(loaded, 'property_address');
  const when = valueOf(loaded, 'tour_datetime');
  const instant = when ? appointmentInstant(when, now) : null;
  const hasTime = Boolean(when && /\d:\d\d|\d\s*(am|pm)/i.test(when));
  const outcome = (valueOf(loaded, 'tour_outcome') ?? '').toLowerCase();
  const outcomeKnown = /confirmed complete|completed with kyle|buyer attended/.test(outcome);
  const past = Boolean(instant && instant.getTime() < now.getTime());
  const agent = valueOf(loaded, 'showing_agent');
  let label: string | null = null;
  let weekday: string | null = null;
  if (instant) {
    weekday = weekdayLong(instant);
    const parts = zonedParts(instant);
    const hour12 = parts.hour % 12 || 12;
    const suffix = parts.hour >= 12 ? 'PM' : 'AM';
    const clock = hasTime ? `${hour12}:${String(parts.minute).padStart(2, '0')} ${suffix}` : '';
    label = `${weekday} ${parts.month}/${parts.day}${clock ? ` ${clock}` : ''}`.trim();
  }
  return {
    address: addressRow?.value ?? null,
    addressVerified: Boolean(addressRow && addressRow.kind === 'fact' && addressRow.verification === 'verified'),
    label,
    weekday,
    past,
    scheduled: Boolean(when) || loaded.engineType === 'confirm_tour_details',
    outcomeKnown,
    agent,
    rawWhen: when,
  };
}

function listingDraft(loaded: Loaded, address: string | null): string | null {
  const name = verifiedValue(loaded, 'listing_agent_name');
  const phone = verifiedPhoneFact(loaded, 'listing_agent_phone');
  if (!name || !phone) return null;
  const place = address ? streetLine(address) : 'the property';
  return `Hi ${name}, Kyle Kleinman with Redfin. I have a buyer looking to see ${place}. Are we good for the time they asked? Text ${phone}.`;
}

function pick(loaded: Loaded, key: string): FactRow | null {
  const rows = loaded.facts.filter((fact) => fact.field === key);
  return rows.find((fact) => fact.kind === 'fact' && fact.verification === 'verified')
    ?? rows.find((fact) => fact.verification === 'verified')
    ?? rows[0]
    ?? null;
}

function valueOf(loaded: Loaded, key: string): string | null {
  return pick(loaded, key)?.value ?? null;
}

function verifiedValue(loaded: Loaded, key: string): string | null {
  const row = loaded.facts.find((fact) => fact.field === key && fact.kind === 'fact' && fact.verification === 'verified');
  return row?.value ?? null;
}

function verifiedUrl(loaded: Loaded, key: string): string | null {
  const raw = verifiedValue(loaded, key);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function verifiedPhoneFact(loaded: Loaded, key: string): string | null {
  const raw = verifiedValue(loaded, key);
  if (!raw) return null;
  return formatPhone(raw);
}

function numberFact(loaded: Loaded, key: string): number | null {
  const raw = verifiedValue(loaded, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function baseStatus(loaded: Loaded): string {
  return verifiedValue(loaded, 'property_status') ?? 'Unknown';
}

function conflictsOf(loaded: Loaded): string[] {
  const conflicts: string[] = [];
  const status = verifiedValue(loaded, 'property_status');
  const other = verifiedValue(loaded, 'property_status_conflict');
  if (status && other && status.trim().toLowerCase() !== other.trim().toLowerCase()) {
    const a = loaded.facts.find((fact) => fact.field === 'property_status');
    const b = loaded.facts.find((fact) => fact.field === 'property_status_conflict');
    conflicts.push(`Property status. Source A: ${status} (${a?.observedAt ?? 'date unknown'}). Source B: ${other} (${b?.observedAt ?? 'date unknown'}). Verify before stating the current status.`);
  }
  const lead = verifiedValue(loaded, 'lead_source');
  const leadOther = verifiedValue(loaded, 'lead_source_conflict');
  if (lead && leadOther && lead.trim().toLowerCase() !== leadOther.trim().toLowerCase()) {
    conflicts.push(`SOURCE ATTRIBUTION CONFLICT. ${lead} versus ${leadOther}. Do not overwrite the history.`);
  }
  const stale = loaded.facts.find((fact) => fact.field === 'property_status' && fact.verification === 'unverified');
  if (stale && status) conflicts.push(`STALE OR UNVERIFIED STATUS NOTE: ${stale.value}. It does not replace the verified status.`);
  return conflicts;
}

function unknownLines(loaded: Loaded, tour: TourView): string[] {
  const lines: string[] = [];
  if (!loaded.phone) lines.push('Verified phone. RETRIEVE FROM: Agent Tools or Redfin. LOOK FOR: cell.');
  if (!loaded.email) lines.push('Verified email address.');
  if (!tour.address) lines.push('Property address.');
  if (!verifiedValue(loaded, 'property_mls')) lines.push('MLS number.');
  if (!verifiedValue(loaded, 'property_price')) lines.push('Current list price.');
  if (!tour.outcomeKnown && tour.label) lines.push('Showing outcome.');
  if (!verifiedValue(loaded, 'listing_agent_phone')) lines.push('Listing agent phone.');
  if (valueOf(loaded, 'referral_source')) {
    lines.push(`Referral reporting may be required for ${valueOf(loaded, 'referral_source')}. Report verified facts only. Do not invent contact attempts.`);
  }
  return lines;
}

function knownQualification(loaded: Loaded): string[] {
  const known: string[] = [];
  for (const field of INTAKE_ORDER) {
    if (loaded.answers.has(field)) known.push(`${field}: ${loaded.answers.get(field)}`);
  }
  return known;
}

function missingQualification(loaded: Loaded): string[] {
  return INTAKE_ORDER.filter((field) => !loaded.answers.has(field));
}

function nextMissing(loaded: Loaded): { field: IntakeField; question: string } | null {
  for (const field of INTAKE_ORDER) {
    if (!loaded.answers.has(field)) return { field, question: QUESTIONS[field] };
  }
  return null;
}

function fundingLabel(loaded: Loaded): string {
  if (loaded.financing === 'CASH' || /cash/.test((loaded.answers.get('cash_vs_finance') ?? '').toLowerCase())) return 'Cash';
  const tag = loaded.facts.find((fact) => fact.field === 'cash_tag');
  if (tag) return 'Unknown. An Agent Tools cash tag exists and is not a buyer confirmation.';
  if (/finance/.test((loaded.answers.get('cash_vs_finance') ?? '').toLowerCase())) return 'Financing';
  return loaded.financing === 'UNKNOWN' ? 'Unknown' : loaded.financing;
}

function preapprovalLabel(loaded: Loaded): string {
  const value = (loaded.answers.get('preapproval') ?? '').toLowerCase();
  if (loaded.financing === 'CASH') return 'Not applicable';
  if (/approved|preapproved/.test(value)) return 'Preapproved';
  if (/not yet|no|need/.test(value)) return 'Needs preapproval';
  return 'Unknown';
}

function sellLabel(loaded: Loaded): string {
  const dependency = loaded.classes.find((row) => row.axis === 'dependency')?.value;
  if (dependency === 'sale_required') return 'SALE REQUIRED';
  if (dependency === 'proceeds_required') return 'PROCEEDS REQUIRED';
  if (dependency === 'homeowner_no_sale') return 'SALE NOT REQUIRED';
  const tag = valueOf(loaded, 'sell_side');
  if (tag) return `Agent Tools tag, not a recent statement: ${tag}`;
  return 'Unknown';
}

function firstName(name: string): string {
  const cleaned = name.split('&')[0]?.trim() || name;
  return cleaned.split(/\s+/)[0] || name;
}

function streetLine(address: string): string {
  return address.split('#')[0]?.trim().replace(/,\s*$/, '') || address;
}

function spanish(loaded: Loaded, english: string, spanishCopy: string): string {
  return /spanish|^es\b/i.test(valueOf(loaded, 'language') ?? '') ? spanishCopy : english;
}

function spanishQuestion(loaded: Loaded, field: string, question: string): string {
  const name = firstName(loaded.name);
  if (field === 'motivation') return `${name}, que te esta empujando a moverte?`;
  if (field === 'area') return `${name}, en que zonas quieres buscar?`;
  if (valueOf(loaded, 'property_address')) {
    return `${name}, soy Kyle de Redfin. Estoy revisando ${streetLine(valueOf(loaded, 'property_address') ?? '')}. Es la principal que quieres ver, o miramos opciones cerca tambien?`;
  }
  return `${name}, ${question}`;
}

function shortCopy(loaded: Loaded, body: string): string {
  return spanish(loaded, body, body);
}

function callOpening(loaded: Loaded, message: string | null): string {
  const property = valueOf(loaded, 'property_address');
  if (property) return `Hey ${firstName(loaded.name)}, it's Kyle. I wanted to grab you for a minute about ${streetLine(property)}.`;
  if (message && /call/i.test(message)) return `Hey ${firstName(loaded.name)}, it's Kyle. You asked me to call. What's going on?`;
  return `Hey ${firstName(loaded.name)}, it's Kyle.`;
}

function emailFor(loaded: Loaded, question: string): { subject: string; body: string } {
  const search = valueOf(loaded, 'saved_search') ?? '';
  const area = search.match(/\b\d{5}\b/)?.[0] ?? '';
  const subject = area ? `Your ${area} search` : 'Your search';
  const hint = area ? `I see you're still saving houses in ${area}${/hoa/i.test(search) ? ' with no HOA' : ''}. ` : '';
  const body = [
    `Hi ${firstName(loaded.name)},`,
    '',
    `Kyle with Redfin. ${hint}Before I send you anything else, ${question.charAt(0).toLowerCase()}${question.slice(1)}`,
    '',
    'Kyle Kleinman',
    'Redfin, Miami-Dade and Broward',
    KYLE_PHONE,
  ].join('\n');
  return { subject, body };
}

function defaultNote(action: ExecutionAction, now: Date): string {
  return [
    `${shortDate(now)} note drafted for Agent Tools. Not written.`,
    `Client: ${action.client_name}.`,
    `Next step prepared: ${action.human_headline}.`,
    'Kyle was not recorded as having called or texted.',
    'Nothing was sent. Agent Tools was not updated.',
  ].join(' ');
}

function cleanCopy(value: string): string {
  return value.replace(/[—–]/g, ', ').replace(/[ \t]{2,}/g, ' ').trim();
}

function isStop(message: string): boolean {
  return isChannelOptOut(message) || /\b(do not contact|don't contact|stop contacting)\b/i.test(message);
}

function shortDate(now: Date): string {
  const parts = zonedParts(now);
  return `${parts.month}/${parts.day}`;
}

function shortWhen(raw: string, now: Date): string {
  const instant = appointmentInstant(raw, now);
  if (!instant) return raw;
  const parts = zonedParts(instant);
  if (!sourceHasClock(raw)) return `${parts.month}/${parts.day}`;
  const hour12 = parts.hour % 12 || 12;
  const suffix = parts.hour >= 12 ? 'PM' : 'AM';
  const clock = parts.minute === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(parts.minute).padStart(2, '0')} ${suffix}`;
  return `${parts.month}/${parts.day} ${clock}`;
}

function sourceHasClock(raw: string): boolean {
  if (/\b20\d{2}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(raw)) return true;
  if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(raw)) return true;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*20\d{2})?\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(raw)) return true;
  return false;
}

function nextDayNoon(now: Date): string {
  const parts = zonedParts(now);
  const tomorrow = zonedLocalToUtc(parts.year, parts.month, parts.day + 1, 12, 0);
  return tomorrow.toISOString();
}

function sameDayEvening(now: Date): string {
  const parts = zonedParts(now);
  const evening = zonedLocalToUtc(parts.year, parts.month, parts.day, 17, 0);
  if (evening.getTime() <= now.getTime()) return nextDayNoon(now);
  return evening.toISOString();
}

function futureFollowUp(now: Date): string {
  const parts = zonedParts(now);
  return zonedLocalToUtc(parts.year, parts.month, parts.day + 30, 9, 0).toISOString();
}

function applyOperations(loaded: Loaded, action: ExecutionAction, now: Date): void {
  const promiseRaw = valueOf(loaded, 'kyle_promise');
  const promiseOpen = Boolean(promiseRaw && !/kept|done|completed/i.test(promiseRaw));
  action.promise = promiseOpen ? promiseRaw : null;
  action.evidence_label = 'NONE';
  action.workflow_drift = false;
  action.waiting_on = null;
  action.waiting_reason = null;
  action.waiting_next_check = null;
  action.call_href = null;

  const verifiedDelivery = loaded.facts.find((fact) => fact.field === 'provider_delivery' && fact.kind === 'fact' && fact.verification === 'verified');
  const last = loaded.priorMarks.at(-1);
  if (verifiedDelivery) {
    action.evidence_label = 'VERIFIED BY INTEGRATION';
  } else if (last) {
    action.evidence_label = 'MARKED BY KYLE';
    const follow = outcomeFollowUp(loaded, last, now);
    if (follow) {
      Object.assign(action, follow.fields);
      action.summary_buckets = [...new Set([
        ...action.summary_buckets.filter((bucket) => bucket !== 'texts' && bucket !== 'emails' && bucket !== 'calls'),
        ...follow.buckets,
      ])];
      if (follow.note) action.agent_tools_note_draft = follow.note;
      if (action.client_draft) action.client_draft = cleanCopy(action.client_draft);
    }
  }

  if (promiseOpen && !action.human_headline.startsWith('DO NOT') && action.evidence_label !== 'MARKED BY KYLE') {
    action.waiting_on = 'KYLE';
    action.waiting_reason = promiseRaw;
    action.summary_buckets.push('promises', 'waiting_kyle');
    action.why_now = `Kyle promised: ${promiseRaw}. A client waiting on Kyle comes before a passive lead. ${action.why_now}`.trim();
    if (action.internal_action_type === 'ask_next_question') {
      action.human_headline = `KEEP THE PROMISE TO ${firstName(loaded.name).toUpperCase()}`;
      action.primary_action = `${promiseRaw} Do not send a different question first.`;
      action.current_objective = 'Do the thing Kyle already promised.';
      action.action_channel = loaded.phone ? 'sms' : 'manual';
      action.client_draft = loaded.phone ? `${firstName(loaded.name)}, Kyle with Redfin. ${promiseRaw}` : null;
      action.draft_status = loaded.phone ? 'DRAFT' : 'BLOCKED';
    }
  }

  const tour = tourFacts(loaded, now);
  const tourInstant = tour.rawWhen ? appointmentInstant(tour.rawWhen, now) : null;
  if (tour.scheduled && !tour.past && tourInstant && sameEtDay(tourInstant, now)) {
    action.summary_buckets.push('showings_today');
  }
  action.priority_tier = tierFor(action, tour, now);
  action.horizon = action.priority_tier === 'T1' ? 'mid' : action.priority_tier === 'T3' ? 'long' : 'short';
  action.execution_adapter = adapterFor(action);
  action.execution_steps = stepsFor(action);
  if (action.action_channel === 'call' && action.verified_phone) {
    const key = phoneKey(action.verified_phone);
    action.call_href = key ? `tel:+1${key}` : null;
  }
  const knownAction = /^(TEXT|CALL|EMAIL|GET|CMA|KEEP|WAIT|READ|DO NOT|OFFER|CALENDAR|CLOSED|NO NEXT|VERIFY|CREATE)/.test(action.human_headline);
  const hasCopy = Boolean(action.client_draft || action.email_draft || action.call_opening);
  const hasTrigger = Boolean(action.follow_up_date || action.waiting_on);
  const hasInstruction = action.human_headline.trim().length > 0 && action.primary_action.trim().length > 0;
  const noNextStep = action.human_headline.trim().length === 0 || (!knownAction && !hasCopy && !hasTrigger && !hasInstruction);
  if (noNextStep) {
    action.workflow_drift = true;
    action.summary_buckets.push('workflow_drift');
    action.human_headline = `NO NEXT STEP FOR ${firstName(loaded.name).toUpperCase()}`;
    action.primary_action = 'This file has no next action, waiting condition, or future trigger. Retrieve the next real step from Agent Tools before it goes quiet.';
    action.action_channel = 'manual';
    action.client_draft = null;
    action.draft_status = 'BLOCKED';
  }
  action.summary_buckets = [...new Set(action.summary_buckets)];
  action.sent = false;
  action.provider_confirmed = false;
}

function outcomeFollowUp(loaded: Loaded, last: ManualMark, now: Date): Choice | null {
  const name = firstName(loaded.name);
  const ageMs = now.getTime() - new Date(last.at).getTime();
  const stale = ageMs > 24 * 60 * 60 * 1000;
  if (last.mark === 'sent' || last.mark === 'waiting' || last.mark === 'called' || last.mark === 'no_reply') {
    if (!stale && last.mark !== 'no_reply') {
      return {
        buckets: ['waiting_client'],
        fields: {
          human_headline: `WAIT ON ${name.toUpperCase()}`,
          current_objective: 'The last outreach is marked sent by Kyle. Do not send it again.',
          why_now: 'MARKED BY KYLE. No integration verified delivery. Wait for a reply before another message.',
          primary_action: 'Do not resend the same text. Wait for their answer.',
          action_channel: 'none',
          client_draft: null,
          email_draft: null,
          call_opening: null,
          draft_status: 'NONE',
          waiting_on: 'CLIENT',
          waiting_reason: 'Reply to the message Kyle marked sent.',
          waiting_next_check: nextDayNoon(now),
          follow_up_trigger: 'waiting_on_client',
          follow_up_date: nextDayNoon(now),
          owner: 'Client',
          ask_qualification_now: false,
        },
        note: 'Kyle marked a send. The note is not pasted into Agent Tools from this mark. Delivery is not verified.',
      };
    }
    return {
      buckets: ['overdue', 'waiting_client'],
      fields: {
        human_headline: `TEXT ${name.toUpperCase()} NOW`,
        current_objective: 'One follow-up with a reason. Not a resend.',
        why_now: 'The earlier mark is more than a day old and no reply is on file. MARKED BY KYLE, not verified by an integration.',
        primary_action: 'Send one new question about the open outcome. Do not paste the old text again.',
        action_channel: loaded.phone ? 'sms' : 'manual',
        client_draft: loaded.phone ? `${name}, still need one answer on that last note. What happened?` : null,
        draft_status: loaded.phone ? 'DRAFT' : 'BLOCKED',
        follow_up_trigger: 'no_reply',
        follow_up_date: sameDayEvening(now),
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'showing_completed' || last.mark === 'showing_occurred') {
    return {
      buckets: ['post_tour', 'texts'],
      fields: {
        human_headline: `TEXT ${name.toUpperCase()} NOW`,
        current_objective: 'Ask what they thought. Attendance is Kyle-reported, not verified.',
        why_now: 'MARKED BY KYLE. That is not proof the client attended and not a provider confirmation.',
        primary_action: 'Ask what they thought once they got inside. Do not mark the tour completed in Agent Tools yet.',
        client_draft: `${name}, what did you think once you got inside?`,
        action_channel: loaded.phone ? 'sms' : 'manual',
        draft_status: loaded.phone ? 'DRAFT' : 'BLOCKED',
        tour_confirmation_state: 'NOT CONFIRMED. KYLE REPORTED, NOT VERIFIED',
        customer_property_state: 'Kyle reported attendance. Not verified.',
        ask_qualification_now: false,
        follow_up_trigger: 'post_tour_reaction',
      },
    };
  }
  if (last.mark === 'showing_did_not_occur' || last.mark === 'showing_cancelled') {
    return {
      buckets: ['texts'],
      fields: {
        human_headline: `TEXT ${name.toUpperCase()} NOW`,
        why_now: 'Kyle reported the showing did not happen. That is not a listing-side confirmation.',
        primary_action: 'Ask if they still want to see it. Then verify access before booking another time.',
        client_draft: `${name}, that showing did not happen on my side. Do you still want to see it?`,
        action_channel: loaded.phone ? 'sms' : 'manual',
        draft_status: loaded.phone ? 'DRAFT' : 'BLOCKED',
        tour_confirmation_state: 'NOT CONFIRMED. KYLE REPORTED, NOT VERIFIED',
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'client_replied') {
    return {
      buckets: ['waiting_client'],
      fields: {
        human_headline: `READ ${name.toUpperCase()}'S REPLY`,
        why_now: 'Kyle marked a reply. The words are not in the file yet.',
        primary_action: 'Paste what they actually said before choosing the next question. Do not invent the reply.',
        action_channel: 'manual',
        client_draft: null,
        draft_status: 'BLOCKED',
        waiting_on: 'KYLE',
        waiting_reason: 'The reply text is not stored.',
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'wants_offer') {
    return {
      buckets: ['offers'],
      fields: {
        human_headline: `OFFER MODE FOR ${name.toUpperCase()}`,
        why_now: 'Kyle marked offer interest. Interest is not a submitted offer.',
        primary_action: 'Collect the first missing term. Do not tell anyone an offer is in.',
        action_channel: 'manual',
        client_draft: null,
        draft_status: 'DRAFT',
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'needs_financing') {
    return {
      buckets: ['financing'],
      fields: {
        human_headline: `TEXT ${name.toUpperCase()} NOW`,
        why_now: 'Kyle marked a financing need. That is not a preapproval.',
        primary_action: 'Offer a lender intro. Do not treat them as disqualified.',
        client_draft: `${name}, no problem. I can get you connected with someone and get that piece handled. Want me to make the intro?`,
        action_channel: loaded.phone ? 'sms' : 'manual',
        draft_status: loaded.phone ? 'DRAFT' : 'BLOCKED',
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'needs_to_sell' || last.mark === 'listing_appointment_set') {
    return {
      buckets: ['cma', 'buy_after_sell'],
      fields: {
        human_headline: `CMA NEEDED FOR ${name.toUpperCase()}`,
        why_now: 'Kyle marked a sell-side need. The address still has to be verified.',
        primary_action: 'Get the current home address before any CMA. Do not assume the house.',
        action_channel: 'manual',
        client_draft: null,
        draft_status: 'BLOCKED',
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'contact_found') {
    return {
      buckets: ['missing_contact'],
      fields: {
        human_headline: `VERIFY ${name.toUpperCase()}'S CELL`,
        why_now: 'Kyle marked a contact as found. It is not a verified phone until it is stored on the client.',
        primary_action: 'Add the verified phone or email to the client record. Do not text a number that is only in your head.',
        action_channel: 'manual',
        client_draft: null,
        draft_status: 'BLOCKED',
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'property_unavailable' || last.mark === 'not_interested') {
    return {
      buckets: ['texts'],
      fields: {
        human_headline: `TEXT ${name.toUpperCase()} NOW`,
        why_now: last.mark === 'property_unavailable' ? 'Kyle marked the property unavailable. The client is not dead.' : 'Kyle marked not interested. Ask what missed before sending other homes.',
        primary_action: 'One question about what they wanted. Do not send a list.',
        client_draft: `${name}, what was it about that place that caught your eye?`,
        action_channel: loaded.phone ? 'sms' : 'manual',
        draft_status: loaded.phone ? 'DRAFT' : 'BLOCKED',
        ask_qualification_now: false,
      },
    };
  }
  if (last.mark === 'interested' || last.mark === 'call_completed') {
    return {
      buckets: ['calls'],
      fields: {
        human_headline: `CALL ${name.toUpperCase()} NOW`,
        why_now: 'Kyle marked interest or a completed call. The next step is still a conversation, not a new drip.',
        primary_action: 'Call and listen. One next step from what they say.',
        action_channel: loaded.phone ? 'call' : 'manual',
        call_opening: `Hey ${name}, it's Kyle. Where do you want to go from here?`,
        client_draft: null,
        draft_status: 'DRAFT',
        ask_qualification_now: false,
      },
    };
  }
  return null;
}

function tierFor(action: ExecutionAction, tour: TourView, now: Date): 'T0' | 'T1' | 'T2' | 'T3' {
  if (action.human_headline.startsWith('DO NOT')) return 'T3';
  if (action.waiting_on === 'CLIENT' && !action.summary_buckets.includes('overdue')) return 'T3';
  if (action.waiting_on === 'KYLE' || action.promise) return 'T0';
  if (action.human_headline.startsWith('WAIT')) return 'T3';
  if (action.summary_buckets.includes('post_tour') || action.internal_action_type === 'tour_follow_up') return 'T0';
  if (action.summary_buckets.includes('showings_today')) return 'T0';
  if (action.action_channel === 'call' && action.human_headline.startsWith('CALL')) return 'T0';
  if (action.summary_buckets.includes('offers') && action.verified_phone) return 'T0';
  if (action.summary_buckets.includes('under_contract')) return 'T0';
  if (action.summary_buckets.includes('overdue')) return 'T1';
  if (tour.scheduled && !tour.past) {
    const instant = tour.rawWhen ? appointmentInstant(tour.rawWhen, now) : null;
    if (instant && instant.getTime() - now.getTime() <= 48 * 60 * 60 * 1000) return 'T1';
    return 'T2';
  }
  if (action.summary_buckets.includes('financing') || action.summary_buckets.includes('waiting_listing')) return 'T1';
  if (action.summary_buckets.includes('cma') || action.summary_buckets.includes('buy_after_sell')) return 'T2';
  if (action.human_headline.startsWith('GET ') || action.human_headline.startsWith('VERIFY ') || (action.draft_status === 'BLOCKED' && action.summary_buckets.includes('missing_contact'))) return 'T3';
  if (action.human_headline.startsWith('WAIT') || action.waiting_on === 'CLIENT') return 'T3';
  if (action.summary_buckets.includes('overdue')) return 'T1';
  return 'T2';
}

function adapterFor(action: ExecutionAction): string {
  if (action.action_channel === 'call') return 'tel_link';
  if (action.action_channel === 'email') return 'copy_open_mail_paste_send';
  if (action.action_channel === 'sms') return 'copy_open_messages_paste_send';
  if (action.human_headline.startsWith('GET ') || action.human_headline.startsWith('VERIFY ')) return 'retrieve';
  return 'none';
}

function stepsFor(action: ExecutionAction): string {
  if (action.action_channel === 'sms') return 'Copy the text. Open your own messages. Paste it. Send it yourself. KyleOS cannot send it.';
  if (action.action_channel === 'email') return 'Copy the email. Open your own mail. Paste it. Send it yourself. KyleOS cannot send it.';
  if (action.action_channel === 'call') return 'Tap Call. Kyle places the call. KyleOS cannot dial.';
  if (action.human_headline.startsWith('GET ') || action.human_headline.startsWith('VERIFY ')) return 'Open Agent Tools or Redfin and retrieve the missing fact. Do not invent it.';
  if (action.waiting_on) return 'Do not send another message while this wait is still good. Come back at the next check.';
  return 'Do this step yourself. KyleOS did not execute it.';
}

function count(cards: ExecutionAction[], key: string): number {
  return cards.filter((card) => card.summary_buckets.includes(key)).length;
}

function manualNote(mark: string): string {
  const labels: Record<string, string> = {
    sent: 'Kyle marked the message sent manually. No provider confirmed delivery. Agent Tools was not written.',
    called: 'Kyle marked the call manually. No provider confirmed a completed call.',
    agent_tools_updated: 'Kyle marked Agent Tools updated manually. KyleOS did not write Agent Tools.',
    waiting: 'Kyle marked this waiting on a response. Nothing new was sent.',
    showing_completed: 'Kyle marked the showing completed. That is Kyle reported, not proof of attendance, and not a provider confirmation.',
    showing_cancelled: 'Kyle marked the showing cancelled. That is Kyle reported, not a listing-side confirmation.',
    offer_submitted: 'Kyle marked the offer submitted manually. No provider confirmation is on file from this button.',
  };
  return labels[mark] ?? 'Kyle reported a manual update.';
}

export function integrationSnapshot(): { liveSend: false; smsSend: false; emailSend: false; voice: false } {
  const flags = sendFlags();
  return {
    liveSend: flags.liveSend,
    smsSend: flags.smsSend,
    emailSend: flags.emailSend,
    voice: liveChannelPermitted('voice'),
  };
}
