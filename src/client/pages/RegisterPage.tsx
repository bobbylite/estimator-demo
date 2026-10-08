import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, setCsrf } from "../api";
import { sessionCache, type PilotState } from "../session";
import { ThemeToggle } from "../theme";

interface Hints {
  registerUsername: string;
  registerEmail: string;
  registerPassword: string;
  verificationCode: string;
}

interface Config {
  mock: boolean;
  hints: Hints | null;
}

type RegisterView =
  | { step: "username_password"; loginId: string; canRegister?: boolean; message?: string }
  | { step: "verification"; loginId: string; email?: string; message?: string }
  | { step: "unsupported"; loginId: string; status: string; message: string }
  | {
      step: "authenticated";
      user: { id: string; username: string; name: string; email: string };
      csrfToken: string;
      mock: boolean;
      pilot: PilotState;
    };

interface Failure {
  message: string;
  kind?: string;
  requirements?: string[];
}

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api<Config>("/api/auth/config"),
  });
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [view, setView] = useState<RegisterView | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(true);

  const finish = useCallback(
    async (next: Extract<RegisterView, { step: "authenticated" }>) => {
      setCsrf(next.csrfToken);
      queryClient.setQueryData(["session"], sessionCache(next));
      await navigate({ to: "/estimates" });
    },
    [navigate, queryClient],
  );

  useEffect(() => {
    document.title = "Create account — Meridian";
  }, []);

  useEffect(() => {
    let active = true;
    void api<RegisterView>("/api/auth/login/start", { method: "POST" })
      .then((next) => {
        if (!active) return;
        if (next.step === "authenticated") {
          void finish(next);
          return;
        }
        setView(next);
      })
      .catch((reason: unknown) => {
        if (active) setFailure(readFailure(reason));
      })
      .finally(() => {
        if (active) setStarting(false);
      });
    return () => {
      active = false;
    };
  }, [finish]);

  const hints = config.data?.hints;
  const verifying = view?.step === "verification";
  const disabled = view?.step === "username_password" && view.canRegister === false;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!view || view.step === "unsupported" || view.step === "authenticated") return;
    if (view.step === "username_password" && view.canRegister === false) return;
    const loginId = view.loginId;
    const verifyingNow = view.step === "verification";
    setFailure(null);
    setNotice("");
    if (!verifyingNow && password !== confirm) {
      setFailure({ message: "Those passwords don’t match." });
      return;
    }
    setPending(true);
    try {
      const next = verifyingNow
        ? await api<RegisterView>("/api/auth/login/verify", {
            method: "POST",
            body: JSON.stringify({ loginId, verificationCode: code }),
          })
        : await api<RegisterView>("/api/auth/login/register", {
            method: "POST",
            body: JSON.stringify({ loginId, username, email, password }),
          });
      if (next.step === "authenticated") {
        await finish(next);
        return;
      }
      setView(next);
      if (next.step === "verification") setCode("");
    } catch (reason) {
      setFailure(readFailure(reason));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (view?.step !== "verification") return;
    setFailure(null);
    setNotice("");
    setPending(true);
    try {
      const next = await api<RegisterView>("/api/auth/login/resend", {
        method: "POST",
        body: JSON.stringify({ loginId: view.loginId }),
      });
      if (next.step === "authenticated") {
        await finish(next);
        return;
      }
      setView(next);
      setNotice(next.step === "verification" ? next.message ?? "A new code was sent." : "");
    } catch (reason) {
      setFailure(readFailure(reason));
    } finally {
      setPending(false);
    }
  }

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
          <p className="lede">Open a book of your own. The sample bid is copied into it, and nobody else can see it.</p>
        </div>
        <div className="tape">
          <div><span>Your population</span><b>PingOne registration</b></div>
          <div><span>Verify</span><b>8-character email code</b></div>
          <div><span>Then</span><b>signed in, your estimates</b></div>
          <div><span>Tokens</span><b>stay on the server</b></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <header>
            <span className="word">Meridian</span>
            <ThemeToggle />
          </header>
          <p className="kicker" style={{ color: "var(--muted)" }}>{verifying ? "Verify" : "Create account"}</p>
          <h2>{disabled ? "Registration is off" : verifying ? "Check your email" : "Join the bid book"}</h2>
          <p className="sub">
            {disabled
              ? "This PingOne application’s sign-on policy is not offering registration."
              : verifying
                ? view.message ?? "Enter the 8-character code PingOne emailed you. This page does not leave Meridian."
                : "Your password is posted to this app’s server. The browser never receives a token."}
          </p>
          {verifying && view.email ? <p className="fine">Sent to {view.email}</p> : null}
          {config.data?.mock && hints && !disabled ? (
            <div className="mock-note">
              <strong>Local mock</strong>
              <p>
                {verifying
                  ? `PingOne is not contacted. The verification code is ${hints.verificationCode}.`
                  : "PingOne is not contacted. The mock policy asks for 8 characters, a letter, and a number."}
              </p>
              {verifying ? (
                <div className="mock-actions" style={{ marginTop: 10 }}>
                  <button type="button" className="text-button" onClick={() => setCode(hints.verificationCode)}>
                    Fill code
                  </button>
                </div>
              ) : (
                <div className="mock-actions" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setUsername(hints.registerUsername);
                      setEmail(hints.registerEmail);
                      setPassword(hints.registerPassword);
                      setConfirm(hints.registerPassword);
                    }}
                  >
                    Sample account
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setUsername("new@meridian.test");
                      setEmail("new@meridian.test");
                      setPassword("short");
                      setConfirm("short");
                    }}
                  >
                    Weak password
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setUsername("robert@meridian.test");
                      setEmail("robert@meridian.test");
                      setPassword(hints.registerPassword);
                      setConfirm(hints.registerPassword);
                    }}
                  >
                    Taken username
                  </button>
                </div>
              )}
            </div>
          ) : null}
          {starting ? <p className="sub">Opening a sign-up session…</p> : null}
          {failure ? (
            <div className="error" role="alert">
              <p>{failure.kind === "taken" ? "That username or email is already registered. Sign in, or choose another." : failure.message}</p>
              {failure.kind === "password_policy" && failure.requirements?.length ? (
                <ul className="requirements">
                  {failure.requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {disabled ? (
            <div className="callout">
              <strong>Enable it in PingOne</strong>
              <p>
                Open the sign-on policy attached to the Meridian app, add the Registration action, choose the population
                new users join, and turn on email verification if you want this code step.
              </p>
            </div>
          ) : null}
          {notice ? <p className="notice" role="status">{notice}</p> : null}
          {!starting && view && !disabled && view.step !== "unsupported" ? (
            <form onSubmit={onSubmit} noValidate>
              {verifying ? (
                <label className="field">
                  <span>Verification code</span>
                  <input
                    name="verification-code"
                    inputMode="text"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </label>
              ) : (
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
                    <span>Email</span>
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <div className="password-row">
                      <input
                        name="new-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                      />
                      <button type="button" className="ghost-in" onClick={() => setShowPassword((value) => !value)}>
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                  <p className="fine">PingOne checks this against the population’s password policy. A rejection lists the requirements.</p>
                  <label className="field">
                    <span>Confirm password</span>
                    <input
                      name="confirm-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      required
                    />
                  </label>
                </>
              )}
              <button className="btn full" type="submit" disabled={pending} aria-busy={pending}>
                {pending ? "Checking…" : verifying ? "Verify and sign in" : "Create account"}
              </button>
              {verifying ? (
                <button type="button" className="text-button" style={{ marginTop: 10 }} onClick={() => void resend()} disabled={pending}>
                  Resend code
                </button>
              ) : null}
            </form>
          ) : null}
          {view?.step === "unsupported" ? <p className="error">{view.message}</p> : null}
          <p className="auth-switch">
            Already have an account? <Link to="/">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function readFailure(reason: unknown): Failure {
  if (reason instanceof ApiError) {
    return { message: reason.message, kind: reason.kind, requirements: reason.requirements };
  }
  if (reason instanceof Error) return { message: reason.message };
  return { message: "Sign-up failed." };
}
