import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }: CookieToSet) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session cookie if it's near expiry, and read the user so we
  // can enforce the login wall below.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Login wall ───────────────────────────────────────────────────────────
  // The app requires an account, BUT anonymous visitors can always browse a
  // metered preview of the feed first (skip → /explore → a few cards → the
  // SignupWall in the feed once they scroll past the preview). Anonymous may
  // reach ONLY:
  //   • "/"            — the public marketing landing (funldn.com, indexable)
  //   • "/explore"     — the always-on metered preview (wall lives in the feed)
  //   • sign-in + auth callback, the legal pages, robots/sitemap
  //   • /api/email/unsubscribe — reached from email links, must work logged-out
  // Everything that DOES something (What's on, Plan, Saved, You, every
  // venue/event detail, booking, admin) redirects to /sign-in with a ?return,
  // so tapping a restaurant or any other tab forces an account.
  const { pathname } = request.nextUrl;

  if (!user) {
    // Venue/event DETAIL pages render for anon too, but their content is shown
    // blurred behind a sign-up card (components/auth-wall.tsx) — the soft
    // "enter a place → sign up" gate. Rendering (not redirecting) also keeps
    // these pages indexable/shareable.
    const isPublic =
      pathname === "/" ||
      pathname === "/explore" ||
      pathname.startsWith("/venue/") ||
      pathname.startsWith("/event/") ||
      pathname === "/robots.txt" ||
      pathname === "/sitemap.xml" ||
      pathname === "/sign-in" ||
      pathname.startsWith("/auth") ||
      pathname.startsWith("/privacy") ||
      pathname.startsWith("/terms") ||
      pathname.startsWith("/cookies") ||
      pathname.startsWith("/api/email/unsubscribe");

    if (!isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = "";
      // safeReturnPath() on the sign-in side rejects non-site-internal paths.
      url.searchParams.set("return", pathname);
      return NextResponse.redirect(url);
    }
  }

  return response;
}
