"use client";

import { FormEvent, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/front_end/components/ui";
import { useAuth } from "@/front_end/state/auth-context";
import { useModalController } from "@/front_end/state/modal-context";

const questions = [
  {
    question: "What is ECHO 回响?",
    answer: "ECHO 回响 is a space to collect the memories, voice, and context that help make a persona feel personal. You choose what to add and can update it over time.",
  },
  {
    question: "Who can see my personas and uploads?",
    answer: "Your personas, conversations, and uploaded materials are tied to your own account. They are not shown to other accounts.",
  },
  {
    question: "What can I upload to a persona?",
    answer: "You can add supported documents, photos, audio, video, and account links. Some media features and higher limits require an active subscription.",
  },
  {
    question: "Can I change or delete files later?",
    answer: "Yes. Open the persona menu from your dashboard to review uploads, sort them, add more, or permanently delete individual files.",
  },
  {
    question: "How do subscriptions work?",
    answer: "An active subscription unlocks additional persona capacity and media tools. Your current access is shown in Account Settings.",
  },
  {
    question: "How do I get help with my account?",
    answer: "Use the form below while signed in. The support team receives your account details with the question so they can help efficiently.",
  },
];

export default function FaqPage() {
  const { isAuthenticated, user } = useAuth();
  const { openModal } = useModalController();
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    if (!isAuthenticated) {
      setStatus("Please log in or register before sending a question.");
      openModal("auth", { authTab: "login" });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/faq/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, question }),
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!result.ok) {
        setStatus(result.error ?? "We couldn't send your question. Please try again shortly.");
        return;
      }
      setName("");
      setQuestion("");
      setStatus("Thank you — your question has been sent to our support team.");
    } catch {
      setStatus("We couldn't send your question. Please try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-lg pb-section pt-[10.5rem] sm:px-xl">
      <p className="font-text text-caption-strong text-primary">Support</p>
      <h1 className="mt-xs font-display text-hero-display text-ink">Frequently asked questions.</h1>
      <p className="mt-md max-w-2xl font-text text-lead-airy text-ink-muted-80">
        A few clear answers about ECHO 回响, your account, and your personas.
      </p>

      <section className="mt-xxl divide-y divide-hairline border-y border-hairline">
        {questions.map((item) => {
          const isOpen = openQuestion === item.question;
          return (
          <article key={item.question} className="py-lg">
            <button type="button" onClick={() => setOpenQuestion(isOpen ? null : item.question)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-lg text-left font-display text-body-strong text-ink">
              {item.question}
              <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-hairline text-primary transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`} aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1.75V10.25M1.75 6H10.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="max-w-2xl pt-md font-text text-body text-ink-muted-80">{item.answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </article>
          );
        })}
      </section>

      <section className="mt-section rounded-lg border border-hairline bg-canvas-parchment p-lg sm:p-xl">
        <p className="font-text text-caption-strong text-primary">Further Questions?</p>
        <h2 className="mt-xs font-display text-display-md text-ink">We&apos;re here to help.</h2>
        <p className="mt-sm max-w-2xl font-text text-body text-ink-muted-80">
          {isAuthenticated && user ? `Send a note as ${user.username}, and our support team will review it.` : "You can write a question now. Please log in or register before submitting it."}
        </p>
        <form className="mt-xl flex max-w-2xl flex-col gap-md" onSubmit={submit}>
          <label className="flex flex-col gap-xs font-text text-caption-strong text-ink">
            Your name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} required className="rounded-md border border-hairline bg-canvas px-sm py-xs font-text text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-focus/30" placeholder="Up to 50 characters" />
          </label>
          <label className="flex flex-col gap-xs font-text text-caption-strong text-ink">
            Your question
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} required rows={5} className="resize-y rounded-md border border-hairline bg-canvas px-sm py-xs font-text text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-focus/30" placeholder="Up to 500 characters" />
          </label>
          {status && <p role="status" className={`font-text text-caption ${status.startsWith("Thank") ? "text-primary" : "text-red-500"}`}>{status}</p>}
          <div><Button type="submit" variant="primary" disabled={submitting}>{submitting ? "Sending…" : "Send question"}</Button></div>
        </form>
      </section>
    </main>
  );
}
