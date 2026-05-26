import { getAuthUser } from "@/lib/auth";
import { OnboardingFlow } from "./onboarding-flow";

export default async function OnboardingPage() {
  const authUser = await getAuthUser();
  return (
    <main className="min-h-screen flex items-stretch justify-center px-0 py-0">
      <div className="w-full max-w-md">
        <OnboardingFlow authUserId={authUser?.id ?? null} />
      </div>
    </main>
  );
}
