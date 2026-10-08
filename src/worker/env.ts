export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  PINGONE_MOCK?: string;
  PINGONE_ENV_ID?: string;
  PINGONE_AUTH_HOST?: string;
  PINGONE_CLIENT_ID?: string;
  PINGONE_CLIENT_SECRET?: string;
  PINGONE_REDIRECT_URI?: string;
  PINGONE_SCOPES?: string;
  /** Plain Worker vars, not secrets. "true" limits AI calls to the pilot group. */
  AI_PILOT_GATE_ENABLED?: string;
  AI_PILOT_GROUP?: string;
  AI_PILOT_GROUPS_CLAIM?: string;
  AI_USER_CALLS_PER_HOUR?: string;
  AI_USER_TOKENS_PER_DAY?: string;
  /** Plain Worker var. Shared estimated Jev spend for a UTC day, in dollars. */
  AI_DAILY_BUDGET_USD?: string;
  /** Worker secret. Never sent to the browser. */
  JEV_API_KEY?: string;
}
