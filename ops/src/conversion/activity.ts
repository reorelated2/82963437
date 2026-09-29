import { randomUUID } from 'node:crypto';
import { text, type SqlDb } from '../sql.ts';

export type ActivityKind = 'showing_requested' | 'showing_confirmed' | 'event_scheduled' | 'event_completed' | 'contact_touch';

const KYLE = /^kyle(\s+kleinman)?$/i;

export function recordActivity(db: SqlDb, input: {
  opportunityId: string;
  kind: ActivityKind;
  actor: string;
  note?: string;
  now?: Date;
}): { applied: boolean; verified: boolean; state: string; reason: string; live: false } {
  const now = input.now ?? new Date();
  const actor = input.actor.trim();
  const automated = /system|automation|import|coordinator/i.test(actor);
  const kyle = KYLE.test(actor);

  if (input.kind === 'showing_confirmed') {
    const requested = db.get(
      `SELECT id FROM activity_log WHERE opportunity_id = ? AND kind = 'showing_requested'`,
      input.opportunityId,
    );
    if (!requested || !kyle) {
      writeActivity(db, input.opportunityId, 'showing_requested', actor, 'requested', false, input.note ?? 'Showing request was not confirmed.', now);
      return { applied: false, verified: false, state: 'requested', reason: 'A requested showing is not a confirmed showing.', live: false };
    }
    writeActivity(db, input.opportunityId, 'showing_confirmed', actor, 'confirmed', true, input.note ?? 'Kyle confirmed the showing.', now);
    return { applied: true, verified: true, state: 'confirmed', reason: 'Kyle confirmed the showing.', live: false };
  }

  if (input.kind === 'event_completed') {
    const scheduled = db.get(
      `SELECT id FROM activity_log WHERE opportunity_id = ? AND kind = 'event_scheduled'`,
      input.opportunityId,
    );
    if (!scheduled || !kyle) {
      return { applied: false, verified: false, state: 'scheduled', reason: 'A scheduled event is not a completed event.', live: false };
    }
    writeActivity(db, input.opportunityId, 'event_completed', actor, 'completed', true, input.note ?? 'Kyle marked the event complete.', now);
    return { applied: true, verified: true, state: 'completed', reason: 'Kyle marked the event complete.', live: false };
  }

  if (input.kind === 'contact_touch') {
    if (!kyle || automated) {
      writeActivity(db, input.opportunityId, 'contact_touch', actor, 'unverified', false, input.note ?? 'This touch is not Kyle contact.', now);
      const reason = /coordinator/i.test(actor)
        ? 'Coordinator contact is not Kyle contact.'
        : 'Automated activity is not verified human contact.';
      return { applied: true, verified: false, state: 'unverified', reason, live: false };
    }
    writeActivity(db, input.opportunityId, 'contact_touch', actor, 'verified', true, input.note ?? 'Kyle made contact.', now);
    db.run(
      `UPDATE opportunities SET last_meaningful_contact_at = ?, last_meaningful_contact_by = ?, contact_verification = 'verified', updated_at = ? WHERE id = ?`,
      now.toISOString(),
      actor,
      now.toISOString(),
      input.opportunityId,
    );
    return { applied: true, verified: true, state: 'verified', reason: 'Kyle contact stored as verified.', live: false };
  }

  writeActivity(db, input.opportunityId, input.kind, actor, input.kind === 'showing_requested' ? 'requested' : 'scheduled', false, input.note ?? '', now);
  return {
    applied: true,
    verified: false,
    state: input.kind === 'showing_requested' ? 'requested' : 'scheduled',
    reason: input.kind === 'showing_requested' ? 'Showing stored as requested only.' : 'Event stored as scheduled only.',
    live: false,
  };
}

export function activityState(db: SqlDb, opportunityId: string, kind: ActivityKind): string {
  const row = db.get(
    `SELECT state FROM activity_log WHERE opportunity_id = ? AND kind = ? ORDER BY created_at DESC`,
    opportunityId,
    kind,
  );
  return text(row, 'state');
}

function writeActivity(db: SqlDb, opportunityId: string, kind: string, actor: string, state: string, verified: boolean, note: string, now: Date): void {
  db.run(
    `INSERT INTO activity_log (id, opportunity_id, kind, actor, state, verified, note, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    opportunityId,
    kind,
    actor,
    state,
    verified ? 1 : 0,
    note,
    'desk',
    now.toISOString(),
  );
}
