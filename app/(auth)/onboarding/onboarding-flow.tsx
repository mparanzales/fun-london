"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import type { Mood, Vibe } from "@/lib/types";

const ONBOARDING_STORAGE_KEY = "fl.onboarding.v1";

type MoodOption = { value: Mood; emoji: string; label: string };
type VibeOption = { value: Vibe; emoji: string; label: string };

const MOOD_OPTIONS: MoodOption[] = [
  { value: "dinner", emoji: "🍝", label: "Dinner" },
  { value: "drinks", emoji: "🍸", label: "Drinks" },
  { value: "culture", emoji: "🎵", label: "Live Music" },
  { value: "activity", emoji: "😂", label: "Comedy" },
];

const VIBE_OPTIONS: VibeOption[] = [
  { value: "chill", emoji: "✨", label: "Chill" },
  { value: "lively", emoji: "🔥", label: "Lively" },
  { value: "fancy", emoji: "💎", label: "Fancy" },
  { value: "unique", emoji: "🎭", label: "Unique" },
];

// There are exactly two real steps (mood, vibe). The bar must tell the truth
// (was 4 — a hangover from the prototype that showed "1/4" for a 2-step flow).
const TOTAL_STEPS = 2;

export function OnboardingFlow({ authUserId }: { authUserId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<0 | 1>(0);
  const [mood, setMood] = useState<Mood | null>(null);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stepLabel = `${step + 1}/${TOTAL_STEPS}`;
  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  const finish = async () => {
    if (submitting) return;
    const prefs = {
      moods: mood ? [mood] : [],
      vibes: vibe ? [vibe] : [],
      budget: null as null,
      areas: [] as string[],
    };

    // Local cache: the splash route gates on this key. Kept in place so
    // anon users still see the right route after onboarding, and signed-in
    // users on this device skip onboarding next visit.
    try {
      window.localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({ ...prefs, completedAt: new Date().toISOString() }),
      );
    } catch {
      // ignore storage errors
    }

    // DB write when signed in. Upsert (not update) so a missing trigger
    // row would still be repaired — RLS allows it because auth.uid() = id.
    if (authUserId) {
      setSubmitting(true);
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("profiles")
          .upsert(
            { id: authUserId, preferences: prefs, onboarded: true },
            { onConflict: "id" },
          );
        if (error) {
          console.error("[onboarding] profile upsert failed:", error);
        }
      } catch (e) {
        console.error("[onboarding] profile upsert threw:", e);
      } finally {
        setSubmitting(false);
      }
    }

    track("onboarding_complete", {
      mood: mood ?? "skipped",
      vibe: vibe ?? "skipped",
    });
    router.push("/explore");
  };

  const next = () => {
    if (step === 0) setStep(1);
    else void finish();
  };

  const canAdvance = step === 0 ? mood !== null : vibe !== null;

  return (
    <div className="min-h-screen flex flex-col bg-bg pt-4 pb-8">
      {step === 0 && (
        <div className="px-5 pt-2 pb-6 flex flex-col items-center gap-3 text-center">
          <Logo variant="gradient" size="lg" />
          <p className="text-[13px] font-semibold text-muted-fg max-w-[16rem] leading-snug">
            Independent London only. No chains — every spot checked in at least
            two trusted sources.
          </p>
        </div>
      )}
      <div className="px-5 flex items-center gap-2.5 mb-5">
        {step > 0 ? (
          <button
            onClick={() => setStep(0)}
            aria-label="Back"
            className="text-lg text-muted-fg leading-none"
          >
            ‹
          </button>
        ) : (
          <span className="w-2.5" />
        )}
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[11px] font-bold text-muted-fg">{stepLabel}</span>
      </div>

      {step === 0 && (
        <Step
          title="What are you in the mood for tonight?"
          sub="Pick one to get started"
        >
          <Grid
            items={MOOD_OPTIONS}
            selected={mood}
            onSelect={(v) => setMood(v)}
          />
        </Step>
      )}

      {step === 1 && (
        <Step
          title="What kind of vibe are you looking for?"
          sub="Set the tone for your night"
        >
          <Grid
            items={VIBE_OPTIONS}
            selected={vibe}
            onSelect={(v) => setVibe(v)}
          />
        </Step>
      )}

      <div className="mt-auto px-5 pt-6">
        <button
          onClick={next}
          disabled={!canAdvance || submitting}
          className="w-full h-13 py-3.5 rounded-2xl bg-primary text-primary-fg text-[15px] font-extrabold shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {step === 0 ? "Continue" : "Find my night ✨"}
        </button>
        <button
          onClick={() => void finish()}
          disabled={submitting}
          className="mt-3 w-full text-xs text-muted-fg underline underline-offset-2 disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

function Step({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="px-5 pb-5">
        <h1 className="text-[24px] font-extrabold tracking-tight text-primary leading-tight">
          {title}
        </h1>
        <p className="text-[13px] text-muted-fg mt-1.5">{sub}</p>
      </div>
      <div className="px-5">{children}</div>
    </>
  );
}

type Option<T> = { value: T; emoji: string; label: string };

function Grid<T extends string>({
  items,
  selected,
  onSelect,
}: {
  items: Option<T>[];
  selected: T | null;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {items.map((o) => {
        const on = selected === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onSelect(o.value)}
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
