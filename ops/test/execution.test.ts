import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ingestCanonicalLead, writeClientFact } from '../src/canonical.ts';
import { executeApproval } from '../src/conversion/approval.ts';
import { openBuyerFile, recordAnswer, recordCustomerMessage, setDoNotContact } from '../src/conversion/engine.ts';
import { buildMorningBrief, integrationSnapshot, markManual, prepareExecution, type ExecutionAction } from '../src/conversion/execution.ts';
import { openDatabase } from '../src/db.ts';
import { loadAgentToolsDataset, readAgentToolsDataset, type AgentToolsDataset } from '../src/ingest/agentTools.ts';
import { liveChannelPermitted, sendFlags } from '../src/mode.ts';
import { text } from '../src/sql.ts';

const NOW = new Date('2026-09-29T07:50:00.000Z');
const HOT7 = fileURLToPath(new URL('../fixtures/hot7-2026-09-29.json', import.meta.url));

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-exec-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: ReturnType<typeof openDatabase>, sql: string): number {
  return Number(db.get(sql)?.n ?? 0);
}

function openLead(db: ReturnType<typeof openDatabase>, name: string, phone: string | null, email: string | null = null) {
  const created = ingestCanonicalLead(db, {
    idempotencyKey: `exec-${name}-${phone ?? email ?? 'none'}`,
    source: 'webhook',
    rawText: name,
    displayName: name,
    phone,
    email,
    now: NOW,
  });
  assert.equal(created.status, 'created');
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  openBuyerFile(db, { opportunityId: created.opportunityId, now: NOW });
  return { clientId: created.clientId, opportunityId: created.opportunityId };
}

function fact(db: ReturnType<typeof openDatabase>, clientId: string, opportunityId: string, field: string, value: string, kind: 'fact' | 'inference' = 'fact', verification: 'verified' | 'unverified' = 'verified') {
  writeClientFact(db, {
    clientId,
    opportunityId,
    now: NOW,
    fact: { fieldKey: field, value, kind, verification, source: 'test' },
  });
}

function cardFor(db: ReturnType<typeof openDatabase>, opportunityId: string): ExecutionAction {
  return prepareExecution(db, opportunityId, NOW);
}

function assertDraftNotSent(db: ReturnType<typeof openDatabase>, action: ExecutionAction) {
  assert.equal(action.sent, false);
  assert.equal(action.provider_confirmed, false);
  assert.equal(action.manual_action_required, true);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM communication_log`), 0);
  if (action.approval_id) {
    const status = text(db.get(`SELECT status FROM approval_queue WHERE id = ?`, action.approval_id), 'status');
    assert.notEqual(status, 'EXECUTED');
    assert.equal(action.draft_status === 'NONE' ? status : status, action.draft_status === 'NONE' ? status : 'PENDING');
  }
  if (action.client_draft) assert.doesNotMatch(action.client_draft, /—|–|just checking in|touching base|circling back/i);
}

test('Hot 7 fixture becomes a morning brief through the real loader', () => {
  const db = tempDb();
  const dataset = readAgentToolsDataset(HOT7);
  assert.equal(dataset.records.length, 7);
  const preview = loadAgentToolsDataset(db, dataset, { now: NOW });
  assert.equal(preview.applied, false);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM clients`), 0);
  const loaded = loadAgentToolsDataset(db, dataset, { apply: true, now: NOW });
  assert.equal(loaded.applied, true);
  assert.equal(loaded.liveSend, false);
  assert.equal(loaded.results.length, 7);
  const brief = buildMorningBrief(db, NOW, 'test');
  const names = brief.cards.map((card) => card.client_name);
  assert.deepEqual(names, [
    'Echo Niu',
    'Erena & Rick Valle',
    'Claudia Pinheiro',
    'Alberto Alonso',
    'Katherine De Armas',
    'Mark Maccagno',
    'Perry Crawford',
  ]);
  const echo = brief.cards[0]!;
  assert.equal(echo.priority, 1);
  assert.equal(echo.client_draft, 'Echo, did you end up seeing 90 SW 3rd St on Sunday?');
  assert.match(echo.why_now, /showing outcome remains unknown/i);
  assert.match(echo.why_now, /do not assume the client attended/i);
  assert.equal(echo.verified_phone, '(412) 478-9845');
  assert.equal(echo.verified_email, null);
  assert.equal(echo.property_redfin_url, null);
  assert.equal(echo.agent_tools_url, null);
  assert.equal(echo.property_mls, null);
  assert.equal(echo.property_price, null);
  assert.match(echo.tour_confirmation_state, /NOT CONFIRMED/);
  assert.match(echo.tour_confirmation_state, /POST TOUR VERIFICATION NEEDED/);
  assert.equal(echo.ask_qualification_now, false);
  assert.match(echo.if_yes_next, /What did you think once you got inside/);
  assert.match(echo.if_no_next, /verify current availability and access/i);
  assert.match(echo.agent_tools_note_draft, /9\/29 Kyle texted customer to verify whether the 9\/27 6 PM showing at 90 SW 3rd St #308 occurred/);
  assert.match(echo.agent_tools_note_draft, /Do not paste that note before the text is actually sent/);
  assert.doesNotMatch(echo.human_headline, /confirm_tour_details|pending_enrichment/);
  assert.equal(echo.sent, false);
  assert.match(brief.text, /Clock: test freeze/);
  assert.equal(brief.clock, 'test');
  assert.equal(echo.priority_tier, 'T0');
  assert.match(brief.text, /KYLEOS MORNING BRIEF/);
  assert.match(brief.text, /LINK NOT FOUND/);
  assert.match(brief.text, /DATA NEEDED/);
  assert.match(brief.text, /DO NOT ASK YET/);
  assert.doesNotMatch(echo.client_draft ?? '', /—|Kyle Kleinman with Redfin again|just checking in/i);
  const indexAction = brief.text.indexOf('DO THIS NOW: TEXT ECHO NOW');
  const indexEngine = brief.text.indexOf('ENGINE (internal');
  assert.ok(indexAction > 0);
  assert.ok(indexEngine > indexAction);

  const erena = brief.cards[1]!;
  assert.match(erena.client_draft ?? '', /Erena, did you end up seeing 17210 NW 47th Ave on Friday/);
  assert.match(erena.funding_type, /not a buyer confirmation/i);
  assert.match(erena.tour_confirmation_state, /NOT CONFIRMED/);

  const claudia = brief.cards[2]!;
  assert.match(claudia.client_draft ?? '', /Claudia, did you end up seeing 8024 Tatum Waterway Dr on Wednesday/);
  assert.match(claudia.why_now, /do not assume the client attended/i);
  assert.equal(claudia.action_channel, 'sms');
  assert.doesNotMatch(claudia.human_headline, /^CALL/);
  assert.match(claudia.agent_tools_note_draft, /9\/23 showing/);
  assert.doesNotMatch(claudia.agent_tools_note_draft, /11:59|PM showing/);

  const alberto = brief.cards[3]!;
  assert.equal(alberto.action_channel, 'email');
  assert.equal(alberto.verified_phone, null);
  assert.equal(alberto.verified_email, 'aalonsojr2007@gmail.com');
  assert.equal(alberto.email_subject, 'Your 33018 search');
  assert.match(alberto.email_draft ?? '', /no HOA/);
  assert.match(alberto.email_draft ?? '', /what is prompting the move/i);
  assert.equal(alberto.client_draft, null);

  const katherine = brief.cards[4]!;
  assert.match(katherine.human_headline, /CMA NEEDED/);
  assert.match(katherine.primary_action, /DATA NEEDED/);
  assert.equal(katherine.property_address, null);
  assert.ok(katherine.summary_buckets.includes('cma'));
  assert.ok(katherine.summary_buckets.includes('missing_contact'));
  assert.equal(katherine.priority_tier, 'T2');

  const mark = brief.cards[5]!;
  assert.match(mark.human_headline, /GET MARK'S CELL/);
  assert.equal(mark.draft_status, 'BLOCKED');
  assert.match(mark.why_now, /not submitted/i);
  assert.equal(mark.verified_phone, null);
  assert.equal(mark.verified_email, null);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM next_best_actions WHERE opportunity_id = '${mark.opportunityId}'`), 0);
  assert.ok(mark.summary_buckets.includes('offers'));

  const perry = brief.cards[6]!;
  assert.match(perry.primary_action, /Prefers text/);
  assert.equal(perry.draft_status, 'BLOCKED');
  assert.match(perry.client_draft ?? '', /Coral Gables multi-family/);
  assert.equal(mark.priority_tier, 'T3');
  assert.equal(perry.priority_tier, 'T3');

  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM communication_log`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'EXECUTED'`), 0);
  const flags = sendFlags();
  assert.equal(flags.liveSend, false);
  assert.equal(flags.smsSend, false);
  assert.equal(flags.emailSend, false);
  assert.equal(flags.aiCalling, false);
  assert.equal(liveChannelPermitted('sms'), false);
  assert.equal(integrationSnapshot().liveSend, false);
  const marked = markManual(db, echo.opportunityId, 'sent', NOW);
  assert.equal(marked.providerConfirmed, false);
  assert.equal(marked.sent, false);
  assert.match(marked.message, /No provider confirmed delivery/);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  writeFileSync('/tmp/hot7-morning-brief.txt', brief.text);
  db.close();
});

test('new buyer, repeat request, unconfirmed showing, and past showing stay distinct', () => {
  const db = tempDb();
  const first = openLead(db, 'Sarah Cho', '3055550101');
  fact(db, first.clientId, first.opportunityId, 'property_address', '123 Main St');
  const created = cardFor(db, first.opportunityId);
  assert.match(created.client_draft ?? '', /checking on 123 Main St/);
  assert.doesNotMatch(created.client_draft ?? '', /preapproved|budget|house to sell/i);
  assertDraftNotSent(db, created);

  fact(db, first.clientId, first.opportunityId, 'repeat_property_request', 'Same MLS request on Sep 2 and Sep 29. Prior showing was not completed.');
  const repeat = cardFor(db, first.opportunityId);
  assert.match(repeat.repeat_property_request ?? '', /Sep 2/);
  assert.match(buildMorningBrief(db, NOW).text, /REPEAT PROPERTY REQUEST/);

  const requested = openLead(db, 'Nate Ortiz', '3055550102');
  fact(db, requested.clientId, requested.opportunityId, 'property_address', '45 Bay Dr');
  fact(db, requested.clientId, requested.opportunityId, 'showing_request', 'Saturday 6:30 requested. Listing side has not confirmed.');
  const requestCard = cardFor(db, requested.opportunityId);
  assert.match(requestCard.tour_confirmation_state, /NOT CONFIRMED/);
  assert.match(requestCard.primary_action, /LISTING AGENT CONTACT PENDING/);
  assert.equal(requestCard.listing_agent_draft, null);
  assert.doesNotMatch(requestCard.customer_property_state, /Confirmed/);

  const found = openLead(db, 'Lina Ortiz', '3055550103');
  fact(db, found.clientId, found.opportunityId, 'property_address', '45 Bay Dr');
  fact(db, found.clientId, found.opportunityId, 'showing_request', 'Access still pending.');
  fact(db, found.clientId, found.opportunityId, 'listing_agent_name', 'Maria Rodriguez');
  fact(db, found.clientId, found.opportunityId, 'listing_agent_phone', '3055550199');
  fact(db, found.clientId, found.opportunityId, 'listing_agent_brokerage', 'Example Realty');
  fact(db, found.clientId, found.opportunityId, 'listing_agent_source', 'MLS');
  const foundCard = cardFor(db, found.opportunityId);
  assert.match(foundCard.primary_action, /CLIENT CONTACT READY/);
  assert.match(foundCard.listing_agent_draft ?? '', /Maria Rodriguez/);
  assert.match(foundCard.listing_agent_draft ?? '', /3055550199|305\) 555-0199/);
  assert.doesNotMatch(foundCard.listing_agent_draft ?? '', /XXX/);

  const past = openLead(db, 'Owen Past', '3055550104');
  fact(db, past.clientId, past.opportunityId, 'tours_summary', 'Sep 20 - Upcoming tour agent scheduled');
  fact(db, past.clientId, past.opportunityId, 'property_address', '9 Palm Ave', 'inference', 'unverified');
  fact(db, past.clientId, past.opportunityId, 'tour_datetime', '2026-09-20 18:00', 'inference', 'unverified');
  fact(db, past.clientId, past.opportunityId, 'tour_outcome', 'unconfirmed', 'inference', 'unverified');
  const pastCard = cardFor(db, past.opportunityId);
  assert.equal(pastCard.internal_action_type, 'tour_follow_up');
  assert.match(pastCard.tour_confirmation_state, /POST TOUR VERIFICATION NEEDED/);
  assert.doesNotMatch(pastCard.human_headline, /upcoming/i);
  assert.doesNotMatch(pastCard.customer_property_state, /Confirmed|Completed/);
  db.close();
});

test('associate showing, call request, pending property, and nearby flexibility', () => {
  const db = tempDb();
  const associate = openLead(db, 'Pat Client', '3055550110');
  fact(db, associate.clientId, associate.opportunityId, 'recent_tour_note', '2026-09-27 tour completed with showing agent Pat Example. Not a tour with Kyle.', 'inference', 'unverified');
  fact(db, associate.clientId, associate.opportunityId, 'property_address', '8 Coral Way', 'inference', 'unverified');
  const associateCard = cardFor(db, associate.opportunityId);
  assert.match(associateCard.why_now, /not a tour with Kyle/i);
  assert.match(associateCard.tour_confirmation_state, /NOT CONFIRMED/);
  assert.notEqual(associateCard.client_stage, 'OFFER_READY');

  const caller = openLead(db, 'Claudia Call', '3055550111');
  fact(db, caller.clientId, caller.opportunityId, 'customer_message', 'Please call me Kyle about next steps.');
  recordCustomerMessage(db, { opportunityId: caller.opportunityId, text: 'Please call me Kyle about next steps.', now: NOW });
  const callCard = cardFor(db, caller.opportunityId);
  assert.match(callCard.human_headline, /CALL CLAUDIA NOW/);
  assert.ok(callCard.call_opening);
  assert.equal(callCard.client_draft, null);

  const pending = openLead(db, 'Dana Pending', '3055550112');
  fact(db, pending.clientId, pending.opportunityId, 'property_address', '77 Grove St');
  fact(db, pending.clientId, pending.opportunityId, 'property_status', 'Pending');
  const pendingCard = cardFor(db, pending.opportunityId);
  assert.match(pendingCard.client_draft ?? '', /went pending/i);
  assert.doesNotMatch(pendingCard.client_draft ?? '', /here are ten|shortlist of ten/i);

  fact(db, pending.clientId, pending.opportunityId, 'area_flexibility', 'open to nearby');
  const nearby = cardFor(db, pending.opportunityId);
  assert.match(nearby.client_draft ?? '', /caught your eye/i);
  assert.doesNotMatch(nearby.client_draft ?? '', /open to nearby options too/i);
  db.close();
});

test('financing, ownership, proceeds, spouse, and missing cell', () => {
  const db = tempDb();
  const cash = openLead(db, 'Cash Buyer', '3055550120');
  recordAnswer(db, { opportunityId: cash.opportunityId, field: 'cash_vs_finance', value: 'cash', confirmation: 'customer_confirmed', now: NOW });
  const cashCard = cardFor(db, cash.opportunityId);
  assert.equal(cashCard.funding_type, 'Cash');
  assert.match(cashCard.current_objective, /Do not ask for a preapproval/);
  assert.doesNotMatch(cashCard.client_draft ?? '', /preapprov/i);

  const finance = openLead(db, 'Fin Buyer', '3055550121');
  recordAnswer(db, { opportunityId: finance.opportunityId, field: 'cash_vs_finance', value: 'finance', confirmation: 'customer_confirmed', now: NOW });
  const financeCard = cardFor(db, finance.opportunityId);
  assert.match(financeCard.client_draft ?? '', /already approved/i);

  recordAnswer(db, { opportunityId: finance.opportunityId, field: 'preapproval', value: 'not yet', confirmation: 'customer_confirmed', now: NOW });
  const intro = cardFor(db, finance.opportunityId);
  assert.match(intro.client_draft ?? '', /Want me to make the intro/);
  assert.doesNotMatch(intro.client_draft ?? '', /tax return|interest rate is/i);

  const approved = openLead(db, 'Approved Buyer', '3055550122');
  recordAnswer(db, { opportunityId: approved.opportunityId, field: 'cash_vs_finance', value: 'finance', confirmation: 'customer_confirmed', now: NOW });
  recordAnswer(db, { opportunityId: approved.opportunityId, field: 'preapproval', value: 'preapproved', confirmation: 'customer_confirmed', now: NOW });
  const approvedCard = cardFor(db, approved.opportunityId);
  assert.equal(approvedCard.preapproval_state, 'Preapproved');
  assert.doesNotMatch(approvedCard.client_draft ?? '', /already approved, or do we still/i);

  const owner = openLead(db, 'Owner Buyer', '3055550123');
  recordAnswer(db, { opportunityId: owner.opportunityId, field: 'current_home', value: 'own', confirmation: 'customer_confirmed', now: NOW });
  recordAnswer(db, { opportunityId: owner.opportunityId, field: 'sale_dependency', value: 'no', confirmation: 'customer_confirmed', now: NOW });
  const ownerCard = cardFor(db, owner.opportunityId);
  assert.match(ownerCard.sell_side_dependency, /SALE NOT REQUIRED/);
  assert.match(ownerCard.client_draft ?? '', /won't treat it as a listing/i);

  const mustSell = openLead(db, 'Seller Buyer', '3055550124');
  recordAnswer(db, { opportunityId: mustSell.opportunityId, field: 'sale_dependency', value: 'must sell first', confirmation: 'customer_confirmed', now: NOW });
  const sellCard = cardFor(db, mustSell.opportunityId);
  assert.match(sellCard.sell_side_dependency, /SALE REQUIRED/);
  assert.match(sellCard.client_draft ?? '', /won't guess it/i);

  const proceeds = openLead(db, 'Proceeds Buyer', '3055550125');
  recordAnswer(db, { opportunityId: proceeds.opportunityId, field: 'sale_dependency', value: 'need the proceeds', confirmation: 'customer_confirmed', now: NOW });
  const proceedsCard = cardFor(db, proceeds.opportunityId);
  assert.match(proceedsCard.sell_side_dependency, /PROCEEDS REQUIRED/);

  const spouse = openLead(db, 'Spouse Buyer', '3055550126');
  fact(db, spouse.clientId, spouse.opportunityId, 'decision_makers', 'Spouse is a decision maker.');
  const spouseCard = cardFor(db, spouse.opportunityId);
  assert.ok(spouseCard.verified_facts.some((line) => /Spouse is a decision maker/.test(line)));
  assert.doesNotMatch(spouseCard.client_draft ?? '', /who else has to agree/i);

  const noCell = openLead(db, 'No Cell', null, 'nocell@example.com');
  const noCellCard = cardFor(db, noCell.opportunityId);
  assert.equal(noCellCard.verified_phone, null);
  assert.match(noCellCard.unknowns.join(' '), /Verified phone/);
  assert.equal(noCellCard.action_channel, 'email');
  assert.doesNotMatch(`${noCellCard.verified_phone}`, /555/);
  db.close();
});

test('opt out, unsent draft, coordinator contact, CMA, and reply branching', () => {
  const db = tempDb();
  const stopped = openLead(db, 'Stop Person', '3055550130');
  setDoNotContact(db, { opportunityId: stopped.opportunityId, now: NOW, source: 'customer' });
  const stoppedCard = cardFor(db, stopped.opportunityId);
  assert.match(stoppedCard.human_headline, /DO NOT CONTACT/);
  assert.equal(stoppedCard.client_draft, null);
  assert.equal(stoppedCard.draft_status, 'NONE');
  assertDraftNotSent(db, stoppedCard);

  const phrase = openLead(db, 'Phrase Person', '3055550131');
  fact(db, phrase.clientId, phrase.opportunityId, 'customer_message', 'stop contacting me');
  const phraseCard = cardFor(db, phrase.opportunityId);
  assert.equal(phraseCard.client_draft, null);
  assert.match(phraseCard.human_headline, /DO NOT CONTACT/);

  const draft = openLead(db, 'Draft Person', '3055550132');
  fact(db, draft.clientId, draft.opportunityId, 'gmail_draft', '2026-09-28 email draft exists and is unsent.', 'inference', 'unverified');
  const draftCard = cardFor(db, draft.opportunityId);
  assert.match(draftCard.unknowns.join(' '), /unsent/);
  assert.doesNotMatch(draftCard.verified_facts.join(' '), /email sent/i);

  const coordinator = openLead(db, 'Coord Person', '3055550133');
  fact(db, coordinator.clientId, coordinator.opportunityId, 'coordinator_contact', 'Coordinator texted the buyer. Kyle did not.', 'inference', 'unverified');
  const coordinatorCard = cardFor(db, coordinator.opportunityId);
  assert.match(coordinatorCard.unknowns.join(' '), /not Kyle contact/i);

  const cma = openLead(db, 'Cma Person', '3055550134');
  fact(db, cma.clientId, cma.opportunityId, 'cma_reminder', 'May 18 create a sell CMA is still open.');
  const cmaCard = cardFor(db, cma.opportunityId);
  assert.match(cmaCard.human_headline, /CMA NEEDED/);
  assert.doesNotMatch(cmaCard.client_draft ?? '', /What is prompting the move/);

  const reply = openLead(db, 'Reply Person', '3055550135');
  recordAnswer(db, { opportunityId: reply.opportunityId, field: 'motivation', value: 'closer to work', confirmation: 'customer_confirmed', now: NOW });
  fact(db, reply.clientId, reply.opportunityId, 'customer_message', 'closer to work');
  const replyCard = cardFor(db, reply.opportunityId);
  assert.match(replyCard.client_draft ?? '', /Got it/);
  assert.match(replyCard.client_draft ?? '', /areas/i);
  assert.doesNotMatch(replyCard.client_draft ?? '', /What is prompting the move/);
  assert.ok((replyCard.client_draft ?? '').length < 80);

  const detailed = openLead(db, 'Detail Person', '3055550136');
  fact(db, detailed.clientId, detailed.opportunityId, 'customer_message', 'Can you explain the HOA reserves, the insurance situation, the roof age, the flood zone, and how those change the monthly cost compared with the house on the next block in a practical way?');
  const detailedCard = cardFor(db, detailed.opportunityId);
  assert.match(detailedCard.client_draft ?? '', /DATA NEEDED/);
  assert.ok((detailedCard.client_draft ?? '').length > (replyCard.client_draft ?? '').length);
  db.close();
});

test('investor, schools, search criteria, offers, and transaction states', () => {
  const db = tempDb();
  const investor = openLead(db, 'Investor Ira', '3055550140');
  fact(db, investor.clientId, investor.opportunityId, 'customer_message', 'What is the cash flow on that fourplex?');
  const investorCard = cardFor(db, investor.opportunityId);
  assert.match(investorCard.client_draft ?? '', /won't guess cash flow/i);
  assert.doesNotMatch(investorCard.client_draft ?? '', /\$\d/);

  const str = openLead(db, 'Str Sam', '3055550141');
  fact(db, str.clientId, str.opportunityId, 'customer_message', 'Can I run this as an STR?');
  const strCard = cardFor(db, str.opportunityId);
  assert.match(strCard.client_draft ?? '', /won't treat it as allowed/i);
  assert.match(strCard.why_now, /unknown/i);

  const schools = openLead(db, 'School Sue', '3055550142');
  fact(db, schools.clientId, schools.opportunityId, 'customer_message', 'I want a good schools family neighborhood.');
  const schoolCard = cardFor(db, schools.opportunityId);
  assert.match(schoolCard.client_draft ?? '', /district/i);
  assert.match(schoolCard.why_now, /Do not steer/);
  assert.doesNotMatch(schoolCard.client_draft ?? '', /you should live in/i);

  const area = openLead(db, 'Area Amy', '3055550143');
  fact(db, area.clientId, area.opportunityId, 'area_changed', 'Was North Miami. Now Miami Shores. Keep the old search.');
  const areaCard = cardFor(db, area.opportunityId);
  assert.match(areaCard.client_draft ?? '', /new area/);
  assert.match(areaCard.client_draft ?? '', /keep the earlier search/i);

  const search = openLead(db, 'Search Sid', '3055550144');
  fact(db, search.clientId, search.opportunityId, 'required_filters', 'North Miami, single family, 3+ bedrooms, 2+ bathrooms, maximum $700K');
  fact(db, search.clientId, search.opportunityId, 'preferred_filters', 'Pool, no HOA');
  const searchCard = cardFor(db, search.opportunityId);
  assert.match(searchCard.primary_action, /REQUIRED:/);
  assert.match(searchCard.primary_action, /PREFERRED:/);
  assert.match(searchCard.primary_action, /DO NOT FILTER OUT YET/);

  const offer = openLead(db, 'Offer Olga', '3055550145');
  fact(db, offer.clientId, offer.opportunityId, 'customer_message', 'I want to make an offer.');
  fact(db, offer.clientId, offer.opportunityId, 'offer_price', '$640K');
  const offerCard = cardFor(db, offer.opportunityId);
  assert.match(offerCard.human_headline, /OFFER MODE/);
  assert.match(offerCard.primary_action, /\$640K/);
  assert.match(offerCard.primary_action, /MISSING:/);
  assert.doesNotMatch(offerCard.primary_action, /submitted/);
  assert.equal(offerCard.customer_property_state, 'Offer requested, not submitted');

  const drafted = openLead(db, 'Draft Offer', '3055550146');
  fact(db, drafted.clientId, drafted.opportunityId, 'offer_state', 'drafted');
  const draftedCard = cardFor(db, drafted.opportunityId);
  assert.match(draftedCard.why_now, /Drafted is not submitted/);
  assert.doesNotMatch(draftedCard.human_headline, /SUBMITTED/);

  const submitted = openLead(db, 'Submitted Offer', '3055550147');
  fact(db, submitted.clientId, submitted.opportunityId, 'offer_provider_confirmation', 'Provider receipt 441 on 2026-09-28');
  const submittedCard = cardFor(db, submitted.opportunityId);
  assert.match(submittedCard.human_headline, /OFFER SUBMITTED/);
  assert.match(submittedCard.why_now, /provider confirmation/i);

  const accepted = openLead(db, 'Accepted Offer', '3055550148');
  fact(db, accepted.clientId, accepted.opportunityId, 'offer_state', 'accepted');
  fact(db, accepted.clientId, accepted.opportunityId, 'offer_accepted', 'Executed contract received');
  const acceptedCard = cardFor(db, accepted.opportunityId);
  assert.match(acceptedCard.human_headline, /OFFER ACCEPTED/);

  const effective = openLead(db, 'Effective Erin', '3055550149');
  fact(db, effective.clientId, effective.opportunityId, 'effective_date', '2026-09-28');
  assert.match(cardFor(db, effective.opportunityId).why_now, /2026-09-28/);

  const inspection = openLead(db, 'Inspect Ian', '3055550150');
  fact(db, inspection.clientId, inspection.opportunityId, 'inspection_deadline', '2026-10-12');
  assert.match(cardFor(db, inspection.opportunityId).why_now, /2026-10-12/);

  const unknownInspection = openLead(db, 'Inspect Unknown', '3055550151');
  fact(db, unknownInspection.clientId, unknownInspection.opportunityId, 'transaction_milestone', 'inspection status unknown');
  const unknownCard = cardFor(db, unknownInspection.opportunityId);
  assert.match(unknownCard.why_now, /Do not invent the inspection deadline/);
  assert.match(unknownCard.why_now, /HUMAN REVIEW REQUIRED/);

  const loan = openLead(db, 'Loan Lee', '3055550152');
  fact(db, loan.clientId, loan.opportunityId, 'transaction_milestone', 'loan not clear to close');
  assert.match(cardFor(db, loan.opportunityId).why_now, /not clear to close/i);

  const walk = openLead(db, 'Walk Wynn', '3055550153');
  fact(db, walk.clientId, walk.opportunityId, 'transaction_milestone', 'final walkthrough scheduled');
  const walkCard = cardFor(db, walk.opportunityId);
  assert.match(walkCard.why_now, /Scheduled is not completed/);

  const closed = openLead(db, 'Closed Cara', '3055550154');
  fact(db, closed.clientId, closed.opportunityId, 'transaction_milestone', 'closed');
  const closedCard = cardFor(db, closed.opportunityId);
  assert.match(closedCard.human_headline, /CLOSED/);
  assert.match(closedCard.why_now, /Do not blast a referral/);
  assert.equal(closedCard.client_draft, null);
  db.close();
});

test('source conflicts, channel preference, calendar, compensation, and send gates', () => {
  const db = tempDb();
  const referral = openLead(db, 'Referral Ron', '3055550160');
  fact(db, referral.clientId, referral.opportunityId, 'referral_source', 'Rocket');
  const referralCard = cardFor(db, referral.opportunityId);
  assert.match(referralCard.unknowns.join(' '), /Do not invent contact attempts/);

  const conflict = openLead(db, 'Source Sue', '3055550161');
  fact(db, conflict.clientId, conflict.opportunityId, 'lead_source', 'Redfin');
  fact(db, conflict.clientId, conflict.opportunityId, 'lead_source_conflict', 'Rocket');
  const conflictCard = cardFor(db, conflict.opportunityId);
  assert.match(conflictCard.conflicts.join(' '), /SOURCE ATTRIBUTION CONFLICT/);
  assert.match(conflictCard.conflicts.join(' '), /Redfin/);
  assert.match(conflictCard.conflicts.join(' '), /Rocket/);

  const property = openLead(db, 'Status Sam', '3055550162');
  fact(db, property.clientId, property.opportunityId, 'property_status', 'Active');
  fact(db, property.clientId, property.opportunityId, 'property_status_conflict', 'Pending');
  const propertyCard = cardFor(db, property.opportunityId);
  assert.match(propertyCard.conflicts.join(' '), /DATA CONFLICT|Property status/);
  assert.match(propertyCard.conflicts.join(' '), /Active/);
  assert.match(propertyCard.conflicts.join(' '), /Pending/);

  const stale = openLead(db, 'Stale Sal', '3055550163');
  fact(db, stale.clientId, stale.opportunityId, 'property_status', 'Active');
  fact(db, stale.clientId, stale.opportunityId, 'property_status', 'Old note said pending last month', 'inference', 'unverified');
  assert.match(cardFor(db, stale.opportunityId).conflicts.join(' '), /STALE OR UNVERIFIED/);

  const phonePref = openLead(db, 'Phone Phil', '3055550164');
  fact(db, phonePref.clientId, phonePref.opportunityId, 'preferred_channel', 'phone');
  const phoneCard = cardFor(db, phonePref.opportunityId);
  assert.equal(phoneCard.action_channel, 'call');
  assert.equal(phoneCard.client_draft, null);

  const spanish = openLead(db, 'Ana Spanish', '3055550165');
  fact(db, spanish.clientId, spanish.opportunityId, 'language', 'Spanish');
  const spanishCard = cardFor(db, spanish.opportunityId);
  assert.match(spanishCard.client_draft ?? '', /empujando a moverte/);
  assert.doesNotMatch(spanishCard.client_draft ?? '', /What is prompting the move/);

  const calendar = openLead(db, 'Cal Cara', '3055550166');
  fact(db, calendar.clientId, calendar.opportunityId, 'calendar_conflict', '2:00 PM showing already on the calendar.');
  const calendarCard = cardFor(db, calendar.opportunityId);
  assert.match(calendarCard.human_headline, /CALENDAR CONFLICT/);
  assert.match(calendarCard.primary_action, /do not book over/i);
  assert.equal(calendarCard.client_draft, null);

  const comp = openLead(db, 'Comp Cam', '3055550167');
  fact(db, comp.clientId, comp.opportunityId, 'buyer_agreement_compensation', '2.5 percent in the signed buyer agreement');
  const compCard = cardFor(db, comp.opportunityId);
  assert.match(compCard.verified_facts.join(' '), /2.5 percent/);
  assert.match(compCard.verified_facts.join(' '), /Do not say the seller pays/);
  assert.doesNotMatch(compCard.client_draft ?? '', /seller pays my commission/i);

  const unknownComp = openLead(db, 'Comp Unknown', '3055550168');
  assert.match(cardFor(db, unknownComp.opportunityId).unknowns.join(' '), /COMPENSATION NEEDS VERIFICATION/);

  const agreement = openLead(db, 'Agreement Al', '3055550169');
  fact(db, agreement.clientId, agreement.opportunityId, 'buyer_agreement', 'incomplete');
  assert.match(cardFor(db, agreement.opportunityId).unknowns.join(' '), /FLAG IT BEFORE THE TOUR/);

  const sms = openLead(db, 'Sms Sam', '3055550170');
  const smsCard = cardFor(db, sms.opportunityId);
  assert.equal(smsCard.draft_status, 'DRAFT');
  assert.ok(smsCard.approval_id);
  const attempt = executeApproval(db, { approvalId: smsCard.approval_id!, recipient: '3055550170', recipientVerified: true, now: NOW });
  assert.notEqual(attempt.status, 'sent');
  assert.equal(attempt.live, false);
  assert.equal(attempt.approvalStatus, 'PENDING');
  assert.equal(liveChannelPermitted('email'), false);

  const later = openLead(db, 'Later Lou', '3055550171');
  recordAnswer(db, { opportunityId: later.opportunityId, field: 'timeframe', value: 'next year', confirmation: 'customer_confirmed', now: NOW });
  const laterCard = cardFor(db, later.opportunityId);
  assert.match(laterCard.human_headline, /WAIT/);
  assert.equal(laterCard.client_draft, null);
  assert.ok(laterCard.follow_up_date && laterCard.follow_up_date > NOW.toISOString());
  assert.doesNotMatch(laterCard.primary_action, /last chance|urgent/i);

  const dup = loadAgentToolsDataset(db, {
    dataset: 'redfin_agent_tools_leads',
    mode: 'DRY_RUN',
    exported_at: NOW.toISOString(),
    source_system: 'redfin_agent_tools',
    synthetic: true,
    records: [0, 1].map((index) => ({
      record_id: `dup-${index}`,
      disposition: 'lead' as const,
      source: { system: 'redfin_agent_tools' as const, source_id: `dup-src-${index}`, exported_at: NOW.toISOString() },
      person: {
        display_name: 'Same Name Person',
        phones: [{ value: `(305) 555-018${index}`, verification: 'verified' as const }],
        emails: [],
      },
      facts: [],
    })),
  } satisfies AgentToolsDataset, { apply: true, now: NOW });
  assert.equal(dup.results.length, 2);
  const brief = buildMorningBrief(db, NOW);
  assert.equal(brief.cards.filter((card) => card.client_name === 'Same Name Person').length, 2);
  assert.match(brief.text, /POSSIBLE DUPLICATE CLIENT/);
  assert.match(brief.text, /Name alone is not a merge/);
  db.close();
});

test('manual showing and offer marks do not become provider facts', () => {
  const db = tempDb();
  const lead = openLead(db, 'Manual Mia', '3055550190');
  const action = cardFor(db, lead.opportunityId);
  const showing = markManual(db, action.opportunityId, 'showing_completed', NOW);
  const offer = markManual(db, action.opportunityId, 'offer_submitted', NOW);
  assert.match(showing.message, /not proof of attendance/);
  assert.match(offer.message, /No provider confirmation/);
  const again = cardFor(db, lead.opportunityId);
  assert.equal(again.sent, false);
  assert.equal(again.provider_confirmed, false);
  assert.equal(again.manual_marks.length, 2);
  assert.notEqual(again.client_stage, 'OFFER_SUBMITTED');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  db.close();
});
