import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  Check,
  KeyRound,
  PanelLeftOpen,
  Power,
  RotateCcw,
  Sliders,
  LayoutGrid,
  MessageSquare
} from 'lucide-react';
import type { SharedFile, ShareStatus } from '../types';
import type { OrbState } from './ThoughtLine';
import { Orb } from './deaddrop/Orb';
import { Spine } from './deaddrop/Spine';
import { useCountdown, formatClock } from './deaddrop/useCountdown';
import { useSmopiChat, type ChatPhase } from './deaddrop/useSmopiChat';
import { FilesSidebar } from './deaddrop/FilesSidebar';
import { MessageList } from './deaddrop/MessageList';
import { Composer } from './deaddrop/Composer';
import { OrbStudio } from './deaddrop/OrbStudio';

interface SmopiWorkspaceViewProps {
  files: SharedFile[];
  status: ShareStatus | null;
  authToken: string | null;
  onFilesChanged: () => void;
  onPreviewFile: (file: SharedFile) => void;
  onEditFile: (file?: SharedFile, content?: string) => void;
  onDownloadFile: (file: SharedFile) => void;
  onDeleteFile: (filename: string) => void;
  onUploadClick: () => void;
  onStopShare: () => void;
  onSelectFile?: (filename: string, e: React.MouseEvent) => void;
  selectedFiles?: string[];
  renderFilesGallery?: React.ReactNode;
}

const WELCOME_TEXT =
  "I can create, organise, rename, summarise and delete the files in this drop. Tell me what you need.";

/** Maps the message text to one of the orb's nine hand-tuned states. */
function orbStateFor(query: string): OrbState {
  const q = query.toLowerCase();
  if (/(search|find|look|scan)/.test(q)) return 'searching';
  if (/(create|write|compose|markdown|draft)/.test(q)) return 'composing';
  if (/(organi[sz]e|rename|clean|sort)/.test(q)) return 'weaving';
  if (/(fix|solve|delete|remove|audit)/.test(q)) return 'solving';
  if (/(connect|sync|share)/.test(q)) return 'connecting';
  if (/(shape|format|transform)/.test(q)) return 'shaping';
  return 'working';
}

const SUGGESTIONS = [
  { label: 'Summarise this drop', prompt: 'Summarise everything in this workspace.' },
  { label: 'Create an index', prompt: 'Generate an index.md table of contents for all files.' },
  { label: 'Tidy the filenames', prompt: 'Organize and rename files cleanly and consistently.' },
  { label: 'Find duplicates', prompt: 'Find duplicate or redundant files in this workspace.' }
];

/**
 * Smopi workspace — a chat-first layout in the ChatGPT idiom.
 *
 * Structure: a collapsible files sidebar on the left, the conversation
 * centred in a comfortable reading column, and a floating composer pinned to
 * the bottom. The orb avatar is the anchor: it opens large and centred on the
 * empty state, then performs a shared-layout transition into the header the
 * moment the first message is sent, freeing the centre for the transcript.
 *
 * Text streams token-by-token from `/api/smopi/chat/stream` (SSE), with an
 * automatic fallback to the buffered endpoint.
 */
export const SmopiWorkspaceView: React.FC<SmopiWorkspaceViewProps> = ({
  files,
  status,
  authToken,
  onFilesChanged,
  onPreviewFile,
  onEditFile,
  onDownloadFile,
  onDeleteFile,
  onUploadClick,
  onStopShare,
  onSelectFile,
  selectedFiles = [],
  renderFilesGallery
}) => {
  const reduceMotion = useReducedMotion();

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [orbState, setOrbState] = useState<OrbState>('breathing');
  const [orbSpeed, setOrbSpeed] = useState(1);
  const [showStudio, setShowStudio] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [tab, setTab] = useState<'chat' | 'gallery'>('chat');

  const { left, infinite, ratio, critical } = useCountdown(status?.remaining);

  const handlePhase = useCallback((phase: ChatPhase) => {
    if (phase === 'idle') setOrbState('breathing');
  }, []);

  const { messages, phase, toolDetail, isProcessing, send, stop, reset } = useSmopiChat({
    authToken,
    onFilesChanged,
    onPhase: handlePhase,
    welcomeText: WELCOME_TEXT
  });

  // The hero state is the untouched conversation: welcome message only.
  const isHero = messages.length === 1 && messages[0].id.startsWith('welcome');

  const submit = useCallback(
    (text?: string) => {
      const q = (text ?? input).trim();
      if (!q || isProcessing) return;
      setOrbState(orbStateFor(q));
      setInput('');
      void send(q);
    },
    [input, isProcessing, send]
  );

  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }, []);

  const copyPassword = useCallback(() => {
    if (!status?.share_password) return;
    navigator.clipboard.writeText(status.share_password);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
  }, [status?.share_password]);

  // Cmd/Ctrl+B toggles the sidebar, as in the apps this layout echoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const spring = useMemo(
    () =>
      reduceMotion
        ? { duration: 0 }
        : { type: 'spring' as const, stiffness: 260, damping: 30, mass: 0.9 },
    [reduceMotion]
  );

  return (
    <div className="dd-app">
      <Spine ratio={ratio} infinite={infinite} critical={critical} />

      <div className="dd-app__body">
        {/* ---------------- Sidebar ---------------- */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              key="sidebar"
              className="dd-side"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 288, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              aria-label="Files in this drop"
            >
              <FilesSidebar
                files={files}
                selectedFiles={selectedFiles}
                onSelectFile={onSelectFile}
                onPreviewFile={onPreviewFile}
                onEditFile={onEditFile}
                onDownloadFile={onDownloadFile}
                onDeleteFile={onDeleteFile}
                onUploadClick={onUploadClick}
                onCollapse={() => setSidebarOpen(false)}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ---------------- Main ---------------- */}
        <main className="dd-main">
          <LayoutGroup>
            <header className="dd-topbar">
              <div className="dd-topbar__left">
                {!sidebarOpen && (
                  <button
                    type="button"
                    className="dd-btn dd-btn--ghost dd-btn--icon"
                    onClick={() => setSidebarOpen(true)}
                    title="Open sidebar"
                    aria-label="Open sidebar"
                  >
                    <PanelLeftOpen size={16} />
                  </button>
                )}

                {/* Docked avatar. Shares a layoutId with the hero orb, so the
                    two positions are one continuous element. */}
                {!isHero && (
                  <motion.div layoutId="smopi-orb" transition={spring} className="dd-orb-dock">
                    <Orb state={orbState} px={28} speed={orbSpeed} />
                  </motion.div>
                )}

                <span className="dd-mark">Smopi</span>

                <span className="dd-topbar__clock" aria-live="polite">
                  <span className="dd-clock-sm" data-critical={critical ? 'true' : 'false'}>
                    {formatClock(left)}
                  </span>
                  <span className="dd-clock__unit">{infinite ? 'no expiry' : 'left'}</span>
                </span>
              </div>

              <div className="dd-topbar__right">
                <div className="dd-seg" role="tablist" aria-label="View">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'chat'}
                    className="dd-seg__btn"
                    data-on={tab === 'chat'}
                    onClick={() => setTab('chat')}
                  >
                    <MessageSquare size={13} /> Chat
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'gallery'}
                    className="dd-seg__btn"
                    data-on={tab === 'gallery'}
                    onClick={() => setTab('gallery')}
                  >
                    <LayoutGrid size={13} /> Gallery
                  </button>
                </div>

                {status?.share_password && (
                  <button type="button" className="dd-btn" onClick={copyPassword} title="Copy share password">
                    {copiedPassword ? <Check size={14} /> : <KeyRound size={14} />}
                    {copiedPassword ? 'Copied' : 'Password'}
                  </button>
                )}
                <button
                  type="button"
                  className="dd-btn dd-btn--ghost dd-btn--icon"
                  onClick={() => setShowStudio(true)}
                  title="Orb Studio"
                  aria-label="Open Orb Studio"
                >
                  <Sliders size={15} />
                </button>
                <button
                  type="button"
                  className="dd-btn dd-btn--ghost dd-btn--icon"
                  onClick={reset}
                  title="New conversation"
                  aria-label="New conversation"
                >
                  <RotateCcw size={15} />
                </button>
                {status?.is_owner && (
                  <button type="button" className="dd-btn dd-btn--danger" onClick={onStopShare} title="Stop this share">
                    <Power size={14} />
                    Stop
                  </button>
                )}
              </div>
            </header>

            {tab === 'gallery' ? (
              <div className="dd-log">
                <div className="dd-log__inner">{renderFilesGallery}</div>
              </div>
            ) : isHero ? (
              /* ---------- Hero: avatar centred, composer beneath ---------- */
              <div className="dd-hero">
                <motion.div
                  layoutId="smopi-orb"
                  transition={spring}
                  className="dd-hero__orb"
                >
                  <Orb state={orbState} px={104} speed={orbSpeed} />
                </motion.div>

                <motion.h1
                  className="dd-hero__title"
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06, duration: 0.3 }}
                >
                  What should I do with these files?
                </motion.h1>

                <motion.p
                  className="dd-hero__sub"
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12, duration: 0.3 }}
                >
                  {files.length === 0
                    ? 'This drop is empty. Add a file, or ask me to create one.'
                    : `${files.length} ${files.length === 1 ? 'file' : 'files'} in this drop.`}
                </motion.p>

                <motion.div
                  className="dd-hero__composer"
                  initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16, duration: 0.3 }}
                >
                  <Composer
                    value={input}
                    onChange={setInput}
                    onSend={() => submit()}
                    onStop={stop}
                    onAttach={onUploadClick}
                    isProcessing={isProcessing}
                    placeholder="Ask Smopi anything about these files\u2026"
                    autoFocus
                  />
                </motion.div>

                <motion.div
                  className="dd-chips"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.22, duration: 0.3 }}
                >
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={s.label}
                      type="button"
                      className="dd-chip"
                      onClick={() => submit(s.prompt)}
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.24 + i * 0.04, duration: 0.25 }}
                      whileHover={reduceMotion ? undefined : { y: -2 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      {s.label}
                    </motion.button>
                  ))}
                </motion.div>
              </div>
            ) : (
              /* ---------- Conversation ---------- */
              <>
                <MessageList
                  messages={messages}
                  phase={phase}
                  toolDetail={toolDetail}
                  orbState={orbState}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                />
                <div className="dd-dock">
                  <div className="dd-dock__inner">
                    <Composer
                      value={input}
                      onChange={setInput}
                      onSend={() => submit()}
                      onStop={stop}
                      onAttach={onUploadClick}
                      isProcessing={isProcessing}
                    />
                    <p className="dd-dock__note">
                      Smopi can modify files in this drop. Changes are immediate.
                    </p>
                  </div>
                </div>
              </>
            )}
          </LayoutGroup>
        </main>
      </div>

      <OrbStudio
        open={showStudio}
        onClose={() => setShowStudio(false)}
        orbState={orbState}
        setOrbState={setOrbState}
        orbSpeed={orbSpeed}
        setOrbSpeed={setOrbSpeed}
      />
    </div>
  );
};
