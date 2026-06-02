// Auth callback. Handles BOTH magic-link and OAuth (Google) sign-ins.
// Supabase sends the user here with a `code` query param after the OTP
// is verified (magic-link click) OR after the OAuth provider redirects
// back (Google sign-in completes). exchangeCodeForSession works the
// same way for both — Supabase recognises the code type internally.
//
// After session is set we backfill display_name into public.profiles
// when the row doesn't already have one. Sources, in priority order:
//   1. user_metadata.display_name  — set by the magic-link form when
//      the user typed a name into the "Your name (optional)" field
//   2. user_metadata.full_name     — set by Google OAuth (Google's
//      "full name" from the user's Google profile)
//   3. user_metadata.name          — alternative Google key
//
// On error (expired / reused link) we bounce back to /sign-in with an
// error flag the form can display.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Guard against open-redirects: only a site-internal path is allowed.
  const returnTo = safeReturnPath(searchParams.get("return"));

  // Supabase forwards provider-side OAuth failures here without a `code`,
  // instead populating `error` + `error_description`. Surface those to
  // the dev server log so misconfigured providers are debuggable, and
  // pass a more specific tag back to /sign-in for the UI.
  const providerError = searchParams.get("error");
  const providerErrorCode = searchParams.get("error_code");
  const providerErrorDesc = searchParams.get("error_description");
  if (providerError) {
    console.error(
      `[callback] provider error: ${providerError}` +
        (providerErrorCode ? ` (${providerErrorCode})` : "") +
        (providerErrorDesc ? `, ${providerErrorDesc}` : ""),
    );
    return NextResponse.redirect(`${origin}/sign-in?error=oauth_failed`);
  }

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await maybeBackfillDisplayName(supabase);
      // Mark the redirect so the client can fire a one-off sign_in_complete
      // analytics event on landing (then strips the param). Safe even if
      // returnTo already carries a query string.
      const dest = new URL(`${origin}${returnTo}`);
      dest.searchParams.set("signedin", "1");
      return NextResponse.redirect(dest.toString());
    }
    console.error(`[callback] exchangeCodeForSession failed: ${error.message}`);
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

    // Pick the first non-empty name source in priority order.
    const meta = user.user_metadata ?? {};
    const metaName = (
      [meta.display_name, meta.full_name, meta.name]
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .find((v) => v.length > 0) ?? ""
    ).slice(0, 80);
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
