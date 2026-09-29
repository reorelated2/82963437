import { scheduledTourIsStale, scheduledTourLanguage } from '../conversion/engine.ts';
import { screenKyleVoice } from '../conversion/policy.ts';

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

  const finish = (card: Omit<ExecutionCard, 'manualActionRequired' | 'approvalRequired' | 'live'> & { manualActionRequired?: true; approvalRequired?: true; live?: false }): ExecutionCard => {
    const full: ExecutionCard = { ...card, manualActionRequired: true, approvalRequired: true, live: false };
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
      if (!/Do not send that draft/.test(full.agentToolsNote)) {
        full.agentToolsNote = `${full.agentToolsNote} An unsent draft claims the tour already happened. Do not send that draft. It is not prior contact and it is not a completed tour.`;
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
      customerPropertyState: 'Scheduled',
      agentToolsNote: note(`Do not mark the showing completed until the customer confirms it. Prepared text asks whether they saw ${property ?? 'the property'}.`),
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
      whyNow: 'No verified cell or email.',
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
      agentToolsNote: note([
        'No verified cell. No number was invented.',
        offerMention ? 'Agent Tools mentions an offer request. It is not a confirmed submission.' : '',
        any('saved_search') ? `Saved search stays on file: ${any('saved_search')}.` : '',
        /text/i.test(any('agent_tools_tags') ?? '') ? 'Agent Tools tag says prefers text. That tag is not a sent message.' : '',
        'The draft cannot be sent until a cell is on file.',
      ].filter(Boolean).join(' ')),
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
      humanAction: `CREATE SEARCH NOW. REQUIRED: ${verified('search_hard')}. DO NOT FILTER OUT YET: ${verified('search_soft')}.`,
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
      humanAction: `TEXT ${input.name.toUpperCase()} NOW.`,
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
      agentToolsNote: note('Saved search is on file. The cell may still be missing. Nothing was sent.'),
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
  if (scheduled && past) return { state: 'OUTCOME_UNKNOWN', customerState: 'Scheduled', associateOnly: false };
  if (verified('showing_requested') || /tour request/i.test(scheduled)) {
    return { state: 'CUSTOMER_REQUESTED', customerState: 'Requested', associateOnly: false };
  }
  if (scheduled && !past) return { state: 'ACCESS_PENDING', customerState: 'Scheduled', associateOnly: false };
  return { state: property ? 'UNKNOWN' : 'UNKNOWN', customerState: 'Unknown', associateOnly: false };
}

function link(label: string, url: string | null): ExecutionCard['links'][number] {
  if (url && URL_OK.test(url)) return { label, url, status: 'verified' };
  return { label, url: null, status: 'LINK NOT FOUND' };
}

function first(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function renderMorningBrief(cards: ExecutionCard[], now: Date): string {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(now);
  const ordered = [...cards];
  const lines = [
    `MORNING EXECUTION BRIEF`,
    when,
    `Actionable clients: ${ordered.filter((card) => card.internalCode !== 'do_not_contact').length}`,
    `Showings needing outcome: ${ordered.filter((card) => card.showingState === 'OUTCOME_UNKNOWN').length}`,
    `Missing contact: ${ordered.filter((card) => card.internalCode === 'needs_contact' || /GET .+ CELL/.test(card.humanAction)).length}`,
    '',
    'DO THESE FIRST',
  ];
  ordered.forEach((card, index) => {
    lines.push(
      '',
      `PRIORITY ${index + 1} / ${card.clientName.toUpperCase()}`,
      `WHY NOW: ${card.whyNow}`,
      `STAGE: ${card.clientStage}`,
      `PROPERTY: ${card.propertyAddress ?? 'DATA NEEDED'}`,
      `PROPERTY STATUS: ${card.propertyStatus}`,
      `SHOWING: ${card.showingState}`,
      `DO THIS: ${card.humanAction}`,
      card.clientDraft ? `COPY: ${card.clientDraft}` : 'COPY: none',
      card.callOpening ? `CALL OPENING: ${card.callOpening}` : 'CALL OPENING: none',
      card.emailDraft ? `EMAIL SUBJECT: ${card.emailSubject ?? ''}\nEMAIL: ${card.emailDraft}` : 'EMAIL: none',
      `WAIT FOR: ${card.waitFor}`,
      `IF YES: ${card.ifYesNext}`,
      `IF NO: ${card.ifNoNext}`,
      `IF UNCLEAR: ${card.ifUnclearNext}`,
      `AGENT TOOLS NOTE: ${card.agentToolsNote}`,
      `LINKS: ${card.links.map((item) => `${item.label} ${item.status === 'verified' ? item.url : 'LINK NOT FOUND'}`).join(' | ')}`,
      `SOURCE: ${card.leadSource}${card.sourceConflict ? ' / SOURCE ATTRIBUTION CONFLICT' : ''}`,
      `FOLLOW UP: ${card.followUp}`,
      card.askQualificationNow ? `NEXT QUESTION: ${card.qualificationQuestion}` : 'NEXT QUALIFICATION: do not ask yet',
    );
  });
  lines.push(
    '',
    'SUMMARY',
    `TEXTS TO SEND: ${ordered.filter((card) => card.clientDraft).length}`,
    `CALLS TO MAKE: ${ordered.filter((card) => card.callOpening).length}`,
    `EMAILS TO SEND: ${ordered.filter((card) => card.emailDraft).length}`,
    `LISTING AGENTS TO CONTACT: ${ordered.filter((card) => card.internalCode === 'listing_agent_missing').length}`,
    `SHOWINGS TO CONFIRM: ${ordered.filter((card) => card.showingState === 'CUSTOMER_REQUESTED' || card.showingState === 'ACCESS_PENDING').length}`,
    `POST TOUR FOLLOW UPS: ${ordered.filter((card) => card.showingState === 'OUTCOME_UNKNOWN').length}`,
    `FINANCING ITEMS: ${ordered.filter((card) => card.internalCode === 'needs_preapproval').length}`,
    `BUY AFTER SELL ITEMS: ${ordered.filter((card) => card.internalCode === 'sale_dependency').length}`,
    `CMAS NEEDED: ${ordered.filter((card) => card.internalCode === 'cma_needed').length}`,
    `OFFERS AND OFFER REQUESTS: ${ordered.filter((card) => card.internalCode.startsWith('offer_') || /offer request/i.test(card.agentToolsNote)).length}`,
    `CONTACT INFORMATION TO FIND: ${ordered.filter((card) => card.internalCode === 'needs_contact' || /GET .+ CELL/.test(card.humanAction)).length}`,
    'Nothing was sent. Agent Tools was not written.',
  );
  return lines.join('\n');
}
