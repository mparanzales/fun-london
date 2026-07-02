// Group react/veto threshold for Plan Together.
//
// A stop swaps only when STRICTLY MORE than half the group has vetoed it — a
// real majority, so no single person can override the group (the explicit
// product choice over "any one veto swaps it"). For a pair that means both must
// veto; for 3 it's 2; for 4 it's 3. A lone member (group of 1) passes on their
// own veto.

export function vetoMajority(vetoes: number, groupSize: number): boolean {
  return groupSize > 0 && vetoes > groupSize / 2;
}
