import { sampleCrews, sampleEstimate, sampleItems } from "../../shared/sample";
import { attributeManualItemEdit, attributeManualMarkupEdit } from "./decisions";
import type { BidItemInput, CrewInput, ResourceInput, UpdateEstimateInput } from "../../shared/schemas";
import type { SqlDatabase } from "./sql";

/** What seeding needs from the worker. Kept off `Env` so tests never import Workers globals. */
export interface SeedStore {
  DB: SqlDatabase;
  SESSIONS: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<unknown>;
  };
}

export interface ResourceRecord {
  id: string;
  kind: "material" | "subcontractor";
  description: string;
  unitCost: number;
  wastePercent: number;
  pricing: "unit" | "lump";
}

export interface ItemRecord {
  id: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  crewId: string | null;
  productionRate: number;
  resources: ResourceRecord[];
}

export interface CrewRecord {
  id: string;
  name: string;
  laborRate: number;
  equipmentRate: number;
}

export interface EstimateRecord {
  id: string;
  name: string;
  clientName: string;
  location: string;
  bidDate: string | null;
  status: "draft" | "review" | "submitted";
  notes: string;
  overheadPercent: number;
  profitPercent: number;
  bondPercent: number;
  contingencyPercent: number;
  createdAt: string;
  updatedAt: string;
  crews: CrewRecord[];
  items: ItemRecord[];
}

interface EstimateRow {
  id: string;
  owner_id: string;
  name: string;
  client_name: string;
  location: string;
  bid_date: string | null;
  status: string;
  notes: string;
  overhead_percent: number;
  profit_percent: number;
  bond_percent: number;
  contingency_percent: number;
  created_at: string;
  updated_at: string;
}

interface CrewRow {
  id: string;
  estimate_id: string;
  name: string;
  labor_rate: number;
  equipment_rate: number;
  sort_order: number;
}

interface ItemRow {
  id: string;
  estimate_id: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  crew_id: string | null;
  production_rate: number;
  sort_order: number;
}

interface ResourceRow {
  id: string;
  bid_item_id: string;
  kind: string;
  description: string;
  unit_cost: number;
  waste_percent: number;
  pricing: string;
  sort_order: number;
}

export async function ensureSeeded(env: SeedStore, ownerId: string): Promise<void> {
  const flagKey = `seeded:${ownerId}`;
  const flagged = await env.SESSIONS.get(flagKey);
  if (flagged) return;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM estimates WHERE owner_id = ?")
    .bind(ownerId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) === 0) await insertSample(env.DB, ownerId);
  await env.SESSIONS.put(flagKey, "1");
}

export async function listEstimates(db: SqlDatabase, ownerId: string): Promise<EstimateRecord[]> {
  const rows = await db
    .prepare("SELECT * FROM estimates WHERE owner_id = ? ORDER BY updated_at DESC")
    .bind(ownerId)
    .all<EstimateRow>();
  return hydrate(db, rows.results);
}

export async function getEstimate(
  db: SqlDatabase,
  ownerId: string,
  id: string,
): Promise<EstimateRecord | null> {
  const row = await db
    .prepare("SELECT * FROM estimates WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<EstimateRow>();
  if (!row) return null;
  const [estimate] = await hydrate(db, [row]);
  return estimate ?? null;
}

export async function createEstimate(
  db: SqlDatabase,
  ownerId: string,
  input: { name: string; clientName: string; location: string; bidDate?: string },
): Promise<EstimateRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const crewId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO estimates (
          id, owner_id, name, client_name, location, bid_date, status, notes,
          overhead_percent, profit_percent, bond_percent, contingency_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', '', 10, 8, 1, 2, ?, ?)`,
      )
      .bind(id, ownerId, input.name, input.clientName, input.location, input.bidDate ?? null, now, now),
    db
      .prepare(
        "INSERT INTO crews (id, estimate_id, name, labor_rate, equipment_rate, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(crewId, id, "General crew", 95, 60, 1),
  ]);
  const created = await getEstimate(db, ownerId, id);
  if (!created) throw new Error("Estimate was not saved.");
  return created;
}

export async function updateEstimate(
  db: SqlDatabase,
  ownerId: string,
  id: string,
  input: UpdateEstimateInput,
): Promise<EstimateRecord | null> {
  const existing = await getEstimate(db, ownerId, id);
  if (!existing) return null;
  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (input.name !== undefined) assign("name", input.name);
  if (input.clientName !== undefined) assign("client_name", input.clientName);
  if (input.location !== undefined) assign("location", input.location);
  if (input.bidDate !== undefined) assign("bid_date", input.bidDate);
  if (input.status !== undefined) assign("status", input.status);
  if (input.notes !== undefined) assign("notes", input.notes);
  if (input.overheadPercent !== undefined) assign("overhead_percent", input.overheadPercent);
  if (input.profitPercent !== undefined) assign("profit_percent", input.profitPercent);
  if (input.bondPercent !== undefined) assign("bond_percent", input.bondPercent);
  if (input.contingencyPercent !== undefined) assign("contingency_percent", input.contingencyPercent);
  assign("updated_at", new Date().toISOString());
  values.push(id, ownerId);
  await db
    .prepare(`UPDATE estimates SET ${sets.join(", ")} WHERE id = ? AND owner_id = ?`)
    .bind(...values)
    .run();
  const saved = await getEstimate(db, ownerId, id);
  if (saved) {
    await attributeManualMarkupEdit(db, ownerId, id, {
      overheadPercent: saved.overheadPercent,
      profitPercent: saved.profitPercent,
      contingencyPercent: saved.contingencyPercent,
    });
  }
  return saved;
}

export async function deleteEstimate(db: SqlDatabase, ownerId: string, id: string): Promise<boolean> {
  const existing = await getEstimate(db, ownerId, id);
  if (!existing) return false;
  const itemIds = existing.items.map((item) => item.id);
  const statements = [];
  if (itemIds.length) {
    const marks = itemIds.map(() => "?").join(", ");
    statements.push(db.prepare(`DELETE FROM resources WHERE bid_item_id IN (${marks})`).bind(...itemIds));
  }
  statements.push(db.prepare("DELETE FROM bid_items WHERE estimate_id = ?").bind(id));
  statements.push(db.prepare("DELETE FROM crews WHERE estimate_id = ?").bind(id));
  statements.push(db.prepare("DELETE FROM ai_decisions WHERE estimate_id = ? AND owner_id = ?").bind(id, ownerId));
  statements.push(db.prepare("DELETE FROM estimates WHERE id = ? AND owner_id = ?").bind(id, ownerId));
  await db.batch(statements);
  return true;
}

export async function createCrew(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  input: CrewInput,
): Promise<EstimateRecord | null> {
  if (!(await owns(db, ownerId, estimateId))) return null;
  const sort = await nextSort(db, "crews", "estimate_id", estimateId);
  await db
    .prepare(
      "INSERT INTO crews (id, estimate_id, name, labor_rate, equipment_rate, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), estimateId, input.name, input.laborRate, input.equipmentRate, sort)
    .run();
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function updateCrew(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  crewId: string,
  input: CrewInput,
): Promise<EstimateRecord | null> {
  const result = await db
    .prepare(
      `UPDATE crews SET name = ?, labor_rate = ?, equipment_rate = ?
       WHERE id = ? AND estimate_id IN (SELECT id FROM estimates WHERE id = ? AND owner_id = ?)`,
    )
    .bind(input.name, input.laborRate, input.equipmentRate, crewId, estimateId, ownerId)
    .run();
  if (!result.meta.changes) return null;
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function deleteCrew(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  crewId: string,
): Promise<EstimateRecord | null> {
  if (!(await owns(db, ownerId, estimateId))) return null;
  await db.batch([
    db.prepare("UPDATE bid_items SET crew_id = NULL WHERE estimate_id = ? AND crew_id = ?").bind(estimateId, crewId),
    db.prepare("DELETE FROM crews WHERE id = ? AND estimate_id = ?").bind(crewId, estimateId),
  ]);
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function createItem(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  input: BidItemInput,
): Promise<EstimateRecord | null> {
  if (!(await owns(db, ownerId, estimateId))) return null;
  if (input.crewId && !(await crewOnEstimate(db, estimateId, input.crewId))) return null;
  const sort = await nextSort(db, "bid_items", "estimate_id", estimateId);
  await db
    .prepare(
      `INSERT INTO bid_items (
        id, estimate_id, code, description, quantity, unit, crew_id, production_rate, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      estimateId,
      input.code,
      input.description,
      input.quantity,
      input.unit,
      input.crewId,
      input.productionRate,
      sort,
    )
    .run();
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function updateItem(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  itemId: string,
  input: BidItemInput,
): Promise<EstimateRecord | null> {
  if (input.crewId && !(await crewOnEstimate(db, estimateId, input.crewId))) return null;
  const result = await db
    .prepare(
      `UPDATE bid_items SET code = ?, description = ?, quantity = ?, unit = ?, crew_id = ?, production_rate = ?
       WHERE id = ? AND estimate_id IN (SELECT id FROM estimates WHERE id = ? AND owner_id = ?)`,
    )
    .bind(
      input.code,
      input.description,
      input.quantity,
      input.unit,
      input.crewId,
      input.productionRate,
      itemId,
      estimateId,
      ownerId,
    )
    .run();
  if (!result.meta.changes) return null;
  await attributeManualItemEdit(db, ownerId, estimateId, itemId, input.productionRate, input.crewId);
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function deleteItem(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  itemId: string,
): Promise<EstimateRecord | null> {
  if (!(await owns(db, ownerId, estimateId))) return null;
  const item = await db
    .prepare("SELECT id FROM bid_items WHERE id = ? AND estimate_id = ?")
    .bind(itemId, estimateId)
    .first<{ id: string }>();
  if (!item) return null;
  await db.batch([
    db.prepare("DELETE FROM resources WHERE bid_item_id = ?").bind(itemId),
    db.prepare("DELETE FROM bid_items WHERE id = ? AND estimate_id = ?").bind(itemId, estimateId),
  ]);
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function createResource(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  itemId: string,
  input: ResourceInput,
): Promise<EstimateRecord | null> {
  if (!(await itemOnOwnedEstimate(db, ownerId, estimateId, itemId))) return null;
  const sort = await nextSort(db, "resources", "bid_item_id", itemId);
  await db
    .prepare(
      `INSERT INTO resources (
        id, bid_item_id, kind, description, unit_cost, waste_percent, pricing, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      itemId,
      input.kind,
      input.description,
      input.unitCost,
      input.kind === "material" ? input.wastePercent : 0,
      input.pricing,
      sort,
    )
    .run();
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function updateResource(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  itemId: string,
  resourceId: string,
  input: ResourceInput,
): Promise<EstimateRecord | null> {
  if (!(await itemOnOwnedEstimate(db, ownerId, estimateId, itemId))) return null;
  const result = await db
    .prepare(
      `UPDATE resources SET kind = ?, description = ?, unit_cost = ?, waste_percent = ?, pricing = ?
       WHERE id = ? AND bid_item_id = ?`,
    )
    .bind(
      input.kind,
      input.description,
      input.unitCost,
      input.kind === "material" ? input.wastePercent : 0,
      input.pricing,
      resourceId,
      itemId,
    )
    .run();
  if (!result.meta.changes) return null;
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

export async function deleteResource(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  itemId: string,
  resourceId: string,
): Promise<EstimateRecord | null> {
  if (!(await itemOnOwnedEstimate(db, ownerId, estimateId, itemId))) return null;
  const result = await db
    .prepare("DELETE FROM resources WHERE id = ? AND bid_item_id = ?")
    .bind(resourceId, itemId)
    .run();
  if (!result.meta.changes) return null;
  await touch(db, ownerId, estimateId);
  return getEstimate(db, ownerId, estimateId);
}

async function insertSample(db: SqlDatabase, ownerId: string) {
  const now = new Date().toISOString();
  const estimateId = crypto.randomUUID();
  const crewIds = new Map(sampleCrews.map((crew) => [crew.key, crypto.randomUUID()]));
  const statements = [
    db
      .prepare(
        `INSERT INTO estimates (
          id, owner_id, name, client_name, location, bid_date, status, notes,
          overhead_percent, profit_percent, bond_percent, contingency_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        estimateId,
        ownerId,
        sampleEstimate.name,
        sampleEstimate.clientName,
        sampleEstimate.location,
        sampleEstimate.bidDate,
        sampleEstimate.status,
        sampleEstimate.notes,
        sampleEstimate.markups.overheadPercent,
        sampleEstimate.markups.profitPercent,
        sampleEstimate.markups.bondPercent,
        sampleEstimate.markups.contingencyPercent,
        now,
        now,
      ),
    ...sampleCrews.map((crew, index) =>
      db
        .prepare(
          "INSERT INTO crews (id, estimate_id, name, labor_rate, equipment_rate, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(crewIds.get(crew.key), estimateId, crew.name, crew.laborRate, crew.equipmentRate, index + 1),
    ),
  ];
  for (const [itemIndex, item] of sampleItems.entries()) {
    const itemId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO bid_items (
            id, estimate_id, code, description, quantity, unit, crew_id, production_rate, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          itemId,
          estimateId,
          item.code,
          item.description,
          item.quantity,
          item.unit,
          item.crewKey ? crewIds.get(item.crewKey) : null,
          item.productionRate,
          itemIndex + 1,
        ),
    );
    item.resources.forEach((resource, resourceIndex) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO resources (
              id, bid_item_id, kind, description, unit_cost, waste_percent, pricing, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            itemId,
            resource.kind,
            resource.description,
            resource.unitCost,
            resource.wastePercent,
            resource.pricing,
            resourceIndex + 1,
          ),
      );
    });
  }
  await db.batch(statements);
}

async function hydrate(db: SqlDatabase, estimates: EstimateRow[]): Promise<EstimateRecord[]> {
  if (!estimates.length) return [];
  const ids = estimates.map((estimate) => estimate.id);
  const marks = ids.map(() => "?").join(", ");
  const [crews, items] = await Promise.all([
    db.prepare(`SELECT * FROM crews WHERE estimate_id IN (${marks}) ORDER BY sort_order`).bind(...ids).all<CrewRow>(),
    db
      .prepare(`SELECT * FROM bid_items WHERE estimate_id IN (${marks}) ORDER BY sort_order`)
      .bind(...ids)
      .all<ItemRow>(),
  ]);
  const itemIds = items.results.map((item) => item.id);
  const resources = itemIds.length
    ? await db
        .prepare(
          `SELECT * FROM resources WHERE bid_item_id IN (${itemIds.map(() => "?").join(", ")}) ORDER BY sort_order`,
        )
        .bind(...itemIds)
        .all<ResourceRow>()
    : { results: [] as ResourceRow[] };
  const resourcesByItem = group(resources.results, (row) => row.bid_item_id);
  const crewsByEstimate = group(crews.results, (row) => row.estimate_id);
  const itemsByEstimate = group(items.results, (row) => row.estimate_id);
  return estimates.map((estimate) => ({
    id: estimate.id,
    name: estimate.name,
    clientName: estimate.client_name,
    location: estimate.location,
    bidDate: estimate.bid_date,
    status: estimate.status as EstimateRecord["status"],
    notes: estimate.notes,
    overheadPercent: estimate.overhead_percent,
    profitPercent: estimate.profit_percent,
    bondPercent: estimate.bond_percent,
    contingencyPercent: estimate.contingency_percent,
    createdAt: estimate.created_at,
    updatedAt: estimate.updated_at,
    crews: (crewsByEstimate.get(estimate.id) ?? []).map((crew) => ({
      id: crew.id,
      name: crew.name,
      laborRate: crew.labor_rate,
      equipmentRate: crew.equipment_rate,
    })),
    items: (itemsByEstimate.get(estimate.id) ?? []).map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      crewId: item.crew_id,
      productionRate: item.production_rate,
      resources: (resourcesByItem.get(item.id) ?? []).map((resource) => ({
        id: resource.id,
        kind: resource.kind as ResourceRecord["kind"],
        description: resource.description,
        unitCost: resource.unit_cost,
        wastePercent: resource.waste_percent,
        pricing: resource.pricing as ResourceRecord["pricing"],
      })),
    })),
  }));
}

function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  return map;
}

async function owns(db: SqlDatabase, ownerId: string, estimateId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM estimates WHERE id = ? AND owner_id = ?")
    .bind(estimateId, ownerId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function crewOnEstimate(db: SqlDatabase, estimateId: string, crewId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM crews WHERE id = ? AND estimate_id = ?")
    .bind(crewId, estimateId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function itemOnOwnedEstimate(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  itemId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT bid_items.id FROM bid_items
       JOIN estimates ON estimates.id = bid_items.estimate_id
       WHERE bid_items.id = ? AND bid_items.estimate_id = ? AND estimates.owner_id = ?`,
    )
    .bind(itemId, estimateId, ownerId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function nextSort(db: SqlDatabase, table: "crews" | "bid_items" | "resources", column: string, id: string) {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM ${table} WHERE ${column} = ?`)
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 1;
}

async function touch(db: SqlDatabase, ownerId: string, estimateId: string) {
  await db
    .prepare("UPDATE estimates SET updated_at = ? WHERE id = ? AND owner_id = ?")
    .bind(new Date().toISOString(), estimateId, ownerId)
    .run();
}
