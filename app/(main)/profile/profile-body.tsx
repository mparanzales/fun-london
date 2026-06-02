"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSaved } from "@/components/saved-context";
import { useBookings } from "@/components/bookings-context";
import { createClient } from "@/lib/supabase/client";
import { FeedbackSheet } from "@/components/feedback-sheet";
import type { UserPreferences } from "@/lib/types";

// Two states:
//   • Anonymous (authUserId === null): hero avatar with "?" + "Sign in"
//     CTA. No preferences shown, no action rows.
//   • Signed in: existing profile UI. displayName + preferences come
//     from public.profiles (Phase 3.5). displayName falls back to the
//     email prefix when null; preferences render "Not set" when null.

export function ProfileBody({
  authUserId,
  authUserEmail,
  displayName,
  preferences,
}: {
  authUserId: string | null;
  authUserEmail: string | null;
  displayName: string | null;
  preferences: UserPreferences | null;
}) {
  if (!authUserId) {
    return <AnonProfile />;
  }
  return (
    <SignedInProfile
      authUserEmail={authUserEmail}
      displayName={displayName}
      preferences={preferences}
    />
  );
}

function AnonProfile() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-5 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-muted text-muted-fg flex items-center justify-center text-[32px] font-extrabold">
          ?
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary mt-3.5">
          You
        </h1>
        <p className="text-xs text-muted-fg mt-1 max-w-[260px]">
          Sign in to save your spots and keep your bookings across devices.
        </p>
      </header>
      <div className="px-5 flex flex-col gap-2.5">
        <Link
          href="/sign-in?return=/profile"
          className="flex items-center justify-center w-full h-[52px] rounded-2xl text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)] no-underline"
          style={{
            background:
              "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
          }}
        >
          Sign in
        </Link>

        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold"
        >
          <span className="flex gap-2.5 items-center">
            <span>💬</span>
            <span>Give Feedback</span>
          </span>
          <span className="text-muted-fg">›</span>
        </button>
      </div>

      {feedbackOpen && <FeedbackSheet onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}

function SignedInProfile({
  authUserEmail,
  displayName,
  preferences,
}: {
  authUserEmail: string | null;
  displayName: string | null;
  preferences: UserPreferences | null;
}) {
  const router = useRouter();
  const { count: savedCount } = useSaved();
  const { count: bookingsCount } = useBookings();
  const [signingOut, setSigningOut] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const effectiveName = displayName ?? authUserEmail?.split("@")[0] ?? "You";
  const initial = effectiveName.trim()[0]?.toUpperCase() ?? "?";

  const moods = preferences?.moods ?? [];
  const vibes = preferences?.vibes ?? [];
  const budget = preferences?.budget ?? null;
  const areas = preferences?.areas ?? [];

  const summaryParts: string[] = [];
  if (bookingsCount > 0)
    summaryParts.push(
      `${bookingsCount} booking${bookingsCount === 1 ? "" : "s"}`,
    );
  if (savedCount > 0) summaryParts.push(`${savedCount} saved`);
  const summary = summaryParts.length
    ? summaryParts.join(" · ")
    : "No spots yet";

  const actionRows = [
    { icon: "💜", label: "Notification prefs" },
    { icon: "🌗", label: "Theme: Auto" },
  ];

  // Edit profile row has its own handler (navigates), so it sits outside
  // the stub action rows above.

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Refresh the route so the Server Component re-fetches getAuthUser()
    // and renders the anonymous view.
    router.refresh();
    setSigningOut(false);
  }

  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-5 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-accent text-accent-fg flex items-center justify-center text-[28px] font-extrabold">
          {initial}
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary mt-3.5">
          {effectiveName}
        </h1>
        <div className="text-xs text-muted-fg mt-1">{summary}</div>
      </header>

      <div className="px-5 mb-3">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-fg mb-2">
          Your preferences
        </div>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <PrefRow label="Moods" values={moods} />
          <PrefRow label="Vibes" values={vibes} />
          <PrefRow label="Budget" values={budget ? [budget] : []} />
          <PrefRow label="Areas" values={areas} />
        </div>
      </div>

      <div className="px-5 flex flex-col gap-2.5">
        <Link
          href="/profile/edit"
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold no-underline"
        >
          <span className="flex gap-2.5 items-center">
            <span>✏️</span>
            <span>Edit profile</span>
          </span>
          <span className="text-muted-fg">›</span>
        </Link>

        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold"
        >
          <span className="flex gap-2.5 items-center">
            <span>💬</span>
            <span>Give Feedback</span>
          </span>
          <span className="text-muted-fg">›</span>
        </button>

        {actionRows.map((r) => (
          <button
            key={r.label}
            className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold"
          >
            <span className="flex gap-2.5 items-center">
              <span>{r.icon}</span>
              <span>{r.label}</span>
            </span>
            <span className="text-muted-fg">›</span>
          </button>
        ))}

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold disabled:opacity-50"
        >
          <span className="flex gap-2.5 items-center">
            <span>👋</span>
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </span>
        </button>
      </div>

      <nav className="px-5 mt-6 flex justify-center gap-4 text-[11px] text-muted-fg">
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy
        </Link>
        <Link href="/terms" className="underline underline-offset-2">
          Terms
        </Link>
        <Link href="/cookies" className="underline underline-offset-2">
          Cookies
        </Link>
      </nav>

      {feedbackOpen && (
        <FeedbackSheet
          defaultEmail={authUserEmail}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  );
}

function PrefRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between">
      <span className="text-sm font-semibold text-fg">{label}</span>
      <span className="text-xs text-muted-fg truncate ml-3 text-right capitalize">
        {values.length ? values.join(", ") : "Not set"}
      </span>
    </div>
  );
}
