// Skeleton for the immersive venue detail while its server fetch resolves.

export default function Loading() {
  return (
    <div
      className="max-w-md mx-auto min-h-screen bg-bg pb-32 animate-pulse"
      aria-hidden
    >
      <div className="w-full bg-muted" style={{ aspectRatio: "4 / 3" }} />
      <div className="px-5 pt-5">
        <div className="h-3 w-32 bg-muted rounded" />
        <div className="h-8 w-2/3 bg-muted rounded-md mt-3" />
        <div className="h-4 w-40 bg-muted rounded mt-3" />
        <div className="h-24 w-full bg-muted rounded-md mt-5" />
        <div className="flex gap-2 mt-5">
          <div className="h-7 w-20 bg-muted rounded-full" />
          <div className="h-7 w-24 bg-muted rounded-full" />
          <div className="h-7 w-16 bg-muted rounded-full" />
        </div>
      </div>
    </div>
  );
}
