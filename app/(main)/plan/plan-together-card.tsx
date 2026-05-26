import Link from "next/link";

// "Plan with friends" entry card — pixel-faithful port of PT_Entry from
// plan-together.jsx (lines 13–25). Lives at the top of /plan and routes
// to /plan/together. Tapping "Start a session →" navigates there.

export function PlanTogetherCard() {
  return (
    <div className="px-4 py-4.5">
      <div
        className="rounded-[18px] p-5.5 text-white h-[200px] relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
        }}
      >
        {/* Decorative offset circle, half off-canvas top-right */}
        <div className="absolute -top-[30px] -right-[30px] w-[140px] h-[140px] rounded-full bg-white/[0.12]" />
        <div className="flex gap-1 text-[22px]">👥✨🎉</div>
        <h2 className="text-[22px] font-extrabold mt-4 mb-1.5 tracking-tight">
          Plan with friends
        </h2>
        <div className="text-xs opacity-90 leading-relaxed">
          Everyone swipes their vote. We balance it into one plan you&apos;ll
          all actually want to do.
        </div>
        <Link
          href="/plan/together"
          className="inline-block mt-3.5 bg-white text-primary rounded-full px-4 py-2 font-extrabold text-xs no-underline"
        >
          Start a session →
        </Link>
      </div>
    </div>
  );
}
