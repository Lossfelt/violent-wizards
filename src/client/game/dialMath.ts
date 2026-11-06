import type { EchoBand, FrequencyArc, GameSnapshot, KnownShieldSnapshot } from "../../shared";
import { FREQUENCY_COUNT, calculateDamage, normalizeFrequency } from "../../shared";

export type Opponent = GameSnapshot["opponents"][number];
export type Freshness = "fresh" | "aging" | "stale" | "unknown";

// One identity colour per seat (join order), so a wizard has the same colour on every screen.
// Saturated enough to glow against the night sky, far enough apart to tell at a glance.
const SEAT_COLORS = ["#ffc94d", "#44d9ff", "#b98bff", "#ff7a45", "#ff5f9e", "#4fe39a", "#8fb4ff", "#c6f05a"];

export function seatColor(seat: number) {
  return SEAT_COLORS[Math.max(0, seat) % SEAT_COLORS.length]!;
}

export function opponentColor(game: GameSnapshot, opponentId: string) {
  const opponent = game.opponents.find((candidate) => candidate.id === opponentId);
  return seatColor(opponent?.seat ?? 0);
}

export const ECHO_COLOR: Record<EchoBand, string> = {
  glowing: "#ff8a3d",
  warm: "#f5d27a",
  lukewarm: "#9fb7c9",
  cold: "#6aa8ff",
};

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "fresh",
  aging: "ageing",
  stale: "stale",
  unknown: "unknown",
};

export const FRESHNESS_OPACITY: Record<Freshness, number> = {
  fresh: 0.95,
  aging: 0.6,
  stale: 0.32,
  unknown: 0,
};

// 0° is at the top and angles grow clockwise, matching how frequencies are drawn everywhere.
export function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

// A ring segment between two radii, used for known ranges and reach areas.
export function arcBand(cx: number, cy: number, inner: number, outer: number, arc: FrequencyArc) {
  const span = Math.min(arc.end - arc.start, 359.99);
  const end = arc.start + span;
  const large = span > 180 ? 1 : 0;
  const o1 = polar(cx, cy, outer, arc.start);
  const o2 = polar(cx, cy, outer, end);
  const i1 = polar(cx, cy, inner, end);
  const i2 = polar(cx, cy, inner, arc.start);

  return [
    `M ${o1.x} ${o1.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${i2.x} ${i2.y}`,
    "Z",
  ].join(" ");
}

export function formatArc(arc: FrequencyArc) {
  const first = normalizeFrequency(arc.start);
  const last = normalizeFrequency(arc.end - 1);
  return first === last ? `${first}°` : `${first}°-${last}°`;
}

export function isKnown(shield: KnownShieldSnapshot) {
  return shield.possibleCount < FREQUENCY_COUNT;
}

export function freshnessOf(game: GameSnapshot, opponent: Opponent): Freshness {
  const last = opponent.insight.lastNarrowedRound;

  if (last === null || !isKnown(opponent.insight)) {
    return "unknown";
  }

  const age = game.roundNumber - last;
  return age <= 1 ? "fresh" : age <= 3 ? "aging" : "stale";
}

function candidatesOf(arcs: FrequencyArc[]) {
  return arcs.flatMap((arc) =>
    Array.from({ length: arc.end - arc.start }, (_, offset) => normalizeFrequency(arc.start + offset)),
  );
}

// Average damage a Mado would do if the shield is anywhere in the known range.
export function expectedDamage(frequency: number, shield: KnownShieldSnapshot) {
  if (!isKnown(shield)) {
    return null;
  }

  const candidates = candidatesOf(shield.arcs);
  const total = candidates.reduce((sum, candidate) => sum + calculateDamage(frequency, candidate), 0);
  return total / candidates.length;
}

// Signed shortest difference from `from` to `to`, in -180..180.
export function angleDelta(from: number, to: number) {
  return ((normalizeFrequency(to) - normalizeFrequency(from) + 540) % 360) - 180;
}

export function pointerAngle(event: { clientX: number; clientY: number }, element: Element) {
  const box = element.getBoundingClientRect();
  const dx = event.clientX - (box.left + box.width / 2);
  const dy = event.clientY - (box.top + box.height / 2);
  return normalizeFrequency((Math.atan2(dy, dx) * 180) / Math.PI + 90);
}
