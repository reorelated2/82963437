import { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | null;

export interface SqlDb {
  exec(sql: string): void;
  get(sql: string, ...params: SqlValue[]): Record<string, unknown> | undefined;
  all(sql: string, ...params: SqlValue[]): Array<Record<string, unknown>>;
  run(sql: string, ...params: SqlValue[]): void;
  close(): void;
}

export function openSql(path: string): SqlDb {
  const db = new DatabaseSync(path);
  return {
    exec(sql: string) {
      db.exec(sql);
    },
    get(sql: string, ...params: SqlValue[]) {
      const row = db.prepare(sql).get(...params);
      if (!row) return undefined;
      return row as Record<string, unknown>;
    },
    all(sql: string, ...params: SqlValue[]) {
      return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    },
    run(sql: string, ...params: SqlValue[]) {
      db.prepare(sql).run(...params);
    },
    close() {
      db.close();
    },
  };
}

export function transaction<T>(db: SqlDb, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The original error is the one that matters.
    }
    throw error;
  }
}

export function text(row: Record<string, unknown> | undefined, key: string): string {
  if (!row || row[key] === null || row[key] === undefined) return '';
  return String(row[key]);
}

export function num(row: Record<string, unknown> | undefined, key: string): number {
  if (!row || row[key] === null || row[key] === undefined) return 0;
  return Number(row[key]);
}

export function asBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}
