import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { authorizeAiCall, type PilotSettings } from "../src/worker/ai/access";
import {
  answerConfidence,
  buildQuestions,
  buildState,
  evaluateEstimate,
  JEV_ENDPOINT,
  JEV_MODEL,
  noulConfidence,
  systemOne,
  type EstimateSnapshot,
} from "../src/worker/ai/jev";
import type { RateKv } from "../src/worker/auth/rate-limit";
import { applyProposal, attributeManualItemEdit, insertDecisions, listDecisions } from "../src/worker/db/decisions";
import { STATEMENTS } from "../src/worker/db/schema";
import type { SqlDatabase } from "../src/worker/db/sql";
import { HttpError } from "../src/worker/http";
import { sampleCrews, sampleEstimate, sampleItems } from "../src/shared/sample";

const settingsOn: PilotSettings = {
  gateEnabled: true,
  group: "Meridian AI Pilot",
  groupsClaim: "groups",
  callsPerHour: 30,
  tokensPerDay: 100_000,
  dailyBudgetUsd: 5,
};

function memoryKv(): RateKv {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function us183(): EstimateSnapshot {
  const crews = sampleCrews.map((crew) => ({ id: crew.key, name: crew.name }));
  return {
    name: sampleEstimate.name,
    clientName: sampleEstimate.clientName,
    location: sampleEstimate.location,
    notes: sampleEstimate.notes,
    overheadPercent: sampleEstimate.markups.overheadPercent,
    profitPercent: sampleEstimate.markups.profitPercent,
    bondPercent: sampleEstimate.markups.bondPercent,
    contingencyPercent: sampleEstimate.markups.contingencyPercent,
    crews,
    items: sampleItems.map((item) => ({
      id: `item-${item.code}`,
      code: item.code,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      crewId: item.crewKey,
      crewName: crews.find((crew) => crew.id === item.crewKey)?.name ?? null,
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

describe("Jev confidence and routing", () => {
  it("derives noul confidence as the distance from one half", () => {
    expect(noulConfidence(0.96)).toBeCloseTo(0.92);
    expect(noulConfidence(0.58)).toBeCloseTo(0.16);
    expect(noulConfidence(0.5)).toBe(0);
    expect(noulConfidence(0)).toBe(1);
    expect(answerConfidence({ type: "noul", noul: 0.96 })).toBeCloseTo(0.92);
    expect(answerConfidence({ type: "choice", choice: "bid", probabilities: { bid: 1 }, confidence: 0.81 })).toBe(0.81);
  });

  it("applies high confidence and queues the rest, including a tie at the threshold", async () => {
    const fetchImpl = vi.fn();
    const result = await evaluateEstimate({
      authorize: async () => {},
      fetchImpl,
      mock: true,
      estimate: us183(),
      threshold: 0.8,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.decisions.some((decision) => decision.status === "applied")).toBe(true);
    expect(result.decisions.some((decision) => decision.status === "review")).toBe(true);
    const production = result.decisions.find((decision) => decision.questionId === "production:0400");
    expect(production).toMatchObject({ status: "applied", actor: "jev" });
    expect(production?.proposal).toMatchObject({ type: "production", productionRate: 108 });
    expect(result.decisions.find((decision) => decision.questionId === "production:0200")).toMatchObject({
      status: "review",
    });
    expect(result.decisions.find((decision) => decision.questionId === "contingency")?.proposal).toMatchObject({
      type: "contingency",
      percent: 4.5,
    });
    expect(result.decisions.find((decision) => decision.questionId === "overhead")).toMatchObject({ status: "review" });
    expect(result.decisions.find((decision) => decision.questionId === "outlier:0310")?.status).toBe("applied");
    expect(result.decisions.find((decision) => decision.questionId === "outlier:0410")?.status).toBe("review");
    expect(result.decisions.find((decision) => decision.questionId === "bid_call")?.status).toBe("applied");
    expect(result.decisions.find((decision) => decision.questionId === "vendor:0400")?.status).toBe("review");
    expect(result.decisions.find((decision) => decision.questionId === "profit")).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("JEV_API_KEY");
  });
});

describe("Jev HTTP client", () => {
  it("posts systemone with the bearer key and leaves the key out of the result", async () => {
    const apiKey = "sk-live-jev-test";
    const estimate = us183();
    const questions = buildQuestions(estimate);
    expect(questions.bid_call?.type).toBe("choice");
    expect(questions.contingency?.type).toBe("score");
    expect(questions["outlier:0200"]?.type).toBe("noul");
    const fetchImpl: typeof fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            bid_call: {
              type: "choice",
              choice: "bid",
              probabilities: { bid: 0.9, no_bid: 0.05, bid_with_conditions: 0.05 },
              confidence: 0.91,
            },
          },
          usage: { input_tokens: 20, output_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await evaluateEstimate({
      authorize: async () => {},
      fetchImpl,
      apiKey,
      mock: false,
      estimate,
      threshold: 0.8,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calls = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    const [url, init] = calls[0] ?? [];
    expect(url).toBe(JEV_ENDPOINT);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init?.body)) as { model: string; state: { name: string }; questions: Record<string, { type: string }> };
    expect(body.model).toBe(JEV_MODEL);
    expect(body.state).toEqual(buildState(estimate));
    expect(body.questions.contingency?.type).toBe("score");
    expect(body.questions.bid_call?.type).toBe("choice");
    expect(body.questions["outlier:0310"]?.type).toBe("noul");
    expect(String(init?.body)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 4 });
    expect(result.decisions.find((decision) => decision.questionId === "bid_call")?.status).toBe("applied");
  });

  it("does not call fetch with the input object as this", async () => {
    const input = {
      apiKey: "sk-test-not-a-real-key",
      state: { name: "US-183" },
      questions: {},
      fetchImpl(this: unknown): Promise<Response> {
        expect(this).not.toBe(input);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: JEV_MODEL,
              answers: {},
              usage: { input_tokens: 3, output_tokens: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    };
    const result = await systemOne(input);
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1 });
  });

  it("rejects a non-member before the provider is called", async () => {
    const fetchImpl = vi.fn();
    const now = Date.now();
    const error = await evaluateEstimate({
      authorize: () =>
        authorizeAiCall({
          settings: settingsOn,
          session: {
            id: "sess",
            csrfToken: "csrf",
            user: { id: "user-ada", username: "ada@meridian.test", name: "Ada", email: "ada@meridian.test" },
            accessToken: "access",
            refreshToken: "refresh",
            accessExpiresAt: now + 60_000,
            createdAt: now,
            absoluteExpiresAt: now + 60_000,
            pilotMember: false,
            pilotCheckedAt: now,
          },
          kv: memoryKv(),
          now,
        }).then(() => undefined),
      fetchImpl,
      apiKey: "sk-live-jev-test",
      mock: false,
      estimate: us183(),
      threshold: 0.8,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 403, kind: "pilot_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("applying Jev decisions", () => {
  it("writes an applied rate and keeps a later manual edit person-authored", async () => {
    const sqlite = new DatabaseSync(":memory:");
    for (const statement of STATEMENTS) sqlite.exec(statement);
    const db: SqlDatabase = {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql);
        let bound: unknown[] = [];
        const api = {
          bind(...values: unknown[]) {
            bound = values;
            return api;
          },
          async all<T>() {
            return { results: statement.all(...(bound as never[])) as T[] };
          },
          async first<T>() {
            return (statement.get(...(bound as never[])) as T | undefined) ?? null;
          },
          async run() {
            const info = statement.run(...(bound as never[])) as { changes?: number };
            return { meta: { changes: Number(info.changes ?? 0) } };
          },
        };
        return api;
      },
      async batch(statements) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
    };
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO estimates (
          id, owner_id, name, client_name, location, bid_date, status, notes,
          overhead_percent, profit_percent, bond_percent, contingency_percent, created_at, updated_at
        ) VALUES ('est', 'user-robert', 'US 183', 'County', 'Texas', NULL, 'review', '', 12.5, 8, 1.15, 3, ?, ?)`,
      )
      .bind(now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO bid_items (
          id, estimate_id, code, description, quantity, unit, crew_id, production_rate, sort_order
        ) VALUES ('item-0400', 'est', '0400', 'Flexible base', 1, 'TON', NULL, 120, 1)`,
      )
      .run();
    const proposal = {
      type: "production" as const,
      itemId: "item-0400",
      code: "0400",
      productionRate: 108,
      changed: true,
    };
    expect(await applyProposal(db, "user-robert", "est", proposal)).toBe(true);
    const rate = await db.prepare("SELECT production_rate AS rate FROM bid_items WHERE id = 'item-0400'").first<{ rate: number }>();
    expect(rate?.rate).toBe(108);
    await insertDecisions(db, "user-robert", "est", [
      {
        itemId: "item-0400",
        itemCode: "0400",
        questionId: "production:0400",
        kind: "production",
        title: "Flexible base production",
        summary: "Lower the rate to 108.",
        confidence: 0.92,
        threshold: 0.8,
        status: "applied",
        actor: "jev",
        proposal,
      },
    ]);
    await attributeManualItemEdit(db, "user-robert", "est", "item-0400", 120, null);
    const [decision] = await listDecisions(db, "user-robert", "est");
    expect(decision?.actor).toBe("person");
    expect(await applyProposal(db, "user-ada", "est", proposal)).toBe(false);
  });
});
