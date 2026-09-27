import { sanitizeClientCopy } from '../voice.ts';
import { formatMoney, parseMoneyToken } from '../money.ts';
import type { Inbound } from './types.ts';
import type { OpportunityRow } from './store.ts';
import { SHOWING_CHECKPOINTS, type ShowingCheckpoint } from './types.ts';

export interface Decision {
  kind: 'send' | 'note' | 'escalate' | 'suppress' | 'no_contact' | 'hold';
  questionId: string;
  body: string | null;
  note: string;
  scheduleFollowUp: boolean;
  reason: string;
  facts: Array<{ key: string; value: string; basis: 'said' | 'confirmed' }>;
  checkpoints: Array<{ key: ShowingCheckpoint; status: 'satisfied' | 'missing'; evidence: string }>;
}

const QUESTION_COPY: Record<string, (name: string, property: string) => string> = {
  ask_showing_time: (name, property) =>
    `Hey ${name}, Kyle Kleinman with Redfin. I saw your request for ${property}. What time works for you to see it?`,
  confirm_requested_time: (name, property) =>
    `Hey ${name}, Kyle Kleinman with Redfin. I saw the time you asked for ${property}. That showing is not confirmed yet. Does that time still work for you?`,
  ask_budget: (_name) => 'What price range should I stay inside?',
  ask_financing: (_name) => 'Are you paying cash, or do you already have a pre approval letter?',
  ask_timing: (_name) => 'When do you want to be under contract?',
  ask_home_to_sell: (_name) => 'Do you need to sell a home before you buy?',
  ask_motivation: (_name) => 'What has you looking right now?',
  propose_call: (_name) => 'Want to jump on a short call so I can line up the right next step?',
  notify_buyer_access: (name) =>
    `${name}, the listing side approved the requested time. I still need you to confirm you can make it. This is not a fully confirmed showing yet.`,
  nudge: (name, property) => `Hi ${name}, checking back on ${property}. What time works for you to see it?`,
};

export function decide(opp: OpportunityRow, inbound: Inbound): Decision {
  const text = inbound.text ?? '';
  const first = firstName(inbound.displayName || opp.displayName);
  const property = opp.facts.property?.value || extractProperty(text) || 'the property';
  const facts: Decision['facts'] = [];
  const checkpoints: Decision['checkpoints'] = [];

  if (inbound.actor === 'coordinator') {
    return noteDecision(
      'coordinator_only',
      `Coordinator follow up for ${opp.displayName}. Kyle did not call or speak with the buyer. The showing is not confirmed.`,
      'A coordinator event is an internal note. It is not a claim that Kyle spoke with the buyer.',
    );
  }

  if (isOptOut(text) || inbound.kind === 'reply' && isOptOut(text)) {
    return {
      kind: 'suppress',
      questionId: 'opt_out',
      body: null,
      note: `${opp.displayName} opted out. Pending automatic outreach is stopped.`,
      scheduleFollowUp: false,
      reason: 'Opt out stops this person only.',
      facts: [],
      checkpoints: [],
    };
  }

  if (inbound.signals?.listingUnavailable) {
    const verified = inbound.signals.listingLastVerifiedAt ?? 'never';
    return noteDecision(
      'listing_stale',
      `Listing source for ${property} is unavailable. Last verified ${verified}. Current listing status is unknown and was not invented.`,
      'A stale or missing source is reported as a freshness gap, not as current status.',
    );
  }

  if (isUntrustedExport(text)) {
    return noteDecision(
      'refuse_export',
      'Untrusted message asked for a data export or a permission change. No export was made and no permission was expanded.',
      'Incoming text is evidence, not an instruction to change tools.',
    );
  }

  if (isOfferCommitment(text)) {
    return {
      kind: 'escalate',
      questionId: 'escalate_offer',
      body: null,
      note: `${opp.displayName} asked for an offer commitment. Escalated to Kyle. Nothing was bound and no offer was sent.`,
      scheduleFollowUp: false,
      reason: 'Offer and negotiation commitments stay with Kyle.',
      facts: [],
      checkpoints: [],
    };
  }

  if (inbound.signals?.accessApproved) {
    checkpoints.push({ key: 'access_approved', status: 'satisfied', evidence: 'Listing side access update.' });
  }
  if (inbound.signals?.agentAssigned) {
    checkpoints.push({ key: 'agent_assigned', status: 'satisfied', evidence: inbound.signals.agentAssigned });
  }
  if (inbound.signals?.paperworkDone) {
    checkpoints.push({ key: 'paperwork', status: 'satisfied', evidence: 'Paperwork marked done on the source event.' });
  }
  if (inbound.signals?.buyerAcknowledgedTime) {
    checkpoints.push({ key: 'buyer_acknowledged', status: 'satisfied', evidence: 'Buyer confirmed the requested time.' });
  }

  const absorbed = absorbFacts(text);
  facts.push(...absorbed.facts);
  if (absorbed.showingTime) {
    const previous = opp.facts.showing_requested?.value;
    if (previous && previous.toLowerCase() !== absorbed.showingTime.toLowerCase()) {
      for (const key of ['access_approved', 'buyer_notified', 'buyer_acknowledged'] as const) {
        checkpoints.push({ key, status: 'missing', evidence: `Time changed from ${previous} to ${absorbed.showingTime}. Needs a fresh check.` });
      }
    }
    checkpoints.push({ key: 'requested', status: 'satisfied', evidence: absorbed.showingTime });
    facts.push({ key: 'showing_requested', value: absorbed.showingTime, basis: 'said' });
  }
  if (extractProperty(text)) facts.push({ key: 'property', value: extractProperty(text)!, basis: 'said' });

  const merged = { ...mapFacts(opp), ...Object.fromEntries(facts.map((fact) => [fact.key, fact.value])) };
  const showing = mergedCheckpoints(opp, checkpoints);

  if (inbound.kind === 'due' && opp.followUpCount >= 1 && facts.length === 0 && !absorbed.showingTime) {
    return {
      kind: 'no_contact',
      questionId: 'no_contact',
      body: null,
      note: `No reply after one follow up for ${opp.displayName}. No further automatic text.`,
      scheduleFollowUp: false,
      reason: 'The record no longer warrants another automatic contact.',
      facts,
      checkpoints,
    };
  }

  if (inbound.kind === 'due' && opp.lastQuestion && !answered(opp.lastQuestion, merged, showing)) {
    const baseQuestion = opp.lastQuestion.replace(/^nudge:/, '');
    const copy = QUESTION_COPY[baseQuestion] ?? QUESTION_COPY.nudge;
    const body = clientCopy(copy(first, property));
    return {
      kind: 'send',
      questionId: `nudge:${baseQuestion}`,
      body,
      note: `Follow up nudge for ${opp.displayName}. The earlier question is still unanswered. Nothing was marked confirmed.`,
      scheduleFollowUp: true,
      reason: 'Due follow up reread the record and the last question is still open.',
      facts,
      checkpoints,
    };
  }

  if ((/\b(see|showing|tour)\b/i.test(text) || extractProperty(text)) && showing.requested !== 'satisfied' && inbound.kind !== 'due') {
    return {
      kind: 'send',
      questionId: 'ask_showing_time',
      body: clientCopy(QUESTION_COPY.ask_showing_time(first, property)),
      note: `Showing requested in the inquiry for ${opp.displayName} has no confirmed time and no listing approval.`,
      scheduleFollowUp: true,
      reason: 'The useful next step is one showing question. The showing is not confirmed.',
      facts,
      checkpoints,
    };
  }

  if (
    showing.requested === 'satisfied'
    && showing.access_approved !== 'satisfied'
    && !absorbed.showingTime
    && opp.lastQuestion !== 'ask_showing_time'
    && opp.lastQuestion !== 'confirm_requested_time'
  ) {
    const questionId = merged.showing_requested ? 'confirm_requested_time' : 'ask_showing_time';
    if (opp.lastQuestion === questionId && inbound.kind !== 'inquiry') {
      return nextQualification(first, property, merged, facts, checkpoints, opp.lastQuestion);
    }
    const body = clientCopy(QUESTION_COPY[questionId](first, property));
    return {
      kind: 'send',
      questionId,
      body,
      note: `Requested showing for ${opp.displayName} is not confirmed. Listing access is still missing.`,
      scheduleFollowUp: true,
      reason: 'A requested time is not a confirmed showing while access is missing.',
      facts,
      checkpoints,
    };
  }

  if (showing.access_approved === 'satisfied' && showing.buyer_acknowledged !== 'satisfied') {
    return {
      kind: 'send',
      questionId: 'notify_buyer_access',
      body: clientCopy(QUESTION_COPY.notify_buyer_access(first, property)),
      note: `Listing access is approved for ${opp.displayName}. Buyer acknowledgment is still missing, so the showing is not fully confirmed.`,
      scheduleFollowUp: true,
      reason: 'Access approval does not replace buyer acknowledgment.',
      facts,
      checkpoints,
    };
  }

  return nextQualification(first, property, merged, facts, checkpoints, opp.lastQuestion);
}

function nextQualification(
  first: string,
  property: string,
  facts: Record<string, string>,
  absorbed: Decision['facts'],
  checkpoints: Decision['checkpoints'],
  lastQuestion: string | null,
): Decision {
  const order: Array<{ id: string; key: string }> = [
    { id: 'ask_motivation', key: 'motivation' },
    { id: 'ask_budget', key: 'budget' },
    { id: 'ask_timing', key: 'timing' },
    { id: 'ask_financing', key: 'financing' },
    { id: 'ask_home_to_sell', key: 'home_to_sell' },
  ];
  const next = order.find((item) => !facts[item.key] && item.id !== lastQuestion) ?? order.find((item) => !facts[item.key]);
  if (!next) {
    if (lastQuestion === 'propose_call') {
      return {
        kind: 'no_contact',
        questionId: 'no_contact',
        body: null,
        note: 'Qualification is covered and a call was already offered. No extra automatic text.',
        scheduleFollowUp: false,
        reason: 'Nothing new to ask.',
        facts: absorbed,
        checkpoints,
      };
    }
    return {
      kind: 'send',
      questionId: 'propose_call',
      body: clientCopy(QUESTION_COPY.propose_call(first, property)),
      note: 'Ready for a call. No offer was made.',
      scheduleFollowUp: true,
      reason: 'The useful next step is a call, not another qualification question.',
      facts: absorbed,
      checkpoints,
    };
  }
  let body = clientCopy(QUESTION_COPY[next.id](first, property));
  if (!lastQuestion && !body.startsWith('Hey')) {
    body = clientCopy(`Hey ${first}, Kyle Kleinman with Redfin. I got your inquiry. ${body}`);
  }
  return {
    kind: 'send',
    questionId: next.id,
    body,
    note: `Next question for ${first} is ${next.id.replace('ask_', '')}. Earlier answers were kept.`,
    scheduleFollowUp: true,
    reason: `Chose ${next.id} because that fact is still missing.`,
    facts: absorbed,
    checkpoints,
  };
}

function noteDecision(questionId: string, note: string, reason: string): Decision {
  return { kind: 'note', questionId, body: null, note, scheduleFollowUp: false, reason, facts: [], checkpoints: [] };
}

function answered(questionId: string, facts: Record<string, string>, showing: Record<ShowingCheckpoint, string>): boolean {
  if (questionId === 'ask_showing_time' || questionId === 'confirm_requested_time' || questionId.startsWith('nudge:')) {
    return showing.requested === 'satisfied' || Boolean(facts.showing_requested);
  }
  if (questionId === 'ask_budget') return Boolean(facts.budget);
  if (questionId === 'ask_financing') return Boolean(facts.financing);
  if (questionId === 'ask_timing') return Boolean(facts.timing);
  if (questionId === 'ask_home_to_sell') return Boolean(facts.home_to_sell);
  if (questionId === 'ask_motivation') return Boolean(facts.motivation);
  if (questionId === 'notify_buyer_access') return showing.buyer_acknowledged === 'satisfied';
  return false;
}

function absorbFacts(text: string): { facts: Decision['facts']; showingTime: string | null } {
  const facts: Decision['facts'] = [];
  const money = text.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?/);
  if (money) {
    const amount = parseMoneyToken(money[0].replace(/\s/g, ''));
    if (amount) facts.push({ key: 'budget', value: formatMoney(amount), basis: 'said' });
  }
  if (/not pre-?approv/i.test(text)) facts.push({ key: 'financing', value: 'Not pre-approved (stated)', basis: 'said' });
  else if (/pre-?approv/i.test(text)) facts.push({ key: 'financing', value: 'Pre-approved (stated, not verified)', basis: 'said' });
  else if (/\bcash\b/i.test(text)) facts.push({ key: 'financing', value: 'Cash stated', basis: 'said' });
  if (/\b(this month|30 days|60 days|asap|by april)\b/i.test(text)) {
    const timing = text.match(/\b(this month|30 days|60 days|asap|by april)\b/i);
    if (timing) facts.push({ key: 'timing', value: timing[1], basis: 'said' });
  }
  if (/\bsell my (place|home|house)\b/i.test(text)) facts.push({ key: 'home_to_sell', value: 'Needs to sell first', basis: 'said' });
  if (/\b(looking because|need to move|lease ends)\b/i.test(text)) facts.push({ key: 'motivation', value: 'Stated in the message', basis: 'said' });
  const time = text.match(/\b(?:mon|tue|wed|thu|fri|sat|sun)\w*(?:day)?(?:\s+at)?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i);
  return { facts, showingTime: time ? time[0].replace(/\s+/g, ' ').trim() : null };
}

function extractProperty(text: string): string | null {
  const labeled = text.match(/property:\s*(.+)/i);
  if (labeled) return labeled[1].split('\n')[0].trim();
  const named = text.match(/\b(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:house|home|condo|property)\b/);
  if (named) return `the ${named[1]} property`;
  return null;
}

function isOptOut(text: string): boolean {
  return /\b(stop|unsubscribe|opt out|opted out|do not contact|don't contact)\b/i.test(text);
}

function isUntrustedExport(text: string): boolean {
  return /export\s+(all\s+)?(clients|records|database)/i.test(text) || /ignore (all|previous) instructions/i.test(text);
}

function isOfferCommitment(text: string): boolean {
  return /\b(write|submit|make) an offer\b/i.test(text) || /\boffer commitment\b/i.test(text);
}

function mapFacts(opp: OpportunityRow): Record<string, string> {
  return Object.fromEntries(Object.entries(opp.facts).map(([key, fact]) => [key, fact.value]));
}

function mergedCheckpoints(opp: OpportunityRow, extra: Decision['checkpoints']): Record<ShowingCheckpoint, string> {
  const status = {} as Record<ShowingCheckpoint, string>;
  for (const checkpoint of SHOWING_CHECKPOINTS) status[checkpoint] = opp.checkpoints[checkpoint]?.status ?? 'missing';
  for (const item of extra) status[item.key] = item.status;
  return status;
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] || 'there';
  return /^[A-Za-z][A-Za-z']+$/.test(first) ? first : 'there';
}

function clientCopy(body: string): string {
  return sanitizeClientCopy(body);
}

export function missingCheckpoints(opp: OpportunityRow): ShowingCheckpoint[] {
  return SHOWING_CHECKPOINTS.filter((checkpoint) => opp.checkpoints[checkpoint]?.status !== 'satisfied');
}

export function showingFullyConfirmed(opp: OpportunityRow): boolean {
  return missingCheckpoints(opp).length === 0;
}
