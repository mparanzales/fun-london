import { BottomNav } from "@/components/bottom-nav";
import { DesktopNav } from "@/components/desktop-nav";
import { ErrorBoundary } from "@/components/error-boundary";
import { PageTransition } from "@/components/page-transition";
import { MarkVisited } from "@/components/mark-visited";

// NOTE: SavedProvider and ThemeProvider have been lifted to app/layout.tsx
// so they cover routes outside this (main) shell (e.g. /venue/[slug]
// which intentionally hides the bottom nav). Auth/onboarding redirect is
// disabled while Supabase is out of scope.
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <MarkVisited />
      {/* Desktop gets a sticky top nav; mobile keeps the bottom nav. */}
      <DesktopNav />
      {/* Mobile-first column; widens to a full multi-column canvas on large
          screens so funldn.com uses the space on a laptop instead of a
          phone-width strip. Forms/profile self-centre at their own width. */}
      <div className="max-w-md lg:max-w-6xl mx-auto pb-24 lg:pb-16 min-h-screen">
        <ErrorBoundary>
          <PageTransition>{children}</PageTransition>
        </ErrorBoundary>
      </div>
      <BottomNav />
    </>
  );
}
