import nodemailer from "nodemailer";
import { VERIFICATION_CODE_TTL_MINUTES } from "@/back_end/services/verification";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? "465");
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
const from = process.env.EMAIL_FROM ?? "ECHO 回响 <customerservice@echodigitalpersona.com>";
const customerServiceFrom = "ECHO Customer Service <customerservice@echodigitalpersona.com>";

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      // Port 465 is implicit TLS; 587 negotiates TLS via STARTTLS instead.
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPassword },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
  return cachedTransporter;
}

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(smtpHost && smtpUser && smtpPassword);
}

async function deliverEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<void> {
  if (!smtpHost || !smtpUser || !smtpPassword) {
    throw new Error("No email delivery provider is configured.");
  }

  // SMTP providers can occasionally close an idle connection or return a
  // transient transport failure. Retry once using a fresh transporter and
  // the same code. This keeps the original SMTP setup while avoiding a user
  // losing their registration attempt to a short-lived network hiccup.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await getTransporter().sendMail({
        from: replyTo ? customerServiceFrom : from,
        to,
        replyTo,
        subject,
        html,
        text,
      });
      return;
    } catch (error) {
      lastError = error;
      cachedTransporter = null;
      console.error(`SMTP delivery attempt ${attempt} failed`, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SMTP delivery failed.");
}

type ConfirmationEmailCopy = {
  heading: string;
  intro: string;
};

function confirmationEmailHtml(code: string, copy: ConfirmationEmailCopy): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:48px 20px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e0e0e0;border-radius:18px;">
          <tr><td style="padding:40px 32px;text-align:center;">
            <p style="margin:0;font-size:14px;font-weight:600;letter-spacing:.2px;">ECHO 回响</p>
            <h1 style="margin:24px 0 12px;font-size:34px;line-height:1.15;font-weight:600;letter-spacing:-.37px;">${copy.heading}</h1>
            <p style="margin:0;color:#333;font-size:17px;line-height:1.47;">${copy.intro}</p>
            <p style="margin:28px 0;font-size:32px;line-height:1;font-weight:600;letter-spacing:8px;">${code}</p>
            <p style="margin:0;color:#7a7a7a;font-size:14px;line-height:1.43;">This code expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes. If you didn't request it, you can safely ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendRegistrationConfirmationEmail(to: string, code: string): Promise<void> {
  if (!isEmailDeliveryConfigured()) {
    throw new Error("Email delivery is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD on the server.");
  }

  const html = confirmationEmailHtml(code, {
      heading: "Confirm your email",
      intro: "Use this code to finish creating your account.",
  });
  await deliverEmail({
    to,
    subject: "Confirm your ECHO 回响 account",
    html,
    text: `Your ECHO 回响 confirmation code is ${code}. It expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.`,
  });
}

export async function sendPasswordChangeConfirmationEmail(to: string, code: string): Promise<void> {
  if (!isEmailDeliveryConfigured()) {
    throw new Error("Email delivery is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD on the server.");
  }

  const html = confirmationEmailHtml(code, {
      heading: "Confirm your password change",
      intro: "Someone requested a change to your account password. Use this code to confirm it was you.",
  });
  await deliverEmail({
    to,
    subject: "Confirm your ECHO 回响 password change",
    html,
    text: `Your ECHO 回响 code to confirm a password change is ${code}. It expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

export async function sendFaqQuestionEmail({
  accountName,
  accountEmail,
  submittedName,
  question,
}: {
  accountName: string;
  accountEmail: string;
  submittedName: string;
  question: string;
}): Promise<void> {
  if (!isEmailDeliveryConfigured()) {
    throw new Error("Email delivery is not configured.");
  }

  const subject = `ECHO FAQ question from ${accountName}`;
  const text = [
    "New FAQ question",
    "",
    `Account name: ${accountName}`,
    `Account email: ${accountEmail}`,
    `Submitted name: ${submittedName}`,
    "",
    "Question:",
    question,
  ].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:32px;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Arial,sans-serif;"><main style="max-width:640px;margin:auto;background:#fff;border:1px solid #e0e0e0;border-radius:18px;padding:32px;"><p style="margin:0;font-weight:600;letter-spacing:.2px;">ECHO 回响</p><h1 style="margin:20px 0;font-size:28px;">New FAQ question</h1><p><strong>Account name:</strong> ${escapeHtml(accountName)}<br><strong>Account email:</strong> ${escapeHtml(accountEmail)}<br><strong>Submitted name:</strong> ${escapeHtml(submittedName)}</p><p style="white-space:pre-wrap;line-height:1.5;"><strong>Question</strong><br>${escapeHtml(question)}</p></main></body></html>`;

  await deliverEmail({ to: "customerservice@echodigitalpersona.com", replyTo: accountEmail, subject, text, html });
}
