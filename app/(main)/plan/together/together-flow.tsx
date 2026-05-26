"use client";

// Plan Together — entry / dispatcher.
//
// Step components live in ./_steps/ (underscore prefix keeps them out of
// Next.js's route group). Each step is independently readable and
// testable. The Avatar primitive is shared across Lobby / Mixing / Result.

import { useState } from "react";
import type { Venue } from "@/lib/types";
import { Lobby } from "./_steps/lobby";
import { Swipe } from "./_steps/swipe";
import { Mixing } from "./_steps/mixing";
import { Result } from "./_steps/result";

type StepName = "lobby" | "swipe" | "mixing" | "result";

export function TogetherFlow({ venues }: { venues: Venue[] }) {
  const [step, setStep] = useState<StepName>("lobby");

  return (
    <div className="pb-4">
      {step === "lobby" && <Lobby onStart={() => setStep("swipe")} />}
      {step === "swipe" && (
        <Swipe onDone={() => setStep("mixing")} venues={venues} />
      )}
      {step === "mixing" && <Mixing onDone={() => setStep("result")} />}
      {step === "result" && <Result venues={venues} />}
    </div>
  );
}
