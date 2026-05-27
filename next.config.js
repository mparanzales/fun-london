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
    ],
  },
};

module.exports = nextConfig;
