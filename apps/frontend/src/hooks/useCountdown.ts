import { useEffect, useState } from 'react';

/** Seconds left of a countdown, ticking once per second. `start(n)` (re)starts it. */
export function useCountdown(initialSeconds = 0) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + initialSeconds * 1000);
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  return { secondsLeft, start: (seconds: number) => setEndsAt(Date.now() + seconds * 1000) };
}
