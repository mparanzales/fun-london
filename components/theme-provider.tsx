"use client";
import { useEffect } from "react";

export function ThemeProvider() {
  // Auto-switch theme based on time: night between 18:00 and 06:00.
  useEffect(() => {
    const apply = () => {
      const h = new Date().getHours();
      const isNight = h >= 18 || h < 6;
      document.documentElement.dataset.theme = isNight ? "night" : "day";
    };
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
