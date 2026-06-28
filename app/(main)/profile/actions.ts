"use server";

// Server Action for the "Give Feedback" sheet (components/feedback-sheet.tsx).
//
// Works for everyone: signed-in users get their auth id + email stamped on the
// row (server-side, so the client can't spoof another user), anonymous
// visitors submit with user_id null. The feedback table is insert-only at the
// RLS layer, so there is no read-back surface to worry about here.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/auth";

// Mirror the option ids the sheet renders. Anything off-list is dropped so a
// tampered payload can't write junk.
const USE_INTENT = new Set(["would_use", "maybe", "not_yet"]);
const FOUND = new Set(["several", "one_or_two", "nothing"]);
const DIFFERENTIATION = new Set(["love", "nice", "not_fussed"]);
const WANTS = new Set(["booking", "plans", "events", "sharing", "coverage"]);

export type FeedbackInput = {
  useIntent?: string | null;
  foundSomething?: string | null;
  differentiation?: string | null;
  wants?: string[];
  message?: string | null;
  email?: string | null;
  path?: string | null;
};

export type FeedbackResult = { ok: true } | { ok: false; error: string };

function clean(
  value: string | null | undefined,
  allowed: Set<string>,
): string | null {
  if (typeof value !== "string") return null;
  return allowed.has(value) ? value : null;
}

export async function submitFeedback(
  input: FeedbackInput,
): Promise<FeedbackResult> {
  const useIntent = clean(input.useIntent, USE_INTENT);
  const foundSomething = clean(input.foundSomething, FOUND);
  const differentiation = clean(input.differentiation, DIFFERENTIATION);
  const wants = Array.isArray(input.wants)
    ? input.wants.filter((w) => WANTS.has(w))
    : [];
  const message =
    typeof input.message === "string" && input.message.trim()
      ? input.message.trim().slice(0, 2000)
      : null;
  const email =
    typeof input.email === "string" && input.email.trim()
      ? input.email.trim().slice(0, 320)
      : null;
  const path =
    typeof input.path === "string" && input.path.trim()
      ? input.path.trim().slice(0, 200)
      : null;

  // Require at least one signal so an empty submit does nothing.
  const hasContent =
    useIntent || foundSomething || differentiation || wants.length || message;
  if (!hasContent) {
    return { ok: false, error: "empty" };
  }

  const user = await getAuthUser();

  const supabase = await createClient();
  const { error } = await supabase.from("feedback").insert({
    user_id: user?.id ?? null,
    email: email ?? user?.email ?? null,
    use_intent: useIntent,
    found_something: foundSomething,
    differentiation,
    wants,
    message,
    path,
  });

  if (error) {
    console.error("[profile/actions] submitFeedback failed:", error);
    return { ok: false, error: "save_failed" };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Data export (GDPR right to access). Returns everything we hold for the
// signed-in user as a plain object the client turns into a JSON download.
// Runs as the user via RLS, so it can only ever read their OWN rows — no
// service-role, no way to read anyone else's data.
// ─────────────────────────────────────────────────────────────────────────

export type ExportResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export async function exportMyData(): Promise<ExportResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "not_signed_in" };

  const supabase = await createClient();
  const [profile, saved, bookings, plans] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("saved_venues")
      .select("venue_id, created_at, venues(slug, name)")
      .eq("user_id", user.id),
    supabase.from("bookings").select("*").eq("user_id", user.id),
    supabase.from("plans").select("*").eq("user_id", user.id),
  ]);

  return {
    ok: true,
    data: {
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email ?? null },
      profile: profile.data ?? null,
      saved: saved.data ?? [],
      bookings: bookings.data ?? [],
      plans: plans.data ?? [],
      note: "This is all the personal data Fun London holds for your account. Feedback you submit is stored without a readable link back to you.",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Weekly digest email opt-in.
//
// Stores explicit consent for the weekly "new in London" email on the user's
// own profile row (RLS self-update). Default is OFF; the user turns it on here
// and can turn it off here or via the one-click unsubscribe link in any email.
// ─────────────────────────────────────────────────────────────────────────

export type OptInResult = { ok: true } | { ok: false; error: string };

export async function setEmailDigestOptIn(
  optIn: boolean,
): Promise<OptInResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "not_signed_in" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ email_weekly_opt_in: optIn })
    .eq("id", user.id);
  if (error) {
    console.error(`[profile] setEmailDigestOptIn: ${error.message}`);
    return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Account deletion (GDPR right to erasure).
//
// Removing the auth.users row needs the service-role key (the anon client
// can't delete an auth user). The FK cascades clear the rest: profiles,
// saved_venues, bookings and plans are ON DELETE CASCADE; feedback.user_id is
// ON DELETE SET NULL, so submitted feedback is kept but de-linked from the
// person. We only ever delete the CALLING user's own id.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the server env (Vercel). Returns
// "not_configured" if it's missing so the UI can degrade gracefully.
// ─────────────────────────────────────────────────────────────────────────

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteMyAccount(): Promise<DeleteResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "not_signed_in" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[profile] deleteMyAccount: SUPABASE_SERVICE_ROLE_KEY unset");
    return { ok: false, error: "not_configured" };
  }

  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[profile] deleteMyAccount failed:", error);
    return { ok: false, error: "delete_failed" };
  }
  return { ok: true };
}
