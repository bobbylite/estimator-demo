import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { STATEMENTS } from "../src/worker/db/schema";
import {
  createEstimate,
  deleteEstimate,
  ensureSeeded,
  getEstimate,
  listEstimates,
  updateEstimate,
} from "../src/worker/db/estimates";
import type { SeedStore } from "../src/worker/db/estimates";
import type { SqlDatabase } from "../src/worker/db/sql";

function memoryEnv(): SeedStore {
  const sqlite = new DatabaseSync(":memory:");
  for (const statement of STATEMENTS) sqlite.exec(statement);
  const kv = new Map<string, string>();
  const db = {
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
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return {
    DB: db satisfies SqlDatabase,
    SESSIONS: {
      async get(key: string) {
        return kv.get(key) ?? null;
      },
      async put(key: string, value: string) {
        kv.set(key, value);
      },
    },
  };
}

describe("per-user estimates", () => {
  it("seeds and isolates each account", async () => {
    const env = memoryEnv();
    await ensureSeeded(env, "user-ada");
    await ensureSeeded(env, "user-robert");
    await ensureSeeded(env, "user-ada");

    const ada = await listEstimates(env.DB, "user-ada");
    const robert = await listEstimates(env.DB, "user-robert");
    expect(ada).toHaveLength(1);
    expect(robert).toHaveLength(1);
    expect(ada[0]?.id).not.toBe(robert[0]?.id);
    expect(ada[0]?.name).toContain("US 183");
    expect(robert[0]?.name).toContain("US 183");

    const adaId = ada[0]?.id ?? "";
    expect(await getEstimate(env.DB, "user-robert", adaId)).toBeNull();
    expect(await updateEstimate(env.DB, "user-robert", adaId, { name: "Stolen" })).toBeNull();
    expect(await deleteEstimate(env.DB, "user-robert", adaId)).toBe(false);
    expect((await getEstimate(env.DB, "user-ada", adaId))?.name).toContain("US 183");

    const created = await createEstimate(env.DB, "user-ada", {
      name: "Bridge approach",
      clientName: "City of Cedar Park",
      location: "Williamson County",
    });
    expect(created?.name).toBe("Bridge approach");
    const adaNames = (await listEstimates(env.DB, "user-ada")).map((estimate) => estimate.name);
    const robertNames = (await listEstimates(env.DB, "user-robert")).map((estimate) => estimate.name);
    expect(adaNames).toContain("Bridge approach");
    expect(robertNames).not.toContain("Bridge approach");
  });
});
