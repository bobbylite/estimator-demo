import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { priceEstimate, type Markups } from "../../shared/costing";
import { UNITS, bidItemSchema, resourceSchema } from "../../shared/schemas";
import { api } from "../api";
import { Shell } from "../components/Shell";
import { Dialog, Mix } from "../components/ui";
import { formatDate, formatHours, formatMoney, formatQty, STATUS_LABEL } from "../format";
import { useSession } from "../session";
import type { BidItem, Crew, Estimate, Resource } from "../types";

type Tab = "items" | "crews" | "summary";

export function EstimatePage() {
  const { estimateId } = useParams({ from: "/estimates/$estimateId" });
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["estimate", estimateId],
    queryFn: () => api<{ estimate: Estimate }>(`/api/estimates/${estimateId}`),
  });
  const estimate = query.data?.estimate;
  const [tab, setTab] = useState<Tab>("items");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BidItem | null>(null);
  const [markups, setMarkups] = useState<Markups | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (estimate) document.title = `${estimate.name} — Meridian`;
  }, [estimate]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const preview = useMemo(() => {
    if (!estimate) return null;
    const items = estimate.items.map((item) => (draft && item.id === draft.id ? draft : item));
    return priceEstimate(items, estimate.crews, markups ?? markupsOf(estimate));
  }, [estimate, draft, markups]);

  if (query.isLoading) {
    return (
      <Shell name={session.data?.user?.name ?? "Estimator"} mock={Boolean(session.data?.mock)}>
        <main className="page" id="main">
          <div className="skeleton" />
        </main>
      </Shell>
    );
  }

  if (query.isError || !estimate || !preview) {
    return (
      <Shell name={session.data?.user?.name ?? "Estimator"} mock={Boolean(session.data?.mock)}>
        <main className="page" id="main">
          <div className="callout">
            <strong>This estimate isn’t available.</strong>
            <p>{query.error instanceof Error ? query.error.message : "It may have been deleted."}</p>
            <button type="button" className="btn" onClick={() => void navigate({ to: "/estimates" })}>
              Back to estimates
            </button>
          </div>
        </main>
      </Shell>
    );
  }

  const totals = preview.totals;
  const dirty = Boolean(draft || markups || notes !== null);

  const bid = estimate;

  function selectItem(item: BidItem) {
    setSelectedId(item.id);
    setDraft(structuredClone(item));
    setError("");
    setTab("items");
  }

  function openItem(id: string) {
    if (draft?.id === id) return;
    const source = bid?.items.find((item) => item.id === id);
    if (source) selectItem(source);
  }

  async function persist(next: Estimate, message: string) {
    queryClient.setQueryData(["estimate", estimateId], { estimate: next });
    await queryClient.invalidateQueries({ queryKey: ["estimates"] });
    setToast(message);
  }

  async function saveItem() {
    if (!draft) return;
    const parsed = bidItemSchema.safeParse({
      code: draft.code,
      description: draft.description,
      quantity: draft.quantity,
      unit: draft.unit,
      crewId: draft.crewId,
      productionRate: draft.productionRate,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the bid item.");
      return;
    }
    for (const resource of draft.resources) {
      const resourceParsed = resourceSchema.safeParse(resource);
      if (!resourceParsed.success) {
        setError(resourceParsed.error.issues[0]?.message ?? "Check the resources.");
        return;
      }
    }
    setPending(true);
    setError("");
    try {
      let current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}/items/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify(parsed.data),
      });
      const serverItem = current.estimate.items.find((item) => item.id === draft.id);
      const serverResources = serverItem?.resources ?? [];
      for (const existing of serverResources) {
        if (!draft.resources.some((resource) => resource.id === existing.id)) {
          current = await api(`/api/estimates/${bid.id}/items/${draft.id}/resources/${existing.id}`, {
            method: "DELETE",
          });
        }
      }
      for (const resource of draft.resources) {
        const body = {
          kind: resource.kind,
          description: resource.description,
          unitCost: resource.unitCost,
          wastePercent: resource.wastePercent,
          pricing: resource.pricing,
        };
        if (resource.id.startsWith("new-")) {
          current = await api(`/api/estimates/${bid.id}/items/${draft.id}/resources`, {
            method: "POST",
            body: JSON.stringify(body),
          });
        } else if (changedResource(serverResources.find((item) => item.id === resource.id), resource)) {
          current = await api(`/api/estimates/${bid.id}/items/${draft.id}/resources/${resource.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
        }
      }
      const saved = current.estimate.items.find((item) => item.id === draft.id) ?? null;
      setDraft(saved);
      await persist(current.estimate, "Bid item saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the item.");
    } finally {
      setPending(false);
    }
  }

  async function addItem() {
    setPending(true);
    try {
      const current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}/items`, {
        method: "POST",
        body: JSON.stringify({
          code: String(9000 + bid.items.length),
          description: "New bid item",
          quantity: 0,
          unit: "LS",
          crewId: bid.crews[0]?.id ?? null,
          productionRate: 0,
        }),
      });
      await persist(current.estimate, "Item added");
      const created = current.estimate.items.at(-1);
      if (created) selectItem(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the item.");
    } finally {
      setPending(false);
    }
  }

  async function removeItem() {
    if (!draft) return;
    setPending(true);
    try {
      const current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}/items/${draft.id}`, {
        method: "DELETE",
      });
      setDraft(null);
      setSelectedId(null);
      await persist(current.estimate, "Item removed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the item.");
    } finally {
      setPending(false);
    }
  }

  async function saveMarkups() {
    setPending(true);
    setError("");
    try {
      const current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(markups ?? {}),
          ...(notes !== null ? { notes } : {}),
        }),
      });
      setMarkups(null);
      setNotes(null);
      await persist(current.estimate, "Summary saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save markups.");
    } finally {
      setPending(false);
    }
  }

  async function saveStatus(status: Estimate["status"]) {
    const current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await persist(current.estimate, "Status updated");
  }

  async function saveCrew(crew: Crew) {
    const current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}/crews/${crew.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: crew.name,
        laborRate: crew.laborRate,
        equipmentRate: crew.equipmentRate,
      }),
    });
    await persist(current.estimate, "Crew saved");
  }

  async function addCrew() {
    const current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}/crews`, {
      method: "POST",
      body: JSON.stringify({ name: "New crew", laborRate: 0, equipmentRate: 0 }),
    });
    await persist(current.estimate, "Crew added");
  }

  async function removeCrew(crewId: string) {
    const current = await api<{ estimate: Estimate }>(`/api/estimates/${bid.id}/crews/${crewId}`, {
      method: "DELETE",
    });
    await persist(current.estimate, "Crew removed");
  }

  async function removeEstimate() {
    await api(`/api/estimates/${bid.id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["estimates"] });
    await navigate({ to: "/estimates" });
  }

  const activeMarkups = markups ?? markupsOf(bid);
  const activeNotes = notes ?? bid.notes;

  return (
    <Shell name={session.data?.user?.name ?? "Estimator"} mock={Boolean(session.data?.mock)}>
      <main className="page" id="main">
        <div className="workspace-head">
          <div>
            <p className="kicker" style={{ color: "var(--muted)" }}>{bid.clientName}</p>
            <h1>{bid.name}</h1>
            <p className="meta">
              {bid.location} · Bid {formatDate(bid.bidDate)}
              {dirty ? <span className="unsaved"> · Unsaved changes are included in the total</span> : null}
            </p>
            <label className="field" style={{ maxWidth: 180, marginTop: 12 }}>
              <span>Status</span>
              <select
                value={bid.status}
                aria-label="Estimate status"
                onChange={(event) => void saveStatus(event.target.value as Estimate["status"])}
              >
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div className="hero-label">Bid total</div>
            <p className="hero-total" aria-live="polite">
              {formatMoney(totals.bid)}
            </p>
          </div>
        </div>
        <section className="metrics" aria-label="Estimate totals">
          <div className="metric"><span>Direct</span><b>{formatMoney(totals.direct)}</b></div>
          <div className="metric"><span>Markup</span><b>{formatMoney(totals.bid - totals.direct)}</b></div>
          <div className="metric"><span>Hours</span><b>{formatHours(totals.hours)}</b></div>
          <div className="metric"><span>Items</span><b>{bid.items.length}</b></div>
        </section>
        <Mix {...totals} />
        <div className="legend" style={{ margin: "8px 0 16px" }}>
          <span><i className="swatch labor" /> Labor {formatMoney(totals.labor, true)}</span>
          <span><i className="swatch equip" /> Equipment {formatMoney(totals.equipment, true)}</span>
          <span><i className="swatch mat" /> Materials {formatMoney(totals.material, true)}</span>
          <span><i className="swatch sub" /> Subs {formatMoney(totals.subcontractor, true)}</span>
        </div>
        <div className="tabs" role="tablist" aria-label="Estimate sections">
          {(["items", "crews", "summary"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
              {value === "items" ? "Bid items" : value === "crews" ? "Crews" : "Summary"}
            </button>
          ))}
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {tab === "items" ? (
          <div className="workspace">
            <div>
              <div className="row-actions" style={{ marginBottom: 10 }}>
                <button type="button" className="btn" onClick={() => void addItem()} disabled={pending}>
                  Add item
                </button>
              </div>
              <div className="sheet">
                <table>
                  <thead>
                    <tr>
                      <th className="desc">Item</th>
                      <th className="desc">Description</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Hours</th>
                      <th>Labor</th>
                      <th>Equip</th>
                      <th>Matl</th>
                      <th>Sub</th>
                      <th>Direct</th>
                      <th>Bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr
                        key={item.id}
                        className={item.id === selectedId ? "is-selected" : ""}
                        tabIndex={0}
                        aria-selected={item.id === selectedId}
                        onClick={() => openItem(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openItem(item.id);
                          }
                        }}
                      >
                        <td className="desc">{item.code}</td>
                        <td className="desc">{item.description}</td>
                        <td>{formatQty(item.quantity)}</td>
                        <td>{item.unit}</td>
                        <td>{formatHours(item.cost.hours)}</td>
                        <td>{formatMoney(item.cost.labor, true)}</td>
                        <td>{formatMoney(item.cost.equipment, true)}</td>
                        <td>{formatMoney(item.cost.material, true)}</td>
                        <td>{formatMoney(item.cost.subcontractor, true)}</td>
                        <td>{formatMoney(item.cost.direct, true)}</td>
                        <td>{formatMoney(item.cost.bid, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bid.items.length === 0 ? <div className="empty">Add a bid item to start pricing.</div> : null}
              </div>
            </div>
            <aside className="panel" aria-label="Bid item editor">
              {draft ? (
                <>
                  <h2>Item {draft.code}</h2>
                  <label className="field"><span>Code</span><input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label>
                  <label className="field"><span>Description</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                  <div className="grid-2">
                    <label className="field"><span>Quantity</span><input type="number" min="0" step="any" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: numberValue(event.target.value) })} /></label>
                    <label className="field">
                      <span>Unit</span>
                      <select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })}>
                        {UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    <span>Crew</span>
                    <select
                      value={draft.crewId ?? ""}
                      onChange={(event) => setDraft({ ...draft, crewId: event.target.value || null })}
                    >
                      <option value="">No crew</option>
                      {bid.crews.map((crew) => (
                        <option key={crew.id} value={crew.id}>{crew.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Production, units per hour</span>
                    <input type="number" min="0" step="any" value={draft.productionRate} onChange={(event) => setDraft({ ...draft, productionRate: numberValue(event.target.value) })} />
                  </label>
                  <p className="fine">Hours = quantity ÷ production. Labor and equipment use the crew’s blended hourly rates.</p>
                  <h3>Resources</h3>
                  {draft.resources.map((resource) => (
                    <div className="resource" key={resource.id}>
                      <div className="grid-2">
                        <select
                          aria-label="Resource kind"
                          value={resource.kind}
                          onChange={(event) => updateResource(setDraft, draft, resource.id, { kind: event.target.value as Resource["kind"] })}
                        >
                          <option value="material">Material</option>
                          <option value="subcontractor">Subcontractor</option>
                        </select>
                        <select
                          aria-label="Pricing"
                          value={resource.pricing}
                          onChange={(event) => updateResource(setDraft, draft, resource.id, { pricing: event.target.value as Resource["pricing"] })}
                        >
                          <option value="unit">Per unit</option>
                          <option value="lump">Lump sum</option>
                        </select>
                      </div>
                      <input
                        aria-label="Resource description"
                        value={resource.description}
                        onChange={(event) => updateResource(setDraft, draft, resource.id, { description: event.target.value })}
                      />
                      <div className="grid-2">
                        <input
                          aria-label="Unit cost"
                          type="number"
                          min="0"
                          step="any"
                          value={resource.unitCost}
                          onChange={(event) => updateResource(setDraft, draft, resource.id, { unitCost: numberValue(event.target.value) })}
                        />
                        {resource.kind === "material" ? (
                          <input
                            aria-label="Waste percent"
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            value={resource.wastePercent}
                            onChange={(event) => updateResource(setDraft, draft, resource.id, { wastePercent: numberValue(event.target.value) })}
                          />
                        ) : <span className="fine">Waste applies to materials.</span>}
                      </div>
                      <button type="button" className="text-button danger" onClick={() => setDraft({ ...draft, resources: draft.resources.filter((item) => item.id !== resource.id) })}>
                        Remove resource
                      </button>
                    </div>
                  ))}
                  <div className="row-actions" style={{ marginTop: 8 }}>
                    <button type="button" className="text-button" onClick={() => setDraft({ ...draft, resources: [...draft.resources, blankResource("material")] })}>Add material</button>
                    <button type="button" className="text-button" onClick={() => setDraft({ ...draft, resources: [...draft.resources, blankResource("subcontractor")] })}>Add sub</button>
                  </div>
                  <div className="cost-lines">
                    <div><span>Hours</span><b>{formatHours(preview.items.find((item) => item.id === draft.id)?.cost.hours ?? 0)}</b></div>
                    <div><span>Item bid</span><b>{formatMoney(preview.items.find((item) => item.id === draft.id)?.cost.bid ?? 0)}</b></div>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="btn" disabled={pending} onClick={() => void saveItem()}>{pending ? "Saving…" : "Save item"}</button>
                    <button type="button" className="text-button danger" onClick={() => void removeItem()}>Delete</button>
                  </div>
                </>
              ) : (
                <div className="empty">
                  <h2>Select a bid item</h2>
                  <p>Quantity and production update the bid total before you save.</p>
                </div>
              )}
            </aside>
          </div>
        ) : null}
        {tab === "crews" ? (
          <div>
            <button type="button" className="btn" style={{ marginBottom: 12 }} onClick={() => void addCrew()}>Add crew</button>
            <div className="crews">
              {bid.crews.map((crew) => (
                <CrewCard
                  key={`${crew.id}:${crew.name}:${crew.laborRate}:${crew.equipmentRate}`}
                  crew={crew}
                  onSave={saveCrew}
                  onDelete={removeCrew}
                />
              ))}
            </div>
            <p className="fine">Rates are the blended cost of the whole crew per hour, not a single person.</p>
          </div>
        ) : null}
        {tab === "summary" ? (
          <div className="summary-layout">
            <section className="summary-card">
              <h2>Markups</h2>
              <div className="grid-2">
                <Percent label="Overhead" value={activeMarkups.overheadPercent} onChange={(value) => setMarkups({ ...activeMarkups, overheadPercent: value })} />
                <Percent label="Profit" value={activeMarkups.profitPercent} onChange={(value) => setMarkups({ ...activeMarkups, profitPercent: value })} />
                <Percent label="Bond" value={activeMarkups.bondPercent} onChange={(value) => setMarkups({ ...activeMarkups, bondPercent: value })} />
                <Percent label="Contingency" value={activeMarkups.contingencyPercent} onChange={(value) => setMarkups({ ...activeMarkups, contingencyPercent: value })} />
              </div>
              <p className="fine">Overhead is on direct cost. Profit is on direct plus overhead. Bond is on that subtotal. Contingency stays on direct cost.</p>
              <label className="field">
                <span>Notes</span>
                <textarea value={activeNotes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <button type="button" className="btn" disabled={pending || (!markups && notes === null)} onClick={() => void saveMarkups()}>
                Save summary
              </button>
              <div className="cost-lines" style={{ marginTop: 16 }}>
                <div><span>Labor</span><b>{formatMoney(totals.labor)}</b></div>
                <div><span>Equipment</span><b>{formatMoney(totals.equipment)}</b></div>
                <div><span>Materials</span><b>{formatMoney(totals.material)}</b></div>
                <div><span>Subcontractors</span><b>{formatMoney(totals.subcontractor)}</b></div>
                <div><span>Direct</span><b>{formatMoney(totals.direct)}</b></div>
                <div><span>Overhead</span><b>{formatMoney(totals.overhead)}</b></div>
                <div><span>Profit</span><b>{formatMoney(totals.profit)}</b></div>
                <div><span>Bond</span><b>{formatMoney(totals.bond)}</b></div>
                <div><span>Contingency</span><b>{formatMoney(totals.contingency)}</b></div>
                <div><span>Bid</span><b>{formatMoney(totals.bid)}</b></div>
              </div>
            </section>
            <button type="button" className="text-button danger" onClick={() => setConfirmDelete(true)}>
              Delete estimate
            </button>
          </div>
        ) : null}
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      {confirmDelete ? (
        <Dialog title="Delete this estimate?" onClose={() => setConfirmDelete(false)}>
          <p>The bid items and crews go with it.</p>
          <button type="button" className="btn danger" onClick={() => void removeEstimate()}>Delete</button>
        </Dialog>
      ) : null}
    </Shell>
  );
}

function CrewCard({
  crew,
  onSave,
  onDelete,
}: {
  crew: Crew;
  onSave: (crew: Crew) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(crew);
  return (
    <form
      className="crew-card"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft);
      }}
    >
      <label className="field"><span>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="field"><span>Labor $ / hour</span><input type="number" min="0" step="any" value={draft.laborRate} onChange={(event) => setDraft({ ...draft, laborRate: numberValue(event.target.value) })} /></label>
      <label className="field"><span>Equipment $ / hour</span><input type="number" min="0" step="any" value={draft.equipmentRate} onChange={(event) => setDraft({ ...draft, equipmentRate: numberValue(event.target.value) })} /></label>
      <div className="row-actions">
        <button className="btn" type="submit">Save crew</button>
        <button className="text-button danger" type="button" onClick={() => void onDelete(crew.id)}>Remove</button>
      </div>
    </form>
  );
}

function Percent({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label} %</span>
      <input type="number" min="0" max="100" step="any" value={value} onChange={(event) => onChange(numberValue(event.target.value))} />
    </label>
  );
}

function markupsOf(bid: Estimate): Markups {
  return {
    overheadPercent: bid.overheadPercent,
    profitPercent: bid.profitPercent,
    bondPercent: bid.bondPercent,
    contingencyPercent: bid.contingencyPercent,
  };
}

function numberValue(value: string): number {
  if (value === "") return 0;
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function blankResource(kind: Resource["kind"]): Resource {
  return {
    id: `new-${crypto.randomUUID()}`,
    kind,
    description: kind === "material" ? "Material" : "Subcontractor",
    unitCost: 0,
    wastePercent: 0,
    pricing: "unit",
  };
}

function updateResource(
  setDraft: (item: BidItem) => void,
  draft: BidItem,
  id: string,
  patch: Partial<Resource>,
) {
  setDraft({
    ...draft,
    resources: draft.resources.map((resource) => (resource.id === id ? { ...resource, ...patch } : resource)),
  });
}

function changedResource(previous: Resource | undefined, next: Resource): boolean {
  if (!previous) return true;
  return (
    previous.kind !== next.kind ||
    previous.description !== next.description ||
    previous.unitCost !== next.unitCost ||
    previous.wastePercent !== next.wastePercent ||
    previous.pricing !== next.pricing
  );
}
