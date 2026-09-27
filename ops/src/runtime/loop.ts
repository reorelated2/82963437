import { nextBusinessMorning, zonedParts } from '../time.ts';
import type { ChannelAdapter, Inbound, ReleasePolicy, WakeResult } from './types.ts';
import { CHECKPOINT_OWNERS, SHOWING_CHECKPOINTS } from './types.ts';
import { decide, missingCheckpoints, showingFullyConfirmed, type Decision } from './decide.ts';
import {
  ambiguousClaim,
  countSendReceipts,
  identityConflict,
  rememberIdentifiers,
  dueOpportunities,
  ensureOpportunity,
  finishClaim,
  findEvent,
  insertEvent,
  loadOpportunity,
  loadOpportunityById,
  markRoutine,
  pendingWriteClaim,
  queueFollowUp,
  saveCheckpoint,
  saveEventResult,
  saveFact,
  supersedeQueued,
  tryClaim,
  updateOpportunity,
  type OpportunityRow,
} from './store.ts';
import type { SqlDb } from '../sql.ts';
import { text } from '../sql.ts';

export interface RuntimeContext {
  policy: ReleasePolicy;
  synthetic: ChannelAdapter;
  live: ChannelAdapter;
}

export function wake(db: SqlDb, inbound: Inbound, ctx: RuntimeContext): WakeResult {
  const prior = findEvent(db, inbound.eventKey);
  if (prior?.result_json) {
    const stored = JSON.parse(text(prior, 'result_json')) as WakeResult;
    return { ...stored, status: 'duplicate', blocker: 'Duplicate event. The original result was kept.' };
  }
  insertEvent(db, inbound.eventKey, null, inbound.kind, { personKey: inbound.personKey, sourceVersion: inbound.sourceVersion }, inbound.now);

  if (!inbound.personKey || inbound.personKey.endsWith(':')) {
    const held = baseResult(null, 'held', 'No phone or email. No contact was created.');
    saveEventResult(db, inbound.eventKey, held, attachHandoff);
    return held;
  }

  const synthetic = inbound.synthetic !== false;
  let opp = ensureOpportunity(db, {
    personKey: inbound.personKey,
    displayName: inbound.displayName || 'Unnamed buyer',
    relationshipOwner: inbound.relationshipOwner || 'Kyle Kleinman',
    sourceVersion: inbound.sourceVersion,
    policyVersion: ctx.policy.version,
    synthetic,
    now: inbound.now,
  });

  const alternates = inbound.signals?.alternateKeys ?? [];
  const conflictKey = identityConflict(db, opp.id, alternates);
  if (conflictKey) {
    const blocker = `Identity conflict. ${conflictKey} belongs to a different record. Nothing was merged and no message was sent.`;
    updateOpportunity(db, opp.id, { blocker, stage: 'identity_conflict', follow_up_due_at: null }, inbound.now);
    supersedeQueued(db, opp.id, inbound.now);
    const held = baseResult(opp.id, 'held', 'Conflicting identity. Held for Kyle.');
    held.blocker = blocker;
    saveEventResult(db, inbound.eventKey, held, attachHandoff);
    return held;
  }
  rememberIdentifiers(db, opp.id, alternates);

  if (inbound.kind === 'source_change') {
    const patch: Record<string, string | number | null> = { source_version: inbound.sourceVersion };
    if (inbound.signals?.recipientKey) patch.person_key = inbound.signals.recipientKey;
    if (inbound.displayName) patch.display_name = inbound.displayName;
    updateOpportunity(db, opp.id, patch, inbound.now);
    supersedeQueued(db, opp.id, inbound.now);
    opp = loadOpportunityById(db, opp.id)!;
  }

  if (opp.suppression === 'opted_out' || opp.takeover === 'human') {
    supersedeQueued(db, opp.id, inbound.now);
    updateOpportunity(db, opp.id, { follow_up_due_at: null }, inbound.now);
    const stopped = baseResult(opp.id, 'suppressed', opp.takeover === 'human' ? 'Human takeover is on. Automatic outreach stays off.' : 'Opt out is still in effect.');
    stopped.missingCheckpoints = missingCheckpoints(loadOpportunityById(db, opp.id)!);
    saveEventResult(db, inbound.eventKey, stopped, attachHandoff);
    return stopped;
  }

  if (inbound.relationshipOwner && inbound.relationshipOwner !== opp.relationshipOwner) {
    const blocker = `Source reports owner ${inbound.relationshipOwner}. Record still says ${opp.relationshipOwner}. Paused for Kyle. Ownership was not overwritten.`;
    updateOpportunity(db, opp.id, { stage: 'ownership_paused', follow_up_due_at: null, blocker }, inbound.now);
    supersedeQueued(db, opp.id, inbound.now);
    const escalated = baseResult(opp.id, 'escalated', 'Ownership conflict. No message was sent.');
    escalated.blocker = blocker;
    saveEventResult(db, inbound.eventKey, escalated, attachHandoff);
    return escalated;
  }
  if (opp.stage === 'ownership_paused') {
    const held = baseResult(opp.id, 'escalated', 'Ownership is still unresolved. Automatic outreach stays paused.');
    held.blocker = opp.blocker;
    saveEventResult(db, inbound.eventKey, held, attachHandoff);
    return held;
  }

  const pending = pendingWriteClaim(db, opp.id);
  if (pending && (inbound.kind === 'resume_write' || inbound.kind === 'due')) {
    return resumeWrite(db, inbound, ctx, opp, text(pending, 'action_key'), text(pending, 'body'));
  }

  if (ambiguousClaim(db, opp.id)) {
    const held = baseResult(opp.id, 'ambiguous', 'An earlier send result is unknown. It was not repeated.');
    held.blocker = 'Reconcile the original send before any new contact.';
    updateOpportunity(db, opp.id, { blocker: held.blocker, stage: 'ambiguous' }, inbound.now);
    saveEventResult(db, inbound.eventKey, held, attachHandoff);
    return held;
  }

  const steps = ['reread'];
  if (steps.length >= ctx.policy.maxSteps) return budgetStop(db, inbound, opp, steps, 'Reread the record and choose the next action.');
  const decision = decide(opp, inbound);
  steps.push(`decide:${decision.questionId}`);
  applyMemory(db, opp.id, inbound, decision);

  if (decision.kind === 'suppress') {
    updateOpportunity(db, opp.id, { suppression: 'opted_out', stage: 'suppressed', follow_up_due_at: null, blocker: null }, inbound.now);
    supersedeQueued(db, opp.id, inbound.now);
    const result = finish(db, inbound, opp.id, 'suppressed', null, decision, 'none', steps);
    return result;
  }

  if (decision.kind === 'escalate' || decision.kind === 'note' || decision.kind === 'no_contact' || decision.kind === 'hold') {
    const status = decision.kind === 'escalate' ? 'escalated' : decision.kind === 'no_contact' ? 'no_contact' : 'held';
    updateOpportunity(db, opp.id, {
      stage: status,
      follow_up_due_at: null,
      last_question: decision.questionId,
      blocker: decision.kind === 'escalate' ? decision.reason : null,
    }, inbound.now);
    supersedeQueued(db, opp.id, inbound.now);
    const adapter = adapterFor(loadOpportunityById(db, opp.id)!, ctx);
    if (steps.length + 1 > ctx.policy.maxSteps) return budgetStop(db, inbound, opp, steps, 'Write the internal note.');
    adapter.writeRecord({ personKey: opp.personKey, note: decision.note, actionKey: `note:${opp.id}:${inbound.eventKey}` });
    steps.push('note');
    return finish(db, inbound, opp.id, status, null, decision, adapter.mode, steps);
  }

  const current = loadOpportunityById(db, opp.id)!;
  if (current.stage === 'ownership_paused' || current.takeover === 'human' || current.suppression !== 'none') {
    const revised = baseResult(opp.id, 'escalated', 'The record changed before send. The stale plan was not used.');
    supersedeQueued(db, opp.id, inbound.now);
    saveEventResult(db, inbound.eventKey, revised, attachHandoff);
    return revised;
  }

  const quiet = quietHold(inbound.now, ctx.policy);
  if (quiet) {
    updateOpportunity(db, opp.id, { follow_up_due_at: quiet, last_question: decision.questionId, stage: 'waiting' }, inbound.now);
    queueFollowUp(db, opp.id, quiet, decision.questionId, inbound.now);
    const held = finish(db, inbound, opp.id, 'held', null, { ...decision, note: `Quiet hours. Next permitted check ${quiet}.` }, 'none', [...steps, 'quiet_hours']);
    held.blocker = 'Outside quiet hours. Nothing was sent.';
    held.nextDueAt = quiet;
    saveEventResult(db, inbound.eventKey, held, attachHandoff);
    return held;
  }

  const actionKey = `send:${opp.id}:${decision.questionId}:${current.sourceVersion}`;
  if (steps.length + 2 > ctx.policy.maxSteps) return budgetStop(db, inbound, opp, steps, `Send ${decision.questionId} and write the note.`);
  const claim = tryClaim(db, {
    actionKey,
    opportunityId: opp.id,
    workerId: inbound.workerId,
    intent: 'send',
    body: decision.body,
    now: inbound.now,
  });
  if (claim === 'not_owner') {
    const skipped = baseResult(opp.id, 'not_owner', 'Another worker owns this outbound action.');
    skipped.actionKey = actionKey;
    saveEventResult(db, inbound.eventKey, skipped, attachHandoff);
    return skipped;
  }
  steps.push('claim');

  const adapter = adapterFor(current, ctx);
  const allowed = authorize(ctx.policy, adapter, current.isSynthetic);
  if (!allowed.ok) {
    finishClaim(db, actionKey, 'held', { reason: allowed.reason }, false, inbound.now);
    updateOpportunity(db, opp.id, { blocker: allowed.reason, stage: 'held' }, inbound.now);
    const held = finish(db, inbound, opp.id, 'held', actionKey, decision, adapter.mode, steps);
    held.blocker = allowed.reason;
    held.message = null;
    return held;
  }

  const receipt = adapter.send({ to: current.personKey, body: decision.body ?? '', actionKey });
  steps.push(`send:${receipt.outcome}`);
  if (receipt.outcome === 'ambiguous') {
    finishClaim(db, actionKey, 'ambiguous', receipt, false, inbound.now);
    updateOpportunity(db, opp.id, { blocker: 'Send result is unknown. Held for Kyle.', stage: 'ambiguous', follow_up_due_at: null }, inbound.now);
    supersedeQueued(db, opp.id, inbound.now);
    const held = finish(db, inbound, opp.id, 'ambiguous', actionKey, decision, receipt.mode, steps);
    held.blocker = 'Send result is unknown. It was not sent again.';
    held.live = false;
    return held;
  }
  if (receipt.outcome === 'auth_required') {
    finishClaim(db, actionKey, 'failed', receipt, false, inbound.now);
    updateOpportunity(db, opp.id, { blocker: 'Sign in is required. No bypass was attempted.', stage: 'paused_auth' }, inbound.now);
    const held = finish(db, inbound, opp.id, 'auth_required', actionKey, decision, receipt.mode, steps);
    held.blocker = 'Sign in is required. No bypass was attempted.';
    held.message = null;
    return held;
  }
  if (receipt.outcome !== 'sent') {
    finishClaim(db, actionKey, 'failed', receipt, false, inbound.now);
    updateOpportunity(db, opp.id, { blocker: receipt.reason, stage: 'held' }, inbound.now);
    const held = finish(db, inbound, opp.id, 'held', actionKey, decision, receipt.mode, steps);
    held.blocker = receipt.reason;
    held.message = null;
    held.live = false;
    return held;
  }

  if (decision.questionId === 'notify_buyer_access') {
    saveCheckpoint(db, opp.id, 'buyer_notified', 'satisfied', 'Buyer notification accepted by the synthetic channel.');
  }
  const write = adapter.writeRecord({ personKey: current.personKey, note: decision.note, actionKey });
  steps.push(`write:${write.outcome}`);
  const pendingWrite = write.outcome !== 'written';
  finishClaim(db, actionKey, 'succeeded', { send: receipt, write }, pendingWrite, inbound.now);

  const due = decision.scheduleFollowUp ? nextBusinessMorning(inbound.now).toISOString() : null;
  const followUps = inbound.kind === 'due' ? current.followUpCount + 1 : 0;
  updateOpportunity(db, opp.id, {
    stage: 'waiting',
    source_version: inbound.sourceVersion,
    policy_version: ctx.policy.version,
    follow_up_due_at: due,
    last_question: decision.questionId,
    follow_up_count: followUps,
    blocker: pendingWrite ? 'Message accepted. Record write is still pending.' : null,
  }, inbound.now);
  supersedeQueued(db, opp.id, inbound.now);
  if (due) queueFollowUp(db, opp.id, due, decision.questionId, inbound.now);

  const result = finish(db, inbound, opp.id, 'acted', actionKey, decision, receipt.mode, steps);
  result.live = receipt.mode === 'live' && receipt.live === true;
  result.nextDueAt = due;
  result.blocker = pendingWrite ? 'Message accepted. Record write is still pending.' : null;
  saveEventResult(db, inbound.eventKey, result, attachHandoff);
  return result;
}

export function reconcileDue(db: SqlDb, now: Date, ctx: RuntimeContext): WakeResult[] {
  const due = dueOpportunities(db, now);
  const results: WakeResult[] = [];
  for (const opp of due) {
    if (!opp.followUpDueAt) continue;
    results.push(wake(db, {
      eventKey: `due:${opp.id}:${opp.followUpDueAt}`,
      kind: 'due',
      personKey: opp.personKey,
      displayName: opp.displayName,
      text: '',
      actor: 'system',
      sourceVersion: opp.sourceVersion,
      relationshipOwner: opp.relationshipOwner,
      now,
      workerId: 'grok-bot',
      synthetic: opp.isSynthetic,
    }, ctx));
  }
  markRoutine(db, now);
  return results;
}

export function takeOver(db: SqlDb, personKey: string, reason: string, now: Date): void {
  const opp = loadOpportunity(db, personKey);
  if (!opp) return;
  updateOpportunity(db, opp.id, { takeover: 'human', takeover_reason: reason, follow_up_due_at: null, stage: 'takeover' }, now);
  supersedeQueued(db, opp.id, now);
}

export function optOut(db: SqlDb, personKey: string, now: Date): void {
  const opp = loadOpportunity(db, personKey);
  if (!opp) return;
  updateOpportunity(db, opp.id, { suppression: 'opted_out', follow_up_due_at: null, stage: 'suppressed' }, now);
  supersedeQueued(db, opp.id, now);
}

function resumeWrite(db: SqlDb, inbound: Inbound, ctx: RuntimeContext, opp: OpportunityRow, actionKey: string, body: string): WakeResult {
  const adapter = adapterFor(opp, ctx);
  const write = adapter.writeRecord({ personKey: opp.personKey, note: `Retry record write only. Prior message: ${body}`, actionKey });
  if (write.outcome === 'written') {
    finishClaim(db, actionKey, 'succeeded', { write, resumed: true }, false, inbound.now);
    updateOpportunity(db, opp.id, { blocker: null }, inbound.now);
  }
  const result = baseResult(opp.id, write.outcome === 'written' ? 'acted' : 'held', write.reason);
  result.actionKey = actionKey;
  result.mode = adapter.mode;
  result.live = false;
  result.message = null;
  result.note = 'Retried the record write only. The earlier message was not sent again.';
  result.steps = ['resume_write'];
  result.blocker = write.outcome === 'written' ? null : write.reason;
  const sends = countSendReceipts(db, opp.id);
  result.questionId = `writes_kept:${sends}`;
  saveEventResult(db, inbound.eventKey, result, attachHandoff);
  return result;
}

function applyMemory(db: SqlDb, opportunityId: string, inbound: Inbound, decision: Decision): void {
  for (const fact of decision.facts) {
    saveFact(db, opportunityId, fact.key, fact.value, fact.basis, inbound.text.slice(0, 240), inbound.sourceVersion);
  }
  for (const checkpoint of decision.checkpoints) {
    saveCheckpoint(db, opportunityId, checkpoint.key, checkpoint.status, checkpoint.evidence);
  }
}

function adapterFor(opp: OpportunityRow, ctx: RuntimeContext): ChannelAdapter {
  return opp.isSynthetic ? ctx.synthetic : ctx.live;
}

function authorize(policy: ReleasePolicy, adapter: ChannelAdapter, synthetic: boolean): { ok: true } | { ok: false; reason: string } {
  if (adapter.mode === 'unverified') return { ok: false, reason: 'Live connector is unverified. No production send was attempted.' };
  if (adapter.mode === 'live' && !policy.liveSend) return { ok: false, reason: 'Release decision is not stored. Live send is inactive.' };
  if (synthetic && adapter.mode === 'synthetic' && !policy.syntheticSend) return { ok: false, reason: 'Synthetic send is not turned on for this policy.' };
  if (synthetic && adapter.mode === 'synthetic' && policy.syntheticSend) return { ok: true };
  if (!synthetic && policy.liveSend && adapter.mode === 'live') return { ok: true };
  return { ok: false, reason: 'No allowed channel for this opportunity.' };
}

function quietHold(now: Date, policy: ReleasePolicy): string | null {
  const parts = zonedParts(now);
  if (parts.hour >= policy.quietStartHour && parts.hour < policy.quietEndHour) return null;
  return nextBusinessMorning(now).toISOString();
}

function budgetStop(db: SqlDb, inbound: Inbound, opp: OpportunityRow, steps: string[], remaining: string): WakeResult {
  const result = baseResult(opp.id, 'budget', `Step budget reached. Remaining: ${remaining}`);
  result.steps = steps;
  result.blocker = result.message;
  updateOpportunity(db, opp.id, { blocker: result.message, stage: 'paused_budget' }, inbound.now);
  saveEventResult(db, inbound.eventKey, result, attachHandoff);
  return result;
}

function finish(
  db: SqlDb,
  inbound: Inbound,
  opportunityId: string,
  status: WakeResult['status'],
  actionKey: string | null,
  decision: Decision,
  mode: WakeResult['mode'],
  steps: string[],
): WakeResult {
  const fresh = loadOpportunityById(db, opportunityId)!;
  const result = baseResult(opportunityId, status, decision.reason);
  result.actionKey = actionKey;
  result.mode = mode;
  result.live = false;
  result.message = decision.kind === 'send' ? decision.body : null;
  result.note = decision.note;
  result.questionId = decision.questionId;
  result.steps = steps;
  result.missingCheckpoints = missingCheckpoints(fresh);
  result.checkpointOwners = result.missingCheckpoints.map((checkpoint) => ({ checkpoint, owner: CHECKPOINT_OWNERS[checkpoint] }));
  result.showingFullyConfirmed = showingFullyConfirmed(fresh);
  result.nextDueAt = fresh.followUpDueAt;
  saveEventResult(db, inbound.eventKey, result, attachHandoff);
  return result;
}

function baseResult(opportunityId: string | null, status: WakeResult['status'], message: string | null): WakeResult {
  return {
    opportunityId,
    status,
    actionKey: null,
    live: false,
    mode: 'none',
    message,
    note: null,
    nextDueAt: null,
    showingFullyConfirmed: false,
    missingCheckpoints: [...SHOWING_CHECKPOINTS],
    checkpointOwners: SHOWING_CHECKPOINTS.map((checkpoint) => ({ checkpoint, owner: CHECKPOINT_OWNERS[checkpoint] })),
    blocker: null,
    questionId: null,
    steps: [],
    handoff: '',
  };
}

function attachHandoff(value: unknown): void {
  const result = value as WakeResult;
  result.handoff = handoffReport(result);
}

export function handoffReport(result: WakeResult): string {
  const move = result.status === 'acted'
    ? `Next move: ${result.questionId ?? 'follow up'}. Sent through ${result.mode} channel. Live: ${result.live}.`
    : `Next move: none sent. Status ${result.status}.`;
  const message = result.status === 'acted' && result.message ? `Exact message: ${result.message}` : 'Exact message: none.';
  const note = `Agent Tools note (drafted, not saved to Agent Tools): ${result.note ?? 'none'}`;
  const followUp = result.nextDueAt ? `Follow up: Grok Bot at ${result.nextDueAt}.` : 'Follow up: none scheduled.';
  const status = result.blocker ? `Execution status: ${result.status}. Blocker: ${result.blocker}` : `Execution status: ${result.status}.`;
  const showing = result.missingCheckpoints.length
    ? `Showing not fully confirmed. Missing: ${result.checkpointOwners.map((item) => `${item.checkpoint} (${item.owner})`).join(', ')}.`
    : 'Showing fully confirmed.';
  return [move, message, note, followUp, status, showing].join('\n');
}
