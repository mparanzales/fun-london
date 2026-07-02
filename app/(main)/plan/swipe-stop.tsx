"use client";

// A Hinge/Tinder-style horizontal swipe on a plan stop card: drag it aside to
// change that stop for an alternative (swipe left = next, right = previous).
// A plain tap still falls through to the card's link; vertical drags scroll the
// page (touchAction: pan-y). Hand-rolled pointer events — no gesture library.

import { useRef, useState, type ReactNode } from "react";

const TAP_SLOP = 8; // px of movement before it counts as a drag, not a tap
const COMMIT = 80; // px past which a release commits the swipe

export function SwipeStop({
  enabled,
  onSwipe,
  children,
}: {
  enabled: boolean;
  onSwipe: (dir: 1 | -1) => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [animate, setAnimate] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  if (!enabled) return <>{children}</>;

  const down = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    dragging.current = false;
    setAnimate(false);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // some browsers throw for non-active pointers — capture is best-effort
    }
  };

  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!dragging.current) {
      // A clearly vertical move = the user is scrolling — bow out.
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
        start.current = null;
        return;
      }
      if (Math.abs(mx) > TAP_SLOP) dragging.current = true;
      else return;
    }
    setDx(mx);
  };

  const up = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !dragging.current) return;
    const mx = e.clientX - s.x;
    if (Math.abs(mx) > COMMIT) {
      const dir: 1 | -1 = mx < 0 ? 1 : -1; // left → next, right → previous
      const w = typeof window !== "undefined" ? window.innerWidth : 400;
      setAnimate(true);
      setDx(mx < 0 ? -w : w); // fly it off, then swap + reset to centre
      window.setTimeout(() => {
        onSwipe(dir);
        setAnimate(false);
        setDx(0);
        dragging.current = false;
      }, 180);
    } else {
      setAnimate(true);
      setDx(0); // spring back
    }
  };

  // If this pointer sequence was a drag, swallow the click so the card's link
  // doesn't fire.
  const clickCapture = (e: React.MouseEvent) => {
    if (dragging.current) {
      e.preventDefault();
      e.stopPropagation();
      dragging.current = false;
    }
  };

  const rot = Math.max(-8, Math.min(8, dx * 0.03));
  const opacity = 1 - Math.min(0.35, Math.abs(dx) / 700);

  return (
    <div
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClickCapture={clickCapture}
      style={{
        transform: `translateX(${dx}px) rotate(${rot}deg)`,
        transition: animate
          ? "transform 180ms ease-out, opacity 180ms"
          : "none",
        opacity,
        touchAction: "pan-y",
      }}
    >
      {children}
    </div>
  );
}
