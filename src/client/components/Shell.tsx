import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, setCsrf } from "../api";
import { ThemeToggle } from "../theme";
import { Mark } from "./ui";

export function Shell({
  name,
  mock,
  children,
}: {
  name: string;
  mock: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setCsrf(null);
    queryClient.setQueryData(["session"], { user: null, csrfToken: null, mock });
    await navigate({ to: "/" });
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
