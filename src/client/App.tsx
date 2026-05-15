import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import {
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
  ExchangeAction,
  FrequencySegment,
  GameSnapshot,
  LobbySnapshot,
  Mado,
  ServerToClientEvents,
} from "../shared";
import { MAX_MADOS, STARTING_HEALTH } from "../shared";

type ConnectionState = "connecting" | "connected" | "disconnected";
type DrawerId = "opponents" | "share" | "history";

const SESSION_STORAGE_KEY = "violent-wizards-session-id";
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

function segmentPath(segment: FrequencySegment) {
  if (segment.level === 0) {
    return undefined;
  }

  const start = polarPoint(segment.start);
  const end = polarPoint(segment.end);
  const largeArcFlag = segment.end - segment.start > 180 ? 1 : 0;

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
  marker,
  segment,
  label,
}: {
  marker?: number;
  segment?: FrequencySegment;
  label: string;
}) {
  const markerPoint = marker === undefined ? null : polarPoint(marker, WHEEL_RADIUS + 1);
  const path = segment ? segmentPath(segment) : undefined;

  return (
    <svg
      aria-label={label}
      className="frequency-wheel"
      role="img"
      viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
    >
      <circle className="wheel-ring" cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_RADIUS} />
      {segment?.level === 0 ? (
        <circle className="wheel-segment" cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_RADIUS} />
      ) : null}
      {path ? <path className="wheel-segment" d={path} /> : null}
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
}: {
  game: GameSnapshot | null;
  lobby: LobbySnapshot | null;
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
      {code ? (
        <div className="room-code">
          <span>Room code</span>
          <strong>{code}</strong>
          <button className="icon-button" type="button" aria-label="Copy room code" onClick={copyCode}>
            <Copy size={17} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </header>
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
              key={mado?.id ?? `mini-${index}`}
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
  onSlotClick,
  selectedSlotIndexes = [],
  slots,
}: {
  disabled?: boolean;
  disabledSlotIndexes?: number[];
  onSlotClick?: (slotIndex: number, mado: Mado) => void;
  selectedSlotIndexes?: number[];
  slots: Array<Mado | null>;
}) {
  return (
    <div className="mado-grid">
      {slots.map((mado, index) => {
        const isDisabled = disabled || mado === null || disabledSlotIndexes.includes(index);

        return (
          <button
            className="mado-button"
            data-selected={selectedSlotIndexes.includes(index)}
            disabled={isDisabled}
            key={mado?.id ?? `empty-${index}`}
            onClick={() => {
              if (mado) {
                onSlotClick?.(index, mado);
              }
            }}
            type="button"
          >
            <strong>{index + 1}</strong>
            {mado ? (
              <FrequencyWheel label={`Mado slot ${index + 1}`} marker={mado.frequency} />
            ) : (
              <span>Empty</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PrimaryPhasePanel({
  currentBattle,
  game,
  hasSubmittedAttack,
  hasSubmittedDiscard,
  isFleeing,
  isGameHost,
  lastDamageTaken,
  mustChooseBattleAction,
  selectedDiscardSlots,
  showBattleResult,
  startNextRound,
  submitAttack,
  submitBattleAction,
  submitDiscards,
  toggleDiscardSlot,
  winnerName,
}: {
  currentBattle: GameSnapshot["currentBattle"];
  game: GameSnapshot;
  hasSubmittedAttack: boolean;
  hasSubmittedDiscard: boolean;
  isFleeing: boolean;
  isGameHost: boolean;
  lastDamageTaken: number;
  mustChooseBattleAction: boolean;
  selectedDiscardSlots: number[];
  showBattleResult: boolean;
  startNextRound: () => void;
  submitAttack: (targetPlayerId: string | null) => void;
  submitBattleAction: (action: ExchangeAction) => void;
  submitDiscards: () => void;
  toggleDiscardSlot: (slotIndex: number) => void;
  winnerName: string | undefined;
}) {
  if (game.status === "round_prepare") {
    return (
      <section className="phase-panel primary-phase">
        <div className="phase-heading">
          <h2>Prepare Mados</h2>
          <p>Choose which Mados to discard this round.</p>
        </div>
        <MadoSlotGrid
          disabled={hasSubmittedDiscard}
          onSlotClick={toggleDiscardSlot}
          selectedSlotIndexes={selectedDiscardSlots}
          slots={game.currentPlayer.madoSlots}
        />
        <button
          className="primary-button action-button"
          disabled={hasSubmittedDiscard}
          onClick={submitDiscards}
          type="button"
        >
          <span>{hasSubmittedDiscard ? "Waiting for others" : "Confirm discard"}</span>
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </section>
    );
  }

  if (game.status === "attack_declaration") {
    return (
      <section className="phase-panel primary-phase">
        <div className="phase-heading">
          <h2>Choose attack</h2>
          <p>Pick one living opponent or pass this round.</p>
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
        </div>
        {hasSubmittedAttack ? (
          <p className="waiting-copy">Waiting for declarations.</p>
        ) : null}
      </section>
    );
  }

  if (game.status === "battle_resolution") {
    return (
      <section className="phase-panel primary-phase">
        <div className="phase-heading">
          <h2>{currentBattle ? `Battle vs ${currentBattle.opponentName}` : "Matched battles"}</h2>
          <p>Resolve declared battles without revealing hidden shield values.</p>
        </div>
        {currentBattle?.status === "active" ? (
          <>
            {currentBattle.lastExchange ? (
              <div className="battle-result-card">
                <span>Last exchange</span>
                <strong>{lastDamageTaken} damage taken</strong>
              </div>
            ) : null}
            {isFleeing ? (
              <p className="waiting-copy">You are fleeing.</p>
            ) : mustChooseBattleAction ? (
              <>
                <p>
                  {currentBattle.exchangeCount === 0
                    ? "Choose a Mado for the first exchange."
                    : "Choose a Mado, flee, or end if your opponent is fleeing."}
                </p>
                <MadoSlotGrid
                  disabledSlotIndexes={currentBattle.usedMadoSlotIndexes}
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
      <section className="phase-panel primary-phase result-phase">
        {showBattleResult && currentBattle?.lastExchange ? (
          <>
            <div className="phase-heading">
              <h2>Battle result</h2>
              <p>The final exchange has been committed.</p>
            </div>
            <div className="battle-result-card large">
              <span>Final exchange</span>
              <strong>{lastDamageTaken} damage taken</strong>
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
    <section className="phase-panel primary-phase">
      <div className="phase-heading">
        <h2>Game finished</h2>
        <p>{game.draw ? "The game ended in a draw." : `${winnerName ?? "Unknown"} wins.`}</p>
      </div>
    </section>
  );
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
              label={`Known shield range for ${opponent.name}`}
              segment={opponent.insight.segment}
            />
            <small className="insight-copy">
              insight {opponent.insight.level}
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
                    {insight.targetName} / level {insight.level}
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
              Received level {insight.level} insight in round {insight.roundNumber}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BattleHistoryPanel({ game }: { game: GameSnapshot }) {
  if (game.battleHistory.length === 0) {
    return (
      <section className="phase-panel history-panel">
        <div className="panel-title">
          <Swords size={20} aria-hidden="true" />
          <h2>Battle history</h2>
        </div>
        <p>No battles recorded yet.</p>
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
  const [shareReceiverId, setShareReceiverId] = useState("");
  const [shareTargetId, setShareTargetId] = useState("");
  const [showBattleResult, setShowBattleResult] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerId | null>(null);

  useEffect(() => {
    const codeFromUrl = new URLSearchParams(window.location.search).get("code");

    if (codeFromUrl) {
      setJoinCode(codeFromUrl.replace(/\D/g, "").slice(0, 4));
    }

    function handleConnect() {
      setConnectionState("connected");
      setConnectionError(null);
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
  }, [socket]);

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

  function submitDiscards() {
    setGameError(null);
    socket.emit(
      "round:discard",
      { slotIndexes: selectedDiscardSlots },
      (result) => {
        if (result.ok) {
          setGame(result.game);
          setSelectedDiscardSlots([]);
          return;
        }

        setGameError(result.error);
      },
    );
  }

  function submitAttack(targetPlayerId: string | null) {
    setGameError(null);
    socket.emit("round:attack", { targetPlayerId }, (result) => {
      if (result.ok) {
        setGame(result.game);
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
    const timeoutId = window.setTimeout(() => setShowBattleResult(false), 2400);

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

  return (
    <main className={game ? "app-shell game-shell" : "app-shell"}>
      <section className={game ? "intro-panel game-table" : "intro-panel"} aria-labelledby="app-title">
        <AppHeader game={game} lobby={lobby} />
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
              <PlayerStatusPanel game={game} />
              <PrimaryPhasePanel
                currentBattle={currentBattle}
                game={game}
                hasSubmittedAttack={hasSubmittedAttack}
                hasSubmittedDiscard={hasSubmittedDiscard}
                isFleeing={isFleeing}
                isGameHost={isGameHost}
                lastDamageTaken={lastDamageTaken}
                mustChooseBattleAction={mustChooseBattleAction}
                selectedDiscardSlots={selectedDiscardSlots}
                showBattleResult={showBattleResult}
                startNextRound={startNextRound}
                submitAttack={submitAttack}
                submitBattleAction={submitBattleAction}
                submitDiscards={submitDiscards}
                toggleDiscardSlot={toggleDiscardSlot}
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
