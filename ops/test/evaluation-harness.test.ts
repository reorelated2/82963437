import assert from 'node:assert/strict';
import test from 'node:test';
import { planDesk, type DeskEvidence, type DeskFact, type ExecutionCard } from '../src/execution/plan.ts';

const NOW = new Date('2026-09-29T13:00:00.000Z');

function fact(field: string, value: string, kind: 'fact' | 'inference' = 'fact', verification: 'verified' | 'unverified' = 'verified'): DeskFact {
  return { field, value, kind, verification: kind === 'inference' ? 'unverified' : verification };
}

function evidence(facts: DeskFact[], extra: Partial<DeskEvidence> = {}): DeskEvidence {
  return {
    name: extra.name ?? 'Jamie Fixture',
    stage: extra.stage ?? 'NEW_INQUIRY',
    phone: extra.phone === undefined ? '3055550100' : extra.phone,
    email: extra.email === undefined ? 'jamie.fixture@example.com' : extra.email,
    dnc: extra.dnc ?? false,
    facts,
    now: extra.now ?? NOW,
  };
}

function boundaries(card: ExecutionCard, facts: DeskFact[]): void {
  assert.equal(card.live, false);
  assert.equal(card.approvalRequired, true);
  assert.equal(card.manualActionRequired, true);
  assert.match(card.guardrail, /draft is not a send/i);
  assert.doesNotMatch(card.executionAdapter, /provider sent|verified by integration/i);
  if (facts.some((item) => /draft/.test(item.field))) {
    assert.doesNotMatch(card.agentToolsNote, /TEXT SENT|message was sent by the desk/i);
  }
  if (card.showingState === 'CUSTOMER_REQUESTED' || card.showingState === 'SHOWING_SCHEDULED' || card.showingState === 'OUTCOME_UNKNOWN') {
    assert.notEqual(card.showingState, 'SHOWING_COMPLETED');
  }
  const inferred = facts.find((item) => item.kind === 'inference');
  if (inferred && card.clientDraft) {
    assert.equal(screenDoesNotTreatInferenceAsVerifiedCash(card, facts), true);
  }
}

function screenDoesNotTreatInferenceAsVerifiedCash(card: ExecutionCard, facts: DeskFact[]): boolean {
  const cashInference = facts.some((item) => item.field === 'cash_vs_finance' && item.verification !== 'verified');
  if (!cashInference) return true;
  return /not verified CASH/.test(`${card.whyNow} ${card.agentToolsNote}`);
}

const scenarios: Array<{ name: string; facts: DeskFact[]; extra?: Partial<DeskEvidence>; expect: RegExp; forbid?: RegExp }> = [
  { name: 'new buyer one property', facts: [fact('property_address', '10 Main St')], expect: /TEXT JAMIE FIXTURE NOW/ },
  { name: 'same property twice', facts: [fact('property_address', '10 Main St'), fact('inquiry_property', '10 Main St')], expect: /10 Main St/ },
  { name: 'showing requested unconfirmed', facts: [fact('showing_requested', 'tour request for 10 Main St'), fact('property_address', '10 Main St')], expect: /not confirmed/ },
  { name: 'past showing unknown outcome', facts: [fact('scheduled_tour_note', 'Scheduled tour 2026-09-20 4:00 PM'), fact('property_address', '10 Main St')], expect: /POST TOUR VERIFICATION NEEDED/ },
  { name: 'completed by associate agent', facts: [fact('coordinator_tour', 'Associate Agent Pat Example said the tour happened', 'inference')], expect: /SHOWING OUTCOME NOT CONFIRMED/ },
  { name: 'buyer asks call', facts: [fact('customer_asked', 'please call')], expect: /CALL JAMIE FIXTURE NOW/ },
  { name: 'property pending', facts: [fact('property_status', 'Pending'), fact('property_address', '10 Main St')], expect: /went pending/ },
  { name: 'open to nearby', facts: [fact('area_flexibility', 'nearby')], expect: /nearby/ },
  { name: 'cash buyer', facts: [fact('cash_vs_finance', 'cash'), fact('property_address', '10 Main St')], expect: /cash purchase/ },
  { name: 'financed without preapproval', facts: [fact('financing_state', 'NEEDS_PREAPPROVAL')], expect: /finance it or buy cash/ },
  { name: 'preapproved', facts: [fact('financing_state', 'PREAPPROVED'), fact('property_address', '10 Main St')], expect: /preapproval on file/ },
  { name: 'owns home no sale needed', facts: [fact('owns_home', 'yes'), fact('sale_dependency', 'homeowner_no_sale')], expect: /not a listing/i },
  { name: 'must sell', facts: [fact('sale_dependency', 'sale_required')], expect: /sell before you can buy/ },
  { name: 'proceeds required', facts: [fact('sale_dependency', 'proceeds_required')], expect: /proceeds/ },
  { name: 'spouse decision maker', facts: [fact('decision_makers', 'spouse')], expect: /spouse|decision/i },
  { name: 'missing cell', facts: [fact('property_address', '10 Main St')], extra: { phone: null, email: null }, expect: /GET JAMIE FIXTURE'S CELL/ },
  { name: 'missing listing agent phone', facts: [fact('listing_agent_contact', 'missing'), fact('property_address', '10 Main St')], expect: /LISTING AGENT/ },
  { name: 'listing agent found', facts: [fact('listing_agent_name', 'Pat Example'), fact('listing_agent_phone', '3055550177'), fact('property_address', '10 Main St')], expect: /Pat Example/ },
  { name: 'opt-out', facts: [fact('contact_preference', 'stop')], expect: /DO NOT CONTACT/ },
  { name: 'unsent gmail draft', facts: [fact('gmail_draft', 'Unsent draft. It was not sent.', 'inference'), fact('property_address', '10 Main St')], expect: /TEXT JAMIE FIXTURE NOW/ },
  { name: 'coordinator contacted but Kyle did not', facts: [fact('coordinator_contact', 'Coordinator reached the buyer', 'inference')], expect: /not a completed tour|NOT CONFIRMED|not Kyle/i },
  { name: 'agent tools upcoming but date passed', facts: [fact('scheduled_tour_note', 'Upcoming tour agent scheduled Sep 15')], expect: /POST TOUR VERIFICATION NEEDED/ },
  { name: 'cma reminder', facts: [fact('cma_due', 'Reminder May 18')], expect: /CMA NEEDED/ },
  { name: 'response changes qualification path', facts: [fact('answered', 'motivation')], expect: /do not ask|already/i },
  { name: 'short message gets a short reply', facts: [fact('reply', 'Yes')], expect: /Got it/ },
  { name: 'analytical question gets a direct answer', facts: [fact('detailed_question', 'What is the price per foot versus the building next door?')], expect: /TEXT JAMIE FIXTURE NOW|answer/i },
  { name: 'investor cash flow', facts: [fact('investor_strategy', 'cash flow', 'inference')], expect: /investor|DATA NEEDED|rent/i },
  { name: 'str unknown legality', facts: [fact('investor_strategy', 'short term rental', 'inference')], expect: /STR|legal|unknown/i },
  { name: 'school question', facts: [fact('schools_question', 'good schools')], expect: /can't rank|objective|close to/i },
  { name: 'area change', facts: [fact('area_change', 'Hollywood')], expect: /Hollywood/ },
  { name: 'hard versus soft prefs', facts: [fact('search_hard', '2 beds'), fact('search_soft', 'pool')], expect: /DO NOT FILTER OUT YET/ },
  { name: 'offer request', facts: [fact('wants_offer', 'yes')], expect: /MISSING/ },
  { name: 'offer missing terms', facts: [fact('offer_price', '500000'), fact('missing_terms', 'deposit')], expect: /Do not submit/ },
  { name: 'offer drafted not submitted', facts: [fact('offer_state', 'draft')], expect: /not been submitted|MISSING/ },
  { name: 'offer submitted with confirmation', facts: [fact('offer_state', 'submitted')], expect: /submitted/ },
  { name: 'offer accepted', facts: [fact('offer_state', 'accepted')], expect: /not closed|HUMAN REVIEW/ },
  { name: 'effective date', facts: [fact('effective_date', '2026-10-01')], expect: /EFFECTIVE DATE VERIFIED/ },
  { name: 'inspection', facts: [fact('inspection_deadline', '2026-10-10')], expect: /INSPECTION/ },
  { name: 'loan not clear', facts: [fact('loan_status', 'not_clear_to_close')], expect: /NOT CLEAR TO CLOSE/ },
  { name: 'walkthrough scheduled not complete', facts: [fact('walkthrough', 'scheduled')], expect: /not completed/ },
  { name: 'closing', facts: [fact('transaction_status', 'closed')], expect: /TRANSACTION CLOSED/ },
  { name: 'homeowner to listing opp', facts: [fact('owns_home', 'yes')], expect: /own|listing|sell/i },
  { name: 'referral source update', facts: [fact('referral_update', 'due')], expect: /referral/i },
  { name: 'lead source conflict', facts: [fact('lead_source', 'Redfin'), fact('lead_source_conflict', 'Agent Tools says Zillow')], expect: /SOURCE|conflict|Redfin/i },
  { name: 'multiple sources same client', facts: [fact('lead_source', 'Redfin'), fact('lead_source_history', 'gmail: redfin forward')], expect: /TEXT JAMIE FIXTURE NOW|Redfin/ },
  { name: 'phone preference', facts: [fact('preferred_channel', 'phone')], expect: /CALL JAMIE FIXTURE NOW/ },
  { name: 'spanish preference', facts: [fact('language', 'es')], expect: /Spanish|hola|Hola/i },
  { name: 'calendar conflict', facts: [fact('calendar_conflict', 'yes')], expect: /CALENDAR CONFLICT/ },
  { name: 'compensation unknown', facts: [fact('compensation', 'unknown')], expect: /compensation|unknown|do not/i },
  { name: 'buyer compensation known', facts: [fact('buyer_agreement_compensation', '2.5 percent')], expect: /2.5 percent/ },
  { name: 'sms draft cannot send', facts: [fact('property_address', '10 Main St')], expect: /TEXT JAMIE FIXTURE NOW/ },
  { name: 'email capability but no approval', facts: [fact('email_send_capability', 'yes')], expect: /approval|not sent|EMAIL/i },
  { name: 'future timeline', facts: [fact('timeline', 'future')], expect: /future|later|not now/i },
  { name: 'stop', facts: [], extra: { dnc: true }, expect: /DO NOT CONTACT/ },
  { name: 'property conflict', facts: [fact('property_conflict', 'MLS says active, Redfin says pending')], expect: /DATA CONFLICT/ },
  { name: 'stale property data', facts: [fact('property_stale', 'yes')], expect: /OLD DATA/ },
];

test('evaluation harness keeps drafted, requested, scheduled, inferred, and approved distinct', () => {
  assert.ok(scenarios.length >= 50);
  for (const scenario of scenarios) {
    const card = planDesk(evidence(scenario.facts, scenario.extra));
    const blob = `${card.humanAction}\n${card.whyNow}\n${card.clientDraft ?? ''}\n${card.agentToolsNote}\n${card.showingLabel}`;
    assert.match(blob, scenario.expect, scenario.name);
    if (scenario.forbid) assert.doesNotMatch(blob, scenario.forbid, scenario.name);
    boundaries(card, scenario.facts);
    if (card.clientDraft) assert.equal(card.live, false, scenario.name);
    assert.equal(card.approvalRequired, true, scenario.name);
  }
});

test('no test may treat the forbidden pairs as the same thing', () => {
  const drafted = planDesk(evidence([fact('gmail_draft', 'Unsent draft claims the tour already happened.', 'inference'), fact('property_address', '10 Main St')]));
  assert.equal(drafted.live, false);
  assert.match(drafted.agentToolsNote, /not sent|unsent/i);
  assert.notEqual(drafted.showingState, 'SHOWING_COMPLETED');

  const requested = planDesk(evidence([fact('showing_requested', 'showing requested'), fact('property_address', '10 Main St')]));
  assert.equal(requested.showingState, 'CUSTOMER_REQUESTED');
  assert.notEqual(requested.showingState, 'SHOWING_SCHEDULED');
  assert.notEqual(requested.showingState, 'SHOWING_COMPLETED');

  const scheduled = planDesk(evidence([fact('scheduled_tour_note', 'Scheduled tour 2026-10-02 1:00 PM')]));
  assert.equal(scheduled.showingState, 'SHOWING_SCHEDULED');
  assert.notEqual(scheduled.showingState, 'SHOWING_COMPLETED');

  const activity = planDesk(evidence([fact('hot_score', '165'), fact('property_address', '10 Main St')]));
  assert.doesNotMatch(activity.whyNow, /motivation is high|likely to close/i);

  const coordinator = planDesk(evidence([fact('coordinator_tour', 'Coordinator confirmed the buyer attended', 'inference')]));
  assert.match(coordinator.agentToolsNote, /not Kyle contact/);
  assert.notEqual(coordinator.showingState, 'SHOWING_COMPLETED');

  const inferred = planDesk(evidence([fact('cash_vs_finance', 'cash', 'inference'), fact('property_address', '10 Main St')]));
  assert.match(`${inferred.whyNow} ${inferred.agentToolsNote}`, /not verified CASH/);
  assert.doesNotMatch(inferred.humanAction, /verified CASH/);

  const estimate = planDesk(evidence([fact('rent_estimate', '4000', 'inference'), fact('investor_strategy', 'cash flow', 'inference')]));
  assert.equal(estimate.live, false);
  assert.doesNotMatch(estimate.humanAction, /cap rate is|ROI is/);

  const approval = planDesk(evidence([fact('property_address', '10 Main St')]));
  assert.equal(approval.approvalRequired, true);
  assert.equal(approval.live, false);
  assert.match(approval.executionAdapter, /COPY → OPEN MESSAGES → PASTE → SEND/);

  const source = planDesk(evidence([fact('lead_source', 'Redfin'), fact('lead_source_conflict', 'another file says referral')]));
  assert.equal(source.sourceConflict, true);

  const click = planDesk(evidence([fact('clicked_price', '865000'), fact('property_address', '10 Main St')]));
  assert.match(click.whyNow, /list price is not a budget/i);
  assert.doesNotMatch(click.humanAction, /budget is 865000|budget is \$865/);

  const recommendation = planDesk(evidence([fact('system_recommendation', 'submit the offer', 'inference'), fact('property_address', '10 Main St')]));
  assert.doesNotMatch(recommendation.humanAction, /OFFER SUBMITTED/);
  assert.equal(recommendation.live, false);
});
