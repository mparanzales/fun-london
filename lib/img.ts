// ─────────────────────────────────────────────────────────────────────────
// Right-size feed images via the CDNs' own transform endpoints.
//
// next.config.js sets `images.unoptimized: true` (Hobby plan — Vercel's
// optimizer 402s once quota is spent), so every <Image> downloads the FULL
// resolution source. A 170px-wide feed card pulling a 2000px JPEG is pure
// waste. We can't use the Vercel optimizer, but the source CDNs each expose
// their own free, on-the-fly resize — so ask them for a card-sized image.
//
// Pure function, no I/O — safe to call in render. Unknown hosts pass through
// unchanged (we never want to break an image we don't understand).
// ─────────────────────────────────────────────────────────────────────────

// Supabase image transformations must be ENABLED on the project (the free
// tier includes a limited monthly allowance; beyond it — or if the add-on is
// off — the render/image endpoint returns HTTP 400 and the photo breaks). If
// the project's plan doesn't support it, flip this to `false`: the Supabase
// rewrite is skipped and those URLs serve full-res from the public object
// endpoint (unchanged, always works). The Google `=w` path below is always
// safe and unaffected by this flag.
const SUPABASE_TRANSFORM = true;

/**
 * Return a CDN-resized variant of `url` targeting `width` CSS pixels, when the
 * host supports it; otherwise return `url` unchanged.
 *
 * - Google user content (`lh3.googleusercontent.com`, `*.googleusercontent.com`):
 *   append `=w{width}` (these URLs take a size suffix; we strip any existing
 *   `=w.../=s...` first so the call is idempotent).
 * - Supabase Storage public URLs (`/storage/v1/object/public/`): rewrite to the
 *   transform endpoint (`/storage/v1/render/image/public/`) with
 *   `?width={width}&quality=70&resize=cover`. Gated behind SUPABASE_TRANSFORM.
 * - Anything else (Ticketmaster `*.ticketm.net`, `images.universe.com`, …):
 *   returned unchanged.
 */
export function sizedImageUrl(url: string, width: number): string {
  if (!url || !Number.isFinite(width) || width <= 0) return url;
  const w = Math.round(width);

  // Google user content — size via the `=w{n}` suffix. Match on the hostname
  // (not a substring of the whole URL) so a query string can't spoof it.
  if (/(^|\.)googleusercontent\.com$/.test(hostOf(url))) {
    // Strip an existing size directive so repeated calls are idempotent.
    // Google suffixes look like `=w400`, `=s1600`, or combos `=w400-h300-...`.
    const base = url.replace(/=[swh]\d+(?:-[a-z0-9]+)*$/i, "");
    return `${base}=w${w}`;
  }

  // Supabase Storage public object → transform (render/image) endpoint.
  if (SUPABASE_TRANSFORM && url.includes("/storage/v1/object/public/")) {
    const rewritten = url.replace(
      "/storage/v1/object/public/",
      "/storage/v1/render/image/public/",
    );
    const sep = rewritten.includes("?") ? "&" : "?";
    return `${rewritten}${sep}width=${w}&quality=70&resize=cover`;
  }

  return url;
}

// Best-effort hostname extraction. Returns "" for anything non-absolute so the
// caller falls through to the passthrough branch.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
