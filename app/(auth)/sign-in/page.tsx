import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { safeReturnPath } from "@/lib/safe-redirect";
import { Logo } from "@/components/logo";
import { SignInForm } from "./sign-in-form";

// Maps the `?error=…` tag set by /auth/callback into a user-readable
// line for the form. Lowercase to match the page voice.
function initialErrorFor(tag: string | undefined): string | null {
  if (tag === "callback_failed") {
    return "that link expired or was already used. try again.";
  }
  if (tag === "oauth_failed") {
    return "sign-in with google failed. check the dev server log for the exact reason and try again.";
  }
  return null;
}

// Sign-in page. Google OAuth primary, magic-link fallback. No passwords.
// Auth-optional model: this page is reachable from the "You" tab when
// anonymous, the "Sign in" pill on /profile, and from the
// /sign-in?return=... redirect that any future authed-only action can
// trigger when a user tries to do something that requires identity.

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { return?: string; error?: string };
}) {
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

      {/* Escape hatch — Fun London is auth-optional. Anonymous users get
          full saved-venues + booking flows via localStorage, so skipping
          sign-in still gives the real app experience. They can sign in
          later from the You tab. */}
      <Link
        href="/explore"
        className="mt-6 self-center text-[13px] font-medium text-muted-fg/70 hover:text-fg lowercase tracking-tight transition-colors"
      >
        skip for now →
      </Link>
    </div>
  );
}
