import { useEffect, useRef, useState } from 'react';

/**
 * Smooth local countdown seeded from the server's `remaining` value.
 *
 * The server is polled every 3s; ticking locally between polls keeps the
 * clock from stuttering. `remaining === null` means the share never expires.
 */
export function useCountdown(remaining: number | null | undefined) {
  const [left, setLeft] = useState<number | null>(remaining ?? null);
  // Highest value seen this session — used to render depletion as a ratio.
  const spanRef = useRef<number>(typeof remaining === 'number' ? remaining : 0);

  // Re-seed whenever the server reports (authoritative).
  useEffect(() => {
    if (remaining === null || remaining === undefined) {
      setLeft(null);
      return;
    }
    setLeft(remaining);
    if (remaining > spanRef.current) spanRef.current = remaining;
  }, [remaining]);

  // Tick locally between polls.
  useEffect(() => {
    if (left === null) return;
    if (left <= 0) return;
    const id = setInterval(() => setLeft((v) => (v === null ? null : Math.max(0, v - 1))), 1000);
    return () => clearInterval(id);
  }, [left === null, left === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const infinite = left === null;
  const span = spanRef.current || 1;
  const ratio = infinite ? 1 : Math.max(0, Math.min(1, left! / span));
  const critical = !infinite && left !== null && left <= 60;

  return { left, infinite, ratio, critical };
}

/** 3661 -> "1:01:01"; 125 -> "2:05". Tabular digits keep it from jittering. */
export function formatClock(total: number | null): string {
  if (total === null) return '\u221E';
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
