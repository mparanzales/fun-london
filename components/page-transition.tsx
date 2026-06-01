"use client";

import { usePathname } from "next/navigation";

// Replays the editorial fade-and-rise entrance on every route change.
// How it works: we key the wrapper <div> on the current pathname, so React
// remounts it whenever the route changes, which restarts the CSS animation
// (.fl-page in globals.css). No animation library — just a key + a keyframe.
//
// Honoured automatically: prefers-reduced-motion (globals.css zeroes the
// duration), so this is a no-op for users who opt out of motion.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="fl-page">
      {children}
    </div>
  );
}
