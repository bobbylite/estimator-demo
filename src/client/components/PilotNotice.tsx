import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PilotState } from "../session";

export function useAiResting(signedIn: boolean) {
  return useQuery({
    queryKey: ["ai-status"],
    enabled: signedIn,
    queryFn: () => api<{ resting: boolean }>("/api/ai/status"),
    staleTime: 30_000,
  });
}

export function PilotNotice({ pilot, resting }: { pilot?: PilotState; resting?: boolean }) {
  const blocked = Boolean(pilot?.gateEnabled && !pilot.member);
  if (resting && !blocked) {
    return (
      <section className="pilot-banner is-out" aria-label="AI resting">
        <p className="kicker">Jev</p>
        <h2>AI is resting for today</h2>
        <p>Today&apos;s shared budget is used up. Estimating stays open. Jev starts again at the next UTC day.</p>
      </section>
    );
  }
  if (!pilot?.gateEnabled) return null;
  const inGroup = pilot.member;
  return (
    <section className={inGroup ? "pilot-banner is-in" : "pilot-banner is-out"} aria-label="AI pilot">
      <p className="kicker">{inGroup ? "Jev" : "Private pilot"}</p>
      <h2>{inGroup ? "You're in the AI pilot" : "AI is in a private pilot"}</h2>
      <p>
        {inGroup
          ? `This session can use AI on the estimate. People outside ${pilot.group} still price the bid by hand.`
          : `Estimating stays open. AI suggestions are limited to the ${pilot.group} group.`}
      </p>
    </section>
  );
}
