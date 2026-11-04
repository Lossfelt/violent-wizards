// PROTOTYPE: game screen variants, switchable via ?prototype&variant=A3&phase=... See NOTES.md.
// Dev only (see main.tsx). Answers "what should the game screen look like?". Delete when decided.
import { useEffect, useState } from "react";
import { mockGame, type PrototypePhase } from "./mockGame";
import { VariantDial } from "./VariantDial";
import "./prototype.css";

const VARIANTS = [
  { key: "A3", name: "Dial + mini table", Component: VariantDial },
] as const;
const PHASES: PrototypePhase[] = ["prepare", "declare", "battle"];

function readParam(name: string, fallback: string) {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function writeParams(variant: string, phase: string) {
  const params = new URLSearchParams(window.location.search);
  params.set("variant", variant);
  params.set("phase", phase);
  window.history.replaceState(null, "", `?${params.toString()}`);
}

export function UiPrototype() {
  const [variantKey, setVariantKey] = useState(() => readParam("variant", "A3"));
  const [phase, setPhase] = useState<PrototypePhase>(
    () => readParam("phase", "prepare") as PrototypePhase,
  );
  const index = Math.max(0, VARIANTS.findIndex((variant) => variant.key === variantKey));
  const variant = VARIANTS[index]!;

  function cycle(step: number) {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!;
    setVariantKey(next.key);
  }

  useEffect(() => writeParams(variant.key, phase), [variant.key, phase]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;

      if (target.closest("input, textarea, select, [contenteditable]")) {
        return;
      }

      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const Component = variant.Component;

  return (
    <>
      <Component game={mockGame(phase)} key={`${variant.key}-${phase}`} />
      <nav className="proto-switcher" aria-label="Prototype switcher">
        <button aria-label="Previous variant" onClick={() => cycle(-1)} type="button">
          ←
        </button>
        <span>
          {variant.key} · {variant.name}
        </span>
        <button aria-label="Next variant" onClick={() => cycle(1)} type="button">
          →
        </button>
        <select
          aria-label="Phase"
          value={phase}
          onChange={(event) => setPhase(event.target.value as PrototypePhase)}
        >
          {PHASES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </nav>
    </>
  );
}
