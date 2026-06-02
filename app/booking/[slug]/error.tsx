"use client";

// Error boundary for the booking flow (e.g. a malformed ?d=/?t= param or a
// venue lookup failing) so a bad link can't drop the user to a raw crash.

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
    console.error("[Fun London] booking route error:", error);
  }, [error]);
  return <ErrorFallback reset={reset} />;
}
