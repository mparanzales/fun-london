import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// Matcher: run on every request EXCEPT static assets and Next.js
// internals. The middleware's only job is to refresh the Supabase
// session cookie — auth-optional model means no redirects. Routes that
// genuinely require a user check for one themselves (via lib/auth.ts)
// and either render a sign-in CTA or call redirect() in their Server
// Component.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
