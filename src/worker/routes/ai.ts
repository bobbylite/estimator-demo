import { Hono } from "hono";
import { aiGateCovers, pilotSettings, publicPilot } from "../ai/access";
import { readAiBudget, recordAiTokens } from "../ai/budget";
import type { EstimateSnapshot } from "../ai/jev";
import { evaluateEstimate } from "../ai/jev";
import { dailyBudgetView, recordDailySpend } from "../ai/spend";
import type { SessionRecord } from "../auth/types";
import { applyProposal, decide, insertDecisions, listDecisions, type DecisionRecord } from "../db/decisions";
import { getEstimate, type EstimateRecord } from "../db/estimates";
import { ensureSchema } from "../db/schema";
import type { Env } from "../env";
import { HttpError, readJson } from "../http";
import { priceEstimate } from "../../shared/costing";
import { runAiSchema, thresholdSchema } from "../../shared/schemas";
import { enforceAiAccess, enforcePilotMember, requireUser } from "./auth";

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { aiSession?: SessionRecord } }>();

aiRoutes.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  if (aiGateCovers(new URL(c.req.url).pathname)) {
    const session = await requireUser(c);
    c.set("aiSession", await enforcePilotMember(c.env, session));
  }
  await next();
});

/** Readable by every signed-in user. Does not spend the AI budget. */
aiRoutes.get("/status", async (c) => {
  const session = await requireUser(c);
  const settings = pilotSettings(c.env);
  const budget = await readAiBudget(c.env.SESSIONS, session.user.id, settings);
  const daily = await dailyBudgetView(c.env.SESSIONS, settings.dailyBudgetUsd);
  return c.json({
    pilot: publicPilot(settings, session),
    allowed: !settings.gateEnabled || Boolean(session.pilotMember),
    resting: daily.resting,
    dailyBudgetUsd: settings.dailyBudgetUsd,
    callsPerHour: settings.callsPerHour,
    tokensPerDay: settings.tokensPerDay,
    callsRemaining: budget.callsRemaining,
    tokensRemaining: budget.tokensRemaining,
  });
});

aiRoutes.get("/decisions", async (c) => {
  const session = aiSession(c);
  const estimateId = c.req.query("estimateId") ?? "";
  if (!estimateId) throw new HttpError(400, "Missing estimate.");
  const estimate = await getEstimate(c.env.DB, session.user.id, estimateId);
  if (!estimate) throw new HttpError(404, "Estimate not found.");
  const decisions = await listDecisions(c.env.DB, session.user.id, estimateId);
  return c.json({ decisions: decisions.map(publicDecision), threshold: await readThreshold(c.env, session.user.id) });
});

aiRoutes.post("/decisions", async (c) => {
  const session = aiSession(c);
  const body = await readJson(c.req.raw, runAiSchema);
  const estimate = await getEstimate(c.env.DB, session.user.id, body.estimateId);
  if (!estimate) throw new HttpError(404, "Estimate not found.");
  const threshold = await readThreshold(c.env, session.user.id);
  const existing = await listDecisions(c.env.DB, session.user.id, estimate.id);
  const seen = new Set(existing.map((decision) => decision.questionId));
  const result = await evaluateEstimate({
    authorize: async () => {
      await enforceAiAccess(c.env, session);
    },
    fetchImpl: fetch,
    apiKey: c.env.JEV_API_KEY,
    mock: c.env.PINGONE_MOCK === "true",
    estimate: snapshot(estimate),
    threshold,
  });
  const fresh = result.decisions.filter((decision) => !seen.has(decision.questionId));
  for (const decision of fresh) {
    if (decision.status !== "applied") continue;
    const ok = await applyProposal(c.env.DB, session.user.id, estimate.id, decision.proposal);
    if (!ok) decision.status = "review";
  }
  await insertDecisions(c.env.DB, session.user.id, estimate.id, fresh);
  await recordAiTokens(c.env.SESSIONS, {
    userId: session.user.id,
    tokens: result.usage.inputTokens + result.usage.outputTokens,
    tokensPerDay: pilotSettings(c.env).tokensPerDay,
  });
  await recordDailySpend(c.env.SESSIONS, {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
  const saved = await getEstimate(c.env.DB, session.user.id, estimate.id);
  const decisions = await listDecisions(c.env.DB, session.user.id, estimate.id);
  return c.json({
    estimate: saved ? price(saved) : null,
    decisions: decisions.map(publicDecision),
    usage: result.usage,
    threshold,
  });
});

aiRoutes.post("/decisions/:decisionId/accept", async (c) => {
  const session = aiSession(c);
  const decision = await decide(c.env.DB, session.user.id, c.req.param("decisionId"), "accept");
  if (!decision) throw new HttpError(404, "That decision is not on this account.");
  const estimate = await getEstimate(c.env.DB, session.user.id, decision.estimateId);
  return c.json({ decision: publicDecision(decision), estimate: estimate ? price(estimate) : null });
});

aiRoutes.post("/decisions/:decisionId/dismiss", async (c) => {
  const session = aiSession(c);
  const decision = await decide(c.env.DB, session.user.id, c.req.param("decisionId"), "dismiss");
  if (!decision) throw new HttpError(404, "That decision is not on this account.");
  return c.json({ decision: publicDecision(decision) });
});

aiRoutes.put("/threshold", async (c) => {
  const session = aiSession(c);
  const body = await readJson(c.req.raw, thresholdSchema);
  await c.env.SESSIONS.put(thresholdKey(session.user.id), String(body.threshold));
  return c.json({ threshold: body.threshold });
});

function aiSession(c: { get: (key: "aiSession") => SessionRecord | undefined }): SessionRecord {
  const session = c.get("aiSession");
  if (!session) throw new HttpError(401, "Sign in to continue.");
  return session;
}

function publicDecision(decision: DecisionRecord) {
  return {
    id: decision.id,
    estimateId: decision.estimateId,
    itemId: decision.itemId,
    itemCode: decision.itemCode,
    questionId: decision.questionId,
    kind: decision.kind,
    title: decision.title,
    summary: decision.summary,
    confidence: decision.confidence,
    threshold: decision.threshold,
    status: decision.status,
    actor: decision.actor,
    createdAt: decision.createdAt,
  };
}

function snapshot(estimate: EstimateRecord): EstimateSnapshot {
  const crews = new Map(estimate.crews.map((crew) => [crew.id, crew.name]));
  return {
    name: estimate.name,
    clientName: estimate.clientName,
    location: estimate.location,
    notes: estimate.notes,
    overheadPercent: estimate.overheadPercent,
    profitPercent: estimate.profitPercent,
    bondPercent: estimate.bondPercent,
    contingencyPercent: estimate.contingencyPercent,
    crews: estimate.crews.map((crew) => ({ id: crew.id, name: crew.name })),
    items: estimate.items.map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      crewId: item.crewId,
      crewName: item.crewId ? (crews.get(item.crewId) ?? null) : null,
      productionRate: item.productionRate,
      resources: item.resources.map((resource) => ({
        kind: resource.kind,
        description: resource.description,
        unitCost: resource.unitCost,
        pricing: resource.pricing,
      })),
    })),
  };
}

function price(estimate: EstimateRecord) {
  const priced = priceEstimate(estimate.items, estimate.crews, {
    overheadPercent: estimate.overheadPercent,
    profitPercent: estimate.profitPercent,
    bondPercent: estimate.bondPercent,
    contingencyPercent: estimate.contingencyPercent,
  });
  return { ...estimate, items: priced.items, totals: priced.totals };
}

async function readThreshold(env: Env, userId: string): Promise<number> {
  const raw = await env.SESSIONS.get(thresholdKey(userId));
  const value = raw ? Number(raw) : 0.8;
  if (!Number.isFinite(value) || value < 0.5 || value > 0.95) return 0.8;
  return value;
}

function thresholdKey(userId: string): string {
  return `ai:threshold:${userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "unknown"}`;
}
