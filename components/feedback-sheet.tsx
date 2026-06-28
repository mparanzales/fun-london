"use client";

// Give Feedback bottom-sheet. Opened from the profile screen (signed in and
// anonymous). Mostly taps plus one open box, so people actually finish it.
// Submits via the submitFeedback Server Action into public.feedback.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Heart } from "lucide-react";
import { submitFeedback } from "@/app/(main)/profile/actions";

type Choice = { id: string; label: string };

const Q1: Choice[] = [
  { id: "would_use", label: "Already would" },
  { id: "maybe", label: "Maybe, with a few tweaks" },
  { id: "not_yet", label: "Not yet" },
];
const Q2: Choice[] = [
  { id: "several", label: "Yes, more than one" },
  { id: "one_or_two", label: "One or two" },
  { id: "nothing", label: "Nothing grabbed me" },
];
const Q4: Choice[] = [
  { id: "booking", label: "Booking in a couple of taps" },
  { id: "plans", label: "Plans for a whole night out" },
  { id: "events", label: "Events worth leaving home for" },
  { id: "sharing", label: "Sharing picks with friends" },
  { id: "coverage", label: "More of London covered" },
];

export function FeedbackSheet({
  defaultEmail,
  onClose,
}: {
  defaultEmail?: string | null;
  onClose: () => void;
}) {
  const [useIntent, setUseIntent] = useState<string | null>(null);
  const [foundSomething, setFoundSomething] = useState<string | null>(null);
  const [wants, setWants] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );

  // Render through a portal on document.body so the fixed overlay escapes the
  // page-transition wrapper (which keeps a CSS transform and would otherwise
  // trap position:fixed inside the narrow page column). Mounted-gate keeps SSR
  // happy since document is client-only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    // Lock background scroll while the sheet is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const hasContent =
    !!useIntent ||
    !!foundSomething ||
    wants.length > 0 ||
    message.trim().length > 0;

  const toggleWant = (id: string) =>
    setWants((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id],
    );

  async function onSubmit() {
    if (!hasContent || status === "saving") return;
    setStatus("saving");
    const res = await submitFeedback({
      useIntent,
      foundSomething,
      differentiation: null,
      wants,
      message,
      email,
      path: typeof window !== "undefined" ? window.location.pathname : null,
    });
    setStatus(res.ok ? "done" : "error");
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Give feedback"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <div
        className="fl-sheet-backdrop absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className="fl-sheet relative w-full max-w-md bg-bg rounded-t-3xl border-t border-border max-h-[90vh] overflow-y-auto p-5"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg">
            Give feedback
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-fg -mr-1 p-1"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {status === "done" ? (
          <div className="py-10 text-center">
            <Heart
              className="w-10 h-10 text-muted-fg mb-3"
              strokeWidth={1.75}
              aria-hidden
            />
            <h2 className="text-xl font-extrabold text-heading mb-1.5">
              Thank you
            </h2>
            <p className="text-sm text-muted-fg max-w-[280px] mx-auto leading-relaxed">
              You are one of the first people to shape Fun London. This goes
              straight to us.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full h-[52px] rounded-2xl bg-primary text-white font-extrabold text-[15px]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-extrabold text-heading mb-1">
              Help us get this right
            </h2>
            <p className="text-[13px] text-muted-fg mb-5 leading-relaxed">
              You are one of the first to try Fun London. Tell us what landed
              and what did not. Takes about a minute, every question is
              optional.
            </p>

            <Question
              label="Would you use Fun London to plan a night out?"
              choices={Q1}
              value={useIntent}
              onSelect={setUseIntent}
            />
            <Question
              label="Did we show you somewhere you actually want to go?"
              choices={Q2}
              value={foundSomething}
              onSelect={setFoundSomething}
            />
            <fieldset className="mb-5">
              <legend className="text-sm font-bold text-fg mb-2.5">
                What would make this a must have?
              </legend>
              <div className="flex flex-wrap gap-2">
                {Q4.map((c) => {
                  const on = wants.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleWant(c.id)}
                      className={`px-3.5 py-2 rounded-full border text-[13px] font-bold transition-colors ${
                        on
                          ? "bg-primary border-primary text-white"
                          : "bg-card border-border text-fg"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mb-5">
              <label
                htmlFor="fb-message"
                className="text-sm font-bold text-fg block mb-2"
              >
                Anything else on your mind?
              </label>
              <textarea
                id="fb-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="What would make Fun London the first thing you open on a Friday?"
                className="w-full rounded-xl bg-card border border-border px-3.5 py-3 text-fg text-sm placeholder:text-muted-fg/70 resize-none"
              />
            </div>

            <div className="mb-5">
              <label
                htmlFor="fb-email"
                className="text-sm font-bold text-fg block mb-2"
              >
                Want us to follow up?{" "}
                <span className="font-normal text-muted-fg">(optional)</span>
              </label>
              <input
                id="fb-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full h-11 rounded-xl bg-card border border-border px-3.5 text-fg text-sm placeholder:text-muted-fg/70"
              />
            </div>

            {status === "error" && (
              <p className="text-[13px] text-red-500 font-semibold mb-3 text-center">
                That did not send. Please try again in a moment.
              </p>
            )}

            <button
              type="button"
              onClick={onSubmit}
              disabled={!hasContent || status === "saving"}
              className="w-full h-[52px] rounded-2xl bg-primary text-white font-extrabold text-[15px] disabled:opacity-50"
            >
              {status === "saving" ? "Sending…" : "Send feedback"}
            </button>
            <p className="text-[11px] text-muted-fg text-center mt-2.5 leading-relaxed">
              Goes straight to the team. No spam, ever.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Question({
  label,
  choices,
  value,
  onSelect,
}: {
  label: string;
  choices: Choice[];
  value: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="mb-5">
      <legend className="text-sm font-bold text-fg mb-2.5">{label}</legend>
      <div className="flex flex-col gap-2">
        {choices.map((c) => {
          const on = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-[13px] font-bold transition-colors ${
                on
                  ? "bg-primary border-primary text-white"
                  : "bg-card border-border text-fg"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
