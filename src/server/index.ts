import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  CurrentBattleSnapshot,
  Exchange,
  ExchangeAction,
  GameActionResult,
  GameSnapshot,
  InsightState,
  InterServerEvents,
  LobbyActionResult,
  LobbyPlayer,
  LastExchangeSnapshot,
  LobbySnapshot,
  MadoTuning,
  MatchmakingBattle,
  Player,
  PublicBattleHistoryEntry,
  PublicShieldRotation,
  RoundBattlePreview,
  ServerStatus,
  ServerToClientEvents,
  SocketData,
  TableActionResult,
  TableSnapshot,
} from "../shared/index.js";
import {
  SHIELD_DRIFT_MAX,
  SHIELD_ROTATION_RANGE,
  STARTING_HEALTH,
  applyEcho,
  clampShieldRotation,
  createInitialInsight,
  dilateInsight,
  discardMados,
  fillEmptyMadoSlots,
  fleeMultiplierForRound,
  isInsightNarrowed,
  mergeSharedInsight,
  normalizeFrequency,
  randomFrequency,
  randomShieldDrift,
  removeDeadPlayerInsights,
  resolveAttackDeclarations,
  resolveMadoHit,
  toFrequencyArcs,
  tuneMado,
} from "../shared/index.js";

const PORT = Number(process.env.PORT ?? 3001);
const allowedOrigins = [process.env.FRONTEND_URL, process.env.NETLIFY_URL]
  .filter((origin): origin is string => Boolean(origin))
  .flatMap((origin) => [origin, origin.replace(/^http:/, "https:")]);

const app = express();
const server = createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  },
});

type GameStatus = "lobby" | "round_prepare" | "attack_declaration" | "battle_resolution" | "round_cleanup" | "finished";

type ActiveBattle = {
  id: string;
  roundNumber: number;
  playerAId: string;
  playerBId: string;
  status: "active" | "finished";
  exchanges: Exchange[];
  actionsByPlayerId: Record<string, ExchangeAction>;
  fleeingPlayerIds: Set<string>;
  usedMadoSlotIndexesByPlayerId: Record<string, Set<number>>;
  healthByPlayerId: Record<string, number>;
};

type LobbyGame = {
  code: string;
  status: GameStatus;
  // Null when a shared table screen hosts the game instead of a player.
  hostPlayerId: string | null;
  tableSessionId: string | null;
  message: string;
  nextRoundAt: number | null;
  playersById: Map<string, LobbyPlayer>;
  roundNumber: number;
  gamePlayersById: Map<string, Player>;
  discardSubmittedPlayerIds: Set<string>;
  attackSubmittedPlayerIds: Set<string>;
  pendingBattles: MatchmakingBattle[];
  activeBattlesById: Map<string, ActiveBattle>;
  unmatchedAttackerIds: string[];
  winnerPlayerId: string | null;
  draw: boolean;
  battleHistory: PublicBattleHistoryEntry[];
  shieldRotations: PublicShieldRotation[];
};

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const gamesByCode = new Map<string, LobbyGame>();

function normalizeLobbyCode(code: string): string {
  return code.trim().replace(/\D/g, "").slice(0, 4);
}

function createLobbyCode(): string {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const code = Math.floor(1000 + Math.random() * 9000).toString();

    if (!gamesByCode.has(code)) {
      return code;
    }
  }

  throw new Error("Could not allocate lobby code");
}

function sanitizePlayerName(name: string): string {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return "Unnamed Wizard";
  }

  return trimmed.slice(0, 32);
}

function createLobbySnapshot(game: LobbyGame, currentPlayerId: string): LobbySnapshot {
  return {
    code: game.code,
    status: "lobby",
    hostPlayerId: game.hostPlayerId,
    tableHosted: isTableHosted(game),
    message: game.message,
    currentPlayerId,
    players: [...game.playersById.values()],
  };
}

function isTableHosted(game: LobbyGame) {
  return game.tableSessionId !== null;
}

function seatOf(game: LobbyGame, playerId: string) {
  return [...game.playersById.keys()].indexOf(playerId);
}

function nextRoundInMs(game: LobbyGame) {
  return game.nextRoundAt === null ? null : Math.max(0, game.nextRoundAt - Date.now());
}

function isReadyForPhase(game: LobbyGame, playerId: string) {
  if (game.status === "round_prepare") return game.discardSubmittedPlayerIds.has(playerId);
  if (game.status === "attack_declaration") return game.attackSubmittedPlayerIds.has(playerId);
  if (game.status === "battle_resolution") {
    return ![...game.activeBattlesById.values()].some(
      (battle) =>
        battle.status === "active" && (battle.playerAId === playerId || battle.playerBId === playerId),
    );
  }
  return false;
}

// Only what every wizard can sense: who is in the game, who fights whom, who has fallen.
function createTableSnapshot(game: LobbyGame): TableSnapshot {
  const showBattles = game.status === "battle_resolution" || game.status === "round_cleanup";

  return {
    code: game.code,
    status: game.status,
    message: game.message,
    roundNumber: game.roundNumber,
    players: [...game.playersById.values()].map((lobbyPlayer, seat) => {
      const alive = game.gamePlayersById.get(lobbyPlayer.id)?.alive ?? true;
      return {
        id: lobbyPlayer.id,
        name: lobbyPlayer.name,
        seat,
        connected: lobbyPlayer.connected,
        alive,
        ready: alive && isReadyForPhase(game, lobbyPlayer.id),
      };
    }),
    battles: showBattles
      ? [...game.activeBattlesById.values()].map((battle) => ({
          ...createRoundBattlePreview(game, battle),
          exchangeCount: battle.exchanges.length,
          finished: battle.status === "finished",
        }))
      : [],
    battleHistory: game.battleHistory,
    shieldRotations: game.shieldRotations,
    winnerPlayerId: game.winnerPlayerId,
    draw: game.draw,
    nextRoundInMs: nextRoundInMs(game),
  };
}

function createRoundBattlePreview(
  game: LobbyGame,
  battle: MatchmakingBattle,
): RoundBattlePreview {
  return {
    id: battle.id,
    playerAId: battle.playerAId,
    playerAName: game.playersById.get(battle.playerAId)?.name ?? "Unknown",
    playerBId: battle.playerBId,
    playerBName: game.playersById.get(battle.playerBId)?.name ?? "Unknown",
  };
}

function findCurrentBattle(game: LobbyGame, playerId: string): ActiveBattle | null {
  return (
    [...game.activeBattlesById.values()].find((battle) => {
      return battle.playerAId === playerId || battle.playerBId === playerId;
    }) ?? null
  );
}

function createCurrentBattleSnapshot(
  game: LobbyGame,
  currentPlayerId: string,
): CurrentBattleSnapshot | null {
  const battle = findCurrentBattle(game, currentPlayerId);

  if (!battle) {
    return null;
  }

  const preview = createRoundBattlePreview(game, battle);
  const opponentId =
    battle.playerAId === currentPlayerId ? battle.playerBId : battle.playerAId;
  const lastExchange = battle.exchanges.at(-1) ?? null;
  const totalDamageTaken = battle.exchanges.reduce(
    (total, exchange) => total + (exchange.damageByPlayerId[currentPlayerId] ?? 0),
    0,
  );

  return {
    ...preview,
    opponentId,
    opponentName: game.playersById.get(opponentId)?.name ?? "Unknown",
    status: battle.status,
    exchangeCount: battle.exchanges.length,
    waitingForPlayerIds: [battle.playerAId, battle.playerBId].filter(
      (playerId) =>
        battle.status === "active" &&
        !battle.fleeingPlayerIds.has(playerId) &&
        !battle.actionsByPlayerId[playerId],
    ),
    fleeingPlayerIds: [...battle.fleeingPlayerIds],
    usedMadoSlotIndexes: [
      ...(battle.usedMadoSlotIndexesByPlayerId[currentPlayerId] ?? new Set<number>()),
    ],
    totalDamageTaken,
    lastExchange: lastExchange ? createLastExchangeSnapshot(lastExchange, currentPlayerId) : null,
    shots: battle.exchanges.flatMap((exchange) => {
      const echo = exchange.echoByAttackerId[currentPlayerId];
      const frequency = exchange.firedFrequencyByPlayerId[currentPlayerId];
      return echo && frequency != null ? [{ frequency, echo }] : [];
    }),
  };
}

function createLastExchangeSnapshot(
  exchange: Exchange,
  currentPlayerId: string,
): LastExchangeSnapshot {
  return {
    index: exchange.index,
    damageTaken: exchange.damageByPlayerId[currentPlayerId] ?? 0,
    echo: exchange.echoByAttackerId[currentPlayerId] ?? null,
    firedFrequency: exchange.firedFrequencyByPlayerId[currentPlayerId] ?? null,
  };
}

function createKnownShieldSnapshot(insight: InsightState | undefined) {
  const candidates = insight?.candidates ?? createInitialInsight().candidates;

  return {
    arcs: toFrequencyArcs(candidates),
    possibleCount: candidates.length,
    lastNarrowedRound: insight?.lastNarrowedRound ?? null,
  };
}

function createGameSnapshot(game: LobbyGame, currentPlayerId: string): GameSnapshot {
  const currentPlayer = game.gamePlayersById.get(currentPlayerId);

  if (!currentPlayer || game.status === "lobby") {
    throw new Error("Cannot create game snapshot before game start");
  }

  return {
    code: game.code,
    status: game.status,
    roundNumber: game.roundNumber,
    hostPlayerId: game.hostPlayerId,
    tableHosted: isTableHosted(game),
    nextRoundInMs: nextRoundInMs(game),
    currentPlayer: {
      id: currentPlayer.id,
      name: currentPlayer.name,
      seat: seatOf(game, currentPlayer.id),
      health:
        findCurrentBattle(game, currentPlayerId)?.healthByPlayerId[currentPlayerId] ??
        currentPlayer.health,
      alive: currentPlayer.alive,
      shieldFrequency: currentPlayer.shieldFrequency,
      shieldDrift: currentPlayer.shieldDrift,
      madoSlots: currentPlayer.madoSlots,
      discardedThisRound: [...currentPlayer.discardedThisRound],
      rotatingThisRound: isRotating(currentPlayer),
    },
    opponents: [...game.playersById.values()]
      .filter((player) => player.id !== currentPlayerId)
      .map((player) => ({
        id: player.id,
        name: player.name,
        seat: seatOf(game, player.id),
        alive: game.gamePlayersById.get(player.id)?.alive ?? true,
        host: player.host,
        connected: player.connected,
        lastRotatedRound:
          game.shieldRotations.filter((rotation) => rotation.playerId === player.id).at(-1)
            ?.roundNumber ?? null,
        insight: createKnownShieldSnapshot(currentPlayer.insightsByTarget[player.id]),
      })),
    shareableInsights: Object.entries(currentPlayer.insightsByTarget)
      .filter(([, insight]) => isInsightNarrowed(insight))
      .map(([targetPlayerId, insight]) => ({
        ...createKnownShieldSnapshot(insight),
        targetPlayerId,
        targetName: game.playersById.get(targetPlayerId)?.name ?? "Unknown",
      })),
    receivedInsights: currentPlayer.receivedInsights,
    discardSubmittedPlayerIds: [...game.discardSubmittedPlayerIds],
    attackSubmittedPlayerIds: [...game.attackSubmittedPlayerIds],
    pendingBattles: game.pendingBattles.map((battle) =>
      createRoundBattlePreview(game, battle),
    ),
    currentBattle: createCurrentBattleSnapshot(game, currentPlayerId),
    battleHistory: game.battleHistory,
    shieldRotations: game.shieldRotations,
    unmatchedAttackerIds: game.unmatchedAttackerIds,
    winnerPlayerId: game.winnerPlayerId,
    draw: game.draw,
  };
}

// A player can briefly have more than one socket, for example when a phone reconnects
// before the server has noticed that the old connection died. Every one of them gets updates.
function socketsForPlayer(playerId: string): GameSocket[] {
  return [...io.sockets.sockets.values()].filter(
    (candidate) => candidate.data.playerId === playerId,
  );
}

function emitGameUpdate(game: LobbyGame) {
  if (isTableHosted(game)) {
    io.to(`table:${game.code}`).emit("table:updated", createTableSnapshot(game));
  }

  for (const player of game.playersById.values()) {
    for (const socket of socketsForPlayer(player.id)) {
      if (game.status === "lobby") {
        socket.emit("lobby:updated", createLobbySnapshot(game, player.id));
      } else {
        socket.emit("game:updated", createGameSnapshot(game, player.id));
      }
    }
  }
}

function attachSocketToPlayer(
  game: LobbyGame,
  socket: GameSocket,
  player: LobbyPlayer,
) {
  socket.data.gameCode = game.code;
  socket.data.playerId = player.id;
  socket.data.sessionId = player.sessionId;
  socket.join(`game:${game.code}`);
}

function findPlayerBySession(game: LobbyGame, sessionId: string) {
  return [...game.playersById.values()].find((player) => player.sessionId === sessionId);
}

function createGameForPlayer(
  socket: GameSocket,
  payload: { sessionId: string; name: string },
): LobbyActionResult {
  const code = createLobbyCode();
  const player: LobbyPlayer = {
    id: crypto.randomUUID(),
    sessionId: payload.sessionId,
    name: sanitizePlayerName(payload.name),
    host: true,
    connected: true,
  };
  const game: LobbyGame = {
    code,
    status: "lobby",
    hostPlayerId: player.id,
    tableSessionId: null,
    message: "",
    nextRoundAt: null,
    playersById: new Map([[player.id, player]]),
    roundNumber: 0,
    gamePlayersById: new Map(),
    discardSubmittedPlayerIds: new Set(),
    attackSubmittedPlayerIds: new Set(),
    pendingBattles: [],
    activeBattlesById: new Map(),
    unmatchedAttackerIds: [],
    winnerPlayerId: null,
    draw: false,
    battleHistory: [],
    shieldRotations: [],
  };

  gamesByCode.set(code, game);
  attachSocketToPlayer(game, socket, player);
  emitGameUpdate(game);

  return { ok: true, lobby: createLobbySnapshot(game, player.id) };
}

function joinGameForPlayer(
  socket: GameSocket,
  payload: { sessionId: string; name: string; code: string },
): LobbyActionResult {
  const code = normalizeLobbyCode(payload.code);
  const game = gamesByCode.get(code);

  if (!game) {
    return { ok: false, error: "No lobby found for that code." };
  }

  const existingPlayer = findPlayerBySession(game, payload.sessionId);

  if (game.status !== "lobby" && !existingPlayer) {
    return { ok: false, error: "That game has already started." };
  }

  const player =
    existingPlayer ??
    ({
      id: crypto.randomUUID(),
      sessionId: payload.sessionId,
      name: sanitizePlayerName(payload.name),
      host: false,
      connected: true,
    } satisfies LobbyPlayer);

  player.name = sanitizePlayerName(payload.name);
  player.connected = true;
  game.playersById.set(player.id, player);
  attachSocketToPlayer(game, socket, player);
  emitGameUpdate(game);

  if (game.status !== "lobby") {
    return { ok: true, game: createGameSnapshot(game, player.id) };
  }

  return { ok: true, lobby: createLobbySnapshot(game, player.id) };
}

// Reattaches a returning session (after a dropped connection or a page reload) without
// renaming the player or letting a new player into a started game.
function resumeSessionForPlayer(
  socket: GameSocket,
  payload: { sessionId: string; code: string },
): LobbyActionResult {
  const game = gamesByCode.get(normalizeLobbyCode(payload.code));
  const player = game ? findPlayerBySession(game, payload.sessionId) : undefined;

  if (!game || !player) {
    return { ok: false, error: "That game is no longer available." };
  }

  player.connected = true;
  attachSocketToPlayer(game, socket, player);
  emitGameUpdate(game);

  if (game.status !== "lobby") {
    return { ok: true, game: createGameSnapshot(game, player.id) };
  }

  return { ok: true, lobby: createLobbySnapshot(game, player.id) };
}

function getSocketGame(socket: GameSocket): LobbyGame | undefined {
  if (!socket.data.gameCode) {
    return undefined;
  }

  return gamesByCode.get(socket.data.gameCode);
}

function createPlayerFromLobbyPlayer(player: LobbyPlayer): Player {
  return {
    id: player.id,
    name: player.name,
    health: STARTING_HEALTH,
    alive: true,
    shieldFrequency: randomFrequency(),
    shieldDrift: randomShieldDrift(),
    madoSlots: fillEmptyMadoSlots([], (slotIndex) => {
      return `p-${player.id}-r-1-s-${slotIndex}-${crypto.randomUUID()}`;
    }),
    discardedThisRound: new Set(),
    insightsByTarget: {},
    receivedInsights: [],
  };
}

function startGame(socket: GameSocket): GameActionResult {
  const game = getSocketGame(socket);
  const playerId = socket.data.playerId;

  if (!game || !playerId) {
    return { ok: false, error: "You are not in a lobby." };
  }

  if (game.hostPlayerId !== playerId) {
    return { ok: false, error: "Only the host can start the game." };
  }

  if (game.status !== "lobby") {
    return { ok: false, error: "The game has already started." };
  }

  if (game.playersById.size < 2) {
    return { ok: false, error: "At least two players are required." };
  }

  beginGame(game);
  return { ok: true, game: createGameSnapshot(game, playerId) };
}

function beginGame(game: LobbyGame) {
  game.status = "round_prepare";
  game.roundNumber = 1;
  game.gamePlayersById = new Map(
    [...game.playersById.values()].map((player) => [
      player.id,
      createPlayerFromLobbyPlayer(player),
    ]),
  );
  game.discardSubmittedPlayerIds = new Set();
  game.attackSubmittedPlayerIds = new Set();
  game.pendingBattles = [];
  game.activeBattlesById = new Map();
  game.unmatchedAttackerIds = [];
  game.winnerPlayerId = null;
  game.draw = false;
  game.battleHistory = [];
  game.shieldRotations = [];

  for (const player of game.gamePlayersById.values()) {
    player.insightsByTarget = Object.fromEntries(
      [...game.gamePlayersById.values()]
        .filter((target) => target.id !== player.id)
        .map((target) => [target.id, createInitialInsight()]),
    );
  }

  emitGameUpdate(game);
}

function livingPlayerIds(game: LobbyGame): string[] {
  return [...game.gamePlayersById.values()]
    .filter((player) => player.alive)
    .map((player) => player.id);
}

function createActiveBattle(game: LobbyGame, battle: MatchmakingBattle): ActiveBattle {
  const playerA = game.gamePlayersById.get(battle.playerAId)!;
  const playerB = game.gamePlayersById.get(battle.playerBId)!;

  return {
    id: battle.id,
    roundNumber: game.roundNumber,
    playerAId: battle.playerAId,
    playerBId: battle.playerBId,
    status: "active",
    exchanges: [],
    actionsByPlayerId: {},
    // A wizard who is rotating their shield cannot fire back, only flee.
    fleeingPlayerIds: new Set(
      [playerA, playerB].filter((player) => isRotating(player)).map((player) => player.id),
    ),
    usedMadoSlotIndexesByPlayerId: {
      [battle.playerAId]: new Set<number>(),
      [battle.playerBId]: new Set<number>(),
    },
    healthByPlayerId: {
      [battle.playerAId]: playerA.health,
      [battle.playerBId]: playerB.health,
    },
  };
}

function getBattleOpponentId(battle: ActiveBattle, playerId: string): string {
  return battle.playerAId === playerId ? battle.playerBId : battle.playerAId;
}

function firstAvailableMadoSlot(player: Player, usedSlots: Set<number>): number {
  return player.madoSlots.findIndex(
    (mado, index) => mado !== null && !usedSlots.has(index),
  );
}

function normalizeBattleAction(
  battle: ActiveBattle,
  player: Player,
  requestedAction: ExchangeAction,
): ExchangeAction {
  if (battle.fleeingPlayerIds.has(player.id)) {
    return { type: "flee" };
  }

  const usedSlots = battle.usedMadoSlotIndexesByPlayerId[player.id] ?? new Set<number>();
  const firstAvailableSlot = firstAvailableMadoSlot(player, usedSlots);
  const isFirstExchange = battle.exchanges.length === 0;

  if (firstAvailableSlot === -1) {
    return { type: "flee" };
  }

  if (requestedAction.type === "mado") {
    const mado = player.madoSlots[requestedAction.madoSlotIndex];

    if (mado && !usedSlots.has(requestedAction.madoSlotIndex)) {
      return {
        type: "mado",
        madoSlotIndex: requestedAction.madoSlotIndex,
        madoId: mado.id,
      };
    }
  }

  if (requestedAction.type === "end") {
    const opponentId = getBattleOpponentId(battle, player.id);

    return battle.fleeingPlayerIds.has(opponentId) ? requestedAction : { type: "flee" };
  }

  if (!isFirstExchange && requestedAction.type !== "mado") {
    return requestedAction;
  }

  return {
    type: "mado",
    madoSlotIndex: firstAvailableSlot,
    madoId: player.madoSlots[firstAvailableSlot]!.id,
  };
}

function bothPlayersHaveNoMados(game: LobbyGame, battle: ActiveBattle): boolean {
  const playerA = game.gamePlayersById.get(battle.playerAId)!;
  const playerB = game.gamePlayersById.get(battle.playerBId)!;

  return (
    firstAvailableMadoSlot(playerA, battle.usedMadoSlotIndexesByPlayerId[playerA.id]!) ===
      -1 &&
    firstAvailableMadoSlot(playerB, battle.usedMadoSlotIndexesByPlayerId[playerB.id]!) ===
      -1
  );
}

function countFleeRoundsForPlayer(battle: ActiveBattle, playerId: string): number {
  return battle.exchanges.filter((exchange) => {
    return exchange.fleeingPlayerIdsAfterExchange.includes(playerId);
  }).length;
}

function resolveReadyBattleExchange(game: LobbyGame, battle: ActiveBattle) {
  const playerA = game.gamePlayersById.get(battle.playerAId)!;
  const playerB = game.gamePlayersById.get(battle.playerBId)!;

  if (battle.exchanges.length === 0 && bothPlayersHaveNoMados(game, battle)) {
    battle.status = "finished";
    return;
  }

  const playerAOutOfMados =
    firstAvailableMadoSlot(playerA, battle.usedMadoSlotIndexesByPlayerId[playerA.id]!) === -1;
  const playerBOutOfMados =
    firstAvailableMadoSlot(playerB, battle.usedMadoSlotIndexesByPlayerId[playerB.id]!) === -1;
  const hasActionA =
    battle.fleeingPlayerIds.has(playerA.id) ||
    playerAOutOfMados ||
    battle.actionsByPlayerId[playerA.id];
  const hasActionB =
    battle.fleeingPlayerIds.has(playerB.id) ||
    playerBOutOfMados ||
    battle.actionsByPlayerId[playerB.id];

  if (!hasActionA || !hasActionB) {
    return;
  }

  const actionA = normalizeBattleAction(
    battle,
    playerA,
    battle.actionsByPlayerId[playerA.id] ?? { type: "flee" },
  );
  const actionB = normalizeBattleAction(
    battle,
    playerB,
    battle.actionsByPlayerId[playerB.id] ?? { type: "flee" },
  );

  if (actionA.type === "flee") {
    battle.fleeingPlayerIds.add(playerA.id);
  }

  if (actionB.type === "flee") {
    battle.fleeingPlayerIds.add(playerB.id);
  }

  const damageByPlayerId: Record<string, number> = {
    [playerA.id]: 0,
    [playerB.id]: 0,
  };
  const echoByAttackerId: Exchange["echoByAttackerId"] = {
    [playerA.id]: null,
    [playerB.id]: null,
  };
  const firedFrequencyByPlayerId: Exchange["firedFrequencyByPlayerId"] = {
    [playerA.id]: null,
    [playerB.id]: null,
  };
  const usedThisExchange: Record<string, number[]> = {
    [playerA.id]: [],
    [playerB.id]: [],
  };

  for (const [attacker, defender, action] of [
    [playerA, playerB, actionA],
    [playerB, playerA, actionB],
  ] as const) {
    if (action.type !== "mado") {
      continue;
    }

    const mado = attacker.madoSlots[action.madoSlotIndex]!;
    const defenderFleeing = battle.fleeingPlayerIds.has(defender.id);
    const fleeRoundIndex = Math.max(0, countFleeRoundsForPlayer(battle, defender.id));
    const fleeMultiplier = defenderFleeing ? fleeMultiplierForRound(fleeRoundIndex) : 1;
    const hit = resolveMadoHit(mado.frequency, defender.shieldFrequency, fleeMultiplier);

    damageByPlayerId[defender.id] = hit.damage;
    echoByAttackerId[attacker.id] = hit.echo;
    firedFrequencyByPlayerId[attacker.id] = mado.frequency;
    attacker.insightsByTarget[defender.id] = applyEcho(
      attacker.insightsByTarget[defender.id],
      mado.frequency,
      hit.echo,
      game.roundNumber,
    );
    battle.usedMadoSlotIndexesByPlayerId[attacker.id]!.add(action.madoSlotIndex);
    usedThisExchange[attacker.id]!.push(action.madoSlotIndex);
  }

  battle.healthByPlayerId[playerA.id] -= damageByPlayerId[playerA.id]!;
  battle.healthByPlayerId[playerB.id] -= damageByPlayerId[playerB.id]!;

  battle.exchanges.push({
    index: battle.exchanges.length,
    actionsByPlayerId: {
      [playerA.id]: actionA,
      [playerB.id]: actionB,
    },
    damageByPlayerId,
    echoByAttackerId,
    firedFrequencyByPlayerId,
    fleeingPlayerIdsAfterExchange: [...battle.fleeingPlayerIds],
    usedMadoSlotIndexesByPlayerId: usedThisExchange,
  });
  battle.actionsByPlayerId = {};

  const playerAHasMados =
    firstAvailableMadoSlot(playerA, battle.usedMadoSlotIndexesByPlayerId[playerA.id]!) !== -1;
  const playerBHasMados =
    firstAvailableMadoSlot(playerB, battle.usedMadoSlotIndexesByPlayerId[playerB.id]!) !== -1;
  const bothEnded = actionA.type === "end" && actionB.type === "end";
  const someoneDied =
    battle.healthByPlayerId[playerA.id]! <= 0 || battle.healthByPlayerId[playerB.id]! <= 0;
  const bothFleeing =
    battle.fleeingPlayerIds.has(playerA.id) && battle.fleeingPlayerIds.has(playerB.id);
  const oneEndedWhileOtherFlees =
    (actionA.type === "end" && battle.fleeingPlayerIds.has(playerB.id)) ||
    (actionB.type === "end" && battle.fleeingPlayerIds.has(playerA.id));
  const bothOutOfMados = !playerAHasMados && !playerBHasMados;
  const oneOutWhileOtherFlees =
    (!playerAHasMados && battle.fleeingPlayerIds.has(playerB.id)) ||
    (!playerBHasMados && battle.fleeingPlayerIds.has(playerA.id));

  if (
    bothEnded ||
    someoneDied ||
    bothFleeing ||
    oneEndedWhileOtherFlees ||
    bothOutOfMados ||
    oneOutWhileOtherFlees
  ) {
    battle.status = "finished";
  }
}

function startNextRound(socket: GameSocket): GameActionResult {
  const game = getSocketGame(socket);
  const playerId = socket.data.playerId;

  if (!game || !playerId || game.status !== "round_cleanup") {
    return { ok: false, error: "Next round is not available right now." };
  }

  if (game.hostPlayerId !== playerId) {
    return { ok: false, error: "Only the host can start the next round." };
  }

  advanceRound(game);
  return { ok: true, game: createGameSnapshot(game, playerId) };
}

function advanceRound(game: LobbyGame) {
  clearRoundTimer(game);
  game.roundNumber += 1;
  game.status = "round_prepare";
  driftShields(game);
  game.discardSubmittedPlayerIds = new Set();
  game.attackSubmittedPlayerIds = new Set();
  game.pendingBattles = [];
  game.activeBattlesById = new Map();
  game.unmatchedAttackerIds = [];

  for (const player of game.gamePlayersById.values()) {
    if (!player.alive) {
      continue;
    }

    player.madoSlots = fillEmptyMadoSlots(player.madoSlots, (slotIndex) => {
      return `p-${player.id}-r-${game.roundNumber}-s-${slotIndex}-${crypto.randomUUID()}`;
    });
    player.discardedThisRound = new Set();
    player.attackIntent = undefined;
  }

  emitGameUpdate(game);
}

function commitFinishedRoundIfReady(game: LobbyGame) {
  if (
    game.status !== "battle_resolution" ||
    [...game.activeBattlesById.values()].some((battle) => battle.status !== "finished")
  ) {
    return;
  }

  for (const battle of game.activeBattlesById.values()) {
    for (const playerId of [battle.playerAId, battle.playerBId]) {
      const player = game.gamePlayersById.get(playerId)!;
      player.health = battle.healthByPlayerId[playerId]!;
      player.alive = player.health > 0;
      player.madoSlots = player.madoSlots.map((mado, slotIndex) =>
        battle.usedMadoSlotIndexesByPlayerId[playerId]?.has(slotIndex) ? null : mado,
      );
    }

    game.battleHistory.push({
      id: battle.id,
      roundNumber: battle.roundNumber,
      playerAName: game.playersById.get(battle.playerAId)?.name ?? "Unknown",
      playerBName: game.playersById.get(battle.playerBId)?.name ?? "Unknown",
      exchangeCount: battle.exchanges.length,
      deaths: [battle.playerAId, battle.playerBId].filter(
        (playerId) => battle.healthByPlayerId[playerId]! <= 0,
      ),
    });
  }

  applyShieldRotations(game);

  const cleanedPlayers = removeDeadPlayerInsights([...game.gamePlayersById.values()]);
  game.gamePlayersById = new Map(cleanedPlayers.map((player) => [player.id, player]));

  const livingIds = livingPlayerIds(game);
  game.winnerPlayerId = livingIds.length === 1 ? livingIds[0]! : null;
  game.draw = livingIds.length === 0;
  game.status = livingIds.length <= 1 ? "finished" : "round_cleanup";
  scheduleNextRound(game);
}

function submitBattleAction(
  socket: GameSocket,
  payload: { action: ExchangeAction },
): GameActionResult {
  const game = getSocketGame(socket);
  const playerId = socket.data.playerId;

  if (!game || !playerId || game.status !== "battle_resolution") {
    return { ok: false, error: "No active battle found." };
  }

  const battle = findCurrentBattle(game, playerId);

  if (!battle || battle.status !== "active") {
    return { ok: false, error: "You are not in an active battle." };
  }

  const player = game.gamePlayersById.get(playerId);

  if (!player || !player.alive) {
    return { ok: false, error: "Only living players can act in battle." };
  }

  battle.actionsByPlayerId[playerId] = normalizeBattleAction(
    battle,
    player,
    payload.action,
  );
  resolveReadyBattleExchange(game, battle);
  commitFinishedRoundIfReady(game);
  emitGameUpdate(game);

  return { ok: true, game: createGameSnapshot(game, playerId) };
}

function shareInsight(
  socket: GameSocket,
  payload: { receiverPlayerId: string; targetPlayerId: string },
): GameActionResult {
  const game = getSocketGame(socket);
  const senderId = socket.data.playerId;

  if (!game || !senderId || game.status === "lobby") {
    return { ok: false, error: "No active game found." };
  }

  if (game.status === "battle_resolution" && findCurrentBattle(game, senderId)?.status === "active") {
    return { ok: false, error: "You cannot share insight during an active battle." };
  }

  const sender = game.gamePlayersById.get(senderId);
  const receiver = game.gamePlayersById.get(payload.receiverPlayerId);
  const target = game.gamePlayersById.get(payload.targetPlayerId);

  if (!sender || !receiver || !target) {
    return { ok: false, error: "Invalid insight share." };
  }

  if (!sender.alive || !receiver.alive || !target.alive) {
    return { ok: false, error: "Only living players and living targets can share insight." };
  }

  if (receiver.id === sender.id || target.id === sender.id || target.id === receiver.id) {
    return { ok: false, error: "Choose another player and a separate target." };
  }

  const senderInsight = sender.insightsByTarget[target.id];

  if (!senderInsight || !isInsightNarrowed(senderInsight)) {
    return { ok: false, error: "You do not have insight to share about that target." };
  }

  receiver.insightsByTarget[target.id] = mergeSharedInsight(
    receiver.insightsByTarget[target.id],
    senderInsight,
    game.roundNumber,
  );

  const transfer = {
    fromPlayerId: sender.id,
    targetPlayerId: target.id,
    ...createKnownShieldSnapshot(senderInsight),
    roundNumber: game.roundNumber,
  };
  receiver.receivedInsights.push(transfer);
  sender.receivedInsights.push(transfer);

  emitGameUpdate(game);
  return { ok: true, game: createGameSnapshot(game, sender.id) };
}

function submitDiscards(
  socket: GameSocket,
  payload: { slotIndexes: number[]; tuning?: MadoTuning | null },
): GameActionResult {
  const game = getSocketGame(socket);
  const playerId = socket.data.playerId;

  if (!game || !playerId || game.status === "lobby") {
    return { ok: false, error: "No active game found." };
  }

  if (game.status !== "round_prepare") {
    return { ok: false, error: "Discarding is not available in this phase." };
  }

  if (game.discardSubmittedPlayerIds.has(playerId)) {
    return { ok: false, error: "You have already prepared your Mados this round." };
  }

  const player = game.gamePlayersById.get(playerId);

  if (!player || !player.alive) {
    return { ok: false, error: "Only living players can discard Mados." };
  }

  const slotIndexes = [...new Set(payload.slotIndexes)]
    .filter((slotIndex) => Number.isInteger(slotIndex))
    .filter((slotIndex) => slotIndex >= 0 && slotIndex < player.madoSlots.length);
  const tuning = payload.tuning ?? null;

  if (tuning) {
    const validTuning =
      Number.isInteger(tuning.slotIndex) &&
      Number.isFinite(tuning.frequency) &&
      player.madoSlots[tuning.slotIndex] != null &&
      !slotIndexes.includes(tuning.slotIndex);

    if (!validTuning) {
      return { ok: false, error: "Choose a Mado you keep to tune." };
    }
  }

  const tunedPlayer = tuning ? tuneMado(player, tuning.slotIndex, tuning.frequency) : player;
  game.gamePlayersById.set(playerId, discardMados(tunedPlayer, slotIndexes));
  game.discardSubmittedPlayerIds.add(playerId);

  if (livingPlayerIds(game).every((id) => game.discardSubmittedPlayerIds.has(id))) {
    game.status = "attack_declaration";
  }

  emitGameUpdate(game);
  return { ok: true, game: createGameSnapshot(game, playerId) };
}

function isRotating(player: Player): boolean {
  return player.attackIntent !== undefined && "rotate" in player.attackIntent;
}

function driftShields(game: LobbyGame) {
  for (const player of game.gamePlayersById.values()) {
    if (player.alive) {
      player.shieldFrequency = normalizeFrequency(player.shieldFrequency + player.shieldDrift);
    }

    for (const [targetId, insight] of Object.entries(player.insightsByTarget)) {
      player.insightsByTarget[targetId] = dilateInsight(insight, SHIELD_DRIFT_MAX);
    }
  }
}

function applyShieldRotations(game: LobbyGame) {
  for (const rotator of game.gamePlayersById.values()) {
    if (!rotator.alive || !rotator.attackIntent || !("rotate" in rotator.attackIntent)) {
      continue;
    }

    rotator.shieldFrequency = normalizeFrequency(
      rotator.shieldFrequency + rotator.attackIntent.rotate.delta,
    );
    // Rotating also resets the drift, so a tracked drift direction is lost too.
    rotator.shieldDrift = randomShieldDrift();
    game.shieldRotations.push({
      roundNumber: game.roundNumber,
      playerId: rotator.id,
      playerName: rotator.name,
    });

    for (const observer of game.gamePlayersById.values()) {
      const insight = observer.insightsByTarget[rotator.id];

      if (observer.id !== rotator.id && insight) {
        observer.insightsByTarget[rotator.id] = dilateInsight(insight, SHIELD_ROTATION_RANGE);
      }
    }
  }
}

function submitAttack(
  socket: GameSocket,
  payload: { targetPlayerId: string | null; rotation?: number | null },
): GameActionResult {
  const game = getSocketGame(socket);
  const playerId = socket.data.playerId;

  if (!game || !playerId || game.status === "lobby") {
    return { ok: false, error: "No active game found." };
  }

  if (game.status !== "attack_declaration") {
    return { ok: false, error: "Attacking is not available in this phase." };
  }

  const player = game.gamePlayersById.get(playerId);

  if (!player || !player.alive) {
    return { ok: false, error: "Only living players can choose attacks." };
  }

  const target = payload.targetPlayerId
    ? game.gamePlayersById.get(payload.targetPlayerId)
    : null;

  if (payload.targetPlayerId && (!target || !target.alive || target.id === playerId)) {
    return { ok: false, error: "Choose a living opponent or pass." };
  }

  const rotation = payload.rotation ?? null;

  if (rotation !== null && (target || !Number.isFinite(rotation))) {
    return { ok: false, error: "Rotate your shield or attack, not both." };
  }

  player.attackIntent =
    rotation !== null
      ? { rotate: { delta: clampShieldRotation(rotation) } }
      : target
        ? { targetPlayerId: target.id }
        : { pass: true };
  game.attackSubmittedPlayerIds.add(playerId);

  if (livingPlayerIds(game).every((id) => game.attackSubmittedPlayerIds.has(id))) {
    const matchmaking = resolveAttackDeclarations([...game.gamePlayersById.values()]);
    game.pendingBattles = matchmaking.battles;
    game.activeBattlesById = new Map(
      matchmaking.battles.map((battle) => [
        battle.id,
        createActiveBattle(game, battle),
      ]),
    );
    game.unmatchedAttackerIds = matchmaking.unmatchedAttackerIds;
    game.status = matchmaking.battles.length > 0 ? "battle_resolution" : "round_cleanup";

    if (game.status === "round_cleanup") {
      applyShieldRotations(game);
      scheduleNextRound(game);
    }
  }

  emitGameUpdate(game);
  return { ok: true, game: createGameSnapshot(game, playerId) };
}

// A table-hosted game has nobody at the screen between rounds, so rounds advance on a timer.
const ROUND_BREAK_MS = 12_000;
const MESSAGE_MAX_LENGTH = 280;
const roundTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearRoundTimer(game: LobbyGame) {
  const timer = roundTimers.get(game.code);

  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(game.code);
  }

  game.nextRoundAt = null;
}

function scheduleNextRound(game: LobbyGame) {
  if (!isTableHosted(game) || game.status !== "round_cleanup") {
    return;
  }

  clearRoundTimer(game);
  game.nextRoundAt = Date.now() + ROUND_BREAK_MS;
  roundTimers.set(
    game.code,
    setTimeout(() => {
      if (game.status === "round_cleanup") {
        advanceRound(game);
      }
    }, ROUND_BREAK_MS),
  );
}

function getTableGame(socket: GameSocket) {
  return socket.data.tableCode ? gamesByCode.get(socket.data.tableCode) : undefined;
}

function attachSocketToTable(game: LobbyGame, socket: GameSocket) {
  socket.data.tableCode = game.code;
  socket.data.sessionId = game.tableSessionId ?? undefined;
  socket.join(`table:${game.code}`);
}

function createTableGame(socket: GameSocket, payload: { sessionId: string }): TableActionResult {
  const game: LobbyGame = {
    code: createLobbyCode(),
    status: "lobby",
    hostPlayerId: null,
    tableSessionId: payload.sessionId,
    message: "",
    nextRoundAt: null,
    playersById: new Map(),
    roundNumber: 0,
    gamePlayersById: new Map(),
    discardSubmittedPlayerIds: new Set(),
    attackSubmittedPlayerIds: new Set(),
    pendingBattles: [],
    activeBattlesById: new Map(),
    unmatchedAttackerIds: [],
    winnerPlayerId: null,
    draw: false,
    battleHistory: [],
    shieldRotations: [],
  };

  gamesByCode.set(game.code, game);
  attachSocketToTable(game, socket);
  return { ok: true, table: createTableSnapshot(game) };
}

function resumeTable(socket: GameSocket, payload: { sessionId: string; code: string }): TableActionResult {
  const game = gamesByCode.get(normalizeLobbyCode(payload.code));

  if (!game || game.tableSessionId !== payload.sessionId) {
    return { ok: false, error: "That table is no longer available." };
  }

  attachSocketToTable(game, socket);
  return { ok: true, table: createTableSnapshot(game) };
}

function setTableMessage(socket: GameSocket, payload: { message: string }): TableActionResult {
  const game = getTableGame(socket);

  if (!game) {
    return { ok: false, error: "This screen is not hosting a game." };
  }

  if (game.status !== "lobby") {
    return { ok: false, error: "The message can only be changed before the game starts." };
  }

  game.message = String(payload.message ?? "").trim().slice(0, MESSAGE_MAX_LENGTH);
  emitGameUpdate(game);
  return { ok: true, table: createTableSnapshot(game) };
}

function startTableGame(socket: GameSocket): TableActionResult {
  const game = getTableGame(socket);

  if (!game) {
    return { ok: false, error: "This screen is not hosting a game." };
  }

  if (game.status !== "lobby") {
    return { ok: false, error: "The game has already started." };
  }

  if (game.playersById.size < 2) {
    return { ok: false, error: "At least two players are required." };
  }

  beginGame(game);
  return { ok: true, table: createTableSnapshot(game) };
}

function getServerStatus(): ServerStatus {
  return {
    ok: true,
    service: "violent-wizards-server",
    connectedClients: io.engine.clientsCount,
  };
}

app.get("/api/health", (_request, response) => {
  response.json(getServerStatus());
});

io.on("connection", (socket) => {
  socket.data.connectedAt = new Date().toISOString();

  socket.emit("server:handshake", {
    socketId: socket.id,
    serverTime: socket.data.connectedAt,
  });
  io.emit("server:status", getServerStatus());

  socket.on("client:ping", (acknowledge) => {
    acknowledge({
      socketId: socket.id,
      serverTime: new Date().toISOString(),
    });
  });

  socket.on("lobby:create", (payload, acknowledge) => {
    acknowledge(createGameForPlayer(socket, payload));
  });

  socket.on("session:resume", (payload, acknowledge) => {
    acknowledge(resumeSessionForPlayer(socket, payload));
  });

  socket.on("lobby:join", (payload, acknowledge) => {
    acknowledge(joinGameForPlayer(socket, payload));
  });

  socket.on("game:start", (acknowledge) => {
    acknowledge(startGame(socket));
  });

  socket.on("round:discard", (payload, acknowledge) => {
    acknowledge(submitDiscards(socket, payload));
  });

  socket.on("round:attack", (payload, acknowledge) => {
    acknowledge(submitAttack(socket, payload));
  });

  socket.on("battle:action", (payload, acknowledge) => {
    acknowledge(submitBattleAction(socket, payload));
  });

  socket.on("round:next", (acknowledge) => {
    acknowledge(startNextRound(socket));
  });

  socket.on("table:create", (payload, acknowledge) => {
    acknowledge(createTableGame(socket, payload));
  });

  socket.on("table:resume", (payload, acknowledge) => {
    acknowledge(resumeTable(socket, payload));
  });

  socket.on("table:message", (payload, acknowledge) => {
    acknowledge(setTableMessage(socket, payload));
  });

  socket.on("table:start", (acknowledge) => {
    acknowledge(startTableGame(socket));
  });

  socket.on("insight:share", (payload, acknowledge) => {
    acknowledge(shareInsight(socket, payload));
  });

  socket.on("disconnect", () => {
    if (socket.data.gameCode && socket.data.playerId) {
      const game = gamesByCode.get(socket.data.gameCode);
      const player = game?.playersById.get(socket.data.playerId);

      if (game && player && socketsForPlayer(player.id).length === 0) {
        player.connected = false;
        emitGameUpdate(game);
      }
    }

    io.emit("server:status", getServerStatus());
  });
});

server.listen(PORT, () => {
  console.log(`Violent Wizards server listening on http://localhost:${PORT}`);
});
