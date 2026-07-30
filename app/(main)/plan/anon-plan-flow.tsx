"use client";

// The SIGNED-OUT /plan experience: build one real night, free.
//
// Until 2026-07-27 an anon tapping Plan — the tab that carries the entire
// "plan the night, not the place" positioning — got a blur over an EMPTY
// ARRAY, with the only non-dismissible wall in the app on top. Three
// independent reviews (persona-panel, ux-critic, coach) converged on the
// same verdict: the product previewed the commodity (a venue list) and
// gated the differentiator (the assembled night). This component inverts
// that: the demo is free, the wall sits on KEEPING it (save) and on DEPTH
// (2nd+ reshuffle).
//
// TWO SCREENS, setup -> result, each owning its own header (the server page
// renders neither): the first cut stacked a static H1 above the result and
// Maria killed it ("no hierarchy and not much design behind it"). The
// design + ux gates (2026-07-28) rebuilt both screens in the PLAN's own
// vocabulary — the signed-in setup header, the gradient result banner, the
// number rail + role eyebrows + dashed walk connectors — instead of the
// feed's card rows. The one .fl-grad moment per screen: setup spends it on
// the wordmark text, result on the banner (grainy via .fl-grad — never the
// inline-gradient shortcut, which skips the film grain).
//
// Moat: this file never sees the catalogue. The engine runs server-side
// (lib/plan-preview.ts, service-role, server-only); what arrives here is 3
// card-level stops — the same fields any anon venue page shows. Arrival
// labels are server-formatted from the user's OWN chosen start + dwell +
// walk, never from opening_hours. This module must NOT import
// lib/supabase/client, lib/signals, or lib/queries (pinned by
// plan-preview-guard).
//
// The built night SURVIVES sign-in: on result render it is stashed in
// localStorage (not sessionStorage — magic links open in a new tab), and
// PlanFlow hydrates it through its openSaved path after the OAuth
// round-trip.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Sparkles,
  Flame,
  Gem,
  Drama,
  Footprints,
  Star,
  RefreshCw,
  Heart,
  MapPin,
  Clock,
} from "lucide-react";
import { AuthWall } from "@/components/auth-wall";
import {
  WhenPicker,
  AreaPicker,
  Group,
  toISODate,
  toPlanArea,
  type WhenChoice,
  type AreaSel,
} from "./plan-controls";
import { PlanTogetherCard } from "./plan-together-card";
import { buildAnonPlan } from "@/lib/plan-preview-action";
import type { AnonPlanPayload } from "@/lib/plan-preview-shape";
import { ANYWHERE } from "@/lib/plan-engine";
import { track, type SetupControl } from "@/lib/analytics";
// Both are import-safe from this file: analytics-keys has ZERO imports, and
// analytics-reasons imports only types (erased at build). The moat guard test
// pins this file's import list, so nothing with a data path may be added.
import { writePlanHandoff, writeSignInTrigger } from "@/lib/analytics-keys";
import {
  planFailReasonFromServer,
  throwFailReason,
} from "@/lib/analytics-reasons";
import {
  parseNightPlan,
  NIGHT_PLAN_VERSION,
  type NightPlan,
} from "@/lib/night-plan";
import { writeActivePlan } from "@/lib/active-plan";
import type { PlanRole } from "@/lib/plan-engine";

export const ANON_PLAN_STASH_KEY = "fl.anonplan.v1";

// Mirrors plan-flow's resolveTiming (plan-flow.tsx:72) for the anon brief —
// deliberately NOT imported from there: plan-flow drags in the supabase
// browser client and the signals module, which this file must never bundle.
function resolveAnonTiming(
  choice: WhenChoice,
  dateStr: string,
  timeStr: string,
): { daypart: "day" | "evening"; whenISO: string } {
  const now = new Date();
  const at = (h: number) => {
    const d = new Date(now);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const isDayNow = now.getHours() >= 5 && now.getHours() < 17;
  if (choice === "day")
    return {
      daypart: "day",
      whenISO: (isDayNow ? now : at(13)).toISOString(),
    };
  if (choice === "evening")
    return {
      daypart: "evening",
      whenISO: (isDayNow ? at(19) : now).toISOString(),
    };
  if (choice === "custom") {
    const d = new Date(`${dateStr || toISODate(now)}T${timeStr || "20:00"}`);
    const when = isNaN(d.getTime()) ? now : d;
    const h = when.getHours();
    return {
      daypart: h >= 5 && h < 17 ? "day" : "evening",
      whenISO: when.toISOString(),
    };
  }
  return { daypart: isDayNow ? "day" : "evening", whenISO: now.toISOString() };
}

// "3h 40m" from total minutes, no degenerate separators.
function fmtHours(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const VIBES: {
  v: "Chill" | "Lively" | "Fancy" | "Unique";
  sub: string;
  Icon: typeof Sparkles;
}[] = [
  { v: "Chill", sub: "easy pace, good corners", Icon: Sparkles },
  { v: "Lively", sub: "buzz, noise, people", Icon: Flame },
  { v: "Fancy", sub: "a proper occasion", Icon: Gem },
  { v: "Unique", sub: "only-in-London stuff", Icon: Drama },
];
const BUDGETS: ("£" | "££" | "Any")[] = ["£", "££", "Any"];

export function AnonPlanFlow({
  neighbourhoods,
}: {
  neighbourhoods: { name: string; n: number }[];
}) {
  const [when, setWhen] = useState<WhenChoice>("now");
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("20:00");
  const [areaSel, setAreaSel] = useState<AreaSel>({ kind: "anywhere" });
  const [vibe, setVibe] = useState<(typeof VIBES)[number]["v"]>("Chill");
  const [budget, setBudget] = useState<(typeof BUDGETS)[number]>("££");
  const [minDate, setMinDate] = useState("");
  const [eyebrow, setEyebrow] = useState("tonight,");
  useEffect(() => {
    setMinDate(toISODate(new Date()));
    const h = new Date().getHours();
    setEyebrow(h >= 5 && h < 17 ? "today," : "tonight,");
  }, []);

  const [step, setStep] = useState<"setup" | "result">("setup");
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<AnonPlanPayload | null>(null);
  const [startLabel, setStartLabel] = useState<string | null>(null);
  const [failure, setFailure] = useState<"limited" | "soft" | null>(null);
  // One free reshuffle (offset 1); the 2nd raises the wall. The engine is
  // deterministic per offset, so a walled FIRST reshuffle would protect
  // nothing Build doesn't already expose. The free reshuffle is only
  // CONSUMED when the rebuild SUCCEEDS — a failed build must never spend it
  // and dead-end the next tap into the wall (ux gate blocker, 2026-07-28).
  const [reshuffles, setReshuffles] = useState(0);
  const [wallUp, setWallUp] = useState(false);

  // plan_setup_started, fired ONCE per mount, from the setup controls only.
  // Not from Build (a defaults-only visitor legitimately has no setup event),
  // not from a restore, not from an effect.
  const setupStartedRef = useRef(false);
  const markSetupStarted = (control: SetupControl) => {
    if (setupStartedRef.current) return;
    setupStartedRef.current = true;
    // Reports WHICH control was touched first, not the chosen values. At this
    // instant the setter has not run yet, so any dimension value would be the
    // mount-time default on 100% of events. See plan-flow.tsx for the full note.
    track("plan_setup_started", {
      plan_surface: "anon",
      first_control: control,
    });
  };

  const build = async (offset: 0 | 1) => {
    setBuilding(true);
    setFailure(null);
    const t = resolveAnonTiming(when, customDate, customTime);
    // Unlike the signed-in engine (local + synchronous), this is a server
    // round trip through lib/plan-preview.ts. Timed across the await, so the
    // number is what the visitor actually waited for.
    //
    // 🧨 Read this before comparing it to the signed-in number: the server
    // holds a module-level TTL cache, so a COLD call includes a paged read of
    // the whole catalogue and a WARM one does not. The distribution is bimodal
    // by design, and it is not comparable to the signed-in duration at all.
    const t0 = performance.now();
    let res: Awaited<ReturnType<typeof buildAnonPlan>>;
    try {
      res = await buildAnonPlan({
        vibe,
        budget,
        area: toPlanArea(areaSel),
        daypart: t.daypart,
        whenISO: t.whenISO,
        offset,
      });
    } catch {
      // A rejected server action previously skipped setBuilding(false)
      // entirely, so the button stayed disabled on "Building your night…"
      // forever. Recovering here is a real UX fix riding inside an analytics
      // change; it is called out separately in the PR, not smuggled in.
      setBuilding(false);
      setFailure("soft");
      track("plan_preview_failed", {
        reason: throwFailReason(
          typeof navigator === "undefined" ? undefined : navigator.onLine,
        ),
        duration_ms: Math.round(performance.now() - t0),
        offset,
        vibe,
        budget,
        area: areaSel.kind, // legacy spelling on this surface
        area_kind: areaSel.kind,
      });
      return;
    }
    const duration_ms = Math.round(performance.now() - t0);
    setBuilding(false);
    if (res.ok) {
      setResult(res);
      if (offset === 1) setReshuffles(1);
      setStartLabel(
        new Date(t.whenISO)
          .toLocaleTimeString("en-GB", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
          .toLowerCase(),
      );
      setStep("result");
      window.scrollTo({ top: 0 });
      track("plan_preview_built", {
        vibe,
        budget,
        area: areaSel.kind, // legacy spelling on this surface, kept for insights
        area_kind: areaSel.kind, // matches the signed-in events
        offset,
        duration_ms,
        stop_count: res.stops.length,
        // pool_stage is deliberately ABSENT here. The anon payload guard test
        // asserts poolStage/poolSize never cross to the client, so the anon and
        // signed-in generate events are not comparable on pool stage. Widening
        // that payload is a moat decision, not an analytics one.
      });
    } else if (res.reason === "limited") {
      setFailure("limited");
      track("plan_preview_failed", {
        reason: "rate_limited",
        duration_ms,
        offset,
        vibe,
        budget,
        area: areaSel.kind,
        area_kind: areaSel.kind,
      });
    } else {
      setFailure("soft");
      // res.reason was previously thrown away, so every non-rate-limit failure
      // was invisible. Mapped onto a closed category; the bounded server string
      // rides alongside so the mapping itself stays auditable.
      track("plan_preview_failed", {
        reason: planFailReasonFromServer(res.reason),
        raw_reason: res.reason ?? "none",
        duration_ms,
        offset,
        vibe,
        budget,
        area: areaSel.kind,
        area_kind: areaSel.kind,
      });
    }
  };

  // Stash the built night so it survives the sign-in round-trip. Written on
  // RESULT RENDER (not on Save tap) — the sign-up band and the reshuffle
  // wall are also doors into /sign-in and must be covered too.
  const stashed = useRef("");
  useEffect(() => {
    if (!result) return;
    try {
      const json = JSON.stringify({
        stops: result.stops.map((s) => ({
          slug: s.slug,
          role: s.role,
          dwellMins: s.dwellMins,
          walkToNextMins: s.walkToNextMins,
        })),
        area: result.area,
        daypart: result.daypart,
        totalMins: result.totalMins,
        savedAt: Date.now(),
      });
      if (json !== stashed.current) {
        // Legacy one-shot stash. Still written so a user who is mid-flight
        // across this deploy — anon night stashed by the OLD code, sign-in
        // completed against the NEW code — is not stranded. The reader in
        // plan-flow keeps handling it. Remove once a deploy cycle has passed.
        window.localStorage.setItem(ANON_PLAN_STASH_KEY, json);
        // Canonical store. This is what survives a refresh on the anon side
        // and what claimAnonPlan() hands to the account after sign-in.
        const np = parseNightPlan({
          version: NIGHT_PLAN_VERSION,
          // The anon payload carries no title (it has no vibe control to
          // build the signed-in one from). Derive a plain one that keeps the
          // "Day Out" / "Night" convention the daypart inference in
          // fromSavedRow keys on, so a claimed night reads consistently.
          title: `${result.area} ${result.daypart === "day" ? "Day Out" : "Night"}`,
          area: result.area,
          // The anon brief has no vibe/budget control, so these are the
          // signed-in defaults. They affect regeneration only, never how the
          // night renders.
          vibe: "Chill" as const,
          budget: "££" as const,
          daypart:
            result.daypart === "day" ? ("day" as const) : ("evening" as const),
          startsAt: null,
          stops: result.stops.map((s) => ({
            // The anon payload is slug-keyed by design (it never carries
            // catalogue ids), so the slug is the id here too. hydrateStops
            // resolves by id first and falls back to slug, so this works
            // either way once it reaches a catalogue.
            venueId: s.slug,
            slug: s.slug,
            role: s.role as PlanRole,
            dwellMins: s.dwellMins,
            walkToNextMins: s.walkToNextMins,
          })),
          source: "anon" as const,
          savedRowId: null,
        });
        if (np) writeActivePlan(null, np);
        stashed.current = json;
      }
    } catch {
      /* private mode — the night just won't survive sign-in */
    }
  }, [result]);

  const signInHref = "/sign-in?return=%2Fplan";

  // Failure states render on BOTH screens (a reshuffle can fail too).
  const failureBlock = (
    <>
      {failure === "limited" && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-[13px] text-fg font-semibold m-0">
            You&apos;ve built a lot of nights just now.
          </p>
          <p className="text-[12px] text-muted-fg mt-1 mb-3">
            Sign up free to keep building, and to save the ones you like.
          </p>
          <Link
            href={signInHref}
            onClick={() => writeSignInTrigger("plan_rate_limited")}
            className="inline-flex h-10 px-5 items-center rounded-full bg-primary text-primary-fg text-[13px] font-extrabold"
          >
            Sign up free
          </Link>
        </div>
      )}
      {failure === "soft" && (
        <p className="mt-4 text-center text-[13px] text-muted-fg">
          That didn&apos;t build. Try again in a moment.
        </p>
      )}
    </>
  );

  // ── Result screen ──────────────────────────────────────────────────────
  if (step === "result" && result) {
    return (
      <div className="lg:max-w-4xl lg:mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-10 lg:items-start">
        {/* The screen's ONE gradient moment — .fl-grad so it carries the
            film grain (the inline-gradient shortcut skips it). */}
        <div className="fl-grad px-5 pt-5 pb-5 text-white lg:col-span-2 lg:rounded-3xl lg:mx-0">
          <button
            type="button"
            onClick={() => {
              setStep("setup");
              window.scrollTo({ top: 0 });
            }}
            className="relative bg-white/15 text-white rounded-lg px-2.5 py-1 text-[11px] font-bold mb-2.5"
          >
            ← Edit
          </button>
          <h2 className="relative text-[22px] font-extrabold m-0">
            {result.daypart === "day"
              ? "Today, the plan:"
              : "Tonight, the plan:"}
          </h2>
          <div className="relative text-xs opacity-90 mt-1.5">
            <MapPin
              className="w-3.5 h-3.5 inline-block align-[-3px]"
              strokeWidth={1.75}
              aria-hidden
            />{" "}
            {result.area === ANYWHERE
              ? "Across London"
              : `Around ${result.area}`}{" "}
            ·{" "}
            <Clock
              className="w-3.5 h-3.5 inline-block align-[-3px]"
              strokeWidth={1.75}
              aria-hidden
            />{" "}
            {fmtHours(result.totalMins)}
            {startLabel ? ` · from ${startLabel}` : ""}
          </div>
        </div>

        <div className="px-5 lg:px-0">
          <p className="text-[13px] text-muted-fg mt-3 mb-4">
            {result.rationale}
          </p>

          <ol className="list-none m-0 p-0 fl-stagger">
            {result.stops.map((s, i) => (
              <li key={s.slug}>
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="w-[26px] h-[26px] rounded-full border-2 border-accent text-accent grid place-items-center text-xs font-extrabold">
                    {i + 1}
                  </div>
                  <div className="text-[11px] font-extrabold tracking-[0.12em] text-muted-fg uppercase">
                    {s.role}
                  </div>
                  {s.arriveAtLabel && (
                    <div className="ml-auto text-[11px] text-muted-fg">
                      arrive{" "}
                      <span className="font-bold text-fg">
                        ~{s.arriveAtLabel}
                      </span>
                    </div>
                  )}
                </div>
                <Link
                  href={`/venue/${s.slug}`}
                  onClick={() => {
                    track("plan_stop_opened", { i });
                    writePlanHandoff(s.slug, i);
                  }}
                  className="flex gap-3 items-center rounded-2xl border border-border bg-card p-3 no-underline"
                >
                  <span className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-muted">
                    {s.imgUrl && (
                      <Image
                        src={s.imgUrl}
                        alt=""
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-extrabold text-heading truncate">
                      {s.name}
                    </span>
                    <span className="block text-[12px] text-muted-fg truncate">
                      {s.neighbourhood} · {s.type} · {s.price}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-muted-fg mt-0.5">
                      <span className="inline-flex items-center gap-0.5">
                        <Star
                          size={11}
                          className="text-accent"
                          fill="currentColor"
                        />
                        {s.rating.toFixed(1)}
                      </span>
                      ~{s.dwellMins} min here
                      {s.isOpenNow && (
                        <span className="text-accent font-semibold">
                          Open at arrival
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
                {s.walkToNextMins != null && (
                  <div className="ml-3 pl-3 py-1.5 border-l-2 border-dashed border-border text-[11px] text-muted-fg">
                    <Footprints
                      className="w-3.5 h-3.5 inline-block align-[-3px]"
                      strokeWidth={1.75}
                      aria-hidden
                    />{" "}
                    {s.walkToNextMins} min walk
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="px-5 lg:px-0 lg:sticky lg:top-24">
          <div className="mt-4 lg:mt-3 flex gap-2 lg:flex-col">
            <Link
              href={signInHref}
              onClick={() => writeSignInTrigger("plan_save")}
              className="flex-1 h-[46px] rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold inline-flex items-center justify-center gap-1.5 no-underline shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
            >
              <Heart size={15} />
              Save this night
            </Link>
            <button
              type="button"
              disabled={building}
              onClick={() => {
                if (reshuffles === 0) {
                  void build(1);
                } else {
                  setWallUp(true);
                }
              }}
              className="h-[46px] px-4 rounded-2xl border-[1.5px] border-border bg-card text-fg text-[14px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <RefreshCw
                size={15}
                className={building ? "animate-spin" : undefined}
              />
              {building ? "Rebuilding…" : "Reshuffle"}
            </button>
          </div>
          {failureBlock}
          <p className="mt-3 mb-0 text-center text-[12px] text-muted-fg">
            <MapPin size={11} className="inline -mt-0.5" /> Sign up free to save
            this night, see it on a map, and book the stops.
          </p>
        </div>

        {wallUp && (
          <AuthWall
            trigger="plan_rate_limited"
            signedIn={false}
            title="Sign up for more nights"
            body="You've seen two takes on your brief. A free account gets you endless reshuffles, saved nights and booking."
            onBack={() => setWallUp(false)}
            backLabel="Keep this one"
            returnTo="/plan"
          />
        )}
      </div>
    );
  }

  // ── Setup screen ───────────────────────────────────────────────────────
  return (
    <div className="lg:max-w-xl lg:mx-auto">
      {/* The plan's own header — same language as the signed-in setup. */}
      <div className="px-5 pt-4 pb-5">
        <h1 className="flex items-baseline gap-2.5 m-0 leading-none">
          <span
            className="text-xl italic font-medium text-muted-fg lowercase"
            suppressHydrationWarning
          >
            {eyebrow}
          </span>
          <span className="text-[32px] font-extrabold fl-grad-text lowercase tracking-tight">
            the plan
          </span>
        </h1>
        <div className="text-[13px] text-muted-fg mt-2">
          Two or three spots, a short walk apart, in the order you&apos;d do
          them. Try one, no account needed.
        </div>
        {result && (
          <button
            type="button"
            onClick={() => {
              setStep("result");
              window.scrollTo({ top: 0 });
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-accent text-accent px-3.5 py-1.5 text-[12px] font-bold"
          >
            Back to your night →
          </button>
        )}
      </div>

      <Group label="When">
        <WhenPicker
          choice={when}
          dateStr={customDate}
          timeStr={customTime}
          minDate={minDate}
          onChange={(next) => {
            markSetupStarted("when");
            setWhen(next.choice);
            setCustomDate(next.dateStr);
            setCustomTime(next.timeStr);
          }}
        />
      </Group>

      <Group label="Where">
        <AreaPicker
          value={areaSel}
          venues={[]}
          neighbourhoods={neighbourhoods}
          onChange={(a) => {
            markSetupStarted("where");
            setAreaSel(a);
          }}
        />
      </Group>

      <Group label="Vibe">
        <div className="grid grid-cols-2 gap-2">
          {VIBES.map(({ v, sub, Icon }) => {
            const on = vibe === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => {
                  markSetupStarted("vibe");
                  setVibe(v);
                }}
                className={
                  "px-3.5 py-3 rounded-[14px] border-[1.5px] text-left text-[13px] font-bold transition-colors " +
                  (on
                    ? "border-accent bg-accent/10 text-fg"
                    : "border-border bg-card text-fg")
                }
              >
                <span className="flex items-center gap-2">
                  <Icon
                    className="w-5 h-5 text-accent flex-shrink-0"
                    strokeWidth={1.75}
                  />
                  {v}
                </span>
                <span className="block text-[11px] font-normal text-muted-fg mt-0.5">
                  {sub}
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group label="Budget">
        <div className="grid grid-cols-3 gap-2">
          {BUDGETS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                markSetupStarted("budget");
                setBudget(b);
              }}
              className={
                "h-11 rounded-xl border-[1.5px] text-[13px] font-bold transition-colors " +
                (budget === b
                  ? "border-accent bg-accent/10 text-fg"
                  : "border-border bg-card text-fg")
              }
            >
              {b}
            </button>
          ))}
        </div>
      </Group>

      <div className="px-5">
        <button
          type="button"
          onClick={() => {
            setReshuffles(0);
            void build(0);
          }}
          disabled={building}
          className="mt-2 w-full h-[52px] rounded-2xl bg-primary text-primary-fg text-[15px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-60 shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
        >
          <Sparkles size={18} />
          {building ? "Building your night…" : "Build my night"}
        </button>
        {failureBlock}
      </div>

      <div className="mt-6">
        <PlanTogetherCard />
      </div>
    </div>
  );
}
