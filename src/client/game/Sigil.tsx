import { seatColor } from "./dialMath";

// Each seat has its own small constellation, so a wizard is recognisable by shape as well as
// by colour. Points are in a -1..1 box; lines join point indexes.
const CONSTELLATIONS: Array<{ points: Array<[number, number]>; lines: Array<[number, number]> }> = [
  { points: [[0, -0.8], [0.7, -0.1], [0.35, 0.75], [-0.45, 0.6], [-0.75, -0.2]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]] },
  { points: [[-0.8, 0.6], [-0.3, -0.1], [0.15, 0.35], [0.75, -0.65]], lines: [[0, 1], [1, 2], [2, 3]] },
  { points: [[0, -0.85], [0, 0], [-0.7, 0.55], [0.7, 0.55], [0, 0.85]], lines: [[0, 1], [1, 2], [1, 3], [1, 4]] },
  { points: [[-0.75, -0.6], [0.75, -0.6], [0.45, 0.7], [-0.45, 0.7]], lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]] },
  { points: [[-0.8, 0], [-0.25, -0.55], [0.3, 0], [0.8, -0.55], [0.3, 0.7]], lines: [[0, 1], [1, 2], [2, 3], [2, 4]] },
  { points: [[0, -0.8], [0.7, 0.6], [-0.7, 0.6], [0, 0.1]], lines: [[0, 1], [1, 2], [2, 0], [0, 3]] },
  { points: [[-0.8, -0.7], [-0.2, -0.2], [0.2, 0.2], [0.8, 0.75], [0.7, -0.6]], lines: [[0, 1], [1, 2], [2, 3], [2, 4]] },
  { points: [[-0.7, 0.7], [-0.7, -0.4], [0, -0.85], [0.7, -0.4], [0.7, 0.7]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
];

export function constellationOf(seat: number) {
  return CONSTELLATIONS[Math.max(0, seat) % CONSTELLATIONS.length]!;
}

type DrawProps = { seat: number; cx: number; cy: number; radius: number; dim?: boolean };

// Draws a seat's constellation inside an existing SVG.
export function ConstellationMark({ seat, cx, cy, radius, dim = false }: DrawProps) {
  const { points, lines } = constellationOf(seat);
  const color = seatColor(seat);
  const at = ([x, y]: [number, number]) => ({ x: cx + x * radius, y: cy + y * radius });
  const starRadius = Math.max(1.2, radius * 0.13);

  return (
    <g className="constellation" opacity={dim ? 0.4 : 1}>
      {lines.map(([a, b]) => {
        const p = at(points[a]!);
        const q = at(points[b]!);
        return <line key={`${a}-${b}`} stroke={color} strokeOpacity={0.75} strokeWidth={Math.max(0.6, radius * 0.06)} x1={p.x} x2={q.x} y1={p.y} y2={q.y} />;
      })}
      {points.map((point, index) => {
        const p = at(point);
        return <circle cx={p.x} cy={p.y} fill="#fff8e6" key={index} r={starRadius} stroke={color} strokeWidth={starRadius * 0.6} />;
      })}
    </g>
  );
}

// A standalone sigil: the seat's constellation in a small glowing medallion.
export function Sigil({ seat, size = 28 }: { seat: number; size?: number }) {
  const color = seatColor(seat);
  return (
    <svg aria-hidden="true" className="sigil" height={size} viewBox="-20 -20 40 40" width={size}>
      <circle fill="rgba(5, 10, 26, 0.85)" r="18" stroke={color} strokeWidth="2" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <ConstellationMark cx={0} cy={0} radius={11} seat={seat} />
    </svg>
  );
}
