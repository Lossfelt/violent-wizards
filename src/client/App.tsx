import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { BookOpen, ChevronRight, Copy, Users, Wifi, WifiOff, X } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameActionResult,
  GameSnapshot,
  LobbySnapshot,
  ServerToClientEvents,
  TableActionResult,
  TableSnapshot,
} from "../shared";
import { MADO_TUNE_RANGE, SHIELD_DRIFT_MAX, SHIELD_ROTATION_RANGE } from "../shared";
import { GameScreen, type GameActions } from "./game/GameScreen";
import { TableScreen } from "./table/TableScreen";
import { RoundTimePicker } from "./RoundTimePicker";

type ConnectionState = "connecting" | "connected" | "disconnected";

const SESSION_STORAGE_KEY = "violent-wizards-session-id";
const GAME_CODE_STORAGE_KEY = "violent-wizards-game-code";
const TABLE_CODE_STORAGE_KEY = "violent-wizards-table-code";
const SERVER_URL = import.meta.env.VITE_SERVER_URL;

// crypto.randomUUID only exists in secure contexts (https or localhost). Phones that join a
// local game over the network open plain http, so fall back to getRandomValues there.
function createSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getSessionId() {
  const existingSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (existingSessionId) {
    return existingSessionId;
  }

  const sessionId = createSessionId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

function AppHeader({
  lobby,
  onOpenRules,
}: {
  lobby: LobbySnapshot | null;
  onOpenRules: () => void;
}) {
  const code = lobby?.code ?? null;

  function copyCode() {
    if (code) {
      void navigator.clipboard?.writeText(code);
    }
  }

  return (
    <header className="app-header">
      <div className="brand-block">
        <h1 id="app-title">Hide your frequency.</h1>
        <p className="brand-title">Violent Wizards</p>
      </div>
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
            <h3>Reading the dial</h3>
            <p>
              Your Mados orbit inside the dial at their frequencies. Every opponent whose shield you
              have narrowed down gets a coloured band on the outer edge. Bright bands are fresh
              knowledge, faded bands are old. Tap a name to focus on one opponent. Your own shield is
              hidden until you hold the shield button, so nobody can read it over your shoulder.
              The small table in the corner shows who has fought whom.
            </p>
          </section>
          <section className="rules-section">
            <h3>Round flow</h3>
            <ol>
              <li>
                Prepare: discard Mados (empty slots refill next round) and tune one Mado up to{" "}
                {MADO_TUNE_RANGE}° in either direction.
              </li>
              <li>Declare: attack one living opponent, stay hidden, or rotate your shield.</li>
              <li>Warfare: matched opponents resolve simultaneous exchanges.</li>
              <li>Afterwards spent Mados are removed, dead players fall, and the next round starts after a short break.</li>
            </ol>
            <p>
              You prepare and declare at your own pace. Every round has a time limit: planning
              must be done within the first 40% of it, battles by the end. Miss a deadline and
              standing orders take over for the rest of the round: keep every Mado, stay hidden,
              and if attacked fire the first free Mado and flee.
            </p>
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
              Instead of attacking you can rotate your own shield up to {SHIELD_ROTATION_RANGE}°. It happens at
              once: everyone senses it and loses precision on you before the battles, but if you are
              attacked that round you can only flee.
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
  createTable,
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
  setRoundMinutes,
  startGame,
  gameError,
}: {
  connectionError: string | null;
  connectionState: ConnectionState;
  createLobby: () => void;
  createTable: () => void;
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
  setRoundMinutes: (minutes: number) => void;
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
        <div className="table-offer">
          <p>
            Hosting a party? Put the lobby on a TV or laptop everyone can see. Guests join from
            their phones, and the screen shows the war once it starts.
          </p>
          <button disabled={connectionState !== "connected"} onClick={createTable} type="button">
            Use this device as the table screen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-room">
      {lobby.message ? <blockquote className="host-message">{lobby.message}</blockquote> : null}
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
      <RoundTimePicker minutes={lobby.roundMinutes} onChange={isLobbyHost ? setRoundMinutes : undefined} />
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
        <p className="waiting-copy">
          {lobby.tableHosted
            ? "Waiting for the game to be started from the table screen."
            : "Waiting for the host to start."}
        </p>
      )}
      {gameError ? <p className="form-error">{gameError}</p> : null}
    </div>
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
  const [table, setTable] = useState<TableSnapshot | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  useEffect(() => {
    const codeFromUrl = new URLSearchParams(window.location.search).get("code");

    if (codeFromUrl) {
      setJoinCode(codeFromUrl.replace(/\D/g, "").slice(0, 4));
    }

    function handleConnect() {
      setConnectionState("connected");
      setConnectionError(null);

      // A device that hosts a table screen goes back to being that screen.
      const savedTable = window.localStorage.getItem(TABLE_CODE_STORAGE_KEY);

      if (savedTable) {
        socket.emit("table:resume", { sessionId, code: savedTable }, (result) => {
          if (result.ok) {
            setTable(result.table);
          } else {
            window.localStorage.removeItem(TABLE_CODE_STORAGE_KEY);
          }
        });
        return;
      }

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
    socket.on("table:updated", setTable);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("lobby:updated", setLobby);
      socket.off("game:updated", handleGameUpdate);
      socket.off("table:updated", setTable);
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

  const tableCode = table?.code ?? null;

  useEffect(() => {
    if (tableCode) {
      window.localStorage.setItem(TABLE_CODE_STORAGE_KEY, tableCode);
    }
  }, [tableCode]);

  function handleTableResult(result: TableActionResult) {
    if (result.ok) {
      setTable(result.table);
      setGameError(null);
      return true;
    }

    setGameError(result.error);
    return false;
  }

  function createTable() {
    setGameError(null);
    socket.emit("table:create", { sessionId }, handleTableResult);
  }

  const tableActions = {
    saveMessage: (message: string) =>
      new Promise<boolean>((resolve) =>
        socket.emit("table:message", { message }, (result) => resolve(handleTableResult(result))),
      ),
    start: () => socket.emit("table:start", handleTableResult),
    setRoundMinutes: (minutes: number) =>
      socket.emit("table:roundMinutes", { minutes }, handleTableResult),
  };

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

  function setRoundMinutes(minutes: number) {
    socket.emit("lobby:roundMinutes", { minutes }, (result) => {
      if (result.ok && "lobby" in result) {
        setLobby(result.lobby);
      } else if (!result.ok) {
        setGameError(result.error);
      }
    });
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

  // Applies a game action's result and reports whether it succeeded.
  function handleGameResult(result: GameActionResult) {
    if (result.ok) {
      setGame(result.game);
      setGameError(null);
      return true;
    }

    setGameError(result.error);
    return false;
  }

  const gameActions: GameActions = {
    prepare: (slotIndexes, tuning) =>
      new Promise((resolve) =>
        socket.emit("round:discard", { slotIndexes, tuning }, (result) => resolve(handleGameResult(result))),
      ),
    attack: (targetPlayerId, rotation) =>
      new Promise((resolve) =>
        socket.emit("round:attack", { targetPlayerId, rotation: rotation ?? null }, (result) =>
          resolve(handleGameResult(result)),
        ),
      ),
    battle: (action) => socket.emit("battle:action", { action }, handleGameResult),
    nextRound: () => socket.emit("round:next", handleGameResult),
    share: (receiverPlayerId, targetPlayerId) =>
      new Promise((resolve) =>
        socket.emit("insight:share", { receiverPlayerId, targetPlayerId }, (result) =>
          resolve(handleGameResult(result)),
        ),
      ),
  };

  const currentPlayer = lobby?.players.find(
    (player) => player.id === lobby.currentPlayerId,
  );
  const isLobbyHost = currentPlayer?.host ?? false;
  const inviteCode = table?.status === "lobby" ? table.code : lobby?.code ?? null;
  const joinUrl = inviteCode
    ? `${window.location.origin}?code=${encodeURIComponent(inviteCode)}`
    : null;

  useEffect(() => {
    if (!joinUrl) {
      setQrCodeUrl(null);
      return;
    }

    void QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: table ? 360 : 180,
      color: {
        dark: "#15110a",
        light: "#f5efe4",
      },
    }).then(setQrCodeUrl);
  }, [joinUrl, table !== null]);

  const rules = isRulesOpen ? <RulesModal onClose={() => setIsRulesOpen(false)} /> : null;

  if (table) {
    return (
      <main className="table-shell">
        <TableScreen
          connected={connectionState === "connected"}
          error={gameError}
          joinUrl={joinUrl ?? window.location.origin}
          onNewGame={createTable}
          onOpenRules={() => setIsRulesOpen(true)}
          onSaveMessage={tableActions.saveMessage}
          onSetRoundMinutes={tableActions.setRoundMinutes}
          onStart={tableActions.start}
          qrCodeUrl={qrCodeUrl}
          table={table}
        />
        {rules}
      </main>
    );
  }

  if (game) {
    return (
      <main className="game-shell">
        <GameScreen
          actions={gameActions}
          connected={connectionState === "connected"}
          error={gameError}
          game={game}
          onOpenRules={() => setIsRulesOpen(true)}
        />
        {rules}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="intro-panel" aria-labelledby="app-title">
        <AppHeader lobby={lobby} onOpenRules={() => setIsRulesOpen(true)} />
        <section className="lobby-panel" aria-label="Game controls">
          <LobbyPanel
            connectionError={connectionError}
            connectionState={connectionState}
            createLobby={createLobby}
            createTable={createTable}
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
            setRoundMinutes={setRoundMinutes}
            startGame={startGame}
          />
        </section>
        {rules}
        <ConnectionStatus connectionError={connectionError} connectionState={connectionState} />
      </section>
    </main>
  );
}
