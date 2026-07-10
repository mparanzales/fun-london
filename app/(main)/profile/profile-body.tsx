"use client";

import { resetAnalyticsIdentity } from "@/lib/analytics";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  LogOut,
  MessageCircle,
  Moon,
  Package,
  Pencil,
  Sun,
  SunMoon,
} from "lucide-react";
import { useSaved } from "@/components/saved-context";
import { useBookings } from "@/components/bookings-context";
import { createClient } from "@/lib/supabase/client";
import { FeedbackSheet } from "@/components/feedback-sheet";
import { exportMyData, deleteMyAccount, setEmailDigestOptIn } from "./actions";
import {
  getThemeMode,
  nextThemeMode,
  setThemeMode,
  themeModeLabel,
  type ThemeMode,
} from "@/lib/theme";
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
  emailOptIn,
}: {
  authUserId: string | null;
  authUserEmail: string | null;
  displayName: string | null;
  preferences: UserPreferences | null;
  emailOptIn: boolean;
}) {
  if (!authUserId) {
    return <AnonProfile />;
  }
  return (
    <SignedInProfile
      authUserEmail={authUserEmail}
      displayName={displayName}
      preferences={preferences}
      emailOptIn={emailOptIn}
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
            <span>
              <MessageCircle
                className="w-4 h-4 inline-block align-[-3px]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
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
  emailOptIn,
}: {
  authUserEmail: string | null;
  displayName: string | null;
  preferences: UserPreferences | null;
  emailOptIn: boolean;
}) {
  const router = useRouter();
  const { count: savedCount } = useSaved();
  const { count: bookingsCount } = useBookings();
  const [signingOut, setSigningOut] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Weekly-digest opt-in. Optimistic toggle: flip immediately, revert if the
  // server write fails (so the switch never lies about your consent).
  const [emailWeekly, setEmailWeekly] = useState(emailOptIn);
  const [savingEmail, setSavingEmail] = useState(false);
  async function toggleEmailWeekly() {
    if (savingEmail) return;
    const next = !emailWeekly;
    setEmailWeekly(next);
    setSavingEmail(true);
    const res = await setEmailDigestOptIn(next);
    if (!res.ok) setEmailWeekly(!next); // revert on failure
    setSavingEmail(false);
  }
  // Theme mode. Start at "auto" (matches SSR) and sync to the saved choice
  // after mount to avoid a hydration mismatch.
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");
  useEffect(() => {
    setThemeModeState(getThemeMode());
  }, []);

  function cycleTheme() {
    const next = nextThemeMode(themeMode);
    setThemeModeState(next);
    setThemeMode(next); // persists + repaints via ThemeProvider
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await exportMyData();
      if (res.ok) {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "fun-london-my-data.json";
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  }

  // Account deletion (destructive — gated behind an explicit confirm step).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteMyAccount();
    if (res.ok) {
      // Account is gone — clear the local session and send them home.
      const supabase = createClient();
      await supabase.auth.signOut();
      resetAnalyticsIdentity(); // next account on this browser starts clean
      router.replace("/");
      return;
    }
    setDeleting(false);
    setDeleteError(
      res.error === "not_configured"
        ? "Account deletion isn't available right now. Email hello@funldn.com and we'll remove it."
        : "Something went wrong. Please try again, or email hello@funldn.com.",
    );
  }

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

  // Theme icon mirrors the mode: half-moon for auto, sun for light, moon
  // for dark.
  const ThemeIcon =
    themeMode === "auto" ? SunMoon : themeMode === "day" ? Sun : Moon;

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    resetAnalyticsIdentity(); // next account on this browser starts clean
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
            <span>
              <Pencil
                className="w-4 h-4 inline-block align-[-3px]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
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
            <span>
              <MessageCircle
                className="w-4 h-4 inline-block align-[-3px]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
            <span>Give Feedback</span>
          </span>
          <span className="text-muted-fg">›</span>
        </button>

        <button
          type="button"
          onClick={cycleTheme}
          aria-label={`Theme: ${themeModeLabel(themeMode)}. Tap to change.`}
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold"
        >
          <span className="flex gap-2.5 items-center">
            <span>
              <ThemeIcon
                className="w-4 h-4 inline-block align-[-3px]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
            <span>Theme: {themeModeLabel(themeMode)}</span>
          </span>
          <span className="text-[11px] font-bold text-muted-fg uppercase tracking-wider">
            Tap to change
          </span>
        </button>

        <button
          type="button"
          onClick={toggleEmailWeekly}
          disabled={savingEmail}
          role="switch"
          aria-checked={emailWeekly}
          aria-label="Email me what's new in London each week"
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold disabled:opacity-50"
        >
          <span className="flex gap-2.5 items-center">
            <span>
              <Bell
                className="w-4 h-4 inline-block align-[-3px]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
            <span>Email me what&apos;s new in London</span>
          </span>
          {/* Pill toggle — accent track when on, muted when off. */}
          <span
            className={
              "relative w-10 h-6 rounded-full transition-colors flex-shrink-0 " +
              (emailWeekly ? "bg-primary" : "bg-muted")
            }
          >
            <span
              className={
                "absolute top-0.5 w-5 h-5 rounded-full bg-card shadow-soft transition-all " +
                (emailWeekly ? "left-[18px]" : "left-0.5")
              }
            />
          </span>
        </button>

        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold disabled:opacity-50"
        >
          <span className="flex gap-2.5 items-center">
            <span>
              <Package
                className="w-4 h-4 inline-block align-[-3px]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
            <span>{exporting ? "Preparing…" : "Export my data"}</span>
          </span>
          <span className="text-muted-fg">↓</span>
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full bg-card border border-border rounded-2xl px-4 py-3.5 flex justify-between items-center text-fg text-[13px] font-bold disabled:opacity-50"
        >
          <span className="flex gap-2.5 items-center">
            <span>
              <LogOut
                className="w-4 h-4 inline-block align-[-3px]"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>
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

      <div className="px-5 mt-5 flex flex-col items-center">
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
            className="text-[12px] font-semibold text-muted-fg/80 hover:text-red-500 transition-colors"
          >
            Delete my account
          </button>
        ) : (
          <div className="w-full max-w-sm bg-card border border-red-500/30 rounded-2xl p-4 text-center">
            <div className="text-[13px] font-extrabold text-heading mb-1">
              Delete your account?
            </div>
            <p className="text-[12px] text-muted-fg leading-relaxed mb-3">
              This permanently removes your account, saved spots, bookings and
              plans. It can&apos;t be undone.
            </p>
            {deleteError && (
              <p className="text-[12px] text-red-500 font-semibold mb-3">
                {deleteError}
              </p>
            )}
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="flex-1 h-11 rounded-2xl bg-muted text-fg font-bold text-[13px] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 h-11 rounded-2xl bg-red-500 text-white font-extrabold text-[13px] disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        )}
      </div>

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
