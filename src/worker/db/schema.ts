import type { SqlDatabase } from "./sql";

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS estimates (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    client_name TEXT NOT NULL,
    location TEXT NOT NULL,
    bid_date TEXT,
    status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    overhead_percent REAL NOT NULL,
    profit_percent REAL NOT NULL,
    bond_percent REAL NOT NULL,
    contingency_percent REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS estimates_owner ON estimates (owner_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS crews (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL,
    name TEXT NOT NULL,
    labor_rate REAL NOT NULL,
    equipment_rate REAL NOT NULL,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS crews_estimate ON crews (estimate_id, sort_order)`,
  `CREATE TABLE IF NOT EXISTS bid_items (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    crew_id TEXT,
    production_rate REAL NOT NULL,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS items_estimate ON bid_items (estimate_id, sort_order)`,
  `CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    bid_item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    unit_cost REAL NOT NULL,
    waste_percent REAL NOT NULL,
    pricing TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS resources_item ON resources (bid_item_id, sort_order)`,
  `CREATE TABLE IF NOT EXISTS ai_decisions (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    item_id TEXT,
    item_code TEXT,
    question_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    confidence REAL NOT NULL,
    threshold REAL NOT NULL,
    status TEXT NOT NULL,
    actor TEXT NOT NULL,
    proposal TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ai_decisions_estimate ON ai_decisions (estimate_id, created_at)`,
];

let schemaReady: Promise<void> | null = null;

export function ensureSchema(db: SqlDatabase): Promise<void> {
  if (!schemaReady) {
    schemaReady = applySchema(db).catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function applySchema(db: SqlDatabase): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.prepare(statement).run();
  }
}
