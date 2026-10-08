import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, setCsrf, type PingOneErrorBody } from "../api";
import { ThemeToggle } from "../theme";

interface Hints {
  username: string;
  password: string;
  mfaPassword: string;
  otp: string;
}

interface Config {
  mock: boolean;
  hints: Hints | null;
}

interface Device {
  id: string;
  type: string;
  label: string;
}

type LoginView =
  | { step: "username_password"; loginId: string; username?: string; message?: string }
  | { step: "otp"; loginId: string; devices: Device[]; selectedDeviceId?: string; message?: string }
  | { step: "device_select"; loginId: string; devices: Device[]; message?: string }
  | { step: "push"; loginId: string; devices: Device[]; selectedDeviceId?: string; message?: string }
  | { step: "unsupported"; loginId: string; status: string; message: string }
  | { step: "authenticated"; user: { id: string; username: string; name: string; email: string }; csrfToken: string; mock: boolean };

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api<Config>("/api/auth/config"),
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [view, setView] = useState<LoginView | null>(null);
  const [failure, setFailure] = useState<{ message: string; pingone?: PingOneErrorBody } | null>(null);
  const [pending, setPending] = useState(false);

  const finish = useCallback(
    async (next: Extract<LoginView, { step: "authenticated" }>) => {
      setCsrf(next.csrfToken);
      queryClient.setQueryData(["session"], {
        user: next.user,
        csrfToken: next.csrfToken,
        mock: next.mock,
      });
      await navigate({ to: "/estimates" });
    },
    [navigate, queryClient],
  );

  useEffect(() => {
    document.title = "Sign in — Meridian";
  }, []);

  useEffect(() => {
    if (view?.step !== "push") return;
    const loginId = view.loginId;
    const timer = window.setInterval(() => {
      void api<LoginView>("/api/auth/login/continue", {
        method: "POST",
        body: JSON.stringify({ loginId }),
      })
        .then((next) => {
          if (next.step === "authenticated") void finish(next);
          else setView(next);
        })
        .catch((reason: unknown) => setFailure(readFailure(reason)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [finish, view]);

  async function apply(next: LoginView) {
    if (next.step === "authenticated") {
      await finish(next);
      return;
    }
    setView(next);
    if (next.step === "device_select" && next.devices[0]) setDeviceId(next.devices[0].id);
    if (next.step === "otp") setOtp("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setPending(true);
    try {
      if (!view || view.step === "username_password") {
        const started = await api<LoginView>("/api/auth/login/start", { method: "POST" });
        if (started.step === "authenticated") {
          await finish(started);
          return;
        }
        if (started.step !== "username_password") {
          await apply(started);
          return;
        }
        const next = await api<LoginView>("/api/auth/login/password", {
          method: "POST",
          body: JSON.stringify({ loginId: started.loginId, username, password }),
        });
        await apply(next);
        return;
      }
      if (view.step === "otp") {
        const next = await api<LoginView>("/api/auth/login/otp", {
          method: "POST",
          body: JSON.stringify({ loginId: view.loginId, otp }),
        });
        await apply(next);
        return;
      }
      if (view.step === "device_select") {
        const next = await api<LoginView>("/api/auth/login/device", {
          method: "POST",
          body: JSON.stringify({ loginId: view.loginId, deviceId }),
        });
        await apply(next);
      }
    } catch (reason) {
      setFailure(readFailure(reason));
    } finally {
      setPending(false);
    }
  }

  const hints = config.data?.hints;

  return (
    <main className="login-stage" id="main">
      <section className="login-canvas" aria-hidden="false">
        <svg className="contours" viewBox="0 0 600 600" aria-hidden="true">
          <path d="M20 80 C 140 40, 220 160, 360 90 S 560 40, 600 120" />
          <path d="M0 160 C 120 120, 240 240, 380 170 S 560 120, 620 210" />
          <path d="M10 250 C 150 200, 250 320, 400 250 S 560 220, 640 300" />
          <path d="M0 340 C 160 290, 260 420, 420 340 S 560 310, 640 390" />
          <path d="M20 430 C 170 380, 280 510, 440 430 S 580 400, 640 480" />
        </svg>
        <div>
          <p className="kicker">Field book · Heavy civil</p>
          <h1>
            Meri
            <em>dian</em>
          </h1>
          <p className="lede">Bid the work the way the field will build it. Crews, production, and markup in one book.</p>
        </div>
        <div className="tape">
          <div><span>0200 Unclassified excavation</span><b>52,400 CY</b></div>
          <div><span>0410 HMAC pavement</span><b>48,200 SY</b></div>
          <div><span>Direct cost</span><b>labor · iron · material</b></div>
          <div><span>Bid</span><b>overhead + profit + bond</b></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <header>
            <span className="word">Meridian</span>
            <ThemeToggle />
          </header>
          <p className="kicker" style={{ color: "var(--muted)" }}>Sign in</p>
          <h2>{view?.step === "otp" ? "Check your device" : view?.step === "device_select" ? "Choose a device" : view?.step === "push" ? "Confirm sign-in" : "Welcome back"}</h2>
          <p className="sub">
            {view?.step === "otp"
              ? view.message ?? "Enter the one-time code PingOne sent."
              : view?.step === "push"
                ? view.message ?? "Approve the prompt, and this page will continue."
                : "Your password is posted to this app’s server. The browser never receives a token."}
          </p>
          {config.data?.mock && hints && !view ? (
            <div className="mock-note">
              <strong>Local mock</strong>
              <p>PingOne is not contacted. Use the demo account, or walk the MFA step.</p>
              <div className="mock-actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setUsername(hints.username);
                    setPassword(hints.password);
                  }}
                >
                  Demo account
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setUsername(hints.username);
                    setPassword(hints.mfaPassword);
                  }}
                >
                  MFA walkthrough
                </button>
              </div>
            </div>
          ) : null}
          <form onSubmit={onSubmit} noValidate>
            {failure ? (
              <div className="error" role="alert">
                <p>{failure.message}</p>
                {failure.pingone ? <PingOneFaultView fault={failure.pingone} /> : null}
              </div>
            ) : null}
            {!view || view.step === "username_password" ? (
              <>
                <label className="field">
                  <span>Username</span>
                  <input
                    name="username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <div className="password-row">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button type="button" className="ghost-in" onClick={() => setShowPassword((value) => !value)}>
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
              </>
            ) : null}
            {view?.step === "otp" ? (
              <>
                {view.devices.length ? <p className="sub">{view.devices.map((device) => device.label).join(" · ")}</p> : null}
                <label className="field">
                  <span>One-time code</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                    required
                  />
                </label>
                {config.data?.mock && hints ? <p className="fine">Mock code {hints.otp}</p> : null}
              </>
            ) : null}
            {view?.step === "device_select" ? (
              <div className="devices" role="radiogroup" aria-label="Devices">
                {view.devices.map((device) => (
                  <label className="device" key={device.id}>
                    <input
                      type="radio"
                      name="device"
                      value={device.id}
                      checked={deviceId === device.id}
                      onChange={() => setDeviceId(device.id)}
                    />
                    <span>
                      {device.label}
                      <br />
                      <small>{device.type}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            {view?.step === "unsupported" ? <p className="error">{view.message}</p> : null}
            {view?.step === "push" ? <p className="sub">Waiting for the device…</p> : null}
            {view?.step !== "push" && view?.step !== "unsupported" ? (
              <button className="btn full" type="submit" disabled={pending} aria-busy={pending}>
                {pending ? "Checking…" : view?.step === "otp" || view?.step === "device_select" ? "Continue" : "Sign in"}
              </button>
            ) : null}
            {view ? (
              <button
                type="button"
                className="text-button"
                style={{ marginTop: 10 }}
                onClick={() => {
                  setView(null);
                  setFailure(null);
                  setOtp("");
                }}
              >
                Start over
              </button>
            ) : null}
          </form>
          <p className="fine">Session cookie is httpOnly. Sign-out, expiry, and refresh stay on the server.</p>
        </div>
      </section>
    </main>
  );
}

function readFailure(reason: unknown): { message: string; pingone?: PingOneErrorBody } {
  if (reason instanceof ApiError) return { message: reason.message, pingone: reason.pingone };
  if (reason instanceof Error) return { message: reason.message };
  return { message: "Sign-in failed." };
}

function PingOneFaultView({ fault }: { fault: PingOneErrorBody }) {
  const rows: Array<[string, string]> = [];
  if (fault.code) rows.push(["code", fault.code]);
  if (fault.message && fault.message !== fault.details?.[0]?.message) rows.push(["message", fault.message]);
  if (fault.target) rows.push(["target", fault.target]);
  for (const detail of fault.details ?? []) {
    const label = detail.target ? `${detail.code ?? "detail"} · ${detail.target}` : (detail.code ?? "detail");
    if (detail.message) rows.push([label, detail.message]);
  }
  if (fault.id) rows.push(["id", fault.id]);
  if (fault.correlationId) rows.push(["correlationId", fault.correlationId]);
  if (fault.requestId) rows.push(["requestId", fault.requestId]);
  if (typeof fault.status === "number") rows.push(["http", String(fault.status)]);
  if (!rows.length) return null;
  return (
    <dl className="fault">
      {rows.map(([label, value], index) => (
        <div key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
