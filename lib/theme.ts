// Theme mode store (client-only).
//
// The app paints two palettes via `data-theme="night"` on <html> (day is the
// default, see app/globals.css). Historically this was purely time-based
// (18:00–06:00 = night). This adds a user override that persists across
// visits:
//   • "auto"  → follow the clock (the original behaviour)
//   • "day"   → always Light
//   • "night" → always Dark
//
// ThemeProvider applies the resolved palette and re-applies on a change event;
// the profile screen reads/sets the mode. localStorage-backed so the choice
// survives reloads and is shared across tabs.

export type ThemeMode = "auto" | "day" | "night";

const KEY = "fl.theme.v1";
export const THEME_CHANGE_EVENT = "fl-theme-change";

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "auto" || v === "day" || v === "night") return v;
  } catch {
    // localStorage blocked — fall back to auto.
  }
  return "auto";
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Ignore write failures (private mode etc.); the event still applies it
    // for this session.
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: mode }));
}

// Resolve a mode to the concrete palette to paint right now.
export function resolveTheme(mode: ThemeMode): "day" | "night" {
  if (mode !== "auto") return mode;
  const h = new Date().getHours();
  return h >= 18 || h < 6 ? "night" : "day";
}

// Display label for the profile row.
export function themeModeLabel(mode: ThemeMode): string {
  return mode === "auto" ? "Auto" : mode === "day" ? "Light" : "Dark";
}

// Tap-cycle order: Auto → Light → Dark → Auto.
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "auto" ? "day" : mode === "day" ? "night" : "auto";
}
