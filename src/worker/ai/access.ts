import { issueMockSessionTokens } from "../auth/mock";
import type { RateKv } from "../auth/rate-limit";
import type { SessionRecord } from "../auth/types";
import { HttpError } from "../http";
import { consumeAiBudget } from "./budget";
import { assertDailyBudget, DEFAULT_DAILY_BUDGET_USD } from "./spend";
import {
  DEFAULT_GROUPS_CLAIM,
  DEFAULT_PILOT_GROUP,
  memberFromIdToken,
} from "./claims";

export const DEFAULT_CALLS_PER_HOUR = 30;
export const DEFAULT_TOKENS_PER_DAY = 100_000;
export { DEFAULT_DAILY_BUDGET_USD };
/** Re-read the ID token before an AI call when the stored check is older than this. */
export const PILOT_MAX_AGE_MS = 5 * 60 * 1000;

export const PILOT_REQUIRED = "AI is in a private pilot. An admin adds people to the pilot group in PingOne.";
export const PILOT_UNCONFIRMED = "AI pilot membership could not be confirmed. Try again in a moment.";

export interface PilotConfigSource {
  AI_PILOT_GATE_ENABLED?: string;
  AI_PILOT_GROUP?: string;
  AI_PILOT_GROUPS_CLAIM?: string;
  AI_USER_CALLS_PER_HOUR?: string;
  AI_USER_TOKENS_PER_DAY?: string;
  AI_DAILY_BUDGET_USD?: string;
}

export interface PilotSettings {
  gateEnabled: boolean;
  group: string;
  groupsClaim: string;
  callsPerHour: number;
  tokensPerDay: number;
  dailyBudgetUsd: number;
}

export interface PilotView {
  gateEnabled: boolean;
  member: boolean;
  group: string;
}

export interface RefreshedPilot {
  session: SessionRecord;
  receivedIdToken: boolean;
}

export function pilotSettings(env: PilotConfigSource): PilotSettings {
  return {
    gateEnabled: env.AI_PILOT_GATE_ENABLED === "true",
    group: env.AI_PILOT_GROUP?.trim() || DEFAULT_PILOT_GROUP,
    groupsClaim: env.AI_PILOT_GROUPS_CLAIM?.trim() || DEFAULT_GROUPS_CLAIM,
    callsPerHour: positiveInt(env.AI_USER_CALLS_PER_HOUR, DEFAULT_CALLS_PER_HOUR),
    tokensPerDay: positiveInt(env.AI_USER_TOKENS_PER_DAY, DEFAULT_TOKENS_PER_DAY),
    dailyBudgetUsd: positiveNumber(env.AI_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD),
  };
}

export function publicPilot(settings: PilotSettings, session: { pilotMember?: boolean } | null): PilotView {
  return {
    gateEnabled: settings.gateEnabled,
    member: Boolean(session?.pilotMember),
    group: settings.group,
  };
}

/** Model calls live under this prefix. Estimate routes are not in the list. */
export function aiGateCovers(pathname: string): boolean {
  return pathname === "/api/ai/decisions" || pathname.startsWith("/api/ai/decisions/");
}

export function stampPilot(session: SessionRecord, settings: PilotSettings, now = Date.now()): SessionRecord {
  return {
    ...session,
    pilotMember: memberFromIdToken(session.idToken, settings.groupsClaim, settings.group),
    pilotCheckedAt: now,
  };
}

/**
 * Gate and per-user budget for one AI call.
 * When the gate is on, a check older than about five minutes refreshes the token first.
 * A failed refresh denies the call and leaves the estimate session in place.
 */
export async function authorizeAiCall(input: {
  settings: PilotSettings;
  session: SessionRecord;
  kv: RateKv;
  now?: number;
  tokens?: number;
  refresh?: () => Promise<RefreshedPilot>;
  save?: (session: SessionRecord) => Promise<void>;
}): Promise<SessionRecord> {
  const now = input.now ?? Date.now();
  let current = input.session;
  if (input.settings.gateEnabled) {
    const checkedAt = current.pilotCheckedAt ?? 0;
    if (now - checkedAt > PILOT_MAX_AGE_MS) {
      current = await refreshMembership(input.settings, current, input.refresh, input.save, now);
    }
    if (!current.pilotMember) throw new HttpError(403, PILOT_REQUIRED, "pilot_required");
  }
  await assertDailyBudget(input.kv, input.settings.dailyBudgetUsd, now);
  await consumeAiBudget(input.kv, {
    userId: current.user.id,
    callsPerHour: input.settings.callsPerHour,
    tokensPerDay: input.settings.tokensPerDay,
    tokens: input.tokens ?? 0,
    now,
  });
  return current;
}

/**
 * Mock-only membership flip. The group name comes from Worker config.
 * The browser sends a boolean, never a group list, and production refuses the call.
 */
export function applyPilotToggle(
  session: SessionRecord,
  member: boolean,
  settings: PilotSettings,
  mock: boolean,
  now = Date.now(),
): SessionRecord {
  if (!mock) throw new HttpError(404, "Not found.");
  const tokens = issueMockSessionTokens(session.user, member ? [settings.group] : [], settings.groupsClaim);
  return stampPilot(
    {
      ...session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
    },
    settings,
    now,
  );
}

async function refreshMembership(
  settings: PilotSettings,
  session: SessionRecord,
  refresh: (() => Promise<RefreshedPilot>) | undefined,
  save: ((session: SessionRecord) => Promise<void>) | undefined,
  now: number,
): Promise<SessionRecord> {
  if (!refresh) throw new HttpError(403, PILOT_UNCONFIRMED, "pilot_required");
  let refreshed: RefreshedPilot;
  try {
    refreshed = await refresh();
  } catch {
    throw new HttpError(403, PILOT_UNCONFIRMED, "pilot_required");
  }
  if (!refreshed.receivedIdToken || !refreshed.session.idToken) {
    throw new HttpError(403, PILOT_UNCONFIRMED, "pilot_required");
  }
  const stamped = stampPilot(refreshed.session, settings, now);
  if (save) await save(stamped);
  return stamped;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = positiveNumber(value, Number.NaN);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+(\.\d+)?$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
