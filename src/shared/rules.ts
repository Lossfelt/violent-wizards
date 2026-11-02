import type {
  EchoBand,
  Exchange,
  ExchangeAction,
  FrequencyArc,
  InsightState,
  Mado,
  MatchmakingResult,
  Player,
  ScriptedBattleResult,
} from "./gameTypes.js";

export const MAX_MADOS = 5;
export const STARTING_HEALTH = 200;
export const MADO_BASE_DAMAGE = 30;
export const MIN_FREQUENCY = 0;
export const MAX_FREQUENCY = 359;
export const FREQUENCY_COUNT = MAX_FREQUENCY + 1;
// Full damage inside this distance, falling linearly to zero at ZERO_DAMAGE_DISTANCE.
export const FULL_DAMAGE_DISTANCE = 15;
export const ZERO_DAMAGE_DISTANCE = 45;
// Each shot reports which band its distance to the shield fell into. The first two
// bands match the damage curve, so the echo also tells roughly how hard the hit was.
export const ECHO_BANDS: ReadonlyArray<{ band: EchoBand; maxDistance: number }> = [
  { band: "glowing", maxDistance: FULL_DAMAGE_DISTANCE },
  { band: "warm", maxDistance: ZERO_DAMAGE_DISTANCE },
  { band: "lukewarm", maxDistance: 90 },
  { band: "cold", maxDistance: 180 },
];
export const MADO_TUNE_RANGE = 60;
export const FLEE_DAMAGE_MULTIPLIERS = [0.5, 0.4, 0.3, 0.2, 0.1] as const;

export function normalizeFrequency(frequency: number): number {
  const normalized = frequency % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function randomFrequency(random = Math.random): number {
  return Math.floor(random() * FREQUENCY_COUNT);
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

  if (distance <= FULL_DAMAGE_DISTANCE) {
    return MADO_BASE_DAMAGE * fleeMultiplier;
  }

  if (distance >= ZERO_DAMAGE_DISTANCE) {
    return 0;
  }

  const falloff =
    (distance - FULL_DAMAGE_DISTANCE) / (ZERO_DAMAGE_DISTANCE - FULL_DAMAGE_DISTANCE);
  return MADO_BASE_DAMAGE * (1 - falloff) * fleeMultiplier;
}

export function getEchoBand(distance: number): EchoBand {
  return (
    ECHO_BANDS.find((entry) => distance <= entry.maxDistance)?.band ??
    ECHO_BANDS.at(-1)!.band
  );
}

export function resolveMadoHit(
  madoFrequency: number,
  shieldFrequency: number,
  fleeMultiplier = 1,
): { damage: number; echo: EchoBand } {
  return {
    damage: calculateDamage(madoFrequency, shieldFrequency, fleeMultiplier),
    echo: getEchoBand(circularDistance(madoFrequency, shieldFrequency)),
  };
}

export function fleeMultiplierForRound(fleeRoundIndex: number): number {
  return FLEE_DAMAGE_MULTIPLIERS[
    Math.max(0, Math.min(fleeRoundIndex, FLEE_DAMAGE_MULTIPLIERS.length - 1))
  ]!;
}

export function createInitialInsight(): InsightState {
  return {
    candidates: Array.from({ length: FREQUENCY_COUNT }, (_, frequency) => frequency),
  };
}

export function isInsightNarrowed(insight: InsightState | undefined): boolean {
  return insight !== undefined && insight.candidates.length < FREQUENCY_COUNT;
}

export function applyEcho(
  current: InsightState | undefined,
  madoFrequency: number,
  echo: EchoBand,
): InsightState {
  const existing = current ?? createInitialInsight();

  return {
    candidates: existing.candidates.filter(
      (frequency) => getEchoBand(circularDistance(madoFrequency, frequency)) === echo,
    ),
  };
}

export function mergeSharedInsight(
  receiverCurrent: InsightState | undefined,
  shared: InsightState,
): InsightState {
  const current = receiverCurrent ?? createInitialInsight();
  const sharedCandidates = new Set(shared.candidates);

  return {
    candidates: current.candidates.filter((frequency) => sharedCandidates.has(frequency)),
  };
}

export function toFrequencyArcs(candidates: number[]): FrequencyArc[] {
  if (candidates.length >= FREQUENCY_COUNT) {
    return [{ start: 0, end: 360 }];
  }

  const sorted = [...new Set(candidates.map(normalizeFrequency))].sort((a, b) => a - b);
  const arcs: FrequencyArc[] = [];

  for (const frequency of sorted) {
    const last = arcs.at(-1);

    if (last && last.end === frequency) {
      last.end = frequency + 1;
    } else {
      arcs.push({ start: frequency, end: frequency + 1 });
    }
  }

  const first = arcs[0];
  const last = arcs.at(-1);

  // Join an arc that runs past 359 with the one starting at 0.
  if (arcs.length > 1 && first && last && first.start === 0 && last.end === 360) {
    arcs.shift();
    last.end = 360 + first.end;
  }

  return arcs;
}

export function tuneMadoFrequency(currentFrequency: number, targetFrequency: number): number {
  const delta =
    ((normalizeFrequency(targetFrequency) - normalizeFrequency(currentFrequency) + 540) % 360) -
    180;
  const clampedDelta = Math.max(-MADO_TUNE_RANGE, Math.min(MADO_TUNE_RANGE, delta));

  return normalizeFrequency(Math.round(currentFrequency + clampedDelta));
}

export function tuneMado(player: Player, slotIndex: number, targetFrequency: number): Player {
  return {
    ...player,
    madoSlots: player.madoSlots.map((mado, index) =>
      index === slotIndex && mado
        ? { ...mado, frequency: tuneMadoFrequency(mado.frequency, targetFrequency) }
        : mado,
    ),
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
    const echoByAttackerId: Record<string, EchoBand | null> = {
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
      const fleeMultiplier = fleeingPlayerIds.has(defender.id)
        ? fleeMultiplierForRound(fleeRoundsByPlayerId[defender.id]! - 1)
        : 1;
      const hit = resolveMadoHit(mado.frequency, defender.shieldFrequency, fleeMultiplier);
      damageByPlayerId[defender.id] = hit.damage;
      echoByAttackerId[attacker.id] = hit.echo;
      usedSlotsByPlayerId[attacker.id]!.add(action.madoSlotIndex);
      usedThisExchange[attacker.id]!.push(action.madoSlotIndex);
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
      echoByAttackerId,
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
