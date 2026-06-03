// Plain constants for the BD cockpit. Kept OUT of actions.ts because a
// "use server" file may only export async functions — exporting a value
// (BD_STATUSES) from it fails `next build`.

// The BD lifecycle stages (mirrors schema.sql partner_prospects.bd_status).
export const BD_STATUSES = [
  "prospect",
  "contacted",
  "in_conversation",
  "partnered",
  "declined",
  "passed",
] as const;
