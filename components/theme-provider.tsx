"use client";
import { useEffect } from "react";
import { getThemeMode, resolveTheme, THEME_CHANGE_EVENT } from "@/lib/theme";

export function ThemeProvider() {
  // Apply the user's saved theme mode. In "auto" mode this follows the clock
  // (night 18:00–06:00, re-checked each minute); a fixed Light/Dark choice
  // pins the palette. Re-applies instantly when the profile changes the mode.
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(getThemeMode());
    };
    apply();
    const id = setInterval(apply, 60_000);
    window.addEventListener(THEME_CHANGE_EVENT, apply);
    return () => {
      clearInterval(id);
      window.removeEventListener(THEME_CHANGE_EVENT, apply);
    };
  }, []);
  return null;
}
