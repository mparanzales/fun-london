"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Mood, Vibe, PriceTier, UserPreferences } from "@/lib/types";

// Client form for editing display name + preferences. The Server
// Component parent (page.tsx) pre-loads everything and hands the
// initial values in; we keep local state for the form and upsert to
// public.profiles on Save.

const MOOD_OPTIONS: { value: Mood; emoji: string; label: string }[] = [
  { value: "dinner", emoji: "🍝", label: "Dinner" },
  { value: "drinks", emoji: "🍸", label: "Drinks" },
  { value: "culture", emoji: "🎵", label: "Live Music" },
  { value: "activity", emoji: "😂", label: "Comedy" },
];

const VIBE_OPTIONS: { value: Vibe; emoji: string; label: string }[] = [
  { value: "chill", emoji: "✨", label: "Chill" },
  { value: "lively", emoji: "🔥", label: "Lively" },
  { value: "fancy", emoji: "💎", label: "Fancy" },
  { value: "unique", emoji: "🎭", label: "Unique" },
];

// Personal budget cap. "Free" is omitted — it's a venue attribute,
// not a meaningful user preference.
const BUDGET_OPTIONS: PriceTier[] = ["£", "££", "£££"];

const DISPLAY_NAME_MAX = 40;

export function EditForm({
  authUserId,
  initialDisplayName,
  initialPreferences,
  areaOptions,
}: {
  authUserId: string;
  initialDisplayName: string;
  initialPreferences: UserPreferences | null;
  areaOptions: string[];
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [moods, setMoods] = useState<Mood[]>(initialPreferences?.moods ?? []);
  const [vibes, setVibes] = useState<Vibe[]>(initialPreferences?.vibes ?? []);
  const [budget, setBudget] = useState<PriceTier | null>(
    initialPreferences?.budget ?? null,
  );
  const [areas, setAreas] = useState<string[]>(initialPreferences?.areas ?? []);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function toggleIn<T>(set: T[], value: T): T[] {
    return set.includes(value)
      ? set.filter((v) => v !== value)
      : [...set, value];
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setErrorMsg(null);

    const trimmedName = displayName.trim().slice(0, DISPLAY_NAME_MAX);
    const prefs: UserPreferences = {
      moods,
      vibes,
      budget,
      areas,
    };

    try {
      const supabase = createClient();
      const { error } = await supabase.from("profiles").upsert(
        {
          id: authUserId,
          display_name: trimmedName || null,
          preferences: prefs,
          onboarded: true,
        },
        { onConflict: "id" },
      );
      if (error) {
        console.error("[profile-edit] upsert failed:", error);
        setErrorMsg("Couldn't save, try again in a moment.");
        setSaving(false);
        return;
      }
      router.push("/profile");
      router.refresh();
    } catch (e) {
      console.error("[profile-edit] upsert threw:", e);
      setErrorMsg("Couldn't save, try again in a moment.");
      setSaving(false);
    }
  }

  return (
    <div className="pt-4 pb-32">
      <div className="px-5 pb-4 flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back"
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-fg/5 text-fg no-underline"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2} />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight text-primary m-0">
          Edit profile
        </h1>
      </div>

      <div className="px-5 mb-5">
        <label
          htmlFor="display-name"
          className="block text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-fg mb-2"
        >
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          value={displayName}
          maxLength={DISPLAY_NAME_MAX}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Maria"
          className="w-full bg-card border border-border rounded-2xl px-4 py-3 text-fg text-[15px] font-semibold placeholder:text-muted-fg/60 outline-none focus:border-accent"
        />
      </div>

      <Section title="Moods" sub="Pick any that fit">
        <Grid
          items={MOOD_OPTIONS}
          isSelected={(v) => moods.includes(v)}
          onToggle={(v) => setMoods((prev) => toggleIn(prev, v))}
        />
      </Section>

      <Section title="Vibes" sub="What you're usually after">
        <Grid
          items={VIBE_OPTIONS}
          isSelected={(v) => vibes.includes(v)}
          onToggle={(v) => setVibes((prev) => toggleIn(prev, v))}
        />
      </Section>

      <Section title="Budget" sub="Your usual spend">
        <div className="grid grid-cols-3 gap-2.5">
          {BUDGET_OPTIONS.map((b) => {
            const on = budget === b;
            return (
              <button
                key={b}
                type="button"
                onClick={() => setBudget(on ? null : b)}
                aria-pressed={on}
                className={
                  "py-3 rounded-2xl border text-[15px] font-extrabold transition " +
                  (on
                    ? "bg-accent/10 border-accent text-accent"
                    : "bg-card border-border text-fg")
                }
              >
                {b}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Areas you love" sub="Tap to add to your shortlist">
        {areaOptions.length === 0 ? (
          <div className="text-sm text-muted-fg">No areas yet.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {areaOptions.map((a) => {
              const on = areas.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAreas((prev) => toggleIn(prev, a))}
                  aria-pressed={on}
                  className={
                    "py-3 rounded-2xl border text-sm font-extrabold transition " +
                    (on
                      ? "bg-accent/10 border-accent text-accent"
                      : "bg-card border-border text-fg")
                  }
                >
                  {a}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {errorMsg && (
        <div className="px-5 mt-2 text-xs text-red-600 font-semibold">
          {errorMsg}
        </div>
      )}

      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-bg border-t border-fg/10 px-5 py-4 flex flex-col gap-2"
        style={{
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full h-13 py-3.5 rounded-2xl bg-primary text-primary-fg text-[15px] font-extrabold shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <Link
          href="/profile"
          className="block text-center text-xs text-muted-fg underline underline-offset-2 no-underline hover:underline"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 mb-5">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-fg mb-1">
        {title}
      </div>
      <p className="text-[12px] text-muted-fg mb-2.5">{sub}</p>
      {children}
    </div>
  );
}

type Option<T> = { value: T; emoji: string; label: string };

function Grid<T extends string>({
  items,
  isSelected,
  onToggle,
}: {
  items: Option<T>[];
  isSelected: (v: T) => boolean;
  onToggle: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {items.map((o) => {
        const on = isSelected(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            aria-pressed={on}
            className={
              "aspect-[1.2/1] rounded-2xl flex flex-col items-center justify-center gap-2 transition border " +
              (on ? "bg-accent/10 border-accent" : "bg-card border-border")
            }
          >
            <span className="text-[28px] leading-none">{o.emoji}</span>
            <span className="text-sm font-extrabold text-fg">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
