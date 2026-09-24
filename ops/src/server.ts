import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.ts';
import { decodeImage, readScreenshot } from './ocr.ts';
import type { SqlDb } from './sql.ts';
import {
  acknowledgeJob,
  approveReview,
  attemptSend,
  backupDatabase,
  checkRedfinConnection,
  clearDemo,
  dismissReview,
  exportRecords,
  getContact,
  getReview,
  getSettings,
  getWorkspace,
  intakeLead,
  resolveDuplicate,
  searchContacts,
  seedDemo,
  updateSettings,
} from './workflow.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const defaultDb = join(root, 'data', 'desk.sqlite');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface RunningServer {
  port: number;
  db: SqlDb;
  close(): Promise<void>;
}

export function startServer(options?: { port?: number; host?: string; dbPath?: string }): Promise<RunningServer> {
  const host = options?.host ?? process.env.OPS_HOST ?? '127.0.0.1';
  const port = options?.port ?? Number(process.env.OPS_PORT ?? 8787);
  const dbPath = options?.dbPath ?? process.env.OPS_DB_PATH ?? defaultDb;
  const db = openDatabase(dbPath);
  const server = createServer((req, res) => {
    handle(req, res, db, dbPath).catch((error) => {
      console.error(error);
      sendJson(res, 500, { error: 'The desk hit an unexpected error. Nothing was sent.' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: actual,
        db,
        close: () => new Promise((done, fail) => {
          server.closeAllConnections();
          server.close((error) => {
            db.close();
            if (error) fail(error);
            else done();
          });
        }),
      });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, db: SqlDb, dbPath: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'kleinman-lead-desk', outbound: 'draft' });
    return;
  }
  if (method === 'GET' && path === '/api/workspace') return sendJson(res, 200, getWorkspace(db));
  if (method === 'GET' && path === '/api/settings') return sendJson(res, 200, getSettings(db));
  if (method === 'POST' && path === '/api/settings') {
    const body = await readJson(req);
    return sendJson(res, 200, updateSettings(db, {
      outboundPaused: typeof body.outboundPaused === 'boolean' ? body.outboundPaused : undefined,
      spendLimitUsd: typeof body.spendLimitUsd === 'number' ? body.spendLimitUsd : undefined,
    }));
  }
  if (method === 'GET' && path === '/api/contacts') return sendJson(res, 200, { contacts: searchContacts(db, url.searchParams.get('q') ?? '') });
  if (method === 'GET' && path.startsWith('/api/contacts/')) return sendContact(res, db, path.slice('/api/contacts/'.length));
  if (method === 'POST' && path === '/api/intake') {
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text : '';
    const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null;
    return sendJson(res, 200, intakeLead(db, { text, sourceKind: 'paste', idempotencyKey: key }));
  }
  if (method === 'POST' && path === '/api/intake/screenshot') return sendJson(res, 200, await intakeScreenshot(req, db, root));
  if (method === 'GET' && path.startsWith('/api/reviews/')) return sendReview(res, db, idFrom(path, '/api/reviews/'));
  if (method === 'POST' && path.startsWith('/api/reviews/') && path.endsWith('/approve')) {
    return sendJson(res, 200, approveReview(db, idBetween(path, '/api/reviews/', '/approve')));
  }
  if (method === 'POST' && path.startsWith('/api/reviews/') && path.endsWith('/dismiss')) {
    return sendJson(res, 200, dismissReview(db, idBetween(path, '/api/reviews/', '/dismiss')));
  }
  if (method === 'POST' && path.startsWith('/api/reviews/') && path.endsWith('/resolve')) {
    const body = await readJson(req);
    const decision = body.decision === 'separate' || body.decision === 'attach' || body.decision === 'dismiss' ? body.decision : 'dismiss';
    const contactId = typeof body.contactId === 'string' ? body.contactId : null;
    return sendJson(res, 200, resolveDuplicate(db, idBetween(path, '/api/reviews/', '/resolve'), decision, contactId));
  }
  if (method === 'POST' && path.startsWith('/api/drafts/') && path.endsWith('/send')) {
    return sendJson(res, 200, attemptSend(db, idBetween(path, '/api/drafts/', '/send')));
  }
  if (method === 'POST' && path === '/api/demo/seed') return sendJson(res, 200, seedDemo(db));
  if (method === 'POST' && path === '/api/demo/clear') return sendJson(res, 200, clearDemo(db));
  if (method === 'POST' && path === '/api/integrations/redfin/check') return sendJson(res, 200, checkRedfinConnection(db));
  if (method === 'POST' && path.startsWith('/api/jobs/') && path.endsWith('/acknowledge')) {
    return sendJson(res, 200, acknowledgeJob(db, idBetween(path, '/api/jobs/', '/acknowledge')));
  }
  if (method === 'GET' && path === '/api/export') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="kleinman-desk-export.json"',
    });
    res.end(JSON.stringify(exportRecords(db), null, 2));
    return;
  }
  if (method === 'GET' && path === '/api/backup') return sendBackup(res, dbPath);
  if (method === 'GET') return sendStatic(res, path);
  sendJson(res, 404, { error: 'Not found' });
}

async function intakeScreenshot(req: IncomingMessage, db: SqlDb, appRoot: string): Promise<unknown> {
  const body = await readJson(req);
  const encoded = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const image = decodeImage(encoded);
  if (!image) return { status: 'needs_identity', contactId: null, reviewId: null, draftId: null, message: 'Upload a PNG or JPG screenshot.' };
  const uploads = join(appRoot, 'data', 'uploads');
  mkdirSync(uploads, { recursive: true });
  const imagePath = join(uploads, `${Date.now()}.png`);
  writeFileSync(imagePath, image);
  const ocr = readScreenshot(image);
  if (ocr.engine === 'unavailable') {
    return {
      status: 'unreadable',
      contactId: null,
      reviewId: null,
      draftId: null,
      message: 'Screenshot reading is not available on this computer. Paste the text from the image instead. Nothing was saved as a contact.',
    };
  }
  return intakeLead(db, {
    text: ocr.text,
    sourceKind: 'screenshot',
    ocrConfidence: ocr.confidence,
    unclearSpans: ocr.unclearSpans,
    imagePath,
  });
}

function sendContact(res: ServerResponse, db: SqlDb, id: string): void {
  const contact = getContact(db, decodeURIComponent(id));
  if (!contact) return sendJson(res, 404, { error: 'Client not found' });
  sendJson(res, 200, contact);
}

function sendReview(res: ServerResponse, db: SqlDb, id: string): void {
  const review = getReview(db, id);
  if (!review) return sendJson(res, 404, { error: 'Review item not found' });
  sendJson(res, 200, review);
}

function sendBackup(res: ServerResponse, dbPath: string): void {
  const dest = join(tmpdir(), `kleinman-desk-${Date.now()}.sqlite`);
  backupDatabase(dbPath, dest);
  const file = readFileSync(dest);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename="kleinman-desk-backup.sqlite"',
  });
  res.end(file);
}

function sendStatic(res: ServerResponse, path: string): void {
  const requested = path === '/' ? '/index.html' : path;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { 'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function idFrom(path: string, prefix: string): string {
  return decodeURIComponent(path.slice(prefix.length));
}

function idBetween(path: string, start: string, end: string): string {
  return decodeURIComponent(path.slice(start.length, path.length - end.length));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 12_000_000) {
        reject(new Error('Upload is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  startServer().then((running) => {
    console.log(`Kleinman Desk running at http://127.0.0.1:${running.port}`);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
