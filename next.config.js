/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // Google Places photo CDN — the venue ingestion script stores
      // photo URLs from places.googleapis.com which 302-redirect to
      // lh3.googleusercontent.com. Both hostnames need to be allowed
      // for Next.js Image optimization to work.
      { protocol: "https", hostname: "places.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Ticketmaster CDN — event posters come back as
      // s1.ticketm.net/dam/a/... when Phase 5 Tier 3 ingests via the
      // Discovery API. Ticketmaster also occasionally serves via s2-s4
      // (regional shards) so we allow the whole TLD.
      { protocol: "https", hostname: "**.ticketm.net" },
    ],
  },
};

module.exports = nextConfig;
