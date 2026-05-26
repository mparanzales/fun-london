"use client";

import { VenueCard } from "@/components/venue-card";
import { useSaved } from "@/components/saved-context";
import { getSavedVenues } from "@/lib/mock-data";

export default function SavedPage() {
  const { savedSet } = useSaved();
  const saved = getSavedVenues(savedSet);

  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-3.5">
        <h1 className="text-[26px] font-extrabold tracking-tight text-primary">
          Your spots
        </h1>
        <div className="text-xs text-muted-fg mt-0.5">
          {saved.length} spot{saved.length === 1 ? "" : "s"} saved
        </div>
      </header>

      {saved.length === 0 ? (
        <div className="mx-5 mt-5 p-6 rounded-2xl bg-card border border-border text-center">
          <div className="text-3xl">💛</div>
          <h2 className="text-sm font-extrabold text-heading mt-2">
            Nothing saved yet
          </h2>
          <p className="text-xs text-muted-fg mt-1">
            Tap the heart on any place to keep it here.
          </p>
        </div>
      ) : (
        <div className="px-5 grid grid-cols-2 gap-3">
          {saved.map((v) => (
            <VenueCard key={v.id} venue={v} variant="wide" />
          ))}
        </div>
      )}
    </div>
  );
}
