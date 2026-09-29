import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { text, type SqlDb } from './sql.ts';

const COOKIE = 'kyleos';

export function localPassword(): string {
  return process.env.OPS_PASSWORD ?? 'local-kyle';
}

export function login(db: SqlDb, password: string): { ok: true; token: string } | { ok: false } {
  const expected = Buffer.from(localPassword());
  const given = Buffer.from(password);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false };
  const exp = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const payload = `kyle.${exp}`;
  const sig = createHmac('sha256', sessionSecret(db)).update(payload).digest('hex');
  return { ok: true, token: `${payload}.${sig}` };
}

export function sessionValid(db: SqlDb, cookieHeader: string | undefined): boolean {
  const token = readCookie(cookieHeader);
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts;
  if (who !== 'kyle' || Number(exp) < Date.now()) return false;
  const expected = createHmac('sha256', sessionSecret(db)).update(`${who}.${exp}`).digest('hex');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function cookieHeader(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`;
}

export function clearCookieHeader(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function sessionSecret(db: SqlDb): string {
  const existing = db.get(`SELECT value FROM settings WHERE key = 'session_secret'`);
  if (existing) return text(existing, 'value');
  const value = randomBytes(32).toString('hex');
  db.run(`INSERT INTO settings (key, value) VALUES ('session_secret', ?)`, value);
  return value;
}

function readCookie(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(COOKIE.length + 1));
}
