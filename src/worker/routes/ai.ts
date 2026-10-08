import { Hono } from "hono";
import { aiGateCovers, pilotSettings, publicPilot } from "../ai/access";
import { readAiBudget } from "../ai/budget";
import { dailyBudgetView } from "../ai/spend";
import type { SessionRecord } from "../auth/types";
import type { Env } from "../env";
import { enforceAiAccess, requireUser } from "./auth";

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { aiSession?: SessionRecord } }>();

aiRoutes.use("*", async (c, next) => {
  if (aiGateCovers(new URL(c.req.url).pathname)) {
    const session = await requireUser(c);
    c.set("aiSession", await enforceAiAccess(c.env, session));
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
