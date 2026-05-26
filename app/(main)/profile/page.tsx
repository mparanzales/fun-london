"use client";

import { useSaved } from "@/components/saved-context";
import { getCurrentUser } from "@/lib/mock-data";

export default function ProfilePage() {
  const user = getCurrentUser();
  const { count: savedCount } = useSaved();
  const initial =
    (user.displayName ?? user.email ?? "?").trim()[0]?.toUpperCase() ?? "?";

  const prefs = user.preferences;
  const moods = prefs?.moods ?? [];
  const vibes = prefs?.vibes ?? [];
  const budget = prefs?.budget ?? null;
  const areas = prefs?.areas ?? [];

  const actionRows = [
    { icon: "💬", label: "Give Feedback" },
    { icon: "💜", label: "Notification prefs" },
    { icon: "🌗", label: "Theme: Auto" },
  ];

  return (
    <div className="pt-4 pb-6">
      {/* User header */}
      <header className="px-5 pb-5 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-accent text-accent-fg flex items-center justify-center text-[28px] font-extrabold">
          {initial}
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary mt-3.5">
          {user.displayName ?? "Anonymous"}
        </h1>
        <div className="text-xs text-muted-fg mt-1">
          {savedCount} spot{savedCount === 1 ? "" : "s"} saved
        </div>
      </header>

      {/* Preferences preview */}
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

      {/* Action rows */}
      <div className="px-5 flex flex-col gap-2.5">
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
      </div>
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
