import { scheduledTourIsStale, scheduledTourLanguage } from '../conversion/engine.ts';
import { screenKyleVoice } from '../conversion/policy.ts';
import { offerSurface, transactionLine, transactionMilestones, type OfferSurface, type TransactionMilestone } from './modes.ts';
import { SHOWING_STATES, type ShowingState } from './showing.ts';

export interface DeskFact {
  field: string;
  value: string;
  kind: 'fact' | 'inference';
  verification: 'verified' | 'unverified';
}

export interface DeskEvidence {
  name: string;
  stage: string;
  phone: string | null;
  email: string | null;
  dnc: boolean;
  facts: DeskFact[];
  now: Date;
}

export interface ExecutionCard {
  opportunityId: string | null;
  priority: number;
  clientName: string;
  clientStage: string;
  whyNow: string;
  humanAction: string;
  clientDraft: string | null;
  callOpening: string | null;
  emailDraft: string | null;
  emailSubject: string | null;
  waitFor: string;
  ifYesNext: string;
  ifNoNext: string;
  ifUnclearNext: string;
  qualificationQuestion: string | null;
  askQualificationNow: boolean;
  showingState: string;
  propertyAddress: string | null;
  propertyStatus: string;
  customerPropertyState: string;
  links: Array<{ label: string; url: string | null; status: 'verified' | 'LINK NOT FOUND' }>;
  agentToolsNote: string;
  owner: string;
  followUp: string;
  leadSource: string;
  leadSourceHistory: string[];
  sourceConflict: boolean;
  blockedReason: string | null;
  manualActionRequired: true;
  approvalRequired: true;
  live: false;
  internalCode: string;
  hotScore: number;
  primaryAction: string;
  secondaryActions: string[];
  guardrail: string;
  anchor: string;
  searchPlan: { mode: 'create' | 'conflict' | 'none'; required: string; preferred: string; doNotFilter: string };
  offerReadiness: OfferSurface;
  transactionLine: string;
  showingTransitions: string[];
  agentToolsUpdate: { open: string; paste: string; thenSet: string };
  milestones: TransactionMilestone[];
  showingLines: string[];
  showingConflict: string | null;
  tier: 0 | 1 | 2 | 3;
  horizon: 'SHORT' | 'MID' | 'LONG';
  actionVerb: string;
  executionAdapter: string;
  phone: string | null;
  waitingOn: string | null;
  promiseLine: string | null;
  workflowDrift: boolean;
  showingLabel: string;
}

const URL_OK = /^https:\/\/[^\s]+$/i;

export function planDesk(input: DeskEvidence): ExecutionCard {
  const verified = (field: string) => input.facts.find((fact) => fact.field === field && fact.kind === 'fact' && fact.verification === 'verified')?.value ?? null;
  const any = (field: string) => input.facts.find((fact) => fact.field === field)?.value ?? null;
  const property = verified('property_address')
    ?? verified('inquiry_property')
    ?? input.facts.find((fact) => /property_address|showing_address|inquiry_property/i.test(fact.field))?.value
    ?? null;
  const hotScore = Number(verified('hot_score') ?? any('hot_score') ?? 0);
  const status = verified('property_status') ?? 'Unknown';
  const links = [
    link('REDFIN', verified('redfin_url')),
    link('AGENT TOOLS', verified('agent_tools_url')),
    link('MLS', verified('mls_url')),
  ];
  const history = input.facts.filter((fact) => fact.field === 'lead_source_history' || fact.field === 'lead_source').map((fact) => `${fact.verification} ${fact.kind}: ${fact.value}`);
  const original = verified('lead_source');
  const sourceConflict = input.facts.some((fact) => fact.field === 'lead_source_conflict');
  const base = {
    opportunityId: null,
    priority: 40,
    clientName: input.name,
    clientStage: input.stage,
    propertyAddress: property,
    propertyStatus: status,
    links,
    leadSource: original ?? 'DATA NEEDED',
    leadSourceHistory: history,
    sourceConflict,
    manualActionRequired: true as const,
    approvalRequired: true as const,
    live: false as const,
    owner: 'Kyle',
    blockedReason: null as string | null,
    hotScore: Number.isFinite(hotScore) ? hotScore : 0,
  };

  const finish = (card: Omit<ExecutionCard, 'manualActionRequired' | 'approvalRequired' | 'live' | 'primaryAction' | 'secondaryActions' | 'guardrail' | 'anchor' | 'searchPlan' | 'offerReadiness' | 'transactionLine' | 'showingTransitions' | 'agentToolsUpdate' | 'milestones' | 'showingLines' | 'showingConflict' | 'tier' | 'horizon' | 'actionVerb' | 'executionAdapter' | 'phone' | 'waitingOn' | 'promiseLine' | 'workflowDrift' | 'showingLabel'> & { manualActionRequired?: true; approvalRequired?: true; live?: false }): ExecutionCard => {
    const full = { ...card, manualActionRequired: true as const, approvalRequired: true as const, live: false as const } as ExecutionCard;
    for (const draft of [full.clientDraft, full.callOpening, full.emailDraft]) {
      if (!draft) continue;
      const voice = screenKyleVoice(draft);
      if (!voice.allowed) throw new Error(`${input.name}: ${voice.reason}`);
    }
    const badDraft = input.facts.find((fact) => /sms_draft|gmail_draft|unsent_draft/.test(fact.field) && /happen|completed/i.test(fact.value));
    if (badDraft) {
      if (full.clientDraft && /already happened|glad you|hope you enjoyed/i.test(full.clientDraft)) {
        full.clientDraft = `${first(input.name)}, did you end up seeing ${property ?? 'the place'}?`;
      }
      if (!/unsent draft/i.test(full.agentToolsNote)) {
        full.agentToolsNote = `${full.agentToolsNote} An unsent draft claims the tour already happened. That draft was not sent.`;
      }
    }
    const cashInference = input.facts.find((fact) => fact.field === 'cash_vs_finance' && fact.verification !== 'verified' && /cash/i.test(fact.value));
    if (cashInference && !/not verified CASH/.test(`${full.whyNow} ${full.agentToolsNote}`)) {
      full.whyNow = `${full.whyNow} Cash is a tag inference, not verified CASH.`;
      full.agentToolsNote = `${full.agentToolsNote} Cash status is a tag inference only. It is not verified CASH.`;
    }
    const cma = overdueCma(input);
    if (cma && !full.humanAction.includes('CMA NEEDED')) {
      full.priority = Math.max(full.priority, 85);
      full.humanAction = `${full.humanAction} CMA NEEDED. Reminder is overdue: ${cma}. PROPERTY: address not on file. Do not CMA an assumed property. RETRIEVE FROM: Agent Tools. LOOK FOR: the home to sell.`;
      if (full.internalCode === 'needs_contact' || full.internalCode === 'property_first') full.internalCode = 'cma_needed';
      if (/sell first/i.test(any('agent_tools_tags') ?? '') && !/sell first/.test(full.agentToolsNote)) {
        full.agentToolsNote = `${full.agentToolsNote} Agent Tools tag says needs to sell first. That tag is not a new answer from the client. The CMA is the seller task.`;
      }
    }
    if (!input.phone && full.internalCode !== 'do_not_contact') {
      if (input.email && /^TEXT /.test(full.humanAction)) full.humanAction = full.humanAction.replace(/^TEXT /, 'EMAIL ');
      if (!/GET .+ CELL/.test(full.humanAction)) {
        full.humanAction = `${full.humanAction} GET ${input.name.toUpperCase()}'S CELL. WHERE TO LOOK: Agent Tools or Redfin.`;
      }
      if (input.email) full.priority = Math.max(full.priority, 72);
      if (input.email && full.clientDraft && !full.emailDraft) {
        full.emailDraft = full.clientDraft;
        full.clientDraft = null;
        full.emailSubject = full.emailSubject ?? (/saving /i.test(full.emailDraft) ? 'Your saved search' : 'The property you asked about');
      }
    }
    full.agentToolsNote = full.agentToolsNote.replace(/\s*Nothing was written to Agent Tools\./g, '').trim();
    full.guardrail = 'GUARDRAIL: Nothing was written to Agent Tools. A draft is not a send. Do not mark the showing completed or the offer submitted from this screen.';
    full.anchor = `card-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    full.searchPlan = searchPlanFor(input);
    if (full.searchPlan.mode === 'conflict' && !/SEARCH CONFLICT/.test(full.humanAction)) {
      full.humanAction = `${full.humanAction} SEARCH CONFLICT. REQUIRED: not set. PREFERRED: not set. DO NOT FILTER OUT YET: ${full.searchPlan.doNotFilter}`;
    }
    full.offerReadiness = offerSurface(input.facts);
    full.transactionLine = transactionLine(input.facts);
    full.milestones = transactionMilestones(input.facts);
    full.showingTransitions = justifiedShowings(input, full.showingState);
    const showing = collectShowingLines(input.facts);
    full.showingLines = showing.lines;
    full.showingConflict = showing.conflict;
    if (showing.conflict && !/SHOWING CONFLICT/.test(full.whyNow)) {
      full.whyNow = `${full.whyNow} ${showing.conflict}`;
    }
    const splitAt = full.internalCode === 'cma_needed' ? full.humanAction.indexOf('CMA NEEDED') : 0;
    if (splitAt > 0) {
      full.primaryAction = full.humanAction.slice(splitAt);
      full.secondaryActions = [full.humanAction.slice(0, splitAt).trim()];
    } else {
      const parts = full.humanAction.split(/(?<=\.)\s+/).filter(Boolean);
      full.primaryAction = parts[0] ?? full.humanAction;
      full.secondaryActions = parts.slice(1);
    }
    const tools = verified('agent_tools_url');
    full.agentToolsUpdate = {
      open: tools && /^https:\/\//i.test(tools) ? tools : 'LINK NOT FOUND. Open Agent Tools and find this client by name.',
      paste: full.agentToolsNote,
      thenSet: 'Set a reminder and the next action only. Do not change stage, tour completion, or offer status without evidence.',
    };
    const due = input.facts.find((fact) => fact.field === 'action_due_at' && fact.kind === 'fact' && fact.verification === 'verified');
    if (due) {
      const hours = (Date.parse(due.value) - input.now.getTime()) / 3_600_000;
      if (Number.isFinite(hours) && hours <= 2) full.priority += 12;
    }
    full.phone = input.phone;
    full.tier = tierFor(full.internalCode, full.showingState);
    full.horizon = full.tier <= 1 ? (full.tier === 0 ? 'SHORT' : 'MID') : full.tier === 2 ? 'MID' : 'LONG';
    if (full.clientDraft) {
      full.actionVerb = 'TEXT CLIENT';
      full.executionAdapter = 'COPY → OPEN MESSAGES → PASTE → SEND';
    } else if (full.callOpening) {
      full.actionVerb = 'CALL CLIENT';
      full.executionAdapter = 'COPY OPENING → CALL FROM THE PHONE → LISTEN';
    } else if (full.emailDraft) {
      full.actionVerb = 'EMAIL CLIENT';
      full.executionAdapter = 'COPY → OPEN MAIL → PASTE → SEND';
    } else {
      full.actionVerb = 'MANUAL STEP';
      full.executionAdapter = 'NO PROVIDER. KYLE DOES THIS STEP.';
    }
    full.waitingOn = verified('waiting_active') === 'yes' ? (verified('waiting_party') || 'CLIENT') : null;
    full.promiseLine = verified('promise_open') === 'yes' ? verified('kyle_promise') : null;
    full.workflowDrift = false;
    full.showingLabel = showingLabel(full.showingState);
    if (full.showingState === 'OUTCOME_UNKNOWN') {
      full.showingLines = full.showingLines.map((line) => line.replace(/\bupcoming\b/gi, 'past scheduled'));
      if (full.customerPropertyState === 'Scheduled') full.customerPropertyState = 'Past scheduled';
    }
    const listPrice = input.facts.find((fact) => fact.field === 'list_price' || fact.field === 'clicked_price');
    if (listPrice && !verified('budget') && !/list price is not a budget/i.test(full.whyNow)) {
      full.whyNow = `${full.whyNow} A list price is not a budget.`;
    }
    return full;
  };

  const note = (line: string) => `${line} Nothing was written to Agent Tools.`;

  if (input.dnc || /stop|do not contact/i.test(any('contact_preference') ?? '')) {
    return finish({
      ...base,
      priority: 0,
      whyNow: 'This person opted out.',
      humanAction: 'DO NOT CONTACT. No text, email, or call.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Nothing. Outbound stays off.',
      ifYesNext: 'No outbound.',
      ifNoNext: 'No outbound.',
      ifUnclearNext: 'No outbound.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'UNKNOWN',
      customerPropertyState: 'Unknown',
      agentToolsNote: note('Contact preference is do not contact. No outbound was prepared.'),
      followUp: 'None until Kyle clears the opt out.',
      owner: 'Kyle',
      internalCode: 'do_not_contact',
    });
  }

  if (verified('promise_open') === 'yes' && verified('kyle_promise')) {
    const promise = verified('kyle_promise') ?? '';
    return finish({
      ...base,
      priority: 98,
      whyNow: 'Kyle made a promise. The client is waiting on Kyle. That outranks a passive lead.',
      humanAction: `DO THE PROMISE. ${promise}`,
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Kyle to do the thing he promised.',
      ifYesNext: 'Mark the promise kept only after it is done.',
      ifNoNext: 'Tell them the new time.',
      ifUnclearNext: 'Do not send a new question while this promise is open.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'UNKNOWN',
      customerPropertyState: 'Unknown',
      agentToolsNote: note(`Promise on file: ${promise}. It is not done until Kyle marks it kept.`),
      followUp: 'When the promise is done.',
      internalCode: 'promise',
    });
  }

  if (verified('last_outcome') === 'client_replied') {
    return finish({
      ...base,
      priority: 80,
      whyNow: 'Kyle marked that the client replied. The prior draft is not the next send.',
      humanAction: `READ THE REPLY FROM ${input.name.toUpperCase()}. Do not send the previous draft again.`,
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The one next step in their reply.',
      ifYesNext: 'Do that one step.',
      ifNoNext: 'Ask one short question.',
      ifUnclearNext: 'Ask them to name the one thing.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'UNKNOWN',
      customerPropertyState: 'Unknown',
      agentToolsNote: note('Client reply was marked by Kyle. The desk did not read a mailbox.'),
      followUp: 'The next step from the reply.',
      internalCode: 'client_replied',
    });
  }

  if (verified('last_outcome') === 'interested' || verified('last_outcome') === 'not_interested') {
    const interested = verified('last_outcome') === 'interested';
    return finish({
      ...base,
      priority: 82,
      whyNow: interested ? 'They said they are interested.' : 'They said it is not the one.',
      humanAction: interested
        ? `TEXT ${input.name.toUpperCase()} NOW. Ask what they want to do next.`
        : `TEXT ${input.name.toUpperCase()} NOW. Ask what missed.`,
      clientDraft: interested
        ? `${first(input.name)}, what do you want to do next on this one?`
        : `${first(input.name)}, what missed for you?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: interested ? 'The next step they want.' : 'What missed.',
      ifYesNext: interested ? 'Offer to write only if they ask.' : 'Use that to change the search.',
      ifNoNext: 'Stop on this property.',
      ifUnclearNext: 'Ask once more.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'UNKNOWN',
      customerPropertyState: 'Unknown',
      agentToolsNote: note('Outcome was marked by Kyle. It was not verified by an integration.'),
      followUp: 'Their answer.',
      internalCode: interested ? 'interested' : 'not_interested',
    });
  }

  if (verified('waiting_active') === 'yes') {
    const party = (verified('waiting_party') || 'CLIENT').replaceAll('_', ' ');
    const end = verified('waiting_end') || 'the end condition on file';
    return finish({
      ...base,
      priority: 36,
      whyNow: `Waiting on ${party}. Do not open a new question while this wait is real.`,
      humanAction: `WAITING ON ${party}. END WHEN: ${end}.`,
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: end,
      ifYesNext: 'One next step from that answer.',
      ifNoNext: 'Leave the wait in place.',
      ifUnclearNext: 'Do not send a second message.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'UNKNOWN',
      customerPropertyState: 'Unknown',
      agentToolsNote: note(`Waiting on ${party}. No new outreach was prepared.`),
      followUp: end,
      internalCode: 'waiting',
    });
  }

  const showing = deriveShowing(input, property);
  if (showing.associateOnly) {
    const opening = `Hey ${first(input.name)}, it's Kyle. I wanted to grab you for a minute about ${property ?? 'the place'}. What did you think once you got inside?`;
    return finish({
      ...base,
      priority: 88,
      whyNow: 'An associate or coordinator note is not a completed tour with Kyle.',
      humanAction: `CALL ${input.name.toUpperCase()} NOW. SHOWING OUTCOME NOT CONFIRMED.`,
      clientDraft: null,
      callOpening: opening,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'What they actually thought, in their words.',
      ifYesNext: 'Listen. One follow up question only if they keep going.',
      ifNoNext: 'Ask whether they still want to see it.',
      ifUnclearNext: 'Stop and confirm whether they went.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'OUTCOME_UNKNOWN',
      customerPropertyState: 'Unknown',
      agentToolsNote: note('Associate or coordinator contact is not Kyle contact. Outcome stays unconfirmed.'),
      followUp: 'After the call, record only what they said.',
      internalCode: 'tour_follow_up',
    });
  }
  if (showing.state === 'OUTCOME_UNKNOWN') {
    const draft = `${first(input.name)}, did you end up seeing ${property ?? 'the place'}?`;
    return finish({
      ...base,
      priority: 90,
      whyNow: 'A past showing has no verified outcome. Do not assume they attended.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. POST TOUR VERIFICATION NEEDED. OUTCOME UNKNOWN.`,
      clientDraft: draft,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether they actually attended.',
      ifYesNext: 'What did you think once you got inside?',
      ifNoNext: 'Verify current availability and access, then coordinate another showing only if they still want it.',
      ifUnclearNext: 'Ask once whether they got inside. Do not mark it completed.',
      qualificationQuestion: 'What is prompting the move?',
      askQualificationNow: false,
      showingState: 'OUTCOME_UNKNOWN',
      customerPropertyState: 'Past scheduled',
      agentToolsNote: note(`Text prepared asking whether they saw ${property ?? 'the property'}. The tour outcome is not confirmed.`),
      followUp: 'Customer reply about attendance.',
      internalCode: 'tour_follow_up',
    });
  }

  if (verified('customer_asked') && /call/i.test(verified('customer_asked') ?? '')) {
    return finish({
      ...base,
      priority: 92,
      whyNow: 'They asked for a call.',
      humanAction: `CALL ${input.name.toUpperCase()} NOW.`,
      clientDraft: null,
      callOpening: `Hey ${first(input.name)}, it's Kyle. You asked me to call. What's the main thing you want to sort out?`,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The point of the call.',
      ifYesNext: 'Handle that one point.',
      ifNoNext: 'Ask when a better time is.',
      ifUnclearNext: 'Ask them to name the one thing.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Customer asked for a call. No call was placed by the desk.'),
      followUp: 'What they say on the call.',
      internalCode: 'call_requested',
    });
  }

  if (verified('preferred_channel') === 'phone') {
    return finish({
      ...base,
      priority: 70,
      whyNow: 'They prefer a call.',
      humanAction: `CALL ${input.name.toUpperCase()} NOW.`,
      clientDraft: null,
      callOpening: `Hey ${first(input.name)}, it's Kyle. Calling since that's easier for you. What do you want to look at first?`,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Their first priority.',
      ifYesNext: 'Stay on that topic.',
      ifNoNext: 'Offer a time.',
      ifUnclearNext: 'Ask one short question.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Preferred channel is phone. The desk did not place a call.'),
      followUp: 'After the call.',
      internalCode: 'prefer_phone',
    });
  }

  if (verified('property_conflict')) {
    return finish({
      ...base,
      priority: 81,
      whyNow: 'Two property sources disagree. Neither status is current until someone checks.',
      humanAction: 'DATA CONFLICT. Do not pick a listing status. RETRIEVE FROM: the listing source. LOOK FOR: the current status.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'A current status from the listing source.',
      ifYesNext: 'Use only the status you just verified.',
      ifNoNext: 'Leave the status unknown.',
      ifUnclearNext: 'Do not guess.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Property sources conflict. No status was chosen.'),
      followUp: 'When the listing status is verified.',
      internalCode: 'property_conflict',
    });
  }

  if (verified('property_stale') === 'yes') {
    return finish({
      ...base,
      priority: 79,
      whyNow: 'The property facts on file are old.',
      humanAction: 'OLD DATA. Retrieve the current listing status before you use it.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'A fresh status.',
      ifYesNext: 'Replace the stale status only after you verify it.',
      ifNoNext: 'Leave it marked stale.',
      ifUnclearNext: 'Do not treat the old status as current.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Stale property data was not treated as current.'),
      followUp: 'Fresh listing status.',
      internalCode: 'property_stale',
    });
  }

  if (verified('calendar_conflict') === 'yes') {
    return finish({
      ...base,
      priority: 85,
      whyNow: 'The time overlaps something already on the calendar.',
      humanAction: 'CALENDAR CONFLICT. Do not double book. Resolve the time before you confirm anything.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Kyle to pick a time that is actually open.',
      ifYesNext: 'Propose only the open time.',
      ifNoNext: 'Leave both events as they are.',
      ifUnclearNext: 'Do not tell the customer the slot is free.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Calendar conflict. No event was created.'),
      followUp: 'A resolved time.',
      internalCode: 'calendar_conflict',
    });
  }

  if (verified('listing_consult') === 'scheduled') {
    return finish({
      ...base,
      priority: 70,
      whyNow: 'A listing appointment is on the calendar. It is not a listing.',
      humanAction: 'LISTING APPT IS SET. It is not a listing yet.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The appointment to happen.',
      ifYesNext: 'Record only what was decided.',
      ifNoNext: 'Leave the listing file unopened.',
      ifUnclearNext: 'Do not mark a listing active.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Listing appointment is not an active listing.'),
      followUp: 'After the appointment.',
      internalCode: 'listing_opportunity',
    });
  }

  if (/pending|sold|off market/i.test(status)) {
    const draft = `${first(input.name)}, that one went ${status.toLowerCase()}. Are you set on this area or open to nearby options too?`;
    return finish({
      ...base,
      priority: 80,
      whyNow: 'The property is not a clean active option. The person is still a lead.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: draft,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether they want nearby options.',
      ifYesNext: 'Ask what caught their eye about the first one.',
      ifNoNext: 'Ask which area they want to stay in.',
      ifUnclearNext: 'Ask the area question again, once.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Unknown',
      agentToolsNote: note(`Property status on file is ${status}. That is not a reason to drop the person.`),
      followUp: 'Their answer about area.',
      internalCode: 'property_unavailable',
    });
  }

  if (showing.state === 'CUSTOMER_REQUESTED') {
    return finish({
      ...base,
      priority: 78,
      whyNow: 'They asked to see it. The listing side has not confirmed.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. Showing requested. Listing side has not confirmed.`,
      clientDraft: `${first(input.name)}, I have your request for ${property ?? 'the property'}. I'm confirming access now.`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Access from the listing side.',
      ifYesNext: 'Tell them the time only after access is confirmed.',
      ifNoNext: 'Ask whether a different time works.',
      ifUnclearNext: 'Do not mark the showing scheduled.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'CUSTOMER_REQUESTED',
      customerPropertyState: 'Requested',
      agentToolsNote: note('Showing requested is not scheduled and not confirmed.'),
      followUp: 'Listing-side access.',
      internalCode: 'showing_requested',
    });
  }

  if (verified('transaction_status') === 'closed') {
    return finish({
      ...base,
      priority: 97,
      whyNow: 'The file shows a closing. Keys and leftover items still need a human check.',
      humanAction: 'TRANSACTION CLOSED. Confirm keys from the file. Do not send a review request from here.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether keys and possession are actually done.',
      ifYesNext: 'Record only what the file shows.',
      ifNoNext: 'Leave the leftover item open.',
      ifUnclearNext: 'HUMAN REVIEW REQUIRED.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Unknown',
      agentToolsNote: note('Closing is on file. No review request was sent.'),
      followUp: 'Keys and any leftover issue.',
      internalCode: 'closed',
    });
  }

  if (verified('offer_state') === 'accepted') {
    return finish({
      ...base,
      priority: 96,
      whyNow: 'Acceptance is on file. That is not a closing, and deadlines are not assumed.',
      humanAction: 'OFFER ACCEPTED. This is not closed. HUMAN REVIEW REQUIRED before any deadline is calculated.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The executed contract facts.',
      ifYesNext: 'Record only a date that is on the document.',
      ifNoNext: 'Leave deadlines blank.',
      ifUnclearNext: 'HUMAN REVIEW REQUIRED.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Under contract',
      agentToolsNote: note('Accepted is not closed. No deadline was calculated.'),
      followUp: 'Verified contract dates.',
      internalCode: 'offer_accepted',
    });
  }

  if (verified('offer_state') === 'submitted') {
    return finish({
      ...base,
      priority: 95,
      whyNow: 'Kyle confirmed an offer was submitted. A draft is not a submission.',
      humanAction: 'REVIEW THE SUBMITTED OFFER WITH KYLE. Do not draft a new submission.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The next contract fact from the file.',
      ifYesNext: 'Record only the verified term.',
      ifNoNext: 'Leave the offer marked submitted.',
      ifUnclearNext: 'HUMAN REVIEW REQUIRED.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Offer submitted',
      agentToolsNote: note('Offer submitted is on file from a verified confirmation. The desk did not submit anything.'),
      followUp: 'Next verified deadline.',
      internalCode: 'offer_submitted',
    });
  }

  if (verified('offer_state') === 'draft') {
    return finish({
      ...base,
      priority: 84,
      whyNow: 'An offer draft exists. It has not been submitted.',
      humanAction: 'OFFER READINESS: MISSING. Review terms with Kyle before any submission.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Kyle to mark the missing terms.',
      ifYesNext: 'List only the terms still missing.',
      ifNoNext: 'Leave it as a draft.',
      ifUnclearNext: 'HUMAN REVIEW REQUIRED.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Offer requested',
      agentToolsNote: note('Offer draft is not an offer submission.'),
      followUp: 'Kyle review.',
      internalCode: 'offer_draft',
    });
  }

  if (verified('effective_date')) {
    return finish({
      ...base,
      priority: 93,
      whyNow: 'The effective date is verified. Other dates are not derived from it.',
      humanAction: `EFFECTIVE DATE VERIFIED ${verified('effective_date')}. Do not calculate other deadlines from an assumption.`,
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Each next date from the executed document.',
      ifYesNext: 'Record that date only.',
      ifNoNext: 'Leave it blank.',
      ifUnclearNext: 'HUMAN REVIEW REQUIRED.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Under contract',
      agentToolsNote: note('Effective date is verified. Other deadlines were not invented.'),
      followUp: 'The next date on the document.',
      internalCode: 'effective_date',
    });
  }

  if (verified('inspection_deadline')) {
    return finish({
      ...base,
      priority: 92,
      whyNow: 'The inspection deadline is on the document.',
      humanAction: `INSPECTION / OWNER: Buyer / STATUS: Deadline verified / DUE: ${verified('inspection_deadline')}. Use that date only.`,
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether inspection is scheduled.',
      ifYesNext: 'Record the appointment separately from the deadline.',
      ifNoNext: 'Leave inspection unscheduled.',
      ifUnclearNext: 'Do not invent a time.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Under contract',
      agentToolsNote: note('Inspection deadline is the verified date only.'),
      followUp: 'Inspection scheduling.',
      internalCode: 'inspection_deadline',
    });
  }

  if (verified('inspection_status') === 'unknown') {
    return finish({
      ...base,
      priority: 91,
      whyNow: 'Inspection status is unknown.',
      humanAction: 'INSPECTION STATUS UNKNOWN. It is not scheduled.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'A verified inspection status.',
      ifYesNext: 'Record what the file actually says.',
      ifNoNext: 'Leave it unknown.',
      ifUnclearNext: 'Do not write inspection pending.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Under contract',
      agentToolsNote: note('Unknown inspection was not treated as scheduled.'),
      followUp: 'Inspection status from the file.',
      internalCode: 'inspection_unknown',
    });
  }

  if (verified('loan_status') === 'not_clear_to_close') {
    return finish({
      ...base,
      priority: 91,
      whyNow: 'The loan is not clear to close.',
      humanAction: 'LOAN IS NOT CLEAR TO CLOSE. Do not tell them it is.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'A lender update that is actually clear to close.',
      ifYesNext: 'Record the lender words.',
      ifNoNext: 'Leave the loan short of clear to close.',
      ifUnclearNext: 'Do not upgrade the loan status.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Under contract',
      agentToolsNote: note('Loan is not clear to close.'),
      followUp: 'Lender status.',
      internalCode: 'loan_not_ctc',
    });
  }

  if (verified('walkthrough') === 'scheduled') {
    return finish({
      ...base,
      priority: 90,
      whyNow: 'The final walkthrough is on the calendar. It has not happened.',
      humanAction: 'FINAL WALKTHROUGH IS SCHEDULED. It is not completed.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The walkthrough to happen.',
      ifYesNext: 'Mark it completed only after Kyle confirms it happened.',
      ifNoNext: 'Leave it scheduled.',
      ifUnclearNext: 'Do not mark it completed.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: 'ACCESS_PENDING',
      customerPropertyState: 'Scheduled',
      agentToolsNote: note('Scheduled walkthrough is not a completed walkthrough.'),
      followUp: 'After the walkthrough time.',
      internalCode: 'walkthrough_scheduled',
    });
  }

  if (verified('offer_price') && verified('missing_terms')) {
    return finish({
      ...base,
      priority: 84,
      whyNow: 'A price is on file. Other terms are not, so nothing can be submitted.',
      humanAction: 'OFFER READINESS: MISSING. Price is on file. Other terms are not. Do not submit.',
      clientDraft: `${first(input.name)}, price is noted. What deposit do you want to use?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The next missing term they authorize.',
      ifYesNext: 'Ask one remaining term.',
      ifNoNext: 'Leave the offer unwritten.',
      ifUnclearNext: 'Ask that term once more.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Offer requested',
      agentToolsNote: note('Price alone is not an offer submission.'),
      followUp: 'The next missing term.',
      internalCode: 'offer_terms_missing',
    });
  }

  if (verified('wants_offer') === 'yes' && !verified('offer_price')) {
    return finish({
      ...base,
      priority: 83,
      whyNow: 'They want to offer. Material terms are not on file.',
      humanAction: 'OFFER READINESS: MISSING. Talk through price and the main terms before anything is written.',
      clientDraft: `${first(input.name)}, if you want to write, what price do you want to start at?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'A price they authorize.',
      ifYesNext: 'Ask the next missing term, one at a time.',
      ifNoNext: 'Leave it as a conversation.',
      ifUnclearNext: 'Ask the price question again, once.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: 'Offer requested',
      agentToolsNote: note('Offer interest is not an offer submission.'),
      followUp: 'Their price.',
      internalCode: 'offer_interest',
    });
  }

  if (!input.phone && !input.email) {
    const offerMention = /offer/i.test(`${any('recent_note') ?? ''} ${any('buying_activity') ?? ''}`);
    return finish({
      ...base,
      priority: 60,
      whyNow: heldWhy(input),
      humanAction: `GET ${input.name.toUpperCase()}'S CELL. WHERE TO LOOK: Agent Tools, Redfin, or another authorized source.`,
      clientDraft: property
        ? `${first(input.name)}, Kyle with Redfin. I'm checking on ${property}. Is that still the one?`
        : null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'A verified cell, or an email reply.',
      ifYesNext: 'Use the channel they answer on.',
      ifNoNext: 'Keep looking in the authorized source.',
      ifUnclearNext: 'Do not invent a number.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: [
        any('recent_note') ?? '',
        offerMention && !/offer request/i.test(any('recent_note') ?? '') ? 'Offer request is on file. It is not a confirmed submission.' : '',
        any('saved_search') ? `Saved searches on file: ${any('saved_search')}.` : '',
        /text/i.test(any('agent_tools_tags') ?? '') ? 'Prefers text.' : '',
        'No verified cell on file.',
      ].filter(Boolean).join(' '),
      followUp: 'When a verified cell is added.',
      blockedReason: 'Verified contact is missing.',
      internalCode: 'needs_contact',
    });
  }

  if (verified('language') === 'es') {
    const draft = `${first(input.name)}, soy Kyle con Redfin. Estoy viendo ${property ?? 'la propiedad'}. Es la principal que quieres ver?`;
    return finish({
      ...base,
      priority: 72,
      whyNow: 'They prefer Spanish.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: draft,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Si esa propiedad es la principal.',
      ifYesNext: 'Pregunta que le gusto.',
      ifNoNext: 'Pregunta que zona si.',
      ifUnclearNext: 'Repite la pregunta una vez.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Language on file is Spanish. One question only.'),
      followUp: 'Their reply.',
      internalCode: 'spanish',
    });
  }

  if (verified('cash_vs_finance') === 'cash') {
    return finish({
      ...base,
      priority: 55,
      whyNow: 'Cash is already verified. Do not ask it again.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, I've got this as a cash purchase. Is ${property ?? 'the one you asked about'} still the one to focus on?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether that property is still the focus.',
      ifYesNext: 'Ask what caught their eye.',
      ifNoNext: 'Ask which area instead.',
      ifUnclearNext: 'Ask the property question once more.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Cash is a verified fact. It was not inferred from a tag.'),
      followUp: 'Their answer.',
      internalCode: 'cash_known',
    });
  }

  if (verified('financing_state') === 'NEEDS_PREAPPROVAL' || verified('financing_state') === 'FINANCING_UNKNOWN_STATUS') {
    return finish({
      ...base,
      priority: 64,
      whyNow: 'Financing is not approved yet. That does not disqualify them.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, are you planning to finance it or buy cash?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Cash or financing.',
      ifYesNext: 'If they finance, ask whether they are already approved.',
      ifNoNext: 'If cash, stop the lender questions.',
      ifUnclearNext: 'Ask cash or finance once more.',
      qualificationQuestion: 'Already approved or do we still need to handle that piece?',
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Financing status is not preapproved. No mortgage advice was given.'),
      followUp: 'Their cash or finance answer.',
      internalCode: 'needs_preapproval',
    });
  }

  if (verified('financing_state') === 'PREAPPROVED') {
    return finish({
      ...base,
      priority: 58,
      whyNow: 'Preapproval is verified. Do not ask if they are approved.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, I've got the preapproval on file. Is ${property ?? 'the place you asked about'} the one you want to see first?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Which property is first.',
      ifYesNext: 'Work on access.',
      ifNoNext: 'Ask which one instead.',
      ifUnclearNext: 'Ask the property question once.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Preapproval is verified. The desk did not contact a lender.'),
      followUp: 'Their property answer.',
      internalCode: 'preapproved',
    });
  }

  const financeNote = input.facts.find((fact) => fact.field === 'financing_note' && /preapproval/i.test(fact.value));
  if (financeNote && !verified('financing_state')) {
    return finish({
      ...base,
      priority: 64,
      whyNow: 'A file note says preapproval is still open. That note is not a verified preapproval and it does not disqualify them.',
      humanAction: `GET PREAPPROVAL STATUS. TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, are you planning to finance it or buy cash?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Cash or financing.',
      ifYesNext: 'If they finance, ask whether they are already approved.',
      ifNoNext: 'If cash, stop the lender questions.',
      ifUnclearNext: 'Ask cash or finance once more.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Preapproval note is not a verified financing fact. No mortgage advice was given.'),
      followUp: 'Their cash or finance answer.',
      internalCode: 'needs_preapproval',
    });
  }

  if (verified('sale_dependency') === 'sale_required' || verified('sale_dependency') === 'proceeds_required') {
    return finish({
      ...base,
      priority: 74,
      whyNow: 'A sale controls the purchase. That is verified, not assumed from ownership.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: verified('sale_dependency') === 'proceeds_required'
        ? `${first(input.name)}, do you need the proceeds from the sale to make the purchase?`
        : `${first(input.name)}, do you need to sell before you can buy?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether the sale controls the purchase.',
      ifYesNext: 'Ask for the property address before any CMA.',
      ifNoNext: 'Leave the seller file closed.',
      ifUnclearNext: 'Ask the sale question once more.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Sale dependency is verified. No CMA was prepared without an address.'),
      followUp: 'Their answer.',
      internalCode: 'sale_dependency',
    });
  }

  if (verified('cma_due')) {
    return finish({
      ...base,
      priority: 76,
      whyNow: 'A CMA reminder is due. It stays visible.',
      humanAction: `CMA NEEDED. PROPERTY: ${verified('cma_property') ?? 'address not on file'}. Do not CMA an assumed property.`,
      clientDraft: verified('cma_property')
        ? null
        : `${first(input.name)}, which property should I look at before a pricing conversation?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: verified('cma_property') ? 'Kyle to prepare the CMA from verified facts.' : 'The property address.',
      ifYesNext: 'Use only the address they give.',
      ifNoNext: 'Do not guess an address.',
      ifUnclearNext: 'Ask for the address once.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('CMA is needed. No value was invented.'),
      followUp: 'CMA reminder.',
      internalCode: 'cma_needed',
    });
  }

  if (verified('reply') && verified('reply')!.trim().split(/\s+/).length <= 3) {
    return finish({
      ...base,
      priority: 66,
      whyNow: 'Their reply was short. Match it.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: 'Got it. Checking on that now.',
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The one detail still needed.',
      ifYesNext: 'One next question.',
      ifNoNext: 'Stop.',
      ifUnclearNext: 'Ask one short question.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Short reply. Short draft. Nothing sent.'),
      followUp: 'Their next reply.',
      internalCode: 'short_reply',
    });
  }

  if (verified('schools_question')) {
    return finish({
      ...base,
      priority: 50,
      whyNow: 'They asked about schools. Stay on objective criteria.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. Do not steer.`,
      clientDraft: `${first(input.name)}, I can't rank neighborhoods that way. What do you need the location to be close to?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'An objective location need.',
      ifYesNext: 'Use that objective need only.',
      ifNoNext: 'Leave schools as unknown.',
      ifUnclearNext: 'Ask what they need to be close to.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('School question stayed objective. No demographic inference.'),
      followUp: 'Their location need.',
      internalCode: 'fair_housing',
    });
  }

  if (any('investor_strategy') && !verified('str_legal')) {
    return finish({
      ...base,
      priority: 52,
      whyNow: 'Investment criteria are incomplete. No rent, cap rate, or STR legality was invented.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. DATA NEEDED before any numbers.`,
      clientDraft: `${first(input.name)}, what strategy are you using, long term rent or something else? I won't guess the numbers.`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The strategy in their words.',
      ifYesNext: 'Ask one missing input. Label anything else DATA NEEDED.',
      ifNoNext: 'Stop the number talk.',
      ifUnclearNext: 'Ask the strategy once.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('No rent, occupancy, STR legality, cap rate, or ROI was invented.'),
      followUp: 'Their strategy.',
      internalCode: 'investor',
    });
  }

  if (any('gmail_draft') && !verified('gmail_sent')) {
    return finish({
      ...base,
      priority: 63,
      whyNow: 'A Gmail draft exists. It was not sent, so it is not prior contact.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. UNSENT DRAFT is not prior contact.`,
      clientDraft: `${first(input.name)}, Kyle with Redfin. I'm checking on ${property ?? 'the property you asked about'} now.`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Their reply to a message that is actually sent.',
      ifYesNext: 'Continue from what they say.',
      ifNoNext: 'The unsent draft still does not count as contact.',
      ifUnclearNext: 'Do not say you already emailed them.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Unsent Gmail draft was not treated as sent mail.'),
      followUp: 'After a real send.',
      internalCode: 'unsent_draft',
    });
  }

  if (verified('email_send_capability') === 'yes') {
    return finish({
      ...base,
      priority: 61,
      whyNow: 'Email could be sent by a provider. Approval was not given, so it stays a draft.',
      humanAction: 'APPROVAL REQUIRED. The email was not sent.',
      clientDraft: null,
      callOpening: null,
      emailDraft: `${first(input.name)}, Kyle with Redfin. I'm checking on ${property ?? 'the property you asked about'}.`,
      emailSubject: 'The property you asked about',
      waitFor: 'Kyle to approve before any send.',
      ifYesNext: 'Still do not send until a provider confirms it.',
      ifNoNext: 'Leave the draft.',
      ifUnclearNext: 'Do not mark it sent.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Email capability is not approval and not a send.'),
      followUp: 'Approval, then a provider confirmation.',
      internalCode: 'email_needs_approval',
    });
  }

  if (verified('compensation') === 'unknown') {
    return finish({
      ...base,
      priority: 62,
      whyNow: 'Compensation is not verified.',
      humanAction: 'COMPENSATION NEEDS VERIFICATION. Do not say the seller pays the commission.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The current agreement or brokerage rule.',
      ifYesNext: 'Quote only the verified amount.',
      ifNoNext: 'Leave it unknown.',
      ifUnclearNext: 'Do not promise the buyer owes nothing.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Compensation was not quoted.'),
      followUp: 'Verified compensation.',
      internalCode: 'compensation_unknown',
    });
  }

  if (verified('buyer_agreement_compensation')) {
    return finish({
      ...base,
      priority: 57,
      whyNow: 'Buyer agreement compensation is verified. Other compensation is not assumed.',
      humanAction: `BUYER AGREEMENT COMPENSATION ON FILE: ${verified('buyer_agreement_compensation')}. Do not quote anything else.`,
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Nothing unless another amount is verified.',
      ifYesNext: 'Use only this amount.',
      ifNoNext: 'Do not add a seller-paid claim.',
      ifUnclearNext: 'Leave other compensation unknown.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Only the verified buyer agreement amount is on the card.'),
      followUp: 'None until another verified amount exists.',
      internalCode: 'compensation_known',
    });
  }

  if (verified('listing_agent_contact') === 'missing') {
    return finish({
      ...base,
      priority: 68,
      whyNow: 'The buyer can still be contacted. The listing agent phone is not on file.',
      humanAction: `CLIENT CONTACT READY. LISTING AGENT CONTACT NEEDED. TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, Kyle with Redfin. I'm checking on ${property ?? 'the property'} now. Is that the main one you want to see?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Their answer, and a listing agent phone from a real source.',
      ifYesNext: 'Keep working the buyer side.',
      ifNoNext: 'Look up the listing agent in MLS or Redfin. Do not invent a number.',
      ifUnclearNext: 'Do not block the buyer card.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Listing agent phone is missing. No contact was invented.'),
      followUp: 'Listing agent from MLS or Redfin.',
      internalCode: 'listing_agent_missing',
    });
  }

  if (verified('listing_agent_name') && verified('listing_agent_phone') && !verified('access_issue')) {
    return finish({
      ...base,
      priority: 54,
      whyNow: 'A listing agent is on file. There is no access issue, so do not contact them yet.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. LISTING AGENT ON FILE. Do not contact them yet.`,
      clientDraft: `${first(input.name)}, Kyle with Redfin. I'm checking on ${property ?? 'the property'} now. Is that the main one you want to see?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether the buyer still wants that property.',
      ifYesNext: 'Contact the listing side only if access is the issue.',
      ifNoNext: 'Leave the listing agent alone.',
      ifUnclearNext: 'Do not text the listing agent just because the number exists.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note(`Listing agent ${verified('listing_agent_name')} is on file. They were not contacted.`),
      followUp: 'Buyer reply.',
      internalCode: 'listing_agent_found',
    });
  }

  if (verified('repeat_property_request') && property) {
    return finish({
      ...base,
      priority: 67,
      whyNow: `They asked about ${property} again. Prior request: ${verified('repeat_property_request')}.`,
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. REPEAT PROPERTY REQUEST.`,
      clientDraft: `${first(input.name)}, you asked about ${property} before. I'm checking on ${property} now. Is that still the one?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether it is still the one.',
      ifYesNext: 'Use the prior showing history before you schedule again.',
      ifNoNext: 'Ask which property instead.',
      ifUnclearNext: 'Ask once more.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Repeat property request. History was not erased.'),
      followUp: 'Their answer.',
      internalCode: 'repeat_property',
    });
  }

  if (verified('area_flexibility') === 'nearby') {
    return finish({
      ...base,
      priority: 56,
      whyNow: 'They already said nearby works. Do not ask that again.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, you said nearby works. What caught your eye about ${property ?? 'the last one'}?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'What they liked.',
      ifYesNext: 'Use that to shape the next property.',
      ifNoNext: 'Ask which feature mattered.',
      ifUnclearNext: 'Ask what caught their eye, once.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Nearby flexibility is already known.'),
      followUp: 'What they liked.',
      internalCode: 'open_nearby',
    });
  }

  if (verified('area_change')) {
    return finish({
      ...base,
      priority: 65,
      whyNow: 'They changed the area. The old area is not the current search.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. Area criteria changed.`,
      clientDraft: `${first(input.name)}, you moved the search to ${verified('area_change')}. I'll use that area. What else should stay?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'What else stays in the search.',
      ifYesNext: 'Update the existing search and keep the history.',
      ifNoNext: 'Keep only the new area.',
      ifUnclearNext: 'Ask once what should stay.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note(`Area changed to ${verified('area_change')}. The prior area was not deleted from history.`),
      followUp: 'Search update.',
      internalCode: 'area_change',
    });
  }

  if (verified('search_hard') && verified('search_soft')) {
    return finish({
      ...base,
      priority: 64,
      whyNow: 'Enough criteria exist to build a search without overfiltering.',
      humanAction: `CREATE SEARCH NOW. REQUIRED: ${verified('search_hard')}. PREFERRED: ${verified('search_soft')}. DO NOT FILTER OUT YET: ${verified('search_soft')}.`,
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Kyle to create or update the search.',
      ifYesNext: 'Keep the soft items as preferences.',
      ifNoNext: 'Do not turn a preference into a hard filter.',
      ifUnclearNext: 'Leave soft items off the required list.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Search splits required filters from preferences.'),
      followUp: 'Search created.',
      internalCode: 'search_filters',
    });
  }

  if (verified('timeline') === 'future') {
    return finish({
      ...base,
      priority: 48,
      whyNow: 'The timeline is later. This is not an offer today.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. Future timeline. Not offer ready.`,
      clientDraft: `${first(input.name)}, if the right place came up, is this a few months out?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'How far out they are.',
      ifYesNext: 'Set a follow up for that window.',
      ifNoNext: 'Ask what would move the timing.',
      ifUnclearNext: 'Do not push an offer.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Future timeline was not treated as offer ready.'),
      followUp: 'The date they name.',
      internalCode: 'future_timeline',
    });
  }

  if (verified('answered') === 'motivation') {
    return finish({
      ...base,
      priority: 53,
      whyNow: 'They already answered motivation. Ask the next useful question.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, are you pretty set on this area or open nearby too?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Area flexibility.',
      ifYesNext: 'Ask what the next place needs to give them.',
      ifNoNext: 'Stay on the area they named.',
      ifUnclearNext: 'Do not ask motivation again.',
      qualificationQuestion: 'Are you pretty set on this area or open nearby too?',
      askQualificationNow: true,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Motivation is known. It was not asked again.'),
      followUp: 'Their area answer.',
      internalCode: 'next_question',
    });
  }

  if (verified('detailed_question')) {
    return finish({
      ...base,
      priority: 59,
      whyNow: 'They asked for detail. Answer only what is verified.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: `${first(input.name)}, I can walk through only the facts on file for ${property ?? 'that property'}. Which piece do you want first: status, price, or access?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Which fact they want.',
      ifYesNext: 'Answer that one fact if it is verified. Otherwise say DATA NEEDED.',
      ifNoNext: 'Stop.',
      ifUnclearNext: 'Ask which piece, once.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Detailed question. No unverified fact was stated as fact.'),
      followUp: 'The fact they pick.',
      internalCode: 'detailed_question',
    });
  }

  if (verified('decision_makers') === 'spouse') {
    return finish({
      ...base,
      priority: 51,
      whyNow: 'A spouse is already a decision maker. Do not ask who decides.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW. Decision makers are already on file.`,
      clientDraft: `${first(input.name)}, Kyle with Redfin. I'm checking on ${property ?? 'the property'} now. Is that the main one you both want to see?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether that property is the one.',
      ifYesNext: 'Keep both people in the next step.',
      ifNoNext: 'Ask which property.',
      ifUnclearNext: 'Do not ask who the decision maker is.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Spouse is already a decision maker.'),
      followUp: 'Their property answer.',
      internalCode: 'decision_makers',
    });
  }

  if (verified('referral_update') === 'due') {
    return finish({
      ...base,
      priority: 49,
      whyNow: 'A referral partner is waiting on a status. Only a verified fact can go back.',
      humanAction: 'REFERRAL STATUS UPDATE. Record only a verified fact. Do not invent a conversation.',
      clientDraft: null,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'A verified status.',
      ifYesNext: 'Send that status only after Kyle confirms it.',
      ifNoNext: 'Do not invent progress.',
      ifUnclearNext: 'Leave the referral update blank.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Referral update uses verified facts only.'),
      followUp: 'Verified status.',
      internalCode: 'referral_update',
    });
  }

  if (verified('owns_home') === 'yes' && verified('sale_dependency') !== 'homeowner_no_sale') {
    return finish({
      ...base,
      priority: 48,
      whyNow: 'They own a home. That is a potential listing opportunity, not a signed listing.',
      humanAction: 'LISTING OPPORTUNITY. Confirm whether they want a conversation about selling the home they own. Do not open a listing file until they say yes.',
      clientDraft: property
        ? `${first(input.name)}, Kyle with Redfin. I'm checking on ${property} now. Do you also want to talk about the home you own?`
        : `${first(input.name)}, Kyle with Redfin. You own a home. Do you want to talk about selling it, or is the purchase the only thing for now?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'Whether they want a listing conversation.',
      ifYesNext: 'Ask which home, then where to pull the address.',
      ifNoNext: 'Stay on the purchase. Do not open a listing file.',
      ifUnclearNext: 'Ask once. Do not assume a listing.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: 'Buyer owns a home. Listing conversation has not started. No listing file was opened.',
      followUp: 'Their yes or no on a listing conversation.',
      internalCode: 'listing_opportunity',
    });
  }

  if (verified('owns_home') === 'yes' && verified('sale_dependency') === 'homeowner_no_sale') {
    return finish({
      ...base,
      priority: 47,
      whyNow: 'They own a home and do not need to sell. That is not a listing opportunity.',
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
      clientDraft: property
        ? `${first(input.name)}, Kyle with Redfin. I'm checking on ${property} now. Is that the main one you want to see?`
        : `${first(input.name)}, Kyle with Redfin. What property should I look at first?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'The property they want.',
      ifYesNext: 'Stay on the purchase.',
      ifNoNext: 'Do not open a listing file.',
      ifUnclearNext: 'Do not pitch a CMA.',
      qualificationQuestion: null,
      askQualificationNow: false,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Ownership without a required sale is not a listing opportunity.'),
      followUp: 'Their property answer.',
      internalCode: 'owns_no_sale',
    });
  }

  if (verified('saved_search') && !verified('property_address')) {
    const search = verified('saved_search');
    return finish({
      ...base,
      priority: 70,
      whyNow: 'A saved search is on file. One question, tied to that search.',
      humanAction: `CREATE SEARCH NOW. REQUIRED: ${search}. PREFERRED: none stated. DO NOT FILTER OUT YET: price, beds, and baths not written in the search.`,
      clientDraft: `${first(input.name)}, Kyle with Redfin. You're still saving ${search}. What's prompting the move?`,
      callOpening: null,
      emailDraft: null,
      emailSubject: null,
      waitFor: 'What is prompting the move.',
      ifYesNext: 'One next question from that answer.',
      ifNoNext: 'Stay on the search they already saved.',
      ifUnclearNext: 'Ask the same question once.',
      qualificationQuestion: 'What is prompting the move?',
      askQualificationNow: true,
      showingState: showing.state,
      customerPropertyState: showing.customerState,
      agentToolsNote: note('Saved search is on file. The cell may still be missing.'),
      followUp: 'Their answer.',
      internalCode: 'saved_search',
    });
  }

  const draft = property
    ? `${first(input.name)}, Kyle with Redfin. I'm checking on ${property} now. Is that the main one you want to see?`
    : `${first(input.name)}, Kyle with Redfin. What property should I look at first?`;
  return finish({
    ...base,
    priority: 50,
    whyNow: property ? 'Handle the property they asked about before qualification.' : 'The property is not on file.',
    humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
    clientDraft: draft,
    callOpening: null,
    emailDraft: null,
    emailSubject: null,
    waitFor: 'Whether that property is the main one.',
    ifYesNext: 'What caught your eye about this one?',
    ifNoNext: 'Ask which area they want.',
    ifUnclearNext: 'Ask the property question once more.',
    qualificationQuestion: 'What is prompting the move?',
    askQualificationNow: false,
    showingState: showing.state,
    customerPropertyState: showing.customerState,
    agentToolsNote: note('First step is the property request. Motivation waits.'),
    followUp: 'Their answer about the property.',
    internalCode: 'property_first',
  });
}

const SHOWING_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function collectShowingLines(facts: DeskFact[]): { lines: string[]; conflict: string | null } {
  const lines: string[] = [];
  const dates: string[] = [];
  for (const fact of facts) {
    if (!isShowingFact(fact)) continue;
    const line = formatShowingLine(fact);
    if (!line || lines.includes(line.text)) continue;
    lines.push(line.text);
    if (line.date !== 'DATA NEEDED' && !dates.includes(line.date)) dates.push(line.date);
  }
  const conflict = dates.length > 1
    ? `SHOWING CONFLICT: ${dates.join(' and ')} are both on file. Do not pick one. Outcome is not confirmed.`
    : null;
  return { lines, conflict };
}

function isShowingFact(fact: DeskFact): boolean {
  if (/sms_draft|gmail_draft|unsent_draft|showing_address|saved_search|hot_score|lead_source|reminders/.test(fact.field)) return false;
  if (/showing_detail|gmail_tour|associate_tour|scheduled_tour_note|coordinator_tour/.test(fact.field)) return true;
  if (fact.field !== 'buying_activity' && fact.field !== 'showing_requested') return false;
  if (/meeting scheduled/i.test(fact.value)) return false;
  return /upcoming tour|tour agent scheduled|scheduled tour|\btour\b|showing/i.test(fact.value);
}

function formatShowingLine(fact: DeskFact): { text: string; date: string } | null {
  const structured = parseStructuredShowing(fact.value);
  const date = structured?.date || proseDate(fact.value) || 'DATA NEEDED';
  const time = structured?.time || proseTime(fact.value) || 'DATA NEEDED';
  const agent = structured?.agent || proseAgent(fact.value) || 'DATA NEEDED';
  const outcome = structured?.outcome || proseOutcome(fact.value);
  const evidence = structured?.evidenceClass || showingEvidenceClass(fact);
  if (date === 'DATA NEEDED' && time === 'DATA NEEDED' && agent === 'DATA NEEDED') return null;
  return {
    date,
    text: `${date} ${time} ${agent} showing, ${outcome}. Evidence: ${evidence}.`,
  };
}

function parseStructuredShowing(value: string): { date: string; time: string; agent: string; outcome: string; evidenceClass: string } | null {
  if (!/date=/.test(value)) return null;
  const grab = (key: string) => value.match(new RegExp(`(?:^|;)\\s*${key}=([^;]+)`))?.[1]?.trim() ?? '';
  return {
    date: grab('date') || 'DATA NEEDED',
    time: grab('time') || 'DATA NEEDED',
    agent: grab('agent') || 'DATA NEEDED',
    outcome: grab('outcome') || 'OUTCOME NOT CONFIRMED',
    evidenceClass: grab('class') || 'SOURCE REPORTED',
  };
}

function proseDate(value: string): string | null {
  const iso = value.match(/\b20\d{2}-(\d{2})-(\d{2})\b/);
  if (iso?.[1] && iso[2]) return `${Number(iso[1])}/${Number(iso[2])}`;
  const month = value.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i);
  if (!month?.[1] || !month[2]) return null;
  const number = SHOWING_MONTHS[month[1].slice(0, 3).toLowerCase()];
  return number ? `${number}/${Number(month[2])}` : null;
}

function proseTime(value: string): string | null {
  const match = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match?.[1] || !match[3]) return null;
  const hour = Number(match[1]);
  const minute = match[2] ?? '00';
  const mer = match[3].toUpperCase();
  if (!minute || minute === '00') return `${hour} ${mer}`;
  return `${hour}:${minute} ${mer}`;
}

function proseAgent(value: string): string | null {
  const patterns = [
    /associate agent ([A-Z][a-z]+ [A-Z][a-z]+)/,
    /showing agent ([A-Z][a-z]+ [A-Z][a-z]+)/,
    /coordinator ([A-Z][a-z]+ [A-Z][a-z]+)/,
    /associate ([A-Z][a-z]+ [A-Z][a-z]+)/,
    /with ([A-Z][a-z]+ [A-Z][a-z]+)/,
  ];
  for (const pattern of patterns) {
    const found = value.match(pattern);
    if (found?.[1]) return found[1];
  }
  return null;
}

function proseOutcome(value: string): string {
  if (/\bcancel/i.test(value) && !/not cancel/i.test(value)) return 'SHOWING CANCELLED';
  return 'OUTCOME NOT CONFIRMED';
}

function showingEvidenceClass(fact: DeskFact): string {
  if (fact.kind === 'inference') return 'SYSTEM INFERENCE';
  if (fact.verification !== 'verified') return 'SOURCE REPORTED';
  if (fact.field === 'buying_activity') return 'THIRD PARTY REPORTED';
  return 'VERIFIED FACT';
}

function heldWhy(input: DeskEvidence): string {
  const any = (field: string) => input.facts.find((fact) => fact.field === field)?.value ?? '';
  const parts: string[] = [];
  const note = any('recent_note');
  if (/offer/i.test(`${note} ${any('buying_activity')}`)) {
    parts.push(note || any('buying_activity'));
    parts.push('This is an offer request, not offer ready.');
  }
  const searches = (any('saved_search')).split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  if (searches.length > 1) {
    parts.push(`Two saved searches are on file: ${searches.join(' | ')}.`);
    if (/text/i.test(any('agent_tools_tags'))) parts.push('Prefers text.');
    parts.push('Do not turn them into filters until the buyer picks one.');
  }
  if (/sell first/i.test(any('agent_tools_tags'))) parts.push('Needs to sell first.');
  const cma = overdueCma(input);
  if (cma) parts.push(`CMA reminder is overdue: ${cma}.`);
  parts.push('No verified cell.');
  return parts.join(' ');
}

function searchPlanFor(input: DeskEvidence): ExecutionCard['searchPlan'] {
  const verifiedValue = (field: string) => input.facts.find((fact) => fact.field === field && fact.kind === 'fact' && fact.verification === 'verified')?.value ?? '';
  const hard = verifiedValue('search_hard');
  const soft = verifiedValue('search_soft');
  if (hard) {
    return { mode: 'create', required: hard, preferred: soft || 'None stated', doNotFilter: soft || 'Nothing else stated' };
  }
  const raw = verifiedValue('saved_search');
  if (!raw) return { mode: 'none', required: 'none on file', preferred: 'none on file', doNotFilter: 'Do not invent filters.' };
  const parts = raw.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    return { mode: 'conflict', required: 'Not set. The searches conflict', preferred: 'Not set', doNotFilter: parts.join(' | ') };
  }
  return { mode: 'create', required: raw, preferred: 'None stated', doNotFilter: 'Price, beds, and baths that are not in the saved search.' };
}

function justifiedShowings(input: DeskEvidence, current: string): string[] {
  const verified = (field: string) => input.facts.find((fact) => fact.field === field && fact.kind === 'fact' && fact.verification === 'verified')?.value ?? '';
  const states: string[] = [];
  const add = (state: ShowingState) => {
    if (!states.includes(state)) states.push(state);
  };
  if (verified('showing_requested') || /tour request/i.test(verified('buying_activity'))) add('CUSTOMER_REQUESTED');
  if (input.facts.some((fact) => fact.verification === 'verified' && scheduledTourLanguage(fact.field, fact.value))) add('SHOWING_REQUEST_CREATED');
  if (verified('listing_side_contacted')) add('LISTING_SIDE_CONTACTED');
  if (current === 'ACCESS_PENDING') add('ACCESS_PENDING');
  if (verified('access_confirmed')) add('ACCESS_CONFIRMED');
  if (verified('buyer_notified')) add('BUYER_NOTIFIED');
  if (verified('buyer_acknowledged')) add('BUYER_ACKNOWLEDGED');
  if (current === 'SHOWING_SCHEDULED') add('SHOWING_SCHEDULED');
  if (current === 'SHOWING_COMPLETED') add('SHOWING_COMPLETED');
  if (current === 'SHOWING_CANCELLED') add('SHOWING_CANCELLED');
  if (/cancel/i.test(verified('buying_activity'))) add('SHOWING_CANCELLED');
  if (verified('reschedule')) add('RESCHEDULE_NEEDED');
  if (current === 'OUTCOME_UNKNOWN') add('OUTCOME_UNKNOWN');
  return states.filter((state) => (SHOWING_STATES as readonly string[]).includes(state));
}

function overdueCma(input: DeskEvidence): string | null {
  for (const fact of input.facts) {
    if (fact.kind !== 'fact' || fact.verification !== 'verified') continue;
    if (!/cma/i.test(`${fact.field} ${fact.value}`)) continue;
    if (scheduledTourIsStale(fact.value, input.now)) return fact.value;
  }
  return null;
}

function deriveShowing(input: DeskEvidence, property: string | null): { state: string; customerState: string; associateOnly: boolean } {
  const verified = (field: string) => input.facts.find((fact) => fact.field === field && fact.kind === 'fact' && fact.verification === 'verified')?.value ?? null;
  const inference = input.facts.find((fact) => /associate_tour|coordinator_tour|coordinator_contact|showing_agent/i.test(fact.field) && fact.verification !== 'verified');
  const scheduledFact = input.facts.find((fact) => fact.kind === 'fact' && fact.verification === 'verified' && scheduledTourLanguage(fact.field, fact.value));
  const scheduled = verified('scheduled_tour_note') || scheduledFact?.value || '';
  const past = scheduled ? scheduledTourIsStale(scheduled, input.now) : false;
  if (verified('showing_outcome') === 'completed' && /kyle/i.test(verified('showing_outcome_by') ?? '')) {
    return { state: 'SHOWING_COMPLETED', customerState: 'Completed', associateOnly: false };
  }
  if (inference && /coordinator|associate|showing agent/i.test(`${inference.field} ${inference.value}`)) {
    return { state: 'OUTCOME_UNKNOWN', customerState: 'Unknown', associateOnly: true };
  }
  if (scheduled && /\bcancel/i.test(scheduled) && !/not cancel/i.test(scheduled)) {
    return { state: 'SHOWING_CANCELLED', customerState: 'Cancelled', associateOnly: false };
  }
  if (scheduled && past) return { state: 'OUTCOME_UNKNOWN', customerState: 'Past scheduled', associateOnly: false };
  if (verified('showing_requested') || /tour request/i.test(scheduled)) {
    return { state: 'CUSTOMER_REQUESTED', customerState: 'Requested', associateOnly: false };
  }
  if (scheduled && !past) return { state: 'SHOWING_SCHEDULED', customerState: 'Scheduled', associateOnly: false };
  return { state: property ? 'UNKNOWN' : 'UNKNOWN', customerState: 'Unknown', associateOnly: false };
}

function link(label: string, url: string | null): ExecutionCard['links'][number] {
  if (url && URL_OK.test(url)) return { label, url, status: 'verified' };
  return { label, url: null, status: 'LINK NOT FOUND' };
}

function first(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export interface BriefBucket {
  label: string;
  count: number;
  links: Array<{ name: string; anchor: string }>;
}

function bucket(label: string, cards: ExecutionCard[], include: (card: ExecutionCard) => boolean): BriefBucket {
  const hits = cards.filter(include);
  return { label, count: hits.length, links: hits.map((card) => ({ name: card.clientName, anchor: card.anchor })) };
}

export function morningSections(cards: ExecutionCard[]): { header: BriefBucket[]; summary: BriefBucket[] } {
  const missing = (card: ExecutionCard) => card.internalCode === 'needs_contact' || /GET .+ CELL/.test(card.humanAction);
  const postTour = (card: ExecutionCard) => card.showingState === 'OUTCOME_UNKNOWN';
  const offers = (card: ExecutionCard) => card.internalCode.startsWith('offer_')
    || /Offer request only|not offer ready/i.test(card.offerReadiness.nextAction)
    || (/offer request/i.test(`${card.whyNow} ${card.agentToolsNote}`) && !/No offer request is on file/i.test(card.offerReadiness.nextAction));
  const header: BriefBucket[] = [
    bucket('Actionable clients', cards, (card) => card.internalCode !== 'do_not_contact'),
    bucket('Showings today', cards, (card) => card.showingState === 'ACCESS_PENDING' || card.showingState === 'SHOWING_SCHEDULED'),
    bucket('Showings requiring confirmation', cards, (card) => card.showingState === 'CUSTOMER_REQUESTED' || card.showingState === 'ACCESS_PENDING'),
    bucket('Hot post-tour clients', cards, postTour),
    bucket('Offers or offer requests', cards, offers),
    bucket('Financing blockers', cards, (card) => card.internalCode === 'needs_preapproval'),
    bucket('Buy after sell clients', cards, (card) => card.internalCode === 'sale_dependency' || card.internalCode === 'cma_needed'),
    bucket('Listing opportunities', cards, (card) => card.internalCode === 'listing_opportunity'),
    bucket('Listing agents needing contact', cards, (card) => card.internalCode === 'listing_agent_missing'),
    bucket('Agent Tools records needing updates', cards, (card) => card.internalCode !== 'do_not_contact'),
    bucket('Missing contact info', cards, missing),
    bucket('Overdue actions', cards, (card) => card.internalCode === 'cma_needed' || /overdue/i.test(`${card.whyNow} ${card.humanAction}`)),
    bucket('Waiting on client', cards, postTour),
    bucket('Waiting on listing side', cards, (card) => card.internalCode === 'listing_agent_missing'),
  ];
  const summary: BriefBucket[] = [
    bucket('CALLS TO MAKE', cards, (card) => Boolean(card.callOpening)),
    bucket('TEXTS TO SEND', cards, (card) => Boolean(card.clientDraft)),
    bucket('EMAILS TO SEND', cards, (card) => Boolean(card.emailDraft)),
    bucket('LISTING AGENTS TO CONTACT', cards, (card) => card.internalCode === 'listing_agent_missing'),
    bucket('SHOWINGS TO CONFIRM', cards, (card) => card.showingState === 'CUSTOMER_REQUESTED' || card.showingState === 'ACCESS_PENDING'),
    bucket('SHOWINGS TODAY', cards, (card) => card.showingState === 'ACCESS_PENDING' || card.showingState === 'SHOWING_SCHEDULED'),
    bucket('POST TOUR FOLLOW UPS', cards, postTour),
    bucket('FINANCING ITEMS', cards, (card) => card.internalCode === 'needs_preapproval'),
    bucket('BUY AFTER SELL ITEMS', cards, (card) => card.internalCode === 'sale_dependency' || card.internalCode === 'cma_needed'),
    bucket('CMAS NEEDED', cards, (card) => card.internalCode === 'cma_needed'),
    bucket('OFFERS AND OFFER REQUESTS', cards, offers),
    bucket('UNDER CONTRACT ITEMS', cards, (card) => card.internalCode === 'effective_date' || /under contract/i.test(card.customerPropertyState)),
    bucket('CONTACT INFORMATION TO FIND', cards, missing),
    bucket('AGENT TOOLS UPDATES', cards, (card) => card.internalCode !== 'do_not_contact'),
    bucket('WAITING ON CLIENT', cards, postTour),
    bucket('WAITING ON LISTING SIDE', cards, (card) => card.internalCode === 'listing_agent_missing'),
    bucket('OVERDUE ACTIONS', cards, (card) => card.internalCode === 'cma_needed' || /overdue/i.test(`${card.whyNow} ${card.humanAction}`)),
  ];
  return { header, summary };
}

function bucketLine(item: BriefBucket): string {
  if (item.links.length === 0) return `${item.label}: 0`;
  return `${item.label}: ${item.count} ${item.links.map((link) => `${link.name} (#${link.anchor})`).join(', ')}`;
}

export function easternClock(now: Date): { date: string; easternTime: string } {
  return {
    date: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now),
    easternTime: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(now),
  };
}

export function renderMorningBrief(cards: ExecutionCard[], now: Date, clockSource: 'production' | 'injected' = 'production'): string {
  const clock = easternClock(now);
  const ordered = [...cards];
  const sections = morningSections(ordered);
  const lines = [
    'KYLEOS MORNING BRIEF',
    `Date: ${clock.date}`,
    `Current ET: ${clock.easternTime}`,
    `Clock: ${clockSource} / America/New_York`,
    ...sections.header.map(bucketLine),
    '',
    'DO THESE FIRST',
  ];
  ordered.forEach((card, index) => {
    lines.push(
      '',
      `PRIORITY ${index + 1} / TIER ${card.tier} / ${card.horizon} / ${card.clientName.toUpperCase()}`,
      `WHY NOW: ${card.whyNow}`,
      `STAGE: ${card.clientStage}`,
      `ACTION: ${card.actionVerb}`,
      `EXECUTION ADAPTER: ${card.executionAdapter}`,
      `PROPERTY: ${card.propertyAddress ?? 'DATA NEEDED'}`,
      `PROPERTY STATUS: ${card.propertyStatus}`,
      `SHOWING: ${card.showingLabel}`,
      ...(card.showingLines.length ? card.showingLines : ['SHOWING DETAIL: none on file']),
      card.showingConflict ?? 'SHOWING CONFLICT: none',
      `DO THIS: ${card.primaryAction}`,
      card.secondaryActions.length ? `THEN: ${card.secondaryActions.join(' ')}` : 'THEN: none',
      card.searchPlan.mode === 'none' ? 'SEARCH: none on file' : `SEARCH: ${card.searchPlan.mode.toUpperCase()}. REQUIRED: ${card.searchPlan.required}. PREFERRED: ${card.searchPlan.preferred}. DO NOT FILTER OUT YET: ${card.searchPlan.doNotFilter}`,
      `OFFER READINESS: ${card.offerReadiness.readiness}`,
      `OFFER NEXT ACTION: ${card.offerReadiness.nextAction}`,
      card.transactionLine,
      ...card.milestones
        .filter((item) => item.status !== 'Not on file')
        .map((item) => `${item.name}: STATUS ${item.status} / OWNER ${item.owner} / DEADLINE ${item.deadline} / SOURCE ${item.source} / NEXT ACTION ${item.nextAction}`),
      card.clientDraft ? `COPY: ${card.clientDraft}` : 'COPY: none',
      card.callOpening ? `CALL OPENING: ${card.callOpening}` : 'CALL OPENING: none',
      card.emailDraft ? `EMAIL SUBJECT: ${card.emailSubject ?? ''}\nEMAIL: ${card.emailDraft}` : 'EMAIL: none',
      `WAIT FOR: ${card.waitFor}`,
      `IF YES: ${card.ifYesNext}`,
      `IF NO: ${card.ifNoNext}`,
      `IF UNCLEAR: ${card.ifUnclearNext}`,
      `AGENT TOOLS NOTE: ${card.agentToolsNote}`,
      card.guardrail,
      `UPDATE AGENT TOOLS: OPEN ${card.agentToolsUpdate.open} / PASTE / THEN SET: ${card.agentToolsUpdate.thenSet}`,
      `LINKS: ${card.links.map((item) => `${item.label} ${item.status === 'verified' ? item.url : 'LINK NOT FOUND'}`).join(' | ')}`,
      `SOURCE: ${card.leadSource}${card.sourceConflict ? ' / SOURCE ATTRIBUTION CONFLICT' : ''}`,
      `FOLLOW UP: ${card.followUp}`,
      card.askQualificationNow ? `NEXT QUESTION: ${card.qualificationQuestion}` : 'NEXT QUALIFICATION: do not ask yet',
    );
  });
  lines.push('', 'SUMMARY', ...sections.summary.map(bucketLine), 'Nothing was sent. Agent Tools was not written.');
  return lines.join('\n');
}

const TIER_0 = new Set([
  'tour_follow_up', 'call_requested', 'promise', 'offer_accepted', 'offer_submitted', 'offer_draft',
  'offer_interest', 'offer_terms_missing', 'closed', 'effective_date', 'inspection_deadline',
  'walkthrough_scheduled', 'loan_not_ctc', 'calendar_conflict',
]);
const TIER_1 = new Set([
  'needs_preapproval', 'sale_dependency', 'listing_agent_missing', 'property_conflict', 'inspection_unknown',
]);
const TIER_2 = new Set([
  'showing_requested', 'saved_search', 'property_first', 'needs_contact', 'waiting', 'property_unavailable', 'cma_needed',
]);

export function tierFor(internalCode: string, showingState: string): 0 | 1 | 2 | 3 {
  if (showingState === 'OUTCOME_UNKNOWN' || showingState === 'SHOWING_SCHEDULED') return 0;
  if (TIER_0.has(internalCode)) return 0;
  if (TIER_1.has(internalCode)) return 1;
  if (TIER_2.has(internalCode)) return 2;
  return 3;
}

export function showingLabel(state: string): string {
  const labels: Record<string, string> = {
    CUSTOMER_REQUESTED: 'CUSTOMER REQUESTED',
    SHOWING_REQUEST_CREATED: 'REQUEST CREATED',
    LISTING_SIDE_CONTACTED: 'LISTING SIDE CONTACTED',
    ACCESS_PENDING: 'ACCESS PENDING',
    ACCESS_CONFIRMED: 'ACCESS CONFIRMED',
    BUYER_NOTIFIED: 'BUYER NOTIFIED',
    BUYER_ACKNOWLEDGED: 'BUYER ACKNOWLEDGED',
    SHOWING_SCHEDULED: 'SCHEDULED',
    SHOWING_COMPLETED: 'COMPLETED',
    SHOWING_CANCELLED: 'CANCELLED',
    RESCHEDULE_NEEDED: 'RESCHEDULE NEEDED',
    OUTCOME_UNKNOWN: 'POST TOUR VERIFICATION NEEDED',
    UNKNOWN: 'UNKNOWN',
  };
  return labels[state] ?? state.replaceAll('_', ' ');
}
