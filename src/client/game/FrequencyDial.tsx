import { useRef, type PointerEvent, type ReactNode } from "react";
import type { EchoBand, FrequencyArc } from "../../shared";
import { BrassRing, StarSprite } from "./artAssets";
import { ECHO_COLOR, arcBand, pointerAngle, polar } from "./dialMath";

// The viewBox leaves room outside the tick ring for the brass astrolabe ring.
const SIZE = 380;
const C = SIZE / 2;
const R_TICK = 152;
const LANE_START = 121;
const LANE_STEP = 7;
const ORBIT = 98;
const SHIELD_R = 58;

export type DialLane = {
  id: string;
  initial: string;
  color: string;
  arcs: FrequencyArc[];
  opacity: number;
  focused: boolean;
};

export type DialMado = {
  slot: number;
  frequency: number;
  // Where the Mado was before tuning, drawn as a ghost while it differs.
  baseFrequency: number;
  state: "ready" | "tuned" | "discard" | "used";
  active: boolean;
};

export type DialReach = { center: number; range: number; ring: "orbit" | "shield" };

type Props = {
  lanes: DialLane[];
  mados: DialMado[];
  marks: Array<{ frequency: number; echo: EchoBand }>;
  reach: DialReach | null;
  shield: { frequency: number; baseFrequency: number; draggable: boolean } | null;
  center: ReactNode;
  draggableSlot: number | null;
  onMadoTap: (slot: number) => void;
  onTune: (slot: number, angle: number) => void;
  onRotate: (angle: number) => void;
};

type Drag = { kind: "mado"; slot: number } | { kind: "shield" } | null;

const CROWDED_DEGREES = 12;
const INNER_ORBIT = ORBIT - 26;

// Mados closer than a marker's width would hide each other, so every other one in a cluster
// moves to an inner track. The angle, which is what matters, stays the same.
function orbitRadii(mados: DialMado[]) {
  const radii = new Map<number, number>();
  const sorted = [...mados].sort((a, b) => a.frequency - b.frequency);
  let previous: { frequency: number; radius: number } | null = null;

  for (const mado of sorted) {
    const crowded: boolean = previous !== null && mado.frequency - previous.frequency < CROWDED_DEGREES;
    const radius: number = crowded && previous!.radius === ORBIT ? INNER_ORBIT : ORBIT;
    radii.set(mado.slot, radius);
    previous = { frequency: mado.frequency, radius };
  }

  return radii;
}

export function FrequencyDial({
  lanes,
  mados,
  marks,
  reach,
  shield,
  center,
  draggableSlot,
  onMadoTap,
  onTune,
  onRotate,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag>(null);
  const radii = orbitRadii(mados);

  function startDrag(event: PointerEvent<SVGElement>, next: Drag) {
    drag.current = next;
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || !svgRef.current) return;
    const angle = pointerAngle(event, svgRef.current);

    if (drag.current.kind === "mado") {
      onTune(drag.current.slot, angle);
    } else {
      onRotate(angle);
    }
  }

  return (
    <svg
      aria-label="Frequency dial"
      className="dial"
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      ref={svgRef}
      role="img"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
    >
      <defs>
        <radialGradient id="dial-face-fill">
          <stop offset="0%" stopColor="#0d1a44" stopOpacity="0.92" />
          <stop offset="70%" stopColor="#060c26" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#03061a" stopOpacity="0.95" />
        </radialGradient>
        <filter id="dial-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle className="dial-face" cx={C} cy={C} r={R_TICK} />
      {/* The star chart grid: faint rings and meridians, like an orrery's plate. */}
      {[44, 72, ORBIT + 14].map((r) => (
        <circle className="dial-grid" cx={C} cy={C} key={r} r={r} />
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const a = polar(C, C, 24, i * 30);
        const b = polar(C, C, LANE_START - 4, i * 30);
        return <line className="dial-grid" key={i} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
      })}
      {Array.from({ length: 72 }, (_, i) => {
        const deg = i * 5;
        const major = deg % 30 === 0;
        const minor = deg % 10 !== 0;
        const a = polar(C, C, R_TICK - 1, deg);
        const b = polar(C, C, R_TICK - (major ? 10 : minor ? 3 : 6), deg);
        return <line className="dial-tick" data-major={major} key={deg} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
      })}
      <BrassRing className="dial-ring" cx={C} cy={C} innerRadius={R_TICK + 1} />
      {/* Degree plaques set into the brass ring. The ring's own stars mark 0, 90, 180 and 270. */}
      {Array.from({ length: 12 }, (_, i) => i * 30)
        .filter((deg) => deg % 90 !== 0)
        .map((deg) => {
          const p = polar(C, C, R_TICK + 16, deg);
          return (
            <g className="dial-plaque" key={deg}>
              <circle cx={p.x} cy={p.y} r="9.5" />
              <text dominantBaseline="central" textAnchor="middle" x={p.x} y={p.y}>
                {deg}
              </text>
            </g>
          );
        })}

      {lanes.map((lane, index) => {
        const inner = LANE_START + index * LANE_STEP;
        const widest = lane.arcs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
        const label = polar(C, C, inner + 2, (widest.start + widest.end) / 2);
        return (
          <g filter={lane.focused ? "url(#dial-glow)" : undefined} key={lane.id} opacity={lane.opacity}>
            {lane.arcs.map((arc) => (
              <path
                d={arcBand(C, C, inner - (lane.focused ? 2 : 0), inner + 5 + (lane.focused ? 2 : 0), arc)}
                fill={lane.color}
                key={arc.start}
              />
            ))}
            <circle cx={label.x} cy={label.y} fill="#0b0d0d" r="7" stroke={lane.color} />
            <text className="dial-lane-initial" dominantBaseline="central" fill={lane.color} textAnchor="middle" x={label.x} y={label.y}>
              {lane.initial}
            </text>
          </g>
        );
      })}

      {marks.map((mark, index) => {
        const p = polar(C, C, R_TICK - 2, mark.frequency);
        const latest = index === marks.length - 1;
        return (
          <g filter="url(#dial-glow)" key={`${index}-${mark.frequency}`}>
            {latest ? <circle className="dial-ripple" cx={p.x} cy={p.y} r="6" stroke={ECHO_COLOR[mark.echo]} /> : null}
            <circle cx={p.x} cy={p.y} fill={ECHO_COLOR[mark.echo]} r="4" />
          </g>
        );
      })}

      <circle className="dial-orbit" cx={C} cy={C} r={ORBIT} />
      {reach ? (
        <path
          className="dial-reach"
          d={arcBand(
            C,
            C,
            (reach.ring === "orbit" ? ORBIT : SHIELD_R) - 16,
            (reach.ring === "orbit" ? ORBIT : SHIELD_R) + 16,
            { start: reach.center - reach.range, end: reach.center + reach.range },
          )}
        />
      ) : null}

      {mados.map((mado) => {
        const radius = radii.get(mado.slot) ?? ORBIT;
        const p = polar(C, C, radius, mado.frequency);
        const ghost = mado.frequency !== mado.baseFrequency ? polar(C, C, radius, mado.baseFrequency) : null;
        return (
          <g key={mado.slot}>
            {ghost ? <circle className="dial-ghost" cx={ghost.x} cy={ghost.y} r="13" /> : null}
            <g
              aria-label={`Mado ${mado.slot + 1}, ${Math.round(mado.frequency)} degrees`}
              className="dial-mado"
              data-active={mado.active}
              data-state={mado.state}
              onClick={() => onMadoTap(mado.slot)}
              onPointerDown={(event) =>
                draggableSlot === mado.slot ? startDrag(event, { kind: "mado", slot: mado.slot }) : undefined
              }
              role="button"
            >
              {/* A Mado is a small burning star. The plain circle is the tap target. */}
              <circle className="dial-mado-hit" cx={p.x} cy={p.y} r="15" />
              <StarSprite className="dial-mado-star" cx={p.x} cy={p.y} glowRadius={19} />
              <text dominantBaseline="central" textAnchor="middle" x={p.x} y={p.y}>
                {mado.state === "discard" ? "✕" : mado.slot + 1}
              </text>
            </g>
          </g>
        );
      })}

      {shield
        ? (() => {
            const p = polar(C, C, SHIELD_R, shield.frequency);
            const ghost =
              shield.frequency !== shield.baseFrequency ? polar(C, C, SHIELD_R, shield.baseFrequency) : null;
            return (
              <>
                {ghost ? <circle className="dial-ghost" cx={ghost.x} cy={ghost.y} r="12" /> : null}
                <g
                  className="dial-shield"
                  data-draggable={shield.draggable}
                  onPointerDown={(event) => (shield.draggable ? startDrag(event, { kind: "shield" }) : undefined)}
                >
                  <circle cx={p.x} cy={p.y} r="13" />
                  <text dominantBaseline="central" textAnchor="middle" x={p.x} y={p.y}>
                    ◈
                  </text>
                </g>
              </>
            );
          })()
        : null}

      {/* The text box is wider than the inner orbit's gap, so it must not swallow taps on Mados. */}
      <foreignObject height="104" pointerEvents="none" width="150" x={C - 75} y={C - 52}>
        <div className="dial-center">{center}</div>
      </foreignObject>
    </svg>
  );
}
