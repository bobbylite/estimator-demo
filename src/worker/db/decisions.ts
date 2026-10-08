import type { Proposal } from "../ai/jev";
import type { SqlDatabase } from "./sql";

export interface DecisionRecord {
  id: string;
  estimateId: string;
  itemId: string | null;
  itemCode: string | null;
  questionId: string;
  kind: string;
  title: string;
  summary: string;
  confidence: number;
  threshold: number;
  status: "applied" | "review" | "accepted" | "dismissed";
  actor: "jev" | "person";
  proposal: Proposal;
  createdAt: string;
}

interface DecisionRow {
  id: string;
  estimate_id: string;
  item_id: string | null;
  item_code: string | null;
  question_id: string;
  kind: string;
  title: string;
  summary: string;
  confidence: number;
  threshold: number;
  status: string;
  actor: string;
  proposal: string;
  created_at: string;
}

export async function listDecisions(db: SqlDatabase, ownerId: string, estimateId: string): Promise<DecisionRecord[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM ai_decisions WHERE estimate_id = ? AND owner_id = ? ORDER BY created_at ASC`,
    )
    .bind(estimateId, ownerId)
    .all<DecisionRow>();
  return rows.results.map(toRecord);
}

export async function insertDecisions(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  decisions: Array<Omit<DecisionRecord, "id" | "estimateId" | "createdAt">>,
): Promise<void> {
  if (!decisions.length) return;
  const now = new Date().toISOString();
  await db.batch(
    decisions.map((decision) =>
      db
        .prepare(
          `INSERT INTO ai_decisions (
            id, estimate_id, owner_id, item_id, item_code, question_id, kind, title, summary,
            confidence, threshold, status, actor, proposal, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          estimateId,
          ownerId,
          decision.itemId,
          decision.itemCode,
          decision.questionId,
          decision.kind,
          decision.title,
          decision.summary,
          decision.confidence,
          decision.threshold,
          decision.status,
          decision.actor,
          JSON.stringify(decision.proposal),
          now,
        ),
    ),
  );
}

export async function decide(
  db: SqlDatabase,
  ownerId: string,
  decisionId: string,
  action: "accept" | "dismiss",
): Promise<DecisionRecord | null> {
  const row = await db
    .prepare("SELECT * FROM ai_decisions WHERE id = ? AND owner_id = ?")
    .bind(decisionId, ownerId)
    .first<DecisionRow>();
  if (!row) return null;
  const record = toRecord(row);
  if (record.status !== "review") return record;
  if (action === "accept") {
    const applied = await applyProposal(db, ownerId, record.estimateId, record.proposal);
    if (!applied) return null;
  }
  const status = action === "accept" ? "accepted" : "dismissed";
  await db
    .prepare("UPDATE ai_decisions SET status = ?, actor = 'person' WHERE id = ? AND owner_id = ?")
    .bind(status, decisionId, ownerId)
    .run();
  return { ...record, status, actor: "person" };
}

/** A manual edit keeps authorship with the person when it moves a value Jev had set. */
export async function attributeManualItemEdit(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  itemId: string,
  productionRate: number,
  crewId: string | null,
): Promise<void> {
  const decisions = await listDecisions(db, ownerId, estimateId);
  for (const decision of decisions) {
    if (decision.itemId !== itemId || decision.actor !== "jev") continue;
    const proposal = decision.proposal;
    const moved =
      (proposal.type === "production" && proposal.productionRate !== productionRate) ||
      (proposal.type === "crew" && proposal.crewId !== crewId);
    if (moved) await markPerson(db, ownerId, decision.id);
  }
}

export async function attributeManualMarkupEdit(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  markups: { overheadPercent: number; profitPercent: number; contingencyPercent: number },
): Promise<void> {
  const decisions = await listDecisions(db, ownerId, estimateId);
  for (const decision of decisions) {
    if (decision.actor !== "jev") continue;
    const proposal = decision.proposal;
    const moved =
      (proposal.type === "contingency" && proposal.percent !== markups.contingencyPercent) ||
      (proposal.type === "markup" &&
        proposal.field === "overheadPercent" &&
        proposal.percent !== markups.overheadPercent) ||
      (proposal.type === "markup" && proposal.field === "profitPercent" && proposal.percent !== markups.profitPercent);
    if (moved) await markPerson(db, ownerId, decision.id);
  }
}

async function markPerson(db: SqlDatabase, ownerId: string, decisionId: string) {
  await db
    .prepare("UPDATE ai_decisions SET actor = 'person' WHERE id = ? AND owner_id = ?")
    .bind(decisionId, ownerId)
    .run();
}

export async function applyProposal(
  db: SqlDatabase,
  ownerId: string,
  estimateId: string,
  proposal: Proposal,
): Promise<boolean> {
  if (!(await owns(db, ownerId, estimateId))) return false;
  if (proposal.type === "production") {
    const result = await db
      .prepare(
        `UPDATE bid_items SET production_rate = ?
         WHERE id = ? AND estimate_id = ?`,
      )
      .bind(proposal.productionRate, proposal.itemId, estimateId)
      .run();
    return result.meta.changes > 0;
  }
  if (proposal.type === "crew") {
    const result = await db
      .prepare("UPDATE bid_items SET crew_id = ? WHERE id = ? AND estimate_id = ?")
      .bind(proposal.crewId, proposal.itemId, estimateId)
      .run();
    return result.meta.changes > 0;
  }
  if (proposal.type === "contingency") {
    const result = await db
      .prepare("UPDATE estimates SET contingency_percent = ? WHERE id = ? AND owner_id = ?")
      .bind(proposal.percent, estimateId, ownerId)
      .run();
    return result.meta.changes > 0;
  }
  if (proposal.type === "markup") {
    const column = proposal.field === "overheadPercent" ? "overhead_percent" : "profit_percent";
    const result = await db
      .prepare(`UPDATE estimates SET ${column} = ? WHERE id = ? AND owner_id = ?`)
      .bind(proposal.percent, estimateId, ownerId)
      .run();
    return result.meta.changes > 0;
  }
  return true;
}

async function owns(db: SqlDatabase, ownerId: string, estimateId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM estimates WHERE id = ? AND owner_id = ?")
    .bind(estimateId, ownerId)
    .first<{ id: string }>();
  return Boolean(row);
}

function toRecord(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    estimateId: row.estimate_id,
    itemId: row.item_id,
    itemCode: row.item_code,
    questionId: row.question_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    confidence: row.confidence,
    threshold: row.threshold,
    status: row.status as DecisionRecord["status"],
    actor: row.actor === "person" ? "person" : "jev",
    proposal: JSON.parse(row.proposal) as Proposal,
    createdAt: row.created_at,
  };
}
