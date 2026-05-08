import type {
  Exchange,
  ExchangeAction,
  FrequencySegment,
  GameStatus,
  InsightTransfer,
  Mado,
} from "./gameTypes.js";

export type AppPhase = "setup";

export type {
  FrequencySegment,
  Battle,
  Exchange,
  ExchangeAction,
  GameStatus,
  InsightState,
  InsightTransfer,
  MatchmakingBattle,
  MatchmakingResult,
  Mado,
  Player,
  ScriptedBattleResult,
} from "./gameTypes.js";

export {
  FLEE_DAMAGE_MULTIPLIERS,
  INSIGHT_NOISE_MAX,
  INSIGHT_NOISE_MIN,
  INSIGHT_SEGMENT_COUNTS,
  INSIGHT_THRESHOLDS,
  MADO_BASE_DAMAGE,
  MAX_FREQUENCY,
  MAX_MADOS,
  MIN_FREQUENCY,
  STARTING_HEALTH,
  addInsightFromDamage,
  applySharedInsight,
  calculateDamage,
  circularDistance,
  createInitialInsight,
  createMado,
  discardMados,
  fillEmptyMadoSlots,
  getInsightLevel,
  getInsightMinimumPoints,
  getInsightSegment,
  normalizeFrequency,
  randomFrequency,
  removeDeadPlayerInsights,
  resolveAttackDeclarations,
  resolveScriptedBattle,
} from "./rules.js";

export type ServerStatus = {
  ok: true;
  service: "violent-wizards-server";
  connectedClients: number;
};

export type ServerHandshake = {
  socketId: string;
  serverTime: string;
};

export type LobbyPlayer = {
  id: string;
  sessionId: string;
  name: string;
  host: boolean;
  connected: boolean;
};

export type LobbySnapshot = {
  code: string;
  status: "lobby";
  hostPlayerId: string;
  currentPlayerId: string;
  players: LobbyPlayer[];
};

export type CurrentPlayerSnapshot = {
  id: string;
  name: string;
  health: number;
  alive: boolean;
  shieldFrequency: number;
  madoSlots: Array<Mado | null>;
  discardedThisRound: number[];
};

export type OpponentSnapshot = {
  id: string;
  name: string;
  alive: boolean;
  host: boolean;
  connected: boolean;
  insight: {
    level: number;
    segment: FrequencySegment;
  };
};

export type ShareableInsightSnapshot = {
  targetPlayerId: string;
  targetName: string;
  level: number;
  segment: FrequencySegment;
};

export type RoundBattlePreview = {
  id: string;
  playerAId: string;
  playerAName: string;
  playerBId: string;
  playerBName: string;
};

export type CurrentBattleSnapshot = RoundBattlePreview & {
  opponentId: string;
  opponentName: string;
  status: "active" | "finished";
  exchangeCount: number;
  waitingForPlayerIds: string[];
  fleeingPlayerIds: string[];
  usedMadoSlotIndexes: number[];
  lastExchange: Exchange | null;
};

export type PublicBattleHistoryEntry = {
  id: string;
  roundNumber: number;
  playerAName: string;
  playerBName: string;
  exchangeCount: number;
  damageByPlayerId: Record<string, number>;
  deaths: string[];
};

export type GameSnapshot = {
  code: string;
  status: Exclude<GameStatus, "lobby">;
  roundNumber: number;
  hostPlayerId: string;
  currentPlayer: CurrentPlayerSnapshot;
  opponents: OpponentSnapshot[];
  shareableInsights: ShareableInsightSnapshot[];
  receivedInsights: InsightTransfer[];
  discardSubmittedPlayerIds: string[];
  attackSubmittedPlayerIds: string[];
  pendingBattles: RoundBattlePreview[];
  currentBattle: CurrentBattleSnapshot | null;
  battleHistory: PublicBattleHistoryEntry[];
  unmatchedAttackerIds: string[];
  winnerPlayerId: string | null;
  draw: boolean;
};

export type GameActionResult =
  | { ok: true; game: GameSnapshot }
  | { ok: false; error: string };

export type LobbyActionResult =
  | { ok: true; lobby: LobbySnapshot }
  | { ok: true; game: GameSnapshot }
  | { ok: false; error: string };

export type ServerToClientEvents = {
  "server:handshake": (payload: ServerHandshake) => void;
  "server:status": (payload: ServerStatus) => void;
  "lobby:updated": (payload: LobbySnapshot) => void;
  "game:updated": (payload: GameSnapshot) => void;
};

export type ClientToServerEvents = {
  "client:ping": (acknowledge: (payload: ServerHandshake) => void) => void;
  "lobby:create": (
    payload: { sessionId: string; name: string },
    acknowledge: (result: LobbyActionResult) => void,
  ) => void;
  "lobby:join": (
    payload: { sessionId: string; name: string; code: string },
    acknowledge: (result: LobbyActionResult) => void,
  ) => void;
  "game:start": (acknowledge: (result: GameActionResult) => void) => void;
  "round:discard": (
    payload: { slotIndexes: number[] },
    acknowledge: (result: GameActionResult) => void,
  ) => void;
  "round:attack": (
    payload: { targetPlayerId: string | null },
    acknowledge: (result: GameActionResult) => void,
  ) => void;
  "battle:action": (
    payload: { action: ExchangeAction },
    acknowledge: (result: GameActionResult) => void,
  ) => void;
  "round:next": (acknowledge: (result: GameActionResult) => void) => void;
  "insight:share": (
    payload: { receiverPlayerId: string; targetPlayerId: string },
    acknowledge: (result: GameActionResult) => void,
  ) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  connectedAt: string;
  gameCode?: string;
  playerId?: string;
  sessionId?: string;
};
