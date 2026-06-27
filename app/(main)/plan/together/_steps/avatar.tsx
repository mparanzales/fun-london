import type { Participant } from "@/lib/types";

// Round colored avatar with an emoji glyph in the centre.
// Used in Lobby (32px), Mixing (28px), and the Result step's voter cluster.
// `size` and `participant.color` are dynamic so inline style is the right
// tool — Tailwind utilities can't take runtime values for arbitrary HSL.
export function Avatar({
  participant,
  size,
  fontSize,
}: {
  participant: Participant;
  size: number;
  fontSize: number;
}) {
  return (
    <div
      className="rounded-full grid place-items-center text-white font-bold"
      style={{
        width: size,
        height: size,
        background: participant.color,
        fontSize,
      }}
    >
      {participant.name.charAt(0).toUpperCase()}
    </div>
  );
}
