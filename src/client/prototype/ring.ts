// PROTOTYPE: small geometry and wording helpers shared by the UI prototype variants.
import type { EchoBand, FrequencyArc, GameSnapshot, InsightState } from "../../shared";
import {
  MADO_TUNE_RANGE,
  applyEcho,
  circularDistance,
  getEchoBand,
  normalizeFrequency,
  toFrequencyArcs,
} from "../../shared";
import { HIDDEN_SHIELDS } from "./mockGame";

// 0° is at the top and angles grow clockwise, matching the game's frequency wheel.
export function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

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

export function isKnown(possibleCount: number) {
  return possibleCount < 360;
}

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

export function freshnessOf(game: GameSnapshot, opponent: GameSnapshot["opponents"][number]): Freshness {
  const last = opponent.insight.lastNarrowedRound;

  if (last === null || !isKnown(opponent.insight.possibleCount)) {
    return "unknown";
  }

  const age = game.roundNumber - last;
  return age <= 1 ? "fresh" : age <= 3 ? "aging" : "stale";
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "fresh",
  aging: "ageing",
  stale: "stale",
  unknown: "unknown",
};

export const ECHO_COLOR: Record<EchoBand, string> = {
  glowing: "#ff8a3d",
  warm: "#f5d27a",
  lukewarm: "#9fb7c9",
  cold: "#6aa8ff",
};

export function clampTune(offset: number) {
  return Math.max(-MADO_TUNE_RANGE, Math.min(MADO_TUNE_RANGE, Math.round(offset)));
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

// Fake a shot against the hidden mock shield so the prototype can show echoes.
export function fakeShot(opponentId: string, frequency: number, insight: InsightState, round: number) {
  const shield = HIDDEN_SHIELDS[opponentId] ?? 0;
  const echo = getEchoBand(circularDistance(frequency, shield));
  const next = applyEcho(insight, frequency, echo, round);
  return { echo, insight: next, arcs: toFrequencyArcs(next.candidates) };
}
