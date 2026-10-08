import { AuthFlowError, type PingOneFault } from "./types";

/**
 * PingOne error documents, from the platform error-codes reference:
 * `{ id, code, message, target?, details?: [{ code, target, message }] }`.
 * `id` is the value PingOne stores in its logs.
 * OAuth token failures use `{ error, error_description }` instead.
 * Flow actions sometimes keep a status and attach `error: { code, message }`.
 */

const SECRET_KEYS = ["password", "secret", "token", "cookie", "authorization", "verifier"];

export function isPingOneFailure(status: number, json: unknown): boolean {
  if (status >= 400) return true;
  const record = asRecord(json);
  if (!record) return false;
  const flowStatus = typeof record.status === "string" ? record.status : "";
  if (flowStatus === "COMPLETED" || flowStatus === "COMPLETED_ACCEPTED") return false;
  if (typeof record.code === "string" && record.code && !flowStatus) return true;
  if (typeof record.error === "string" && record.error) return true;
  const embedded = asRecord(record.error);
  if (embedded && (nonEmpty(embedded.code) || nonEmpty(embedded.message))) return true;
  if (Array.isArray(record.details) && record.details.some((item) => asRecord(item))) return true;
  if (flowStatus === "FAILED") return true;
  return false;
}

export function readPingOneFault(status: number, json: unknown, headers?: Headers): PingOneFault {
  const fault: PingOneFault = { status };
  const correlationId = headerValue(headers, ["correlation-id", "x-correlation-id"]);
  const requestId = headerValue(headers, ["x-request-id", "request-id", "x-ping-request-id"]);
  if (correlationId) fault.correlationId = clip(correlationId, 200);
  if (requestId) fault.requestId = clip(requestId, 200);

  const record = asRecord(json);
  if (!record) return fault;

  const id = nonEmpty(record.id);
  const code = nonEmpty(record.code);
  const message = nonEmpty(record.message);
  const target = nonEmpty(record.target);
  if (id) fault.id = clip(id, 200);
  if (code) fault.code = clip(code, 80);
  if (message) fault.message = clip(message, 500);
  if (target) fault.target = clip(target, 120);

  const details = readDetails(record.details);
  if (details.length) fault.details = details;

  const oauthError = nonEmpty(record.error);
  const oauthDescription = nonEmpty(record.error_description);
  if (oauthError) {
    fault.code ??= clip(oauthError, 80);
    if (oauthDescription) fault.message = clip(oauthDescription, 500);
  } else {
    const embedded = asRecord(record.error);
    const embeddedCode = embedded ? nonEmpty(embedded.code) : undefined;
    const embeddedMessage = embedded ? nonEmpty(embedded.message) : undefined;
    if (embeddedCode) fault.code ??= clip(embeddedCode, 80);
    if (embeddedMessage && !fault.message) fault.message = clip(embeddedMessage, 500);
  }

  return fault;
}

export function publicPingOneMessage(fault: PingOneFault, status: number): string {
  const details = fault.details?.map((detail) => detail.message).filter((message): message is string => Boolean(message));
  if (details && details.length) return details.join(" ");
  if (fault.message) return fault.message;
  if (fault.code) return fault.code;
  if (status === 400 || status === 401) return "The username or password was not accepted.";
  return "PingOne could not complete that step.";
}

export function throwPingOne(response: Response, json: unknown): never {
  const status = response.status >= 400 && response.status <= 599 ? response.status : 400;
  const fault = readPingOneFault(response.status, json, response.headers);
  const error = new AuthFlowError(status, publicPingOneMessage(fault, status), fault);
  logPingOneFailure(error);
  throw error;
}

export function authFailureBody(error: AuthFlowError): { error: string; pingone?: PingOneFault } {
  if (!error.pingone) return { error: error.message };
  return { error: error.message, pingone: error.pingone };
}

/** Worker log line. Request bodies, cookies, and tokens are not included. */
export function logPingOneFailure(error: AuthFlowError): void {
  if (!error.pingone) return;
  const fault = error.pingone;
  console.error(
    JSON.stringify({
      event: "pingone.auth.failed",
      summary: error.message,
      httpStatus: fault.status,
      id: fault.id,
      code: fault.code,
      message: fault.message,
      target: fault.target,
      details: fault.details,
      correlationId: fault.correlationId,
      requestId: fault.requestId,
    }),
  );
}

function readDetails(value: unknown): NonNullable<PingOneFault["details"]> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const code = nonEmpty(record.code);
    const target = nonEmpty(record.target);
    const message = nonEmpty(record.message);
    if (!code && !target && !message) return [];
    return [
      {
        ...(code ? { code: clip(code, 80) } : {}),
        ...(target ? { target: clip(target, 120) } : {}),
        ...(message ? { message: clip(message, 500) } : {}),
      },
    ];
  });
}

function headerValue(headers: Headers | undefined, names: string[]): string | undefined {
  if (!headers) return undefined;
  for (const name of names) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (SECRET_KEYS.some((key) => lower.includes(`${key}=`) || lower.includes(`"${key}"`))) return undefined;
  return trimmed;
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
