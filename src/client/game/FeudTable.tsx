import type { GameSnapshot } from "../../shared";
import { MY_COLOR, opponentColor, polar, roundsAgo } from "./dialMath";

type Feud = { a: string; b: string; count: number; lastRound: number };

// Several fights between the same two wizards become one line.
function feudsOf(game: GameSnapshot): Feud[] {
  const byPair = new Map<string, Feud>();

  for (const entry of game.battleHistory) {
    const [a, b] = [entry.playerAName, entry.playerBName].sort();
    const key = `${a}|${b}`;
    const feud = byPair.get(key) ?? { a: a!, b: b!, count: 0, lastRound: 0 };
    feud.count += 1;
    feud.lastRound = Math.max(feud.lastRound, entry.roundNumber);
    byPair.set(key, feud);
  }

  return [...byPair.values()].sort((x, y) => y.lastRound - x.lastRound);
}

function seatsOf(game: GameSnapshot, cx: number, cy: number, radius: number) {
  const me = game.currentPlayer;
  const people = [
    { id: me.id, name: me.name, label: "You", alive: me.alive, color: MY_COLOR },
    ...game.opponents.map((opponent) => ({
      id: opponent.id,
      name: opponent.name,
      label: opponent.name,
      alive: opponent.alive,
      color: opponentColor(game, opponent.id),
    })),
  ];

  return people.map((person, index) => ({
    ...person,
    ...polar(cx, cy, radius, 180 + (index * 360) / people.length),
  }));
}

type TableProps = {
  game: GameSnapshot;
  size: "mini" | "full";
  focusId: string | null;
  showNumbers?: boolean;
  onSelect?: (opponentId: string) => void;
};

// Who has fought whom, drawn as a round table. Lines fade with age; live fights pulse.
export function FeudTable({ game, size, focusId, showNumbers = false, onSelect }: TableProps) {
  const full = size === "full";
  const w = full ? 320 : 112;
  const h = full ? 280 : 96;
  const seats = seatsOf(game, w / 2, h / 2, full ? 104 : 34);
  const byName = new Map(seats.map((seat) => [seat.name, seat]));
  const byId = new Map(seats.map((seat) => [seat.id, seat]));

  return (
    <svg className="feud-table" data-size={size} role="group" aria-label="Who has fought whom" viewBox={`0 0 ${w} ${h}`}>
      {feudsOf(game).map((feud) => {
        const a = byName.get(feud.a);
        const b = byName.get(feud.b);
        if (!a || !b) return null;
        const age = game.roundNumber - feud.lastRound;
        return (
          <g key={`${feud.a}|${feud.b}`}>
            <line
              className="feud-line"
              strokeOpacity={Math.max(0.18, 0.85 - age * 0.22)}
              strokeWidth={full ? 1.5 + feud.count : 1 + feud.count * 0.5}
              x1={a.x}
              x2={b.x}
              y1={a.y}
              y2={b.y}
            />
            {full && showNumbers ? (
              <text className="feud-label" textAnchor="middle" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 4}>
                {feud.count}× · R{feud.lastRound}
              </text>
            ) : null}
          </g>
        );
      })}
      {game.status === "battle_resolution"
        ? game.pendingBattles.map((entry) => {
            const a = byId.get(entry.playerAId);
            const b = byId.get(entry.playerBId);
            if (!a || !b) return null;
            return <line className="feud-line-live" key={entry.id} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
          })
        : null}
      {seats.map((seat) => {
        const selectable = full && seat.id !== game.currentPlayer.id && seat.alive && onSelect;
        return (
          <g
            className="feud-seat"
            data-dead={!seat.alive}
            data-focus={focusId === seat.id}
            data-selectable={Boolean(selectable)}
            key={seat.id}
            onClick={(event) => {
              if (!full) return;
              event.stopPropagation();
              if (selectable) onSelect(seat.id);
            }}
          >
            <circle cx={seat.x} cy={seat.y} r={full ? 20 : 9} stroke={seat.color} />
            <text
              className="feud-seat-initial"
              dominantBaseline="central"
              fontSize={full ? 15 : 8}
              textAnchor="middle"
              x={seat.x}
              y={seat.y}
            >
              {seat.alive ? seat.label[0] : "✕"}
            </text>
            {full ? (
              <text className="feud-seat-name" textAnchor="middle" x={seat.x} y={seat.y + 34}>
                {seat.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function FeudList({ game }: { game: GameSnapshot }) {
  const me = game.currentPlayer.name;
  const name = (value: string) => (value === me ? "You" : value);
  const completedRounds = game.status === "round_cleanup" || game.status === "finished"
    ? game.roundNumber
    : game.roundNumber - 1;

  return (
    <ul className="feud-list">
      {game.status === "battle_resolution"
        ? game.pendingBattles.map((entry) => (
            <li data-live="true" key={entry.id}>
              <b>
                {name(entry.playerAName)} vs {name(entry.playerBName)}
              </b>
              <span>fighting now</span>
            </li>
          ))
        : null}
      {feudsOf(game).map((feud) => {
        const [first, second] = feud.b === me ? [feud.b, feud.a] : [feud.a, feud.b];
        return (
          <li key={`${feud.a}|${feud.b}`}>
            <b>
              {name(first)} vs {name(second)}
            </b>
            <span>
              {feud.count} fight{feud.count === 1 ? "" : "s"} · {roundsAgo(game, feud.lastRound)}
            </span>
          </li>
        );
      })}
      {game.shieldRotations.map((rotation) => (
        <li data-rotation="true" key={`${rotation.playerId}-${rotation.roundNumber}`}>
          <b>{rotation.playerId === game.currentPlayer.id ? "You" : rotation.playerName} rotated</b>
          <span>{roundsAgo(game, rotation.roundNumber)}</span>
        </li>
      ))}
      <li className="feud-total">
        {game.battleHistory.length} fight{game.battleHistory.length === 1 ? "" : "s"} in{" "}
        {completedRounds} round{completedRounds === 1 ? "" : "s"}
      </li>
    </ul>
  );
}
