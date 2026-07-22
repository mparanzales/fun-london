// Fetch a page's social-share image (og:image / twitter:image). For the
// pop-up radar this pulls the REAL promo image from a pop-up's official page
// instead of a generic stock photo. Returns an absolute https URL or null.

export async function fetchOgImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      redirect: "follow",
      headers: {
        // A normal UA so sites that vary markup for bots still serve og tags.
        "user-agent":
          "Mozilla/5.0 (compatible; FunLondonBot/1.0; +https://www.funldn.com)",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const patterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) {
        // og:image content is HTML-escapes the ampersand (&amp; / &#38; /
        // &#x26;) — decode it to a valid URL. Done in a SINGLE pass with one
        // regex: chaining several .replace() unescapes is the "double escaping"
        // anti-pattern (an earlier decode's output can feed the next), and a
        // single pass never re-scans what it already replaced.
        let url = m[1].trim().replace(/&(?:amp|#0*38|#x0*26);/gi, "&");
        if (url.startsWith("//")) url = "https:" + url;
        else if (url.startsWith("/")) url = new URL(pageUrl).origin + url;
        // Cloudflare image-resizing wraps (sometimes doubly) the real asset:
        //   .../cdn-cgi/image/format=auto/https://assets.../real.jpg
        // The wrapped URL can 404 when mirrored, so unwrap to the inner asset.
        if (url.includes("/cdn-cgi/image/")) {
          const inner = url.lastIndexOf("http");
          if (inner > 0) url = url.slice(inner);
        }
        if (url.startsWith("http")) return url;
      }
    }
    return null;
  } catch {
    return null;
  }
}
