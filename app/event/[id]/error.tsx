"use client";

// Error boundary for the event detail route.

import { useEffect } from "react";
import { ErrorFallback } from "@/components/error-fallback";
import { reportError } from "@/lib/analytics";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Fun London] event route error:", error);
    reportError(error, "event");
  }, [error]);
  return <ErrorFallback reset={reset} />;
}
