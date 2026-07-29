"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VerificationCodeInput } from "@/front_end/components/auth/VerificationCodeInput";
import { Button, Input, Modal } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { useModalController } from "@/front_end/state/modal-context";
import { emailFormatError, passwordFormatError } from "@/shared/validation";
import type { CheckAvailabilityResponseBody } from "@/back_end/api/auth/check-availability/route";
import type { LoginResponseBody } from "@/back_end/api/auth/login/route";
import type { RegisterResponseBody } from "@/back_end/api/auth/register/route";
import type { ResendCodeResponseBody } from "@/back_end/api/auth/resend-code/route";
import type { VerifyEmailResponseBody } from "@/back_end/api/auth/verify-email/route";

// Small, right-aligned red validation feedback for field-level checks.
const fieldErrorClass = "mt-xxs text-right font-text text-[11px] text-red-500";

type InlineFeedback = { kind: "success" | "error"; message: string };

// Live, on-blur check — a lighter-weight sibling to the authoritative
// existingUsername/existingEmail recheck register/route.ts does at submit
// time. Blur (not every keystroke) so this doesn't hammer the DB while
// someone's mid-type. This is advisory only, so a network failure resolves
// as "available" (silently) rather than leaving an unhandled rejection or
// blocking the form — register/route.ts is the real gate at submit time.
async function checkFieldAvailability(
  field: "username" | "email",
  value: string,
): Promise<CheckAvailabilityResponseBody> {
  try {
    const response = await fetch("/api/auth/check-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    return (await response.json()) as CheckAvailabilityResponseBody;
  } catch {
    return { available: true };
  }
}

type AuthStep = "form" | "verify";

export function AuthModal() {
  const { activeModal, authTab, setAuthTab, closeModal } = useModalController();
  const { refresh } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<AuthStep>("form");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingUsername, setPendingUsername] = useState("");
  const [cancellationToken, setCancellationToken] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [resendMessage, setResendMessage] = useState<InlineFeedback | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const open = activeModal === "auth";
  const resendCooldown = useMemo(() => {
    if (!resendAvailableAt || now === null) return 0;
    return Math.max(0, Math.ceil((new Date(resendAvailableAt).getTime() - now) / 1000));
  }, [now, resendAvailableAt]);

  useEffect(() => {
    if (!resendAvailableAt || resendCooldown === 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [resendAvailableAt, resendCooldown]);

  async function handleUsernameBlur() {
    if (!username) return;
    const result = await checkFieldAvailability("username", username);
    setErrors((current) => ({ ...current, username: result.available ? "" : result.error }));
  }

  async function handleEmailBlur() {
    if (!email) return;
    // Format is checked client-side first so an obviously-malformed address
    // doesn't cost a round trip — the server re-validates format too, since
    // check-availability can be called directly.
    const formatError = emailFormatError(email);
    if (formatError) {
      setErrors((current) => ({ ...current, email: formatError }));
      return;
    }
    const result = await checkFieldAvailability("email", email);
    setErrors((current) => ({ ...current, email: result.available ? "" : result.error }));
  }

  function resetLocalState() {
    setStep("form");
    setIdentifier("");
    setUsername("");
    setEmail("");
    setPassword("");
    setPendingEmail("");
    setPendingUsername("");
    setCancellationToken("");
    setResendAvailableAt(null);
    setErrors({});
    setSubmitting(false);
    setResendMessage(null);
  }

  function cancelPendingRegistration(keepalive = false) {
    if (!pendingEmail || !pendingUsername || !cancellationToken) return;
    const body = JSON.stringify({ email: pendingEmail, username: pendingUsername, cancellationToken });
    void fetch("/api/auth/cancel-registration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive,
    }).catch(() => undefined);
  }

  useEffect(() => {
    if (step !== "verify" || !pendingEmail || !pendingUsername || !cancellationToken) return;
    const cancelOnPageHide = () => {
      const body = JSON.stringify({ email: pendingEmail, username: pendingUsername, cancellationToken });
      navigator.sendBeacon("/api/auth/cancel-registration", body);
    };
    window.addEventListener("pagehide", cancelOnPageHide);
    return () => window.removeEventListener("pagehide", cancelOnPageHide);
  }, [step, pendingEmail, pendingUsername, cancellationToken]);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  function handleClose() {
    if (step === "verify") cancelPendingRegistration(true);
    closeModal();
    // Keep the auth component mounted while Modal's AnimatePresence plays its
    // exit transition. Reset only after the panel and scrim have faded out.
    resetTimerRef.current = window.setTimeout(resetLocalState, 300);
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const result = (await response.json()) as LoginResponseBody;
      if (!result.ok) {
        setErrors({ form: result.error });
        return;
      }
      await refresh();
      handleClose();
      router.replace("/dashboard");
    } catch {
      setErrors({ form: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    const passwordError = passwordFormatError(password);
    if (passwordError) {
      setErrors({ password: passwordError });
      return;
    }
    setSubmitting(true);
    setErrors({});
    setResendMessage(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      const result = (await response.json()) as RegisterResponseBody;
      if (!result.ok) {
        setErrors(result.errors);
        if (result.retryAfterSeconds) {
          setResendAvailableAt(new Date(Date.now() + result.retryAfterSeconds * 1_000).toISOString());
        }
        return;
      }
      setPendingEmail(result.email);
      setPendingUsername(result.username);
      setCancellationToken(result.cancellationToken);
      setResendAvailableAt(result.resendAvailableAt);
      setNow(Date.now());
      setStep("verify");
    } catch {
      setErrors({ form: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(code: string) {
    if (!pendingEmail) return;
    setSubmitting(true);
    setErrors({});
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      const result = (await response.json()) as VerifyEmailResponseBody;
      if (!result.ok) {
        setErrors({ code: result.error });
        return;
      }
      await refresh();
      handleClose();
      router.replace("/dashboard");
    } catch {
      setErrors({ code: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!pendingEmail || resendCooldown > 0) return;
    setResendMessage(null);
    try {
      const response = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, cancellationToken }),
      });
      const result = (await response.json()) as ResendCodeResponseBody;
      if (!result.ok) {
        setResendMessage({ kind: "error", message: result.error });
        if (result.retryAfterSeconds) {
          setResendAvailableAt(new Date(Date.now() + result.retryAfterSeconds * 1_000).toISOString());
          setNow(Date.now());
        }
        return;
      }
      setResendAvailableAt(result.resendAvailableAt);
      setNow(Date.now());
      setResendMessage({ kind: "success", message: "A new confirmation code is on its way." });
    } catch {
      setResendMessage({ kind: "error", message: "Couldn't reach the server." });
    }
  }

  if (step === "verify") {
    return (
      <Modal open={open} onClose={submitting ? () => undefined : handleClose} maxWidthClassName="max-w-[32rem]">
        <div className="text-center">
          <p className="font-text text-caption-strong text-ink-muted-48">ECHO 回响</p>
          <h2 className="mt-xs font-display text-display-md text-ink">Confirm your email</h2>
          <p className="mx-auto mt-xs max-w-[24rem] font-text text-body text-ink-muted-80">
            Enter the six-character code we sent to <span className="font-semibold text-ink">{pendingEmail}</span>.
          </p>
        </div>

        <div className="mt-xl">
          <VerificationCodeInput onComplete={handleVerify} disabled={submitting} hasError={Boolean(errors.code)} />
        </div>

        {errors.code && (
          <p role="alert" className="mt-sm text-center font-text text-caption text-red-500">{errors.code}</p>
        )}

        <div className="mt-xl flex flex-col items-center gap-xs text-center">
          <button
            onClick={handleResend}
            disabled={resendCooldown > 0 || submitting}
            className="font-text text-caption text-primary transition-transform duration-150 ease-out active:scale-95 disabled:text-ink-muted-48"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Send a new code"}
          </button>
          <p
            aria-live="polite"
            className={`min-h-4 font-text text-fine-print ${
              resendMessage?.kind === "error" ? "text-red-500" : "text-ink-muted-48"
            }`}
          >
            {resendMessage?.message}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={submitting ? () => undefined : handleClose}>
      {authTab === "login" ? (
        <>
          <h2 className="font-display text-tagline text-ink">Log in to continue</h2>
          <form onSubmit={handleLogin} className="mt-lg flex flex-col gap-sm">
            <Input placeholder="Email or username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
            <Input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {errors.form && <p role="alert" className="font-text text-caption text-red-500">{errors.form}</p>}
            <Button type="submit" variant="primary" disabled={submitting}>{submitting ? "Logging in…" : "Log in"}</Button>
          </form>
          <button onClick={() => { setAuthTab("register"); setErrors({}); }} className="mt-sm font-text text-caption text-primary transition-transform duration-150 ease-out active:scale-95">
            Register now
          </button>
        </>
      ) : (
        <>
          <h2 className="font-display text-tagline text-ink">Create your account</h2>
          <form onSubmit={handleRegister} className="mt-lg flex flex-col gap-sm">
            <div>
              <Input
                placeholder="Username"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setErrors((current) => ({ ...current, username: "" }));
                }}
                onBlur={handleUsernameBlur}
                required
              />
              {errors.username && <p role="alert" className={fieldErrorClass}>{errors.username}</p>}
            </div>
            <div>
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setErrors((current) => ({ ...current, email: "" }));
                }}
                onBlur={handleEmailBlur}
                required
              />
              {errors.email && <p role="alert" className={fieldErrorClass}>{errors.email}</p>}
            </div>
            <div>
              <Input
                type="password"
                placeholder="Password"
                minLength={8}
                value={password}
                onChange={(event) => {
                  const value = event.target.value;
                  setPassword(value);
                  setErrors((current) => ({ ...current, password: passwordFormatError(value) ?? "" }));
                }}
                required
              />
              {errors.password && <p role="alert" className="mt-xxs font-text text-caption text-red-500">{errors.password}</p>}
            </div>
            {errors.form && <p role="alert" className="font-text text-caption text-red-500">{errors.form}</p>}
            <Button type="submit" variant="primary" disabled={submitting}>{submitting ? "Sending code…" : "Continue"}</Button>
          </form>
          <button onClick={() => { setAuthTab("login"); setErrors({}); }} className="mt-sm font-text text-caption text-primary transition-transform duration-150 ease-out active:scale-95">
            Already have an account? Log in
          </button>
        </>
      )}
    </Modal>
  );
}
