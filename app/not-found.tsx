import Link from "next/link";

// Branded 404 — catches any unmatched route. Outside (main) layout so
// the bottom nav doesn't render here, but kept in the same mobile shell
// (max-w-md mx-auto) for visual consistency with the rest of the app.

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto min-h-screen bg-bg flex flex-col items-center justify-center px-8 text-center">
      <div className="text-[80px] leading-none font-extrabold text-primary tracking-tight">
        404
      </div>

      <h1 className="mt-4 text-2xl font-bold text-heading">
        That spot doesn&apos;t exist.
      </h1>

      <p className="mt-3 text-base text-muted-fg max-w-[280px] leading-relaxed">
        The page you&apos;re looking for moved on, never opened, or was a typo.
        Happens to the best of us.
      </p>

      <Link
        href="/explore"
        className="mt-8 inline-block bg-primary text-primary-fg rounded-full px-6 py-3.5 font-semibold text-sm"
      >
        Back to Explore
      </Link>

      <Link
        href="/saved"
        className="mt-3 text-xs text-muted-fg underline underline-offset-4"
      >
        or check what you&apos;ve saved
      </Link>
    </div>
  );
}
