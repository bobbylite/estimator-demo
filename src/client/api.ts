export interface PingOneErrorBody {
  status?: number;
  id?: string;
  code?: string;
  message?: string;
  target?: string;
  details?: Array<{ code?: string; target?: string; message?: string }>;
  correlationId?: string;
  requestId?: string;
}

export class ApiError extends Error {
  status: number;
  pingone?: PingOneErrorBody;

  constructor(status: number, message: string, pingone?: PingOneErrorBody) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.pingone = pingone;
  }
}

let csrfToken: string | null = null;

export function setCsrf(token: string | null) {
  csrfToken = token;
}

function readPingOneError(value: unknown): PingOneErrorBody | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const details = Array.isArray(record.details)
    ? record.details.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const detail = item as Record<string, unknown>;
        return [
          {
            ...(typeof detail.code === "string" ? { code: detail.code } : {}),
            ...(typeof detail.target === "string" ? { target: detail.target } : {}),
            ...(typeof detail.message === "string" ? { message: detail.message } : {}),
          },
        ];
      })
    : undefined;
  const body: PingOneErrorBody = {
    ...(typeof record.status === "number" ? { status: record.status } : {}),
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof record.message === "string" ? { message: record.message } : {}),
    ...(typeof record.target === "string" ? { target: record.target } : {}),
    ...(details && details.length ? { details } : {}),
    ...(typeof record.correlationId === "string" ? { correlationId: record.correlationId } : {}),
    ...(typeof record.requestId === "string" ? { requestId: record.requestId } : {}),
  };
  return Object.keys(body).length ? body : undefined;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && csrfToken) headers.set("x-csrf-token", csrfToken);
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
    const message = typeof record?.error === "string" ? record.error : "Request failed.";
    throw new ApiError(response.status, message, readPingOneError(record?.pingone));
  }
  return data as T;
}
