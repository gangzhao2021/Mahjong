import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { newClock, tick, type PlayClock } from './breakReminder';

/** Hours played whenever a reminder is due (with a changing `at`), else null. */
export function useBreakReminder(atTable: boolean): { hours: number; at: number } | null {
  const clock = useRef<PlayClock | null>(null);
  const [due, setDue] = useState<{ hours: number; at: number } | null>(null);
  const foreground = useRef(AppState.currentState !== 'background');

  useEffect(() => {
    const step = () => {
      const now = Date.now();
      const next = tick(clock.current ?? newClock(now), now, atTable && foreground.current);
      clock.current = next.clock;
      if (next.remind !== null) setDue({ hours: next.remind, at: now });
    };
    step();
    const timer = setInterval(step, 30_000);
    const sub = AppState.addEventListener('change', (state) => {
      step();
      foreground.current = state !== 'background';
      step();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [atTable]);

  return due;
}
