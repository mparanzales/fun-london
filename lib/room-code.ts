// Room codes for Plan Together.
//
// Pure + framework-free so both the client and the tests can use it.
//
// WHY 6 CHARS: the old code was 4 chars from a 32-char alphabet — 1,048,576
// combinations, guessable at scale, and the only thing standing between an
// outsider and a room (there was no membership check). 6 chars is
// 32^6 ≈ 1.07 billion, which with the join rate limit makes enumeration
// impractical. Membership records are the real control; this is defence in
// depth, not the fix on its own.
//
// 🧨 A ROOM CODE IS A BEARER SECRET. Never put a raw code in analytics, in a
// saved plan, in an error report, or in a log line. Where a code must be
// correlated across events, send `hashRoomCode(code)` instead — one-way, and
// deliberately truncated so it cannot be brute-forced back into the code
// space by an analytics reader.

// No ambiguous glyphs (0/O, 1/I/L) — codes get read aloud and retyped.
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

/** Cryptographically random 6-char code. Falls back only if WebCrypto is absent. */
export function randomRoomCode(): string {
  const A = ROOM_CODE_ALPHABET;
  const n = A.length;
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    let out = "";
    // 256 % 32 === 0, so a plain modulo is unbiased for this alphabet.
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += A[bytes[i] % n];
    return out;
  }
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++)
    out += A[Math.floor(Math.random() * n)];
  return out;
}

/** Shape check for anything arriving from a URL. Accepts only the alphabet. */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Uppercase + strip separators people type ("k4-wp 2x" → "K4WP2X"). */
export function normaliseRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * ⚠️ NOT USED FOR ANALYTICS ANY MORE, and not suitable for it.
 *
 * Security review (2026-07-29) was right: the salt ships in the client bundle,
 * so a rainbow table over the 32^6 code space recovers a live code from any
 * hash in minutes. Analytics now correlates on the room's UUID instead, which
 * grants nothing on its own. Kept only for non-adversarial local grouping
 * (e.g. the verification script's console output); NEVER send its output to a
 * third party.
 *
 * One-way, salted, truncated FNV-1a digest (12 hex chars).
 */
const HASH_SALT = "fl.room.v1:";

export function hashRoomCode(code: string): string {
  const input = HASH_SALT + code;
  // Two independent FNV-1a passes (different offsets) → 64 bits of output.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= input.charCodeAt(input.length - 1 - i);
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
  ).slice(0, 12);
}
