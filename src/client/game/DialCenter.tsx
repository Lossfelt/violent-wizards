import type { GameSnapshot } from "../../shared";
import { normalizeFrequency } from "../../shared";
import {
  FRESHNESS_LABEL,
  expectedDamage,
  formatArc,
  freshnessOf,
  isKnown,
  opponentColor,
  type Opponent,
} from "./dialMath";

type Props = {
  game: GameSnapshot;
  focus: Opponent | null;
  activeSlot: number | null;
  activeFrequency: number | null;
  showShield: boolean;
  rotation: number;
};

// The text in the middle of the dial: whatever matters most right now.
export function DialCenter({ game, focus, activeSlot, activeFrequency, showShield, rotation }: Props) {
  const me = game.currentPlayer;

  if (showShield) {
    const rotated = normalizeFrequency(me.shieldFrequency + rotation);
    return (
      <>
        <b>Your shield</b>
        <span>{rotation !== 0 ? `${me.shieldFrequency}° → ${rotated}°` : `${me.shieldFrequency}°`}</span>
        <small>
          drifts {Math.abs(me.shieldDrift)}° {me.shieldDrift > 0 ? "clockwise" : "anticlockwise"} each round
        </small>
      </>
    );
  }

  if (activeFrequency !== null && activeSlot !== null) {
    const targets = game.opponents
      .filter((opponent) => opponent.alive && isKnown(opponent.insight))
      .map((opponent) => ({ opponent, damage: expectedDamage(activeFrequency, opponent.insight) ?? 0 }))
      .sort((a, b) => b.damage - a.damage);
    const focusDamage = focus ? expectedDamage(activeFrequency, focus.insight) : null;

    return (
      <>
        <b>Mado {activeSlot + 1}</b>
        <span>{activeFrequency}°</span>
        <small>
          {focus
            ? focusDamage === null
              ? `${focus.name}: shield unknown`
              : `vs ${focus.name}: ~${Math.round(focusDamage)} dmg`
            : targets[0]
              ? `best: ${targets[0].opponent.name} ~${Math.round(targets[0].damage)} dmg`
              : "no shields tracked yet"}
        </small>
      </>
    );
  }

  if (game.status === "finished") {
    const winner =
      game.winnerPlayerId === me.id
        ? "You"
        : game.opponents.find((opponent) => opponent.id === game.winnerPlayerId)?.name;
    return (
      <>
        <b>{game.draw ? "Draw" : `${winner} won`}</b>
        <small>{game.draw ? "nobody survived" : "the war is over"}</small>
      </>
    );
  }

  if (focus) {
    return (
      <>
        <b style={{ color: opponentColor(game, focus.id) }}>{focus.name}</b>
        <span>{isKnown(focus.insight) ? focus.insight.arcs.map(formatArc).join(" ") : "shield unknown"}</span>
        <small>
          {isKnown(focus.insight)
            ? `${FRESHNESS_LABEL[freshnessOf(game, focus)]} · ${focus.insight.possibleCount}° left`
            : "every shot sends an echo"}
        </small>
      </>
    );
  }

  const tracked = game.opponents.filter((opponent) => opponent.alive && isKnown(opponent.insight)).length;
  return (
    <>
      <b>{tracked === 0 ? "No shields tracked" : `${tracked} shield${tracked === 1 ? "" : "s"} tracked`}</b>
      <small>{tracked === 0 ? "every shot sends an echo" : "tap a wizard to focus"}</small>
    </>
  );
}
