import type { MetadataRoute } from "next";
import { fetchVenues, fetchEvents } from "@/lib/queries";
import { SITE_URL } from "@/lib/config";

// Generated sitemap so Google can discover every venue + event detail page
// (previously /sitemap.xml 404'd). Public routes only — no /admin, /booking,
// /auth, /profile, /saved (user/private surfaces).

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/explore",
    "/events",
    "/plan",
    "/privacy",
    "/terms",
    "/cookies",
  ].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "daily",
    priority: path === "" ? 1 : 0.7,
  }));

  // Catalogue pages. Queries can throw on a Supabase blip — degrade to the
  // static routes rather than failing the whole sitemap.
  let dynamicRoutes: MetadataRoute.Sitemap = [];
  try {
    const [venues, events] = await Promise.all([fetchVenues(), fetchEvents()]);
    dynamicRoutes = [
      ...venues.map((v) => ({
        url: `${SITE_URL}/venue/${v.slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
      ...events.map((e) => ({
        url: `${SITE_URL}/event/${e.id}`,
        changeFrequency: "daily" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    // keep static routes only
  }

  return [...staticRoutes, ...dynamicRoutes];
}
