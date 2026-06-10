import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// Generated sitemap. The app is behind a login wall (see lib/supabase/
// middleware.ts), so the only crawlable surfaces are the public marketing
// landing, the metered /explore preview, and the legal pages. Venue/event
// detail, /events, /plan etc. now redirect anonymous crawlers to /sign-in, so
// listing them would just feed Google redirects — they are intentionally out.

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/explore", "/privacy", "/terms", "/cookies"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "daily",
    priority: path === "" ? 1 : 0.6,
  }));
}
