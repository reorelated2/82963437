import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractLead } from '../src/extract.ts';
import { openDatabase } from '../src/db.ts';
import { startServer } from '../src/server.ts';
import { nextBusinessMorning } from '../src/time.ts';
import { draftClientMessage, sanitizeClientCopy } from '../src/voice.ts';
import {
  approveReview,
  attemptSend,
  backupDatabase,
  checkRedfinConnection,
  getContact,
  getReview,
  getWorkspace,
  intakeLead,
  seedDemo,
  setSuppression,
  updateSettings,
} from '../src/workflow.ts';
import { copyFileSync } from 'node:fs';

const NOW = new Date('2026-09-24T15:00:00.000Z');

const NATE = `Name: Nate Alvarez
Source: Redfin
Property: North Miami property
Requested showing: 5:30`;

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kleinman-desk-'));
  return { dir, db: openDatabase(join(dir, 'desk.sqlite')), path: join(dir, 'desk.sqlite') };
}

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  const row = db.get(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row?.n ?? 0);
}

test('missing facts stay unknown and financing is not inferred', () => {
  const extraction = extractLead(`Name: Nate Alvarez
Phone: (305) 555-0199
Nate is looking around North Miami and mentioned financing.`);
  assert.equal(extraction.fields.budget.status, 'data_needed');
  assert.equal(extraction.fields.budget.value, null);
  assert.equal(extraction.fields.financing_status.status, 'data_needed');
  assert.equal(extraction.fields.showing_confirmed.status, 'data_needed');
  assert.ok(extraction.warnings.some((warning) => warning.includes('Approval was not inferred')));
});

test('a requested showing is not stored as confirmed', () => {
  const extraction = extractLead('Name: Nate Alvarez\nDoes 5:30 pm work for a showing if I can get it confirmed?');
  assert.equal(extraction.fields.showing_requested.status, 'known');
  assert.match(extraction.fields.showing_requested.value ?? '', /5:30 pm/i);
  assert.equal(extraction.fields.showing_confirmed.status, 'data_needed');
  assert.equal(extraction.fields.showing_available.status, 'data_needed');
});

test('client availability stays separate from a confirmed showing', () => {
  const extraction = extractLead("Name: Nate Alvarez\nNate: I'm available at 6 pm.\nKyle: I will check.");
  assert.equal(extraction.fields.showing_available.status, 'known');
  assert.equal(extraction.fields.showing_confirmed.status, 'data_needed');
  assert.equal(extraction.stage, 'continuing');
});

test('explicit confirmation is kept only when the source says it', () => {
  const extraction = extractLead('Name: Nate Alvarez\nThe showing is confirmed for 5:30 pm.');
  assert.equal(extraction.fields.showing_confirmed.status, 'known');
  assert.match(extraction.fields.showing_confirmed.value ?? '', /5:30 pm/i);
});

test('new inquiry draft matches Kyle voice without dashes or a booked showing', () => {
  const extraction = extractLead(NATE);
  const draft = draftClientMessage(extraction);
  assert.equal(
    draft.body,
    'Hey Nate, Kyle Kleinman with Redfin. I saw your request for the North Miami property. Does 5:30 work for you if I can get it confirmed?',
  );
  assert.equal(draft.body.split('?').length - 1, 1);
  assert.equal(draft.body.includes('-'), false);
  assert.equal(draft.body.includes('—'), false);
  assert.equal(/^Hey Nate/.test(draft.body), true);
});

test('an existing conversation does not restart with a greeting', () => {
  const extraction = extractLead(`Nate: Is Saturday still possible?
Kyle: I can check the listing side.
Budget: $650K`);
  extraction.fields.name = { ...extraction.fields.name, value: 'Nate Alvarez', status: 'known', evidence: 'test' };
  const draft = draftClientMessage(extraction);
  assert.equal(draft.body.startsWith('Hey'), false);
  assert.equal(draft.body.startsWith('Hi'), false);
  assert.equal(sanitizeClientCopy(draft.body).includes('-'), false);
});

test('money is written as $650K', () => {
  const extraction = extractLead('Name: Ada Lopez\nBudget: $650,000');
  assert.equal(extraction.fields.budget.value, '$650K');
});

test('conflicting budgets in one paste are not collapsed', () => {
  const extraction = extractLead('Name: Ada Lopez\nBudget: $650K and $700K');
  assert.equal(extraction.fields.budget.status, 'unclear');
  assert.equal(extraction.fields.budget.value, null);
  assert.match(extraction.fields.budget.evidence ?? '', /\$650K/);
  assert.match(extraction.fields.budget.evidence ?? '', /\$700K/);
});

test('unclear screenshot text is flagged and does not become a contact', () => {
  const { db } = tempDb();
  const result = intakeLead(db, {
    text: 'N4te ??? ### budget [illegible]',
    sourceKind: 'screenshot',
    ocrConfidence: 22,
    unclearSpans: ['N4te ???'],
    now: NOW,
  });
  assert.equal(result.status, 'unreadable');
  assert.equal(result.contactId, null);
  assert.equal(count(db, 'contacts'), 0);
  assert.equal(count(db, 'drafts'), 0);
  const workspace = getWorkspace(db, NOW);
  assert.equal(workspace.newLeads.length, 1);
  assert.match(workspace.newLeads[0].reason, /unclear/i);
  db.close();
});

test('duplicate imports do not create a second contact, draft, or task', () => {
  const { db } = tempDb();
  const first = intakeLead(db, { text: `${NATE}\nPhone: (305) 555-0148`, sourceKind: 'paste', now: NOW, idempotencyKey: 'lead-1' });
  const second = intakeLead(db, { text: `${NATE}\nPhone: (305) 555-0148`, sourceKind: 'paste', now: NOW, idempotencyKey: 'lead-1' });
  const third = intakeLead(db, { text: `${NATE}\nPhone: (305) 555-0148\n`, sourceKind: 'paste', now: NOW });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'duplicate');
  assert.equal(third.status, 'duplicate');
  assert.equal(count(db, 'contacts'), 1);
  assert.equal(count(db, 'drafts'), 1);
  approveReview(db, first.reviewId ?? '', NOW);
  approveReview(db, first.reviewId ?? '', NOW);
  assert.equal(count(db, 'tasks'), 1);
  assert.equal(count(db, 'notes'), 1);
  db.close();
});

test('same phone updates the contact and keeps a conflicting budget', () => {
  const { db } = tempDb();
  intakeLead(db, { text: 'Name: Ada Lopez\nPhone: (305) 555-0177\nBudget: $650K', sourceKind: 'paste', now: NOW });
  const second = intakeLead(db, { text: 'Name: Ada Lopez\nPhone: (305) 555-0177\nBudget: $700K\nTimeline: 60 days', sourceKind: 'paste', now: NOW });
  assert.equal(second.status, 'attached');
  assert.equal(count(db, 'contacts'), 1);
  const contact = getContact(db, second.contactId ?? '');
  assert.ok(contact);
  assert.equal(contact?.facts.find((fact) => fact.key === 'budget')?.value, '$650K');
  assert.equal(contact?.conflicts.length, 1);
  assert.equal(contact?.conflicts[0].incomingValue, '$700K');
  db.close();
});

test('an uncertain name match is reviewed and not merged', () => {
  const { db } = tempDb();
  const first = intakeLead(db, { text: 'Name: Elena Cruz\nPhone: (305) 555-0133\nProperty: 10 Main St', sourceKind: 'paste', now: NOW });
  const second = intakeLead(db, { text: 'Name: Elena Cruz\nProperty: a different house in Aventura', sourceKind: 'paste', now: NOW });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'possible_duplicate');
  assert.equal(second.contactId, null);
  assert.equal(count(db, 'contacts'), 1);
  assert.equal(count(db, 'drafts'), 1);
  db.close();
});

test('draft mode sends nothing and a failed connection is visible', () => {
  const { db } = tempDb();
  const created = intakeLead(db, { text: `${NATE}\nPhone: (305) 555-0148`, sourceKind: 'paste', now: NOW });
  const blocked = attemptSend(db, created.draftId ?? '');
  assert.equal(blocked.sent, false);
  assert.match(blocked.reason, /Nothing was sent/);
  assert.equal(count(db, 'sent_messages'), 0);
  const draft = db.get(`SELECT status FROM drafts WHERE id = ?`, created.draftId ?? '');
  assert.equal(String(draft?.status), 'draft');
  updateSettings(db, { outboundPaused: false });
  const stillBlocked = attemptSend(db, created.draftId ?? '');
  assert.equal(stillBlocked.sent, false);
  assert.match(stillBlocked.reason, /authorized/);
  assert.equal(count(db, 'sent_messages'), 0);
  const failure = checkRedfinConnection(db, NOW);
  assert.equal(failure.ok, false);
  const workspace = getWorkspace(db, NOW);
  assert.ok(workspace.failedAutomations.some((item) => item.id === failure.jobId));
  db.close();
});

test('approved notes name the right client and survive a restart', () => {
  const { db, path } = tempDb();
  const nate = intakeLead(db, { text: `${NATE}\nPhone: (305) 555-0148`, sourceKind: 'paste', now: NOW });
  const ada = intakeLead(db, { text: 'Name: Ada Lopez\nPhone: (305) 555-0166\nProperty: Hollywood property', sourceKind: 'paste', now: NOW });
  const approved = approveReview(db, nate.reviewId ?? '', NOW);
  assert.equal(approved.ok, true);
  db.close();
  const reopened = openDatabase(path);
  const contact = getContact(reopened, nate.contactId ?? '');
  assert.ok(contact);
  assert.match(contact?.notes[0].body ?? '', /Nate Alvarez/);
  assert.equal((contact?.notes[0].body ?? '').includes('Ada Lopez'), false);
  assert.equal(contact?.tasks.length, 1);
  const other = getContact(reopened, ada.contactId ?? '');
  assert.equal(other?.notes.length, 0);
  const nateDraft = contact?.drafts[0].body ?? '';
  assert.match(nateDraft, /Nate/);
  assert.equal(nateDraft.includes('Ada'), false);
  reopened.close();
});

test('follow up lands on the next business morning', () => {
  const due = nextBusinessMorning(NOW);
  assert.equal(due.toISOString(), '2026-09-25T13:00:00.000Z');
  const fridayEvening = new Date('2026-09-25T22:00:00.000Z');
  assert.equal(nextBusinessMorning(fridayEvening).toISOString(), '2026-09-28T13:00:00.000Z');
});

test('backup restore returns the saved client', () => {
  const { db, path, dir } = tempDb();
  const created = intakeLead(db, { text: `${NATE}\nPhone: (305) 555-0148`, sourceKind: 'paste', now: NOW });
  db.close();
  const backup = join(dir, 'backup.sqlite');
  backupDatabase(path, backup);
  const changed = openDatabase(path);
  changed.run(`UPDATE contacts SET display_name = ? WHERE id = ?`, 'Changed Name', created.contactId);
  changed.close();
  copyFileSync(backup, path);
  const restored = openDatabase(path);
  const contact = getContact(restored, created.contactId ?? '');
  assert.equal(contact?.displayName, 'Nate Alvarez');
  restored.close();
});

test('sample workspace shows each attention group and labels demo records', () => {
  const { db } = tempDb();
  const seeded = seedDemo(db, NOW);
  assert.equal(seeded.created, true);
  assert.equal(seedDemo(db, NOW).created, false);
  const workspace = getWorkspace(db, NOW);
  assert.ok(workspace.newLeads.length >= 1);
  assert.ok(workspace.needsReply.length >= 1);
  assert.ok(workspace.appointmentsToday.length >= 1);
  assert.ok(workspace.overdueFollowUps.length >= 1);
  assert.ok(workspace.milestones.length >= 1);
  assert.ok(workspace.drafts.length >= 1);
  assert.ok(workspace.failedAutomations.length >= 1);
  assert.ok(workspace.demoCount >= 1);
  assert.match(workspace.headline, /needs attention/);
  assert.equal(workspace.appointmentsToday[0].nextStep.includes('not a confirmed'), true);
  assert.ok(workspace.noNextAction.some((item) => item.title === 'Pat Nguyen' && item.isDemo));
  assert.match(workspace.replyConnector.nextStep, /Connector blocked/);
  assert.ok(workspace.systemHealth.some((item) => item.title === 'ShowingTime'));
  assert.ok(workspace.systemHealth.some((item) => item.title === 'MLS'));
  db.close();
});

async function signIn(base: string): Promise<string> {
  const denied = await fetch(`${base}/api/workspace`);
  assert.equal(denied.status, 401);
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'local-kyle' }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0];
}

test('ambiguous text does not become a contact or a guessed name', () => {
  const { db } = tempDb();
  const result = intakeLead(db, {
    text: 'Name: N?te [illegible]\nPhone: (305) 555-0100\nPhone: (305) 555-0199\nBudget: ???',
    sourceKind: 'paste',
    now: NOW,
  });
  assert.equal(result.contactId, null);
  assert.equal(count(db, 'contacts'), 0);
  assert.equal(count(db, 'drafts'), 0);
  db.close();
});

test('a different person with a similar name is not matched', () => {
  const { db } = tempDb();
  const nate = intakeLead(db, { text: 'Name: Nate Alvarez\nPhone: (305) 555-0148\nBudget: $650K', sourceKind: 'paste', now: NOW });
  const nathan = intakeLead(db, { text: 'Name: Nathan Alvarez\nPhone: (305) 555-0190\nBudget: $700K', sourceKind: 'paste', now: NOW });
  assert.equal(nate.status, 'created');
  assert.equal(nathan.status, 'created');
  assert.notEqual(nate.contactId, nathan.contactId);
  assert.equal(count(db, 'contacts'), 2);
  const second = getContact(db, nathan.contactId ?? '');
  assert.equal(second?.facts.find((fact) => fact.key === 'budget')?.value, '$700K');
  assert.equal(second?.conflicts.length, 0);
  db.close();
});

test('requested showing language never says the showing is confirmed', () => {
  const { db } = tempDb();
  const created = intakeLead(db, { text: `${NATE}\nPhone: (305) 555-0148`, sourceKind: 'paste', now: NOW });
  const review = getReview(db, created.reviewId ?? '');
  const payload = review?.payload as { draftBody: string; crmNote: string; followUp: { action: string } };
  assert.equal(/showing is confirmed|you're confirmed|you are confirmed/i.test(payload.draftBody), false);
  assert.match(payload.crmNote, /Confirmed showing: Data needed/);
  assert.match(payload.followUp.action, /not confirmed/i);
  const contact = getContact(db, created.contactId ?? '');
  assert.equal(contact?.facts.find((fact) => fact.key === 'showing_requested')?.basis, 'said');
  assert.equal(contact?.facts.find((fact) => fact.key === 'showing_confirmed')?.basis, 'missing');
  assert.equal(contact?.facts.find((fact) => fact.key === 'financing_status')?.status, 'data_needed');
  db.close();
});

test('a reply in an open conversation does not restart the introduction', () => {
  const { db } = tempDb();
  intakeLead(db, { text: 'Name: Riley Chen\nPhone: (305) 555-0122\nProperty: North Miami property', sourceKind: 'paste', now: NOW });
  const reply = intakeLead(db, {
    text: `Phone: (305) 555-0122
Riley: Is 5:30 pm still possible?
Kyle: I can check.`,
    sourceKind: 'paste',
    now: NOW,
  });
  assert.equal(reply.status, 'attached');
  const review = getReview(db, reply.reviewId ?? '');
  const payload = review?.payload as { draftBody: string; followUp: { action: string }; stage: string };
  assert.equal(payload.stage, 'continuing');
  assert.equal(payload.draftBody.startsWith('Hey'), false);
  assert.match(payload.followUp.action, /latest message/);
  const contact = getContact(db, reply.contactId ?? '');
  assert.equal(contact?.facts.find((fact) => fact.key === 'showing_confirmed')?.status, 'data_needed');
  db.close();
});

test('opt out blocks delivery and keeps the audit trail', () => {
  const { db } = tempDb();
  const created = intakeLead(db, { text: 'Name: Ada Lopez\nPhone: (305) 555-0171', sourceKind: 'paste', now: NOW });
  setSuppression(db, created.contactId ?? '', 'opted_out', NOW);
  const again = intakeLead(db, { text: 'Name: Ada Lopez\nPhone: (305) 555-0171\nBudget: $500K', sourceKind: 'paste', now: NOW });
  const draft = db.get(`SELECT status FROM drafts WHERE id = ?`, again.draftId ?? '');
  assert.equal(String(draft?.status), 'blocked');
  const blocked = attemptSend(db, again.draftId ?? '');
  assert.equal(blocked.sent, false);
  assert.match(blocked.reason, /opted out/);
  assert.equal(count(db, 'sent_messages'), 0);
  const workspace = getWorkspace(db, NOW);
  assert.ok(workspace.failedAutomations.some((item) => item.title === 'Delivery blocked'));
  const audits = db.all(`SELECT action FROM audit_log`);
  assert.ok(audits.some((row) => String(row.action) === 'contact_created'));
  assert.ok(audits.some((row) => String(row.action) === 'send_blocked'));
  db.close();
});

test('follow up uses Eastern time after the fall clock change', () => {
  const fridayEvening = new Date('2026-11-06T23:00:00.000Z');
  assert.equal(nextBusinessMorning(fridayEvening).toISOString(), '2026-11-09T14:00:00.000Z');
});

test('http intake approve and blocked send survive a new process connection', async () => {
  const fixture = tempDb();
  fixture.db.close();
  const server = await startServer({ port: 0, dbPath: fixture.path });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const cookie = await signIn(base);
    const created = await (await fetch(`${base}/api/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: `${NATE}\nPhone: (305) 555-0188\nEmail: nate.http@example.com` }),
    })).json() as { reviewId: string; draftId: string; contactId: string; message: string };
    assert.match(created.message, /Nothing was sent/);
    const approved = await (await fetch(`${base}/api/reviews/${created.reviewId}/approve`, { method: 'POST', headers: { cookie } })).json() as { message: string };
    assert.match(approved.message, /was not sent/);
    const blocked = await (await fetch(`${base}/api/drafts/${created.draftId}/send`, { method: 'POST', headers: { cookie } })).json() as { sent: boolean; reason: string };
    assert.equal(blocked.sent, false);
    await server.close();
    const again = await startServer({ port: 0, dbPath: fixture.path });
    try {
      const againCookie = await signIn(`http://127.0.0.1:${again.port}`);
      const contact = await (await fetch(`http://127.0.0.1:${again.port}/api/contacts/${created.contactId}`, { headers: { cookie: againCookie } })).json() as { displayName: string; notes: Array<{ body: string }> };
      assert.equal(contact.displayName, 'Nate Alvarez');
      assert.match(contact.notes[0].body, /Nate Alvarez/);
    } finally {
      await again.close();
    }
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
});

test('a clean screenshot can be read without inventing a confirmation', async () => {
  const python = spawnSync('python3', ['-c', 'import PIL'], { encoding: 'utf8' });
  if (python.status !== 0) {
    assert.fail('Pillow is required to draw the screenshot fixture.');
  }
  const dir = mkdtempSync(join(tmpdir(), 'kleinman-shot-'));
  const imagePath = join(dir, 'lead.png');
  const drawn = spawnSync('python3', ['-c', `
from PIL import Image, ImageDraw, ImageFont
image = Image.new('RGB', (1400, 700), 'white')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 42)
lines = [
  'Name: Nate Alvarez',
  'Phone: (305) 555-0148',
  'Property: North Miami property',
  'Requested showing: 5:30 pm today',
  'Budget: $650K',
]
y = 40
for line in lines:
    draw.text((40, y), line, fill='black', font=font)
    y += 70
image.save(${JSON.stringify(imagePath)})
`], { encoding: 'utf8' });
  assert.equal(drawn.status, 0, drawn.stderr);
  const server = await startServer({ port: 0, dbPath: join(dir, 'desk.sqlite') });
  try {
    const bytes = spawnSync('python3', ['-c', `import base64, pathlib; print(base64.b64encode(pathlib.Path(${JSON.stringify(imagePath)}).read_bytes()).decode())`], { encoding: 'utf8' });
    const cookie = await signIn(`http://127.0.0.1:${server.port}`);
    const response = await fetch(`http://127.0.0.1:${server.port}/api/intake/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ imageBase64: bytes.stdout.trim() }),
    });
    const body = await response.json() as { status: string; contactId: string | null; message: string };
    if (body.status === 'created' || body.status === 'attached') {
      const contact = await (await fetch(`http://127.0.0.1:${server.port}/api/contacts/${body.contactId}`, { headers: { cookie } })).json() as { facts: Array<{ key: string; status: string; value: string | null }> };
      const confirmed = contact.facts.find((fact) => fact.key === 'showing_confirmed');
      assert.equal(confirmed?.status, 'data_needed');
      const name = contact.facts.find((fact) => fact.key === 'name');
      assert.equal(name?.value, 'Nate Alvarez');
    } else {
      assert.equal(body.status, 'unreadable');
      assert.match(body.message, /unclear|could not be read|Nothing was saved/i);
    }
    const blocked = await (await fetch(`http://127.0.0.1:${server.port}/api/drafts/missing/send`, { method: 'POST', headers: { cookie } })).json() as { sent: boolean };
    assert.equal(blocked.sent, false);
  } finally {
    await server.close();
  }
});
