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
}
