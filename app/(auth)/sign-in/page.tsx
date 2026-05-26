import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

// Sign-in page. Magic-link only, no passwords.
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
    // Already signed in — bounce them to where they were headed.
    redirect(searchParams.return ?? "/explore");
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-bg px-5 pt-12 pb-10">
      <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-primary mb-2">
        Fun London
      </div>
      <h1 className="text-[28px] font-extrabold tracking-tight text-fg leading-tight mb-1">
        Sign in
      </h1>
      <p className="text-sm text-muted-fg mb-8">
        We&apos;ll email you a magic link. No password.
      </p>

      <SignInForm
        returnTo={searchParams.return}
        initialError={
          searchParams.error === "callback_failed"
            ? "That link expired or was already used. Try again."
            : null
        }
      />
    </div>
  );
}
