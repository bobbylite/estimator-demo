export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let csrfToken: string | null = null;

export function setCsrf(token: string | null) {
  csrfToken = token;
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
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Request failed.";
    throw new ApiError(response.status, message);
  }
  return data as T;
}
