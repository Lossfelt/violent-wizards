import { useEffect, useState } from "react";
import type { ExchangeAction, GameSnapshot } from "../../shared";
import { useCountdown } from "../useCountdown";
import { ECHO_COLOR, isKnown, type Opponent } from "./dialMath";

type Props = {
  game: GameSnapshot;
  focus: Opponent | null;
  preparing: boolean;
  activeSlot: number | null;
  discards: number[];
  tunedSlot: number | null;
  rotating: boolean;
  rotation: number;
  choice: string | null;
  mustFire: boolean;
  onToggleDiscard: (slot: number) => void;
  onUndoTune: () => void;
  onReady: () => void;
  onDeclare: (target: string | null, rotation?: number) => void;
  onStartRotating: () => void;
  onStopRotating: () => void;
  onBattle: (action: ExchangeAction) => void;
  onNextRound: () => void;
  onShare: (receiverId: string) => void;
  onPeek: (peeking: boolean) => void;
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function BattleSummary({ game }: { game: GameSnapshot }) {
  const battle = game.currentBattle;
  if (!battle) return null;
  const echo = battle.lastExchange?.echo ?? null;

  return (
    <div className="sheet-row sheet-battle">
      <span>
        vs <b>{battle.opponentName}</b> · you took <b>{Math.ceil(battle.totalDamageTaken)}</b>
      </span>
      {echo ? (
        <span className="sheet-echo" style={{ color: ECHO_COLOR[echo] }}>
          {echo}
        </span>
      ) : null}
    </div>
  );
}

function RoundBreak({ game }: { game: GameSnapshot }) {
  const seconds = useCountdown(game.nextRoundInMs);

  if (seconds !== null) {
    return <p className="sheet-hint">Round over. The next round starts in {seconds} s.</p>;
  }

  return game.hostPlayerId === game.currentPlayer.id ? null : (
    <p className="sheet-hint">Round over. Waiting for the host to start the next one.</p>
  );
}

function PhaseContent(props: Props) {
  const { game, focus } = props;
  const me = game.currentPlayer;
  const battle = game.currentBattle;
  const livingIds = [
    ...(me.alive ? [me.id] : []),
    ...game.opponents.filter((opponent) => opponent.alive).map((opponent) => opponent.id),
  ];

  if (game.status === "finished") {
    return <p className="sheet-hint">The war is over. Start a new lobby to play again.</p>;
  }

  if (!me.alive) {
    return <p className="sheet-hint">You have fallen. Your knowledge died with you, but you can watch the war.</p>;
  }

  if (game.status === "round_prepare") {
    if (!props.preparing) {
      const waiting = livingIds.filter((id) => !game.discardSubmittedPlayerIds.includes(id)).length;
      return <p className="sheet-hint">Ready. Waiting for {plural(waiting, "wizard")}.</p>;
    }

    const discarded = [...props.discards].sort((a, b) => a - b).map((slot) => slot + 1);
    return (
      <>
        {props.activeSlot !== null ? (
          <div className="sheet-row">
            <button
              aria-pressed={props.discards.includes(props.activeSlot)}
              data-tone="danger"
              onClick={() => props.onToggleDiscard(props.activeSlot!)}
              type="button"
            >
              {props.discards.includes(props.activeSlot) ? "Keep" : "Discard"}
            </button>
            {props.tunedSlot === props.activeSlot ? (
              <button onClick={props.onUndoTune} type="button">
                Undo tune
              </button>
            ) : props.discards.includes(props.activeSlot) ? (
              <span className="sheet-hint">A new Mado fills this slot next round.</span>
            ) : (
              <span className="sheet-hint">Drag along the ring to tune it.</span>
            )}
          </div>
        ) : (
          <p className="sheet-hint">Tap a Mado on the dial to discard or tune it.</p>
        )}
        {discarded.length > 0 || props.tunedSlot !== null ? (
          <p className="sheet-summary">
            {discarded.length > 0 ? `Discarding Mado ${discarded.join(", ")}. ` : ""}
            {props.tunedSlot !== null ? `Tuning Mado ${props.tunedSlot + 1}.` : ""}
          </p>
        ) : null}
        <button className="sheet-primary" onClick={props.onReady} type="button">
          Ready
        </button>
      </>
    );
  }

  if (game.status === "attack_declaration") {
    if (game.attackSubmittedPlayerIds.includes(me.id)) {
      const waiting = livingIds.filter((id) => !game.attackSubmittedPlayerIds.includes(id)).length;
      const decided = me.rotatingThisRound
        ? "You are rotating your shield."
        : props.choice?.startsWith("attack ")
          ? `You ${props.choice}.`
          : props.choice === "hide"
            ? "You stay hidden."
            : "Declared.";
      return (
        <p className="sheet-hint">
          {decided} Waiting for {plural(waiting, "wizard")}.
        </p>
      );
    }

    if (props.rotating) {
      return (
        <>
          <p className="sheet-hint">
            Drag your shield ◈. Everyone senses the rotation. If attacked this round you can only flee.
          </p>
          <div className="sheet-row">
            <button onClick={props.onStopRotating} type="button">
              Cancel
            </button>
            <button className="sheet-primary" onClick={() => props.onDeclare(null, props.rotation)} type="button">
              Rotate {props.rotation > 0 ? "+" : ""}
              {props.rotation}°
            </button>
          </div>
        </>
      );
    }

    return (
      <div className="sheet-choices">
        <button
          className="sheet-primary"
          disabled={!focus}
          onClick={() => focus && props.onDeclare(focus.id)}
          type="button"
        >
          {focus ? `Attack ${focus.name}` : "Tap a wizard to attack"}
        </button>
        <div className="sheet-row">
          <button onClick={() => props.onDeclare(null)} type="button">
            Stay hidden
          </button>
          <button onClick={props.onStartRotating} type="button">
            Rotate shield
          </button>
        </div>
      </div>
    );
  }

  if (game.status === "battle_resolution") {
    if (!battle) {
      return <p className="sheet-hint">You are not fighting this round. Watch the table.</p>;
    }

    if (battle.status !== "active") {
      return (
        <>
          <BattleSummary game={game} />
          <p className="sheet-hint">Your battle is over. Waiting for the others.</p>
        </>
      );
    }

    const fleeing = battle.fleeingPlayerIds.includes(me.id);
    const opponentFleeing = battle.fleeingPlayerIds.includes(battle.opponentId);
    return (
      <>
        <BattleSummary game={game} />
        {fleeing ? (
          <p className="sheet-hint">
            {me.rotatingThisRound ? "You are rotating your shield and can only flee." : "You are fleeing."}
          </p>
        ) : props.mustFire ? (
          <div className="sheet-row">
            <span className="sheet-hint">
              {battle.exchangeCount === 0 ? "Tap a Mado to fire your first shot." : "Tap a Mado to fire."}
            </span>
            {battle.exchangeCount > 0 ? (
              <button onClick={() => props.onBattle({ type: "flee" })} type="button">
                Flee
              </button>
            ) : null}
            {opponentFleeing && battle.exchangeCount > 0 ? (
              <button onClick={() => props.onBattle({ type: "end" })} type="button">
                End
              </button>
            ) : null}
          </div>
        ) : (
          <p className="sheet-hint">Waiting for {battle.opponentName}.</p>
        )}
      </>
    );
  }

  return (
    <>
      <BattleSummary game={game} />
      {game.hostPlayerId === me.id && !game.tableHosted ? (
        <button className="sheet-primary" onClick={props.onNextRound} type="button">
          Start next round
        </button>
      ) : null}
      <RoundBreak game={game} />
    </>
  );
}

export function ActionSheet(props: Props) {
  const { game, focus } = props;
  const me = game.currentPlayer;
  const [sharing, setSharing] = useState(false);
  const inBattle = game.status === "battle_resolution" && game.currentBattle?.status === "active";
  const canShare = me.alive && game.status !== "finished" && !inBattle && focus !== null && isKnown(focus.insight);
  const receivers = game.opponents.filter((opponent) => opponent.alive && opponent.id !== focus?.id);

  useEffect(() => setSharing(false), [focus?.id, game.status]);

  return (
    <section className="sheet">
      <PhaseContent {...props} />

      {canShare ? (
        sharing ? (
          <div className="sheet-share">
            <span className="sheet-hint">Share what you know about {focus!.name} with:</span>
            <div className="sheet-row">
              {receivers.map((receiver) => (
                <button key={receiver.id} onClick={() => (props.onShare(receiver.id), setSharing(false))} type="button">
                  {receiver.name}
                </button>
              ))}
              <button onClick={() => setSharing(false)} type="button">
                Cancel
              </button>
            </div>
          </div>
        ) : receivers.length > 0 ? (
          <button className="sheet-quiet" onClick={() => setSharing(true)} type="button">
            Share what you know about {focus!.name}
          </button>
        ) : null
      ) : null}

      {me.alive && !props.rotating && game.status !== "finished" ? (
        <button
          className="sheet-peek"
          onPointerCancel={() => props.onPeek(false)}
          onPointerDown={() => props.onPeek(true)}
          onPointerLeave={() => props.onPeek(false)}
          onPointerUp={() => props.onPeek(false)}
          type="button"
        >
          ◈ Hold to see your shield
        </button>
      ) : null}
    </section>
  );
}
