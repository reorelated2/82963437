import { text, type SqlDb } from '../sql.ts';

export interface FridayReport {
  title: 'FRIDAY MANAGEMENT REPORT';
  live: false;
  lines: string[];
  incompleteDenominators: string[];
}

export function fridayReport(db: SqlDb, now: Date): FridayReport {
  const buyers = Number(db.get(`SELECT COUNT(*) AS n FROM opportunities WHERE business_line = 'redfin_buyer' AND status = 'open'`)?.n ?? 0);
  const sellers = Number(db.get(`SELECT COUNT(*) AS n FROM opportunities WHERE business_line = 'redfin_seller' AND status = 'open'`)?.n ?? 0);
  const pending = Number(db.get(`SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'PENDING'`)?.n ?? 0);
  const executed = Number(db.get(`SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'EXECUTED'`)?.n ?? 0);
  const sent = Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n ?? 0);
  const offers = db.all(
    `SELECT value FROM client_facts WHERE verification = 'verified' AND (field_key = 'offer_state' OR value LIKE '%offer request%')`,
  ).map((row) => text(row, 'value'));
  const accepted = offers.filter((value) => /accepted/i.test(value)).length;
  const submitted = offers.filter((value) => /^submitted$/i.test(value)).length;
  const requests = offers.filter((value) => /offer request/i.test(value)).length;
  const closed = Number(db.get(
    `SELECT COUNT(*) AS n FROM client_facts WHERE field_key = 'transaction_status' AND lower(value) = 'closed' AND verification = 'verified'`,
  )?.n ?? 0);
  const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'full' }).format(now);
  const incompleteDenominators = [
    'Closed volume has no verified prices, so volume is not a number.',
    'Response rate needs sent messages and replies. sent_messages is the send log and stays empty in DRY_RUN.',
    'Tours confirmed and tours completed need provider or Kyle confirmation. A schedule line is not a completion.',
    'Time to first human contact needs a verified send timestamp. Drafts are not contact.',
  ];
  return {
    title: 'FRIDAY MANAGEMENT REPORT',
    live: false,
    incompleteDenominators,
    lines: [
      `FRIDAY MANAGEMENT REPORT ${when}`,
      `Open buyer opportunities: ${buyers}`,
      `Open seller opportunities: ${sellers}`,
      `Offer requests on file: ${requests}`,
      `Offers submitted with a verified submitted state: ${submitted}`,
      `Offers accepted: ${accepted}`,
      `Closings on file: ${closed}`,
      'Closed volume: DATA NEEDED. Denominator incomplete.',
      `Pending drafts: ${pending}. Executed approvals: ${executed}. Sent messages: ${sent}.`,
      'Active high-value opportunities are the open buyer files. No conversion probability was invented.',
      'Major blocker: Agent Tools, MLS, Gmail send, SMS, and calendar are HUMAN ACTION MODE.',
      'Next week: work the Morning Brief in order. Nothing in this report was sent.',
    ],
  };
}
