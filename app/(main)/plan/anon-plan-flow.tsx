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
// Moat: this file never sees the catalogue. The engine runs server-side
// (lib/plan-preview.ts, service-role, server-only); what arrives here is 3
// card-level stops — the same fields any anon venue page shows. This module
// must NOT import lib/supabase/client, lib/signals, or lib/queries (pinned
// by plan-preview-guard).
//
// The built night SURVIVES sign-in: on result render it is stashed in
// localStorage (localStorage, not sessionStorage — magic links open in a
// new tab and sessionStorage dies with the old one), and PlanFlow hydrates
// it through its openSaved path after the OAuth round-trip. Signing up to
// save a night and landing on empty controls was the gate review's
// number-one conversion killer.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Sparkles,
  Footprints,
  Star,
  RefreshCw,
  Heart,
  MapPin,
} from "lucide-react";
import { AuthWall } from "@/components/auth-wall";
import {
  WhenPicker,
  AreaPicker,
  toISODate,
  toPlanArea,
  type WhenChoice,
  type AreaSel,
} from "./plan-controls";
import { buildAnonPlan } from "@/lib/plan-preview-action";
import type { AnonPlanPayload } from "@/lib/plan-preview-shape";
import { track } from "@/lib/analytics";

export const ANON_PLAN_STASH_KEY = "fl.anonplan.v1";
const STASH_TTL_MS = 60 * 60 * 1000;

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

const VIBES: { v: "Chill" | "Lively" | "Fancy" | "Unique"; sub: string }[] = [
  { v: "Chill", sub: "easy pace, good corners" },
  { v: "Lively", sub: "buzz, noise, people" },
  { v: "Fancy", sub: "a proper occasion" },
  { v: "Unique", sub: "only-in-London stuff" },
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
  useEffect(() => setMinDate(toISODate(new Date())), []);

  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<AnonPlanPayload | null>(null);
  const [failure, setFailure] = useState<"limited" | "soft" | null>(null);
  // One free reshuffle (offset 1); the 2nd raises the wall. The engine is
  // deterministic per offset, so a walled FIRST reshuffle would protect
  // nothing Build doesn't already expose — while forfeiting the "it has
  // depth" proof (ux gate condition 2).
  const [reshuffles, setReshuffles] = useState(0);
  const [wallUp, setWallUp] = useState(false);

  const build = async (offset: 0 | 1) => {
    setBuilding(true);
    setFailure(null);
    const t = resolveAnonTiming(when, customDate, customTime);
    const res = await buildAnonPlan({
      vibe,
      budget,
      area: toPlanArea(areaSel),
      daypart: t.daypart,
      whenISO: t.whenISO,
      offset,
    });
    setBuilding(false);
    if (res.ok) {
      setResult(res);
      track("plan_preview_built", {
        vibe,
        budget,
        area: areaSel.kind,
        offset,
      });
    } else if (res.reason === "limited") {
      setFailure("limited");
    } else {
      setFailure("soft");
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
        window.localStorage.setItem(ANON_PLAN_STASH_KEY, json);
        stashed.current = json;
      }
    } catch {
      /* private mode — the night just won't survive sign-in */
    }
  }, [result]);

  const signInHref = "/sign-in?return=%2Fplan";
  const hrs = Math.floor((result?.totalMins ?? 0) / 60);
  const mins = (result?.totalMins ?? 0) % 60;

  return (
    <div className="px-5">
      {/* ── The brief ── */}
      <section className="mt-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-fg mb-2">
          When
        </p>
        <WhenPicker
          choice={when}
          dateStr={customDate}
          timeStr={customTime}
          minDate={minDate}
          onChange={(next) => {
            setWhen(next.choice);
            setCustomDate(next.dateStr);
            setCustomTime(next.timeStr);
          }}
        />
      </section>

      <section className="mt-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-fg mb-2">
          Where
        </p>
        <AreaPicker
          value={areaSel}
          venues={[]}
          neighbourhoods={neighbourhoods}
          onChange={setAreaSel}
        />
      </section>

      <section className="mt-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-fg mb-2">
          Vibe
        </p>
        <div className="grid grid-cols-2 gap-2">
          {VIBES.map((v) => {
            const on = vibe === v.v;
            return (
              <button
                key={v.v}
                type="button"
                onClick={() => setVibe(v.v)}
                className={
                  "px-3.5 py-3 rounded-[14px] border-[1.5px] text-left text-[13px] font-bold transition-colors " +
                  (on
                    ? "border-primary bg-primary/10 text-fg"
                    : "border-border bg-card text-fg")
                }
              >
                {v.v}
                <span className="block text-[11px] font-normal text-muted-fg mt-0.5">
                  {v.sub}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-fg mb-2">
          Budget
        </p>
        <div className="grid grid-cols-3 gap-2">
          {BUDGETS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBudget(b)}
              className={
                "py-2.5 rounded-[14px] border-[1.5px] text-[13px] font-bold transition-colors " +
                (budget === b
                  ? "border-primary bg-primary/10 text-fg"
                  : "border-border bg-card text-fg")
              }
            >
              {b}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => {
          setReshuffles(0);
          void build(0);
        }}
        disabled={building}
        className="mt-6 w-full h-[52px] rounded-2xl bg-primary text-primary-fg text-[15px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-60"
      >
        <Sparkles className="w-4.5 h-4.5" size={18} />
        {building ? "Building your night…" : "Build my night"}
      </button>

      {/* Rate-limited = a sign-up moment, never an error dead-end. */}
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

      {/* ── The night ── */}
      {result && (
        <section className="mt-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-fg mb-1">
            Your {result.daypart === "day" ? "day out" : "night"} ·{" "}
            {hrs > 0 ? `${hrs}h ` : ""}
            {mins > 0 ? `${mins}m` : hrs > 0 ? "" : "·"}
          </p>
          <p className="text-[13px] text-muted-fg mt-0 mb-4">
            {result.rationale}
          </p>

          <ol className="list-none m-0 p-0">
            {result.stops.map((s, i) => (
              <li key={s.slug}>
                <Link
                  href={`/venue/${s.slug}`}
                  onClick={() => track("plan_stop_opened", { i })}
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
                      {i + 1}. {s.name}
                    </span>
                    <span className="block text-[12px] text-muted-fg truncate">
                      {s.neighbourhood} · {s.type} · {s.price}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-muted-fg mt-0.5">
                      <span className="inline-flex items-center gap-0.5">
                        <Star size={11} className="text-primary" />
                        {s.rating.toFixed(1)}
                      </span>
                      ~{s.dwellMins} min here
                      {s.isOpenNow && (
                        <span className="text-primary font-semibold">
                          Open at arrival
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
                {s.walkToNextMins != null && (
                  <div className="flex items-center gap-2 pl-8 py-1.5 text-[11px] text-muted-fg">
                    <Footprints size={12} />
                    {s.walkToNextMins} min walk
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-4 flex gap-2">
            <Link
              href={signInHref}
              className="flex-1 h-[46px] rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold inline-flex items-center justify-center gap-1.5 no-underline"
            >
              <Heart size={15} />
              Save this night
            </Link>
            <button
              type="button"
              disabled={building}
              onClick={() => {
                if (reshuffles === 0) {
                  setReshuffles(1);
                  void build(1);
                } else {
                  setWallUp(true);
                }
              }}
              className="h-[46px] px-4 rounded-2xl border-[1.5px] border-border bg-card text-fg text-[14px] font-bold inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw size={15} />
              Reshuffle
            </button>
          </div>

          <p className="mt-3 mb-0 text-center text-[12px] text-muted-fg">
            <MapPin size={11} className="inline -mt-0.5" /> Sign up free to save
            this night, see it on a map, and book the stops.
          </p>
        </section>
      )}

      {wallUp && (
        <AuthWall
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
