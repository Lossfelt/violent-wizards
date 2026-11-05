// Every round has a time limit, so one wizard who wanders off cannot stall the war.
// The host picks one length for the whole round. Planning (Prepare and Declare, which each
// wizard does at their own pace) must be done within the first part of it, and battles must
// be over by the end. Whoever has not acted by a deadline follows standing orders.

export const ROUND_MINUTE_OPTIONS = [2, 3, 5, 8] as const;
export const DEFAULT_ROUND_MINUTES = 5;

// Share of the round that planning may use. Time saved on planning goes to the battles.
export const PLANNING_SHARE = 0.4;

// Pause between rounds before the next one starts by itself.
export const ROUND_BREAK_MS = 12_000;

export function clampRoundMinutes(minutes: unknown): number {
  return ROUND_MINUTE_OPTIONS.find((option) => option === minutes) ?? DEFAULT_ROUND_MINUTES;
}

export function roundDeadlines(startedAt: number, minutes: number) {
  const roundMs = minutes * 60_000;

  return {
    planningEndsAt: startedAt + Math.round(roundMs * PLANNING_SHARE),
    roundEndsAt: startedAt + roundMs,
  };
}
