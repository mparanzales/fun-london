"use client";

// Shared, branded fallback UI for Next.js route `error.tsx` boundaries.
// A route boundary catches any error thrown while rendering that segment
// (e.g. a Supabase query failing) and shows this instead of Next's raw
// error screen. `reset()` re-attempts the render; we also offer a hard
// reload as a backstop.

import { CloudOff } from "lucide-react";

export function ErrorFallback({ reset }: { reset?: () => void }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-12">
      <CloudOff
        className="w-10 h-10 text-muted-fg mb-3"
        strokeWidth={1.5}
        aria-hidden
      />
      <h2 className="text-xl font-extrabold text-heading mb-1.5">
        That didn&apos;t load
      </h2>
      <p className="text-sm text-muted-fg max-w-[300px] leading-relaxed mb-6">
        Something hiccuped on our end. It&apos;s usually a quick blip, give it
        another go.
      </p>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => (reset ? reset() : window.location.reload())}
          className="h-11 px-5 rounded-2xl bg-primary text-white font-extrabold text-sm"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-11 px-5 rounded-2xl bg-card border border-border text-fg font-bold text-sm"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
