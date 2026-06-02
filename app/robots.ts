import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// robots.txt (previously 404'd). Allow crawling of the public catalogue;
// keep private/admin/transactional surfaces out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/booking", "/auth", "/profile", "/saved", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
