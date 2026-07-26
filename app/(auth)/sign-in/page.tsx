import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { safeReturnPath } from "@/lib/safe-redirect";
import { Logo } from "@/components/logo";
import { LegalLinks } from "@/components/legal-links";
import { SignInForm } from "./sign-in-form";

// Maps the `?error=…` tag set by /auth/callback into a user-readable
// line for the form. Lowercase to match the page voice.
function initialErrorFor(tag: string | undefined): string | null {
  if (tag === "callback_failed") {
    return "that link expired or was already used. try again.";
  }
  if (tag === "oauth_failed") {
    return "that social sign-in failed (the provider may not be enabled yet). try Google or email.";
  }
  return null;
}

// Sign-in page. Google OAuth primary, magic-link fallback. No passwords.
// Auth-optional model: this page is reachable from the "You" tab when
// anonymous, the "Sign in" pill on /profile, and from the
// /sign-in?return=... redirect that any future authed-only action can
// trigger when a user tries to do something that requires identity.

export default async function SignInPage(props: {
  searchParams: Promise<{ return?: string; error?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await getAuthUser();
  if (user) {
    // Already signed in — bounce them to where they were headed (guarded
    // against open-redirects via ?return=//evil.com).
    redirect(safeReturnPath(searchParams.return));
  }

  return (
    <div className="relative max-w-md mx-auto min-h-[100svh] bg-bg px-5 py-10 flex flex-col overflow-hidden">
      {/* Hero block: brand + invitation, vertically centered in the upper
          half. The min-height + flex-1 below pushes the form to the
          natural lower-thirds reading line so the page reads as
          "brand → action" rather than "everything top-pinned". */}
      <div className="relative flex-1 flex flex-col items-center justify-center text-center pb-6">
        {/* Soft brand glow behind the logo — radial gradient from the
            primary/accent palette fading to transparent. Pure CSS, no
            asset. Gives the upper half a warm "the brand is breathing"
            quality without being loud. Pointer-events none so it never
            interferes with taps. */}
        <div
          aria-hidden
          className="absolute pointer-events-none w-[420px] h-[420px] rounded-full opacity-[0.18] blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, var(--fl-primary), var(--fl-accent) 40%, transparent 70%)",
          }}
        />
        <Logo variant="gradient" size="xl" className="relative" />
        <p className="relative mt-7 text-[15px] text-muted-fg lowercase tracking-tight">
          google or email. take your pick.
        </p>
      </div>

      <SignInForm
        returnTo={searchParams.return}
        initialError={initialErrorFor(searchParams.error)}
      />

      {/* "Skip" → back to browsing. Browsing is free; doing anything —
          tapping a place, saving, planning — requires an account.
          It returns the user to the venue/event they were actually deciding
          on rather than dumping them at the top of the feed: a hesitant anon
          three taps into a specific place used to get teleported to /explore,
          which reads as "the app forgot what I was doing" and re-walls them.
          Allowlisted to /venue/ and /event/ ONLY — those are the two surfaces
          that render real anon content. Deliberately NOT the middleware's
          isPublicPath, which also allows /saved, /profile and /plan and would
          bounce the user straight into another wall. /explore and /events
          already return to themselves. */}
      <Link
        href={
          searchParams.return?.startsWith("/venue/") ||
          searchParams.return?.startsWith("/event/")
            ? safeReturnPath(searchParams.return)
            : "/explore"
        }
        className="mt-8 self-center text-[13px] font-medium text-muted-fg hover:text-fg lowercase tracking-tight transition-colors"
      >
        take a peek →
      </Link>

      {/* Legal disclosure lives HERE because this is the moment of contract:
          every anonymous sign-up in the app funnels through /sign-in?return=…
          — from SignupWall (the feed end-cap), from AuthWall, from the profile
          wall, and from the middleware redirect. Coverage is therefore 100% by
          construction. Putting it only on AuthWall was not enough: the two
          feeds end in SignupWall, so the commonest path (splash → /explore →
          scroll → sign up) met no legal links at all. Opens in a new tab so
          reading the terms never destroys the ?return= the user came in with. */}
      <LegalLinks newTab className="mt-5 self-center justify-center" />
    </div>
  );
}
