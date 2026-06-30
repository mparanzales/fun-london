// Stage 2.1 — the user taste vector.
//
// A user's taste lives in the SAME space as the venue hybrid vector (Stage 1.3):
// it's a recency-decayed, signal-weighted sum of the hybrid vectors of the
// venues they engaged with. Saves/booking-clicks pull toward a venue; dismisses
// push away. "For You" is then the venues nearest this vector (Stage 3).
//
//   taste = normalise( Σ_i  weight(signalᵢ) · recency(ageᵢ) · venueVectorᵢ )
//
// Weights live in code (not the DB) so the Stage-7 bandit can tune them.

import type { SignalType } from "./signals";
import { normalise } from "./tag-vocabulary";
import { HYBRID_DIM } from "./hybrid-vector";

// Base learning weights per signal (algorithm step 0.2). Positive = "more like
// this", negative = "less". search/filter/plan_started carry no taste (they're
// navigation/intent, not a verdict on a venue).
export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  save: 1.0,
  outbound_click: 0.6, // refined by target below (booking 0.9, directions 0.7)
  plan_completed: 0.8,
  react: 0.7,
  open: 0.3,
  dwell: 0.2,
  search: 0,
  filter: 0,
  plan_started: 0,
  plan_abandoned: 0,
  // Impressions are EXPOSURE, not a taste verdict. The 0.2 taxonomy pencilled in
  // -0.05, but verified against real data (scripts/verify-taste.ts) that breaks:
  // hundreds of "seen-but-scrolled-past" rows sum to more negative weight than a
  // handful of deliberate saves AND inject the average-venue direction, pointing
  // taste AWAY from all normal venues (top recs became dental clinics & parks).
  // So impressions carry 0 taste weight here; the "saw-but-skipped" negative
  // belongs in a per-venue, capped form (Stage 6), not this raw sum.
  impression: 0,
  unsave: -0.6,
  veto: -0.8,
  dismiss: -1.0,
};

// outbound_click intent varies by where it goes (context.target).
const OUTBOUND_TARGET_WEIGHT: Record<string, number> = {
  booking: 0.9,
  directions: 0.7,
  menu: 0.6,
  website: 0.6,
  instagram: 0.4,
};

/** Weight for one signal, refining outbound_click by its target. */
export function signalWeight(
  eventType: SignalType,
  context?: Record<string, unknown> | null,
): number {
  if (eventType === "outbound_click") {
    const t = typeof context?.target === "string" ? context.target : "";
    return OUTBOUND_TARGET_WEIGHT[t] ?? SIGNAL_WEIGHTS.outbound_click;
  }
  return SIGNAL_WEIGHTS[eventType] ?? 0;
}

// Recency decay — older taps fade so taste tracks the user's CURRENT mood.
// Exponential half-life: a signal HALF_LIFE_DAYS old counts half as much.
export const HALF_LIFE_DAYS = 45;
export function recencyWeight(
  ageDays: number,
  halfLifeDays = HALF_LIFE_DAYS,
): number {
  if (ageDays <= 0) return 1;
  return Math.pow(2, -ageDays / halfLifeDays);
}

export interface TasteSignal {
  vector: number[]; // the venue's hybrid item vector (Stage 1.3)
  eventType: SignalType;
  context?: Record<string, unknown> | null;
  ageDays?: number; // age of the signal in days (default 0 = now)
}

/**
 * Build a user's taste vector from their signals: a recency-decayed,
 * signal-weighted sum of venue hybrid vectors, L2-normalised. Dismissed /
 * vetoed venues subtract. Returns an all-zero vector when there's no net signal
 * (brand-new or fully-cancelled user) — the caller then falls back to
 * non-personalised ranking (cold-start, step 2.2).
 */
export function buildTasteVector(signals: TasteSignal[]): number[] {
  const acc = new Array<number>(HYBRID_DIM).fill(0);
  for (const s of signals) {
    if (s.vector.length !== HYBRID_DIM) continue;
    const w =
      signalWeight(s.eventType, s.context) * recencyWeight(s.ageDays ?? 0);
    if (w === 0) continue;
    for (let i = 0; i < HYBRID_DIM; i++) acc[i] += w * s.vector[i];
  }
  return normalise(acc);
}

/**
 * Online single-signal update (the production path — avoids recomputing from
 * full history on every tap). `taste` is the running UNNORMALISED accumulator;
 * decay it by the time since the last update, then add the new weighted vector.
 * Call `normalise()` only when READING for ranking. Mathematically equivalent
 * to buildTasteVector over the whole history.
 */
export function accumulateSignal(
  taste: number[],
  venueVector: number[],
  eventType: SignalType,
  opts: {
    context?: Record<string, unknown> | null;
    daysSinceLastUpdate?: number;
  } = {},
): number[] {
  const decay = recencyWeight(opts.daysSinceLastUpdate ?? 0);
  const w = signalWeight(eventType, opts.context ?? null);
  const base =
    taste.length === HYBRID_DIM ? taste : new Array<number>(HYBRID_DIM).fill(0);
  const useVenue = venueVector.length === HYBRID_DIM;
  const out = new Array<number>(HYBRID_DIM).fill(0);
  for (let i = 0; i < HYBRID_DIM; i++) {
    out[i] = decay * base[i] + (useVenue ? w * venueVector[i] : 0);
  }
  return out;
}
