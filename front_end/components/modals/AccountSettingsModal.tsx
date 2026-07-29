"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ThemeSlider } from "@/front_end/components/account/ThemeSlider";
import { UserAvatar } from "@/front_end/components/account/UserAvatar";
import { VerificationCodeInput } from "@/front_end/components/auth/VerificationCodeInput";
import { Button, Input, Modal } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { useLocale } from "@/front_end/state/locale-context";
import { useModalController } from "@/front_end/state/modal-context";

type Feedback = { kind: "success" | "error" | "limit"; message: string };

const MAX_PROFILE_IMAGE_SIZE_BYTES = 1 * 1024 * 1024;
const ALLOWED_PROFILE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  // The rate-limit warning stays compact and right-aligned, while all other
  // errors use the same red treatment as the rest of the site.
  if (feedback.kind === "limit") {
    return <p role="alert" className="text-right font-text text-[11px] text-red-500">{feedback.message}</p>;
  }
  return (
    <p
      className={`font-text text-caption ${
        feedback.kind === "success" ? "text-ink-muted-80" : "text-red-500"
      }`}
    >
      {feedback.message}
    </p>
  );
}

// Same two-step shape as AuthModal's register flow: submitting the form
// stages the new password server-side and emails a code (instead of
// applying it immediately); the code has to be confirmed before
// User.passwordHash actually changes.
function ChangePasswordSection() {
  const [step, setStep] = useState<"form" | "verify">("form");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [resendMessage, setResendMessage] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resendCooldown = useMemo(() => {
    if (!resendAvailableAt || now === null) return 0;
    return Math.max(0, Math.ceil((new Date(resendAvailableAt).getTime() - now) / 1000));
  }, [now, resendAvailableAt]);

  useEffect(() => {
    if (!resendAvailableAt || resendCooldown === 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [resendAvailableAt, resendCooldown]);

  function resetToForm() {
    setStep("form");
    setCurrentPassword("");
    setNewPassword("");
    setCodeError(null);
    setResendAvailableAt(null);
    setResendMessage(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.error });
        return;
      }
      setResendAvailableAt(result.resendAvailableAt);
      setNow(Date.now());
      setStep("verify");
    } catch {
      setFeedback({ kind: "error", message: "Couldn't reach the server." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(code: string) {
    setSubmitting(true);
    setCodeError(null);
    try {
      const response = await fetch("/api/account/password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await response.json();
      if (!result.ok) {
        setCodeError(result.error);
        return;
      }
      resetToForm();
      setFeedback({ kind: "success", message: "Password changed." });
    } catch {
      setCodeError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setResendMessage(null);
    try {
      const response = await fetch("/api/account/password/resend", { method: "POST" });
      const result = await response.json();
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
      <div className="flex flex-col gap-sm">
        <p className="font-text text-body-strong text-ink">Confirm your password change</p>
        <p className="font-text text-caption text-ink-muted-80">
          Enter the six-character code we emailed you to confirm this change.
        </p>

        <div className="mt-xs">
          <VerificationCodeInput onComplete={handleVerify} disabled={submitting} hasError={Boolean(codeError)} />
        </div>

        {codeError && (
          <p role="alert" className="text-center font-text text-caption text-red-500">{codeError}</p>
        )}

        <div className="flex flex-col items-center gap-xs text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || submitting}
            className="font-text text-caption text-primary transition-transform duration-150 ease-out active:scale-95 disabled:text-ink-muted-48"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Send a new code"}
          </button>
          {resendMessage && (
            <p
              aria-live="polite"
              className={`font-text text-fine-print ${
                resendMessage.kind === "error" ? "text-red-500" : "text-ink-muted-48"
              }`}
            >
              {resendMessage.message}
            </p>
          )}
          <button
            type="button"
            onClick={resetToForm}
            className="font-text text-fine-print text-ink-muted-48 transition-transform duration-150 ease-out active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm">
      <p className="font-text text-body-strong text-ink">Change password</p>
      <Input
        type="password"
        placeholder="Current password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        required
      />
      <Input
        type="password"
        placeholder="New password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        required
      />
      <FeedbackLine feedback={feedback} />
      <Button type="submit" variant="secondary" disabled={submitting} className="self-start">
        {submitting ? "Sending code…" : "Update password"}
      </Button>
    </form>
  );
}

function ProfilePictureSection({ username, profileImageUrl }: { username: string; profileImageUrl: string | null }) {
  const { refresh } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;

    if (!ALLOWED_PROFILE_IMAGE_TYPES.has(selected.type)) {
      setFile(null);
      setPreview(null);
      setFeedback({ kind: "error", message: "Choose a PNG, JPG, or JPEG image." });
      event.target.value = "";
      return;
    }
    if (selected.size > MAX_PROFILE_IMAGE_SIZE_BYTES) {
      setFile(null);
      setPreview(null);
      setFeedback({ kind: "error", message: "Profile picture must be 1MB or smaller." });
      event.target.value = "";
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setFeedback(null);
  }

  async function handleSave() {
    if (!file) return;
    setFeedback(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/account/profile-picture", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.error });
        return;
      }
      // Refreshes user.profileImageUrl app-wide (dock avatar included) —
      // UserAvatar re-fetches its signed URL whenever that path changes, so
      // both this section and the dock pick up the new picture without a
      // page reload.
      await refresh();
      setFile(null);
      setPreview(null);
      setFeedback({ kind: "success", message: "Profile picture updated." });
    } catch {
      setFeedback({ kind: "error", message: "Couldn't reach the server." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-sm">
      <p className="font-text text-body-strong text-ink">Profile picture</p>
      <div className="flex items-center gap-sm">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-surface-chip-translucent">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote/optimizable image
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserAvatar username={username} profileImageUrl={profileImageUrl} className="h-16 w-16 text-body-strong" />
          )}
        </div>
        <div className="flex flex-col gap-xs">
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            Choose image
          </Button>
          {file && (
            <Button variant="primary" onClick={handleSave} disabled={submitting}>
              {submitting ? "Uploading…" : "Save"}
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      <FeedbackLine feedback={feedback} />
    </div>
  );
}

function ChangeUsernameSection({ currentUsername }: { currentUsername: string }) {
  const { refresh } = useAuth();
  const [username, setUsername] = useState(currentUsername);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/account/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const result = await response.json();
      if (!result.ok) {
        setFeedback({ kind: result.rateLimited ? "limit" : "error", message: result.error });
        return;
      }
      await refresh();
      setFeedback({ kind: "success", message: "Username updated." });
    } catch {
      setFeedback({ kind: "error", message: "Couldn't reach the server." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm">
      <p className="font-text text-body-strong text-ink">Change username</p>
      <Input value={username} onChange={(event) => setUsername(event.target.value)} required />
      <FeedbackLine feedback={feedback} />
      <Button type="submit" variant="secondary" disabled={submitting} className="self-start">
        {submitting ? "Saving…" : "Update username"}
      </Button>
    </form>
  );
}

// Purchases are one-time (see /api/billing/subscribe) — no auto-renewal, so
// there's nothing to "cancel". This reports the access expiry date; once
// that date passes, hasPaidAccess() (lib/limits.ts) stops granting paid
// access on its own and this reverts to showing free access —
// no separate action needed here, and nothing about previously-uploaded
// paid-only persona data is deleted when that happens.
function SubscriptionSection() {
  const { user } = useAuth();
  const { locale } = useLocale();
  const subscription = user?.subscription;
  const isFree = !subscription || subscription.status === "none";

  const expiryLabel = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-sm">
      <p className="font-text text-body-strong text-ink">Subscription</p>
      {isFree && <p className="font-text text-body text-ink">{locale === "zh" ? "免费使用" : "Free access"}</p>}
      {!isFree && expiryLabel && (
        <p className="font-text text-fine-print text-ink-muted-48">
          {locale === "zh" ? "截止日期：" : "Expiry date: "}{expiryLabel}
        </p>
      )}
    </div>
  );
}

function AppearanceSection() {
  return (
    <div className="flex flex-col gap-sm">
      <p className="font-text text-body-strong text-ink">Appearance</p>
      <ThemeSlider />
    </div>
  );
}

function LogOutSection() {
  const { logout } = useAuth();
  const { closeModal } = useModalController();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    closeModal();
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
      router.replace("/");
      return;
    }
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={handleLogout} className="self-start">
      Log out
    </Button>
  );
}

export function AccountSettingsModal() {
  const { activeModal, closeModal } = useModalController();
  const { user } = useAuth();

  if (!user) {
    return (
      <Modal open={activeModal === "account-settings"} onClose={closeModal}>
        <h2 className="font-display text-tagline text-ink">Account settings</h2>
        <p className="mt-xs font-text text-body text-ink-muted-80">You&apos;re not logged in.</p>
      </Modal>
    );
  }

  return (
    <Modal
      open={activeModal === "account-settings"}
      onClose={closeModal}
      maxWidthClassName="max-w-[32rem]"
      className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden"
    >
      <h2 className="flex-shrink-0 font-display text-tagline text-ink">Account settings</h2>

      <div className="mt-lg min-h-0 flex-1 overflow-y-auto overscroll-contain pr-xs">
        <div className="flex flex-col gap-lg">
          <ProfilePictureSection username={user.username} profileImageUrl={user.profileImageUrl} />
          <ChangeUsernameSection currentUsername={user.username} />
          <ChangePasswordSection />
          <SubscriptionSection />
          <AppearanceSection />
          <LogOutSection />
        </div>
      </div>
    </Modal>
  );
}
