// PROTOTYPE round 3, "The Dial": one big frequency dial. Every known enemy shield has its own
// thin coloured lane, your Mados orbit inside, and your own shield stays hidden until you hold
// to reveal it. Who has fought whom lives in a small table in the corner.
import { useRef, useState, type PointerEvent } from "react";
import type { EchoBand, GameSnapshot, InsightState } from "../../shared";
import {
  MADO_TUNE_RANGE,
  SHIELD_ROTATION_RANGE,
  calculateDamage,
  normalizeFrequency,
  toFrequencyArcs,
} from "../../shared";
import { MOCK_INSIGHTS } from "./mockGame";
import {
  ECHO_COLOR,
  FRESHNESS_LABEL,
  angleDelta,
  arcBand,
  clampTune,
  fakeShot,
  formatArc,
  isKnown,
  pointerAngle,
  polar,
  type Freshness,
} from "./ring";

const SIZE = 340;
const C = SIZE / 2;
const R_TICK = 152;
const LANE_START = 121;
const LANE_STEP = 7;
const ORBIT = 98;
const SHIELD_R = 58;

const PLAYER_COLORS: Record<string, string> = {
  me: "#f5d27a",
  jonas: "#5ee0c2",
  sara: "#c79bff",
  even: "#ff9f5a",
  ida: "#8a8f96",
};

type Drag = { kind: "mado"; slot: number } | { kind: "shield" } | null;
type Insights = Record<string, InsightState>;

function freshness(round: number, insight: InsightState | undefined): Freshness {
  if (!insight || !isKnown(insight.candidates.length) || insight.lastNarrowedRound === null) {
    return "unknown";
  }
  const age = round - insight.lastNarrowedRound;
  return age <= 1 ? "fresh" : age <= 3 ? "aging" : "stale";
}

const FRESH_OPACITY: Record<Freshness, number> = { fresh: 0.9, aging: 0.55, stale: 0.3, unknown: 0 };

function expectedDamage(frequency: number, insight: InsightState | undefined) {
  if (!insight || !isKnown(insight.candidates.length)) return null;
  const total = insight.candidates.reduce((sum, c) => sum + calculateDamage(frequency, c), 0);
  return total / insight.candidates.length;
}

function StepBar({ game }: { game: GameSnapshot }) {
  const steps: Array<[GameSnapshot["status"], string]> = [
    ["round_prepare", "Prepare"],
    ["attack_declaration", "Declare"],
    ["battle_resolution", "Warfare"],
  ];

  return (
    <header className="pd-steps">
      <span className="pd-round">Round {game.roundNumber}</span>
      <ol>
        {steps.map(([status, label]) => (
          <li data-on={game.status === status} key={status}>
            {label}
          </li>
        ))}
      </ol>
      <span className="pd-hp">
        <b>{game.currentPlayer.health}</b>hp
      </span>
    </header>
  );
}

type FeudProps = {
  game: GameSnapshot;
  insights: Insights;
  focusId: string | null;
  lockedId: string | null;
  onFocus: (id: string | null) => void;
};

function players(game: GameSnapshot) {
  return [
    { id: game.currentPlayer.id, name: "You", alive: true, connected: true },
    ...game.opponents.map((opponent) => ({ ...opponent })),
  ];
}

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

function roundsAgo(game: GameSnapshot, round: number) {
  const age = game.roundNumber - round;
  return age === 0 ? "this round" : age === 1 ? "last round" : `${age} rounds ago`;
}

// The table from round 1: small in the corner, full size on tap. Numbers only on request.
function FeudTable({
  game,
  focusId,
  lockedId,
  onFocus,
  size,
  showNumbers = false,
}: FeudProps & { size: "mini" | "full"; showNumbers?: boolean }) {
  const people = players(game);
  const full = size === "full";
  const w = full ? 320 : 112;
  const h = full ? 280 : 96;
  const cx = w / 2;
  const cy = h / 2;
  const r = full ? 104 : 34;
  const meName = game.currentPlayer.name;
  const seats = people.map((person, index) => {
    const p = polar(cx, cy, r, 180 + (index * 360) / people.length);
    return { ...person, x: p.x, y: p.y };
  });
  const byName = new Map(seats.map((seat) => [seat.id === game.currentPlayer.id ? meName : seat.name, seat]));
  const byId = new Map(seats.map((seat) => [seat.id, seat]));

  return (
    <svg className="pd-table" data-size={size} role="group" aria-label="Who has fought whom" viewBox={`0 0 ${w} ${h}`}>
      {feudsOf(game).map((feud) => {
        const a = byName.get(feud.a);
        const b = byName.get(feud.b);
        if (!a || !b) return null;
        const age = game.roundNumber - feud.lastRound;
        return (
          <g key={`${feud.a}|${feud.b}`}>
            <line
              className="pd-feud"
              strokeOpacity={Math.max(0.18, 0.85 - age * 0.22)}
              strokeWidth={full ? 1.5 + feud.count : 1 + feud.count * 0.5}
              x1={a.x}
              x2={b.x}
              y1={a.y}
              y2={b.y}
            />
            {full && showNumbers ? (
              <text className="pd-feud-label" textAnchor="middle" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 4}>
                {feud.count}× · R{feud.lastRound}
              </text>
            ) : null}
          </g>
        );
      })}
      {game.pendingBattles.map((entry) => {
        const a = byId.get(entry.playerAId);
        const b = byId.get(entry.playerBId);
        if (!a || !b) return null;
        return <line className="pd-feud-live" key={entry.id} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
      })}
      {seats.map((seat) => {
        const me = seat.id === game.currentPlayer.id;
        const selectable = full && !me && seat.alive && (!lockedId || lockedId === seat.id);
        return (
          <g
            className="pd-node"
            data-dead={!seat.alive}
            data-focus={focusId === seat.id}
            data-selectable={selectable}
            key={seat.id}
            onClick={(event) => {
              if (!full) return;
              event.stopPropagation();
              if (selectable) onFocus(seat.id);
            }}
          >
            <circle cx={seat.x} cy={seat.y} r={full ? 20 : 9} stroke={PLAYER_COLORS[seat.id]} />
            <text className="pd-node-i" dominantBaseline="central" textAnchor="middle" x={seat.x} y={seat.y} fontSize={full ? 15 : 8}>
              {seat.alive ? seat.name[0] : "✕"}
            </text>
            {full ? (
              <text className="pd-node-n" textAnchor="middle" x={seat.x} y={seat.y + 34}>
                {seat.name}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function FeudList({ game }: { game: GameSnapshot }) {
  const name = (value: string) => (value === game.currentPlayer.name ? "You" : value);
  const feuds = feudsOf(game);

  return (
    <ul className="pd-feud-list">
      {game.pendingBattles.map((entry) => (
        <li data-live="true" key={entry.id}>
          <b>
            {name(entry.playerAName)} vs {name(entry.playerBName)}
          </b>
          <span>fighting now</span>
        </li>
      ))}
      {feuds.map((feud) => {
        const [first, second] = feud.b === game.currentPlayer.name ? [feud.b, feud.a] : [feud.a, feud.b];
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
      <li className="pd-feud-total">
        {game.battleHistory.length} fights in {game.roundNumber - 1} rounds
      </li>
    </ul>
  );
}

export function VariantDial({ game }: { game: GameSnapshot }) {
  const phase = game.status;
  const me = game.currentPlayer;
  const battle = game.currentBattle;
  const lockedId = battle?.opponentId ?? null;
  const [focusId, setFocusId] = useState<string | null>(lockedId);
  const [insights, setInsights] = useState<Insights>(MOCK_INSIGHTS);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [discards, setDiscards] = useState<number[]>([]);
  const [tune, setTune] = useState<{ slot: number; offset: number } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [peek, setPeek] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const [used, setUsed] = useState<number[]>(battle?.usedMadoSlotIndexes ?? []);
  const [marks, setMarks] = useState<Array<{ frequency: number; echo: EchoBand; key: number }>>(
    battle?.lastExchange?.echo && battle.lastExchange.firedFrequency !== null
      ? [{ frequency: battle.lastExchange.firedFrequency, echo: battle.lastExchange.echo, key: 0 }]
      : [],
  );
  const drag = useRef<Drag>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const known = game.opponents.filter(
    (opponent) => opponent.alive && isKnown(insights[opponent.id]?.candidates.length ?? 360),
  );
  const focus = game.opponents.find((opponent) => opponent.id === focusId) ?? null;
  const focusInsight = focusId ? insights[focusId] : undefined;
  const showShield = peek || rotating;
  const shieldShown = normalizeFrequency(me.shieldFrequency + rotation);

  function madoFrequency(slot: number) {
    const base = me.madoSlots[slot]?.frequency ?? 0;
    return tune?.slot === slot ? normalizeFrequency(base + tune.offset) : base;
  }

  function onPointerDown(event: PointerEvent<SVGElement>, next: Drag) {
    drag.current = next;
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || !svgRef.current) return;
    const angle = pointerAngle(event, svgRef.current);

    if (drag.current.kind === "mado") {
      const base = me.madoSlots[drag.current.slot]?.frequency ?? 0;
      setTune({ slot: drag.current.slot, offset: clampTune(angleDelta(base, angle)) });
    } else {
      const delta = angleDelta(me.shieldFrequency, angle);
      setRotation(Math.round(Math.max(-SHIELD_ROTATION_RANGE, Math.min(SHIELD_ROTATION_RANGE, delta))));
    }
  }

  function fire(slot: number) {
    if (!battle || used.includes(slot)) return;
    const frequency = madoFrequency(slot);
    const shot = fakeShot(battle.opponentId, frequency, insights[battle.opponentId]!, game.roundNumber);
    setInsights({ ...insights, [battle.opponentId]: shot.insight });
    setMarks([...marks, { frequency, echo: shot.echo, key: marks.length + 1 }]);
    setUsed([...used, slot]);
  }

  const activeFrequency = activeSlot === null ? null : madoFrequency(activeSlot);
  const bestTargets =
    activeFrequency === null
      ? []
      : known
          .map((opponent) => ({ opponent, damage: expectedDamage(activeFrequency, insights[opponent.id]) ?? 0 }))
          .sort((a, b) => b.damage - a.damage);
  const lastEcho = marks.at(-1)?.echo ?? null;

  return (
    <div className="pv-root pd-root">
      <StepBar game={game} />
      <div className="pd-chips">
          {game.opponents.map((opponent) => (
            <button
              aria-pressed={focusId === opponent.id}
              disabled={!opponent.alive || (lockedId !== null && lockedId !== opponent.id)}
              key={opponent.id}
              onClick={() => setFocusId(focusId === opponent.id ? null : opponent.id)}
              style={{ borderColor: PLAYER_COLORS[opponent.id] }}
              type="button"
            >
              {opponent.name}
            </button>
          ))}
          <button className="pd-mini-table" onClick={() => setTableOpen(true)} type="button" aria-label="Open the table">
            <FeudTable focusId={focusId} game={game} insights={insights} lockedId={lockedId} onFocus={setFocusId} size="mini" />
          </button>
      </div>

      <svg
        aria-label="Frequency dial"
        className="pd-dial"
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        ref={svgRef}
        role="img"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        <circle className="pa-face" cx={C} cy={C} r={R_TICK} />
        {Array.from({ length: 36 }, (_, i) => {
          const deg = i * 10;
          const major = deg % 30 === 0;
          const a = polar(C, C, R_TICK, deg);
          const b = polar(C, C, R_TICK - (major ? 8 : 4), deg);
          return <line className="pa-tick" data-major={major} key={deg} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
        })}
        {[0, 90, 180, 270].map((deg) => {
          const p = polar(C, C, R_TICK + 10, deg);
          return (
            <text className="pa-deg" dominantBaseline="middle" key={deg} textAnchor="middle" x={p.x} y={p.y}>
              {deg}
            </text>
          );
        })}

        {game.opponents.map((opponent, lane) => {
          const insight = insights[opponent.id];
          if (!opponent.alive || !insight || !isKnown(insight.candidates.length)) return null;
          const inner = LANE_START + lane * LANE_STEP;
          const focused = focusId === opponent.id;
          const faded = focusId !== null && !focused;
          const fresh = freshness(game.roundNumber, insight);
          const arcs = toFrequencyArcs(insight.candidates);
          const widest = arcs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
          const label = polar(C, C, inner + 2, (widest.start + widest.end) / 2);
          return (
            <g key={opponent.id} opacity={faded ? 0.18 : FRESH_OPACITY[fresh]}>
              {arcs.map((arc) => (
                <path
                  d={arcBand(C, C, inner - (focused ? 2 : 0), inner + 5 + (focused ? 2 : 0), arc)}
                  fill={PLAYER_COLORS[opponent.id]}
                  key={arc.start}
                />
              ))}
              <circle cx={label.x} cy={label.y} fill="#0b0d0d" r="7" stroke={PLAYER_COLORS[opponent.id]} />
              <text className="pd-lane-i" dominantBaseline="central" fill={PLAYER_COLORS[opponent.id]} textAnchor="middle" x={label.x} y={label.y}>
                {opponent.name[0]}
              </text>
            </g>
          );
        })}

        {marks.map((mark) => {
          const p = polar(C, C, R_TICK - 2, mark.frequency);
          return (
            <g key={mark.key}>
              <circle className="pa-ripple" cx={p.x} cy={p.y} r="6" stroke={ECHO_COLOR[mark.echo]} />
              <circle cx={p.x} cy={p.y} fill={ECHO_COLOR[mark.echo]} r="4" />
            </g>
          );
        })}

        <circle className="pa-orbit" cx={C} cy={C} r={ORBIT} />
        {activeSlot !== null && phase === "round_prepare" && !discards.includes(activeSlot) ? (
          <path
            className="pa-reach"
            d={arcBand(C, C, ORBIT - 16, ORBIT + 16, {
              start: (me.madoSlots[activeSlot]?.frequency ?? 0) - MADO_TUNE_RANGE,
              end: (me.madoSlots[activeSlot]?.frequency ?? 0) + MADO_TUNE_RANGE,
            })}
          />
        ) : null}

        {me.madoSlots.map((mado, slot) => {
          if (!mado) return null;
          const frequency = madoFrequency(slot);
          const p = polar(C, C, ORBIT, frequency);
          const ghost = tune?.slot === slot ? polar(C, C, ORBIT, mado.frequency) : null;
          const state = discards.includes(slot) ? "discard" : used.includes(slot) ? "used" : tune?.slot === slot ? "tuned" : "ready";
          return (
            <g key={mado.id}>
              {ghost ? <circle className="pa-ghost" cx={ghost.x} cy={ghost.y} r="13" /> : null}
              <g
                className="pa-mado"
                data-active={activeSlot === slot}
                data-state={state}
                onClick={() => (phase === "battle_resolution" ? fire(slot) : phase === "round_prepare" ? setActiveSlot(slot) : undefined)}
                onPointerDown={(event) =>
                  phase === "round_prepare" && activeSlot === slot && state !== "discard"
                    ? onPointerDown(event, { kind: "mado", slot })
                    : undefined
                }
              >
                <circle cx={p.x} cy={p.y} r="15" />
                <text dominantBaseline="central" textAnchor="middle" x={p.x} y={p.y}>
                  {state === "discard" ? "✕" : slot + 1}
                </text>
              </g>
            </g>
          );
        })}

        {showShield ? (
          (() => {
            const p = polar(C, C, SHIELD_R, shieldShown);
            const ghost = rotation !== 0 ? polar(C, C, SHIELD_R, me.shieldFrequency) : null;
            return (
              <>
                {rotating ? (
                  <path
                    className="pa-reach"
                    d={arcBand(C, C, SHIELD_R - 15, SHIELD_R + 15, {
                      start: me.shieldFrequency - SHIELD_ROTATION_RANGE,
                      end: me.shieldFrequency + SHIELD_ROTATION_RANGE,
                    })}
                  />
                ) : null}
                {ghost ? <circle className="pa-ghost" cx={ghost.x} cy={ghost.y} r="12" /> : null}
                <g
                  className="pa-shield"
                  data-draggable={rotating}
                  onPointerDown={(event) => (rotating ? onPointerDown(event, { kind: "shield" }) : undefined)}
                >
                  <circle cx={p.x} cy={p.y} r="13" />
                  <text dominantBaseline="central" textAnchor="middle" x={p.x} y={p.y}>
                    ◈
                  </text>
                </g>
              </>
            );
          })()
        ) : null}

        <foreignObject height="100" width="140" x={C - 70} y={C - 50}>
          <div className="pa-center">
            {showShield ? (
              <>
                <b>Your shield</b>
                <span>{rotation !== 0 ? `${me.shieldFrequency}° → ${shieldShown}°` : `${me.shieldFrequency}°`}</span>
                <small>
                  drifts {Math.abs(me.shieldDrift)}° {me.shieldDrift > 0 ? "cw" : "ccw"} per round
                </small>
              </>
            ) : activeFrequency !== null && activeSlot !== null ? (
              <>
                <b>Mado {activeSlot + 1}</b>
                <span>{activeFrequency}°</span>
                {focus ? (
                  <small>vs {focus.name}: ~{Math.round(expectedDamage(activeFrequency, focusInsight) ?? 0)} dmg</small>
                ) : bestTargets[0] ? (
                  <small>
                    best: {bestTargets[0].opponent.name} ~{Math.round(bestTargets[0].damage)} dmg
                  </small>
                ) : (
                  <small>no shields tracked</small>
                )}
              </>
            ) : focus ? (
              <>
                <b style={{ color: PLAYER_COLORS[focus.id] }}>{focus.name}</b>
                <span>
                  {focusInsight && isKnown(focusInsight.candidates.length)
                    ? toFrequencyArcs(focusInsight.candidates).map(formatArc).join(" ")
                    : "unknown"}
                </span>
                <small>{FRESHNESS_LABEL[freshness(game.roundNumber, focusInsight)]}</small>
              </>
            ) : (
              <>
                <b>{known.length} shields tracked</b>
                <small>tap a wizard to focus</small>
              </>
            )}
          </div>
        </foreignObject>
      </svg>

      <section className="pa-sheet">
        {phase === "round_prepare" ? (
          <>
            {activeSlot !== null ? (
              <div className="pa-row">
                <button
                  data-tone={discards.includes(activeSlot) ? "danger" : undefined}
                  onClick={() => {
                    setDiscards(discards.includes(activeSlot) ? discards.filter((slot) => slot !== activeSlot) : [...discards, activeSlot]);
                    if (tune?.slot === activeSlot) setTune(null);
                  }}
                  type="button"
                >
                  {discards.includes(activeSlot) ? "Keep" : "Discard"}
                </button>
                {tune?.slot === activeSlot ? (
                  <button onClick={() => setTune(null)} type="button">
                    Undo tune
                  </button>
                ) : (
                  <span className="pa-hint">Drag along the ring to tune</span>
                )}
              </div>
            ) : (
              <p className="pa-hint">Tap a Mado on the dial.</p>
            )}
            <button className="pa-primary" type="button">
              Ready · {discards.length} discarded{tune ? ", 1 tuned" : ""}
            </button>
          </>
        ) : null}

        {phase === "attack_declaration" ? (
          rotating ? (
            <div className="pa-row">
              <button onClick={() => (setRotating(false), setRotation(0))} type="button">
                Cancel
              </button>
              <button className="pa-primary" type="button">
                Rotate {rotation > 0 ? "+" : ""}
                {rotation}°
              </button>
            </div>
          ) : (
            <div className="pa-choices">
              <button className="pa-primary" disabled={!focus} type="button">
                {focus ? `Attack ${focus.name}` : "Tap a wizard to attack"}
              </button>
              <div className="pa-row">
                <button type="button">Stay hidden</button>
                <button onClick={() => setRotating(true)} type="button">
                  Rotate shield
                </button>
              </div>
            </div>
          )
        ) : null}

        {phase === "battle_resolution" && battle ? (
          <>
            <div className="pa-row pa-battle">
              <span>
                vs <b>{battle.opponentName}</b> · you took <b>{battle.totalDamageTaken}</b>
              </span>
              {lastEcho ? (
                <span className="pa-echo" style={{ color: ECHO_COLOR[lastEcho] }}>
                  {lastEcho}
                </span>
              ) : null}
            </div>
            <div className="pa-row">
              <span className="pa-hint">Tap a Mado to fire.</span>
              <button type="button">Flee</button>
            </div>
          </>
        ) : null}

        {!rotating ? (
          <button
            className="pd-peek"
            onPointerCancel={() => setPeek(false)}
            onPointerDown={() => setPeek(true)}
            onPointerLeave={() => setPeek(false)}
            onPointerUp={() => setPeek(false)}
            type="button"
          >
            ◈ Hold to see your shield
          </button>
        ) : null}
      </section>

      {tableOpen ? (
        <div className="pd-overlay" onClick={() => setTableOpen(false)} role="dialog" aria-label="The table">
          <FeudTable
            focusId={focusId}
            game={game}
            insights={insights}
            lockedId={lockedId}
            onFocus={(id) => (setFocusId(id), setTableOpen(false))}
            showNumbers={showNumbers}
            size="full"
          />
          <button
            aria-pressed={showNumbers}
            onClick={(event) => (event.stopPropagation(), setShowNumbers(!showNumbers))}
            type="button"
          >
            {showNumbers ? "Hide numbers" : "Show numbers"}
          </button>
          {showNumbers ? <FeudList game={game} /> : null}
          <p>Tap a wizard to focus the dial. Tap anywhere else to close.</p>
        </div>
      ) : null}
    </div>
  );
}
