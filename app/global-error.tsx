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

  return (
    <html lang="en">
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
          background: "#f0eee9",
          color: "#14110d",
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
            color: "#6b6358",
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
            background: "#6d28d9",
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
