"use client";

// Error boundary for the main app shell (explore / events / saved / plan /
// profile). Catches render-time errors (e.g. a Supabase query failing) and
// shows a branded retry instead of Next's raw error screen.

import { useEffect } from "react";
import { ErrorFallback } from "@/components/error-fallback";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Fun London] (main) route error:", error);
  }, [error]);
  return <ErrorFallback reset={reset} />;
}
