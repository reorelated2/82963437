import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase } from './workflow.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dbPath = process.env.OPS_DB_PATH ?? join(root, 'data', 'desk.sqlite');
const command = process.argv[2];
const arg = process.argv[3];

if (command === 'backup') {
  const dir = join(root, 'data', 'backups');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `kleinman-desk-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  backupDatabase(dbPath, dest);
  console.log(`Backup written to ${dest}`);
} else if (command === 'restore') {
  if (!arg || !existsSync(arg)) {
    console.error('Usage: npm run restore -- /full/path/to/backup.sqlite');
    process.exit(1);
  }
  copyFileSync(arg, dbPath);
  console.log(`Restored ${dbPath} from ${arg}`);
} else {
  console.error('Usage: npm run backup   or   npm run restore -- /path/to/backup.sqlite');
  process.exit(1);
}
