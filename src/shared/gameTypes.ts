export type GameStatus =
  | "lobby"
  | "round_prepare"
  | "attack_declaration"
  | "battle_resolution"
  | "round_cleanup"
  | "finished";

export type Mado = {
  id: string;
  frequency: number;
  baseDamage: number;
};

// A continuous range of possible frequencies. `end` is exclusive and may exceed 360
// when the arc wraps past 0 degrees.
export type FrequencyArc = {
  start: number;
  end: number;
};

export type EchoBand = "glowing" | "warm" | "lukewarm" | "cold";

// Every shield frequency that is still consistent with what the holder has learned.
export type InsightState = {
  candidates: number[];
};

export type InsightTransfer = {
  fromPlayerId: string;
  targetPlayerId: string;
  arcs: FrequencyArc[];
  possibleCount: number;
  roundNumber: number;
};

export type Player = {
  id: string;
  name: string;
  health: number;
  alive: boolean;
  shieldFrequency: number;
  madoSlots: Array<Mado | null>;
  discardedThisRound: Set<number>;
  attackIntent?: { targetPlayerId: string } | { pass: true };
  insightsByTarget: Record<string, InsightState>;
  receivedInsights: InsightTransfer[];
};

export type Battle = {
  id: string;
  roundNumber: number;
  playerAId: string;
  playerBId: string;
  status: "active" | "finished";
  exchanges: Exchange[];
  fleeingPlayerIds: string[];
};

export type ExchangeAction =
  | { type: "mado"; madoSlotIndex: number; madoId?: string }
  | { type: "flee" }
  | { type: "end" };

export type Exchange = {
  index: number;
  actionsByPlayerId: Record<string, ExchangeAction>;
  damageByPlayerId: Record<string, number>;
  echoByAttackerId: Record<string, EchoBand | null>;
  fleeingPlayerIdsAfterExchange: string[];
  usedMadoSlotIndexesByPlayerId: Record<string, number[]>;
};

export type MatchmakingBattle = {
  id: string;
  playerAId: string;
  playerBId: string;
};

export type MatchmakingResult = {
  battles: MatchmakingBattle[];
  spentAttackPlayerIds: string[];
  unmatchedAttackerIds: string[];
};

export type ScriptedBattleResult = {
  exchanges: Exchange[];
  healthByPlayerId: Record<string, number>;
  deadPlayerIds: string[];
  usedMadoSlotIndexesByPlayerId: Record<string, number[]>;
};
