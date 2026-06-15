/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Google Places photo CDN — the venue ingestion script stores
      // photo URLs from places.googleapis.com which 302-redirect to
      // lh3.googleusercontent.com. Both hostnames need to be allowed
      // for Next.js Image optimization to work.
      { protocol: "https", hostname: "places.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Supabase Storage — venue photos are mirrored here (keyless public
      // URLs) by scripts/photo-storage.ts + scripts/backfill-photos.ts, so the
      // Google Places API key no longer appears in any public image URL.
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
