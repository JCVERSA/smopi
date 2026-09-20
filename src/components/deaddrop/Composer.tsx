import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowUp, Paperclip, Square } from 'lucide-react';

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAttach: () => void;
  isProcessing: boolean;
  /** Placeholder differs between the hero and docked positions. */
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * The composer: a pill that grows with its content, in the ChatGPT idiom.
 * The send button morphs into a stop button while a response streams, so the
 * same spot is always the primary control.
 */
export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSend,
  onStop,
  onAttach,
  isProcessing,
  placeholder = 'Message Smopi\u2026',
  autoFocus
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow to fit, capped by CSS max-height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <div className="dd-composer2">
      <button
        type="button"
        className="dd-composer2__attach"
        onClick={onAttach}
        title="Add files"
        aria-label="Add files"
      >
        <Paperclip size={17} />
      </button>

      <textarea
        ref={ref}
        rows={1}
        className="dd-composer2__input"
        value={value}
        placeholder={placeholder}
        aria-label="Message Smopi"
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isProcessing) onSend();
          }
        }}
      />

      <motion.button
        type="button"
        className="dd-composer2__send"
        onClick={isProcessing ? onStop : onSend}
        disabled={!isProcessing && !value.trim()}
        whileTap={{ scale: 0.9 }}
        title={isProcessing ? 'Stop generating' : 'Send'}
        aria-label={isProcessing ? 'Stop generating' : 'Send message'}
      >
        {isProcessing ? <Square size={14} fill="currentColor" /> : <ArrowUp size={17} />}
      </motion.button>
    </div>
  );
};
