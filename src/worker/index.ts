import { Hono } from "hono";
import { authFailureBody } from "./auth/fault";
import { AuthFlowError } from "./auth/types";
import type { Env } from "./env";
import { HttpError, jsonError } from "./http";
import { authRoutes } from "./routes/auth";
import { estimateRoutes } from "./routes/estimates";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "same-origin");
  c.header("x-frame-options", "DENY");
});

app.get("/api/health", (c) => c.json({ ok: true, mock: c.env.PINGONE_MOCK === "true" }));
app.route("/api/auth", authRoutes);
app.route("/api/estimates", estimateRoutes);

app.notFound(() => jsonError(404, "Not found."));

app.onError((error) => {
  if (error instanceof AuthFlowError) {
    return Response.json(authFailureBody(error), { status: error.status });
  }
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message, ...(error.kind ? { kind: error.kind } : {}) },
      { status: error.status },
    );
  }
  console.error(error);
  return jsonError(500, "Something went wrong.");
});

export default app;
