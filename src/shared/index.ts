import type {
  EchoBand,
  ExchangeAction,
  FrequencyArc,
  GameStatus,
  InsightTransfer,
  Mado,
} from "./gameTypes.js";

export type AppPhase = "setup";

export type {
  Battle,
  EchoBand,
  FrequencyArc,
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
  ECHO_BANDS,
  FLEE_DAMAGE_MULTIPLIERS,
  FREQUENCY_COUNT,
  FULL_DAMAGE_DISTANCE,
  MADO_BASE_DAMAGE,
  MADO_TUNE_RANGE,
  MAX_FREQUENCY,
  MAX_MADOS,
  MIN_FREQUENCY,
  SHIELD_DRIFT_MAX,
  SHIELD_DRIFT_MIN,
  SHIELD_ROTATION_RANGE,
  STARTING_HEALTH,
  ZERO_DAMAGE_DISTANCE,
  applyEcho,
  calculateDamage,
  circularDistance,
  clampShieldRotation,
  createInitialInsight,
  dilateInsight,
  createMado,
  discardMados,
  fillEmptyMadoSlots,
  fleeMultiplierForRound,
  getEchoBand,
  isInsightNarrowed,
  mergeSharedInsight,
  normalizeFrequency,
  randomFrequency,
  randomShieldDrift,
  removeDeadPlayerInsights,
  resolveAttackDeclarations,
  resolveMadoHit,
  resolveScriptedBattle,
  toFrequencyArcs,
  tuneMado,
  tuneMadoFrequency,
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
  shieldDrift: number;
  madoSlots: Array<Mado | null>;
  discardedThisRound: number[];
  rotatingThisRound: boolean;
};

export type OpponentSnapshot = {
  id: string;
  name: string;
  alive: boolean;
  host: boolean;
  connected: boolean;
  insight: KnownShieldSnapshot;
  lastRotatedRound: number | null;
};

export type KnownShieldSnapshot = {
  arcs: FrequencyArc[];
  possibleCount: number;
  lastNarrowedRound: number | null;
};

// Rotating a shield is felt by every wizard, so it is public. The new frequency is not.
export type PublicShieldRotation = {
  roundNumber: number;
  playerId: string;
  playerName: string;
};

export type ShareableInsightSnapshot = KnownShieldSnapshot & {
  targetPlayerId: string;
  targetName: string;
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
  totalDamageTaken: number;
  lastExchange: LastExchangeSnapshot | null;
};

export type LastExchangeSnapshot = {
  index: number;
  damageTaken: number;
  // What your own Mado reported back, or null if you did not fire.
  echo: EchoBand | null;
  firedFrequency: number | null;
};

export type MadoTuning = {
  slotIndex: number;
  frequency: number;
};

export type PublicBattleHistoryEntry = {
  id: string;
  roundNumber: number;
  playerAName: string;
  playerBName: string;
  exchangeCount: number;
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
  shieldRotations: PublicShieldRotation[];
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
  "session:resume": (
    payload: { sessionId: string; code: string },
    acknowledge: (result: LobbyActionResult) => void,
  ) => void;
  "lobby:join": (
    payload: { sessionId: string; name: string; code: string },
    acknowledge: (result: LobbyActionResult) => void,
  ) => void;
  "game:start": (acknowledge: (result: GameActionResult) => void) => void;
  "round:discard": (
    payload: { slotIndexes: number[]; tuning?: MadoTuning | null },
    acknowledge: (result: GameActionResult) => void,
  ) => void;
  "round:attack": (
    payload: { targetPlayerId: string | null; rotation?: number | null },
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
