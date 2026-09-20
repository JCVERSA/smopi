import React from 'react';
import { ThinkingOrb, type OrbState, type OrbSize } from 'thinking-orbs';

interface OrbProps {
  state: OrbState;
  /** Desired rendered size in CSS px. */
  px: number;
  theme?: 'dark' | 'light';
  speed?: number;
}

/**
 * Size-safe wrapper around ThinkingOrb.
 *
 * The library ships exactly two tuned presets — 64 (avatar scale) and 20
 * (inline scale) — which carry their own dot counts and speeds; they are
 * separate designs rather than one design scaled. Passing any other number is
 * a type error.
 *
 * So we pick the nearer preset and reach any other size with a CSS transform,
 * which preserves each preset's tuning instead of distorting it.
 */
export const Orb: React.FC<OrbProps> = ({ state, px, theme = 'dark', speed = 1 }) => {
  const preset: OrbSize = px >= 42 ? 64 : 20;
  const scale = px / preset;

  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: px,
        height: px,
        // Keep layout honest: the box is `px`, the canvas is scaled inside it.
        lineHeight: 0
      }}
    >
      <span
        style={{
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'center',
          lineHeight: 0
        }}
      >
        <ThinkingOrb state={state} size={preset} theme={theme} speed={speed} />
      </span>
    </span>
  );
};
