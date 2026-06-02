import { ImageResponse } from "next/og";
import { fetchVenueBySlug } from "@/lib/queries";

// Dynamic Open Graph image for a venue — what shows when a /venue/[slug] link
// is shared on WhatsApp / iMessage / Slack / X. A clean, brand-gradient card
// (no remote photo fetch, so it can never fail) carrying the venue name,
// neighbourhood and the differentiating thesis line.

export const alt = "Fun London venue";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { slug: string } }) {
  const venue = await fetchVenueBySlug(params.slug).catch(() => null);
  const name = venue?.name ?? "Fun London";
  const area = venue?.neighbourhood ?? "London";
  const sources = venue?.editorialSources?.length ?? 0;
  // Single string — Satori requires any element with >1 child to set
  // display:flex, so we avoid mixing static text + an expression in one div.
  const tagline =
    "Independent · No chains" +
    (sources >= 2 ? ` · Checked in ${sources} sources` : "");

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background:
          "linear-gradient(135deg, #3b46e6 0%, #8b3df0 60%, #d63fb0 100%)",
        color: "white",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 700, opacity: 0.9 }}>
        fun London
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ fontSize: 34, fontWeight: 600, opacity: 0.85 }}>
          {area.toUpperCase()}
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
          {name}
        </div>
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, opacity: 0.95 }}>
        {tagline}
      </div>
    </div>,
    { ...size },
  );
}
