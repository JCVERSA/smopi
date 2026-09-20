import React, { useState } from 'react';
import type { ShareStatus } from '../types';
import { Spine } from './deaddrop/Spine';

interface StoppedViewProps {
  status: ShareStatus | null;
  onRestart: () => void;
}

/**
 * The closed drop.
 *
 * The spine is rendered empty — the same element that was counting down is
 * now visibly spent, which is what makes the state legible at a glance. The
 * session's final tally is presented as a plain figure list, not stat cards.
 */
export const StoppedView: React.FC<StoppedViewProps> = ({ status, onRestart }) => {
  const [isRestarting, setIsRestarting] = useState(false);

  const handleRestartClick = async () => {
    setIsRestarting(true);
    try {
      await onRestart();
    } finally {
      setIsRestarting(false);
    }
  };

  const reason =
    status?.stop_reason === 'expired'
      ? {
          title: 'The clock ran out.',
          desc: 'This drop had a time limit and it has elapsed. Nothing here is reachable any more.'
        }
      : status?.stop_reason === 'one_time'
        ? {
            title: 'Collected once, then closed.',
            desc: 'This was a single-transfer drop. It shut itself the moment the download finished.'
          }
        : {
            title: 'The owner closed it.',
            desc: 'Whoever set up this drop ended the session. The link is inactive.'
          };

  return (
    <div className="dd-gate">
      <div>
        {/* An empty spine: the share's life is spent. */}
        <Spine ratio={0} infinite={false} critical={false} />
        <header className="dd-topbar">
          <div className="dd-topbar__left">
            <span className="dd-mark">Dead Drop</span>
          </div>
          <span className="dd-count" style={{ color: 'var(--dd-signal)' }}>
            Closed
          </span>
        </header>
      </div>

      <div className="dd-gate__center">
        <div className="dd-gate__form">
          <h1 className="dd-gate__title">{reason.title}</h1>
          <p className="dd-gate__sub">{reason.desc}</p>

          <dl
            style={{
              margin: '0 0 32px',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              rowGap: 0,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            <dt
              className="dd-label"
              style={{ padding: '10px 0', borderTop: '1px solid var(--dd-line)' }}
            >
              Files taken
            </dt>
            <dd
              style={{ margin: 0, padding: '10px 0', borderTop: '1px solid var(--dd-line)', textAlign: 'right' }}
            >
              {status?.downloads_total ?? 0}
            </dd>

            <dt
              className="dd-label"
              style={{ padding: '10px 0', borderTop: '1px solid var(--dd-line)' }}
            >
              Data transferred
            </dt>
            <dd
              style={{ margin: 0, padding: '10px 0', borderTop: '1px solid var(--dd-line)', textAlign: 'right' }}
            >
              {status?.bytes_total_human ?? '0 B'}
            </dd>
          </dl>

          <button
            type="button"
            className="dd-btn dd-btn--primary"
            style={{ width: '100%', justifyContent: 'center', padding: '11px' }}
            onClick={handleRestartClick}
            disabled={isRestarting}
          >
            {isRestarting ? 'Opening\u2026' : 'Open a new drop'}
          </button>
          <p className="dd-count" style={{ marginTop: 10 }}>
            A new drop starts a fresh timer. Existing files stay where they are.
          </p>
        </div>
      </div>
    </div>
  );
};

export default StoppedView;
