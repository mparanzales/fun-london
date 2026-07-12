"use server";

// Server Action for /admin/popups — lets an admin pull an auto-published
// pop-up from the app. Re-checks admin authorisation before mutating, so a
// leaked URL or replay can't hide listings from a non-admin session.
//
// "Hide" sets cancelled_at (rather than deleting) so it's STICKY: the read
// path filters cancelled rows out, AND the radar's dedupe keeps the row's
// source_id, so the pop-up won't be re-published on the next cron run.
//
// The write itself is permitted by the "events admin update popups" RLS
// policy (migration events_admin_hide_popups_policy) — no service-role key
// needed, so it works on Vercel.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminUser } from "@/lib/auth";

export async function hidePopup(formData: FormData): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) {
    console.warn(`[admin/popups] non-admin hidePopup attempt`);
    return;
  }

  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    console.warn(`[admin/popups] bad input`);
    return;
  }

  const supabase = await createClient();
  // Pop-ups come in two shapes: legacy radar rows (source='popup') and
  // organizer-first Eventbrite rows (source='eventbrite', no catalogue
  // venue_id). Both must be hideable from the same review surface.
  const { data: updated, error } = await supabase
    .from("events")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .or("source.eq.popup,and(source.eq.eventbrite,venue_id.is.null)")
    .select("id");

  if (error) {
    console.error(`[admin/popups] hide failed:`, error);
    return;
  }
  if (!updated || updated.length === 0) {
    // RLS makes a disallowed update look like "0 rows", not an error. Most
    // likely cause: the live "events admin update popups" policy predates
    // the eventbrite widening (see supabase/schema.sql) — re-paste it.
    console.warn(
      `[admin/popups] hide matched no rows for ${id} (already hidden, or the RLS policy needs updating)`,
    );
    return;
  }

  revalidatePath("/admin/popups");
}
