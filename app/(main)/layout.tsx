import { BottomNav } from "@/components/bottom-nav";
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
      <div className="max-w-md mx-auto pb-24 min-h-screen">
        <ErrorBoundary>
          <PageTransition>{children}</PageTransition>
        </ErrorBoundary>
      </div>
      <BottomNav />
    </>
  );
}
