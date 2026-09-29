import { randomUUID } from 'node:crypto';
import { extractLead, type Extraction } from './extract.ts';
import { text, type SqlDb } from './sql.ts';
import { draftClientMessage } from './voice.ts';
import { getReview, intakeLead, previewMatch, type IntakeInput, type IntakeResult, type IntakeStatus } from './workflow.ts';

export const INQUIRY_AGENT = {
  id: 'inquiry',
  name: 'Inquiry agent',
  goal: 'Turn one visible inquiry into SEND, NOTE, and NEXT. Do not send it.',
} as const;

export const AGENT_TOOLS = [
  'extract_visible_facts',
  'match_contact',
  'propose_package',
  'read_package',
  'refuse_send',
] as const;

export const FORBIDDEN_TOOLS = ['send_sms', 'send_email', 'redfin_write', 'mls_lookup', 'showingtime_book'] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];
export type AgentStatus = 'completed' | 'held' | 'failed';

export interface AgentStep {
  position: number;
  tool: AgentTool;
  decision: string;
  input: unknown;
  output: unknown;
}

export interface AgentRun {
  id: string;
  goal: string;
  status: IntakeStatus | 'failed';
  agentStatus: AgentStatus;
  sourceKind: 'paste' | 'screenshot';
  reviewId: string | null;
  contactId: string | null;
  draftId: string | null;
  outcome: string;
  message: string;
  send: { sent: false; reason: string };
  createdAt: string;
  steps: AgentStep[];
}

const SEND_BLOCK = 'This agent has no send tool. Nothing was sent.';

export function runInquiryAgent(db: SqlDb, input: IntakeInput): AgentRun {
  const now = input.now ?? new Date();
  const runId = randomUUID();
  const createdAt = now.toISOString();
  db.run(
    `INSERT INTO agent_runs (id, goal, status, source_kind, intake_status, review_id, contact_id, outcome, created_at)
     VALUES (?, ?, 'running', ?, NULL, NULL, NULL, '', ?)`,
    runId,
    INQUIRY_AGENT.goal,
    input.sourceKind,
    createdAt,
  );
  const steps: AgentStep[] = [];
  const record = (tool: AgentTool, decision: string, stepInput: unknown, output: unknown) => {
    const position = steps.length + 1;
    steps.push({ position, tool, decision, input: stepInput, output });
    db.run(
      `INSERT INTO agent_steps (id, run_id, position, tool, decision, input_json, output_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      runId,
      position,
      tool,
      decision,
      JSON.stringify(stepInput),
      JSON.stringify(output),
      createdAt,
    );
  };

  try {
    const extraction = extractLead(input.text ?? '', {
      unclearSpans: input.unclearSpans ?? [],
      ocrConfidence: input.ocrConfidence ?? null,
    });
    const factSummary = summarizeFacts(extraction);
    record('extract_visible_facts', factSummary.decision, { sourceKind: input.sourceKind, textLength: (input.text ?? '').length }, {
      ...factSummary,
      allowedTools: AGENT_TOOLS,
      forbiddenTools: FORBIDDEN_TOOLS,
    });

    const match = previewMatch(db, extraction);
    record('match_contact', match.reason, { decision: match.decision }, match);

    const intake = intakeLead(db, input);
    record('propose_package', intake.message, { match: match.decision }, {
      status: intake.status,
      contactId: intake.contactId,
      reviewId: intake.reviewId,
      draftId: intake.draftId,
    });

    const pack = readPackage(db, intake, extraction);
    record('read_package', pack.decision, { reviewId: intake.reviewId }, pack);
    record('refuse_send', SEND_BLOCK, { draftId: intake.draftId }, { sent: false, reason: SEND_BLOCK });

    const status = finishStatus(intake.status);
    const outcome = `${intake.message} ${SEND_BLOCK}`;
    db.run(
      `UPDATE agent_runs SET status = ?, intake_status = ?, review_id = ?, contact_id = ?, outcome = ? WHERE id = ?`,
      status,
      intake.status,
      intake.reviewId,
      intake.contactId,
      outcome,
      runId,
    );
    return {
      id: runId,
      goal: INQUIRY_AGENT.goal,
      status: intake.status,
      agentStatus: status,
      sourceKind: input.sourceKind,
      reviewId: intake.reviewId,
      contactId: intake.contactId,
      draftId: intake.draftId,
      outcome,
      message: intake.message,
      send: { sent: false, reason: SEND_BLOCK },
      createdAt,
      steps,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The inquiry agent stopped.';
    record('refuse_send', 'The run failed before a send could exist.', {}, { sent: false, reason: SEND_BLOCK, error: message });
    db.run(`UPDATE agent_runs SET status = 'failed', outcome = ? WHERE id = ?`, message, runId);
    return {
      id: runId,
      goal: INQUIRY_AGENT.goal,
      status: 'failed',
      agentStatus: 'failed',
      sourceKind: input.sourceKind,
      reviewId: null,
      contactId: null,
      draftId: null,
      outcome: message,
      message,
      send: { sent: false, reason: SEND_BLOCK },
      createdAt,
      steps,
    };
  }
}

export function getAgentRun(db: SqlDb, runId: string): AgentRun | null {
  const row = db.get(`SELECT * FROM agent_runs WHERE id = ?`, runId);
  if (!row) return null;
  return hydrate(db, row);
}

export function listAgentRuns(db: SqlDb, reviewId?: string | null): AgentRun[] {
  const rows = reviewId
    ? db.all(`SELECT * FROM agent_runs WHERE review_id = ? ORDER BY created_at DESC`, reviewId)
    : db.all(`SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 20`);
  return rows.map((row) => hydrate(db, row));
}

function hydrate(db: SqlDb, row: Record<string, unknown>): AgentRun {
  const steps = db.all(`SELECT * FROM agent_steps WHERE run_id = ? ORDER BY position ASC`, text(row, 'id')).map((step) => ({
    position: Number(step.position),
    tool: text(step, 'tool') as AgentTool,
    decision: text(step, 'decision'),
    input: JSON.parse(text(step, 'input_json') || '{}') as unknown,
    output: JSON.parse(text(step, 'output_json') || '{}') as unknown,
  }));
  const proposed = steps.find((step) => step.tool === 'propose_package');
  const proposedOutput = proposed && typeof proposed.output === 'object' && proposed.output ? proposed.output as { draftId?: string | null } : null;
  return {
    id: text(row, 'id'),
    goal: text(row, 'goal'),
    status: (text(row, 'intake_status') || 'failed') as IntakeStatus | 'failed',
    agentStatus: text(row, 'status') as AgentStatus,
    sourceKind: text(row, 'source_kind') === 'screenshot' ? 'screenshot' : 'paste',
    reviewId: text(row, 'review_id') || null,
    contactId: text(row, 'contact_id') || null,
    draftId: proposedOutput?.draftId ?? null,
    outcome: text(row, 'outcome'),
    message: text(row, 'outcome'),
    send: { sent: false, reason: SEND_BLOCK },
    createdAt: text(row, 'created_at'),
    steps,
  };
}

function finishStatus(status: IntakeResult['status']): AgentStatus {
  if (status === 'created' || status === 'attached' || status === 'duplicate') return 'completed';
  return 'held';
}

function summarizeFacts(extraction: Extraction): { decision: string; known: string[]; missing: string[]; financing: string; showingConfirmed: string } {
  const known = Object.values(extraction.fields).filter((field) => field.status === 'known' && field.value).map((field) => field.label);
  const missing = Object.values(extraction.fields).filter((field) => field.status !== 'known').map((field) => field.label);
  const financing = extraction.fields.financing_status;
  const showing = extraction.fields.showing_confirmed;
  const requested = extraction.fields.showing_requested;
  let decision = known.length ? `Kept ${known.length} visible facts. Left the rest missing.` : 'No clear facts. Nothing will be guessed.';
  if (requested.status === 'known' && showing.status !== 'known') decision += ' The requested showing is not confirmed.';
  if (financing.status !== 'known') decision += ' Financing was not inferred.';
  return {
    decision,
    known,
    missing,
    financing: financing.status === 'known' ? `${financing.basis}: ${financing.value}` : 'missing',
    showingConfirmed: showing.status === 'known' ? `${showing.basis}: ${showing.value}` : 'missing',
  };
}

function readPackage(db: SqlDb, intake: IntakeResult, extraction: Extraction): { decision: string; send: string | null; note: string | null; next: string | null } {
  const review = intake.reviewId ? getReview(db, intake.reviewId) : null;
  const payload = review && typeof review.payload === 'object' && review.payload ? review.payload as { draftBody?: string; crmNote?: string; followUp?: { action?: string } } : null;
  const draft = payload?.draftBody || (intake.draftId ? draftClientMessage(extraction).body : null);
  if (!payload && !draft) {
    return { decision: 'No SEND, NOTE, or NEXT. The inquiry is waiting on a person.', send: null, note: null, next: null };
  }
  return {
    decision: 'SEND, NOTE, and NEXT are ready for review. They are not delivered.',
    send: payload?.draftBody ?? draft,
    note: payload?.crmNote ?? null,
    next: payload?.followUp?.action ?? null,
  };
}
