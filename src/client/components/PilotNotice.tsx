import type { PilotState } from "../session";

export function PilotNotice({ pilot }: { pilot?: PilotState }) {
  if (!pilot?.gateEnabled) return null;
  const inGroup = pilot.member;
  return (
    <section className={inGroup ? "pilot-banner is-in" : "pilot-banner is-out"} aria-label="AI pilot">
      <p className="kicker">{inGroup ? "Jev" : "Private pilot"}</p>
      <h2>{inGroup ? "You're in the AI pilot" : "AI is in a private pilot"}</h2>
      <p>
        {inGroup
          ? `This session can use Jev on the estimate. People outside ${pilot.group} still price the bid by hand.`
          : `Estimating stays open. Jev suggestions are limited to the ${pilot.group} group.`}
      </p>
    </section>
  );
}
