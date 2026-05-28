"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Status reflects the magic-link form only. The Google OAuth button has
// its own independent loading flag (`googleLoading`) because once the
// user clicks it the browser navigates to Google and never comes back
// to this component — we only need the spinner for the brief moment
// between click and the browser's redirect.
type Status = "idle" | "loading" | "sent" | "error";

const DISPLAY_NAME_MAX = 40;

export function SignInForm({
  returnTo,
  initialError,
}: {
  returnTo?: string;
  initialError?: string | null;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);

    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (returnTo) callback.searchParams.set("return", returnTo);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        // Always show Google's account chooser — important on shared
        // devices and when the user wants to switch accounts.
        queryParams: { prompt: "select_account" },
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setGoogleLoading(false);
      return;
    }
    // On success the browser navigates to Google — leaving googleLoading
    // true is intentional so the UI stays disabled until the redirect lands.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (returnTo) callback.searchParams.set("return", returnTo);

    const trimmedName = name.trim().slice(0, DISPLAY_NAME_MAX);
    const otpData = trimmedName ? { display_name: trimmedName } : undefined;

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callback.toString(),
        ...(otpData ? { data: otpData } : {}),
      },
    });

    if (otpError) {
      setError(otpError.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl bg-card border border-border p-6 text-center">
        <div className="text-3xl mb-2">📬</div>
        <h2 className="text-sm font-extrabold text-heading mb-1">
          Check your inbox
        </h2>
        <p className="text-xs text-muted-fg leading-relaxed">
          We sent a link to <span className="text-fg font-bold">{email}</span>.
          Tap it from this device to sign in.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-[11px] font-extrabold text-primary uppercase tracking-[0.12em]"
        >
          Use a different email
        </button>
      </div>
    );
  }

  const isLoading = status === "loading";
  const anyLoading = isLoading || googleLoading;

  return (
    <div className="flex flex-col gap-5">
      {/* Primary CTA: Google. White card with subtle elevation reads as
          "press this first" without competing visually with the
          brand-gradient magic-link button below. */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={anyLoading}
        className="h-[52px] rounded-2xl bg-card border border-border px-4 text-fg text-[15px] font-bold flex items-center justify-center gap-3 shadow-[0_4px_18px_rgba(0,0,0,0.06)] disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-[0_6px_22px_rgba(0,0,0,0.10)] transition-shadow"
      >
        <GoogleLogo className="w-[18px] h-[18px] shrink-0" />
        {googleLoading ? "redirecting to google…" : "Continue with Google"}
      </button>

      {/* Subtle OR divider — softer than the previous heavy uppercase
          treatment. Lower contrast keeps it a connector, not a
          headline. */}
      <div className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.14em] uppercase text-muted-fg/50">
        <div className="flex-1 h-px bg-border/60" />
        or
        <div className="flex-1 h-px bg-border/60" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          autoComplete="given-name"
          placeholder="your name (optional)"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          disabled={anyLoading}
          className="h-[52px] rounded-2xl bg-card border border-border px-4 text-fg text-[15px] placeholder:text-muted-fg/60 focus:outline-none focus:border-primary/40 disabled:opacity-50 transition-colors"
        />
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={anyLoading}
          className="h-[52px] rounded-2xl bg-card border border-border px-4 text-fg text-[15px] placeholder:text-muted-fg/60 focus:outline-none focus:border-primary/40 disabled:opacity-50 transition-colors"
        />
        <button
          type="submit"
          disabled={anyLoading || !email}
          className="h-[52px] rounded-2xl text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background:
              "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
          }}
        >
          {isLoading ? "sending…" : "Send magic link"}
        </button>
      </form>

      {error && (
        <p className="text-xs text-center text-[hsl(0_70%_55%)]">{error}</p>
      )}
    </div>
  );
}

// Google's official "G" mark — 4-colour version, per Google's brand
// guidelines for sign-in buttons. Inline SVG so we don't ship an extra
// asset just for one icon.
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
