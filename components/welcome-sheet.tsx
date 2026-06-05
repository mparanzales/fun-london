"use client";

// First-visit welcome: a one-time bottom sheet that invites a new (anonymous)
// visitor to sign up and turn on location + notifications. Shown once per
// device (gated by fl.welcome.v1), never for signed-in users, and always
// dismissible ("just browse") — the app stays usable without an account.
//
// Location capture stores coords in fl.geo.v1 for "near you" suggestions.
// Notifications requests the browser permission now; delivery (web push) is a
// later piece — signed-in users already get the weekly email digest.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Bell, X, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const SEEN_KEY = "fl.welcome.v1";
const GEO_KEY = "fl.geo.v1";

type PermState = "idle" | "on" | "off";

export function WelcomeSheet({ signedIn }: { signedIn: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [loc, setLoc] = useState<PermState>("idle");
  const [notif, setNotif] = useState<PermState>("idle");

  useEffect(() => {
    setMounted(true);
    if (signedIn) return; // signed-in users don't need the welcome
    let seen = false;
    try {
      seen = !!window.localStorage.getItem(SEEN_KEY);
    } catch {
      // localStorage unavailable — show it (best-effort, once per session).
    }
    if (seen) return;
    // Small delay so it slides in after the home settles, not over the splash.
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, [signedIn]);

  function markSeen() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function dismiss() {
    markSeen();
    setOpen(false);
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    markSeen();
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        queryParams: { prompt: "select_account" },
      },
    });
    // On success the browser redirects to Google; on error keep the sheet up.
    if (error) setGoogleLoading(false);
  }

  function enableLocation() {
    if (!("geolocation" in navigator)) {
      setLoc("off");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          window.localStorage.setItem(
            GEO_KEY,
            JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              at: Date.now(),
            }),
          );
        } catch {
          /* ignore */
        }
        setLoc("on");
      },
      () => setLoc("off"),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNotif("off");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotif(result === "granted" ? "on" : "off");
    } catch {
      setNotif("off");
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={dismiss}
        className="absolute inset-0 bg-black/50 fl-fade-in"
      />
      <div className="relative w-full max-w-md bg-card rounded-t-3xl px-5 pt-6 pb-8 fl-sheet-up">
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-4 right-4 text-muted-fg"
        >
          <X size={20} />
        </button>

        <h2 className="text-[20px] font-extrabold text-heading">
          Welcome to Fun London
        </h2>
        <p className="text-[13px] text-muted-fg mt-1 leading-snug">
          Sign up to save your spots, plan nights out, and get picks near you.
        </p>

        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className="mt-5 w-full h-[52px] rounded-2xl fl-grad text-white font-extrabold text-[15px] flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {googleLoading ? "Opening Google..." : "Continue with Google"}
        </button>

        <div className="mt-4 flex flex-col gap-2.5">
          <PermissionRow
            icon={MapPin}
            title="Enable location"
            body="See what's good near you."
            state={loc}
            onEnable={enableLocation}
          />
          <PermissionRow
            icon={Bell}
            title="Enable notifications"
            body="What's on this week and new spots."
            state={notif}
            onEnable={enableNotifications}
          />
        </div>

        <button
          onClick={dismiss}
          className="mt-4 w-full text-center text-[13px] font-semibold text-muted-fg hover:text-fg"
        >
          Not now, just browse
        </button>
      </div>
    </div>,
    document.body,
  );
}

function PermissionRow({
  icon: Icon,
  title,
  body,
  state,
  onEnable,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  state: PermState;
  onEnable: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/60 border border-border p-3">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-extrabold text-heading">{title}</div>
        <div className="text-[11px] text-muted-fg">{body}</div>
      </div>
      <button
        onClick={onEnable}
        disabled={state === "on"}
        className={
          "h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider flex-shrink-0 " +
          (state === "on"
            ? "bg-primary/15 text-primary"
            : state === "off"
              ? "bg-muted text-muted-fg"
              : "bg-primary text-primary-fg")
        }
      >
        {state === "on" ? "Enabled" : state === "off" ? "Blocked" : "Enable"}
      </button>
    </div>
  );
}
