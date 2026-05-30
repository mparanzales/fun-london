// Share helper: native Web Share sheet on mobile, clipboard-copy fallback
// on desktop. Returns what happened so the caller can show a "Copied"
// confirmation without guessing.

export type ShareResult = "shared" | "copied" | "failed";

export async function shareOrCopy(data: {
  title: string;
  text?: string;
  url: string;
}): Promise<ShareResult> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share(data);
      return "shared";
    } catch {
      // User dismissed the native sheet (AbortError) or it failed — treat
      // a dismissal as a no-op rather than falling through to a clipboard
      // copy they didn't ask for.
      return "shared";
    }
  }

  try {
    await navigator.clipboard.writeText(data.url);
    return "copied";
  } catch {
    return "failed";
  }
}
