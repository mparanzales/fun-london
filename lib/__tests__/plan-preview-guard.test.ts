import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { toAnonPlanPayload } from "@/lib/plan-preview-shape";
import type { Plan } from "@/lib/plan-engine";
import type { VenuePlanRow } from "@/lib/queries";

// Guard: the anonymous plan payload can never carry moat fields.
//
// WHY THIS EXISTS. The anon /plan preview runs the engine SERVER-SIDE over
// service-role rows (vibe_tags, opening_hours, plan_note — all outside the
// anon column grants). The engine's Plan object holds FULL engine venues in
// steps[].venue and up to 8 more per stop in alternatives — returning or
// spreading any of that from the server action would leak 3–27 moat-bearing
// venues in one serialization (supabase-guardian gate C1/C4, 2026-07-27).
// toAnonPlanPayload is the single enforcement point: this test feeds it a
// POISONED plan + rows where every moat field carries a seeded secret, then
// asserts none of it survives into the serialized payload.

const SECRET = {
  tag: "SECRET_VIBE_TAG_9f3a",
  note: "SECRET_PLAN_NOTE_9f3a",
  hours: "SECRET_HOURS_9f3a",
  desc: "SECRET_LONG_DESC_9f3a",
  phone: "SECRET_PHONE_9f3a",
};

function poisonedRow(id: string, slug: string): VenuePlanRow {
  return {
    id,
    slug,
    name: `Venue ${slug}`,
    type: "Restaurant",
    vibe: "A fine spot.",
    vibe_tags: [SECRET.tag],
    neighbourhood: "Soho",
    price: "££",
    time_of_day: "Evening",
    rating: 4.6,
    review_count: 100,
    lat: 51.51,
    lng: -0.13,
    opening_hours: { weekdayDescriptions: [SECRET.hours] },
    plan_note: SECRET.note,
    img_url: "https://img.funldn.com/x.jpg",
    curation_tier: null,
    created_at: "2026-01-01",
  } as unknown as VenuePlanRow;
}

function poisonedEngineVenue(id: string, slug: string) {
  return {
    id,
    slug,
    name: `Venue ${slug}`,
    type: "Restaurant",
    vibe: "A fine spot.",
    vibeTags: [SECRET.tag],
    openingHours: { weekdayDescriptions: [SECRET.hours] },
    planNote: SECRET.note,
    longDescription: SECRET.desc,
    phone: SECRET.phone,
    neighbourhood: "Soho",
    price: "££",
    rating: 4.6,
    reviewCount: 100,
    lat: 51.51,
    lng: -0.13,
    imgUrl: "https://img.funldn.com/x.jpg",
  };
}

function poisonedPlan(): Plan {
  const mk = (n: number) => ({
    venue: poisonedEngineVenue(`id-${n}`, `stop-${n}`),
    role: "dinner",
    dwellMins: 75,
    walkToNextMins: n < 3 ? 6 : null,
    arriveAt: null,
  });
  return {
    area: "Soho",
    vibe: "Chill",
    budget: "££",
    daypart: "evening",
    steps: [mk(1), mk(2), mk(3)],
    totalMins: 240,
    poolStage: "area",
    poolSize: 42,
    alternatives: [
      [poisonedEngineVenue("alt-1", "alt-1")],
      [poisonedEngineVenue("alt-2", "alt-2")],
      [],
    ],
  } as unknown as Plan;
}

describe("anon plan payload holds the moat", () => {
  const rows = new Map<string, VenuePlanRow>([
    ["id-1", poisonedRow("id-1", "stop-1")],
    ["id-2", poisonedRow("id-2", "stop-2")],
    ["id-3", poisonedRow("id-3", "stop-3")],
  ]);
  const payload = toAnonPlanPayload(poisonedPlan(), rows, new Date());
  const json = JSON.stringify(payload);

  it("builds all three stops", () => {
    expect(payload).not.toBeNull();
    expect(payload!.stops).toHaveLength(3);
  });

  it("carries no moat KEYS, either casing", () => {
    for (const key of [
      "vibe_tags",
      "vibeTags",
      "opening_hours",
      "openingHours",
      "plan_note",
      "planNote",
      "long_description",
      "longDescription",
      "booking_links",
      "bookingLinks",
      "phone",
      "reviews",
      "address",
      "alternatives",
      "poolStage",
      "poolSize",
    ]) {
      expect(json, `payload leaks key "${key}"`).not.toContain(`"${key}"`);
    }
  });

  it("carries no seeded moat VALUES (spread-shaped leaks)", () => {
    for (const v of Object.values(SECRET)) {
      expect(json, `payload leaks value "${v}"`).not.toContain(v);
    }
  });

  it("isOpenNow is a plain boolean, hours never serialize", () => {
    for (const s of payload!.stops) expect(typeof s.isOpenNow).toBe("boolean");
  });

  it("drops a step whose raw row is missing, never falls back to the engine venue", () => {
    const partial = new Map([["id-1", poisonedRow("id-1", "stop-1")]]);
    const p = toAnonPlanPayload(poisonedPlan(), partial, new Date());
    expect(p!.stops).toHaveLength(1);
    expect(JSON.stringify(p)).not.toContain(SECRET.tag);
  });
});

describe("anon plan client stays outside the moat", () => {
  const src = readFileSync(
    fileURLToPath(
      new URL("../../app/(main)/plan/anon-plan-flow.tsx", import.meta.url),
    ),
    "utf8",
  );
  // Comments in the file mention module paths; only real import statements
  // count. (A guard that reads its own explanatory prose is a guard that
  // cannot fail — this suite has been bitten by that twice.)
  const imported = [
    ...src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .matchAll(/\bfrom\s+"([^"]+)"/g),
  ].map((m) => m[1]);

  it("imports nothing outside the allowlist", () => {
    // 🧨 ALLOWLIST, not a denylist. The previous version named three forbidden
    // modules, so it had no opinion on any module nobody had thought of — and
    // it stayed green while this branch added two new imports to this exact
    // file. The invariant is "3 card-level stops from the server action and
    // nothing else", which is a statement about what MAY be imported. Adding
    // a line here is a deliberate act; forgetting to forbid one is not.
    const allowed = new Set([
      "react",
      "next/link",
      "next/image",
      "lucide-react",
      "@/components/auth-wall",
      "./plan-controls",
      "./plan-together-card",
      "@/lib/plan-preview-action",
      "@/lib/plan-preview-shape",
      "@/lib/plan-engine",
      "@/lib/analytics",
      "@/lib/analytics-keys",
      "@/lib/analytics-reasons",
      // Canonical night model + the owner-scoped active-plan store. Both are
      // pure shape/localStorage modules: no queries, no supabase client.
      "@/lib/night-plan",
      "@/lib/active-plan",
    ]);
    expect(imported.length).toBeGreaterThan(5);
    for (const m of imported) {
      expect(
        [...allowed],
        `anon-plan-flow imports "${m}", which is not on the allowlist. If it is genuinely moat-safe, add it here on purpose.`,
      ).toContain(m);
    }
  });

  it("never imports the supabase browser client, signals, or queries", () => {
    // Guards the ALLOWLIST itself: these three are the specific direct data
    // paths this flow must never grow, so adding one by mistake above still
    // fails here.
    for (const banned of [
      "@/lib/supabase/client",
      "@/lib/signals",
      "@/lib/queries",
    ]) {
      expect(imported, `anon flow must not import ${banned}`).not.toContain(
        banned,
      );
    }
  });

  it("plan-preview.ts is server-only", () => {
    const preview = readFileSync(
      fileURLToPath(new URL("../plan-preview.ts", import.meta.url)),
      "utf8",
    );
    expect(preview).toMatch(/^import "server-only";/);
  });
});
