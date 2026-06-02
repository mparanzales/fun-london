"use client";

// Error boundary for the venue detail route.

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
    console.error("[Fun London] venue route error:", error);
  }, [error]);
  return <ErrorFallback reset={reset} />;
}
