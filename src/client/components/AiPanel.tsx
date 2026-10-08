import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { PilotState } from "../session";

export interface AiDecision {
  id: string;
  estimateId: string;
  itemId: string | null;
  itemCode: string | null;
  questionId: string;
  kind: string;
  title: string;
  summary: string;
  confidence: number;
  threshold: number;
  status: "applied" | "review" | "accepted" | "dismissed";
  actor: "jev" | "person";
  createdAt: string;
}

interface AiPayload {
  decisions: AiDecision[];
  threshold: number;
}

export function useAiDecisions(estimateId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ai", estimateId],
    enabled,
    queryFn: () => api<AiPayload>(`/api/ai/decisions?estimateId=${encodeURIComponent(estimateId)}`),
  });
}

export function DecisionMarks({ itemId, decisions }: { itemId: string; decisions: AiDecision[] }) {
  const related = decisions.filter((decision) => decision.itemId === itemId && decision.status !== "dismissed");
  const review = related.some((decision) => decision.status === "review");
  const jev = related.some((decision) => decision.actor === "jev" && (decision.status === "applied" || decision.status === "accepted"));
  if (!review && !jev) return null;
  return (
    <span className="decision-marks">
      {jev ? <span className="jev-chip">AI</span> : null}
      {review ? <span className="review-chip">Review</span> : null}
    </span>
  );
}

export function AiPanel({
  estimateId,
  allowed,
  pilot,
  resting = false,
}: {
  estimateId: string;
  allowed: boolean;
  pilot?: PilotState;
  resting?: boolean;
}) {
  const queryClient = useQueryClient();
  const ai = useAiDecisions(estimateId, allowed);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [threshold, setThreshold] = useState<number | null>(null);
  const decisions = ai.data?.decisions ?? [];
  const currentThreshold = threshold ?? ai.data?.threshold ?? 0.8;
  const applied = decisions.filter((decision) => decision.status === "applied" || decision.status === "accepted");
  const review = decisions.filter((decision) => decision.status === "review");
  const dismissed = decisions.filter((decision) => decision.status === "dismissed");

  async function saveThreshold(next: number) {
    setThreshold(next);
    await api("/api/ai/threshold", { method: "PUT", body: JSON.stringify({ threshold: next }) });
    await queryClient.invalidateQueries({ queryKey: ["ai", estimateId] });
  }

  async function run() {
    setPending(true);
    setError("");
    try {
      await api(`/api/ai/decisions`, { method: "POST", body: JSON.stringify({ estimateId }) });
      await queryClient.invalidateQueries({ queryKey: ["ai", estimateId] });
      await queryClient.invalidateQueries({ queryKey: ["estimate", estimateId] });
      await queryClient.invalidateQueries({ queryKey: ["estimates"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jev could not read this estimate.");
    } finally {
      setPending(false);
    }
  }

  async function act(id: string, action: "accept" | "dismiss") {
    setPending(true);
    setError("");
    try {
      await api(`/api/ai/decisions/${id}/${action}`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["ai", estimateId] });
      await queryClient.invalidateQueries({ queryKey: ["estimate", estimateId] });
      await queryClient.invalidateQueries({ queryKey: ["estimates"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update that decision.");
    } finally {
      setPending(false);
    }
  }

  if (!allowed) {
    return (
      <section className="pilot-banner is-out" aria-label="AI pilot">
        <p className="kicker">Private pilot</p>
        <h2>AI is in a private pilot</h2>
        <p>
          Estimating stays open. Jev suggestions are limited to the {pilot?.group ?? "pilot"} group.
        </p>
      </section>
    );
  }

  return (
    <section className="ai-panel" aria-label="Jev decisions">
      {resting ? (
        <section className="pilot-banner is-out" aria-label="AI resting">
          <p className="kicker">Jev</p>
          <h2>AI is resting for today</h2>
          <p>Today&apos;s shared budget is used up. Decisions already on this estimate stay here. New Jev calls start again at the next UTC day.</p>
        </section>
      ) : (
        <div className="ai-head">
          <div>
            <p className="kicker" style={{ color: "var(--muted)" }}>Jev</p>
            <h2>Decisions on this estimate</h2>
            <p className="fine" style={{ marginTop: 6 }}>
              One pass over the bid. At or above your threshold, Jev applies the change. Below it, the item waits here.
              A number you edit yourself stays person-authored.
            </p>
          </div>
          <button type="button" className="btn" disabled={pending} onClick={() => void run()}>
            {pending ? "Reading…" : decisions.length ? "Run again" : "Run"}
          </button>
        </div>
      )}
      <label className="threshold">
        <span>Apply at or above {Math.round(currentThreshold * 100)}%</span>
        <input
          type="range"
          min={50}
          max={95}
          step={1}
          value={Math.round(currentThreshold * 100)}
          aria-label="Autonomy threshold"
          onChange={(event) => setThreshold(Number(event.target.value) / 100)}
          onPointerUp={(event) => void saveThreshold(Number(event.currentTarget.value) / 100)}
          onKeyUp={(event) => void saveThreshold(Number(event.currentTarget.value) / 100)}
        />
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {ai.isLoading ? <div className="skeleton" /> : null}
      {!ai.isLoading && decisions.length === 0 ? (
        <div className="empty">
          <h2>No Jev decisions yet</h2>
          <p>Run Jev to map cost codes, check production, and call the bid.</p>
        </div>
      ) : null}
      {decisions.length ? (
        <div className="ai-columns">
          <DecisionColumn title="Applied" empty="Nothing has been applied." decisions={applied} pending={pending} onAct={act} />
          <DecisionColumn title="Review queue" empty="Nothing is waiting." decisions={review} pending={pending} onAct={act} />
        </div>
      ) : null}
      {dismissed.length ? <p className="fine">{dismissed.length} dismissed.</p> : null}
    </section>
  );
}

function DecisionColumn({
  title,
  empty,
  decisions,
  pending,
  onAct,
}: {
  title: string;
  empty: string;
  decisions: AiDecision[];
  pending: boolean;
  onAct: (id: string, action: "accept" | "dismiss") => Promise<void>;
}) {
  return (
    <div>
      <h3 className="ai-column-title">{title}</h3>
      {decisions.length === 0 ? <p className="fine">{empty}</p> : null}
      <div className="decision-list">
        {decisions.map((decision) => (
          <article key={decision.id} className="decision-card">
            <header>
              <strong>{decision.title}</strong>
              <span className={decision.actor === "jev" ? "jev-chip" : "person-chip"}>
                {decision.actor === "jev" ? "AI" : "Person"}
              </span>
            </header>
            <p>{decision.summary}</p>
            <div className="confidence" aria-label={`${Math.round(decision.confidence * 100)} percent confidence`}>
              <i style={{ width: `${Math.round(decision.confidence * 100)}%` }} className={decision.status === "review" ? "is-low" : ""} />
            </div>
            <p className="fine" style={{ marginTop: 6 }}>
              {Math.round(decision.confidence * 100)}% confidence
              {decision.status === "accepted" ? " · accepted by you" : ""}
              {decision.status === "applied" ? " · applied" : ""}
            </p>
            {decision.status === "review" ? (
              <div className="row-actions">
                <button type="button" className="btn" disabled={pending} onClick={() => void onAct(decision.id, "accept")}>
                  Accept
                </button>
                <button type="button" className="text-button" disabled={pending} onClick={() => void onAct(decision.id, "dismiss")}>
                  Dismiss
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
