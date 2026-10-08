import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Shell } from "../components/Shell";
import { Dialog, Mix } from "../components/ui";
import { formatDate, formatMoney, STATUS_LABEL } from "../format";
import { useSession } from "../session";
import type { EstimateSummary } from "../types";

export function EstimatesPage() {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const estimates = useQuery({
    queryKey: ["estimates"],
    queryFn: () => api<{ estimates: EstimateSummary[] }>("/api/estimates"),
  });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", clientName: "", location: "", bidDate: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.title = "Estimates — Meridian";
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = estimates.data?.estimates ?? [];
    if (!needle) return rows;
    return rows.filter((estimate) =>
      `${estimate.name} ${estimate.clientName} ${estimate.location}`.toLowerCase().includes(needle),
    );
  }, [estimates.data, query]);

  async function createEstimate() {
    setPending(true);
    setError("");
    try {
      const created = await api<{ estimate: { id: string } }>("/api/estimates", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          clientName: form.clientName,
          location: form.location,
          ...(form.bidDate ? { bidDate: form.bidDate } : {}),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["estimates"] });
      setOpen(false);
      await navigate({ to: "/estimates/$estimateId", params: { estimateId: created.estimate.id } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the estimate.");
      setPending(false);
    }
  }

  const user = session.data?.user;

  return (
    <Shell name={user?.name ?? "Estimator"} mock={Boolean(session.data?.mock)}>
      <main className="page" id="main">
        <div className="page-head">
          <div>
            <p className="kicker" style={{ color: "var(--muted)" }}>Bid book</p>
            <h1>Estimates</h1>
            <p>Heavy civil packages, priced from crews and production.</p>
          </div>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            New estimate
          </button>
        </div>
        <div className="filters">
          <input
            aria-label="Search estimates"
            placeholder="Search by job, client, or location"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {estimates.isLoading ? (
          <div className="cards" aria-busy="true">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : null}
        {estimates.isError ? (
          <div className="callout">
            <strong>Couldn’t load estimates.</strong>
            <p>{estimates.error instanceof Error ? estimates.error.message : "Try again."}</p>
            <button type="button" className="btn" onClick={() => void estimates.refetch()}>
              Retry
            </button>
          </div>
        ) : null}
        {estimates.data && visible.length === 0 ? (
          <div className="empty">
            <h2>No estimates yet</h2>
            <p>Start a bid package and the first crew is already on the page.</p>
          </div>
        ) : null}
        <div className="cards">
          {visible.map((estimate) => (
            <Link key={estimate.id} to="/estimates/$estimateId" params={{ estimateId: estimate.id }} className="card">
              <div className="card-top">
                <span className={`status ${estimate.status}`}>{STATUS_LABEL[estimate.status]}</span>
                <span>{formatDate(estimate.bidDate)}</span>
              </div>
              <div>
                <h2>{estimate.name}</h2>
                <p className="meta">
                  {estimate.clientName} · {estimate.location}
                </p>
              </div>
              <Mix {...estimate.totals} />
              <div className="card-bottom">
                <span className="total">{formatMoney(estimate.totals.bid)}</span>
                <span>
                  {estimate.itemCount} item{estimate.itemCount === 1 ? "" : "s"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </main>
      {open ? (
        <Dialog title="New estimate" onClose={() => setOpen(false)}>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="field">
            <span>Client</span>
            <input value={form.clientName} onChange={(event) => setForm({ ...form, clientName: event.target.value })} />
          </label>
          <label className="field">
            <span>Location</span>
            <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          </label>
          <label className="field">
            <span>Bid date</span>
            <input type="date" value={form.bidDate} onChange={(event) => setForm({ ...form, bidDate: event.target.value })} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="button" className="btn full" disabled={pending} onClick={() => void createEstimate()}>
            {pending ? "Creating…" : "Create estimate"}
          </button>
        </Dialog>
      ) : null}
    </Shell>
  );
}
