import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  BookOpen,
  ChevronRight,
  Copy,
  Heart,
  MessageSquare,
  Radio,
  ScrollText,
  Shield,
  Swords,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  EchoBand,
  ExchangeAction,
  FrequencyArc,
  GameSnapshot,
  LobbySnapshot,
  Mado,
  ServerToClientEvents,
} from "../shared";
import {
  FREQUENCY_COUNT,
  MADO_TUNE_RANGE,
  MAX_MADOS,
  SHIELD_DRIFT_MAX,
  SHIELD_ROTATION_RANGE,
  STARTING_HEALTH,
  normalizeFrequency,
} from "../shared";

type ConnectionState = "connecting" | "connected" | "disconnected";
type DrawerId = "opponents" | "share" | "history";
type PrepareMode = "discard" | "tune";

const SESSION_STORAGE_KEY = "violent-wizards-session-id";
const GAME_CODE_STORAGE_KEY = "violent-wizards-game-code";
const SERVER_URL = import.meta.env.VITE_SERVER_URL;
const WHEEL_SIZE = 72;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const WHEEL_RADIUS = 28;
const ROUND_PHASES = [
  { status: "round_prepare", label: "Prepare" },
  { status: "attack_declaration", label: "Declare" },
  { status: "battle_resolution", label: "Battle" },
  { status: "round_cleanup", label: "Cleanup" },
] as const;

function getSessionId() {
  const existingSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (existingSessionId) {
    return existingSessionId;
  }

  const sessionId = crypto.randomUUID();
  window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

function polarPoint(degrees: number, radius = WHEEL_RADIUS) {
  const radians = ((degrees - 90) * Math.PI) / 180;

  return {
    x: WHEEL_CENTER + radius * Math.cos(radians),
    y: WHEEL_CENTER + radius * Math.sin(radians),
  };
}

const ECHO_LABELS: Record<EchoBand, string> = {
  glowing: "Glowing",
  warm: "Warm",
  lukewarm: "Lukewarm",
  cold: "Cold",
};

const ECHO_DESCRIPTIONS: Record<EchoBand, string> = {
  glowing: "Direct hit. Full damage went through.",
  warm: "Close. Some damage went through.",
  lukewarm: "Off target. The shield held.",
  cold: "Far off. The shield is on the other side.",
};

function isFullCircle(arcs: FrequencyArc[]) {
  return arcs.length === 1 && arcs[0]!.end - arcs[0]!.start >= 360;
}

function arcPath(arc: FrequencyArc) {
  const start = polarPoint(arc.start);
  const end = polarPoint(arc.end);
  const largeArcFlag = arc.end - arc.start > 180 ? 1 : 0;

  return [
    `M ${WHEEL_CENTER} ${WHEEL_CENTER}`,
    `L ${start.x} ${start.y}`,
    `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function clampPercent(value: number) {
  return `${Math.max(0, Math.min(100, value))}%`;
}

function frequencyMarkerStyle(frequency: number) {
  return { "--mado-frequency": `${frequency}deg` } as CSSProperties;
}

function FrequencyWheel({
  arcs,
  ghostMarker,
  marker,
  label,
  size,
}: {
  arcs?: FrequencyArc[];
  ghostMarker?: number;
  marker?: number;
  label: string;
  size?: "large";
}) {
  const markerPoint = marker === undefined ? null : polarPoint(marker, WHEEL_RADIUS + 1);
  const ghostPoint =
    ghostMarker === undefined ? null : polarPoint(ghostMarker, WHEEL_RADIUS + 1);
  const fullCircle = arcs ? isFullCircle(arcs) : false;

  return (
    <svg
      aria-label={label}
      className="frequency-wheel"
      data-size={size}
      role="img"
      viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
    >
      <circle className="wheel-ring" cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_RADIUS} />
      {fullCircle ? (
        <circle className="wheel-segment" cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_RADIUS} />
      ) : (
        arcs?.map((arc) => <path className="wheel-segment" d={arcPath(arc)} key={arc.start} />)
      )}
      {ghostPoint ? (
        <circle className="wheel-marker ghost" cx={ghostPoint.x} cy={ghostPoint.y} r="3" />
      ) : null}
      {markerPoint ? (
        <circle className="wheel-marker" cx={markerPoint.x} cy={markerPoint.y} r="4" />
      ) : null}
      <line className="wheel-axis" x1={WHEEL_CENTER} x2={WHEEL_CENTER} y1="8" y2="14" />
    </svg>
  );
}

function RoundProgress({
  roundNumber,
  status,
}: {
  roundNumber: number;
  status: GameSnapshot["status"];
}) {
  const activeIndex = ROUND_PHASES.findIndex((phase) => phase.status === status);

  return (
    <nav className="round-progress" aria-label={`Round ${roundNumber} progress`}>
      <span className="round-progress-label">Round {roundNumber}</span>
      <ol className="round-steps">
        {ROUND_PHASES.map((phase, index) => {
          const isActive = index === activeIndex;
          const isComplete =
            status === "finished" || (activeIndex !== -1 && index < activeIndex);

          return (
            <li
              aria-current={isActive ? "step" : undefined}
              className="round-step"
              data-active={isActive}
              data-complete={isComplete}
              key={phase.status}
            >
              <span>{phase.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function AppHeader({
  game,
  lobby,
  onOpenRules,
}: {
  game: GameSnapshot | null;
  lobby: LobbySnapshot | null;
  onOpenRules: () => void;
}) {
  const code = game?.code ?? lobby?.code ?? null;

  function copyCode() {
    if (code) {
      void navigator.clipboard?.writeText(code);
    }
  }

  return (
    <header className="app-header">
      <div className="brand-block">
        <h1 id="app-title" className={game ? "brand-title" : undefined}>
          {game ? "Violent Wizards" : "Hide your frequency."}
        </h1>
        {!game ? <p className="brand-title">Violent Wizards</p> : null}
      </div>
      {game ? <RoundProgress roundNumber={game.roundNumber} status={game.status} /> : null}
      <div className="header-actions">
        <button className="rules-button" type="button" onClick={onOpenRules}>
          <BookOpen size={17} aria-hidden="true" />
          <span>Rules</span>
        </button>
        {code ? (
          <div className="room-code">
            <span>Room code</span>
            <strong>{code}</strong>
            <button className="icon-button" type="button" aria-label="Copy room code" onClick={copyCode}>
              <Copy size={17} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="rules-modal" role="presentation">
      <button className="modal-backdrop" aria-label="Close rules" onClick={onClose} type="button" />
      <section className="rules-dialog" aria-labelledby="rules-title" aria-modal="true" role="dialog">
        <header className="rules-header">
          <div className="panel-title">
            <BookOpen size={22} aria-hidden="true" />
            <h2 id="rules-title">Rules and setting</h2>
          </div>
          <button className="icon-button" aria-label="Close rules" onClick={onClose} type="button">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="rules-content">
          <section className="rules-section">
            <h3>The premise</h3>
            <p>
              Every wizard hides behind an invisible shield tuned to a secret frequency.
              Your Mados are living magical torpedoes, each with their own frequency.
              A Mado within 15° of the shield does full damage. Damage falls off until 45°, and
              beyond that the shield holds completely.
            </p>
          </section>
          <section className="rules-section">
            <h3>Round flow</h3>
            <ol>
              <li>
                Prepare: discard Mados (empty slots refill next round) and tune one Mado up to{" "}
                {MADO_TUNE_RANGE}° in either direction.
              </li>
              <li>Declare: attack one living opponent, or pass.</li>
              <li>Battle: matched opponents resolve simultaneous exchanges.</li>
              <li>Cleanup: spent Mados are removed, dead players fall, and the host starts the next round.</li>
            </ol>
          </section>
          <section className="rules-section">
            <h3>Battle rules</h3>
            <ol>
              <li>The first exchange requires a Mado if you have one available.</li>
              <li>After that, choose another Mado, flee, or end if the opponent is fleeing.</li>
              <li>Fleeing reduces incoming damage over repeated escape exchanges.</li>
              <li>A battle ends when both stop, both run out of Mados, or one runs out while the other flees.</li>
            </ol>
          </section>
          <section className="rules-section">
            <h3>Echoes, insight and victory</h3>
            <p>
              Every Mado you fire sends back an echo: glowing (within 15°), warm (within 45°),
              lukewarm (within 90°) or cold. Each echo rules out part of the circle, and the remaining
              possible range is shown on the opponent's wheel. Misses teach you as much as hits, so
              spread your first shots to find the shield, then fire and tune toward it.
            </p>
            <p>
              Shields never stand still. Each one drifts a hidden 2 to {SHIELD_DRIFT_MAX}° per round in a
              fixed direction, so known ranges widen every round until a new echo narrows them again.
              Instead of attacking you can rotate your own shield up to {SHIELD_ROTATION_RANGE}°. Everyone
              senses it and loses precision on you, but if you are attacked that round you can only flee.
            </p>
            <p>
              Known ranges can be shared with other living players outside active battles. The receiver
              keeps only the part of the circle both of you agree on. The last living wizard wins. If
              nobody survives, the game is a draw.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}

function ConnectionStatus({
  connectionError,
  connectionState,
  compact,
}: {
  connectionError: string | null;
  connectionState: ConnectionState;
  compact?: boolean;
}) {
  const Icon = connectionState === "connected" ? Wifi : WifiOff;

  if (compact) {
    return (
      <div className="connection-pill" data-state={connectionState}>
        <Icon size={15} aria-hidden="true" />
        <span>{connectionState}</span>
      </div>
    );
  }

  return (
    <details className="status-details" open>
      <summary>
        Connection
        <span data-state={connectionState}>{connectionState}</span>
      </summary>
      <dl className="status-grid" aria-label="Realtime server status">
        <div>
          <dt>Realtime</dt>
          <dd data-state={connectionState}>{connectionState}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{SERVER_URL || "/socket.io proxy"}</dd>
        </div>
        {connectionError ? (
          <div>
            <dt>Last error</dt>
            <dd>{connectionError}</dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function LobbyPanel({
  connectionError,
  connectionState,
  createLobby,
  currentPlayer,
  isLobbyHost,
  joinCode,
  joinLobby,
  joinUrl,
  lobby,
  lobbyError,
  playerName,
  qrCodeUrl,
  setJoinCode,
  setPlayerName,
  startGame,
  gameError,
}: {
  connectionError: string | null;
  connectionState: ConnectionState;
  createLobby: () => void;
  currentPlayer: LobbySnapshot["players"][number] | undefined;
  isLobbyHost: boolean;
  joinCode: string;
  joinLobby: () => void;
  joinUrl: string | null;
  lobby: LobbySnapshot | null;
  lobbyError: string | null;
  playerName: string;
  qrCodeUrl: string | null;
  setJoinCode: (value: string) => void;
  setPlayerName: (value: string) => void;
  startGame: () => void;
  gameError: string | null;
}) {
  if (!lobby) {
    return (
      <div className="lobby-form">
        <label>
          Display name
          <input
            value={playerName}
            maxLength={32}
            placeholder="Mira"
            onChange={(event) => setPlayerName(event.target.value)}
          />
        </label>
        <button
          className="primary-button"
          disabled={connectionState !== "connected"}
          onClick={createLobby}
          type="button"
        >
          {connectionState === "connected" ? "Create lobby" : "Waiting for server"}
        </button>
        <div className="join-row">
          <label>
            Lobby code
            <input
              inputMode="numeric"
              maxLength={4}
              value={joinCode}
              placeholder="4172"
              onChange={(event) =>
                setJoinCode(event.target.value.replace(/\D/g, "").slice(0, 4))
              }
            />
          </label>
          <button
            disabled={connectionState !== "connected" || joinCode.length !== 4}
            onClick={joinLobby}
            type="button"
          >
            Join
          </button>
        </div>
        {connectionState !== "connected" ? (
          <p className="form-error">
            Realtime server is not connected. Start the app with npm run dev so both
            Vite and the Node server are running.
            {connectionError ? ` Last error: ${connectionError}.` : ""}
          </p>
        ) : null}
        {lobbyError ? <p className="form-error">{lobbyError}</p> : null}
      </div>
    );
  }

  return (
    <div className="lobby-room">
      <div className="join-link">
        <span>Join link</span>
        <code>{joinUrl}</code>
      </div>
      {qrCodeUrl ? (
        <div className="qr-card">
          <img src={qrCodeUrl} alt={`QR code for lobby ${lobby.code}`} />
          <span>Scan to join</span>
        </div>
      ) : null}
      <div className="player-list" aria-label="Players in lobby">
        {lobby.players.map((player) => (
          <div className="player-row" key={player.id}>
            <span>{player.name}</span>
            <small>
              {player.host ? "Host" : "Player"}
              {" / "}
              {player.connected ? "online" : "offline"}
              {player.id === currentPlayer?.id ? " / you" : ""}
            </small>
          </div>
        ))}
      </div>
      {isLobbyHost ? (
        <button
          className="primary-button"
          disabled={lobby.players.length < 2}
          onClick={startGame}
          type="button"
        >
          Start game
        </button>
      ) : (
        <p className="waiting-copy">Waiting for the host to start.</p>
      )}
      {gameError ? <p className="form-error">{gameError}</p> : null}
    </div>
  );
}

function GameHud({ game }: { game: GameSnapshot }) {
  const health = Math.ceil(game.currentPlayer.health);
  const healthPercent = clampPercent((health / STARTING_HEALTH) * 100);
  const filledMados = game.currentPlayer.madoSlots.filter(Boolean).length;
  const liveOpponents = game.opponents.filter((opponent) => opponent.alive).length;
  const currentPhase =
    ROUND_PHASES.find((phase) => phase.status === game.status)?.label ??
    (game.status === "finished" ? "Finished" : "Lobby");

  return (
    <section className="game-hud" aria-label="Current game status">
      <div className="hud-cell hud-health">
        <Heart size={18} aria-hidden="true" />
        <span>Health</span>
        <strong>{health}</strong>
        <div className="hud-meter" aria-hidden="true">
          <span style={{ width: healthPercent }} />
        </div>
      </div>
      <div className="hud-cell">
        <Radio size={18} aria-hidden="true" />
        <span>Mados</span>
        <strong>
          {filledMados}/{MAX_MADOS}
        </strong>
      </div>
      <div className="hud-cell">
        <Swords size={18} aria-hidden="true" />
        <span>Opponents</span>
        <strong>{liveOpponents}</strong>
      </div>
      <div className="hud-cell hud-phase">
        <span>Phase</span>
        <strong>{currentPhase}</strong>
        <small>Round {game.roundNumber}</small>
      </div>
    </section>
  );
}

function PlayerStatusPanel({ game }: { game: GameSnapshot }) {
  const health = Math.ceil(game.currentPlayer.health);
  const healthPercent = clampPercent((health / STARTING_HEALTH) * 100);
  const filledMados = game.currentPlayer.madoSlots.filter(Boolean).length;

  return (
    <section className="player-status-panel panel-surface" aria-label="Your status">
      <div className="status-identity">
        <span>You</span>
        <strong>{game.currentPlayer.name}</strong>
        <small>{game.currentPlayer.alive ? "active" : "fallen"}</small>
      </div>
      <div className="meter-block">
        <div className="meter-label">
          <Heart size={20} aria-hidden="true" />
          <span>Health</span>
          <strong>{health}</strong>
        </div>
        <div className="meter-track" aria-hidden="true">
          <span className="meter-fill health-fill" style={{ width: healthPercent }} />
        </div>
      </div>
      <div className="shield-row">
        <div>
          <div className="meter-label compact">
            <Shield size={20} aria-hidden="true" />
            <span>Shield frequency</span>
          </div>
          <small>Hidden from opponents</small>
          <small className="drift-copy">{describeDrift(game.currentPlayer.shieldDrift)}</small>
        </div>
        <FrequencyWheel
          label="Your shield frequency"
          marker={game.currentPlayer.shieldFrequency}
        />
      </div>
      <div className="mini-mados" aria-label="Your Mados">
        <span>Your mados</span>
        <div>
          {game.currentPlayer.madoSlots.map((mado, index) => (
            <span
              aria-label={
                mado
                  ? `Mado ${index + 1}, frequency ${Math.round(mado.frequency)} degrees`
                  : `Mado ${index + 1}, empty`
              }
              className="mini-mado"
              data-empty={mado === null}
              data-frequency={mado ? `${Math.round(mado.frequency)}°` : undefined}
              key={mado?.id ?? `mini-${index}`}
              tabIndex={mado ? 0 : undefined}
              style={mado ? frequencyMarkerStyle(mado.frequency) : undefined}
            >
              {index + 1}
              {mado ? <span className="mini-mado-marker" aria-hidden="true" /> : null}
            </span>
          ))}
        </div>
        <small>
          {filledMados} / {MAX_MADOS} available
        </small>
      </div>
    </section>
  );
}

function MadoSlotGrid({
  disabled,
  disabledSlotIndexes = [],
  frequencyOverrides = {},
  onSlotClick,
  overlayArcs,
  selectedSlotIndexes = [],
  selectionTone,
  slots,
  usedSlotIndexes = [],
}: {
  disabled?: boolean;
  disabledSlotIndexes?: number[];
  frequencyOverrides?: Record<number, number>;
  onSlotClick?: (slotIndex: number, mado: Mado) => void;
  overlayArcs?: FrequencyArc[];
  selectedSlotIndexes?: number[];
  selectionTone?: "tune";
  slots: Array<Mado | null>;
  usedSlotIndexes?: number[];
}) {
  return (
    <div className="mado-grid" data-tone={selectionTone}>
      {slots.map((mado, index) => {
        const isDisabled = disabled || mado === null || disabledSlotIndexes.includes(index);
        const frequency = frequencyOverrides[index] ?? mado?.frequency;

        return (
          <button
            className="mado-button"
            data-selected={selectedSlotIndexes.includes(index)}
            data-used={usedSlotIndexes.includes(index)}
            disabled={isDisabled}
            title={frequency !== undefined ? `Mado ${index + 1}: ${Math.round(frequency)}°` : undefined}
            key={mado?.id ?? `empty-${index}`}
            onClick={() => {
              if (mado) {
                onSlotClick?.(index, mado);
              }
            }}
            type="button"
          >
            <strong>{index + 1}</strong>
            {mado && frequency !== undefined ? (
              <>
                <FrequencyWheel
                  arcs={overlayArcs}
                  ghostMarker={frequency !== mado.frequency ? mado.frequency : undefined}
                  label={`Mado slot ${index + 1}`}
                  marker={frequency}
                />
                <span className="mado-frequency-label">{Math.round(frequency)} deg</span>
              </>
            ) : (
              <span>Empty</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type Preparation = {
  mode: PrepareMode;
  setMode: (mode: PrepareMode) => void;
  selectedDiscardSlots: number[];
  toggleDiscardSlot: (slotIndex: number) => void;
  tuningSlot: number | null;
  setTuningSlot: (slotIndex: number | null) => void;
  tuningOffset: number;
  setTuningOffset: (offset: number) => void;
  aimOpponentId: string;
  setAimOpponentId: (opponentId: string) => void;
  submit: () => void;
};

function EchoCard({ echo }: { echo: EchoBand }) {
  return (
    <div className="battle-result-card echo-card" data-echo={echo}>
      <span>Your Mado's echo</span>
      <strong>{ECHO_LABELS[echo]}</strong>
      <small>{ECHO_DESCRIPTIONS[echo]}</small>
    </div>
  );
}

function knownArcs(game: GameSnapshot, opponentId: string | undefined) {
  const opponent = game.opponents.find((candidate) => candidate.id === opponentId);

  return opponent && opponent.insight.possibleCount < FREQUENCY_COUNT
    ? opponent.insight.arcs
    : undefined;
}

function PreparePanel({
  className,
  game,
  hasSubmitted,
  preparation,
}: {
  className: string;
  game: GameSnapshot;
  hasSubmitted: boolean;
  preparation: Preparation;
}) {
  const {
    aimOpponentId,
    mode,
    selectedDiscardSlots,
    tuningOffset,
    tuningSlot,
  } = preparation;
  const slots = game.currentPlayer.madoSlots;
  const tunedMado = tuningSlot === null ? null : slots[tuningSlot] ?? null;
  const tunedFrequency = tunedMado
    ? normalizeFrequency(tunedMado.frequency + tuningOffset)
    : null;
  const aimArcs = knownArcs(game, aimOpponentId);
  const aimTargets = game.opponents.filter(
    (opponent) => opponent.alive && opponent.insight.possibleCount < FREQUENCY_COUNT,
  );

  function handleSlotClick(slotIndex: number) {
    if (mode === "discard") {
      if (slotIndex === tuningSlot) {
        preparation.setTuningSlot(null);
      }

      preparation.toggleDiscardSlot(slotIndex);
      return;
    }

    preparation.setTuningSlot(slotIndex);
    preparation.setTuningOffset(0);
  }

  return (
    <section className={className}>
      <div className="phase-heading">
        <h2>Prepare Mados</h2>
        <p>
          Discard Mados to get new ones next round, and tune one Mado up to {MADO_TUNE_RANGE}°
          toward a shield you have tracked.
        </p>
      </div>
      <div className="prepare-toolbar">
        <div className="mode-switch" role="group" aria-label="Preparation mode">
          {(["discard", "tune"] as const).map((option) => (
            <button
              aria-pressed={mode === option}
              disabled={hasSubmitted}
              key={option}
              onClick={() => preparation.setMode(option)}
              type="button"
            >
              {option === "discard" ? "Discard" : "Tune"}
            </button>
          ))}
        </div>
        <label className="aim-select">
          Show known shield
          <select
            disabled={aimTargets.length === 0}
            value={aimOpponentId}
            onChange={(event) => preparation.setAimOpponentId(event.target.value)}
          >
            <option value="">{aimTargets.length === 0 ? "Nothing tracked yet" : "None"}</option>
            {aimTargets.map((opponent) => (
              <option key={opponent.id} value={opponent.id}>
                {opponent.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <MadoSlotGrid
        disabled={hasSubmitted}
        disabledSlotIndexes={mode === "tune" ? selectedDiscardSlots : []}
        frequencyOverrides={
          tuningSlot !== null && tunedFrequency !== null ? { [tuningSlot]: tunedFrequency } : {}
        }
        onSlotClick={handleSlotClick}
        overlayArcs={aimArcs}
        selectedSlotIndexes={
          mode === "discard" ? selectedDiscardSlots : tuningSlot === null ? [] : [tuningSlot]
        }
        selectionTone={mode === "tune" ? "tune" : undefined}
        slots={slots}
      />
      {mode === "tune" && tunedMado && tunedFrequency !== null && !hasSubmitted ? (
        <div className="tune-panel">
          <FrequencyWheel
            arcs={aimArcs}
            ghostMarker={tunedMado.frequency}
            label={`Mado ${tuningSlot! + 1} tuned to ${tunedFrequency} degrees`}
            marker={tunedFrequency}
            size="large"
          />
          <label className="tune-slider">
            <span>
              Mado {tuningSlot! + 1}: {Math.round(tunedMado.frequency)}° → {tunedFrequency}°
            </span>
            <input
              max={MADO_TUNE_RANGE}
              min={-MADO_TUNE_RANGE}
              onChange={(event) => preparation.setTuningOffset(Number(event.target.value))}
              step={1}
              type="range"
              value={tuningOffset}
            />
          </label>
        </div>
      ) : mode === "tune" && !hasSubmitted ? (
        <p className="waiting-copy">Pick the Mado you want to tune.</p>
      ) : null}
      <button
        className="primary-button action-button"
        disabled={hasSubmitted}
        onClick={preparation.submit}
        type="button"
      >
        <span>{hasSubmitted ? "Waiting for others" : "Confirm preparation"}</span>
        <ChevronRight size={22} aria-hidden="true" />
      </button>
    </section>
  );
}

type Rotation = {
  open: boolean;
  setOpen: (open: boolean) => void;
  offset: number;
  setOffset: (offset: number) => void;
};

function RotationPanel({
  game,
  rotation,
  submitAttack,
}: {
  game: GameSnapshot;
  rotation: Rotation;
  submitAttack: (targetPlayerId: string | null, rotation?: number) => void;
}) {
  const current = game.currentPlayer.shieldFrequency;
  const rotated = normalizeFrequency(current + rotation.offset);

  return (
    <div className="tune-panel rotation-panel">
      <FrequencyWheel
        ghostMarker={current}
        label={`Your shield rotated to ${rotated} degrees`}
        marker={rotated}
        size="large"
      />
      <div className="tune-slider">
        <label>
          <span>
            Shield: {Math.round(current)}° → {rotated}°
          </span>
          <input
            max={SHIELD_ROTATION_RANGE}
            min={-SHIELD_ROTATION_RANGE}
            onChange={(event) => rotation.setOffset(Number(event.target.value))}
            step={1}
            type="range"
            value={rotation.offset}
          />
        </label>
        <small>
          You skip your attack. If someone attacks you this round you can only flee. Every wizard
          senses the rotation and their knowledge of your shield widens by {SHIELD_ROTATION_RANGE}°,
          but nobody learns where it went. Your drift also changes.
        </small>
        <button className="teal-button" onClick={() => submitAttack(null, rotation.offset)} type="button">
          Rotate shield
        </button>
      </div>
    </div>
  );
}

function describeDrift(drift: number) {
  const direction = drift > 0 ? "clockwise" : "counterclockwise";

  return `Drifts ${Math.abs(drift)}° ${direction} each round`;
}

function PrimaryPhasePanel({
  currentBattle,
  game,
  hasSubmittedAttack,
  hasSubmittedDiscard,
  isFleeing,
  isGameHost,
  lastDamageTaken,
  totalBattleDamageTaken,
  mustChooseBattleAction,
  preparation,
  rotation,
  showBattleResult,
  startNextRound,
  submitAttack,
  submitBattleAction,
  winnerName,
}: {
  currentBattle: GameSnapshot["currentBattle"];
  game: GameSnapshot;
  hasSubmittedAttack: boolean;
  hasSubmittedDiscard: boolean;
  isFleeing: boolean;
  isGameHost: boolean;
  lastDamageTaken: number;
  totalBattleDamageTaken: number;
  mustChooseBattleAction: boolean;
  preparation: Preparation;
  rotation: Rotation;
  showBattleResult: boolean;
  startNextRound: () => void;
  submitAttack: (targetPlayerId: string | null, rotation?: number) => void;
  submitBattleAction: (action: ExchangeAction) => void;
  winnerName: string | undefined;
}) {
  const primaryPhaseClassName = "phase-panel primary-phase phase-transition";
  const exchangeImpactKey = currentBattle?.lastExchange
    ? `${currentBattle.id}-${currentBattle.lastExchange.index}`
    : null;
  const lastEcho = currentBattle?.lastExchange?.echo ?? null;

  if (game.status === "round_prepare") {
    return (
      <PreparePanel
        className={primaryPhaseClassName}
        game={game}
        hasSubmitted={hasSubmittedDiscard}
        preparation={preparation}
      />
    );
  }

  if (game.status === "attack_declaration") {
    return (
      <section className={primaryPhaseClassName}>
        <div className="phase-heading">
          <h2>Choose attack</h2>
          <p>Pick one living opponent, pass to stay hidden, or rotate your shield.</p>
        </div>
        <div className="target-list">
          {game.opponents
            .filter((opponent) => opponent.alive)
            .map((opponent) => (
              <button
                disabled={hasSubmittedAttack}
                key={opponent.id}
                onClick={() => submitAttack(opponent.id)}
                type="button"
              >
                Attack {opponent.name}
              </button>
            ))}
          <button disabled={hasSubmittedAttack} onClick={() => submitAttack(null)} type="button">
            Pass
          </button>
          <button
            aria-pressed={rotation.open}
            disabled={hasSubmittedAttack}
            onClick={() => rotation.setOpen(!rotation.open)}
            type="button"
          >
            Rotate shield
          </button>
        </div>
        {rotation.open && !hasSubmittedAttack ? (
          <RotationPanel game={game} rotation={rotation} submitAttack={submitAttack} />
        ) : null}
        {hasSubmittedAttack ? (
          <p className="waiting-copy">
            {game.currentPlayer.rotatingThisRound
              ? "You are rotating your shield. Waiting for declarations."
              : "Waiting for declarations."}
          </p>
        ) : null}
      </section>
    );
  }

  if (game.status === "battle_resolution") {
    return (
      <section className={primaryPhaseClassName}>
        <div className="phase-heading">
          <h2>{currentBattle ? `Battle vs ${currentBattle.opponentName}` : "Matched battles"}</h2>
          <p>Resolve declared battles without revealing hidden shield values.</p>
        </div>
        {currentBattle?.status === "active" ? (
          <>
            {exchangeImpactKey ? (
              <div className="exchange-impact" key={exchangeImpactKey} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            {currentBattle.lastExchange ? (
              <div className="exchange-cards" aria-live="polite">
                {lastEcho ? <EchoCard echo={lastEcho} /> : null}
                <div className="battle-result-card exchange-card">
                  <span>Last exchange</span>
                  <strong>{lastDamageTaken} damage taken</strong>
                  <small>{totalBattleDamageTaken} total in this battle</small>
                </div>
              </div>
            ) : null}
            {isFleeing ? (
              <p className="waiting-copy">
                {game.currentPlayer.rotatingThisRound
                  ? "You are rotating your shield and can only flee."
                  : "You are fleeing."}
              </p>
            ) : mustChooseBattleAction ? (
              <>
                <p>
                  {currentBattle.exchangeCount === 0
                    ? "Choose a Mado for the first exchange."
                    : "Choose a Mado, flee, or end if your opponent is fleeing."}
                </p>
                <MadoSlotGrid
                  disabledSlotIndexes={currentBattle.usedMadoSlotIndexes}
                  usedSlotIndexes={currentBattle.usedMadoSlotIndexes}
                  overlayArcs={knownArcs(game, currentBattle.opponentId)}
                  onSlotClick={(index, mado) =>
                    submitBattleAction({
                      type: "mado",
                      madoSlotIndex: index,
                      madoId: mado.id,
                    })
                  }
                  slots={game.currentPlayer.madoSlots}
                />
                {currentBattle.exchangeCount > 0 ? (
                  <div className="target-list">
                    <button onClick={() => submitBattleAction({ type: "flee" })} type="button">
                      Flee
                    </button>
                    {currentBattle.fleeingPlayerIds.includes(currentBattle.opponentId) ? (
                      <button onClick={() => submitBattleAction({ type: "end" })} type="button">
                        End battle
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="waiting-copy">Waiting for your opponent.</p>
            )}
          </>
        ) : game.pendingBattles.length > 0 ? (
          <div className="battle-list">
            {game.pendingBattles.map((battle) => (
              <div className="battle-row" key={battle.id}>
                {battle.playerAName} vs {battle.playerBName}
              </div>
            ))}
          </div>
        ) : (
          <p>No battles were matched this round.</p>
        )}
        {!currentBattle ? <p>Waiting for other battles to finish.</p> : null}
      </section>
    );
  }

  if (game.status === "round_cleanup") {
    return (
      <section className={`${primaryPhaseClassName} result-phase`}>
        {showBattleResult && currentBattle?.lastExchange ? (
          <>
            <div className="phase-heading">
              <h2>Battle result</h2>
              <p>The final exchange has been committed.</p>
            </div>
            <div className="exchange-cards">
              {lastEcho ? <EchoCard echo={lastEcho} /> : null}
              <div className="battle-result-card large">
                <span>Final exchange</span>
                <strong>{lastDamageTaken} damage taken</strong>
                <small>{totalBattleDamageTaken} total in this battle</small>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="phase-heading">
              <h2>Round committed</h2>
              <p>All battle results have been applied.</p>
            </div>
            {isGameHost ? (
              <button className="primary-button action-button" onClick={startNextRound} type="button">
                <span>Start next round</span>
                <ChevronRight size={22} aria-hidden="true" />
              </button>
            ) : (
              <p className="waiting-copy">Waiting for the host to start the next round.</p>
            )}
          </>
        )}
      </section>
    );
  }

  return (
    <section className={primaryPhaseClassName}>
      <div className="phase-heading">
        <h2>Game finished</h2>
        <p>{game.draw ? "The game ended in a draw." : `${winnerName ?? "Unknown"} wins.`}</p>
      </div>
    </section>
  );
}

// "95°-130°, 200°-215°". Arc ends are exclusive and may run past 360.
function formatArcs(arcs: FrequencyArc[]) {
  return arcs
    .map((arc) => {
      const first = normalizeFrequency(arc.start);
      const last = normalizeFrequency(arc.end - 1);

      return first === last ? `${first}°` : `${first}°-${last}°`;
    })
    .join(", ");
}

function describePossibleRange(possibleCount: number) {
  return possibleCount >= FREQUENCY_COUNT
    ? "shield unknown"
    : `${possibleCount}° of the circle still possible`;
}

function describeTransfer(game: GameSnapshot, transfer: GameSnapshot["receivedInsights"][number]) {
  const nameOf = (playerId: string) =>
    game.opponents.find((opponent) => opponent.id === playerId)?.name ?? "Unknown";
  const target = nameOf(transfer.targetPlayerId);
  const source =
    transfer.fromPlayerId === game.currentPlayer.id ? "You shared" : `${nameOf(transfer.fromPlayerId)} shared`;

  return `${source} ${target} (${transfer.possibleCount}°) in round ${transfer.roundNumber}`;
}

function OpponentsPanel({ game }: { game: GameSnapshot }) {
  return (
    <section className="phase-panel roster-panel" aria-labelledby="opponents-title">
      <div className="panel-title">
        <Users size={21} aria-hidden="true" />
        <h2 id="opponents-title">Opponents</h2>
      </div>
      <div className="player-list" aria-label="Opponents">
        {game.opponents.map((opponent) => (
          <div className="player-row opponent-row" key={opponent.id}>
            <div>
              <span>{opponent.name}</span>
              <small>
                {opponent.alive ? "alive" : "dead"}
                {" / "}
                {opponent.connected ? "online" : "offline"}
              </small>
            </div>
            <FrequencyWheel
              arcs={opponent.insight.arcs}
              label={`Known shield range for ${opponent.name}`}
            />
            {opponent.insight.possibleCount < FREQUENCY_COUNT ? (
              <small className="range-copy">{formatArcs(opponent.insight.arcs)}</small>
            ) : null}
            <small className="insight-copy">
              {describePossibleRange(opponent.insight.possibleCount)}
              {opponent.insight.lastNarrowedRound !== null
                ? ` / last echo round ${opponent.insight.lastNarrowedRound}`
                : ""}
              {opponent.lastRotatedRound !== null
                ? ` / rotated round ${opponent.lastRotatedRound}`
                : ""}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShareInsightPanel({
  canShareInsight,
  game,
  shareInsight,
  shareReceiverId,
  shareTargetId,
  setShareReceiverId,
  setShareTargetId,
}: {
  canShareInsight: boolean;
  game: GameSnapshot;
  shareInsight: () => void;
  shareReceiverId: string;
  shareTargetId: string;
  setShareReceiverId: (value: string) => void;
  setShareTargetId: (value: string) => void;
}) {
  if (!canShareInsight) {
    return null;
  }

  return (
    <section className="phase-panel insight-panel">
      <div className="panel-title">
        <MessageSquare size={20} aria-hidden="true" />
        <h2>Share insight</h2>
      </div>
      {game.shareableInsights.length > 0 ? (
        <>
          <div className="share-fields">
            <label>
              Receiver
              <select
                value={shareReceiverId}
                onChange={(event) => setShareReceiverId(event.target.value)}
              >
                <option value="">Choose player</option>
                {game.opponents
                  .filter((opponent) => opponent.alive)
                  .map((opponent) => (
                    <option key={opponent.id} value={opponent.id}>
                      {opponent.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Insight
              <select
                value={shareTargetId}
                onChange={(event) => setShareTargetId(event.target.value)}
              >
                <option value="">Choose target</option>
                {game.shareableInsights.map((insight) => (
                  <option key={insight.targetPlayerId} value={insight.targetPlayerId}>
                    {insight.targetName} / {insight.possibleCount}° possible
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="teal-button" onClick={shareInsight} type="button">
            <MessageSquare size={18} aria-hidden="true" />
            Send insight
          </button>
        </>
      ) : (
        <p>No shareable insight yet.</p>
      )}
      {game.receivedInsights.length > 0 ? (
        <div className="battle-list">
          {game.receivedInsights.slice(-3).map((insight, index) => (
            <div className="battle-row" key={`${insight.roundNumber}-${index}`}>
              {describeTransfer(game, insight)}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BattleHistoryPanel({ game }: { game: GameSnapshot }) {
  const rotations =
    game.shieldRotations.length > 0 ? (
      <div className="battle-list">
        {game.shieldRotations.slice(-4).map((rotation) => (
          <div className="battle-row rotation-row" key={`${rotation.playerId}-${rotation.roundNumber}`}>
            Round {rotation.roundNumber}: {rotation.playerName} rotated their shield
          </div>
        ))}
      </div>
    ) : null;

  if (game.battleHistory.length === 0) {
    return (
      <section className="phase-panel history-panel">
        <div className="panel-title">
          <Swords size={20} aria-hidden="true" />
          <h2>Battle history</h2>
        </div>
        <p>No battles recorded yet.</p>
        {rotations}
      </section>
    );
  }

  return (
    <section className="phase-panel history-panel">
      <div className="panel-title">
        <Swords size={20} aria-hidden="true" />
        <h2>Battle history</h2>
      </div>
      <div className="battle-list">
        {game.battleHistory.slice(-6).map((entry) => (
          <div className="battle-row" key={`${entry.id}-${entry.roundNumber}`}>
            Round {entry.roundNumber}: {entry.playerAName} vs {entry.playerBName},{" "}
            {entry.exchangeCount} exchanges
            {entry.deaths.length > 0 ? " / death recorded" : ""}
          </div>
        ))}
      </div>
      {rotations}
    </section>
  );
}

function PanelDrawer({
  children,
  icon,
  onClose,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="panel-drawer" role="presentation">
      <button className="drawer-backdrop" aria-label="Close panel" onClick={onClose} type="button" />
      <aside className="drawer-sheet" aria-modal="true" role="dialog" aria-label={title}>
        <header className="drawer-header">
          <div className="panel-title">
            {icon}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close panel" onClick={onClose} type="button">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="drawer-content">{children}</div>
      </aside>
    </div>
  );
}

function MobileBottomBar({
  canShareInsight,
  game,
  onOpen,
}: {
  canShareInsight: boolean;
  game: GameSnapshot;
  onOpen: (drawer: DrawerId) => void;
}) {
  const health = Math.ceil(game.currentPlayer.health);

  return (
    <nav className="mobile-bottom-bar" aria-label="Game panels">
      <div className="bottom-health">
        <Heart size={19} aria-hidden="true" />
        <strong>{health}</strong>
      </div>
      <button type="button" onClick={() => onOpen("opponents")}>
        <Users size={20} aria-hidden="true" />
        <span>{game.opponents.length}</span>
      </button>
      <button type="button" disabled={!canShareInsight} onClick={() => onOpen("share")}>
        <MessageSquare size={20} aria-hidden="true" />
        <span>{game.shareableInsights.length}</span>
      </button>
      <button type="button" onClick={() => onOpen("history")}>
        <ScrollText size={20} aria-hidden="true" />
        <span>{game.battleHistory.length}</span>
      </button>
    </nav>
  );
}

export function App() {
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(SERVER_URL || undefined, { autoConnect: false, timeout: 5000 }),
    [],
  );
  const sessionId = useMemo(getSessionId, []);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [playerName, setPlayerName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [selectedDiscardSlots, setSelectedDiscardSlots] = useState<number[]>([]);
  const [prepareMode, setPrepareMode] = useState<PrepareMode>("discard");
  const [tuningSlot, setTuningSlot] = useState<number | null>(null);
  const [tuningOffset, setTuningOffset] = useState(0);
  const [aimOpponentId, setAimOpponentId] = useState("");
  const [rotationOpen, setRotationOpen] = useState(false);
  const [rotationOffset, setRotationOffset] = useState(0);
  const [shareReceiverId, setShareReceiverId] = useState("");
  const [shareTargetId, setShareTargetId] = useState("");
  const [showBattleResult, setShowBattleResult] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerId | null>(null);
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  useEffect(() => {
    const codeFromUrl = new URLSearchParams(window.location.search).get("code");

    if (codeFromUrl) {
      setJoinCode(codeFromUrl.replace(/\D/g, "").slice(0, 4));
    }

    function handleConnect() {
      setConnectionState("connected");
      setConnectionError(null);

      // A new socket has no game attached on the server, so rejoin the last game
      // this session was in. Covers dropped connections and page reloads.
      const savedCode = window.localStorage.getItem(GAME_CODE_STORAGE_KEY);
      const linkedCode = new URLSearchParams(window.location.search).get("code");

      // A join link for another game means the player wants that game instead.
      if (!savedCode || (linkedCode && linkedCode !== savedCode)) {
        return;
      }

      socket.emit("session:resume", { sessionId, code: savedCode }, (result) => {
        if (result.ok && "game" in result) {
          setGame(result.game);
          setLobby(null);
          return;
        }

        if (result.ok && "lobby" in result) {
          setLobby(result.lobby);
          return;
        }

        window.localStorage.removeItem(GAME_CODE_STORAGE_KEY);
      });
    }

    function handleDisconnect() {
      setConnectionState("disconnected");
    }

    function handleConnectError(error: Error) {
      setConnectionState((current) =>
        current === "connected" ? "disconnected" : "connecting",
      );
      setConnectionError(error.message);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("lobby:updated", setLobby);
    function handleGameUpdate(snapshot: GameSnapshot) {
      setGame(snapshot);
      setLobby(null);
    }

    socket.on("game:updated", handleGameUpdate);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("lobby:updated", setLobby);
      socket.off("game:updated", handleGameUpdate);
      socket.disconnect();
    };
  }, [socket, sessionId]);

  const activeGameCode = game?.code ?? lobby?.code ?? null;
  const gameFinished = game?.status === "finished";

  useEffect(() => {
    if (gameFinished) {
      window.localStorage.removeItem(GAME_CODE_STORAGE_KEY);
    } else if (activeGameCode) {
      window.localStorage.setItem(GAME_CODE_STORAGE_KEY, activeGameCode);
    }
  }, [activeGameCode, gameFinished]);

  function createLobby() {
    setLobbyError(null);
    socket.emit(
      "lobby:create",
      { sessionId, name: playerName },
      (result) => {
        if (result.ok && "lobby" in result) {
          setLobby(result.lobby);
          return;
        }

        if (result.ok && "game" in result) {
          setGame(result.game);
          setLobby(null);
          return;
        }

        if (!result.ok) {
          setLobbyError(result.error);
        }
      },
    );
  }

  function joinLobby() {
    setLobbyError(null);
    socket.emit(
      "lobby:join",
      { sessionId, name: playerName, code: joinCode },
      (result) => {
        if (result.ok && "lobby" in result) {
          setLobby(result.lobby);
          return;
        }

        if (result.ok && "game" in result) {
          setGame(result.game);
          setLobby(null);
          return;
        }

        if (!result.ok) {
          setLobbyError(result.error);
        }
      },
    );
  }

  function startGame() {
    setGameError(null);
    socket.emit("game:start", (result) => {
      if (result.ok) {
        setGame(result.game);
        setLobby(null);
        return;
      }

      setGameError(result.error);
    });
  }

  function toggleDiscardSlot(slotIndex: number) {
    setSelectedDiscardSlots((current) => {
      if (current.includes(slotIndex)) {
        return current.filter((index) => index !== slotIndex);
      }

      return [...current, slotIndex];
    });
  }

  function submitPreparation() {
    const tunedMado = tuningSlot === null ? null : game?.currentPlayer.madoSlots[tuningSlot];
    const tuning =
      tuningSlot !== null && tunedMado && tuningOffset !== 0
        ? { slotIndex: tuningSlot, frequency: normalizeFrequency(tunedMado.frequency + tuningOffset) }
        : null;

    setGameError(null);
    socket.emit(
      "round:discard",
      { slotIndexes: selectedDiscardSlots, tuning },
      (result) => {
        if (result.ok) {
          setGame(result.game);
          setSelectedDiscardSlots([]);
          setPrepareMode("discard");
          setTuningSlot(null);
          setTuningOffset(0);
          return;
        }

        setGameError(result.error);
      },
    );
  }

  function submitAttack(targetPlayerId: string | null, rotation?: number) {
    setGameError(null);
    socket.emit("round:attack", { targetPlayerId, rotation: rotation ?? null }, (result) => {
      if (result.ok) {
        setGame(result.game);
        setRotationOpen(false);
        setRotationOffset(0);
        return;
      }

      setGameError(result.error);
    });
  }

  function submitBattleAction(action: ExchangeAction) {
    setGameError(null);
    socket.emit("battle:action", { action }, (result) => {
      if (result.ok) {
        setGame(result.game);
        return;
      }

      setGameError(result.error);
    });
  }

  function startNextRound() {
    setGameError(null);
    socket.emit("round:next", (result) => {
      if (result.ok) {
        setGame(result.game);
        return;
      }

      setGameError(result.error);
    });
  }

  function shareInsight() {
    if (!shareReceiverId || !shareTargetId) {
      setGameError("Choose a receiver and an insight target.");
      return;
    }

    setGameError(null);
    socket.emit(
      "insight:share",
      { receiverPlayerId: shareReceiverId, targetPlayerId: shareTargetId },
      (result) => {
        if (result.ok) {
          setGame(result.game);
          setShareReceiverId("");
          setShareTargetId("");
          setActiveDrawer(null);
          return;
        }

        setGameError(result.error);
      },
    );
  }

  const currentPlayer = lobby?.players.find(
    (player) => player.id === lobby.currentPlayerId,
  );
  const isLobbyHost = currentPlayer?.host ?? false;
  const hasSubmittedDiscard =
    game?.discardSubmittedPlayerIds.includes(game.currentPlayer.id) ?? false;
  const hasSubmittedAttack =
    game?.attackSubmittedPlayerIds.includes(game.currentPlayer.id) ?? false;
  const isGameHost = game?.hostPlayerId === game?.currentPlayer.id;
  const currentBattle = game?.currentBattle ?? null;
  const lastExchange = currentBattle?.lastExchange ?? null;
  const lastDamageTaken =
    game && lastExchange ? Math.ceil(lastExchange.damageTaken) : 0;
  const totalBattleDamageTaken = currentBattle
    ? Math.ceil(currentBattle.totalDamageTaken)
    : 0;
  const mustChooseBattleAction =
    currentBattle?.waitingForPlayerIds.includes(game?.currentPlayer.id ?? "") ?? false;
  const isFleeing =
    currentBattle?.fleeingPlayerIds.includes(game?.currentPlayer.id ?? "") ?? false;
  const canShareInsight =
    game !== null &&
    game.currentPlayer.alive &&
    !(game.status === "battle_resolution" && currentBattle?.status === "active");
  const winnerName =
    game && game.winnerPlayerId === game.currentPlayer.id
      ? game.currentPlayer.name
      : game?.opponents.find((opponent) => opponent.id === game.winnerPlayerId)?.name;
  const joinUrl = lobby
    ? `${window.location.origin}?code=${encodeURIComponent(lobby.code)}`
    : null;

  useEffect(() => {
    if (!joinUrl) {
      setQrCodeUrl(null);
      return;
    }

    void QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 180,
      color: {
        dark: "#15110a",
        light: "#f5efe4",
      },
    }).then(setQrCodeUrl);
  }, [joinUrl]);

  useEffect(() => {
    if (game?.status !== "round_cleanup" || !currentBattle?.lastExchange) {
      setShowBattleResult(false);
      return;
    }

    setShowBattleResult(true);
    const timeoutId = window.setTimeout(() => setShowBattleResult(false), 3600);

    return () => window.clearTimeout(timeoutId);
  }, [currentBattle?.id, currentBattle?.lastExchange?.index, game?.status]);

  useEffect(() => {
    if (!game) {
      setActiveDrawer(null);
    }
  }, [game]);

  const sharePanel = game ? (
    <ShareInsightPanel
      canShareInsight={canShareInsight}
      game={game}
      shareInsight={shareInsight}
      shareReceiverId={shareReceiverId}
      shareTargetId={shareTargetId}
      setShareReceiverId={setShareReceiverId}
      setShareTargetId={setShareTargetId}
    />
  ) : null;
  const phaseAnimationKey = game
    ? `${game.status}-${currentBattle?.id ?? "none"}-${currentBattle?.lastExchange?.index ?? "ready"}`
    : "lobby";

  return (
    <main className={game ? "app-shell game-shell" : "app-shell"}>
      <section className={game ? "intro-panel game-table" : "intro-panel"} aria-labelledby="app-title">
        <AppHeader game={game} lobby={lobby} onOpenRules={() => setIsRulesOpen(true)} />
        <section className="lobby-panel" aria-label="Game controls">
          {!game ? (
            <LobbyPanel
              connectionError={connectionError}
              connectionState={connectionState}
              createLobby={createLobby}
              currentPlayer={currentPlayer}
              gameError={gameError}
              isLobbyHost={isLobbyHost}
              joinCode={joinCode}
              joinLobby={joinLobby}
              joinUrl={joinUrl}
              lobby={lobby}
              lobbyError={lobbyError}
              playerName={playerName}
              qrCodeUrl={qrCodeUrl}
              setJoinCode={setJoinCode}
              setPlayerName={setPlayerName}
              startGame={startGame}
            />
          ) : (
            <div className="game-room">
              <GameHud game={game} />
              <PlayerStatusPanel game={game} />
              <PrimaryPhasePanel
                key={phaseAnimationKey}
                currentBattle={currentBattle}
                game={game}
                hasSubmittedAttack={hasSubmittedAttack}
                hasSubmittedDiscard={hasSubmittedDiscard}
                isFleeing={isFleeing}
                isGameHost={isGameHost}
                lastDamageTaken={lastDamageTaken}
                totalBattleDamageTaken={totalBattleDamageTaken}
                mustChooseBattleAction={mustChooseBattleAction}
                preparation={{
                  mode: prepareMode,
                  setMode: setPrepareMode,
                  selectedDiscardSlots,
                  toggleDiscardSlot,
                  tuningSlot,
                  setTuningSlot,
                  tuningOffset,
                  setTuningOffset,
                  aimOpponentId,
                  setAimOpponentId,
                  submit: submitPreparation,
                }}
                rotation={{
                  open: rotationOpen,
                  setOpen: setRotationOpen,
                  offset: rotationOffset,
                  setOffset: setRotationOffset,
                }}
                showBattleResult={showBattleResult}
                startNextRound={startNextRound}
                submitAttack={submitAttack}
                submitBattleAction={submitBattleAction}
                winnerName={winnerName}
              />
              <aside className="desktop-side-panels" aria-label="Secondary game panels">
                <OpponentsPanel game={game} />
                {sharePanel}
                <BattleHistoryPanel game={game} />
              </aside>
              {gameError ? <p className="form-error game-error">{gameError}</p> : null}
            </div>
          )}
        </section>
        {isRulesOpen ? <RulesModal onClose={() => setIsRulesOpen(false)} /> : null}
        {!game ? (
          <ConnectionStatus
            connectionError={connectionError}
            connectionState={connectionState}
          />
        ) : (
          <footer className="game-footer">
            <ConnectionStatus
              compact
              connectionError={connectionError}
              connectionState={connectionState}
            />
            <span>
              <Radio size={15} aria-hidden="true" />
              {game.opponents.filter((opponent) => opponent.connected).length + 1} players online
            </span>
          </footer>
        )}
      </section>
      {game ? (
        <>
          <MobileBottomBar
            canShareInsight={canShareInsight}
            game={game}
            onOpen={setActiveDrawer}
          />
          {activeDrawer === "opponents" ? (
            <PanelDrawer
              icon={<Users size={21} aria-hidden="true" />}
              onClose={() => setActiveDrawer(null)}
              title="Opponents"
            >
              <OpponentsPanel game={game} />
            </PanelDrawer>
          ) : null}
          {activeDrawer === "share" && canShareInsight ? (
            <PanelDrawer
              icon={<MessageSquare size={21} aria-hidden="true" />}
              onClose={() => setActiveDrawer(null)}
              title="Share insight"
            >
              {sharePanel}
            </PanelDrawer>
          ) : null}
          {activeDrawer === "history" ? (
            <PanelDrawer
              icon={<Swords size={21} aria-hidden="true" />}
              onClose={() => setActiveDrawer(null)}
              title="Battle history"
            >
              <BattleHistoryPanel game={game} />
            </PanelDrawer>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
