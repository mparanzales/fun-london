import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// robots.txt. The app is behind a login wall: only the landing, the /explore
// preview and the legal pages are public. Everything else redirects anonymous
// requests (crawlers included) to /sign-in, so we disallow those paths to keep
// login-redirect URLs out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/explore", "/privacy", "/terms", "/cookies"],
      disallow: [
        "/admin",
        "/booking",
        "/auth",
        "/profile",
        "/saved",
        "/plan",
        "/events",
        "/venue",
        "/event",
        "/api",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
