import { useRef, type PointerEvent, type ReactNode } from "react";
import type { EchoBand, FrequencyArc } from "../../shared";
import { ECHO_COLOR, arcBand, pointerAngle, polar } from "./dialMath";

const SIZE = 340;
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
      <circle className="dial-face" cx={C} cy={C} r={R_TICK} />
      {Array.from({ length: 36 }, (_, i) => {
        const deg = i * 10;
        const major = deg % 30 === 0;
        const a = polar(C, C, R_TICK, deg);
        const b = polar(C, C, R_TICK - (major ? 8 : 4), deg);
        return <line className="dial-tick" data-major={major} key={deg} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
      })}
      {[0, 90, 180, 270].map((deg) => {
        const p = polar(C, C, R_TICK + 10, deg);
        return (
          <text className="dial-degree" dominantBaseline="middle" key={deg} textAnchor="middle" x={p.x} y={p.y}>
            {deg}
          </text>
        );
      })}

      {lanes.map((lane, index) => {
        const inner = LANE_START + index * LANE_STEP;
        const widest = lane.arcs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
        const label = polar(C, C, inner + 2, (widest.start + widest.end) / 2);
        return (
          <g key={lane.id} opacity={lane.opacity}>
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
          <g key={`${index}-${mark.frequency}`}>
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
              <circle cx={p.x} cy={p.y} r="15" />
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

      <foreignObject height="104" width="150" x={C - 75} y={C - 52}>
        <div className="dial-center">{center}</div>
      </foreignObject>
    </svg>
  );
}
