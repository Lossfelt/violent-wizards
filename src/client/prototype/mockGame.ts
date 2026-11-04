// PROTOTYPE: mock data for the UI prototype. Delete together with the rest of src/client/prototype.
import type { GameSnapshot, InsightState } from "../../shared";
import {
  applyEcho,
  circularDistance,
  createInitialInsight,
  dilateInsight,
  getEchoBand,
  toFrequencyArcs,
} from "../../shared";

export type PrototypePhase = "prepare" | "declare" | "battle";

// The true shields are hidden from the player. The prototype uses them to fake echoes.
export const HIDDEN_SHIELDS: Record<string, number> = {
  jonas: 152,
  sara: 37,
  even: 268,
  ida: 300,
};

function echoes(shield: number, shots: Array<[number, number]>): InsightState {
  let insight = createInitialInsight();

  for (const [frequency, round] of shots) {
    insight = applyEcho(insight, frequency, getEchoBand(circularDistance(frequency, shield)), round);
  }

  return insight;
}

function snapshotOf(insight: InsightState) {
  return {
    arcs: toFrequencyArcs(insight.candidates),
    possibleCount: insight.candidates.length,
    lastNarrowedRound: insight.lastNarrowedRound,
  };
}

const jonasInsight = dilateInsight(echoes(HIDDEN_SHIELDS.jonas!, [[90, 4], [170, 4], [140, 4]]), 6);
const saraInsight = dilateInsight(
  dilateInsight(echoes(HIDDEN_SHIELDS.sara!, [[10, 2], [80, 2]]), 60),
  18,
);

export const MOCK_INSIGHTS: Record<string, InsightState> = {
  jonas: jonasInsight,
  sara: saraInsight,
  even: createInitialInsight(),
  ida: createInitialInsight(),
};

const base: GameSnapshot = {
  code: "4172",
  status: "round_prepare",
  roundNumber: 5,
  hostPlayerId: "me",
  currentPlayer: {
    id: "me",
    name: "Mira",
    health: 142,
    alive: true,
    shieldFrequency: 214,
    shieldDrift: 4,
    madoSlots: [
      { id: "m1", frequency: 62, baseDamage: 30 },
      { id: "m2", frequency: 118, baseDamage: 30 },
      { id: "m3", frequency: 141, baseDamage: 30 },
      { id: "m4", frequency: 230, baseDamage: 30 },
      { id: "m5", frequency: 305, baseDamage: 30 },
    ],
    discardedThisRound: [],
    rotatingThisRound: false,
  },
  opponents: [
    { id: "jonas", name: "Jonas", alive: true, host: false, connected: true, insight: snapshotOf(jonasInsight), lastRotatedRound: null },
    { id: "sara", name: "Sara", alive: true, host: false, connected: true, insight: snapshotOf(saraInsight), lastRotatedRound: 3 },
    { id: "even", name: "Even", alive: true, host: false, connected: false, insight: snapshotOf(createInitialInsight()), lastRotatedRound: null },
    { id: "ida", name: "Ida", alive: false, host: false, connected: true, insight: snapshotOf(createInitialInsight()), lastRotatedRound: null },
  ],
  shareableInsights: [],
  receivedInsights: [],
  discardSubmittedPlayerIds: ["sara"],
  attackSubmittedPlayerIds: [],
  pendingBattles: [],
  currentBattle: null,
  battleHistory: [
    { id: "b1", roundNumber: 2, playerAName: "Mira", playerBName: "Sara", exchangeCount: 3, deaths: [] },
    { id: "b2", roundNumber: 3, playerAName: "Even", playerBName: "Ida", exchangeCount: 5, deaths: ["ida"] },
    { id: "b3", roundNumber: 4, playerAName: "Jonas", playerBName: "Mira", exchangeCount: 4, deaths: [] },
    { id: "b4", roundNumber: 4, playerAName: "Sara", playerBName: "Even", exchangeCount: 2, deaths: [] },
  ],
  shieldRotations: [{ roundNumber: 3, playerId: "sara", playerName: "Sara" }],
  unmatchedAttackerIds: [],
  winnerPlayerId: null,
  draw: false,
};

export function mockGame(phase: PrototypePhase): GameSnapshot {
  if (phase === "prepare") {
    return base;
  }

  if (phase === "declare") {
    return {
      ...base,
      status: "attack_declaration",
      discardSubmittedPlayerIds: ["me", "jonas", "sara", "even"],
      attackSubmittedPlayerIds: ["even"],
    };
  }

  return {
    ...base,
    status: "battle_resolution",
    currentPlayer: { ...base.currentPlayer, health: 124 },
    pendingBattles: [
      { id: "b5", playerAId: "me", playerAName: "Mira", playerBId: "jonas", playerBName: "Jonas" },
      { id: "b6", playerAId: "sara", playerAName: "Sara", playerBId: "even", playerBName: "Even" },
    ],
    currentBattle: {
      id: "b5",
      playerAId: "me",
      playerAName: "Mira",
      playerBId: "jonas",
      playerBName: "Jonas",
      opponentId: "jonas",
      opponentName: "Jonas",
      status: "active",
      exchangeCount: 1,
      waitingForPlayerIds: ["me"],
      fleeingPlayerIds: [],
      usedMadoSlotIndexes: [0],
      totalDamageTaken: 18,
      lastExchange: { index: 0, damageTaken: 18, echo: "lukewarm", firedFrequency: 62 },
    },
  };
}
