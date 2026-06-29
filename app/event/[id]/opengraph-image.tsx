import { ImageResponse } from "next/og";
import { fetchEventPreviewById } from "@/lib/queries";

// Dynamic Open Graph image for an event — shown when an /event/[id] link is
// shared. Brand-gradient card with the event name, venue + area and date.

export const alt = "Fun London event";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await fetchEventPreviewById(id).catch(() => null);
  const name = event?.name ?? "What's on in London";
  const where = event ? `${event.venueName} · ${event.area}` : "Fun London";
  const when = event
    ? `${event.dateLabel}${event.timeLabel ? ` · ${event.timeLabel}` : ""}`
    : "";

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
        fun London · What&apos;s on
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {when ? (
          <div style={{ fontSize: 34, fontWeight: 600, opacity: 0.85 }}>
            {when.toUpperCase()}
          </div>
        ) : null}
        <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.05 }}>
          {name}
        </div>
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, opacity: 0.95 }}>
        {where}
      </div>
    </div>,
    { ...size },
  );
}
