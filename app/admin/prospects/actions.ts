"use server";

// Server Actions for /admin/prospects (the partner-BD cockpit).
//
// Re-checks admin authorisation on every call, and writes via the service-role
// client because partner_prospects is RLS-locked to service_role. Return type
// is void so it can be used directly as a <form action={…}> handler.

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/admin";

// The BD lifecycle stages (mirrors schema.sql partner_prospects.bd_status).
export const BD_STATUSES = [
  "prospect",
  "contacted",
  "in_conversation",
  "partnered",
  "declined",
  "passed",
] as const;
const STATUS_SET = new Set<string>(BD_STATUSES);

export async function updateProspect(formData: FormData): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) {
    console.warn("[admin/prospects] non-admin updateProspect attempt");
    return;
  }

  const id = formData.get("id");
  const status = formData.get("status");
  const notes = formData.get("notes");
  if (typeof id !== "string" || !id) return;

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof status === "string" && STATUS_SET.has(status)) {
    update.bd_status = status;
  }
  if (typeof notes === "string") {
    update.notes = notes.trim() ? notes.trim().slice(0, 4000) : null;
  }
  // Nothing meaningful to change (only the timestamp) → skip.
  if (Object.keys(update).length === 1) return;

  const supabase = createServiceClient();
  if (!supabase) {
    console.error("[admin/prospects] SUPABASE_SERVICE_ROLE_KEY not configured");
    return;
  }

  const { error } = await supabase
    .from("partner_prospects")
    .update(update)
    .eq("id", id);
  if (error) {
    console.error("[admin/prospects] update failed:", error);
    return;
  }

  revalidatePath("/admin/prospects");
}
