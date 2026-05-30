// Skeleton shown while a (main) route's server fetch resolves. Mirrors the
// feed shape (masthead → filter row → cards) so the layout doesn't jump.

export default function Loading() {
  return (
    <div className="pb-6 animate-pulse" aria-hidden>
      <header className="px-5 pt-8 pb-6">
        <div className="h-5 w-28 bg-muted rounded-md mb-2" />
        <div className="h-8 w-48 bg-muted rounded-md" />
      </header>

      <div className="px-5 grid grid-cols-6 gap-1 py-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5 py-2">
            <div className="w-6 h-6 bg-muted rounded-full" />
            <div className="h-2 w-8 bg-muted rounded" />
          </div>
        ))}
      </div>

      <div className="px-5 pt-5 flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div
              className="w-full rounded-2xl bg-muted"
              style={{ aspectRatio: "16 / 12" }}
            />
            <div className="h-4 w-2/3 bg-muted rounded mt-2.5" />
            <div className="h-3 w-1/3 bg-muted rounded mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
