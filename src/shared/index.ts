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

export {
  DEFAULT_ROUND_MINUTES,
  PLANNING_SHARE,
  ROUND_BREAK_MS,
  ROUND_MINUTE_OPTIONS,
  clampRoundMinutes,
  roundDeadlines,
} from "./roundClock.js";

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

// A game is hosted either by one of the players or by a shared table screen. With a table
// screen no player is host: the screen starts the game and rounds advance on a timer.
export type LobbySnapshot = {
  code: string;
  status: "lobby";
  hostPlayerId: string | null;
  tableHosted: boolean;
  message: string;
  roundMinutes: number;
  currentPlayerId: string;
  players: LobbyPlayer[];
};

export type CurrentPlayerSnapshot = {
  id: string;
  name: string;
  // Join order. Picks the player's colour so it is the same on every screen.
  seat: number;
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
  seat: number;
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
  // Your own shots in this battle, oldest first, so the dial can mark every echo.
  shots: Array<{ frequency: number; echo: EchoBand }>;
  // Damage from each shot the opponent fired at you, oldest first. 0 is a miss.
  shotsTaken: number[];
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
  hostPlayerId: string | null;
  tableHosted: boolean;
  // Time left before the next round starts by itself.
  nextRoundInMs: number | null;
  roundMinutes: number;
  // Time left before the current deadline: the end of planning, or the end of the round.
  phaseEndsInMs: number | null;
  // Wizards who missed a deadline this round and follow standing orders for the rest of it.
  standingOrderPlayerIds: string[];
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

// What the shared table screen may show: nothing secret, only what every wizard can sense.
export type TablePlayer = {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  alive: boolean;
  // Done with the current phase: planned (prepared and declared), or finished fighting.
  ready: boolean;
  // Missed a deadline this round and follows standing orders.
  standingOrders: boolean;
};

export type TableBattle = RoundBattlePreview & {
  exchangeCount: number;
  finished: boolean;
};

export type TableSnapshot = {
  code: string;
  status: GameStatus;
  message: string;
  roundNumber: number;
  players: TablePlayer[];
  battles: TableBattle[];
  battleHistory: PublicBattleHistoryEntry[];
  shieldRotations: PublicShieldRotation[];
  winnerPlayerId: string | null;
  draw: boolean;
  nextRoundInMs: number | null;
  roundMinutes: number;
  phaseEndsInMs: number | null;
};

export type TableActionResult =
  | { ok: true; table: TableSnapshot }
  | { ok: false; error: string };

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
  "table:updated": (payload: TableSnapshot) => void;
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
  "lobby:roundMinutes": (
    payload: { minutes: number },
    acknowledge: (result: LobbyActionResult) => void,
  ) => void;
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
  "table:create": (
    payload: { sessionId: string },
    acknowledge: (result: TableActionResult) => void,
  ) => void;
  "table:resume": (
    payload: { sessionId: string; code: string },
    acknowledge: (result: TableActionResult) => void,
  ) => void;
  "table:message": (
    payload: { message: string },
    acknowledge: (result: TableActionResult) => void,
  ) => void;
  "table:start": (acknowledge: (result: TableActionResult) => void) => void;
  "table:roundMinutes": (
    payload: { minutes: number },
    acknowledge: (result: TableActionResult) => void,
  ) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  connectedAt: string;
  gameCode?: string;
  playerId?: string;
  sessionId?: string;
  // Set when this socket is a game's shared table screen rather than a player.
  tableCode?: string;
};
