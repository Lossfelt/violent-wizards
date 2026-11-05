import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND_MINUTES, PLANNING_SHARE, clampRoundMinutes, roundDeadlines } from "./roundClock.js";

describe("round clock", () => {
  it("accepts only the offered round lengths", () => {
    expect(clampRoundMinutes(3)).toBe(3);
    expect(clampRoundMinutes(8)).toBe(8);
    expect(clampRoundMinutes(4)).toBe(DEFAULT_ROUND_MINUTES);
    expect(clampRoundMinutes("5")).toBe(DEFAULT_ROUND_MINUTES);
    expect(clampRoundMinutes(undefined)).toBe(DEFAULT_ROUND_MINUTES);
  });

  it("ends planning partway through the round and battles at its end", () => {
    const deadlines = roundDeadlines(1_000, 5);

    expect(deadlines.roundEndsAt).toBe(1_000 + 300_000);
    expect(deadlines.planningEndsAt).toBe(1_000 + 300_000 * PLANNING_SHARE);
    expect(deadlines.planningEndsAt).toBeLessThan(deadlines.roundEndsAt);
  });
});
