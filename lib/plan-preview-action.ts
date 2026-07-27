"use server";

// Public POST endpoint (every export of a "use server" file is one): the
// anonymous plan builder. Thin shell — validation and the moat live in
// lib/plan-preview.ts (server-only); this file only rate-limits and relays.
//
// 12 builds/hour per IP is COST control, not anti-enumeration — card-level
// rows are already DB-open via the anon key; the moat is the column grants,
// which this endpoint never crosses (guardian gate, 2026-07-27). The
// throttled response is a SIGN-IN moment, not an error: a rate-limited anon
// being pushed to sign up is the product working (ux gate condition 4).

import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildAnonPlanPreview,
  type AnonPlanInput,
  type AnonPlanResult,
} from "@/lib/plan-preview";

const LIMIT = 12;
const WINDOW_MS = 60 * 60 * 1000;

export type AnonPlanActionResult =
  AnonPlanResult | { ok: false; reason: "limited" };

export async function buildAnonPlan(
  input: AnonPlanInput,
): Promise<AnonPlanActionResult> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "local";
  // Hashed key: we want "same actor, many builds" correlation in Redis and
  // logs, never a raw address (CGNAT means shared IPs — the generous limit
  // absorbs that; see the gate notes).
  const { createHash } = await import("node:crypto");
  const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const allowed = await rateLimit(`planprev:${ipHash}`, LIMIT, WINDOW_MS);
  if (!allowed) {
    console.warn(
      `[rate-limit] plan-preview trip ipHash=${ipHash.slice(0, 12)}`,
    );
    return { ok: false, reason: "limited" };
  }
  return buildAnonPlanPreview(input);
}
