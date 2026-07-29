import { describe, it, expect } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  hashRoomCode,
  isValidRoomCode,
  normaliseRoomCode,
  randomRoomCode,
} from "./room-code";

describe("room codes", () => {
  it("generates SIX characters (was four; the enumeration fix)", () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
    for (let i = 0; i < 500; i++) {
      const c = randomRoomCode();
      expect(c).toHaveLength(6);
      expect(isValidRoomCode(c)).toBe(true);
    }
  });

  it("only ever uses the unambiguous alphabet", () => {
    for (let i = 0; i < 500; i++) {
      for (const ch of randomRoomCode()) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
      }
    }
    // The whole point of the alphabet: no glyph PAIRS that get misread when
    // a code is read aloud or retyped (0/O and 1/I). "L" is kept — it is the
    // inherited alphabet and is unambiguous once 1 and I are gone.
    for (const bad of ["0", "O", "1", "I"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(bad);
    }
  });

  it("is not trivially repetitive (sanity on the RNG path)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(randomRoomCode());
    expect(seen.size).toBeGreaterThan(490);
  });

  it("rejects wrong-length and off-alphabet codes", () => {
    expect(isValidRoomCode("K4WP")).toBe(false); // the OLD 4-char format
    expect(isValidRoomCode("K4WP2X")).toBe(true);
    expect(isValidRoomCode("K4WP2!")).toBe(false);
    expect(isValidRoomCode("k4wp2x")).toBe(false); // normalise first
    expect(isValidRoomCode("K4WP2XX")).toBe(false);
  });

  it("normalises what humans type", () => {
    expect(normaliseRoomCode("k4-wp 2x")).toBe("K4WP2X");
    expect(normaliseRoomCode(" k4wp2x ")).toBe("K4WP2X");
  });

  describe("hashRoomCode (analytics correlation)", () => {
    it("is stable and one-way-shaped", () => {
      const code = "K4WP2X";
      const h = hashRoomCode(code);
      expect(h).toBe(hashRoomCode(code));
      expect(h).toHaveLength(12);
      expect(h).toMatch(/^[0-9a-f]+$/);
      // 🧨 The guard that matters: the raw code must not survive in the hash.
      expect(h).not.toContain(code);
      expect(h.toUpperCase()).not.toContain(code);
    });

    it("separates different rooms", () => {
      const hashes = new Set(
        Array.from({ length: 200 }, () => hashRoomCode(randomRoomCode())),
      );
      expect(hashes.size).toBeGreaterThan(190);
    });
  });
});
