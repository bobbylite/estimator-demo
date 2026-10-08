import { describe, expect, it } from "vitest";
import { authorizeAiCall, type PilotSettings } from "../src/worker/ai/access";
import {
  assertDailyBudget,
  estimatedUsd,
  recordDailySpend,
  RESTING_MESSAGE,
} from "../src/worker/ai/spend";
import type { RateKv } from "../src/worker/auth/rate-limit";
import type { SessionRecord } from "../src/worker/auth/types";
import { HttpError } from "../src/worker/http";

const day = Date.parse("2026-10-08T15:00:00.000Z");
const nextDay = Date.parse("2026-10-09T00:05:00.000Z");

const open: PilotSettings = {
  gateEnabled: false,
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

function session(id: string): SessionRecord {
  return {
    id: `sess-${id}`,
    csrfToken: "csrf",
    user: { id, username: `${id}@meridian.test`, name: id, email: `${id}@meridian.test` },
    accessToken: "access",
    refreshToken: "refresh",
    accessExpiresAt: day + 3_600_000,
    createdAt: day,
    absoluteExpiresAt: day + 86_400_000,
    pilotMember: false,
    pilotCheckedAt: day,
  };
}

describe("global daily Jev budget", () => {
  it("prices tokens with the documented assumption", () => {
    expect(estimatedUsd(1_000_000, 0)).toBe(15);
    expect(estimatedUsd(0, 1_000_000)).toBe(60);
    expect(estimatedUsd(1_000, 1_000)).toBeCloseTo(0.075);
  });

  it("allows a call under the cap and refuses once the shared ledger reaches it", async () => {
    const kv = memoryKv();
    await recordDailySpend(kv, { inputTokens: 100_000, outputTokens: 0, now: day });
    await expect(assertDailyBudget(kv, 5, day)).resolves.toBeUndefined();
    const allowed = await authorizeAiCall({
      settings: open,
      session: session("user-ada"),
      kv,
      now: day,
    });
    expect(allowed.user.id).toBe("user-ada");

    await recordDailySpend(kv, { inputTokens: 1_000_000, outputTokens: 0, now: day });
    const denied = await authorizeAiCall({
      settings: { ...open, gateEnabled: true },
      session: { ...session("user-robert"), pilotMember: true },
      kv,
      now: day,
    }).catch((reason: unknown) => reason);
    expect(denied).toBeInstanceOf(HttpError);
    expect(denied).toMatchObject({ status: 429, kind: "ai_daily_budget", message: RESTING_MESSAGE });
  });

  it("counts one ledger for every user and starts over on the next UTC day", async () => {
    const kv = memoryKv();
    await recordDailySpend(kv, { inputTokens: 400_000, outputTokens: 0, now: day });
    await recordDailySpend(kv, { inputTokens: 0, outputTokens: 100_000, now: day });
    await expect(assertDailyBudget(kv, 5, day)).rejects.toMatchObject({ kind: "ai_daily_budget" });
    await expect(assertDailyBudget(kv, 5, nextDay)).resolves.toBeUndefined();
    const again = await authorizeAiCall({
      settings: open,
      session: session("user-other"),
      kv,
      now: nextDay,
    });
    expect(again.user.id).toBe("user-other");
  });

  it("fails closed when the ledger cannot be read", async () => {
    const kv: RateKv = {
      async get() {
        throw new Error("kv down");
      },
      async put() {
        throw new Error("kv down");
      },
    };
    await expect(assertDailyBudget(kv, 5, day)).rejects.toMatchObject({
      status: 503,
      kind: "ai_budget_unavailable",
      message: RESTING_MESSAGE,
    });
    const corrupt: RateKv = {
      async get() {
        return "not-json";
      },
      async put() {
        return undefined;
      },
    };
    await expect(authorizeAiCall({ settings: open, session: session("user-ada"), kv: corrupt, now: day })).rejects.toMatchObject({
      kind: "ai_budget_unavailable",
    });
  });
});
