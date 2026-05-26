// Magic-link callback. Supabase's signInWithOtp sends the user here with
// a `code` query param after they click the link in their email. We
// exchange that code for a session (which writes auth cookies via the
// server client) and — if the user supplied a display name on the
// sign-in form — copy it from auth.user_metadata into public.profiles
// when the profile row doesn't already have one.
//
// On error (expired / reused link) we bounce back to /sign-in with an
// error flag the form can display.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnTo = searchParams.get("return") ?? "/explore";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await maybeBackfillDisplayName(supabase);
      return NextResponse.redirect(`${origin}${returnTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=callback_failed`);
}

// Copy display_name from auth.user_metadata into public.profiles when
// the profile row doesn't already have one. Idempotent — never
// overwrites a name the user set explicitly via /profile/edit. Best-effort;
// failures are logged but don't block the redirect (the user is already
// signed in at this point and can always set a name in the edit screen).
async function maybeBackfillDisplayName(
  supabase: ReturnType<typeof createClient>,
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const metaName =
      typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name.trim()
        : "";
    if (!metaName) return;

    const { data: existing, error: readErr } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (readErr) {
      console.error("[callback] profile read failed:", readErr);
      return;
    }
    if (existing?.display_name) return; // never overwrite

    const { error: writeErr } = await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: metaName }, { onConflict: "id" });
    if (writeErr) {
      console.error("[callback] display_name backfill failed:", writeErr);
    }
  } catch (e) {
    console.error("[callback] display_name backfill threw:", e);
  }
}
