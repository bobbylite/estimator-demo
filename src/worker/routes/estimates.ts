import { Hono } from "hono";
import { priceEstimate } from "../../shared/costing";
import {
  bidItemSchema,
  createEstimateSchema,
  crewSchema,
  resourceSchema,
  updateEstimateSchema,
} from "../../shared/schemas";
import {
  createCrew,
  createEstimate,
  createItem,
  createResource,
  deleteCrew,
  deleteEstimate,
  deleteItem,
  deleteResource,
  ensureSeeded,
  getEstimate,
  listEstimates,
  updateCrew,
  updateEstimate,
  updateItem,
  updateResource,
  type EstimateRecord,
} from "../db/estimates";
import { ensureSchema } from "../db/schema";
import type { Env } from "../env";
import { HttpError, readJson } from "../http";
import { requireUser } from "./auth";

export const estimateRoutes = new Hono<{ Bindings: Env }>();

estimateRoutes.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

estimateRoutes.get("/", async (c) => {
  const session = await requireUser(c);
  await ensureSeeded(c.env, session.user.id);
  const estimates = await listEstimates(c.env.DB, session.user.id);
  return c.json({
    estimates: estimates.map((estimate) => {
      const priced = price(estimate);
      return {
        id: estimate.id,
        name: estimate.name,
        clientName: estimate.clientName,
        location: estimate.location,
        bidDate: estimate.bidDate,
        status: estimate.status,
        updatedAt: estimate.updatedAt,
        itemCount: estimate.items.length,
        totals: priced.totals,
      };
    }),
  });
});

estimateRoutes.post("/", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, createEstimateSchema);
  const estimate = await createEstimate(c.env.DB, session.user.id, body);
  return c.json({ estimate: price(estimate) }, 201);
});

estimateRoutes.get("/:id", async (c) => {
  const session = await requireUser(c);
  const estimate = await getEstimate(c.env.DB, session.user.id, c.req.param("id"));
  if (!estimate) throw new HttpError(404, "Estimate not found.");
  return c.json({ estimate: price(estimate) });
});

estimateRoutes.patch("/:id", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, updateEstimateSchema);
  const estimate = await updateEstimate(c.env.DB, session.user.id, c.req.param("id"), body);
  if (!estimate) throw new HttpError(404, "Estimate not found.");
  return c.json({ estimate: price(estimate) });
});

estimateRoutes.delete("/:id", async (c) => {
  const session = await requireUser(c);
  const removed = await deleteEstimate(c.env.DB, session.user.id, c.req.param("id"));
  if (!removed) throw new HttpError(404, "Estimate not found.");
  return c.json({ ok: true });
});

estimateRoutes.post("/:id/crews", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, crewSchema);
  const estimate = await createCrew(c.env.DB, session.user.id, c.req.param("id"), body);
  if (!estimate) throw new HttpError(404, "Estimate not found.");
  return c.json({ estimate: price(estimate) }, 201);
});

estimateRoutes.patch("/:id/crews/:crewId", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, crewSchema);
  const estimate = await updateCrew(c.env.DB, session.user.id, c.req.param("id"), c.req.param("crewId"), body);
  if (!estimate) throw new HttpError(404, "Crew not found.");
  return c.json({ estimate: price(estimate) });
});

estimateRoutes.delete("/:id/crews/:crewId", async (c) => {
  const session = await requireUser(c);
  const estimate = await deleteCrew(c.env.DB, session.user.id, c.req.param("id"), c.req.param("crewId"));
  if (!estimate) throw new HttpError(404, "Estimate not found.");
  return c.json({ estimate: price(estimate) });
});

estimateRoutes.post("/:id/items", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, bidItemSchema);
  const estimate = await createItem(c.env.DB, session.user.id, c.req.param("id"), body);
  if (!estimate) throw new HttpError(404, "Estimate or crew not found.");
  return c.json({ estimate: price(estimate) }, 201);
});

estimateRoutes.patch("/:id/items/:itemId", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, bidItemSchema);
  const estimate = await updateItem(
    c.env.DB,
    session.user.id,
    c.req.param("id"),
    c.req.param("itemId"),
    body,
  );
  if (!estimate) throw new HttpError(404, "Bid item not found.");
  return c.json({ estimate: price(estimate) });
});

estimateRoutes.delete("/:id/items/:itemId", async (c) => {
  const session = await requireUser(c);
  const estimate = await deleteItem(c.env.DB, session.user.id, c.req.param("id"), c.req.param("itemId"));
  if (!estimate) throw new HttpError(404, "Bid item not found.");
  return c.json({ estimate: price(estimate) });
});

estimateRoutes.post("/:id/items/:itemId/resources", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, resourceSchema);
  const estimate = await createResource(
    c.env.DB,
    session.user.id,
    c.req.param("id"),
    c.req.param("itemId"),
    body,
  );
  if (!estimate) throw new HttpError(404, "Bid item not found.");
  return c.json({ estimate: price(estimate) }, 201);
});

estimateRoutes.patch("/:id/items/:itemId/resources/:resourceId", async (c) => {
  const session = await requireUser(c);
  const body = await readJson(c.req.raw, resourceSchema);
  const estimate = await updateResource(
    c.env.DB,
    session.user.id,
    c.req.param("id"),
    c.req.param("itemId"),
    c.req.param("resourceId"),
    body,
  );
  if (!estimate) throw new HttpError(404, "Resource not found.");
  return c.json({ estimate: price(estimate) });
});

estimateRoutes.delete("/:id/items/:itemId/resources/:resourceId", async (c) => {
  const session = await requireUser(c);
  const estimate = await deleteResource(
    c.env.DB,
    session.user.id,
    c.req.param("id"),
    c.req.param("itemId"),
    c.req.param("resourceId"),
  );
  if (!estimate) throw new HttpError(404, "Resource not found.");
  return c.json({ estimate: price(estimate) });
});

function price(estimate: EstimateRecord) {
  const priced = priceEstimate(estimate.items, estimate.crews, {
    overheadPercent: estimate.overheadPercent,
    profitPercent: estimate.profitPercent,
    bondPercent: estimate.bondPercent,
    contingencyPercent: estimate.contingencyPercent,
  });
  return { ...estimate, items: priced.items, totals: priced.totals };
}
