import type {
  Exchange,
  ExchangeAction,
  FrequencySegment,
  InsightState,
  Mado,
  MatchmakingResult,
  Player,
  ScriptedBattleResult,
} from "./gameTypes.js";

export const MAX_MADOS = 5;
export const STARTING_HEALTH = 100;
export const MADO_BASE_DAMAGE = 25;
export const MIN_FREQUENCY = 0;
export const MAX_FREQUENCY = 359;
export const INSIGHT_NOISE_MIN = 0.75;
export const INSIGHT_NOISE_MAX = 1.25;
export const INSIGHT_THRESHOLDS = [10, 25, 45, 70, 100] as const;
export const INSIGHT_SEGMENT_COUNTS = [1, 2, 4, 8, 16, 32] as const;
export const FLEE_DAMAGE_MULTIPLIERS = [0.5, 0.4, 0.3, 0.2, 0.1] as const;

export function normalizeFrequency(frequency: number): number {
  const normalized = frequency % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function randomFrequency(random = Math.random): number {
  return Math.floor(random() * (MAX_FREQUENCY + 1));
}

export function circularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeFrequency(a) - normalizeFrequency(b));
  return Math.min(diff, 360 - diff);
}

export function calculateDamage(
  madoFrequency: number,
  shieldFrequency: number,
  fleeMultiplier = 1,
): number {
  const distance = circularDistance(madoFrequency, shieldFrequency);
  const match = 1 - distance / 180;
  return MADO_BASE_DAMAGE * match * fleeMultiplier;
}

export function getInsightLevel(points: number): number {
  let level = 0;

  for (const threshold of INSIGHT_THRESHOLDS) {
    if (points >= threshold) {
      level += 1;
    }
  }

  return level;
}

export function getInsightMinimumPoints(level: number): number {
  if (level <= 0) {
    return 0;
  }

  return INSIGHT_THRESHOLDS[level - 1] ?? INSIGHT_THRESHOLDS.at(-1)!;
}

export function getInsightSegment(
  shieldFrequency: number,
  level: number,
): FrequencySegment {
  const boundedLevel = Math.max(0, Math.min(level, INSIGHT_SEGMENT_COUNTS.length - 1));
  const segmentCount = INSIGHT_SEGMENT_COUNTS[boundedLevel];
  const segmentWidth = 360 / segmentCount;
  const index = Math.min(
    segmentCount - 1,
    Math.floor(normalizeFrequency(shieldFrequency) / segmentWidth),
  );

  return {
    level: boundedLevel,
    index,
    start: index * segmentWidth,
    end: (index + 1) * segmentWidth,
  };
}

export function createInitialInsight(shieldFrequency: number): InsightState {
  return {
    points: 0,
    level: 0,
    segment: getInsightSegment(shieldFrequency, 0),
  };
}

export function addInsightFromDamage(
  current: InsightState | undefined,
  shieldFrequency: number,
  actualDamage: number,
  random = Math.random,
): InsightState {
  const existing = current ?? createInitialInsight(shieldFrequency);
  const noise =
    INSIGHT_NOISE_MIN + random() * (INSIGHT_NOISE_MAX - INSIGHT_NOISE_MIN);
  const points = existing.points + Math.max(0, actualDamage) * noise;
  const level = getInsightLevel(points);

  return {
    points,
    level,
    segment: getInsightSegment(shieldFrequency, level),
  };
}

export function applySharedInsight(
  receiverCurrent: InsightState | undefined,
  targetShieldFrequency: number,
  sharedLevel: number,
): InsightState {
  const current = receiverCurrent ?? createInitialInsight(targetShieldFrequency);

  if (current.level > sharedLevel) {
    return current;
  }

  const level = Math.max(current.level, sharedLevel);
  const points = Math.max(current.points, getInsightMinimumPoints(level));

  return {
    points,
    level,
    segment: getInsightSegment(targetShieldFrequency, level),
  };
}

export function createMado(id: string, random = Math.random): Mado {
  return {
    id,
    frequency: randomFrequency(random),
    baseDamage: MADO_BASE_DAMAGE,
  };
}

export function fillEmptyMadoSlots(
  slots: Array<Mado | null>,
  createId: (slotIndex: number) => string,
  random = Math.random,
): Array<Mado | null> {
  return Array.from({ length: MAX_MADOS }, (_, index) => {
    return slots[index] ?? createMado(createId(index), random);
  });
}

export function discardMados(player: Player, slotIndexes: number[]): Player {
  const slotIndexSet = new Set(slotIndexes);

  return {
    ...player,
    madoSlots: player.madoSlots.map((mado, index) =>
      slotIndexSet.has(index) ? null : mado,
    ),
    discardedThisRound: new Set([...player.discardedThisRound, ...slotIndexes]),
  };
}

export function resolveAttackDeclarations(
  players: Player[],
  random = Math.random,
): MatchmakingResult {
  const alivePlayerIds = new Set(
    players.filter((player) => player.alive).map((player) => player.id),
  );
  const attacks = players
    .filter((player) => {
      return (
        player.alive &&
        player.attackIntent !== undefined &&
        "targetPlayerId" in player.attackIntent &&
        alivePlayerIds.has(player.attackIntent.targetPlayerId) &&
        player.attackIntent.targetPlayerId !== player.id
      );
    })
    .map((player) => ({
      attackerId: player.id,
      targetId: (player.attackIntent as { targetPlayerId: string }).targetPlayerId,
    }));
  const spentAttackPlayerIds = attacks.map((attack) => attack.attackerId);
  const consumedPlayerIds = new Set<string>();
  const matchedAttackers = new Set<string>();
  const unmatchedAttackerIds = new Set<string>();
  const battles: MatchmakingResult["battles"] = [];

  for (const attack of attacks) {
    if (consumedPlayerIds.has(attack.attackerId)) {
      continue;
    }

    const reciprocal = attacks.find((candidate) => {
      return (
        candidate.attackerId === attack.targetId &&
        candidate.targetId === attack.attackerId
      );
    });

    if (!reciprocal || consumedPlayerIds.has(reciprocal.attackerId)) {
      continue;
    }

    battles.push({
      id: `battle-${battles.length + 1}`,
      playerAId: attack.attackerId,
      playerBId: reciprocal.attackerId,
    });
    consumedPlayerIds.add(attack.attackerId);
    consumedPlayerIds.add(reciprocal.attackerId);
    matchedAttackers.add(attack.attackerId);
    matchedAttackers.add(reciprocal.attackerId);
  }

  const attacksByTarget = new Map<string, typeof attacks>();

  for (const attack of attacks) {
    if (consumedPlayerIds.has(attack.attackerId)) {
      continue;
    }

    if (consumedPlayerIds.has(attack.targetId)) {
      unmatchedAttackerIds.add(attack.attackerId);
      continue;
    }

    const targetAttacks = attacksByTarget.get(attack.targetId) ?? [];
    targetAttacks.push(attack);
    attacksByTarget.set(attack.targetId, targetAttacks);
  }

  for (const [targetId, targetAttacks] of attacksByTarget) {
    const availableAttacks = targetAttacks.filter(
      (attack) => !consumedPlayerIds.has(attack.attackerId),
    );

    if (availableAttacks.length === 0 || consumedPlayerIds.has(targetId)) {
      for (const attack of targetAttacks) {
        unmatchedAttackerIds.add(attack.attackerId);
      }
      continue;
    }

    const selectedIndex = Math.floor(random() * availableAttacks.length);
    const selectedAttack = availableAttacks[selectedIndex]!;

    battles.push({
      id: `battle-${battles.length + 1}`,
      playerAId: selectedAttack.attackerId,
      playerBId: targetId,
    });
    consumedPlayerIds.add(selectedAttack.attackerId);
    consumedPlayerIds.add(targetId);
    matchedAttackers.add(selectedAttack.attackerId);

    for (const attack of targetAttacks) {
      if (attack.attackerId !== selectedAttack.attackerId) {
        unmatchedAttackerIds.add(attack.attackerId);
      }
    }
  }

  return {
    battles,
    spentAttackPlayerIds,
    unmatchedAttackerIds: [...unmatchedAttackerIds].filter(
      (attackerId) => !matchedAttackers.has(attackerId),
    ),
  };
}

function firstAvailableMadoSlot(slots: Array<Mado | null>, usedSlots: Set<number>) {
  return slots.findIndex((mado, index) => mado !== null && !usedSlots.has(index));
}

function resolveExchangeAction(
  player: Player,
  requestedAction: ExchangeAction | undefined,
  usedSlots: Set<number>,
  isFirstExchange: boolean,
): ExchangeAction {
  const firstAvailableSlot = firstAvailableMadoSlot(player.madoSlots, usedSlots);

  if (firstAvailableSlot === -1) {
    return { type: "flee" };
  }

  if (
    requestedAction?.type === "mado" &&
    player.madoSlots[requestedAction.madoSlotIndex] !== null &&
    !usedSlots.has(requestedAction.madoSlotIndex)
  ) {
    return {
      ...requestedAction,
      madoId: player.madoSlots[requestedAction.madoSlotIndex]!.id,
    };
  }

  if (!isFirstExchange && requestedAction) {
    return requestedAction;
  }

  return {
    type: "mado",
    madoSlotIndex: firstAvailableSlot,
    madoId: player.madoSlots[firstAvailableSlot]!.id,
  };
}

export function resolveScriptedBattle(
  playerA: Player,
  playerB: Player,
  actionScripts: Array<Record<string, ExchangeAction>>,
): ScriptedBattleResult {
  const usedSlotsByPlayerId: Record<string, Set<number>> = {
    [playerA.id]: new Set<number>(),
    [playerB.id]: new Set<number>(),
  };
  const fleeingPlayerIds = new Set<string>();
  const fleeRoundsByPlayerId: Record<string, number> = {
    [playerA.id]: 0,
    [playerB.id]: 0,
  };
  const healthByPlayerId: Record<string, number> = {
    [playerA.id]: playerA.health,
    [playerB.id]: playerB.health,
  };
  const exchanges: Exchange[] = [];

  const playerAHasMados = firstAvailableMadoSlot(playerA.madoSlots, new Set()) !== -1;
  const playerBHasMados = firstAvailableMadoSlot(playerB.madoSlots, new Set()) !== -1;

  if (!playerAHasMados && !playerBHasMados) {
    return {
      exchanges,
      healthByPlayerId,
      deadPlayerIds: [],
      usedMadoSlotIndexesByPlayerId: {
        [playerA.id]: [],
        [playerB.id]: [],
      },
    };
  }

  for (let exchangeIndex = 0; exchangeIndex < actionScripts.length; exchangeIndex += 1) {
    const script = actionScripts[exchangeIndex] ?? {};
    const isFirstExchange = exchangeIndex === 0;
    const rawActionA = fleeingPlayerIds.has(playerA.id)
      ? { type: "flee" as const }
      : script[playerA.id];
    const rawActionB = fleeingPlayerIds.has(playerB.id)
      ? { type: "flee" as const }
      : script[playerB.id];
    const actionA = resolveExchangeAction(
      playerA,
      rawActionA,
      usedSlotsByPlayerId[playerA.id]!,
      isFirstExchange,
    );
    const actionB = resolveExchangeAction(
      playerB,
      rawActionB,
      usedSlotsByPlayerId[playerB.id]!,
      isFirstExchange,
    );

    if (actionA.type === "flee") {
      fleeingPlayerIds.add(playerA.id);
      fleeRoundsByPlayerId[playerA.id] += 1;
    }

    if (actionB.type === "flee") {
      fleeingPlayerIds.add(playerB.id);
      fleeRoundsByPlayerId[playerB.id] += 1;
    }

    const damageByPlayerId: Record<string, number> = {
      [playerA.id]: 0,
      [playerB.id]: 0,
    };
    const usedThisExchange: Record<string, number[]> = {
      [playerA.id]: [],
      [playerB.id]: [],
    };

    if (actionA.type === "mado") {
      const mado = playerA.madoSlots[actionA.madoSlotIndex]!;
      const fleeMultiplier = fleeingPlayerIds.has(playerB.id)
        ? FLEE_DAMAGE_MULTIPLIERS[
            Math.min(fleeRoundsByPlayerId[playerB.id] - 1, FLEE_DAMAGE_MULTIPLIERS.length - 1)
          ]
        : 1;
      const damage = calculateDamage(mado.frequency, playerB.shieldFrequency, fleeMultiplier);
      damageByPlayerId[playerB.id] = damage;
      usedSlotsByPlayerId[playerA.id]!.add(actionA.madoSlotIndex);
      usedThisExchange[playerA.id]!.push(actionA.madoSlotIndex);
    }

    if (actionB.type === "mado") {
      const mado = playerB.madoSlots[actionB.madoSlotIndex]!;
      const fleeMultiplier = fleeingPlayerIds.has(playerA.id)
        ? FLEE_DAMAGE_MULTIPLIERS[
            Math.min(fleeRoundsByPlayerId[playerA.id] - 1, FLEE_DAMAGE_MULTIPLIERS.length - 1)
          ]
        : 1;
      const damage = calculateDamage(mado.frequency, playerA.shieldFrequency, fleeMultiplier);
      damageByPlayerId[playerA.id] = damage;
      usedSlotsByPlayerId[playerB.id]!.add(actionB.madoSlotIndex);
      usedThisExchange[playerB.id]!.push(actionB.madoSlotIndex);
    }

    healthByPlayerId[playerA.id] -= damageByPlayerId[playerA.id]!;
    healthByPlayerId[playerB.id] -= damageByPlayerId[playerB.id]!;

    exchanges.push({
      index: exchangeIndex,
      actionsByPlayerId: {
        [playerA.id]: actionA,
        [playerB.id]: actionB,
      },
      damageByPlayerId,
      insightGainByAttackerId: {
        [playerA.id]: damageByPlayerId[playerB.id]!,
        [playerB.id]: damageByPlayerId[playerA.id]!,
      },
      fleeingPlayerIdsAfterExchange: [...fleeingPlayerIds],
      usedMadoSlotIndexesByPlayerId: usedThisExchange,
    });

    const playerAHasAvailableMados =
      firstAvailableMadoSlot(playerA.madoSlots, usedSlotsByPlayerId[playerA.id]!) !== -1;
    const playerBHasAvailableMados =
      firstAvailableMadoSlot(playerB.madoSlots, usedSlotsByPlayerId[playerB.id]!) !== -1;
    const bothEnded = actionA.type === "end" && actionB.type === "end";
    const bothOutOfMados = !playerAHasAvailableMados && !playerBHasAvailableMados;
    const oneOutWhileOtherFlees =
      (!playerAHasAvailableMados && fleeingPlayerIds.has(playerB.id)) ||
      (!playerBHasAvailableMados && fleeingPlayerIds.has(playerA.id));

    if (bothEnded || bothOutOfMados || oneOutWhileOtherFlees) {
      break;
    }
  }

  return {
    exchanges,
    healthByPlayerId,
    deadPlayerIds: Object.entries(healthByPlayerId)
      .filter(([, health]) => health <= 0)
      .map(([playerId]) => playerId),
    usedMadoSlotIndexesByPlayerId: {
      [playerA.id]: [...usedSlotsByPlayerId[playerA.id]!],
      [playerB.id]: [...usedSlotsByPlayerId[playerB.id]!],
    },
  };
}

export function removeDeadPlayerInsights(players: Player[]): Player[] {
  const deadPlayerIds = new Set(
    players.filter((player) => !player.alive).map((player) => player.id),
  );

  return players.map((player) => {
    const insightsByTarget = Object.fromEntries(
      Object.entries(player.insightsByTarget).filter(
        ([targetPlayerId]) => !deadPlayerIds.has(targetPlayerId),
      ),
    );

    return {
      ...player,
      insightsByTarget,
      receivedInsights: player.receivedInsights.filter(
        (transfer) => !deadPlayerIds.has(transfer.targetPlayerId),
      ),
    };
  });
}
