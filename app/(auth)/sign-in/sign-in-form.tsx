"use client";

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Status reflects the magic-link form only. The OAuth buttons have their own
// `oauthLoading` flag (which provider is mid-redirect) because once the user
// clicks one the browser navigates away and never comes back to this
// component — the spinner only needs to cover click → redirect.
type Status = "idle" | "loading" | "sent" | "error";
type OAuthProvider = "google" | "apple" | "facebook";

const DISPLAY_NAME_MAX = 40;
// Seconds to lock the magic-link button after a send. Supabase throttles
// magic-link emails (~a few per hour); a visible cooldown stops users
// hammering it into a 429 and reads as intentional, not broken.
const MAGIC_LINK_COOLDOWN_S = 30;

// Social providers are gated behind these flags until they're actually enabled
// in the Supabase dashboard. We hide (not just disable) any provider that isn't
// live, because on a login-only wall a button that errors looks like the whole
// sign-in is broken. Flip a flag to `true` once its provider is configured.
//   • Apple   — needs a paid Apple Developer Program enrolment (blocked on the
//               company registration); Services ID unavailable until then.
//   • Facebook— Meta app not created yet. Flip on once App ID/Secret are in
//               Supabase. (Button + handler code are kept, just not rendered.)
const APPLE_ENABLED = false;
const FACEBOOK_ENABLED = false;
const SOCIAL_EXTRAS = [APPLE_ENABLED, FACEBOOK_ENABLED].filter(Boolean).length;

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
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [cooldown, setCooldown] = useState(0);

  // Tick the cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleOAuthSignIn(provider: OAuthProvider) {
    setOauthLoading(provider);
    setError(null);

    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (returnTo) callback.searchParams.set("return", returnTo);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callback.toString(),
        // Google: always show the account chooser (shared devices / switching).
        ...(provider === "google"
          ? { queryParams: { prompt: "select_account" } }
          : {}),
      },
    });

    if (oauthError) {
      // A provider that isn't enabled in the Supabase dashboard yet returns a
      // "provider is not enabled" error — say so plainly so it's obvious it's
      // config, not a user mistake.
      setError(
        /not enabled/i.test(oauthError.message)
          ? `${labelFor(provider)} sign-in isn't switched on yet. try Google or email.`
          : oauthError.message,
      );
      setOauthLoading(null);
      return;
    }
    // On success the browser navigates to the provider — leaving oauthLoading
    // set is intentional so the UI stays disabled until the redirect lands.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
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
      const rateLimited =
        otpError.status === 429 ||
        /rate|too many|limit/i.test(otpError.message);
      if (rateLimited) {
        setError(
          "too many email requests for now. Try Google above, or wait a minute and retry.",
        );
        setCooldown(MAGIC_LINK_COOLDOWN_S);
      } else {
        setError(otpError.message);
      }
      setStatus("error");
      return;
    }
    setStatus("sent");
    setCooldown(MAGIC_LINK_COOLDOWN_S);
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl bg-card border border-border p-6 text-center">
        <MailCheck className="w-9 h-9 text-muted-fg mb-2" strokeWidth={1.75} aria-hidden />
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
  const anyLoading = isLoading || oauthLoading !== null;

  return (
    <div className="flex flex-col gap-5">
      {/* Primary CTA: Google. White card with subtle elevation reads as
          "press this first" without competing with the brand-gradient
          magic-link button below. */}
      <button
        type="button"
        onClick={() => handleOAuthSignIn("google")}
        disabled={anyLoading}
        className="h-[52px] rounded-2xl bg-card border border-border px-4 text-fg text-[15px] font-bold flex items-center justify-center gap-3 shadow-[0_4px_18px_rgba(0,0,0,0.06)] disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-[0_6px_22px_rgba(0,0,0,0.10)] transition-shadow"
      >
        <GoogleLogo className="w-[18px] h-[18px] shrink-0" />
        {oauthLoading === "google"
          ? "redirecting to google…"
          : "Continue with Google"}
      </button>

      {/* Apple + Facebook, side by side — secondary social options.
          INSTAGRAM (future): there is no native Supabase Instagram provider, so
          for now Facebook/Meta login covers Instagram users with linked
          accounts. A true "Sign in with Instagram" needs Meta's "Instagram API
          with Instagram Login" custom OAuth (own route handler + Meta app
          review) AND a post-auth email-capture step, because Instagram returns
          no email and our accounts are email-keyed. Add a third button here
          wired to that custom flow when built. */}
      {SOCIAL_EXTRAS > 0 && (
        <div
          className={`grid gap-3 ${SOCIAL_EXTRAS === 2 ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {APPLE_ENABLED && (
            <button
              type="button"
              onClick={() => handleOAuthSignIn("apple")}
              disabled={anyLoading}
              aria-label="Continue with Apple"
              className="h-[52px] rounded-2xl bg-black text-white px-4 text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <AppleLogo className="w-[18px] h-[18px] shrink-0" />
              {oauthLoading === "apple" ? "…" : "Apple"}
            </button>
          )}
          {FACEBOOK_ENABLED && (
            <button
              type="button"
              onClick={() => handleOAuthSignIn("facebook")}
              disabled={anyLoading}
              aria-label="Continue with Facebook"
              className="h-[52px] rounded-2xl bg-[#1877F2] text-white px-4 text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FacebookLogo className="w-[18px] h-[18px] shrink-0" />
              {oauthLoading === "facebook" ? "…" : "Facebook"}
            </button>
          )}
        </div>
      )}

      {/* Subtle OR divider — a connector, not a headline. */}
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
          disabled={anyLoading || !email || cooldown > 0}
          className="h-[52px] rounded-2xl text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background:
              "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
          }}
        >
          {isLoading
            ? "sending…"
            : cooldown > 0
              ? `resend in ${cooldown}s`
              : "Send magic link"}
        </button>
      </form>

      {error && (
        <p className="text-xs text-center text-[hsl(0_70%_55%)]">{error}</p>
      )}
    </div>
  );
}

function labelFor(provider: OAuthProvider): string {
  return provider === "google"
    ? "Google"
    : provider === "apple"
      ? "Apple"
      : "Facebook";
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

// Apple logo (white) for the dark Apple button.
function AppleLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16.365 1.43c0 1.14-.42 2.21-1.13 3.02-.77.89-2.03 1.58-3.07 1.5-.13-1.12.42-2.3 1.1-3.06.77-.86 2.1-1.5 3.1-1.46zM20.5 17.05c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.54-1.54.02-1.94-1.01-4.03-1-2.09.01-2.53 1.02-4.07 1-1.73-.02-3.05-1.79-4.04-3.36C-.06 18.1-.36 13.3 1.36 10.82c.96-1.39 2.48-2.27 4.04-2.27 1.59 0 2.59 1.02 4.03 1.02 1.4 0 2.25-1.02 4.03-1.02 1.4 0 2.88.76 3.94 2.08-3.46 1.9-2.9 6.84.7 8.32z" />
    </svg>
  );
}

// Facebook "f" (white) for the blue Facebook button.
function FacebookLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.08 24 18.09 24 12.07z" />
    </svg>
  );
}
