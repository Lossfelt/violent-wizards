import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ExchangeAction,
  FrequencySegment,
  GameSnapshot,
  LobbySnapshot,
  ServerHandshake,
  ServerStatus,
  ServerToClientEvents,
} from "../shared";

type ConnectionState = "connecting" | "connected" | "disconnected";

const SESSION_STORAGE_KEY = "violent-wizards-session-id";
const SERVER_URL = import.meta.env.VITE_SERVER_URL;
const WHEEL_SIZE = 72;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const WHEEL_RADIUS = 28;

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

export function App() {
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(SERVER_URL || undefined, { autoConnect: false, timeout: 5000 }),
    [],
  );
  const sessionId = useMemo(getSessionId, []);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [handshake, setHandshake] = useState<ServerHandshake | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
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
    socket.on("server:handshake", setHandshake);
    socket.on("server:status", setServerStatus);
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
      socket.off("server:handshake", setHandshake);
      socket.off("server:status", setServerStatus);
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

  return (
    <main className="app-shell">
      <section className="intro-panel" aria-labelledby="app-title">
        <header className="app-header">
          <div>
            <p className="eyebrow">Violent Wizards</p>
            <h1 id="app-title">Hide your frequency.</h1>
          </div>
          {game ? (
            <div className="header-pill">
              Round {game.roundNumber}
              <span>{game.status.replace("_", " ")}</span>
            </div>
          ) : null}
        </header>
        <section className="lobby-panel" aria-label="Game controls">
          {!lobby && !game ? (
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
              <div className="button-row">
                <button
                  className="primary-button"
                  disabled={connectionState !== "connected"}
                  onClick={createLobby}
                >
                  {connectionState === "connected" ? "Create lobby" : "Waiting for server"}
                </button>
              </div>
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
                >
                  Join
                </button>
              </div>
              {connectionState !== "connected" ? (
                <p className="form-error">
                  Realtime server is not connected. Start the app with npm run dev so
                  both Vite and the Node server are running.
                  {connectionError ? ` Last error: ${connectionError}.` : ""}
                </p>
              ) : null}
              {lobbyError ? <p className="form-error">{lobbyError}</p> : null}
            </div>
          ) : null}
          {lobby ? (
            <div className="lobby-room">
              <div className="lobby-code-block">
                <span>Lobby code</span>
                <strong>{lobby.code}</strong>
              </div>
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
                >
                  Start game
                </button>
              ) : (
                <p className="waiting-copy">Waiting for the host to start.</p>
              )}
              {gameError ? <p className="form-error">{gameError}</p> : null}
            </div>
          ) : null}
          {game ? (
            <div className="game-room">
              <div className="round-header">
                <span>Round {game.roundNumber}</span>
                <strong>{game.status.replace("_", " ")}</strong>
              </div>
              <div className="self-grid">
                <div>
                  <span>Health</span>
                  <strong>{Math.ceil(game.currentPlayer.health)}</strong>
                </div>
                <div>
                  <span>Shield</span>
                  <FrequencyWheel
                    label="Your shield frequency"
                    marker={game.currentPlayer.shieldFrequency}
                  />
                </div>
              </div>
              {game.status === "round_prepare" ? (
                <div className="phase-panel">
                  <h2>Prepare Mados</h2>
                  <p>Discard any Mados you do not want to carry into combat.</p>
                  <div className="mado-grid">
                    {game.currentPlayer.madoSlots.map((mado, index) => (
                      <button
                        className="mado-button"
                        data-selected={selectedDiscardSlots.includes(index)}
                        disabled={hasSubmittedDiscard || mado === null}
                        key={mado?.id ?? `empty-${index}`}
                        onClick={() => toggleDiscardSlot(index)}
                      >
                        <span>Slot {index + 1}</span>
                        {mado ? (
                          <FrequencyWheel label={`Mado slot ${index + 1}`} marker={mado.frequency} />
                        ) : (
                          <strong>Empty</strong>
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    className="primary-button"
                    disabled={hasSubmittedDiscard}
                    onClick={submitDiscards}
                  >
                    {hasSubmittedDiscard ? "Waiting for others" : "Confirm discard"}
                  </button>
                </div>
              ) : null}
              {game.status === "attack_declaration" ? (
                <div className="phase-panel">
                  <h2>Choose attack</h2>
                  <p>Pick one living opponent or pass this round.</p>
                  <div className="target-list">
                    {game.opponents
                      .filter((opponent) => opponent.alive)
                      .map((opponent) => (
                        <button
                          disabled={hasSubmittedAttack}
                          key={opponent.id}
                          onClick={() => submitAttack(opponent.id)}
                        >
                          Attack {opponent.name}
                        </button>
                      ))}
                    <button disabled={hasSubmittedAttack} onClick={() => submitAttack(null)}>
                      Pass
                    </button>
                  </div>
                  {hasSubmittedAttack ? (
                    <p className="waiting-copy">Waiting for declarations.</p>
                  ) : null}
                </div>
              ) : null}
              {game.status === "battle_resolution" ? (
                <div className="phase-panel">
                  <h2>{currentBattle ? `Battle vs ${currentBattle.opponentName}` : "Matched battles"}</h2>
                  {currentBattle?.status === "active" ? (
                    <>
                      {lastExchange ? (
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
                          <div className="mado-grid">
                            {game.currentPlayer.madoSlots.map((mado, index) => (
                              <button
                                className="mado-button"
                                disabled={
                                  mado === null ||
                                  currentBattle.usedMadoSlotIndexes.includes(index)
                                }
                                key={mado?.id ?? `battle-empty-${index}`}
                                onClick={() =>
                                  submitBattleAction({
                                    type: "mado",
                                    madoSlotIndex: index,
                                    madoId: mado?.id,
                                  })
                                }
                              >
                                <span>Slot {index + 1}</span>
                                {mado ? (
                                  <FrequencyWheel
                                    label={`Mado slot ${index + 1}`}
                                    marker={mado.frequency}
                                  />
                                ) : (
                                  <strong>Empty</strong>
                                )}
                              </button>
                            ))}
                          </div>
                          {currentBattle.exchangeCount > 0 ? (
                            <div className="target-list">
                              <button onClick={() => submitBattleAction({ type: "flee" })}>
                                Flee
                              </button>
                              {currentBattle.fleeingPlayerIds.includes(
                                currentBattle.opponentId,
                              ) ? (
                                <button onClick={() => submitBattleAction({ type: "end" })}>
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
                </div>
              ) : null}
              {game.status === "round_cleanup" ? (
                <div className="phase-panel result-phase">
                  {showBattleResult && currentBattle?.lastExchange ? (
                    <>
                      <h2>Battle result</h2>
                      <div className="battle-result-card large">
                        <span>Final exchange</span>
                        <strong>{lastDamageTaken} damage taken</strong>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2>Round committed</h2>
                      <p>All battle results have been applied.</p>
                      {isGameHost ? (
                        <button className="primary-button" onClick={startNextRound}>
                          Start next round
                        </button>
                      ) : (
                        <p className="waiting-copy">
                          Waiting for the host to start the next round.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : null}
              {game.status === "finished" ? (
                <div className="phase-panel">
                  <h2>Game finished</h2>
                  <p>
                    {game.draw
                      ? "The game ended in a draw."
                      : `${winnerName ?? "Unknown"} wins.`}
                  </p>
                </div>
              ) : null}
              <div className="player-list" aria-label="Opponents">
                {game.opponents.map((opponent) => (
                  <div className="player-row" key={opponent.id}>
                    <span>{opponent.name}</span>
                    <FrequencyWheel
                      label={`Known shield range for ${opponent.name}`}
                      segment={opponent.insight.segment}
                    />
                    <small>
                      {opponent.alive ? "alive" : "dead"}
                      {" / "}
                      {opponent.connected ? "online" : "offline"}
                      {" / "}
                      insight {opponent.insight.level}
                    </small>
                  </div>
                ))}
              </div>
              {canShareInsight ? (
                <div className="phase-panel">
                  <h2>Share insight</h2>
                  {game.shareableInsights.length > 0 ? (
                    <>
                      <div className="join-row">
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
                              <option
                                key={insight.targetPlayerId}
                                value={insight.targetPlayerId}
                              >
                                {insight.targetName} / level {insight.level}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button onClick={shareInsight}>Send insight</button>
                    </>
                  ) : (
                    <p>No shareable insight yet.</p>
                  )}
                  {game.receivedInsights.length > 0 ? (
                    <div className="battle-list">
                      {game.receivedInsights.slice(-3).map((insight, index) => (
                        <div className="battle-row" key={`${insight.roundNumber}-${index}`}>
                          Received level {insight.level} insight in round{" "}
                          {insight.roundNumber}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {game.battleHistory.length > 0 ? (
                <div className="phase-panel">
                  <h2>Battle history</h2>
                  <div className="battle-list">
                    {game.battleHistory.slice(-6).map((entry) => (
                      <div className="battle-row" key={`${entry.id}-${entry.roundNumber}`}>
                        Round {entry.roundNumber}: {entry.playerAName} vs{" "}
                        {entry.playerBName}, {entry.exchangeCount} exchanges
                        {entry.deaths.length > 0 ? " / death recorded" : ""}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {gameError ? <p className="form-error">{gameError}</p> : null}
            </div>
          ) : null}
        </section>
        <details className="status-details" open={!game}>
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
              <dt>Socket target</dt>
              <dd>{SERVER_URL || "/socket.io proxy"}</dd>
            </div>
            <div>
              <dt>Socket ID</dt>
              <dd>{handshake?.socketId ?? "Waiting"}</dd>
            </div>
            <div>
              <dt>Clients</dt>
              <dd>{serverStatus?.connectedClients ?? 0}</dd>
            </div>
            <div>
              <dt>Server time</dt>
              <dd>{handshake?.serverTime ?? "Waiting"}</dd>
            </div>
          </dl>
        </details>
      </section>
    </main>
  );
}
