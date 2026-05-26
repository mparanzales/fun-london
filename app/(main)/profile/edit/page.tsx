import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { fetchProfile, fetchNeighbourhoods } from "@/lib/queries";
import { EditForm } from "./edit-form";

// Server Component: gates on auth, pre-loads the current profile +
// the list of areas the picker can show. Anonymous → redirect to
// /sign-in with a return path. Signed in → hand everything to the
// client EditForm.

export default async function ProfileEditPage() {
  const authUser = await getAuthUser();
  if (!authUser) {
    redirect("/sign-in?return=/profile/edit");
  }

  const [profile, areas] = await Promise.all([
    fetchProfile(authUser.id),
    fetchNeighbourhoods(),
  ]);

  return (
    <EditForm
      authUserId={authUser.id}
      initialDisplayName={profile?.displayName ?? ""}
      initialPreferences={profile?.preferences ?? null}
      areaOptions={areas}
    />
  );
}
