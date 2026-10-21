import { useEffect, useState } from 'react';

/**
 * Seconds left until `initialEndsAt` (epoch ms), ticking once per second. `start(n)` (re)starts it
 * and returns the new end time, so callers can persist it and resume the countdown later.
 */
export function useCountdown(initialEndsAt = 0) {
  const [endsAt, setEndsAt] = useState(initialEndsAt);
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(initialEndsAt));

  useEffect(() => {
    const tick = () => setSecondsLeft(remaining(endsAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  function start(seconds: number): number {
    const next = Date.now() + seconds * 1000;
    setEndsAt(next);
    return next;
  }

  return { secondsLeft, start };
}

function remaining(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}
