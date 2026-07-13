import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMBED_MODEL,
  EMBED_DIM,
  reviewTexts,
  meanPoolUnit,
  toVectorLiteral,
  buildEmbeddingRow,
  embedAndUpsertVenue,
} from "../venue-embedding";

// The invariant these tests pin: every writer of venue_embeddings (the
// catalogue backfill AND the approve-time ingest path) produces the same row
// shape, with a unit vector of the right dimension. The model itself is not
// exercised here (it downloads weights); the pure pieces around it are.

describe("reviewTexts", () => {
  it("handles null and non-array input", () => {
    expect(reviewTexts(null)).toEqual([]);
    expect(reviewTexts(undefined)).toEqual([]);
  });

  it("trims and drops empty or missing text", () => {
    expect(
      reviewTexts([
        { text: "  great pasta  " },
        { text: "" },
        { text: "   " },
        {},
        { text: "cosy" },
      ]),
    ).toEqual(["great pasta", "cosy"]);
  });
});

describe("meanPoolUnit", () => {
  it("returns a unit vector", () => {
    const a = new Array(EMBED_DIM).fill(0);
    const b = new Array(EMBED_DIM).fill(0);
    a[0] = 1;
    b[1] = 1;
    const pooled = meanPoolUnit([a, b]);
    const norm = Math.sqrt(pooled.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    // mean of e0 and e1 points along (1,1,0,...) normalised
    expect(pooled[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(pooled[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(pooled[2]).toBeCloseTo(0, 6);
  });

  it("is identity (up to norm) for a single unit vector", () => {
    const a = new Array(EMBED_DIM).fill(0);
    a[5] = 1;
    expect(meanPoolUnit([a])[5]).toBeCloseTo(1, 6);
  });
});

describe("toVectorLiteral", () => {
  it("formats a pgvector literal with 6 decimals", () => {
    expect(toVectorLiteral([0, 1, -0.5])).toBe(
      "[0.000000,1.000000,-0.500000]",
    );
  });
});

describe("buildEmbeddingRow", () => {
  const vec = new Array(EMBED_DIM).fill(0);
  vec[0] = 1;

  it("produces the shared venue_embeddings row shape", () => {
    const row = buildEmbeddingRow("venue-1", vec, 5, "2026-07-01T00:00:00Z");
    expect(row.venue_id).toBe("venue-1");
    expect(row.model).toBe(EMBED_MODEL);
    expect(row.source_reviews_count).toBe(5);
    expect(row.reviews_synced_at).toBe("2026-07-01T00:00:00Z");
    expect(typeof row.updated_at).toBe("string");
    expect(row.review_embedding).toBe(toVectorLiteral(vec));
  });

  it("rejects a vector of the wrong dimension", () => {
    expect(() => buildEmbeddingRow("venue-1", [1, 0], 1, null)).toThrow(
      /dim 2, expected 384/,
    );
  });
});

describe("embedAndUpsertVenue", () => {
  it("writes nothing when the venue has no usable review text", async () => {
    let touched = false;
    const stub = {
      from() {
        touched = true;
        throw new Error("should not reach supabase");
      },
    } as unknown as SupabaseClient;
    const res = await embedAndUpsertVenue(stub, {
      id: "venue-1",
      reviews: [{ text: "   " }, {}],
      reviews_synced_at: null,
    });
    expect(res).toEqual({ status: "no_reviews" });
    expect(touched).toBe(false);
  });
});
