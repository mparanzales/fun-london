"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "loading" | "sent" | "error";

export function SignInForm({
  returnTo,
  initialError,
}: {
  returnTo?: string;
  initialError?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (returnTo) callback.searchParams.set("return", returnTo);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback.toString() },
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isLoading}
        className="h-[52px] rounded-2xl bg-card border border-border px-4 text-fg text-[15px] placeholder:text-muted-fg/60 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={isLoading || !email}
        className="h-[52px] rounded-2xl text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background:
            "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
        }}
      >
        {isLoading ? "Sending…" : "Send magic link"}
      </button>
      {error && (
        <p className="text-xs text-center text-[hsl(0_70%_55%)] mt-1">
          {error}
        </p>
      )}
    </form>
  );
}
