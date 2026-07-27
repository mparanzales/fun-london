import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// Generated sitemap. The app is behind a login wall (see lib/supabase/
// middleware.ts), so the only crawlable surfaces are the public marketing
// landing, the metered /explore preview, and the legal pages. Venue/event
// detail and /events are served to anonymous crawlers as ISR /anon twins, so
// they are handled there rather than listed here. /about is the discovery
// surface for partnerships and press, who arrive by direct link.

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/explore", "/about", "/privacy", "/terms", "/cookies"].map(
    (path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: "daily",
      priority: path === "" ? 1 : 0.6,
    }),
  );
}
