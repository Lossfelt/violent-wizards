import { useEffect, useRef, useState } from "react";
import type {
  GameSnapshot,
  PublicBattleHistoryEntry,
  PublicShieldRotation,
  RoundBattlePreview,
  TableSnapshot,
} from "../../shared";
import { polar, seatColor } from "./dialMath";
import { ConstellationMark } from "./Sigil";
import { BrassRing, Medallion, StarSprite } from "./artAssets";

export type FeudPerson = {
  id: string;
  // The name battle history refers to, and what to print for it ("You" on your own phone).
  name: string;
  label: string;
  alive: boolean;
  color: string;
  seat: number;
};

// Everything the table and list need, from either a player's game or the shared table screen.
export type FeudData = {
  people: FeudPerson[];
  battleHistory: PublicBattleHistoryEntry[];
  liveBattles: RoundBattlePreview[];
  rotations: PublicShieldRotation[];
  roundNumber: number;
  completedRounds: number;
};

function completedRounds(status: string, roundNumber: number) {
  return status === "round_cleanup" || status === "finished" ? roundNumber : Math.max(0, roundNumber - 1);
}

export function feudDataFromGame(game: GameSnapshot): FeudData {
  const me = game.currentPlayer;
  return {
    people: [
      { id: me.id, name: me.name, label: "You", alive: me.alive, color: seatColor(me.seat), seat: me.seat },
      ...game.opponents.map((opponent) => ({
        id: opponent.id,
        name: opponent.name,
        label: opponent.name,
        alive: opponent.alive,
        color: seatColor(opponent.seat),
        seat: opponent.seat,
      })),
    ].sort((a, b) => seatOf(game, a.id) - seatOf(game, b.id)),
    battleHistory: game.battleHistory,
    liveBattles: game.status === "battle_resolution" ? game.pendingBattles : [],
    rotations: game.shieldRotations.map((rotation) =>
      rotation.playerId === me.id ? { ...rotation, playerName: "You" } : rotation,
    ),
    roundNumber: game.roundNumber,
    completedRounds: completedRounds(game.status, game.roundNumber),
  };
}

function seatOf(game: GameSnapshot, playerId: string) {
  if (playerId === game.currentPlayer.id) return game.currentPlayer.seat;
  return game.opponents.find((opponent) => opponent.id === playerId)?.seat ?? 0;
}

export function feudDataFromTable(table: TableSnapshot): FeudData {
  return {
    people: table.players.map((player) => ({
      id: player.id,
      name: player.name,
      label: player.name,
      alive: player.alive,
      color: seatColor(player.seat),
      seat: player.seat,
    })),
    battleHistory: table.battleHistory,
    liveBattles:
      table.status === "battle_resolution" ? table.battles.filter((battle) => !battle.finished) : [],
    rotations: table.shieldRotations,
    roundNumber: table.roundNumber,
    completedRounds: completedRounds(table.status, table.roundNumber),
  };
}

type Feud = { a: string; b: string; count: number; lastRound: number };

// Several fights between the same two wizards become one line.
function feudsOf(data: FeudData): Feud[] {
  const byPair = new Map<string, Feud>();

  for (const entry of data.battleHistory) {
    const [a, b] = [entry.playerAName, entry.playerBName].sort();
    const key = `${a}|${b}`;
    const feud = byPair.get(key) ?? { a: a!, b: b!, count: 0, lastRound: 0 };
    feud.count += 1;
    feud.lastRound = Math.max(feud.lastRound, entry.roundNumber);
    byPair.set(key, feud);
  }

  return [...byPair.values()].sort((x, y) => y.lastRound - x.lastRound);
}

export function roundsAgo(roundNumber: number, round: number) {
  const age = roundNumber - round;
  return age <= 0 ? "this round" : age === 1 ? "last round" : `${age} rounds ago`;
}

// The opening of the brass ring around the full table.
const PLATE_RADIUS = 150;

// The ring has star ornaments at 0, 90, 180 and 270 degrees; name plaques slide off them.
function clearOfRingStars(angle: number) {
  const offset = ((angle % 90) + 90) % 90;
  if (offset < 14) return angle + (14 - offset);
  if (offset > 76) return angle - (offset - 76);
  return angle;
}

const FALL_MS = 2600;

// Wizards who died since the last render, kept for a moment so their fall can play out.
// Wizards already dead when the table first appears (a reload) do not fall again.
function useFallen(people: FeudPerson[]) {
  const wasAlive = useRef(new Map(people.map((person) => [person.id, person.alive])));
  const [fallen, setFallen] = useState<ReadonlySet<string>>(new Set());
  const deadKey = people.filter((person) => !person.alive).map((person) => person.id).join(",");

  useEffect(() => {
    const newlyFallen = people.filter((person) => !person.alive && wasAlive.current.get(person.id) === true).map((person) => person.id);
    wasAlive.current = new Map(people.map((person) => [person.id, person.alive]));
    if (newlyFallen.length === 0) return;

    setFallen((current) => new Set([...current, ...newlyFallen]));
    // Not cleared on re-render: a second death must not cancel the first one's timer.
    setTimeout(() => {
      setFallen((current) => new Set([...current].filter((id) => !newlyFallen.includes(id))));
    }, FALL_MS);
    // Only a change in who is dead matters.
  }, [deadKey]);

  return fallen;
}

type TableProps = {
  data: FeudData;
  size: "mini" | "full";
  focusId: string | null;
  showNumbers?: boolean;
  onSelect?: (playerId: string) => void;
};

// Who has fought whom, drawn as a round table. Lines fade with age; live fights pulse.
export function FeudTable({ data, size, focusId, showNumbers = false, onSelect }: TableProps) {
  const full = size === "full";
  const w = full ? 380 : 112;
  const h = full ? 370 : 96;
  const ring = full ? 108 : 34;
  const seats = data.people.map((person, index) => {
    const angle = 180 + (index * 360) / Math.max(1, data.people.length);
    return {
      ...person,
      angle,
      ...polar(w / 2, h / 2, ring, angle),
      plaque: polar(w / 2, h / 2, PLATE_RADIUS + 15, clearOfRingStars(angle)),
    };
  });
  const byName = new Map(seats.map((seat) => [seat.name, seat]));
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const fallen = useFallen(data.people);

  return (
    <svg className="feud-table" data-size={size} role="group" aria-label="Who has fought whom" viewBox={`0 0 ${w} ${h}`}>
      {full ? (
        <>
          <circle className="feud-plate" cx={w / 2} cy={h / 2} r={PLATE_RADIUS} />
          {[40, 75, ring].map((r) => (
            <circle className="feud-plate-inner" cx={w / 2} cy={h / 2} key={r} r={r} />
          ))}
          <BrassRing className="feud-ring" cx={w / 2} cy={h / 2} innerRadius={PLATE_RADIUS} />
        </>
      ) : (
        <circle className="feud-plate" cx={w / 2} cy={h / 2} r={ring + 11} />
      )}
      {feudsOf(data).map((feud) => {
        const a = byName.get(feud.a);
        const b = byName.get(feud.b);
        if (!a || !b) return null;
        const age = data.roundNumber - feud.lastRound;
        // A beam of starlight that fades from one wizard's colour into the other's.
        const gradientId = `feud-${size}-${a.id}-${b.id}`;
        return (
          <g key={`${feud.a}|${feud.b}`}>
            <defs>
              <linearGradient gradientUnits="userSpaceOnUse" id={gradientId} x1={a.x} x2={b.x} y1={a.y} y2={b.y}>
                <stop offset="0%" stopColor={a.color} />
                <stop offset="100%" stopColor={b.color} />
              </linearGradient>
            </defs>
            <line
              className="feud-line"
              stroke={`url(#${gradientId})`}
              strokeOpacity={Math.max(0.25, 0.95 - age * 0.22)}
              strokeWidth={full ? 2.5 + feud.count * 1.2 : 1 + feud.count * 0.5}
              style={{ filter: `drop-shadow(0 0 ${full ? 6 : 2}px ${a.color}) drop-shadow(0 0 ${full ? 6 : 2}px ${b.color})` }}
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
      {data.liveBattles.map((entry) => {
        const a = byId.get(entry.playerAId);
        const b = byId.get(entry.playerBId);
        if (!a || !b) return null;
        // Sparks of light travel both ways along a live fight: the two wizards trading shots.
        return (
          <g key={entry.id}>
            <line className="feud-line-live" x1={a.x} x2={b.x} y1={a.y} y2={b.y} />
            <line className="feud-line-spark" pathLength={100} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />
            <line className="feud-line-spark" data-return="true" pathLength={100} x1={b.x} x2={a.x} y1={b.y} y2={a.y} />
          </g>
        );
      })}
      {seats.map((seat) => {
        const selectable = full && seat.label !== "You" && seat.alive && onSelect;
        return (
          <g
            className="feud-seat"
            data-dead={!seat.alive}
            data-fell={fallen.has(seat.id)}
            data-focus={focusId === seat.id}
            data-selectable={Boolean(selectable)}
            key={seat.id}
            onClick={(event) => {
              if (!full) return;
              event.stopPropagation();
              if (selectable) onSelect(seat.id);
            }}
          >
            <circle
              className="feud-seat-ring"
              cx={seat.x}
              cy={seat.y}
              r={full ? 20 : 9}
              stroke={seat.color}
              style={{ filter: `drop-shadow(0 0 ${full ? 8 : 3}px ${seat.color})` }}
            />
            {full ? <Medallion className="feud-medallion" cx={seat.x} cy={seat.y} innerRadius={19} /> : null}
            {full && fallen.has(seat.id) ? (
              // The fallen wizard's star flares, then drops away while their constellation fades.
              <g className="feud-fall">
                <circle className="feud-fall-flare" cx={seat.x} cy={seat.y} r="20" />
                <g className="feud-fall-constellation">
                  <ConstellationMark cx={seat.x} cy={seat.y} radius={11} seat={seat.seat} />
                </g>
                <g transform={`translate(${seat.x} ${seat.y})`}>
                  <g className="feud-fall-star">
                    <StarSprite cx={0} cy={0} glowRadius={9} />
                  </g>
                </g>
              </g>
            ) : full && seat.alive ? (
              <ConstellationMark cx={seat.x} cy={seat.y} radius={11} seat={seat.seat} />
            ) : (
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
            )}
            {full ? (
              // The name sits on a small plaque set into the brass ring, outside the seat.
              <g className="feud-plaque">
                <rect
                  height={18}
                  rx={9}
                  width={seat.label.length * 6.6 + 16}
                  x={seat.plaque.x - (seat.label.length * 6.6 + 16) / 2}
                  y={seat.plaque.y - 9}
                />
                <text className="feud-seat-name" dominantBaseline="central" textAnchor="middle" x={seat.plaque.x} y={seat.plaque.y}>
                  {seat.label}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function FeudList({ data }: { data: FeudData }) {
  const labels = new Map(data.people.map((person) => [person.name, person.label]));
  const label = (name: string) => labels.get(name) ?? name;
  const nameOfId = new Map(data.people.map((person) => [person.id, person.label]));

  return (
    <ul className="feud-list">
      {data.liveBattles.map((entry) => (
        <li data-live="true" key={entry.id}>
          <b>
            {nameOfId.get(entry.playerAId) ?? entry.playerAName} vs{" "}
            {nameOfId.get(entry.playerBId) ?? entry.playerBName}
          </b>
          <span>fighting now</span>
        </li>
      ))}
      {feudsOf(data).map((feud) => {
        const [first, second] = label(feud.b) === "You" ? [feud.b, feud.a] : [feud.a, feud.b];
        return (
          <li key={`${feud.a}|${feud.b}`}>
            <b>
              {label(first)} vs {label(second)}
            </b>
            <span>
              {feud.count} fight{feud.count === 1 ? "" : "s"} · {roundsAgo(data.roundNumber, feud.lastRound)}
            </span>
          </li>
        );
      })}
      {data.rotations.map((rotation) => (
        <li data-rotation="true" key={`${rotation.playerId}-${rotation.roundNumber}`}>
          <b>{rotation.playerName} rotated</b>
          <span>{roundsAgo(data.roundNumber, rotation.roundNumber)}</span>
        </li>
      ))}
      <li className="feud-total">
        {data.battleHistory.length} fight{data.battleHistory.length === 1 ? "" : "s"} in{" "}
        {data.completedRounds} round{data.completedRounds === 1 ? "" : "s"}
      </li>
    </ul>
  );
}
