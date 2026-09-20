import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Markdown from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import { Orb } from './Orb';
import type { OrbState } from '../ThoughtLine';
import type { SmopiAction, SmopiMessage } from '../../types';
import type { ChatPhase } from './useSmopiChat';

interface MessageListProps {
  messages: SmopiMessage[];
  phase: ChatPhase;
  toolDetail?: string;
  orbState: OrbState;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}

const ACTION_VERB: Record<string, string> = {
  created: 'created',
  modified: 'modified',
  renamed: 'renamed',
  deleted: 'deleted',
  duplicated: 'duplicated',
  indexed: 'indexed',
  analyzed: 'analyzed'
};

const PHASE_LABEL: Record<ChatPhase, string> = {
  idle: '',
  thinking: 'Thinking',
  tooling: 'Working on your files',
  writing: 'Writing'
};

/**
 * The transcript.
 *
 * Turns rise into place on arrival. Assistant text renders as Markdown with a
 * blinking caret while tokens are still arriving, and file mutations appear in
 * a ledger as they happen rather than only at the end.
 */
export const MessageList: React.FC<MessageListProps> = ({
  messages,
  phase,
  toolDetail,
  orbState,
  copiedId,
  onCopy
}) => {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Only autoscroll when the user is already at the bottom, so scrolling back
  // to re-read something is not fought by incoming tokens.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (pinnedRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  });

  const lastId = messages[messages.length - 1]?.id;
  const showPhase = phase !== 'idle';

  return (
    <div className="dd-log" ref={scrollerRef} onScroll={onScroll}>
      <div className="dd-log__inner">
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            if (isUser) {
              return (
                <motion.div
                  key={msg.id}
                  layout="position"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="dd-msg dd-msg--user"
                >
                  <div className="dd-msg__user-bubble">{msg.text}</div>
                </motion.div>
              );
            }

            const isEmptyStreaming = msg.streaming && !msg.text;

            return (
              <motion.div
                key={msg.id}
                layout="position"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="dd-msg dd-msg--model"
              >
                <div className="dd-msg__avatar" aria-hidden="true">
                  <Orb state={orbState} px={24} speed={msg.streaming ? 1.2 : 0.6} />
                </div>

                <div className="dd-msg__col">
                  {!isEmptyStreaming && (
                    <div className="dd-msg__prose">
                      <Markdown>{msg.text}</Markdown>
                      {msg.streaming && <span className="dd-caret" aria-hidden="true" />}
                    </div>
                  )}

                  {msg.actions && msg.actions.length > 0 && (
                    <motion.div layout className="dd-ledger">
                      <AnimatePresence initial={false}>
                        {msg.actions.map((act: SmopiAction, i: number) => (
                          <motion.span
                            key={`${act.type}-${act.file}-${i}`}
                            className="dd-ledger__item"
                            initial={{ opacity: 0, scale: 0.92 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                          >
                            <span className="dd-ledger__verb" data-kind={act.type}>
                              {ACTION_VERB[act.type] ?? act.type}
                            </span>
                            <span>{act.file}</span>
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  )}

                  {!msg.streaming && msg.text && (
                    <div className="dd-msg__tools">
                      <button
                        type="button"
                        className="dd-btn dd-btn--ghost"
                        onClick={() => onCopy(msg.id, msg.text)}
                        title="Copy response"
                      >
                        {copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                        {copiedId === msg.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Phase indicator, shown until the first token lands. */}
        <AnimatePresence>
          {showPhase && (
            <motion.div
              key="phase"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="dd-phase"
              aria-live="polite"
            >
              <span className="dd-phase__text">
                {PHASE_LABEL[phase]}
                {phase === 'tooling' && toolDetail ? `: ${toolDetail.replace(/_/g, ' ')}` : ''}
              </span>
              <span className="dd-phase__dots">
                <span /><span /><span />
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={endRef} />
      </div>
    </div>
  );
};
