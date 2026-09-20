import React from 'react';

interface SpineProps {
  /** 0..1 of the share's life remaining. */
  ratio: number;
  /** True when the share has no expiry configured. */
  infinite: boolean;
  /** Under 60s — the spine breathes. */
  critical: boolean;
}

/**
 * The depletion spine: a full-bleed hairline that shortens as the share
 * expires. This is the single bold element in the interface — the product's
 * defining fact (it disappears) rendered as structure rather than a widget.
 *
 * With no expiry it stays full and neutral rather than vanishing, so the
 * layout is stable in every configuration.
 */
export const Spine: React.FC<SpineProps> = ({ ratio, infinite, critical }) => (
  <div
    className="dd-spine"
    role="progressbar"
    aria-label={infinite ? 'Share does not expire' : 'Share time remaining'}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={infinite ? 100 : Math.round(ratio * 100)}
  >
    <div
      className="dd-spine__fill"
      data-infinite={infinite ? 'true' : 'false'}
      data-critical={critical ? 'true' : 'false'}
      style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
    />
  </div>
);
