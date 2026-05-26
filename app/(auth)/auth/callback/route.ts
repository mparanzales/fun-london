// Magic-link callback. Supabase's signInWithOtp sends the user here with
// a `code` query param after they click the link in their email. We
// exchange that code for a session (which writes auth cookies via the
// server client) and then redirect to wherever they were headed.
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
      return NextResponse.redirect(`${origin}${returnTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=callback_failed`);
}
