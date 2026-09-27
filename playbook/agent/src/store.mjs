import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CATALOG } from "./catalog.mjs";

export function openStore(file = ":memory:") {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id TEXT NOT NULL,
      units INTEGER NOT NULL,
      revenue REAL NOT NULL,
      fees REAL NOT NULL DEFAULT 0,
      postage REAL NOT NULL DEFAULT 0,
      refunded INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const store = {
    db,
    list() {
      return db.prepare("SELECT data FROM opportunities ORDER BY updated_at DESC").all().map((row) => JSON.parse(row.data));
    },
    get(id) {
      const row = db.prepare("SELECT data FROM opportunities WHERE id = ?").get(id);
      return row ? JSON.parse(row.data) : null;
    },
    save(opportunity) {
      const now = new Date().toISOString();
      opportunity.updated_at = now;
      db.prepare(
        `INSERT INTO opportunities (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      ).run(opportunity.id, JSON.stringify(opportunity), now);
      return opportunity;
    },
    log(opportunityId, kind, payload) {
      db.prepare("INSERT INTO events (opportunity_id, kind, payload, created_at) VALUES (?, ?, ?, ?)").run(
        opportunityId,
        kind,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
    },
    events(opportunityId) {
      const sql = opportunityId
        ? "SELECT * FROM events WHERE opportunity_id = ? ORDER BY id DESC LIMIT 40"
        : "SELECT * FROM events ORDER BY id DESC LIMIT 40";
      const rows = opportunityId ? db.prepare(sql).all(opportunityId) : db.prepare(sql).all();
      return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) })).reverse();
    },
    addSale(sale) {
      db.prepare(
        "INSERT INTO sales (opportunity_id, units, revenue, fees, postage, refunded, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(sale.opportunity_id, sale.units, sale.revenue, sale.fees || 0, sale.postage || 0, sale.refunded ? 1 : 0, sale.reason || "", new Date().toISOString());
    },
    sales(opportunityId) {
      const sql = opportunityId ? "SELECT * FROM sales WHERE opportunity_id = ? ORDER BY id" : "SELECT * FROM sales ORDER BY id";
      return opportunityId ? db.prepare(sql).all(opportunityId) : db.prepare(sql).all();
    },
    setting(key, fallback = null) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      return row ? JSON.parse(row.value) : fallback;
    },
    setSetting(key, value) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(key, JSON.stringify(value));
    },
  };
  if (store.list().length === 0) seed(store);
  return store;
}

function seed(store) {
  for (const item of CATALOG) {
    store.save({
      ...item,
      brand: "YOUR BRAND",
      version: "v01",
      banSentence: banSentence(item),
      measurements: null,
      fit: null,
      economics: null,
      evidence: { amazon: [], ebaySold: [], threads: 0, patentNote: "", thinEvidence: false },
      artifacts: {},
      ownSales: false,
      donorInHand: false,
      hasMeasurableStandard: item.id === "hinge-jig",
      notes: "",
    });
  }
  store.setSetting("setup", {
    calipersOrdered: false,
    donorOrdered: false,
    printerOwned: false,
    llcFiled: false,
    insuranceBound: false,
    sellerAccountOpen: false,
  });
}

function banSentence(item) {
  if (item.id === "hinge-jig") return "Not a structural repair. This jig marks holes. It must not be the part that holds the door.";
  if (item.id === "cycle-knob" || item.id === "snowblower-knob") return "Not an OEM part. Not for a gas valve or any control that operates a flame or a safety interlock.";
  return "Not an OEM part.";
}
