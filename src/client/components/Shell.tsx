import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, setCsrf } from "../api";
import type { PilotState, SessionPayload } from "../session";
import { ThemeToggle } from "../theme";
import { Mark } from "./ui";

export function Shell({
  name,
  mock,
  pilot,
  children,
}: {
  name: string;
  mock: boolean;
  pilot?: PilotState;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setCsrf(null);
    queryClient.setQueryData(["session"], {
      user: null,
      csrfToken: null,
      mock,
      pilot: pilot ?? { gateEnabled: false, member: false, group: "" },
    });
    await navigate({ to: "/" });
  }

  async function setMembership(member: boolean) {
    if (!pilot || pilot.member === member) return;
    setPending(true);
    try {
      const next = await api<SessionPayload>("/api/auth/pilot", {
        method: "POST",
        body: JSON.stringify({ member }),
      });
      setCsrf(next.csrfToken);
      queryClient.setQueryData(["session"], next);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/estimates" className="brand">
          <Mark />
          Meridian
        </Link>
        <div className="top-actions">
          {mock ? <span className="mock-pill">Mock mode</span> : null}
          {mock && pilot ? (
            <div className="pilot-toggle" role="group" aria-label="Mock pilot membership">
              <button type="button" aria-pressed={pilot.member} disabled={pending} onClick={() => void setMembership(true)}>
                In group
              </button>
              <button type="button" aria-pressed={!pilot.member} disabled={pending} onClick={() => void setMembership(false)}>
                Outside
              </button>
            </div>
          ) : null}
          <ThemeToggle />
          <div className="userbox">
            <span>{name}</span>
            <button type="button" className="text-button" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
