// Generated maskable PWA icon (Android adaptive icons).
//
// The static /apple-icon.png is a full-bleed wordmark with no safe zone, so
// declaring it "maskable" made Android crop the logo edges. A maskable icon
// must keep its content inside the central ~80% safe zone with the rest as
// bleed. We render that here with next/og: the white wordmark centred at ~58%
// on a solid brand-purple square. force-static so it's baked at build, not
// rendered per request.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-static";

const SIZE = 512;

export async function GET() {
  const logo = await readFile(
    path.join(process.cwd(), "public/logo-fun-white.png"),
  );
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Brand primary (matches --fl-primary). Fills the full square so
        // there is bleed for the OS mask to crop into.
        background: "hsl(233, 70%, 55%)",
      }}
    >
      {/* ~58% width keeps the mark inside the maskable safe zone. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori (next/og)
          renders raw <img>; next/image is not available in ImageResponse. */}
      <img
        src={logoSrc}
        width={300}
        height={200}
        style={{ objectFit: "contain" }}
        alt="Fun London"
      />
    </div>,
    { width: SIZE, height: SIZE },
  );
}
