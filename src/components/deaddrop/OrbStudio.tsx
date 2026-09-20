import React, { lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Orb } from './Orb';
import type { OrbState } from '../ThoughtLine';
import SquishSwitch from '../SquishSwitch';
import SlingButton from '../SlingButton';
import PeekRating from '../PeekRating';
// Lazy: the studio is closed by default, so its physics code stays out of the
// initial chunk.
const DodgeField = lazy(() => import('../DodgeField'));

interface OrbStudioProps {
  open: boolean;
  onClose: () => void;
  orbState: OrbState;
  setOrbState: (s: OrbState) => void;
  orbSpeed: number;
  setOrbSpeed: (n: number) => void;
}

const STATES: OrbState[] = [
  'working', 'searching', 'solving', 'listening', 'connecting',
  'weaving', 'composing', 'breathing', 'shaping'
];

/**
 * Orb Studio — the playground for the avatar's nine states.
 *
 * Kept from the previous build (with the interaction widgets it hosts) and
 * restyled to the current palette.
 */
export const OrbStudio: React.FC<OrbStudioProps> = ({
  open,
  onClose,
  orbState,
  setOrbState,
  orbSpeed,
  setOrbSpeed
}) => {
  const [dark, setDark] = React.useState(true);
  const [rating, setRating] = React.useState(0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dd-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Orb Studio"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="dd-modal__panel"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dd-modal__head">
              <div>
                <h3 className="dd-title" style={{ fontSize: '1.15rem' }}>Orb Studio</h3>
                <span className="dd-count">Nine hand-tuned states for the avatar</span>
              </div>
              <button type="button" className="dd-btn dd-btn--ghost" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="dd-studio__stage" data-dark={dark}>
              <div className="dd-studio__cell">
                <Orb state={orbState} px={84} theme={dark ? 'dark' : 'light'} speed={orbSpeed} />
                <span className="dd-count">Hero scale</span>
              </div>
              <div className="dd-studio__cell">
                <Orb state={orbState} px={28} theme={dark ? 'dark' : 'light'} speed={orbSpeed} />
                <span className="dd-count">Docked \u00b7 {orbState}</span>
              </div>
            </div>

            <div className="dd-studio__grid">
              {STATES.map((st) => (
                <motion.button
                  key={st}
                  type="button"
                  className="dd-btn"
                  data-on={orbState === st}
                  style={{
                    justifyContent: 'flex-start',
                    borderColor: orbState === st ? 'var(--dd-signal)' : 'var(--dd-line)',
                    color: orbState === st ? 'var(--dd-signal)' : 'var(--dd-bone)'
                  }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setOrbState(st)}
                >
                  <Orb state={st} px={20} theme={dark ? 'dark' : 'light'} />
                  <span>{st}</span>
                </motion.button>
              ))}
            </div>

            <div className="dd-studio__controls">
              <SquishSwitch
                checked={dark}
                onChange={setDark}
                label="Dark tuning"
                width={48}
                height={24}
                trackColor="#1c282d"
                trackOnColor="#c2603c"
              />
              <div className="dd-studio__speed">
                <label htmlFor="orb-speed" className="dd-label">Speed {orbSpeed}x</label>
                <input
                  id="orb-speed"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={orbSpeed}
                  onChange={(e) => setOrbSpeed(parseFloat(e.target.value))}
                />
              </div>
              <SlingButton
                onSend={onClose}
                size={32}
                padColor="#c2603c"
                iconColor="#0e1518"
                ariaLabel="Close Orb Studio"
              />
            </div>

            <div className="dd-studio__foot">
              <div className="dd-studio__rate">
                <span className="dd-label">Rate this orb</span>
                <PeekRating
                  size={18}
                  count={5}
                  value={rating}
                  onChange={setRating}
                  activeColor="#c2603c"
                  idleColor="#2a3a40"
                  labels={['Poor', 'Fair', 'Good', 'Great', 'Perfect']}
                />
              </div>
              <Suspense fallback={<div style={{ height: 100 }} aria-busy="true" />}>
                <DodgeField
                  fieldHeight={100}
                  patience={3}
                  taunts={['Catch the orb', 'Too slow', 'Almost', 'Caught']}
                  onCatch={() => setOrbState('composing')}
                  inkColor="#93a7a4"
                  contrastColor="#c2603c"
                />
              </Suspense>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
