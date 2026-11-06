import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import type { TableSnapshot } from "../../shared";
import { seatColor } from "../game/dialMath";
import { FeudList, FeudTable, feudDataFromTable } from "../game/FeudTable";
import { Sigil } from "../game/Sigil";
import { RoundTimePicker } from "../RoundTimePicker";
import { formatClock, useCountdown } from "../useCountdown";
import "../game/game.css";
import "./table.css";

type Props = {
  table: TableSnapshot;
  joinUrl: string;
  qrCodeUrl: string | null;
  connected: boolean;
  error: string | null;
  onSaveMessage: (message: string) => Promise<boolean>;
  onSetRoundMinutes: (minutes: number) => void;
  onStart: () => void;
  onNewGame: () => void;
  onOpenRules: () => void;
};

const PHASES: Array<[TableSnapshot["status"], string, string]> = [
  ["round_prepare", "Prepare", "Wizards are preparing their Mados and choosing whom to attack."],
  ["attack_declaration", "Declare", "Wizards are choosing whom to attack."],
  ["battle_resolution", "Warfare", "Battles are being fought."],
];

const DEADLINE_LABEL: Partial<Record<TableSnapshot["status"], string>> = {
  round_prepare: "Planning ends in",
  attack_declaration: "Planning ends in",
  battle_resolution: "Round ends in",
};

function MessageEditor({ message, onSave }: { message: string; onSave: (message: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);

  useEffect(() => {
    if (!editing) setDraft(message);
  }, [message, editing]);

  if (!editing) {
    return (
      <div className="table-message">
        {message ? <p>{message}</p> : <p className="table-message-empty">No message yet.</p>}
        <button className="table-quiet" onClick={() => setEditing(true)} type="button">
          {message ? "Edit message" : "Write a message for your guests"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="table-message-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onSave(draft)) setEditing(false);
      }}
    >
      <textarea
        autoFocus
        maxLength={280}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="The war begins at 21:00. Grab a drink and join before then."
        rows={3}
        value={draft}
      />
      <div className="table-row">
        <button onClick={() => setEditing(false)} type="button">
          Cancel
        </button>
        <button className="table-primary" type="submit">
          Show message
        </button>
      </div>
    </form>
  );
}

// Phones cannot open a link to this computer's own loopback address.
function isLoopback(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "[::1]" || host.startsWith("127.");
  } catch {
    return false;
  }
}

function TableLobby({ table, joinUrl, qrCodeUrl, onSaveMessage, onSetRoundMinutes, onStart }: Props) {
  return (
    <div className="table-lobby">
      <section className="table-invite">
        <p className="table-kicker">A hidden war is about to begin</p>
        <h1>Violent Wizards</h1>
        <MessageEditor message={table.message} onSave={onSaveMessage} />
      </section>
      <section className="table-join">
        {qrCodeUrl ? <img alt={`QR code to join game ${table.code}`} src={qrCodeUrl} /> : null}
        <p>Scan to join, or go to</p>
        <code>{joinUrl}</code>
        <p>
          and enter code <b className="table-code">{table.code}</b>
        </p>
        {isLoopback(joinUrl) ? (
          <p className="table-warning">
            This link only works on this computer. Open the table screen through the computer's
            network address (the "Network" line when the server starts) so phones can join.
          </p>
        ) : null}
      </section>
      <section className="table-roster">
        <h2>
          {table.players.length === 0
            ? "Nobody has joined yet"
            : `${table.players.length} wizard${table.players.length === 1 ? "" : "s"} ready to fight`}
        </h2>
        <ul>
          {table.players.map((player) => (
            <li data-online={player.connected} key={player.id} style={{ borderColor: seatColor(player.seat) }}>
              <Sigil seat={player.seat} size={34} />
              {player.name}
            </li>
          ))}
        </ul>
        <RoundTimePicker minutes={table.roundMinutes} onChange={onSetRoundMinutes} />
        <button className="table-primary" disabled={table.players.length < 2} onClick={onStart} type="button">
          {table.players.length < 2 ? "Waiting for at least two wizards" : "Start the war"}
        </button>
      </section>
    </div>
  );
}

function TableGame({ table, onNewGame }: Props) {
  const seconds = useCountdown(table.status === "round_cleanup" ? table.nextRoundInMs : null);
  const deadline = useCountdown(table.phaseEndsInMs);
  const deadlineLabel = DEADLINE_LABEL[table.status];
  const feuds = feudDataFromTable(table);
  const phase = PHASES.find(([status]) => status === table.status);
  const living = table.players.filter((player) => player.alive);
  const ready = living.filter((player) => player.ready).length;
  const winner = table.players.find((player) => player.id === table.winnerPlayerId);
  const nameOf = (id: string) => table.players.find((player) => player.id === id)?.name ?? "Unknown";

  return (
    <div className="table-game">
      <header className="table-status">
        <span className="table-round">Round {table.roundNumber}</span>
        <ol>
          {PHASES.map(([status, label], index) => (
            <li data-on={table.status === status} key={status}>
              <span className="table-phase-numeral">{["I", "II", "III"][index]}</span>
              {label}
            </li>
          ))}
        </ol>
        <p className="table-status-text">
          {table.status === "finished"
            ? table.draw
              ? "Nobody survived. The war ends in a draw."
              : `${winner?.name ?? "Someone"} is the last wizard standing.`
            : table.status === "round_cleanup"
              ? seconds !== null
                ? `The round is over. Next round in ${seconds} s.`
                : "The round is over."
              : `${phase?.[2] ?? ""} ${ready} of ${living.length} done.`}
        </p>
        {deadlineLabel && deadline !== null ? (
          <p className="table-deadline" data-urgent={deadline <= 15}>
            {deadlineLabel} <b>{formatClock(deadline)}</b>
          </p>
        ) : null}
      </header>

      <section className="table-board">
        <FeudTable data={feuds} focusId={null} showNumbers size="full" />
      </section>

      <section className="table-panel table-wizards">
        <h2>Wizards</h2>
        <ul className="table-players">
          {table.players.map((player) => (
            <li data-alive={player.alive} key={player.id}>
              <Sigil seat={player.seat} size={26} />
              <b>{player.name}</b>
              <span>
                {!player.alive
                  ? "fallen"
                  : player.standingOrders && table.status !== "finished"
                    ? "standing orders"
                    : !player.connected
                    ? "offline"
                    : player.ready && table.status !== "round_cleanup" && table.status !== "finished"
                      ? "done ✓"
                      : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="table-panel table-side">
        {table.battles.length > 0 ? (
          <>
            <h2>{table.status === "battle_resolution" ? "Battles now" : "Battles this round"}</h2>
            <ul className="table-battles">
              {table.battles.map((battle) => (
                <li data-finished={battle.finished} key={battle.id}>
                  <b>
                    {nameOf(battle.playerAId)} vs {nameOf(battle.playerBId)}
                  </b>
                  <span>
                    {battle.exchangeCount} exchange{battle.exchangeCount === 1 ? "" : "s"}
                    {battle.finished ? " · over" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h2>The war so far</h2>
        <FeudList data={feuds} />

        {table.status === "finished" ? (
          <button className="table-primary" onClick={onNewGame} type="button">
            Host a new game
          </button>
        ) : null}
      </section>
    </div>
  );
}

// The shared screen at the party: invitation and lobby first, then the public state of the war.
export function TableScreen(props: Props) {
  return (
    <div className="table-screen">
      <header className="table-top">
        <span>Table screen · game {props.table.code}</span>
        <span className="game-connection" data-connected={props.connected} />
        <button aria-label="Rules" className="table-icon-button" onClick={props.onOpenRules} type="button">
          <BookOpen aria-hidden="true" size={18} />
        </button>
      </header>
      {props.table.status === "lobby" ? <TableLobby {...props} /> : <TableGame {...props} />}
      {props.error ? <p className="table-error" role="alert">{props.error}</p> : null}
    </div>
  );
}
