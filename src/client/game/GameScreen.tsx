import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import type { ExchangeAction, GameSnapshot, MadoTuning } from "../../shared";
import { MADO_TUNE_RANGE, SHIELD_ROTATION_RANGE, normalizeFrequency } from "../../shared";
import { ActionSheet } from "./ActionSheet";
import { DialCenter } from "./DialCenter";
import { FeudList, FeudTable, feudDataFromGame } from "./FeudTable";
import { FrequencyDial, type DialLane, type DialMado } from "./FrequencyDial";
import { Sigil } from "./Sigil";
import { FRESHNESS_OPACITY, angleDelta, freshnessOf, isKnown, opponentColor } from "./dialMath";
import { formatClock, useCountdown } from "../useCountdown";
import "./game.css";

export type GameActions = {
  prepare: (slotIndexes: number[], tuning: MadoTuning | null) => Promise<boolean>;
  attack: (targetPlayerId: string | null, rotation?: number) => Promise<boolean>;
  battle: (action: ExchangeAction) => void;
  nextRound: () => void;
  share: (receiverPlayerId: string, targetPlayerId: string) => Promise<boolean>;
};

type Props = {
  game: GameSnapshot;
  actions: GameActions;
  error: string | null;
  connected: boolean;
  onOpenRules: () => void;
};

const STEPS: Array<[GameSnapshot["status"], string]> = [
  ["round_prepare", "Prepare"],
  ["attack_declaration", "Declare"],
  ["battle_resolution", "Warfare"],
];

// Each wizard prepares and then declares at their own pace. Once you have prepared, your
// screen moves on to Declare even while others are still preparing.
function withOwnPhase(game: GameSnapshot): GameSnapshot {
  const prepared = game.discardSubmittedPlayerIds.includes(game.currentPlayer.id);
  return game.status === "round_prepare" && prepared ? { ...game, status: "attack_declaration" } : game;
}

function DeadlineClock({ game }: { game: GameSnapshot }) {
  const seconds = useCountdown(game.phaseEndsInMs);
  if (seconds === null) return null;

  const label = game.status === "battle_resolution" ? "Round ends in" : "Planning ends in";
  return (
    <span className="game-clock" data-urgent={seconds <= 15} title={label}>
      <span className="game-clock-label">{label}</span> {formatClock(seconds)}
    </span>
  );
}

function clamp(value: number, range: number) {
  return Math.round(Math.max(-range, Math.min(range, value)));
}

export function GameScreen({ game: serverGame, actions, error, connected, onOpenRules }: Props) {
  const game = useMemo(() => withOwnPhase(serverGame), [serverGame]);
  const me = game.currentPlayer;
  const battle = game.currentBattle;
  const inActiveBattle = game.status === "battle_resolution" && battle?.status === "active";
  const lockedId = inActiveBattle ? battle!.opponentId : null;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [discards, setDiscards] = useState<number[]>([]);
  const [tune, setTune] = useState<{ slot: number; offset: number } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const seenTransfers = useRef(game.receivedInsights.length);

  // Local choices belong to one phase of one round.
  useEffect(() => {
    setActiveSlot(null);
    setDiscards([]);
    setTune(null);
    setRotating(false);
    setRotation(0);
  }, [game.roundNumber, game.status]);

  useEffect(() => setChoice(null), [game.roundNumber]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const fresh = game.receivedInsights.slice(seenTransfers.current);
    seenTransfers.current = game.receivedInsights.length;
    const incoming = fresh.find((transfer) => transfer.fromPlayerId !== me.id);

    if (incoming) {
      const from = game.opponents.find((opponent) => opponent.id === incoming.fromPlayerId)?.name;
      const about = game.opponents.find((opponent) => opponent.id === incoming.targetPlayerId)?.name;
      setToast(`${from ?? "Someone"} shared what they know about ${about ?? "a wizard"}.`);
    }
  }, [game.receivedInsights, game.opponents, me.id]);

  // The hit points flash once for every shot that lands, also the ones that hit you as you flee.
  const lastExchange = battle?.lastExchange ?? null;
  const hitKey =
    battle && lastExchange && lastExchange.damageTaken > 0 ? `${battle.id}-${lastExchange.index}` : null;

  const focusCandidate = lockedId ?? focusId;
  const focus =
    game.opponents.find((opponent) => opponent.id === focusCandidate && opponent.alive) ?? null;
  const showShield = peek || rotating;

  function madoFrequency(slot: number) {
    const base = me.madoSlots[slot]?.frequency ?? 0;
    return tune?.slot === slot ? normalizeFrequency(base + tune.offset) : base;
  }

  const preparing =
    game.status === "round_prepare" && me.alive && !game.discardSubmittedPlayerIds.includes(me.id);
  const mustFire = inActiveBattle && battle!.waitingForPlayerIds.includes(me.id);
  const usedSlots = battle?.usedMadoSlotIndexes ?? [];

  const lanes: DialLane[] = game.opponents
    .filter((opponent) => opponent.alive && isKnown(opponent.insight))
    .map((opponent) => ({
      id: opponent.id,
      initial: opponent.name[0] ?? "?",
      color: opponentColor(game, opponent.id),
      arcs: opponent.insight.arcs,
      opacity: focus && focus.id !== opponent.id ? 0.16 : FRESHNESS_OPACITY[freshnessOf(game, opponent)],
      focused: focus?.id === opponent.id,
    }));

  const mados: DialMado[] = me.madoSlots.flatMap((mado, slot) =>
    mado
      ? [
          {
            slot,
            frequency: madoFrequency(slot),
            baseFrequency: mado.frequency,
            state: discards.includes(slot)
              ? "discard"
              : inActiveBattle && usedSlots.includes(slot)
                ? "used"
                : tune?.slot === slot && tune.offset !== 0
                  ? "tuned"
                  : "ready",
            active: preparing && activeSlot === slot,
          } satisfies DialMado,
        ]
      : [],
  );

  function onMadoTap(slot: number) {
    if (preparing) {
      setActiveSlot(slot);
    } else if (mustFire && !usedSlots.includes(slot)) {
      const mado = me.madoSlots[slot];
      actions.battle({ type: "mado", madoSlotIndex: slot, madoId: mado?.id });
    }
  }

  function toggleDiscard(slot: number) {
    if (tune?.slot === slot) setTune(null);
    setDiscards(discards.includes(slot) ? discards.filter((s) => s !== slot) : [...discards, slot]);
  }

  async function ready() {
    const tuned = tune && tune.offset !== 0 ? me.madoSlots[tune.slot] : null;
    const tuning = tune && tuned ? { slotIndex: tune.slot, frequency: madoFrequency(tune.slot) } : null;
    const ok = await actions.prepare(discards, tuning);

    // The server now holds the tuned frequencies, so the local offsets must not be added again.
    if (ok) {
      setTune(null);
      setDiscards([]);
      setActiveSlot(null);
    }
  }

  async function declare(target: string | null, rotate?: number) {
    const ok = await actions.attack(target, rotate);
    if (ok) {
      const name = game.opponents.find((opponent) => opponent.id === target)?.name;
      setChoice(rotate !== undefined ? "rotate" : name ? `attack ${name}` : "hide");
      setRotating(false);
    }
  }

  async function share(receiverId: string) {
    if (!focus) return;
    const ok = await actions.share(receiverId, focus.id);
    const receiver = game.opponents.find((opponent) => opponent.id === receiverId)?.name;
    if (ok) setToast(`You shared what you know about ${focus.name} with ${receiver}.`);
  }

  const feuds = feudDataFromGame(game);
  const draggableSlot =
    preparing && activeSlot !== null && !discards.includes(activeSlot) ? activeSlot : null;

  return (
    <div className="game-screen">
      <header className="game-top">
        <span className="game-room-code">Room {game.code}</span>
        <span className="game-connection" data-connected={connected} title={connected ? "Connected" : "Reconnecting"} />
        <button aria-label="Rules" className="game-icon-button" onClick={onOpenRules} type="button">
          <BookOpen aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="game-steps">
        <span className="game-round">Round {game.roundNumber}</span>
        <ol>
          {STEPS.map(([status, label], index) => (
            <li data-on={game.status === status} key={status}>
              <span className="game-step-numeral">{["I", "II", "III"][index]}</span>
              {label}
            </li>
          ))}
        </ol>
        <DeadlineClock game={game} />
        <span className="game-hp">
          <b data-hit={hitKey !== null} key={hitKey ?? "steady"}>
            {Math.max(0, Math.ceil(me.health))}
          </b>
          hp
        </span>
      </div>

      <div className="game-chips">
        {game.opponents.map((opponent) => (
          <button
            aria-pressed={focus?.id === opponent.id}
            disabled={!opponent.alive || (lockedId !== null && lockedId !== opponent.id)}
            key={opponent.id}
            onClick={() => setFocusId(focusId === opponent.id ? null : opponent.id)}
            style={{ borderColor: opponentColor(game, opponent.id) }}
            type="button"
          >
            <Sigil seat={opponent.seat} size={22} />
            {opponent.name}
            {!opponent.connected ? <small> · off</small> : null}
          </button>
        ))}
        <button aria-label="Open the table of fights" className="game-mini-table" onClick={() => setTableOpen(true)} type="button">
          <FeudTable data={feuds} focusId={focus?.id ?? null} size="mini" />
        </button>
      </div>

      <FrequencyDial
        center={
          <DialCenter
            activeFrequency={preparing && activeSlot !== null ? madoFrequency(activeSlot) : null}
            activeSlot={activeSlot}
            focus={focus}
            game={game}
            rotation={rotation}
            showShield={showShield}
          />
        }
        draggableSlot={draggableSlot}
        lanes={lanes}
        mados={mados}
        marks={inActiveBattle || game.status === "round_cleanup" ? battle?.shots ?? [] : []}
        onMadoTap={onMadoTap}
        onRotate={(angle) => setRotation(clamp(angleDelta(me.shieldFrequency, angle), SHIELD_ROTATION_RANGE))}
        onTune={(slot, angle) =>
          setTune({ slot, offset: clamp(angleDelta(me.madoSlots[slot]?.frequency ?? 0, angle), MADO_TUNE_RANGE) })
        }
        reach={
          draggableSlot !== null
            ? { center: me.madoSlots[draggableSlot]?.frequency ?? 0, range: MADO_TUNE_RANGE, ring: "orbit" }
            : rotating
              ? { center: me.shieldFrequency, range: SHIELD_ROTATION_RANGE, ring: "shield" }
              : null
        }
        shield={
          showShield
            ? {
                frequency: normalizeFrequency(me.shieldFrequency + rotation),
                baseFrequency: me.shieldFrequency,
                draggable: rotating,
              }
            : null
        }
      />

      <ActionSheet
        activeSlot={activeSlot}
        choice={choice}
        discards={discards}
        focus={focus}
        game={game}
        mustFire={mustFire}
        onDeclare={declare}
        onNextRound={actions.nextRound}
        onPeek={setPeek}
        onReady={ready}
        onBattle={actions.battle}
        onShare={share}
        onStartRotating={() => setRotating(true)}
        onStopRotating={() => (setRotating(false), setRotation(0))}
        onToggleDiscard={toggleDiscard}
        onUndoTune={() => setTune(null)}
        preparing={preparing}
        rotating={rotating}
        rotation={rotation}
        tunedSlot={tune && tune.offset !== 0 ? tune.slot : null}
      />

      {toast ? (
        <p className="game-toast" onClick={() => setToast(null)} role="status">
          {toast}
        </p>
      ) : null}
      {error ? <p className="game-error" role="alert">{error}</p> : null}

      {tableOpen ? (
        <div aria-label="The table" className="game-overlay" onClick={() => setTableOpen(false)} role="dialog">
          <FeudTable
            data={feuds}
            focusId={focus?.id ?? null}
            onSelect={(id) => {
              if (!lockedId) setFocusId(id);
              setTableOpen(false);
            }}
            showNumbers={showNumbers}
            size="full"
          />
          <button
            aria-pressed={showNumbers}
            onClick={(event) => (event.stopPropagation(), setShowNumbers(!showNumbers))}
            type="button"
          >
            {showNumbers ? "Hide numbers" : "Show numbers"}
          </button>
          {showNumbers ? <FeudList data={feuds} /> : null}
          <p>Tap a wizard to focus the dial. Tap anywhere else to close.</p>
        </div>
      ) : null}
    </div>
  );
}
