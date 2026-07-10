/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Vercel's image optimizer is unavailable on the current plan (Hobby): once
    // the quota is spent it returns HTTP 402 (OPTIMIZED_IMAGE_REQUEST_PAYMENT_
    // REQUIRED), which broke venue/event photos across Explore, What's On and
    // Saved (the gallery backfill 6×'d the image count and tipped it over). Our
    // images are already web-ready JPEGs on CDNs (Supabase Storage, Google,
    // Ticketmaster), so serve them directly — no optimizer, no quota, no broken
    // images, £0. Re-enable optimization here if/when on a paid plan.
    unoptimized: true,
    remotePatterns: [
      // Google Places photo CDN — the venue ingestion script stores
      // photo URLs from places.googleapis.com which 302-redirect to
      // lh3.googleusercontent.com. Both hostnames need to be allowed
      // for Next.js Image optimization to work.
      { protocol: "https", hostname: "places.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Cloudflare R2 (via the img.funldn.com custom domain) — venue photos
      // migrated off Supabase Storage to R2 (£0, zero-egress, London edge),
      // pre-encoded to WebP. This is the primary photo host going forward.
      { protocol: "https", hostname: "img.funldn.com" },
      // Supabase Storage — legacy keyless photo URLs, still served until the R2
      // migration + DB rewrite completes and the bucket is emptied.
      { protocol: "https", hostname: "*.supabase.co" },
      // Ticketmaster CDN — event posters come back as
      // s1.ticketm.net/dam/a/... when Phase 5 Tier 3 ingests via the
      // Discovery API. The double-wildcard `**.ticketm.net` pattern
      // didn't match `s1.ticketm.net` cleanly in our Next 14 setup;
      // single-wildcard `*.ticketm.net` reliably matches s1 / s2 /
      // s3 / s4 regional shards.
      { protocol: "https", hostname: "*.ticketm.net" },
      // Universe is a Ticketmaster-owned ticketing platform; many
      // grassroots / comedy events surfaced by the London-wide
      // discovery pull host their posters on images.universe.com
      // rather than the s1.ticketm.net CDN.
      { protocol: "https", hostname: "images.universe.com" },
    ],
  },
};

module.exports = nextConfig;
