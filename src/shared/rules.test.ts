import { describe, expect, it } from "vitest";
import type { Player } from "./gameTypes.js";
import {
  applyEcho,
  calculateDamage,
  circularDistance,
  createInitialInsight,
  discardMados,
  fillEmptyMadoSlots,
  getEchoBand,
  mergeSharedInsight,
  removeDeadPlayerInsights,
  resolveAttackDeclarations,
  resolveScriptedBattle,
  toFrequencyArcs,
  tuneMado,
  tuneMadoFrequency,
} from "./rules.js";

function makePlayer(overrides: Partial<Player> & Pick<Player, "id">): Player {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    health: overrides.health ?? 100,
    alive: overrides.alive ?? true,
    shieldFrequency: overrides.shieldFrequency ?? 0,
    madoSlots: overrides.madoSlots ?? [],
    discardedThisRound: overrides.discardedThisRound ?? new Set(),
    attackIntent: overrides.attackIntent,
    insightsByTarget: overrides.insightsByTarget ?? {},
    receivedInsights: overrides.receivedInsights ?? [],
  };
}

describe("frequency and damage rules", () => {
  it("calculates shortest circular distance", () => {
    expect(circularDistance(10, 350)).toBe(20);
  });

  it("does full damage inside the full damage distance", () => {
    expect(calculateDamage(90, 90)).toBe(30);
    expect(calculateDamage(90, 105)).toBe(30);
  });

  it("falls off linearly between the full and zero damage distances", () => {
    expect(calculateDamage(0, 30)).toBe(15);
  });

  it("does no damage from the zero damage distance and beyond", () => {
    expect(calculateDamage(0, 45)).toBe(0);
    expect(calculateDamage(0, 180)).toBe(0);
  });

  it("applies flee multiplier to actual damage", () => {
    expect(calculateDamage(0, 0, 0.5)).toBe(15);
  });
});

describe("echo and insight rules", () => {
  it("maps distance to echo bands", () => {
    expect(getEchoBand(0)).toBe("glowing");
    expect(getEchoBand(15)).toBe("glowing");
    expect(getEchoBand(16)).toBe("warm");
    expect(getEchoBand(45)).toBe("warm");
    expect(getEchoBand(90)).toBe("lukewarm");
    expect(getEchoBand(91)).toBe("cold");
  });

  it("starts with every frequency possible", () => {
    expect(createInitialInsight().candidates).toHaveLength(360);
  });

  it("keeps only frequencies consistent with an echo", () => {
    const insight = applyEcho(undefined, 100, "glowing");

    expect(insight.candidates).toHaveLength(31);
    expect(insight.candidates[0]).toBe(85);
    expect(insight.candidates.at(-1)).toBe(115);
  });

  it("narrows to the overlap of several echoes and keeps the true shield", () => {
    const shield = 200;
    let insight = createInitialInsight();

    for (const madoFrequency of [0, 120, 230]) {
      insight = applyEcho(insight, madoFrequency, getEchoBand(circularDistance(madoFrequency, shield)));
    }

    expect(insight.candidates).toContain(shield);
    expect(insight.candidates.length).toBeLessThan(60);
  });

  it("merges shared insight as an intersection", () => {
    const receiver = applyEcho(undefined, 0, "lukewarm");
    const shared = applyEcho(undefined, 90, "glowing");
    const merged = mergeSharedInsight(receiver, shared);

    expect(merged.candidates.every((frequency) => receiver.candidates.includes(frequency))).toBe(true);
    expect(merged.candidates.every((frequency) => shared.candidates.includes(frequency))).toBe(true);
    expect(merged.candidates).toContain(90);
  });

  it("turns candidates into arcs and joins arcs across zero degrees", () => {
    expect(toFrequencyArcs(createInitialInsight().candidates)).toEqual([{ start: 0, end: 360 }]);
    expect(toFrequencyArcs(applyEcho(undefined, 0, "glowing").candidates)).toEqual([
      { start: 345, end: 376 },
    ]);
    expect(toFrequencyArcs(applyEcho(undefined, 90, "warm").candidates)).toEqual([
      { start: 45, end: 75 },
      { start: 106, end: 136 },
    ]);
  });
});

describe("tuning rules", () => {
  it("moves a Mado toward the target by the shortest way round", () => {
    expect(tuneMadoFrequency(350, 20)).toBe(20);
    expect(tuneMadoFrequency(20, 350)).toBe(350);
  });

  it("limits tuning to the tune range", () => {
    expect(tuneMadoFrequency(0, 100)).toBe(60);
    expect(tuneMadoFrequency(0, 260)).toBe(300);
  });

  it("tunes only the chosen slot", () => {
    const player = makePlayer({
      id: "player",
      madoSlots: [
        { id: "mado-0", frequency: 0, baseDamage: 30 },
        { id: "mado-1", frequency: 90, baseDamage: 30 },
      ],
    });
    const tuned = tuneMado(player, 1, 120);

    expect(tuned.madoSlots[0]?.frequency).toBe(0);
    expect(tuned.madoSlots[1]?.frequency).toBe(120);
  });
});

describe("mado and cleanup rules", () => {
  it("keeps discarded mado slots empty until next round fill", () => {
    const player = makePlayer({
      id: "player",
      madoSlots: [
        { id: "mado-0", frequency: 0, baseDamage: 30 },
        { id: "mado-1", frequency: 90, baseDamage: 30 },
      ],
    });

    const discarded = discardMados(player, [1]);

    expect(discarded.madoSlots[0]?.id).toBe("mado-0");
    expect(discarded.madoSlots[1]).toBeNull();
    expect(discarded.discardedThisRound.has(1)).toBe(true);
  });

  it("fills empty mado slots and keeps existing slots", () => {
    const slots = fillEmptyMadoSlots(
      [{ id: "existing", frequency: 12, baseDamage: 30 }],
      (slotIndex) => `mado-${slotIndex}`,
      () => 0.5,
    );

    expect(slots).toHaveLength(5);
    expect(slots[0]?.id).toBe("existing");
    expect(slots[1]).toEqual({ id: "mado-1", frequency: 180, baseDamage: 30 });
  });

  it("removes frequency insight about dead players", () => {
    const players: Player[] = [
      {
        id: "alive",
        name: "Alive",
        health: 100,
        alive: true,
        shieldFrequency: 90,
        madoSlots: [],
        discardedThisRound: new Set(),
        insightsByTarget: {
          dead: createInitialInsight(),
        },
        receivedInsights: [
          {
            fromPlayerId: "other",
            targetPlayerId: "dead",
            arcs: [{ start: 180, end: 360 }],
            possibleCount: 180,
            roundNumber: 1,
          },
        ],
      },
      {
        id: "dead",
        name: "Dead",
        health: 0,
        alive: false,
        shieldFrequency: 181,
        madoSlots: [],
        discardedThisRound: new Set(),
        insightsByTarget: {},
        receivedInsights: [],
      },
    ];

    const cleanedPlayers = removeDeadPlayerInsights(players);

    expect(cleanedPlayers[0]?.insightsByTarget).toEqual({});
    expect(cleanedPlayers[0]?.receivedInsights).toEqual([]);
  });
});

describe("matchmaking rules", () => {
  it("creates one battle when two players attack each other", () => {
    const result = resolveAttackDeclarations([
      makePlayer({ id: "a", attackIntent: { targetPlayerId: "b" } }),
      makePlayer({ id: "b", attackIntent: { targetPlayerId: "a" } }),
    ]);

    expect(result.battles).toEqual([
      { id: "battle-1", playerAId: "a", playerBId: "b" },
    ]);
  });

  it("chooses only one attacker when multiple players attack the same target", () => {
    const result = resolveAttackDeclarations(
      [
        makePlayer({ id: "a", attackIntent: { targetPlayerId: "target" } }),
        makePlayer({ id: "b", attackIntent: { targetPlayerId: "target" } }),
        makePlayer({ id: "c", attackIntent: { targetPlayerId: "target" } }),
        makePlayer({ id: "target" }),
      ],
      () => 0.5,
    );

    expect(result.battles).toEqual([
      { id: "battle-1", playerAId: "b", playerBId: "target" },
    ]);
    expect(result.unmatchedAttackerIds.sort()).toEqual(["a", "c"]);
  });

  it("marks attackers who were not selected as having spent their action", () => {
    const result = resolveAttackDeclarations(
      [
        makePlayer({ id: "a", attackIntent: { targetPlayerId: "target" } }),
        makePlayer({ id: "b", attackIntent: { targetPlayerId: "target" } }),
        makePlayer({ id: "target" }),
      ],
      () => 0,
    );

    expect(result.spentAttackPlayerIds.sort()).toEqual(["a", "b"]);
    expect(result.unmatchedAttackerIds).toEqual(["b"]);
  });
});

describe("battle resolution rules", () => {
  it("finishes without damage if both players start without mados", () => {
    const result = resolveScriptedBattle(
      makePlayer({ id: "a", madoSlots: [] }),
      makePlayer({ id: "b", madoSlots: [] }),
      [],
    );

    expect(result.exchanges).toEqual([]);
    expect(result.healthByPlayerId).toEqual({ a: 100, b: 100 });
  });

  it("allows the fifth flee multiplier when a player flees from start", () => {
    const attacker = makePlayer({
      id: "attacker",
      madoSlots: [0, 1, 2, 3, 4].map((index) => ({
        id: `mado-${index}`,
        frequency: 0,
        baseDamage: 30,
      })),
    });
    const fleeing = makePlayer({
      id: "fleeing",
      shieldFrequency: 0,
      madoSlots: [],
    });
    const result = resolveScriptedBattle(
      attacker,
      fleeing,
      [0, 1, 2, 3, 4].map((index) => ({
        attacker: { type: "mado", madoSlotIndex: index },
      })),
    );

    expect(result.exchanges.map((exchange) => exchange.damageByPlayerId.fleeing)).toEqual([
      15,
      12,
      9,
      6,
      3,
    ]);
  });

  it("kills both players when simultaneous damage is lethal to both", () => {
    const result = resolveScriptedBattle(
      makePlayer({
        id: "a",
        health: 10,
        shieldFrequency: 0,
        madoSlots: [{ id: "a-mado", frequency: 0, baseDamage: 30 }],
      }),
      makePlayer({
        id: "b",
        health: 10,
        shieldFrequency: 0,
        madoSlots: [{ id: "b-mado", frequency: 0, baseDamage: 30 }],
      }),
      [
        {
          a: { type: "mado", madoSlotIndex: 0 },
          b: { type: "mado", madoSlotIndex: 0 },
        },
      ],
    );

    expect(result.deadPlayerIds.sort()).toEqual(["a", "b"]);
  });
});
