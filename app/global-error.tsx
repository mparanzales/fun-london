"use client";

// Last-resort error boundary. This only fires if the ROOT layout itself
// throws, so it must render its own <html>/<body> and can't rely on the app's
// theme CSS or components being available — everything here is inline.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Fun London] global error:", error);
  }, [error]);

  // The app's theme CSS isn't guaranteed here (the root layout threw), so we
  // can't use the --fl-* tokens. Mirror them inline + respect the OS theme via
  // a media query so night users don't hit a cream flashbang. Values match
  // globals.css day/night; the button is the brand violet (hsl(250 70% 50%)).
  return (
    <html lang="en">
      <head>
        <style>{`
          :root { --ge-bg:#f0eee9; --ge-fg:#1a1409; --ge-muted:#645c50; }
          @media (prefers-color-scheme: dark) {
            :root { --ge-bg:#14121a; --ge-fg:#ece6d9; --ge-muted:#9c9385; }
          }
        `}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "24px",
          background: "var(--ge-bg)",
          color: "var(--ge-fg)",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>😅</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>
          That didn&apos;t load
        </h2>
        <p
          style={{
            fontSize: 14,
            color: "var(--ge-muted)",
            maxWidth: 300,
            lineHeight: 1.5,
            margin: "0 0 24px",
          }}
        >
          Something hiccuped on our end. It&apos;s usually a quick blip, give it
          another go.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            height: 44,
            padding: "0 20px",
            borderRadius: 16,
            border: "none",
            background: "hsl(250 70% 50%)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
