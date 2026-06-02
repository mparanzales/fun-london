import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Shared shell for /privacy, /terms, /cookies. Outside the (main) group so
// there's no bottom nav; a simple back link returns to the app.
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-md mx-auto min-h-screen bg-bg px-5 pt-4 pb-16">
      <Link
        href="/explore"
        aria-label="Back"
        className="inline-flex items-center gap-1.5 text-sm text-muted-fg mb-4"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={2} />
        Back
      </Link>
      <article className="text-[14px] text-fg leading-relaxed [&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:text-heading [&_h1]:mb-1 [&_h2]:text-base [&_h2]:font-extrabold [&_h2]:text-heading [&_h2]:mt-6 [&_h2]:mb-1.5 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </article>
      <nav className="mt-10 pt-6 border-t border-border flex gap-4 text-xs text-muted-fg">
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy
        </Link>
        <Link href="/terms" className="underline underline-offset-2">
          Terms
        </Link>
        <Link href="/cookies" className="underline underline-offset-2">
          Cookies
        </Link>
      </nav>
    </div>
  );
}
