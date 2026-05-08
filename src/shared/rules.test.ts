import { describe, expect, it } from "vitest";
import type { Player } from "./gameTypes.js";
import {
  addInsightFromDamage,
  applySharedInsight,
  calculateDamage,
  circularDistance,
  createInitialInsight,
  discardMados,
  fillEmptyMadoSlots,
  getInsightSegment,
  removeDeadPlayerInsights,
  resolveAttackDeclarations,
  resolveScriptedBattle,
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

  it("calculates full match damage", () => {
    expect(calculateDamage(90, 90)).toBe(25);
  });

  it("calculates 90 degree damage", () => {
    expect(calculateDamage(0, 90)).toBe(12.5);
  });

  it("calculates opposite frequency as no damage", () => {
    expect(calculateDamage(0, 180)).toBe(0);
  });

  it("applies flee multiplier to actual damage", () => {
    expect(calculateDamage(0, 0, 0.5)).toBe(12.5);
  });
});

describe("insight rules", () => {
  it("crosses thresholds and updates level", () => {
    const insight = addInsightFromDamage(undefined, 181, 25, () => 0);

    expect(insight.points).toBe(18.75);
    expect(insight.level).toBe(1);
    expect(insight.segment).toEqual({
      level: 1,
      index: 1,
      start: 180,
      end: 360,
    });
  });

  it("finds the deterministic segment containing shield frequency", () => {
    expect(getInsightSegment(181, 3)).toEqual({
      level: 3,
      index: 4,
      start: 180,
      end: 225,
    });
  });

  it("upgrades receiver when shared insight has higher level", () => {
    const received = applySharedInsight(undefined, 181, 3);

    expect(received.level).toBe(3);
    expect(received.points).toBe(45);
    expect(received.segment).toEqual(getInsightSegment(181, 3));
  });

  it("does not downgrade receiver when they already have higher insight", () => {
    const current = addInsightFromDamage(undefined, 181, 100, () => 1);
    const received = applySharedInsight(current, 181, 2);

    expect(received).toBe(current);
    expect(received.level).toBe(5);
  });

  it("sets receiver points to at least the minimum threshold for shared level", () => {
    const current = createInitialInsight(181);
    const received = applySharedInsight(current, 181, 4);

    expect(received.points).toBe(70);
  });
});

describe("mado and cleanup rules", () => {
  it("keeps discarded mado slots empty until next round fill", () => {
    const player = makePlayer({
      id: "player",
      madoSlots: [
        { id: "mado-0", frequency: 0, baseDamage: 25 },
        { id: "mado-1", frequency: 90, baseDamage: 25 },
      ],
    });

    const discarded = discardMados(player, [1]);

    expect(discarded.madoSlots[0]?.id).toBe("mado-0");
    expect(discarded.madoSlots[1]).toBeNull();
    expect(discarded.discardedThisRound.has(1)).toBe(true);
  });

  it("fills empty mado slots and keeps existing slots", () => {
    const slots = fillEmptyMadoSlots(
      [{ id: "existing", frequency: 12, baseDamage: 25 }],
      (slotIndex) => `mado-${slotIndex}`,
      () => 0.5,
    );

    expect(slots).toHaveLength(5);
    expect(slots[0]?.id).toBe("existing");
    expect(slots[1]).toEqual({ id: "mado-1", frequency: 180, baseDamage: 25 });
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
          dead: createInitialInsight(181),
        },
        receivedInsights: [
          {
            fromPlayerId: "other",
            targetPlayerId: "dead",
            level: 1,
            segment: getInsightSegment(181, 1),
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
        baseDamage: 25,
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
      12.5,
      10,
      7.5,
      5,
      2.5,
    ]);
  });

  it("kills both players when simultaneous damage is lethal to both", () => {
    const result = resolveScriptedBattle(
      makePlayer({
        id: "a",
        health: 10,
        shieldFrequency: 0,
        madoSlots: [{ id: "a-mado", frequency: 0, baseDamage: 25 }],
      }),
      makePlayer({
        id: "b",
        health: 10,
        shieldFrequency: 0,
        madoSlots: [{ id: "b-mado", frequency: 0, baseDamage: 25 }],
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
