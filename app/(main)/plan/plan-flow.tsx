"use client";

// Plan My Night — real recommender (Epic B). The setup form feeds the
// pure engine in lib/plan-engine.ts, which actually uses vibe + budget,
// scores venues for fit, and computes real walk times from coordinates.
//
// Extras over the old prototype port:
//   • "Try another combination" reshuffles within the same constraints.
//   • Signed-in users can save a night to public.plans and re-open it.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  type LucideIcon,
  Sparkles,
  Flame,
  Gem,
  Drama,
  Map as MapIcon,
  MapPin,
  Clock,
  Footprints,
  RotateCw,
  AlertCircle,
  Undo2,
  Check,
  Star,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  computePlan,
  alternativesFor,
  withinWalkOfAll,
  closedOnArrival,
  shiftReducesClosed,
  withinBudget,
  relinkSteps,
  isDaytimeHour,
  ANYWHERE,
  type Plan,
  type PlanBudget,
  type PlanRole,
  type PlanVibe,
  type PlanDaypart,
} from "@/lib/plan-engine";
import { regionOf, type PlanArea } from "@/lib/regions";
import {
  track,
  type SaveMode,
  type SwapMethod,
  type SetupControl,
} from "@/lib/analytics";
import { saveFailReason } from "@/lib/analytics-reasons";
import { writePlanHandoff, writeSignInTrigger } from "@/lib/analytics-keys";
import { recordSignal } from "@/lib/signals";
import { googleMapsWalkingUrl } from "@/lib/plan-maps";
import { PlanRouteMapLive } from "./plan-route-map-live";

import {
  fromEnginePlan,
  fromSavedRow,
  toSavedSteps,
  hydrateStops,
  isFresh,
  type NightPlan,
  type NightPlanSource,
} from "@/lib/night-plan";
import {
  readActivePlan,
  writeActivePlan,
  readUndoStack,
  writeUndoStack,
  clearActivePlan,
  claimAnonPlan,
  ANON_PLAN_STASH_KEY,
  ANON_RESULT_KEY,
} from "@/lib/active-plan";
import { nextInCycle } from "@/lib/plan-cycle";
import {
  entriesFor,
  originalStops as originalStopsOf,
  replacedCount as countReplaced,
  canUndo as canUndoFrom,
} from "@/lib/plan-history";
import { SwipeStop } from "./swipe-stop";
import {
  WhenPicker,
  AreaPicker,
  toISODate,
  toPlanArea,
  type WhenChoice,
  type AreaSel,
  Group,
} from "./plan-controls";
import type { Venue } from "@/lib/types";

const VIBES: { v: PlanVibe; icon: LucideIcon }[] = [
  { v: "Chill", icon: Sparkles },
  { v: "Lively", icon: Flame },
  { v: "Fancy", icon: Gem },
  { v: "Unique", icon: Drama },
];

const BUDGETS: PlanBudget[] = ["£", "££", "Any"];

// When + Area selection types/helpers (WhenChoice, WHENS, toISODate, AreaSel,
// toPlanArea) + the pickers themselves now live in ./plan-controls, shared with
// Plan Together's host settings so the two can't drift. resolveTiming below maps
// a WhenChoice to the solo plan's daypart + clock.

// Resolve a When choice into the daypart (plan shape) + the start clock the
// engine walks. `base` is the live clock, passed in so this stays pure and the
// caller controls hydration timing (no Date() before mount).
function resolveTiming(
  choice: WhenChoice,
  customDate: string,
  customTime: string,
  base: Date,
): { daypart: PlanDaypart; when: Date; tracksClock: boolean } {
  // 🧨 `tracksClock` belongs HERE, next to the branches, not at the call site.
  // Deriving it from `choice === "now"` under-detected by two thirds: "Today"
  // picked during the day, and "Tonight" picked when it is already evening,
  // both return `base` — the same snapshot of the clock — and were classed as
  // fixed times. Restoring one then pinned the When control to a stamp already
  // going stale, which is precisely what the flag exists to prevent. Computed
  // beside the branch it describes, it cannot drift from it.
  const at = (h: number, m = 0) => {
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
  };
  // 05:00–16:59 reads as "day"; from 5pm on — and through the small hours until
  // 5am — "evening" (a plan built at 1am is a night out). See isDaytimeHour.
  const isDayNow = isDaytimeHour(base.getHours());
  switch (choice) {
    case "day":
      // A daytime plan: use now if it's still daytime, else a representative 1pm.
      return {
        daypart: "day",
        when: isDayNow ? base : at(13),
        tracksClock: isDayNow,
      };
    case "evening":
      // A night out: use now if it's already evening, else 7pm tonight.
      return {
        daypart: "evening",
        when: isDayNow ? at(19) : base,
        tracksClock: !isDayNow,
      };
    case "custom": {
      // A specific calendar day + clock time. The day matters for the
      // open-at-arrival checks — venues keep different hours by weekday.
      const [h, m] = customTime.split(":").map(Number);
      const when = new Date(base);
      const [y, mo, d] = customDate.split("-").map(Number);
      if (y && mo && d) when.setFullYear(y, mo - 1, d);
      when.setHours(
        Number.isFinite(h) ? h : 20,
        Number.isFinite(m) ? m : 0,
        0,
        0,
      );
      return {
        daypart: isDaytimeHour(when.getHours()) ? "day" : "evening",
        when,
        // A specific calendar day and clock time: pinned by definition.
        tracksClock: false,
      };
    }
    default: // "now" — plan for this moment, shape follows the clock.
      return {
        daypart: isDayNow ? "day" : "evening",
        when: base,
        tracksClock: true,
      };
  }
}

// A render-ready plan shared by freshly-computed and re-opened-saved plans.
type DisplayPlan = {
  title: string;
  area: string;
  daypart: PlanDaypart;
  totalMins: number;
  steps: {
    venue: Venue;
    role: PlanRole;
    dwellMins: number;
    walkToNextMins: number | null;
    // Estimated arrival time (Stage 4.2). Present whenever the night knows
    // when it starts: a freshly computed plan, and a restored one that
    // `activate` relinked from its own `startsAt`. Absent on a re-opened saved
    // row, which stores no start time, and on a night that has already ended.
    arriveAt?: Date | null;
  }[];
};

type SavedPlanRow = {
  id: string;
  title: string;
  neighbourhood: string;
  steps: {
    venueId: string;
    role: PlanRole;
    dwellMins: number;
    walkToNextMins: number | null;
  }[];
};

function fmtHours(mins: number): string {
  const h = mins / 60;
  return `~${h.toFixed(1)} h total`;
}

// "11:01 pm" — the estimated arrival time at a stop (Stage 4.2).
function fmtTime(d: Date): string {
  return d
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
}

// A descriptive name for saving + the saved-list (NOT the result header, which
// is the dynamic "Tonight/Today, the plan:"). plan.area is the RESOLVED pocket
// the night landed in, so a saved night reads as a real place: "Chill Night in
// Shoreditch" even when the user only picked "East" or "Anywhere".
function titleFor(plan: Plan, area: string): string {
  const kind = plan.daypart === "day" ? "Day Out" : "Night";
  const where = area === ANYWHERE ? "London" : area;
  return `${plan.vibe} ${kind} in ${where}`;
}

// The night as it is rendered, with any per-stop replacements already applied.
// Replacing a venue changes its dwell, the walk to and from it and every
// downstream arrival, so the whole sequence is relinked
// (lib/plan-engine.relinkSteps) to stay honest. What has been replaced lives in
// `EditedNight` below, keyed to the night it belongs to.
// The resolved pocket (and title) follow the possibly-swapped first stop.

/**
 * useLayoutEffect on the client, useEffect on the server.
 *
 * React warns that useLayoutEffect does nothing during SSR — true, and
 * harmless here, since the restore it drives reads localStorage and could
 * never have run on the server anyway. This keeps the warning out of the logs
 * without giving up the before-paint timing that removes the setup-form flash.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** The night as the user has edited it: its stops, plus where each changed
 *  stop sits in the option list it was last picked from. `key` identifies the
 *  underlying night, so edits are dropped the moment a different one is on
 *  screen rather than leaking onto it. */
type EditedNight = {
  key: unknown;
  stops: { venue: Venue; role: PlanRole }[];
  // 🧨 The venue ids already OFFERED for each stop, in order — not a position.
  // A position is meaningless here: the list is rebuilt on every tap and the
  // original is prepended only while the stop is actually replaced, so the
  // length and offset shift underneath a stored index. Traced with four
  // candidates {A original, B, C, D}, an index gave A→B→C→D→A→C→D→A…: B was
  // never offered again, so the top-ranked alternative became permanently
  // unreachable however long the user tapped. Tracking what has been SHOWN
  // reaches every option before repeating any, under any rebuild.
  cycle: Record<number, string[]>;
};

/** How many replacements Undo can walk back through. */
const UNDO_DEPTH = 20;

export function PlanFlow({
  venues,
  authUserId,
  tasteScores,
}: {
  venues: Venue[];
  authUserId: string | null;
  tasteScores: Record<string, number> | null;
}) {
  const [step, setStep] = useState<"setup" | "result">("setup");
  const [when, setWhen] = useState<WhenChoice>("now");
  // For the "Pick a day" path: a calendar date (YYYY-MM-DD, "" = today) + time.
  const [customDate, setCustomDate] = useState<string>("");
  const [customTime, setCustomTime] = useState<string>("20:00");
  // WHERE. Defaults to Anywhere — never a single neighbourhood — so the engine
  // is free to find the best walkable pocket. (See AreaSel above.)
  const [areaSel, setAreaSel] = useState<AreaSel>({ kind: "anywhere" });
  // Set when the user picks "Near you" and the browser grants location — the
  // engine then keeps the night within a short walk of this point. Cleared
  // whenever another area is chosen.
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [geoState, setGeoState] = useState<"idle" | "pending" | "denied">(
    "idle",
  );
  const [vibe, setVibe] = useState<PlanVibe>("Chill");
  const [budget, setBudget] = useState<PlanBudget>("££");
  const [offset, setOffset] = useState(0);

  // The night on screen INSTEAD of the live-computed one: restored from the
  // store, claimed from an anonymous session, or re-opened from the Saved
  // list. Null means "show whatever the engine just computed".
  //
  // 🧨 ONE state, not two. The night and WHERE IT CAME FROM are a single fact,
  // and the first version of this stored them apart — `openedSaved` for the
  // plan, `activeSource` for its origin. Three call sites cleared the plan and
  // left the source behind, so after Reopen saved -> Edit -> Build the screen
  // showed a freshly generated night still locked read-only: no Save, no Try
  // another, no per-stop Change. Adding a fourth clear would have fixed that
  // instance and left the next one to be discovered the same way. Held in one
  // object, the desync is unrepresentable.
  //
  // No night is read-only any more. `alternatives` below gives EVERY night on
  // screen real swap options computed from its own stops, and a reopened saved
  // row is savable too — `alreadySaved` decides whether the button offers to
  // save it or reports that it already is. `source` still matters: it picks
  // the freshness anchor, the analytics dimension, and whether the vibe and
  // budget controls are treated as this night's brief.
  //
  // `base` is the night as it was activated. Per-stop replacements live in
  // `edited` on top of it, exactly as they do for a live night on top of
  // `computed`, so one mechanism serves both and one Undo unwinds both.
  const [active, setActive] = useState<{
    base: DisplayPlan;
    source: NightPlanSource;
    // 🧨 The night's OWN start, resolved once in `activate` — including the
    // guard that drops the clock when the whole night has already finished.
    // `display` used to relink an active night from `timing?.when`, i.e. from
    // the setup controls, so a reopened saved row (which has no start time in
    // `plans` at all) rendered a bold invented "arrive ~7:00 pm" on every
    // stop, and reopening a saved Day Out at 8pm read "arrive ~1:00 pm". A
    // confidently wrong fact in the boldest text on the card, on a screen
    // whose job is to remove doubt. `undefined` means: show no arrivals.
    startsAt: Date | undefined;
    // 🧨 The NightPlan this came from, HELD HERE rather than in a ref beside
    // it. This file already learned that lesson once (see the note above on
    // collapsing `openedSaved` and `activeSource`), and a ref reintroduced
    // it: the legacy-stash path called setActive without touching the ref, so
    // the persist effect could write one night's stops under another night's
    // createdAt, source and offset. Null for the legacy stash, which carries
    // none of those fields.
    plan: NightPlan | null;
  } | null>(null);
  // Previous `edited` states, newest last. One entry per replacement, so Undo
  // walks back through them rather than only reverting the last one — a user
  // who taps Change four times and dislikes the third needs more than a single
  // step back, and cycling forward until it wraps is not the same thing.
  const [undoStack, setUndoStack] = useState<EditedNight[]>([]);
  // Synchronous mirror of `edited`, so a deferred handler (SwipeStop's 180 ms
  // timeout) never computes from a stale render closure.
  const editedRef = useRef<EditedNight | null>(null);
  // The night currently on screen, mirrored so a handler that fires late can
  // tell whether the night it was created for is still the one in front of the
  // user.
  //
  // 🧨 SEEDED FROM A LAYOUT EFFECT, not from inside the handler. It was
  // written at the END of onSwap — below the guard that reads it — so it was
  // never seeded at all: `null !== computed` on the very first tap, and the
  // handler returned on its first line. Change, swipe and Undo did nothing, on
  // every night, for eight commits, while 578 tests stayed green because none
  // of them touched this wiring. A guard whose only writer sits after it is
  // not a guard; it is an early return.
  const editKeyRef = useRef<unknown>(null);
  const [savedPlans, setSavedPlans] = useState<SavedPlanRow[]>([]);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  // ── Analytics-only refs (no product behaviour depends on these) ──────
  // Fire-once latch for plan_setup_started. A ref, not state: flipping it must
  // not re-render, and it must survive the input edits that reset saveState.
  const setupStartedRef = useRef(false);
  // Save attempt counter. Lives outside saveState because saveState is reset to
  // "idle" by every input edit and by a reshuffle, so it cannot count retries.
  const saveAttemptRef = useRef(0);
  // True when this night began life as an anonymous preview carried through
  // the sign-in round trip. Rides on the save events as `anon_origin`; the
  // `plan_origin` dimension carries the finer distinction between a live,
  // restored, claimed and reopened night.
  const anonOriginRef = useRef(false);
  // Standing the restored night down also ends its provenance. Without this,
  // claim -> "Try another combination" -> Save sent anon_origin: true on a
  // night generated ten seconds earlier — a wrong dimension, which this file
  // argues elsewhere is worse than a missing one.
  const standDown = useCallback(() => {
    setConfirmReshuffle(false);
    setConfirmEdit(false);
    setStartShiftMins(0);
    setActive(null);
    anonOriginRef.current = false;
    // The replacement history belongs to the night being stood down.
    setUndoStack([]);
  }, []);
  // 🧨 Freshness is measured from GENERATION, not from the last write. The
  // effect below re-persists on every swap, and stamping a fresh createdAt
  // there would push the 12h window out each time the user fiddled with a
  // stop — a Friday night would still read as fresh on Sunday. Keyed on the
  // engine result's identity, so it survives swaps and resets exactly when the
  // engine actually produces a different night.
  const genStampRef = useRef<{ src: Plan | null; at: string }>({
    src: null,
    at: "",
  });
  // Whether the saved-plans list actually loaded. loadSavedPlans swallows its
  // error, so without this a failed load would make every save look like "new".
  const savedListLoadedRef = useRef(false);
  // 🧨 The same fact as the ref above, in state, because the SAVE BUTTON now
  // depends on it. `alreadySaved` is false while the list is in flight or
  // after it errors, and a reopened saved night restores from localStorage
  // instantly — so the button read "Save this night", enabled, on a night that
  // was already saved. `plans` is insert-only with no delete UI, so that
  // duplicate is permanent. The button is the only signal a reopened night is
  // already saved, so it must not guess.
  const [savedListLoaded, setSavedListLoaded] = useState(false);
  // 🧨 The load FAILED, as distinct from "not back yet". Save is disabled on a
  // reopened night until the list is known, because guessing wrong writes a
  // permanent duplicate into an insert-only table — but a disabled button with
  // no message is indistinguishable from a broken one, and loadSavedPlans only
  // re-runs when authUserId changes, so it stayed that way for the whole
  // mount. The user gets told, and gets a way to try again.
  const [savedListFailed, setSavedListFailed] = useState(false);

  // Current time, set AFTER mount so the open-now plan filter can't cause an
  // SSR/client hydration mismatch: the server renders fail-open (when=undefined),
  // then the client applies real opening hours once mounted.
  const [now, setNow] = useState<Date | undefined>(undefined);
  useEffect(() => setNow(new Date()), []);

  const venueBySlug = useMemo(() => {
    const m = new Map<string, Venue>();
    for (const v of venues) m.set(v.slug, v);
    return m;
  }, [venues]);

  const venueById = useMemo(() => {
    const m = new Map<string, Venue>();
    for (const v of venues) m.set(v.id, v);
    return m;
  }, [venues]);

  // Today's date (YYYY-MM-DD), known post-mount — the floor for the date picker
  // (no planning the past) and its default when the user hasn't picked one.
  const todayISO = now ? toISODate(now) : "";

  // Resolve the When answer into (daypart, start clock) once the live clock is
  // known (post-mount). null before mount → engine infers + fails open on hours,
  // matching the SSR render so there's no hydration mismatch.
  const timing = useMemo(
    () =>
      now ? resolveTiming(when, customDate || todayISO, customTime, now) : null,
    [when, customDate, todayISO, customTime, now],
  );

  const computed = useMemo(
    () =>
      computePlan(venues, {
        area: toPlanArea(areaSel),
        vibe,
        budget,
        offset,
        when: timing?.when,
        daypart: timing?.daypart,
        center: areaSel.kind === "nearYou" ? center : null,
        tasteScores,
      }),
    [venues, areaSel, vibe, budget, offset, timing, center, tasteScores],
  );

  /**
   * Swap options for the night on screen, and the night itself as an editable
   * list of stops.
   *
   * 🧨 OPTIONS ARE RECOMPUTED AGAINST THE CURRENT STOPS, AND BOUNDED BY BOTH
   * ADJACENT ONES.
   *
   * Two rules, each paid for. The first draft anchored options to the night's
   * base, for index stability — rebuild the list after every replacement and
   * position 2 means a different venue each time. The cost was route
   * coherence: stop 2's candidates were measured against the ORIGINAL stop 1,
   * so once stop 1 had itself moved up to the radius away the pair could end
   * up roughly twice that apart, and relinkSteps reported it honestly — "~26
   * min walk" printed on a walkable night. Coherence wins; ordering does not
   * survive a rebuild, and that is the accepted trade.
   *
   * The second rule came from the test written for the first, which failed at
   * the seventh replacement. "Within a short walk of ANY other stop" looks
   * equivalent on three stops and is not: move stop 0 beside stop 1, then stop
   * 1 beside stop 2, and stop 0 is stranded — every hop legal, the route not.
   * `withinWalkOfAll` over the ADJACENT stops is exactly the walk shown.
   */
  const baseStops = useMemo(
    () =>
      (active ? active.base.steps : computed.steps).map((s) => ({
        venue: s.venue,
        role: s.role,
      })),
    [active, computed],
  );

  // Reset-on-key-change rather than an effect: `editKey` is the identity of
  // the underlying night, so generating, reshuffling or activating a different
  // one drops the edits in the same render instead of one frame later.
  const editKey: unknown = active ?? computed;
  // The named type, not a second copy of its shape: the inline one had already
  // drifted from EditedNight and only a type error caught it.
  const [edited, setEdited] = useState<EditedNight | null>(null);
  useIsomorphicLayoutEffect(() => {
    editKeyRef.current = editKey;
  }, [editKey]);
  const current = edited?.key === editKey ? edited : null;
  const stops = current?.stops ?? baseStops;
  const cycle = current?.cycle ?? {};

  // A restored night keeps its own clock; a live one follows the controls.
  // How far the user has nudged the start, in minutes (negative = earlier).
  // Session-level: reset whenever the night changes, carried into the persist
  // below so a refresh keeps it.
  const [startShiftMins, setStartShiftMins] = useState(0);

  // 🧨 A REOPENED SAVED ROW GETS A CLOCK ONLY WHEN THAT CLOCK IS *NOW*.
  // `plans` stores no start time, so these nights had none — honest about
  // arrivals, but it also disabled every opening-hours check: a saved night
  // could offer a shut venue and warn about nothing. The first fix fell back
  // to the seeded controls' representative time, and that re-entered the
  // exact bug this file records as fixed: reopening a saved Day Out at 8pm
  // printed "arrive ~1:00 pm" — seven hours in the past, in the boldest text
  // on the card, from a clock shown nowhere on the screen. `tracksClock` is
  // the discriminator resolveTiming already computes: TRUE exactly when it
  // returned the live clock. A reopened evening night viewed in the evening
  // shows arrivals anchored to the moment the page loaded — verifiable,
  // never invented, though nothing on screen labels the anchor (the header
  // carries no start time; a known limitation) — and any other combination
  // keeps no clock at all rather than a wrong one.
  const nightWhen = useMemo(() => {
    // Generated/claimed nights with no `startsAt` stay clockless: the
    // finished-night guard dropped it deliberately, and resurrecting it
    // would print arrivals for a night that is already over.
    const base = active
      ? (active.startsAt ??
        (active.source === "saved" && timing?.tracksClock
          ? timing.when
          : undefined))
      : timing?.when;
    if (!base || startShiftMins === 0) return base;
    return new Date(base.getTime() + startShiftMins * 60_000);
  }, [active, timing, startShiftMins]);

  // Built once here and used by both the render and the handlers, so the list
  // a user is offered is provably the list the tap picks from.
  const buildOptions = useCallback(
    (
      forStops: { venue: Venue; role: PlanRole }[],
      opts?: { ignoreHours?: boolean },
    ): Venue[][] => {
      const effectiveBudget = active?.source === "saved" ? "Any" : budget;
      const inBudget = venues.filter((v) =>
        withinBudget(v.price, effectiveBudget),
      );
      // 🧨 RELINKED, so each stop carries its `arriveAt`. alternativesFor's
      // open check is `!when || !c.arriveAt || isOpenAt(...)`, so feeding it
      // bare {venue, role} objects short-circuits that clause to true and the
      // opening-hours filter silently does nothing — a 22:40 night could offer
      // a Finish that shut at 22:00, under a card printing "arrive ~23:05".
      // The arrivals have to be recomputed after every replacement anyway.
      const timed = relinkSteps(forStops, nightWhen);
      const lists = alternativesFor(
        inBudget.length >= 3 ? inBudget : venues,
        timed,
        {
          vibe,
          budget: effectiveBudget,
          daypart: active ? active.base.daypart : computed.daypart,
          // Dropping the clock disables both hours checks, which is exactly
          // what the diagnosis above needs to isolate them.
          when: opts?.ignoreHours ? undefined : nightWhen,
          tasteScores,
        },
      );
      // Re-offer the stop's venue from the night's BASE when it is still
      // walkable with the
      // neighbours as they now stand. Without it a replacement is one-way: the
      // current venue is excluded from its own list, so cycling could never
      // bring back what you started with. Tested with the SAME predicate the
      // list was built with, so the two cannot disagree.
      //
      // 🧨 Tested with `withinWalkOfAll` against the ADJACENT stops — the walk
      // rule only, which is NO LONGER full parity with the list. The list is
      // now built with walk PLUS open-at-arrival PLUS the later-stop rule, so
      // cycling can put back a venue that is shut when you get there. That is
      // deliberate: the original must stay reachable or a replacement is
      // one-way, and the closed-stop notice covers the case out loud. Do not
      // read this as "the two agree" — they do not, and the exemption is the
      // point. An earlier version used the
      // looser withinWalkOfAny over every other stop, so the one venue added
      // here by hand could have been the single option that broke the walk.
      //
      // The neighbours are NOT identical to the list's, and deliberately so:
      // `alternativesFor` self-anchors a stop that has none, this does not. On
      // a one-stop night that makes the check vacuous and the original always
      // reachable — which is the point. Copying the self-anchor in here would
      // measure the original against the venue that REPLACED it, so a stop
      // that had drifted could never be put back. Do not "restore parity".
      return lists.map((list, i) => {
        const original = baseStops[i]?.venue;
        if (!original || original.id === forStops[i]?.venue.id) return list;
        const neighbours = [forStops[i - 1], forStops[i + 1]]
          .filter(Boolean)
          .map((x) => x.venue);
        if (!withinWalkOfAll(original, neighbours)) return list;
        return [original, ...list.filter((v) => v.id !== original.id)];
      });
    },
    [
      active,
      baseStops,
      budget,
      computed.daypart,
      nightWhen,
      tasteScores,
      venues,
      vibe,
    ],
  );

  // 🧨 ONE pass over the catalogue, not one per stop. `alternativesFor` already
  // computes every stop's list, so calling it once per stop and keeping index
  // `i` re-filtered a ~2,100-venue catalogue three times and threw away two
  // thirds of every pass — on the main thread, on a phone, on every recompute.
  const alternatives = useMemo(
    () => buildOptions(stops),
    [buildOptions, stops],
  );

  // Memoised because the persist effect below depends on it: an unmemoised
  // `display` is a new object every render, so the effect's dep array never
  // matched and a synchronous localStorage write fired on every single render
  // of the result screen.
  const display: DisplayPlan = useMemo(() => {
    // relinkSteps is what keeps a replacement honest: it recomputes dwell, the
    // walk to the NEXT stop and every arrival after it, in place, so the route
    // stays coherent and the map (which renders display.steps) follows.
    const steps = relinkSteps(stops, nightWhen);
    const totalMins = steps.reduce(
      (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
      0,
    );
    if (active) {
      return {
        // Title and area stay the night's own. A reopened "Fancy Night in
        // Shoreditch" that swaps one stop is still that night; re-deriving
        // them from the first stop the way a freshly generated plan does would
        // rename the thing the user saved out from under them.
        title: active.base.title,
        area: active.base.area,
        daypart: active.base.daypart,
        totalMins,
        steps,
      };
    }
    // A live night names itself from where it landed, as it always has.
    const area = steps[0]?.venue.neighbourhood || computed.area;
    return {
      title: titleFor(computed, area),
      area,
      daypart: computed.daypart,
      totalMins,
      steps,
    };
  }, [active, computed, nightWhen, stops]);

  // Stops that will be SHUT when the user gets there. A replacement moves
  // every later arrival, and undo restores an arrangement that was valid when
  // it was made — either can leave a stop the user KEPT closed. Offering only
  // open candidates is half the job; saying so is the other half.
  //
  // NOT from clock drift: `now` is sampled once at mount and never ticks, so
  // sitting on the page cannot trigger this. An earlier version of this
  // comment claimed it could, which would have sent the next reader looking
  // for a bug in the wrong place.
  const closedStops = closedOnArrival(display.steps);

  // 🧨 "Start earlier" exists ON THIS SCREEN now. The closed-stop warning used
  // to suggest starting earlier while the only route to a time control was
  // "← Edit" — which discards the night, its replacements and its history. A
  // 30-minute step back re-anchors the clock in place: arrivals, the
  // hours checks and every option list recompute from the shifted start, and
  // the persist below carries it, so it survives a refresh. Hidden when the
  // shifted start would be in the past — you cannot start before now — and
  // when nothing is shut, because a night with no problem needs no lever.
  const EARLIER_STEP_MINS = 30;
  // 🧨 ...and only when the shift would actually HELP. closedOnArrival is
  // "not open at arrival", which is true in BOTH directions — a music room
  // that OPENS at 23:00 with arrival 22:40 is "closed" too, and stepping the
  // night earlier moves it further from the fix on every tap, with the copy
  // instructing exactly that. The chip simulates the shifted night and shows
  // only when it reduces the count. Date.now() in render is impure but safe
  // here: the result screen never SSRs (`step` starts at "setup"). Staleness
  // cuts the retiring way — nightWhen is frozen at mount while Date.now()
  // ticks, so on a long-open page the chip retires itself as the real clock
  // catches the night's start. Conservative in the right direction: it stops
  // offering to move a start into the past.
  const canStartEarlier =
    closedStops.length > 0 &&
    nightWhen != null &&
    nightWhen.getTime() - EARLIER_STEP_MINS * 60_000 >= Date.now() - 60_000 &&
    shiftReducesClosed(stops, nightWhen, -EARLIER_STEP_MINS);
  const startEarlier = () => {
    if (!canStartEarlier) return;
    // One source for both the state and the event, so a double-tap cannot
    // report the same shift twice at different true values. saveState is NOT
    // reset here: the shift does not change the night's venues, and wiping a
    // "Couldn't save" message with an unrelated tap erased the screen's only
    // error report.
    const next = startShiftMins - EARLIER_STEP_MINS;
    setStartShiftMins(next);
    track("plan_start_earlier", {
      shift_mins: next,
      closed_stops: closedStops.length,
    });
  };

  // 🧨 Memoised, and computed ONCE for all stops. The diagnosis below called
  // buildOptions per empty stop and was itself called twice per stop (the
  // title attribute and the paragraph), so a full catalogue pass ran four
  // times for one stop, on every render — the exact pattern the note on
  // `alternatives` says was removed. Only needed when something is empty.
  const optionsIgnoringHours = useMemo(
    () =>
      alternatives.some((l) => l.length === 0)
        ? buildOptions(stops, { ignoreHours: true })
        : [],
    [alternatives, buildOptions, stops],
  );

  // 🧨 Whether there is an arrangement to go BACK to — not whether the night
  // differs from its base. Gating on divergence hid a fully restored history:
  // after a refresh the stored night IS the base, so they matched and the
  // button never rendered, with the whole stack sitting in state. It also
  // stranded older entries the moment a cycle returned to the original.
  const myUndo = entriesFor(undoStack, editKey);
  // 🧨 THE ORIGINAL IS HELD, NOT DERIVED. Reading it off the deepest history
  // entry was right until the two things that move that entry: `undoReplace`
  // pops, so unwinding the last change fell back to the base and reported a
  // change on a night identical to its original; and the 20-deep cap trims
  // from the front, so past twenty replacements the deepest entry is simply
  // not the original any more — and if the trimmed-to arrangement happened to
  // match the screen, the reshuffle confirm was skipped again, which is the
  // blocker this was all fixing. Pinned once per night, it cannot drift.
  const originalRef = useRef<{
    key: unknown;
    stops: { venue: Venue; role: PlanRole }[];
  } | null>(null);
  if (originalRef.current?.key !== editKey) {
    originalRef.current = { key: editKey, stops: baseStops };
  }
  // 🧨 THE NIGHT AS IT STARTED, which after a refresh is NOT `base`. The
  // persist effect writes `display`, so a restored night's base IS the
  // replaced arrangement — measuring against it reported zero replacements on
  // a night with two, which meant "Try another combination" skipped its own
  // confirm card and destroyed a restored history with no warning. Undoing on
  // such a night inverted it the other way, claiming a change had been made
  // when one had just been taken back. The deepest history entry is the
  // arrangement before the first replacement, which is exactly the original.
  // On a restored night the base IS the replaced arrangement, so the deepest
  // stored entry is the better answer when there is one; the pin covers every
  // case after that.
  const original = originalStopsOf(
    myUndo,
    originalRef.current?.stops ?? baseStops,
  );
  const canUndo = canUndoFrom(myUndo, stops);

  // How many stops the user has changed by hand — the thing a reshuffle would
  // throw away, and the only honest number to put in front of them.
  const replacedCount = countReplaced(stops, original);
  const hasReplacements = replacedCount > 0;

  // Why a stop has nothing to offer. Absence is not an explanation, and the
  // two causes want different answers from the user.
  // 🧨 DERIVED FROM WHAT ACTUALLY EMPTIED THE LIST, not from the stop's
  // position. The first version read the index and asserted walkability, so a
  // stop with nothing open at its arrival was told its neighbours were too far
  // apart — a false cause, and it pointed at an action that would not have
  // helped. Re-running the same query without the clock separates the two: if
  // dropping opening hours produces options, hours are the reason.
  // The single line under a stop, or null when there is nothing to say. A shut
  // stop wins over a thin option list, because it is the more urgent fact.
  const stopNotice = (i: number): string | null => {
    const canChange = (alternatives[i]?.length ?? 0) > 0;
    if (closedStops.includes(i)) {
      return canChange
        ? "Closed by the time you'd get here. Change it."
        : // Named controls only. The chip's own rule (canStartEarlier) also
          // requires that shifting actually reduces what is shut, so this
          // copy names it via that flag, never by restating the rule.
          canStartEarlier
          ? "Closed by the time you'd get here, and nothing open fits this slot. Start earlier, or try another combination below."
          : "Closed by the time you'd get here, and nothing open fits this slot. Try another combination below.";
    }
    return canChange ? null : noOptionsReason(i);
  };

  const noOptionsReason = (i: number): string => {
    const withoutHours = optionsIgnoringHours[i] ?? [];
    if (withoutHours.length > 0) {
      // Both hours rules are disabled together by `ignoreHours`, so this
      // covers two causes: the candidate is shut when you reach it, or it
      // would push a LATER stop past closing. The wording has to be true of
      // both, so it names the clock rather than a specific venue.
      // Named controls only. "Try an earlier start" pointed at a chip that is
      // hidden in exactly this state (it needs a CLOSED stop to show).
      return "Nothing else here works with your timings. Try another combination below.";
    }
    const total = stops.length;
    if (total > 2 && i > 0 && i < total - 1) {
      return "Nothing else fits between these two and stays walkable. Change one of the stops either side first.";
    }
    return "Nothing else nearby fits this slot right now. Try a different area or vibe.";
  };

  // Editorial eyebrow, same convention as the Explore header: 06:00–17:59 reads
  // "today,", 18:00–05:59 "tonight,". `now` is null until mount, so SSR + first
  // client render agree (default "tonight,") and it settles after mount.
  const eyebrow =
    now && now.getHours() >= 6 && now.getHours() < 18 ? "today," : "tonight,";

  // 🧨 DERIVED, not per-mount state. `saveState` resets to "idle" on every
  // mount, so a night that had been saved came back after a refresh or a tap
  // through to a venue reading "Save this night" — and tapping it inserted a
  // SECOND identical row. `public.plans` is insert-only and the app has no
  // delete, so "Your saved nights" filled with duplicates the user could not
  // remove, degrading the entry point to the whole saved-night loop. The
  // signature was already computed inside onSave for analytics; it just never
  // reached the button.
  // Known limits, both failing SAFE: the signature is venue ids in order, so
  // the same three venues rebuilt for a different DAY read as already saved
  // (plans stores no start time to tell them apart); and it is false while
  // loadSavedPlans is still in flight, so a fast double-tap can still
  // duplicate. Under-saving is recoverable in one tap; the duplicate rows this
  // replaced were not recoverable at all.
  const planSignature = display.steps.map((s) => s.venue.id).join("|");
  const alreadySaved = savedPlans.some(
    (p) => p.steps.map((s) => s.venueId).join("|") === planSignature,
  );

  // ── Saved plans (signed-in only) ────────────────────────────────────
  const loadSavedPlans = useCallback(async () => {
    if (!authUserId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("plans")
      .select("id,title,neighbourhood,steps")
      .eq("user_id", authUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[plans] load failed:", error);
      savedListLoadedRef.current = false;
      setSavedListLoaded(false);
      setSavedListFailed(true);
      return;
    }
    // 🧨 The rows FIRST, then the flag. React 18 batches this continuation so
    // the order is invisible today, but any await inserted between them yields
    // one render with the flag true and the list still empty — Save enabled on
    // an already-saved night, which is the permanent duplicate this guard
    // exists to prevent.
    setSavedPlans((data as SavedPlanRow[]) ?? []);
    savedListLoadedRef.current = true;
    setSavedListLoaded(true);
    setSavedListFailed(false);
  }, [authUserId]);

  useEffect(() => {
    void loadSavedPlans();
  }, [loadSavedPlans]);

  const onSave = async () => {
    if (!authUserId || saveState === "saving") return;
    setSaveState("saving");

    // ── Analytics: the save split ────────────────────────────────────
    // Coarse shape shared by all three save events. Deliberately identical to
    // the prop bag the legacy plan_save already sent, so a dashboard can be
    // migrated without losing a dimension. No title, no venue names, no ids.
    // Stops that differ from the night this started as.
    // The same measure the rest of the screen uses. Against `baseStops` this
    // shipped `swapped: 0` for a restored night with two replacements, and
    // `swapped: 1` after undoing on one — a wrong dimension, on the conversion
    // event, which this file argues elsewhere is worse than a missing one.
    const swapCount = replacedCount;
    const mode: SaveMode = alreadySaved
      ? "duplicate"
      : swapCount > 0
        ? "resave_after_swap"
        : offset > 0
          ? "resave_after_reshuffle"
          : "new";
    const attempt = ++saveAttemptRef.current;
    // 🧨 PROVENANCE. `display` is the night being saved; `computed` is the
    // night the engine last generated. For a live plan they are the same. For
    // a RESTORED one they are not — a restored generated or claimed night is
    // savable (that is the whole conversion path), and the engine has kept
    // running behind it against controls that were only partly re-seeded: the
    // area deliberately is not, so `computed.daypart` can read "day" under an
    // evening night. So everything describing the saved night comes from
    // `display` or from the controls the user can see, and the pool statistics
    // — which describe a generation that did not produce this night — are null
    // rather than borrowed. A wrong dimension is worse than a missing one; a
    // dashboard will happily break down by it.
    const live = active === null;
    const saveProps = {
      area: display.area,
      vibe,
      budget,
      daypart: display.daypart,
      stops: display.steps.length, // legacy spelling, kept for continuity
      stop_count: display.steps.length,
      swapped: swapCount,
      poolStage: live ? computed.poolStage : null, // legacy spelling
      pool_stage: live ? computed.poolStage : null,
      poolSize: live ? computed.poolSize : null, // legacy spelling
      pool_size: live ? computed.poolSize : null,
      // live | generated | anon | saved — lets the null pool stats above be
      // read as "not applicable" rather than "instrumentation broke".
      plan_origin: active?.source ?? "live",
      mode,
      attempt,
      anon_origin: anonOriginRef.current,
      saved_list_loaded: savedListLoadedRef.current,
    };
    // Intent. Fires AFTER the guard above, so the count can be compared
    // directly against the insert count. Firing above the guard would
    // double-count a double tap that the guard already swallowed.
    track("plan_save_tapped", saveProps);

    const supabase = createClient();
    // Save what's ON SCREEN — i.e. with any per-stop swaps applied (`display`).
    const names = display.steps.map((s) => s.venue.name).join(" → ");
    const where = display.area === ANYWHERE ? "London" : display.area;
    const kind = display.daypart === "day" ? "day out" : "night";
    // `status` is destructured purely to bucket a failure (0 = never left the
    // device, 401/403 = expired session, 429 = throttled, 5xx = server).
    const { error, status } = await supabase.from("plans").insert({
      user_id: authUserId,
      title: display.title,
      neighbourhood: display.area,
      why_it_works: `A ${vibe.toLowerCase()} ${where} ${kind}: ${names}.`,
      // Canonical adapter. Still an ARRAY with the same four legacy keys, plus
      // `slug` — so a row written today is readable by anything that predates
      // the model, including the account-data export. See lib/night-plan.ts.
      // 🧨 Built from what is ON SCREEN, never spread from `computed`. The
      // spread put the LIVE engine run's vibe, budget and daypart on a
      // restored night's adapter — the exact "stale generation metadata" this
      // model exists to remove. It leaked nothing only because toSavedSteps
      // throws those three away; the moment anyone widens it (which the
      // schema note in lib/night-plan.ts anticipates), a reopened evening
      // night saves as a day out with no test failing.
      steps: toSavedSteps(
        fromEnginePlan(
          {
            area: display.area,
            vibe,
            budget,
            daypart: display.daypart,
            steps: display.steps.map((s) => ({
              ...s,
              arriveAt: s.arriveAt ?? null,
            })),
          },
          {
            title: display.title,
            offset,
            tracksClock: timing?.tracksClock ?? true,
          },
        ),
      ),
    });
    if (error) {
      console.error("[plans] save failed:", error);
      // 🧨 Not back to "idle". That flickered "Saving…" and returned the
      // button to "Save this night" as if nothing happened — the one durable
      // action in the loop failing silently. "error" keeps the button live
      // and makes it the retry.
      setSaveState("error");
      // 🧨 Re-check the saved list BEFORE offering the retry. A write that
      // landed server-side but errored on the way back (5xx, timeout) leaves
      // alreadySaved false, and the retry then inserts a second row into an
      // insert-only table with no delete UI — the permanent duplicate three
      // other comment blocks in this file exist to prevent. If the phantom
      // write landed, the reload flips the button to "Saved to your nights".
      void loadSavedPlans();
      // Only the mapped category and the SQLSTATE code. Never error.message,
      // never error.details (a full stack trace on the network path), never
      // error.hint. See lib/analytics-reasons.ts.
      track("plan_save_failed", {
        ...saveProps,
        reason: saveFailReason(error.code, status),
        pg_error_code: typeof error.code === "string" ? error.code : "none",
      });
      return;
    }
    setSaveState("saved");
    recordSignal("plan_completed", { surface: "plan" });
    // Fires only after the insert came back clean, so this is confirmed
    // persistence rather than intent.
    track("plan_save_succeeded", saveProps);
    // DEPRECATED dual-emit until 2026-09-30. Every existing PostHog insight and
    // Vercel series keys on "plan_save", so it cannot be renamed in place. New
    // dashboards must count plan_save_succeeded and must NOT also count this,
    // or every save appears twice.
    track("plan_save", saveProps);
    void loadSavedPlans();
  };

  // ── The active night ────────────────────────────────────────────────
  //
  // One path for every way a night arrives: generated, restored after a
  // refresh, reopened from Saved, or claimed after signing in. They all become
  // a NightPlan first (lib/night-plan.ts) and are hydrated against THIS
  // catalogue, so there is a single place where a stale venue id is handled.
  const owner = authUserId ?? null;

  // ── Undo history, across a refresh and a walk to a venue page ────────
  //
  // The replacement survived those trips and the history did not, so a stop
  // you changed became permanent the moment you tapped through to check it —
  // and getting the original back meant cycling through up to eight unlabelled
  // options. The stack is keyed to the night's own venue ids, so a history can
  // only ever be replayed onto the night it was made on.
  // 🧨 SIGNED WITH THE NIGHT'S IDENTITY, NOT ITS CURRENT STOPS. Signing with
  // the base venue ids looked right and made the whole feature a no-op that
  // also DESTROYED what it was storing: the persist effect writes `display`,
  // so on the next mount `activate` makes the replaced arrangement the new
  // base and the signature no longer matches what was stored. The read was
  // rejected, then the write effect ran with the new signature and an empty
  // stack and removed the key. History was unreachable when it existed and
  // erased when it was looked for. `createdAt` is stamped once per generated
  // night and carried through every re-persist, so it survives replacements —
  // which is exactly what a history has to be keyed on.
  //
  // A legacy-stash night has no `plan`, and on that mount the generated stamp
  // is empty, so `baseSig` is "" and both effects below no-op: undo works in
  // memory and does not persist. An acceptable degradation for a path that
  // exists only to carry someone across one deploy, but not a mystery.
  const baseSig = active?.plan?.createdAt ?? genStampRef.current.at;

  // 🧨 THIS COMPONENT CANNOT OBSERVE THE SIGN-OUT TRANSITION, and must not
  // pretend to. `authUserId` is a server prop from app/(main)/plan/page.tsx,
  // inside the branch that has already returned <AnonPlanFlow/> when there is
  // no user — so `owner` is a non-null string for the whole mount and never
  // flips to null. A real sign-out calls router.refresh(), the server page
  // re-renders into the anon branch, and PlanFlow UNMOUNTS.
  //
  // An earlier version of this file carried a uuid->null stand-down effect
  // here, with fifteen lines explaining the cross-user bleed it prevented. It
  // could not fire: the guard it depended on was unreachable by construction.
  // A defence that cannot run is worse than none, because the comment stops
  // the next person looking for the real one — which is the sweep in
  // components/auth-user-context.tsx, on the auth subscription, where the
  // transition is actually visible.
  //
  // What remains, and is documented rather than defended here: a still-mounted
  // PlanFlow keeps `owner = A` through a cross-tab sign-out or a session
  // expiry, so the next dep change re-persists A's night under A's OWN key
  // after the sweep cleared it. Owner-scoped, so it is not a bleed onto the
  // next person; it defeats the sweep for that account until the page reloads.

  // Which night's stored history this mount has already reconciled.
  const undoRestoredForRef = useRef<string | null>(null);
  // 🧨 Has THIS session ever written a history for this night? The token below
  // orders the write after the READ, not after the restore has landed: in the
  // commit where the layout effect reads and calls setUndoStack, this passive
  // effect still sees the old empty array, and empty means removeItem. It
  // survived on React flushing passive effects before the re-render — an
  // ordering accident — and did NOT survive when the rehydrate came back empty
  // because a venue had left the catalogue, which deleted a history that a
  // later mount with a complete catalogue could have used.
  const undoWrittenRef = useRef(false);
  useIsomorphicLayoutEffect(() => {
    if (venues.length === 0 || baseSig === "") return;
    const token = `${owner ?? "anon"}:${baseSig}`;
    if (undoRestoredForRef.current === token) return;
    undoRestoredForRef.current = token;
    const stored = readUndoStack(owner, baseSig);
    if (stored.length === 0) return;
    // Rehydrate against the catalogue; a stop whose venue has gone makes that
    // entry unrestorable, so the history stops there rather than restoring a
    // night with a hole in it.
    const rebuilt: EditedNight[] = [];
    for (const entry of stored) {
      const stops = entry.stops.map((st) => ({
        venue: venueById.get(st.venueId) ?? venueBySlug.get(st.slug),
        role: st.role as PlanRole,
      }));
      // A stop whose venue has left the catalogue makes THIS entry
      // unrestorable. Keeping the run adjacent to the HEAD matters: breaking
      // here kept the oldest prefix, so one bad entry mid-stack silently threw
      // away every newer arrangement and a single Undo tap jumped back
      // several replacements at once.
      if (stops.some((st) => !st.venue)) {
        rebuilt.length = 0; // restart the run; the head is what Undo reaches
        continue;
      }
      rebuilt.push({
        key: editKey,
        stops: stops as { venue: Venue; role: PlanRole }[],
        cycle: entry.cycle ?? {},
      });
    }
    if (rebuilt.length > 0) {
      setUndoStack(rebuilt);
      // 🧨 RE-PIN to the restored history's deepest entry. The pin is seeded
      // from `baseStops`, and on a restored night that is the REPLACED
      // arrangement — so undoing back to empty fell through to it and reported
      // two changes on a night exactly as it started, shipping swapped: 2 on
      // the save event. The pin has to follow the oldest arrangement we know
      // of, not the one that happens to be persisted.
      originalRef.current = { key: editKey, stops: rebuilt[0].stops };
      // Seeded here, so undoing a RESTORED history back to empty still clears
      // the key rather than leaving a stale one behind.
      undoWrittenRef.current = true;
    }
  }, [owner, baseSig, venues.length, editKey, venueById, venueBySlug]);

  useEffect(() => {
    if (baseSig === "") return;
    // 🧨 NOT UNTIL THE RESTORE HAS RUN FOR THIS NIGHT. This effect fires on the
    // first commit with an empty in-memory stack, and writeUndoStack treats
    // empty as removeItem — so it deleted the very history the restore was
    // about to read, before it read it. The key is per-owner, so that delete
    // took any night's history with it.
    if (undoRestoredForRef.current !== `${owner ?? "anon"}:${baseSig}`) return;
    const mineNow = entriesFor(undoStack, editKey);
    // Never CLEAR a key this session has not written. A genuine undo-to-empty
    // still clears, because restoring a history seeds the latch too.
    if (mineNow.length === 0 && !undoWrittenRef.current) return;
    if (mineNow.length > 0) undoWrittenRef.current = true;
    writeUndoStack(
      owner,
      baseSig,
      undoStack
        .filter((e) => e.key === editKey)
        .map((e) => ({
          stops: e.stops.map((st) => ({
            venueId: st.venue.id,
            slug: st.venue.slug,
            role: st.role,
          })),
          cycle: e.cycle,
        })),
    );
  }, [undoStack, owner, baseSig, editKey]);

  const activate = useCallback(
    (np: NightPlan): boolean => {
      const { stops, dropped } = hydrateStops<Venue>(np, {
        byId: (id) => venueById.get(id),
        bySlug: (slug) => venueBySlug.get(slug),
      });
      // A night whose venues have all left the catalogue is not a night.
      if (stops.length === 0) return false;

      // 🧨 RELINK when a stop was dropped. Without this the survivors keep the
      // walk time that was measured to the venue that just disappeared, and
      // the header keeps the full night's duration — so a 3-stop night that
      // loses its middle stop renders "~6 min walk" between two venues that
      // may be 25 minutes apart, while the map draws the real leg. A short
      // night is honest; a wrong walk time is not.
      // 🧨 ALWAYS relink, and relink from the night's OWN start time. A
      // NightPlan stores `startsAt` but no per-stop arrivals, so a restored
      // night rendered with no "arrive ~7:00 pm" line at all: the same night
      // lost its clock the moment you refreshed or tapped through to a venue.
      // relinkSteps recomputes arrivals from the start, and — the reason it
      // was already called on the dropped path — keeps walk times honest when
      // a stop has left the catalogue.
      // 🧨 ...but only while the night is still ahead of us. Restoring a
      // 2pm day-out at 10pm rendered "arrive ~2:00 pm" under "Today, the
      // plan:" — confidently wrong, where showing nothing is merely vague. If
      // the whole night has already finished, drop the clock and keep the
      // stops. A night still IN PROGRESS keeps its times: the remaining stops
      // are the point.
      // 🧨 `tracksClock` MEANS the stored start was a snapshot of the clock,
      // not a time anybody chose (lib/night-plan.ts) — so re-anchor it to now
      // rather than replaying it. Without this, a "Right now" night built at
      // 13:00 and reopened at 16:00 read "arrive ~1:00 pm" on every card,
      // three hours behind, in the boldest text on the screen. Safe only
      // because the persist below no longer writes startsAt back: the
      // re-timing stays on screen and never reaches disk, so it cannot drift
      // the stored stamp forward on every visit — which would make the night
      // IMMORTAL, since isFresh reads that stamp.
      const start = np.tracksClock
        ? new Date()
        : np.startsAt
          ? new Date(np.startsAt)
          : undefined;
      let steps = relinkSteps(stops, start);
      if (start) {
        const endsAt =
          start.getTime() +
          steps.reduce(
            (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
            0,
          ) *
            60_000;
        if (endsAt < Date.now()) steps = relinkSteps(stops, undefined);
      }
      if (dropped > 0) {
        track("plan_restored_partial", {
          dropped,
          kept: steps.length,
          source: np.source,
        });
      }

      setActive({
        plan: np,
        // The night's own start, after the finished-night guard above.
        startsAt: steps[0]?.arriveAt ?? undefined,
        base: {
          title: np.title,
          area: np.area,
          daypart: np.daypart,
          totalMins: steps.reduce(
            (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
            0,
          ),
          steps,
        },
        source: np.source,
      });
      // Seed the vibe/budget controls so the brief behind the night is what
      // the user sees, and so "try again" regenerates something comparable
      // rather than whatever the controls happened to be left on.
      //
      // 🧨 The AREA control IS seeded now, as a neighbourhood. It deliberately
      // was not, on the reasoning that a NightPlan carries only the resolved
      // area STRING so mapping back has to guess between "region" and
      // "neighbourhood". That reasoning was sound while nothing on a restored
      // night could regenerate. "Try another combination" is on every night
      // now, so NOT guessing is itself a guess — and the worse one: reopening
      // "A Lively Night in Shoreditch" and tapping it returned a night
      // anywhere in London, which is not another take on THIS night at all.
      // A wrong guess widens the pool and the engine still returns a night; no
      // guess changes the brief out from under the user.
      // A newly activated night starts with no replacements and no history.
      setEdited(null);
      editedRef.current = null;
      setUndoStack([]);
      // A different night is on screen now; the cards and the start nudge that
      // belonged to the last one must not arrive with it.
      setConfirmReshuffle(false);
      setConfirmEdit(false);
      setStartShiftMins(0);
      setVibe(np.vibe);
      setBudget(np.budget);
      // The night's own daypart, so "Try another combination" regenerates
      // against the brief on screen rather than against "Right now". Left at
      // "now", a restored evening night reshuffled into a daytime one under a
      // header still reading "Tonight,". WhenChoice's "day"/"evening" map 1:1
      // onto the daypart; the AREA control still cannot be mapped back (see
      // above), which is why this is a partial re-seed rather than a full one.
      // 🧨 ...and its DATE, when it has one. `setWhen(daypart)` alone meant a
      // night built for next Saturday 20:00 restored perfectly — right stops,
      // right arrivals — and then "Try another combination" regenerated for
      // TONIGHT: different venues, different opening-hours filtering, and no
      // date anywhere on screen to reveal the swap. startsAt is already
      // stored; the controls just were not being fed from it.
      // 🧨 Seed the clock whenever the night was planned for a SPECIFIC time,
      // not only when that time is on another day. Gating on the date alone
      // meant a night built for today at 22:00 restored as `when: "evening"`
      // and reshuffled from 19:00 — a silent three-hour swap, the same class
      // of bug this block exists to fix, just inside one day.
      //
      // A "Right now" night is the exception: its start is its build time, so
      // it must keep tracking the live clock rather than pinning to a stamp
      // that is already going stale. The night records that intent itself
      // (`tracksClock`) — see lib/night-plan.ts for why inferring it from the
      // two timestamps was wrong on this surface.
      const startDate = np.startsAt ? new Date(np.startsAt) : null;
      const wasRightNow = np.tracksClock;
      // A night still running after midnight would seed YESTERDAY, below the
      // picker's floor, and then plan for a time already past.
      const inThePast =
        !!startDate && toISODate(startDate) < toISODate(new Date());
      if (startDate && !wasRightNow && !inThePast) {
        setWhen("custom");
        setCustomDate(toISODate(startDate));
        setCustomTime(
          `${String(startDate.getHours()).padStart(2, "0")}:${String(
            startDate.getMinutes(),
          ).padStart(2, "0")}`,
        );
      } else {
        setWhen(np.daypart);
      }
      // Resume the reshuffle sequence rather than replaying it. computePlan is
      // deterministic per offset, so restoring at 0 made someone who had
      // reshuffled three times re-reject those same three nights.
      setOffset(np.offset);
      // Only when `regionOf` resolves it. REGION_OF is a hand-maintained map
      // over a crawl-grown catalogue, so an unmapped neighbourhood is normal —
      // and it renders the Area chip highlighted but labelled the literal word
      // "Area", with no drill-down, pinning the user to a selection they can
      // neither see nor change. The engine copes (it widens the pool); the
      // picker does not.
      const region = np.area ? regionOf(np.area) : null;
      setAreaSel(
        region
          ? { kind: "neighbourhood", name: np.area }
          : { kind: "anywhere" },
      );
      setStep("result");

      // 🧨 A REOPENED SAVED ROW *IS* PERSISTED, and that is a reversal. It
      // was excluded because storing it made a night with no Save, no Try
      // another and no per-stop Change land on every /plan visit for 12 hours
      // — glancing at a saved night took the surface hostage. This branch
      // removed the hostage part: a reopened night now has all three. What
      // the exclusion cost instead was the edit, since every stop card is a
      // Link to a venue page. So the occupancy is accepted deliberately: for
      // 12 hours, /plan opens on the night you last looked at, which is the
      // same promise every other restored night makes.
      // Re-persist from the HYDRATED venues, so an anon-origin night (whose
      // ids are slugs) is re-keyed to real catalogue ids, and so a night that
      // lost stops is stored in its relinked form rather than its stale one.
      writeActivePlan(owner, {
        ...np,
        stops: steps.map((s) => ({
          venueId: s.venue.id,
          slug: s.venue.slug,
          role: s.role,
          dwellMins: s.dwellMins,
          walkToNextMins: s.walkToNextMins,
        })),
      });
      return true;
    },
    [venueById, venueBySlug, owner],
  );

  // A saved row the user tapped while an unsaved night was still in the active
  // slot. Held until they choose, rather than resolved by guessing.
  const [pendingSaved, setPendingSaved] = useState<SavedPlanRow | null>(null);
  // Shown when "Try another combination" would discard manual replacements.
  const [confirmReshuffle, setConfirmReshuffle] = useState(false);
  // Shown when "← Edit" would walk away from manual replacements: setup's only
  // forward action is Build, which discards them and their history.
  const [confirmEdit, setConfirmEdit] = useState(false);

  const openSaved = (row: SavedPlanRow) => {
    // 🧨 REOPENING USED TO DESTROY AN UNSAVED NIGHT IN SILENCE. Two taps from a
    // live result — "← Edit", then a row in this list — overwrote the active
    // slot, and the night built ten seconds earlier was unrecoverable by
    // refresh or Back. Both nights are legitimate here, so this asks instead
    // of picking one: the saved row is durable in the database and losing it
    // costs nothing, while the night in the slot exists nowhere else.
    const existing = readActivePlan(owner);
    const existingSig = existing?.stops.map((s) => s.venueId).join("|");
    const atRisk =
      !!existing &&
      // No `source !== "saved"` clause. It was a valid proxy for "this night
      // exists elsewhere" only while a reopened saved row was never persisted.
      // It is now, replacements included, so the clause silently skipped the
      // guard for exactly the night with unsaved changes: reopen, replace a
      // stop, Edit, tap another saved row, and the replacement was gone. The
      // signature test below already answers it — an untouched reopened row
      // matches a saved signature and is not at risk; an edited one does not.
      !savedPlans.some(
        (p) => p.steps.map((s) => s.venueId).join("|") === existingSig,
      );
    // No `&& !pendingSaved`: with the card on screen, tapping any OTHER row
    // in the list below it fell straight through and opened it unguarded —
    // and the card is rendered above a long list, so "tap again" is exactly
    // what its own invisibility provokes. The card's two buttons are the only
    // way past it.
    if (atRisk) {
      // Fire once per episode, not once per tap: the card renders above a long
      // list, so re-tapping is common and would inflate the conflict rate.
      if (!pendingSaved) {
        track("plan_reopen_conflict", { stops: existing.stops.length });
      }
      setPendingSaved(row);
      return;
    }
    setPendingSaved(null);
    reallyOpenSaved(row);
  };

  const reallyOpenSaved = (row: SavedPlanRow) => {
    // Saved rows carry no vibe or budget (see lib/night-plan.ts), so the
    // current control values stand in. They affect regeneration only.
    const np = fromSavedRow(
      {
        id: row.id,
        title: row.title,
        neighbourhood: row.neighbourhood,
        steps: row.steps,
      },
      { vibe, budget },
    );
    if (!np) return;
    activate(np);
  };

  // ── Restore, and claim an anonymous night ───────────────────────────
  //
  // Runs once per owner. Two things happen here, in order:
  //
  //   1. If this browser has an anonymous night and the user has just signed
  //      in, it is CLAIMED into their own slot. This is the "I built a night,
  //      then signed up to save it" path — previously a bespoke one-shot
  //      stash, now the same store as everything else.
  //   2. Otherwise, whatever night this owner already had is restored.
  //
  // Owner-scoped keys mean a signed-out visitor can never restore the previous
  // user's night on a shared browser (lib/active-plan.ts).
  // The NightPlan a restored night came from, so re-persisting it after a
  // replacement carries its own createdAt, source, offset and clock intent
  // instead of minting fresh ones — which would restart the freshness window
  // and relabel its provenance on every change.
  const restoredForRef = useRef<string | null | undefined>(undefined);
  // 🧨 BEFORE THE BROWSER PAINTS, not after. `step` initialises to "setup", so
  // running this as a normal effect meant the setup form was painted first and
  // then replaced — on the refresh, the walk back from a venue page and the
  // post-sign-in landing, i.e. the three moments this whole feature exists
  // for, the first thing on screen was the tall questionnaire the user had
  // already filled in. It read as "it forgot", which is precisely the feeling
  // being removed. useLayoutEffect runs synchronously after the DOM is
  // committed and before paint, so the swap is never visible; browser scroll
  // restoration then lands on the result markup rather than the form.
  useIsomorphicLayoutEffect(() => {
    // Wait for the catalogue: hydrating against an empty list would drop every
    // stop and look identical to "there was nothing saved".
    if (venues.length === 0) return;
    if (restoredForRef.current === owner) return;
    restoredForRef.current = owner;

    // 🧨 The signed-out result screen is anon-scoped and must not survive into
    // a signed-in session — otherwise it is still there after sign-out, ready
    // to rehydrate onto the next person on this browser. claimAnonPlan clears
    // it when there is something to claim; this covers the case where there
    // was not (a failed canonical write, an older build), so no path leaves it
    // behind.
    if (owner) {
      try {
        window.localStorage.removeItem(ANON_RESULT_KEY);
      } catch {
        /* private mode */
      }
    }
    const claimed = owner ? claimAnonPlan(owner) : null;
    if (claimed) {
      // The canonical claim has won. Drop the legacy one-shot stash so the
      // older effect below cannot restore a coarser copy of the same night
      // over the top of it and double-fire the analytics.
      try {
        window.localStorage.removeItem(ANON_PLAN_STASH_KEY);
      } catch {
        /* private mode */
      }
      // 🧨 THE CLAIM IS SUBJECT TO THE SAME FRESHNESS GATE AS A RESTORE. It
      // was not, and an anonymous night is the one most likely to be old:
      // someone builds a night on a Tuesday, does not sign in, and creates an
      // account three weeks later. That claim put a three-week-old night on
      // the result screen under "Tonight, the plan:" with opening hours
      // checked three weeks ago, counted it as a conversion, and then — since
      // it re-persists with the ORIGINAL createdAt — had the next mount's
      // restore path reject it as stale. The night appeared exactly once and
      // silently vanished. isFresh must be checked at BOTH call sites; the
      // unit test on isFresh cannot see which ones exist.
      //
      // claimAnonPlan is destructive on the anon side before we get here, so
      // a stale claim clears the owner slot rather than being handed back.
      if (!isFresh(claimed) || !activate(claimed)) {
        clearActivePlan(owner);
        return;
      }
      anonOriginRef.current = true;
      track("plan_anon_claimed", { stops: claimed.stops.length });
      return;
    }
    const existing = readActivePlan(owner);
    if (!existing) return;
    // A stale night must not be restored onto the result screen under
    // "Tonight, the plan:" with opening hours that were checked days ago.
    if (!isFresh(existing)) {
      clearActivePlan(owner);
      return;
    }
    if (!activate(existing)) clearActivePlan(owner);
  }, [owner, venues.length, activate]);

  // Persist whatever is on screen, so a refresh, a tap through to a venue and
  // the journey back, or the sign-in round trip all return to the same night.
  useEffect(() => {
    if (step !== "result") return;
    // EVERY restored night is re-persisted from `display`, including a
    // reopened saved row. That row used to be excluded, because storing it
    // made a read-only night land on every visit to /plan for 12 hours. It is
    // not read-only any more — this branch gave it Change and swipe — so the
    // exclusion stopped protecting anything and started costing the edit:
    // every stop card is a Link to a venue page, so tapping through to check
    // a booking and coming back landed on the setup form with the change
    // gone. Writing from `computed` here would instead overwrite it with the
    // unrelated night the engine happens to be holding, which is why this
    // used to bail out entirely.
    if (active) {
      const src = active.plan;
      // No source plan means the night came from the legacy one-shot stash,
      // which carries none of these fields. Leave it alone rather than mint a
      // NightPlan with invented provenance.
      if (!src || display.steps.length === 0) return;
      writeActivePlan(owner, {
        ...src,
        // 🧨 A nudged start survives the refresh — written ONLY when the user
        // shifted it, so an untouched night keeps its stored clock
        // byte-for-byte, tracksClock re-anchoring included. Side-effect,
        // stated: isFresh measures start + duration, so each 30-minute step
        // back also expires the night 30 minutes earlier. That is the honest
        // consequence of genuinely starting earlier.
        ...(startShiftMins !== 0 && nightWhen
          ? {
              startsAt: nightWhen.toISOString(),
              // 🧨 Shifting makes the night stop being a live-clock night.
              // Writing startsAt alone was inert on the DEFAULT path: activate
              // re-anchors any tracksClock night to `new Date()` and throws
              // the persisted value away — so the shift vanished on the walk
              // back from a venue card, the shut stop returned, and nothing
              // said anything had changed. The user chose a time; the night
              // keeps it.
              tracksClock: false,
            }
          : {}),
        title: display.title,
        area: display.area,
        daypart: display.daypart,
        // 🧨 `startsAt` is NOT re-derived here. It comes from `...src`, which
        // holds the night's own start. Taking it from the first arrival
        // re-stamped it to the current clock on every mount, and since
        // isFresh prefers startsAt over createdAt, this morning's night stayed
        // "fresh" forever as long as the user kept opening /plan.
        stops: display.steps.map((s) => ({
          venueId: s.venue.id,
          slug: s.venue.slug,
          role: s.role,
          dwellMins: s.dwellMins,
          walkToNextMins: s.walkToNextMins,
        })),
      });
      return;
    }
    // 🧨 A zero-stop result is the dead-end screen, not a night. This effect
    // runs ABOVE that screen's early return, so without this a good stored
    // night was destroyed by a failed build: Edit -> pick an empty area ->
    // Build wrote `stops: []` over it, and the next load could not parse the
    // result and cleared the slot. Losing the night to a search that found
    // nothing is the worst possible moment to lose it.
    if (display.steps.length === 0) return;
    if (genStampRef.current.src !== computed) {
      genStampRef.current = { src: computed, at: new Date().toISOString() };
    }
    writeActivePlan(
      owner,
      fromEnginePlan(
        {
          ...computed,
          // 🧨 `display.area`, not `computed.area`. `display` re-derives the
          // area from the FIRST STOP, so once a swap changes stop 1 the header
          // reads "Soho" while the engine's resolved pocket still says
          // "Fitzrovia". Persisting the engine's value made a restored night
          // rename itself on reload.
          area: display.area,
          steps: display.steps.map((s) => ({
            ...s,
            arriveAt: s.arriveAt ?? null,
          })),
        },
        {
          title: display.title,
          createdAt: genStampRef.current.at,
          offset,
          // 🧨 A shifted night has a CHOSEN time, whatever the When control
          // said. This override first landed in onSave — where toSavedSteps
          // discards tracksClock entirely, so it was dead code — while THIS
          // call, the one whose output activate actually reads back, kept
          // writing true and re-anchoring the shifted start away. The fifth
          // wrong-place landing of this series; the value lives where it is
          // read.
          tracksClock:
            startShiftMins !== 0 ? false : (timing?.tracksClock ?? true),
        },
      ),
    );
    // `offset` and `timing` are both already implied by `computed` (it takes
    // the offset and derives from the same timing), but listed so the
    // persisted reshuffle position and clock intent cannot silently go stale
    // if that ever stops being true.
    // `startShiftMins`/`nightWhen` listed for the shifted-start override
    // above; without them a nudge would not persist until some other dep
    // moved.
  }, [
    step,
    active,
    computed,
    display,
    owner,
    offset,
    timing,
    startShiftMins,
    nightWhen,
  ]);

  // Hydrate a night built while signed OUT. The anon /plan flow stashes its
  // result in localStorage before the sign-in round-trip (three navigations
  // through /auth/callback destroy all client state); without this, a user
  // who signs up specifically to SAVE the night they just built lands back
  // on empty setup controls — the gate review's single worst conversion
  // moment (ux condition 1, 2026-07-27). Same resolution path as openSaved:
  // slugs → this catalogue → a DisplayPlan, then straight to the result.
  useEffect(() => {
    if (!authUserId) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(ANON_PLAN_STASH_KEY);
      if (raw) window.localStorage.removeItem(ANON_PLAN_STASH_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const stash = JSON.parse(raw) as {
        stops?: {
          slug: string;
          role: string;
          dwellMins: number;
          walkToNextMins: number | null;
        }[];
        area?: string;
        daypart?: string;
        savedAt?: number;
      };
      if (!stash?.savedAt || Date.now() - stash.savedAt > 60 * 60 * 1000)
        return;
      const bySlug = new Map(venues.map((v) => [v.slug, v]));
      const steps = (stash.stops ?? [])
        .map((s) => {
          const venue = bySlug.get(s.slug);
          return venue
            ? {
                venue,
                role: s.role as PlanRole,
                dwellMins: s.dwellMins,
                walkToNextMins: s.walkToNextMins,
              }
            : null;
        })
        .filter((s): s is DisplayPlan["steps"][number] => s !== null);
      if (steps.length === 0) return;
      const totalMins = steps.reduce(
        (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
        0,
      );
      const daypart = stash.daypart === "day" ? "day" : "evening";
      setActive({
        plan: null,
        startsAt: undefined,
        base: {
          title: `${stash.area || "London"} ${daypart === "day" ? "Day Out" : "Night"}`,
          area: stash.area || "London",
          daypart,
          totalMins,
          steps,
        },
        // The legacy stash only ever held an anonymous preview.
        source: "anon",
      });
      setStep("result");
      // This night came from an anonymous preview. Recorded as a boolean on
      // the save events rather than a SaveMode value, alongside `plan_origin`.
      anonOriginRef.current = true;
      track("plan_stash_restored", { stops: steps.length });
    } catch {
      /* corrupt stash — ignore */
    }
    // Run once per signed-in mount; venues is stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId]);

  // Editing any input invalidates a re-opened saved plan, the saved flag, and
  // any per-stop swaps (the base plan is about to change).
  const editInputs = (fn: () => void, control: SetupControl = "where") => {
    // plan_setup_started, fired ONCE. editInputs is the single choke point for
    // every setup control on this surface (When, Where, Vibe, Budget) and is
    // called from nothing else, so the latch here cannot be reached by a page
    // load, by the stash/saved-plan restore paths, or by the Build button.
    //
    // Known and accepted: the latch is per-MOUNT. A visitor who builds
    // anonymously, signs in, and lands on a fresh PlanFlow can produce a second
    // event. And a visitor who accepts every default emits plan_generate with
    // no preceding setup event, so setup -> generate is a leaky funnel by
    // construction. Both are documented in the event dictionary; neither is
    // fixable without firing on Build, which would defeat the point.
    if (!setupStartedRef.current) {
      setupStartedRef.current = true;
      // 🧨 The payload carries WHICH CONTROL was touched first, and no
      // dimension values. The obvious version of this event sent area_kind /
      // vibe / budget / when, and every one of them was WRONG BY
      // CONSTRUCTION: track() runs before fn() applies the selection, and the
      // latch fires only once, so all four were pinned to the mount-time
      // defaults on 100% of events. A property that is constant on every event
      // is worse than a missing one, because a dashboard will happily break
      // down by it. The chosen values already ride on plan_generate.
      track("plan_setup_started", {
        plan_surface: "solo",
        first_control: control,
      });
    }
    standDown();
    setSaveState("idle");
    setEdited(null);
    editedRef.current = null;
    setUndoStack([]);
    fn();
  };

  // "Change this one" — cycle stop `i` through its alternatives (dir +1 = next,
  // −1 = previous). relinkSteps (via `display`) keeps the walk, the arrivals
  // and the map honest after the swap.
  const onSwap = (
    i: number,
    dir: 1 | -1 = 1,
    method: SwapMethod = "button",
  ) => {
    // 🧨 EVERYTHING IS READ FROM THE REF, NOT THE RENDER CLOSURE. SwipeStop
    // fires onSwipe from a 180 ms timeout, so a handler can run against a
    // render that predates another replacement. Reading the closure meant a
    // swipe overlapping a tap rebuilt from a pre-swap arrangement and silently
    // reverted the first change. The ref is written synchronously below, so
    // every handler sees the night as it actually stands.
    // 🧨 The KEY comes from a ref too. SwipeStop fires onSwipe from a 180 ms
    // timer, so a gesture begun before "Try another" or Build lands afterwards
    // holding the previous night's `editKey` in its closure. That late swipe
    // did nothing visible, still emitted plan_swap carrying the OLD night's
    // stop_role — a wrong dimension — and pushed an entry keyed to a night
    // that no longer exists onto the undo stack.
    if (editKeyRef.current !== editKey) return;
    const from = editedRef.current;
    const live = from?.key === editKey ? from : null;
    const currentStops = live?.stops ?? baseStops;
    const currentCycle = live?.cycle ?? {};

    // Options for the stop as the night stands NOW — recomputed here rather
    // than read from the render, for the same reason.
    const list = buildOptions(currentStops)[i] ?? [];
    if (list.length === 0) return;

    // The rotation itself lives in lib/plan-cycle.ts, where it can be tested.
    const step = nextInCycle(list, currentCycle[i] ?? [], dir);
    if (!step) return;
    const { picked, visited: nextVisited } = step;

    const nextStops = currentStops.map((s, j) =>
      j === i ? { venue: picked, role: s.role } : s,
    );
    const nextState = {
      key: editKey,
      stops: nextStops,
      cycle: { ...currentCycle, [i]: nextVisited },
    };
    editedRef.current = nextState;
    setEdited(nextState);
    // Where we came FROM, so Undo restores this exact arrangement — which was
    // itself walkable, so undo can never land on a night that is not.
    setUndoStack((stack) =>
      // Capped: nobody needs a 200-deep undo, and the whole array is
      // re-stringified on every tap and kept for the night's 12h TTL.
      [
        ...stack,
        { key: editKey, stops: currentStops, cycle: currentCycle },
      ].slice(-UNDO_DEPTH),
    );
    setSaveState("idle");
    // `method` is passed in by the caller, never derived from `dir`: a LEFT
    // swipe and the Change button's default argument both produce dir === 1.
    // `stop_role` ships alongside stop_index because the group surface filters
    // roles by hearted moods, so index 0 there is not necessarily the opener.
    // Without the role, solo and group merge into a wrong conclusion.
    track("plan_swap", {
      stop: i, // legacy spelling, kept so existing insights keep working
      stop_index: i,
      // From the night ON SCREEN, not from the live engine's stop i.
      stop_role: currentStops[i]?.role ?? null,
      dir,
      method,
    });
  };

  // Step back through replacements, one at a time. Not a full reset: undoing
  // to the original is what tapping Change until it wraps already does, and
  // the thing a user actually wants is "that last one was worse".
  const undoReplace = () => {
    // 🧨 DISCARD entries belonging to a night that is no longer on screen,
    // rather than refusing to act on them. Returning early left a stale head
    // sitting on top of real history for good: the Undo button rendered and
    // did nothing, permanently, with no way for the user to clear it.
    const mine = entriesFor(undoStack, editKey);
    const prev = mine[mine.length - 1];
    if (!prev) return;
    setUndoStack(mine.slice(0, -1));
    // 🧨 Undo restores a WHOLE ARRANGEMENT, not a position in a list, so it
    // does not re-run the walk rule. Every arrangement produced by a
    // REPLACEMENT was admitted by that rule, so unwinding those is safe.
    //
    // The one exception is the first entry — the night as it arrived. On a
    // restored night that is hydrateStops + relink, and `activate` says
    // plainly that survivors of a dropped stop "may be 25 minutes apart". So
    // undo can return you to a night that was never walkable; it simply
    // returns you to the one you actually had, with honest walk times. Do not
    // read this comment as a guarantee that everything on the stack passes the
    // rule — it does not, and building on that would be a real bug.
    editedRef.current = prev;
    setEdited(prev);
    setSaveState("idle");
    // Both cards, not one: this exact miss on the edit card made "You've
    // changed a stop" appear unprompted with the back control greyed.
    setConfirmEdit(false);
    // 🧨 An undo answers the reshuffle question by making it moot. Without
    // this the flag survived the card: undo back to zero replacements and the
    // card unmounts (it renders on `hasReplacements`) while the flag stays
    // true, so the NEXT replacement made "This throws away your changes"
    // appear unprompted, greying the reroll until it was dismissed. The card
    // belongs to the tap that raised it, not to the night.
    setConfirmReshuffle(false);
    // The number the user can actually reach, not the raw stack.
    track("plan_swap_undo", { remaining: myUndo.length - 1 });
  };

  const doReshuffle = () => {
    // The card is answered; it must not survive onto the night that replaces
    // this one, offering to throw away "0 stops".
    setConfirmReshuffle(false);
    const nextOffset = offset + 1;
    const t0 = performance.now();
    const result = computePlan(venues, planOpts(nextOffset));
    const duration_ms = Math.round(performance.now() - t0);
    setSaveState("idle");
    setEdited(null);
    editedRef.current = null;
    setUndoStack([]);
    // 🧨 Stand down the restored night. Without this the button was
    // visible but inert on any restored or claimed night: `display`
    // kept returning the stored plan while `computed` moved on, so
    // the screen never changed and plan_reshuffle fired anyway —
    // counting a reshuffle the user never saw.
    standDown();
    setOffset(nextOffset);
    const reshuffleProps = {
      area: result.area, // resolved walkable pocket
      areaKind: areaSel.kind, // legacy spelling
      area_kind: areaSel.kind,
      vibe,
      budget,
      daypart: result.daypart,
      stops: result.steps.length, // legacy spelling
      stop_count: result.steps.length,
      full: result.steps.length === 3,
      poolStage: result.poolStage, // legacy spelling
      pool_stage: result.poolStage,
      poolSize: result.poolSize, // legacy spelling
      pool_size: result.poolSize,
      duration_ms,
      offset: nextOffset, // separates reshuffle failures from first builds
    };
    if (result.steps.length === 0) {
      track("plan_generate_failed", {
        ...reshuffleProps,
        reason: "no_result",
      });
    } else {
      track("plan_reshuffle", reshuffleProps);
    }
  };

  // "Near you" — ask the browser for location and keep the night within walking
  // distance of it. On denial/failure fall back to Anywhere so a plan still
  // builds (just London-wide) rather than dead-ending. Anywhere / region / spot
  // selections go through AreaPicker → onChange, which clears any near-you point.
  const pickNearYou = () => {
    editInputs(() => {
      setAreaSel({ kind: "nearYou" });
    }, "where");
    if (center) return; // already located — just reselect
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoState("idle");
      },
      () => {
        setGeoState("denied");
        // Geolocation denial, not a user selection: do not let it be the
        // first_control value.
        editInputs(() => setAreaSel({ kind: "anywhere" }), "where");
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  };

  // The effective (daypart, clock, area, centre) for a build/reshuffle click —
  // uses the live wall clock at click time, same resolution as the memoised
  // preview.
  const planOpts = (offsetOverride: number) => {
    const now = new Date();
    const t = resolveTiming(
      when,
      customDate || toISODate(now),
      customTime,
      now,
    );
    return {
      area: toPlanArea(areaSel),
      vibe,
      budget,
      offset: offsetOverride,
      when: t.when,
      daypart: t.daypart,
      center: areaSel.kind === "nearYou" ? center : null,
      tasteScores,
    };
  };

  // ── Setup screen ────────────────────────────────────────────────────
  if (step === "setup") {
    return (
      <div>
        <div className="px-5 pt-8 pb-5">
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
            Tell us a few things. We&apos;ll plan the rest.
          </div>
        </div>

        <Group label="When">
          <WhenPicker
            choice={when}
            dateStr={customDate}
            timeStr={customTime}
            minDate={todayISO}
            onChange={({ choice, dateStr, timeStr }) =>
              editInputs(() => {
                setWhen(choice);
                setCustomDate(dateStr);
                setCustomTime(timeStr);
              }, "when")
            }
          />
        </Group>

        <Group label="Vibe">
          <div className="grid grid-cols-2 gap-2">
            {VIBES.map((v) => {
              const on = vibe === v.v;
              return (
                <button
                  key={v.v}
                  type="button"
                  onClick={() => editInputs(() => setVibe(v.v), "vibe")}
                  className={
                    "px-3.5 py-3 rounded-[14px] border-[1.5px] text-fg text-left flex items-center gap-2 text-[13px] font-bold " +
                    (on
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card")
                  }
                >
                  <v.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden />
                  {v.v}
                </button>
              );
            })}
          </div>
        </Group>

        <Group label="Area">
          <AreaPicker
            value={areaSel}
            venues={venues}
            onChange={(a) =>
              editInputs(() => {
                setAreaSel(a);
                setCenter(null);
                setGeoState("idle");
              }, "where")
            }
            nearYou={{ state: geoState, onPick: pickNearYou }}
          />
        </Group>

        <Group label="Budget">
          <div className="grid grid-cols-3 gap-2">
            {BUDGETS.map((b) => {
              const on = budget === b;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => editInputs(() => setBudget(b), "budget")}
                  className={
                    "h-11 rounded-xl border-[1.5px] text-fg font-extrabold text-[13px] " +
                    (on
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card")
                  }
                >
                  {b}
                </button>
              );
            })}
          </div>
        </Group>

        <div className="px-5 pt-5">
          <button
            type="button"
            onClick={() => {
              // Compute with the offset this click will apply (0) so the event
              // reflects the plan actually shown — useMemo's `computed` is a
              // render behind the setOffset below.
              //
              // The timer wraps ONLY computePlan. It is the actual elapsed
              // work: a local, synchronous engine call over the in-props
              // catalogue. The setState calls below are React scheduling, not
              // work the user waited on, and animation timing is never used to
              // manufacture a number.
              const t0 = performance.now();
              const result = computePlan(venues, planOpts(0));
              const duration_ms = Math.round(performance.now() - t0);
              setOffset(0);
              setEdited(null);
              editedRef.current = null;
              setUndoStack([]);
              standDown();
              // Build produces a DIFFERENT night, so the save flag from the
              // last one must not follow it. Without this: Build -> Try
              // another -> Save -> Edit -> Build left the button reading
              // "Saved to your nights", disabled, on a night that had never
              // been saved — the app refusing to save while claiming it
              // already had.
              setSaveState("idle");
              setStep("result");
              recordSignal("plan_started", { surface: "plan" });
              const genProps = {
                area: result.area, // resolved walkable pocket
                areaKind: areaSel.kind, // legacy spelling, kept for insights
                area_kind: areaSel.kind, // anywhere | nearYou | region | neighbourhood
                vibe,
                budget,
                daypart: result.daypart, // day out vs night
                stops: result.steps.length, // legacy spelling
                stop_count: result.steps.length, // 0-3 stops filled
                full: result.steps.length === 3, // did it fill a complete night?
                poolStage: result.poolStage, // legacy spelling
                pool_stage: result.poolStage, // area | budget | all (had to widen?)
                poolSize: result.poolSize, // legacy spelling
                pool_size: result.poolSize, // candidates the engine chose from
                duration_ms,
              };
              // A night with zero stops is a FAILURE the user sees, even though
              // nothing threw. Until now this emitted plan_generate regardless,
              // so every no-result was counted as a success.
              if (result.steps.length === 0) {
                track("plan_generate_failed", {
                  ...genProps,
                  reason: "no_result",
                });
              } else {
                track("plan_generate", genProps);
              }
            }}
            className="w-full h-[52px] rounded-2xl bg-primary text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
          >
            Build the plan{" "}
            <Sparkles
              className="w-4 h-4 inline-block align-[-3px]"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </div>

        {/* Saved nights — signed-in re-open */}
        {savedPlans.length > 0 && (
          <Group label="Your saved nights">
            {pendingSaved && (
              <div className="mb-2.5 rounded-2xl border border-border bg-card p-4">
                <div className="text-[14px] font-extrabold text-heading">
                  You have a night in progress
                </div>
                <p className="text-[12px] text-muted-fg mt-1 leading-relaxed">
                  Opening <b className="text-heading">{pendingSaved.title}</b>{" "}
                  replaces the night you were building. Your saved nights stay
                  saved either way.
                </p>
                <div className="flex flex-col gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      const row = pendingSaved;
                      setPendingSaved(null);
                      reallyOpenSaved(row);
                      track("plan_reopen_conflict_resolved", {
                        choice: "open_saved",
                      });
                    }}
                    className="h-11 rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold"
                  >
                    Open the saved night
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingSaved(null);
                      track("plan_reopen_conflict_resolved", {
                        choice: "keep_current",
                      });
                    }}
                    className="h-11 rounded-2xl border-[1.5px] border-border bg-card text-[14px] font-extrabold text-fg"
                  >
                    Keep the one I&apos;m building
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {savedPlans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openSaved(p)}
                  className="text-left bg-card border border-border rounded-2xl px-4 py-3"
                >
                  <div className="text-[14px] font-extrabold text-heading">
                    {p.title}
                  </div>
                  <div className="text-[11px] text-muted-fg mt-0.5">
                    {p.steps.length} stops · tap to re-open
                  </div>
                </button>
              ))}
            </div>
          </Group>
        )}
      </div>
    );
  }

  // ── Result screen ───────────────────────────────────────────────────
  // Guard: if the chosen area/vibe/budget yields no venues (e.g. an empty or
  // over-filtered catalogue), there's nothing to route — show a friendly
  // dead-end with a way back instead of a "Night in " header with zero stops.
  if (display.steps.length === 0) {
    return (
      <div className="px-5 py-16 text-center">
        <MapIcon
          className="w-10 h-10 text-muted-fg mb-3"
          strokeWidth={1.75}
          aria-hidden
        />
        <h2 className="text-xl font-extrabold text-heading mb-1.5">
          No plan for that combo
        </h2>
        <p className="text-sm text-muted-fg max-w-[300px] mx-auto leading-relaxed mb-6">
          We couldn&apos;t pull together enough spots for{" "}
          {display.area ? <b>{display.area}</b> : "that mix"} right now. Try a
          different area or vibe.
        </p>
        <button
          type="button"
          onClick={() => {
            standDown();
            setStep("setup");
          }}
          className="h-11 px-5 rounded-2xl bg-primary text-white font-extrabold text-[15px]"
        >
          Adjust my plan
        </button>
      </div>
    );
  }

  // Real turn-by-turn for the whole night (null when no stop has coordinates).
  const mapsUrl = googleMapsWalkingUrl(
    display.steps.map((s) => ({
      lat: s.venue.lat,
      lng: s.venue.lng,
      name: s.venue.name,
    })),
  );

  return (
    <div>
      <div
        className="px-5 pt-5 pb-5.5 text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
        }}
      >
        <button
          type="button"
          onClick={() => {
            // 🧨 Setup's only forward action is Build, which discards the
            // night, its replacements and its undo history — and this button
            // sits where a back button sits, styled like the Undo chip beside
            // it. One tap of curiosity cost three changes with no warning.
            if (hasReplacements && !confirmEdit) {
              setConfirmEdit(true);
              // One question at a time: two competing loss warnings with two
              // disabled primaries is not a choice, it is a wall.
              setConfirmReshuffle(false);
              track("plan_edit_confirm_shown", { replaced: replacedCount });
              return;
            }
            setConfirmEdit(false);
            setStep("setup");
          }}
          disabled={confirmEdit && hasReplacements}
          className="bg-white/15 text-white rounded-lg px-2.5 py-1 text-[11px] font-bold mb-2.5 disabled:opacity-50"
        >
          ← Edit
        </button>
        {confirmEdit && hasReplacements && (
          <div className="mb-2.5 rounded-2xl bg-white/15 p-3 text-left">
            <p className="text-[12px] leading-relaxed m-0">
              You&apos;ve changed{" "}
              {replacedCount === 1 ? "a stop" : `${replacedCount} stops`}.
              Rebuilding from setup won&apos;t keep{" "}
              {replacedCount === 1 ? "it" : "them"}.
            </p>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmEdit(false);
                  setStep("setup");
                }}
                className="h-9 px-3 rounded-xl bg-white/25 text-white text-[12px] font-extrabold"
              >
                Edit anyway
              </button>
              <button
                type="button"
                onClick={() => setConfirmEdit(false)}
                className="h-9 px-3 rounded-xl bg-white text-heading text-[12px] font-extrabold"
              >
                Keep my night
              </button>
            </div>
          </div>
        )}
        <h2 className="text-[22px] font-extrabold m-0">
          {display.daypart === "day"
            ? "Today, the plan:"
            : "Tonight, the plan:"}
        </h2>
        <div className="text-xs opacity-90 mt-1.5">
          <MapPin
            className="w-3.5 h-3.5 inline-block align-[-3px]"
            strokeWidth={1.75}
            aria-hidden
          />{" "}
          {display.area === ANYWHERE
            ? "Across London"
            : `Around ${display.area}`}{" "}
          ·{" "}
          <Clock
            className="w-3.5 h-3.5 inline-block align-[-3px]"
            strokeWidth={1.75}
            aria-hidden
          />{" "}
          {fmtHours(display.totalMins)}
        </div>
        {canStartEarlier ? (
          <button
            type="button"
            onClick={startEarlier}
            className="mt-2.5 mr-2 inline-flex items-center gap-1.5 bg-white/15 text-white rounded-lg px-2.5 py-1 text-[11px] font-bold"
          >
            <Clock className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
            Start 30 min earlier
          </button>
        ) : null}
        {startShiftMins !== 0 ? (
          // 🧨 An INERT readout, ALONGSIDE the chip rather than as its
          // else-branch. As the else it vanished exactly when a user was most
          // likely to tap twice — a shift that helped but did not fully fix
          // kept the chip and dropped the readout. Alongside, it reports every
          // shift, and when a successful tap unmounts the chip it still holds
          // the row so "Undo change" cannot slide under a second eager tap.
          <span className="mt-2.5 mr-2 inline-flex items-center gap-1.5 bg-white/10 text-white/80 rounded-lg px-2.5 py-1 text-[11px] font-bold">
            <Clock className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
            Starting {-startShiftMins} min earlier
          </span>
        ) : null}
        {canUndo && (
          <button
            type="button"
            onClick={undoReplace}
            className="mt-2.5 inline-flex items-center gap-1.5 bg-white/15 text-white rounded-lg px-2.5 py-1 text-[11px] font-bold"
          >
            <Undo2 className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
            Undo change
          </button>
        )}
      </div>

      {/* fl-stagger: stops rise in sequence when a plan lands (the system's
          existing per-item entrance; reduced-motion collapses it to instant). */}
      <div className="px-5 py-4 flex flex-col gap-2.5 fl-stagger">
        {display.steps.map((s, i) => (
          <div key={`${s.venue.id}-${i}`}>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-[26px] h-[26px] rounded-full border-2 border-accent text-accent grid place-items-center text-xs font-extrabold">
                {i + 1}
              </div>
              <div className="text-[11px] font-extrabold tracking-[0.12em] text-muted-fg uppercase">
                {s.role}
              </div>
              {/* 🧨 ALWAYS RENDERED. It used to vanish when a stop had no
                  options, which reads as a bug rather than as a constraint —
                  and it can happen for a good reason: a candidate must be
                  within a short walk of BOTH neighbours, and open when you get
                  there, so a stop between two distant ones can genuinely have
                  nothing that fits. Disabled with the reason attached is
                  honest; absent is not. Same shape the Save button already
                  uses. */}
              <button
                type="button"
                onClick={() => onSwap(i, 1, "button")}
                disabled={(alternatives[i]?.length ?? 0) === 0}
                // The same string the notice shows, so the two cannot
                // diverge. Not a promise that "start earlier" never appears:
                // an OPEN stop with no options still falls through to
                // noOptionsReason, which says it. That case is out of this
                // PR's scope and is listed in its limitations.
                title={stopNotice(i) ?? undefined}
                aria-label={`Change the ${s.role} stop`}
                className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-accent disabled:text-muted-fg disabled:cursor-default"
              >
                <RotateCw className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                Change
              </button>
            </div>
            {/* 🧨 ONE message per stop, replacing two that contradicted. These
                were two independent paragraphs, so the worst stop read
                "Nothing else here works with your timings" directly above
                "Closed by the time you'd get here. Change it, or start
                earlier" — with Change disabled three lines up and no way to
                start earlier on this screen at all. Following that instruction
                meant "← Edit", which stands the night down and empties the
                undo stack: "adjust one thing" actually meant "throw it away".
                A reroll DOES work here and is already on the screen, so that
                is what the copy points at. */}
            {stopNotice(i) && (
              <p
                className={`text-[11px] mb-1.5 leading-relaxed ${
                  closedStops.includes(i)
                    ? "font-bold text-accent"
                    : "text-muted-fg"
                }`}
              >
                {closedStops.includes(i) && (
                  <AlertCircle
                    className="w-3.5 h-3.5 inline-block align-[-3px] mr-1"
                    strokeWidth={2}
                    aria-hidden
                  />
                )}
                {stopNotice(i)}
              </p>
            )}
            <SwipeStop
              enabled={(alternatives[i]?.length ?? 0) > 0}
              onSwipe={(dir) => onSwap(i, dir, "swipe")}
            >
              <Link
                href={`/venue/${s.venue.slug}`}
                // Booking attribution, carried in sessionStorage rather than the
                // URL: a query param here would opt the venue route out of
                // static rendering and kill the /anon/venue/[slug] ISR cache.
                // Slug + 0-based stop index only.
                onClick={() => writePlanHandoff(s.venue.slug, i)}
                className="block bg-card border border-border rounded-2xl overflow-hidden transition-transform duration-300 ease-out lg:hover:-translate-y-0.5"
              >
                <div
                  className="h-[120px]"
                  style={{ background: `url(${s.venue.imgUrl}) center/cover` }}
                />
                <div className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[15px] font-extrabold text-heading">
                      {s.venue.name}
                    </div>
                    <span className="text-[11px] font-bold text-primary whitespace-nowrap">
                      View →
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-fg mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-accent font-bold">
                      {s.venue.type}
                    </span>
                    <span>·</span>
                    <span>
                      <Star
                        className="w-3.5 h-3.5 inline-block align-[-3px]"
                        strokeWidth={1.75}
                        fill="currentColor"
                        aria-hidden
                      />{" "}
                      {s.venue.rating}
                    </span>
                    <span>·</span>
                    <span>{s.venue.price}</span>
                    <span>·</span>
                    <span>
                      <Clock
                        className="w-3.5 h-3.5 inline-block align-[-3px]"
                        strokeWidth={1.75}
                        aria-hidden
                      />{" "}
                      ~{s.dwellMins} min
                    </span>
                    {s.arriveAt && (
                      <>
                        <span>·</span>
                        <span className="font-bold text-fg">
                          arrive ~{fmtTime(s.arriveAt)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-fg italic mt-1">
                    &quot;{s.venue.vibe}&quot;
                  </div>
                  {s.venue.planNote && (
                    <div className="text-[12px] text-fg mt-1.5 flex items-start gap-1 leading-snug">
                      <Sparkles
                        className="w-3.5 h-3.5 mt-px shrink-0 text-accent"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span>{s.venue.planNote}</span>
                    </div>
                  )}
                </div>
              </Link>
            </SwipeStop>
            {s.walkToNextMins != null && (
              <div className="ml-3 text-[11px] text-muted-fg py-1.5 pl-3 border-l-2 border-dashed border-border">
                <Footprints
                  className="w-3.5 h-3.5 inline-block align-[-3px]"
                  strokeWidth={1.75}
                  aria-hidden
                />{" "}
                ~{s.walkToNextMins} min walk
              </div>
            )}
          </div>
        ))}
      </div>

      {/* The walk on a map + real turn-by-turn in Google Maps (both live and
          re-opened saved plans). */}
      {mapsUrl && (
        <div className="px-5 pb-3">
          <div className="text-[11px] font-extrabold tracking-[0.12em] text-muted-fg uppercase mb-2.5">
            The walk
          </div>
          <PlanRouteMapLive steps={display.steps} />
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              recordSignal("outbound_click", { surface: "plan" });
              track("plan_open_maps", { stops: display.steps.length });
            }}
            className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-border bg-card text-[14px] font-extrabold text-fg"
          >
            <MapIcon className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            Open in Google Maps
          </a>
        </div>
      )}

      {/* Actions. "Try another combination" shows on EVERY night, including a
          re-opened saved one: it is not an edit of the saved row, it is "give
          me a different night", and it stands the re-opened night down first.
          Without it a re-opened night had no forward action on the whole
          screen — the one thing this product does was the one button missing.
          Save shows on every night; see the button for how a reopened saved
          row is handled. */}
      {
        <div className="px-5 pb-2 flex flex-col gap-2.5">
          {/* Undo and per-stop Change stay live while the card is open, so
              this has to re-check: undoing to zero left it asserting work that
              no longer existed. */}
          {confirmReshuffle && hasReplacements && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-[14px] font-extrabold text-heading">
                This throws away your changes
              </div>
              <p className="text-[12px] text-muted-fg mt-1 leading-relaxed">
                You&apos;ve changed{" "}
                {replacedCount === 1 ? "a stop" : `${replacedCount} stops`} on
                this night. A new combination replaces all of it, and Undo
                won&apos;t bring it back.
              </p>
              <div className="flex flex-col gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReshuffle(false);
                    doReshuffle();
                  }}
                  className="h-11 rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold"
                >
                  Build a new combination
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReshuffle(false)}
                  className="h-11 rounded-2xl border-[1.5px] border-border bg-card text-[14px] font-extrabold text-fg"
                >
                  Keep my changes
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              // 🧨 ASK FIRST when there is deliberate work to lose. This is the
              // most prominent control on the screen, it sits directly above
              // Save, and it wiped every manual replacement with no warning —
              // the undo stack is cleared in the same frame, so there was no
              // way back.
              if (hasReplacements && !confirmReshuffle) {
                setConfirmReshuffle(true);
                setConfirmEdit(false);
                track("plan_reshuffle_confirm_shown", {
                  replaced: replacedCount,
                });
                return;
              }
              doReshuffle();
            }}
            // 🧨 THE SAME EXPRESSION THE CARD RENDERS ON. Gating the card on
            // `hasReplacements` while leaving this on `confirmReshuffle` alone
            // stranded the screen's primary forward action: open the card,
            // then Undo (or cycle a stop back onto its original, which the
            // base is deliberately re-offered as) and replacedCount hits zero,
            // the card unmounts, and the flag stays true with nothing left on
            // screen to clear it. Three taps to a permanently greyed button —
            // the same shape as the stale undo entry this file already carries
            // a note about. Tapping through with zero replacements correctly
            // falls straight to doReshuffle().
            disabled={confirmReshuffle && hasReplacements}
            className="w-full h-12 rounded-2xl border-[1.5px] border-accent text-accent text-[14px] font-extrabold disabled:opacity-50"
          >
            Try another combination{" "}
            <RotateCw
              className="w-4 h-4 inline-block align-[-3px]"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>

          {/* Save shows on a reopened saved row too. It was hidden because
              the plans write is insert-only, so re-saving means a duplicate
              row — but hiding the control is not a way to say that, and this
              branch made the night editable, so the user could replace a stop
              believing they had edited what they saved. `alreadySaved`
              already answers it correctly: an untouched reopened row matches
              its own signature and renders "Saved to your nights", disabled;
              the instant a stop is replaced the signature diverges and it
              becomes a real Save with mode "resave_after_swap". For an
              insert-only table that is the honest semantics anyway — a
              changed night is a new night. */}
          {authUserId ? (
            <button
              type="button"
              onClick={onSave}
              disabled={
                // "error" stays ENABLED: the button is the retry — including
                // when the error-path list reload ALSO failed (same outage),
                // which used to grey a button still labelled "tap to retry"
                // over a paragraph saying Save is off. The duplicate risk the
                // list gate exists for is moot mid-outage: a retry that
                // cannot reach the server cannot insert anything.
                saveState === "saving" ||
                saveState === "saved" ||
                alreadySaved ||
                (saveState !== "error" &&
                  // A reopened saved row before its list has loaded: we cannot
                  // yet tell "already saved" from "new", and guessing wrong
                  // writes a permanent duplicate.
                  // Not just "saved": any night whose already-saved status we
                  // cannot confirm. An unconfirmed live night can duplicate
                  // too.
                  !savedListLoaded)
              }
              className="w-full h-12 rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold disabled:opacity-70"
            >
              {saveState === "saved" || alreadySaved ? (
                <>
                  Saved to your nights{" "}
                  <Check
                    className="w-4 h-4 inline-block align-[-3px]"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </>
              ) : saveState === "saving" ? (
                "Saving…"
              ) : saveState === "error" ? (
                "Couldn't save · tap to retry"
              ) : (
                "Save this night"
              )}
            </button>
          ) : (
            <Link
              href="/sign-in?return=/plan"
              onClick={() => writeSignInTrigger("plan_save")}
              className="w-full h-12 rounded-2xl bg-muted text-muted-fg text-[14px] font-extrabold flex items-center justify-center"
            >
              Sign in to save this night
            </Link>
          )}
          {authUserId && !savedListLoaded && !savedListFailed && (
            <p className="text-[11px] text-muted-fg leading-relaxed text-center">
              Checking your saved nights, so this doesn&apos;t save twice.
            </p>
          )}
          {authUserId && savedListFailed && (
            <p className="text-[11px] text-muted-fg leading-relaxed text-center">
              <AlertCircle
                className="w-3.5 h-3.5 inline-block align-[-3px] mr-1"
                strokeWidth={2}
                aria-hidden
              />
              {saveState === "error"
                ? "We couldn't check your saved nights either. Retrying may save this twice if the first attempt landed."
                : "We couldn't check your saved nights, so Save is off to avoid saving this twice."}{" "}
              <button
                type="button"
                onClick={() => void loadSavedPlans()}
                className="font-extrabold text-accent underline"
              >
                Try again
              </button>
            </p>
          )}
        </div>
      }
    </div>
  );
}

// Group moved to ./plan-controls (shared with the anon setup).
