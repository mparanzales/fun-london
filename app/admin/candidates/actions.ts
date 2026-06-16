"use server";

// Server Actions for /admin/candidates.
//
// Each action re-checks admin authorisation via getAdminUser() before
// mutating, so even a leaked URL or replay attack can't change state
// from a non-admin session.
//
// Return type is `void` because Next 14 `<form action={…}>` requires
// it. Errors are logged to the server (and would surface in Vercel
// runtime logs) but don't propagate to the client UI for now. A future
// upgrade could swap these for client components + useFormState to
// show inline errors, but the simple void form is enough for a v1
// internal admin tool.

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { getAdminUser } from "@/lib/auth";
import type { PendingCandidateStatus } from "@/lib/types";

export type Decision = "approve" | "reject" | "snooze";

export async function decideCandidate(formData: FormData): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) {
    console.warn(`[admin/candidates] non-admin decideCandidate attempt`);
    return;
  }

  const id = formData.get("id");
  const decision = formData.get("decision");
  const notes = formData.get("notes");
  const snoozeMonths = formData.get("snoozeMonths");

  if (typeof id !== "string" || typeof decision !== "string") {
    console.warn(`[admin/candidates] bad input`);
    return;
  }

  // Typed against the allowed set (not bare `string`), so a wrong value here
  // is a build error rather than a status the DB CHECK rejects at runtime.
  let nextStatus: PendingCandidateStatus;
  let snoozedUntil: string | null = null;

  switch (decision) {
    case "approve":
      nextStatus = "approved";
      break;
    case "reject":
      nextStatus = "rejected";
      break;
    case "snooze": {
      nextStatus = "snoozed";
      const months = Number(snoozeMonths ?? "6");
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      snoozedUntil = d.toISOString();
      break;
    }
    default:
      console.warn(`[admin/candidates] unknown decision: ${decision}`);
      return;
  }

  const supabase = createServiceClient();
  if (!supabase) return;
  const { error } = await supabase
    .from("pending_candidates")
    .update({
      status: nextStatus,
      reviewed_at: new Date().toISOString(),
      reviewed_notes:
        typeof notes === "string" && notes.trim() ? notes.trim() : null,
      snoozed_until: snoozedUntil,
    })
    .eq("id", id);

  if (error) {
    console.error(`[admin/candidates] update failed:`, error);
    return;
  }

  // Reload the list view so the decided card disappears.
  revalidatePath("/admin/candidates");
}
