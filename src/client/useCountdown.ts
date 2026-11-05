import { useEffect, useState } from "react";

// Counts down whole seconds from a server-reported duration. The deadline is set on this
// device when the value arrives, so differing clocks between devices do not matter.
export function useCountdown(remainingMs: number | null) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setDeadline(remainingMs === null ? null : Date.now() + remainingMs);
  }, [remainingMs]);

  useEffect(() => {
    if (deadline === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [deadline]);

  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
