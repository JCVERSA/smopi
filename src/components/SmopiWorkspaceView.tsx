import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  Trash2,
  Download,
  Edit3,
  RotateCcw,
  Check,
  Copy,
  Eye,
  Search,
  Power,
  Upload,
  KeyRound,
  Sliders
} from 'lucide-react';
import Markdown from 'react-markdown';
import { ThinkingOrb } from 'thinking-orbs';
import type { SharedFile, ShareStatus, SmopiAction, SmopiMessage } from '../types';
import { SmopiAvatar, type SmopiStatus } from './smopi';
import ThoughtLine, { type OrbState } from './ThoughtLine';
import FolderFloat from './FolderFloat';
import PromptBar from './PromptBar';
import SlingButton from './SlingButton';
import GlideSelect from './GlideSelect';
import SquishSwitch from './SquishSwitch';
import PeekRating from './PeekRating';
import { Spine } from './deaddrop/Spine';
import { useCountdown, formatClock } from './deaddrop/useCountdown';
// Lazy: the Orb Studio modal is closed by default (showOrbStudio = false), so
// its physics/canvas code should not ship in the initial chunk.
const DodgeField = lazy(() => import('./DodgeField'));

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

/** Verb shown in the action ledger under an agent turn. */
const ACTION_VERB: Record<string, string> = {
  created: 'created',
  modified: 'modified',
  renamed: 'renamed',
  deleted: 'deleted',
  duplicated: 'duplicated',
  indexed: 'indexed',
  analyzed: 'analyzed'
};

function totalSize(files: SharedFile[]): string {
  const n = files.reduce((acc, f) => acc + (f.size || 0), 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * "Dead Drop" workspace.
 *
 * The design is grounded in the product's defining fact: this share is
 * temporary and will disappear. That fact is the hero, rendered as the
 * depletion spine across the top of the viewport. Everything else is
 * deliberately quiet so the one bold element carries the personality:
 *
 *  - files are a dense hairline-ruled manifest, not a card grid;
 *  - the transcript has no bubbles — speaker is encoded in type and a rule,
 *    which avoids nesting cards inside cards;
 *  - a single accent (signal orange) is reserved for expiry and destruction.
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
  const [messages, setMessages] = useState<SmopiMessage[]>(() => [
    {
      id: 'welcome',
      role: 'model',
      text:
        "I'm Smopi. I can **create**, **organise**, **modify**, **rename**, **summarise** and **delete** the files in this drop.\n\nTell me what you need.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      model: 'Smopi Agent'
    }
  ]);

  const [inputPrompt, setInputPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<SmopiStatus>('idle');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [viewMode, setViewMode] = useState<'chat' | 'files'>('chat');

  // Thinking Orb & interaction component state
  const [orbState, setOrbState] = useState<OrbState>('searching');
  const [orbDark, setOrbDark] = useState<boolean>(true);
  const [orbSpeed, setOrbSpeed] = useState<number>(1);
  const [usePromptBar, setUsePromptBar] = useState<boolean>(true);
  const [showOrbStudio, setShowOrbStudio] = useState<boolean>(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The hero: a smooth local countdown seeded from the server's poll.
  const { left, infinite, ratio, critical } = useCountdown(status?.remaining);

  useEffect(() => {
    if (viewMode === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isProcessing, viewMode]);

  const handleCopyPassword = () => {
    if (status?.share_password) {
      navigator.clipboard.writeText(status.share_password);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputPrompt).trim();
    if (!query || isProcessing) return;

    if (viewMode !== 'chat') {
      setViewMode('chat');
    }

    const userMsg: SmopiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt('');
    setIsProcessing(true);
    setAvatarStatus('thinking');

    // Contextually tune ThinkingOrb state across the 9 hand-tuned states
    const lower = query.toLowerCase();
    if (lower.includes('search') || lower.includes('find') || lower.includes('look') || lower.includes('scan')) {
      setOrbState('searching');
    } else if (lower.includes('create') || lower.includes('write') || lower.includes('compose') || lower.includes('markdown') || lower.includes('draft')) {
      setOrbState('composing');
    } else if (lower.includes('organize') || lower.includes('rename') || lower.includes('clean') || lower.includes('sort')) {
      setOrbState('weaving');
    } else if (lower.includes('fix') || lower.includes('solve') || lower.includes('delete') || lower.includes('remove') || lower.includes('audit')) {
      setOrbState('solving');
    } else if (lower.includes('connect') || lower.includes('sync') || lower.includes('share')) {
      setOrbState('connecting');
    } else if (lower.includes('shape') || lower.includes('format') || lower.includes('transform')) {
      setOrbState('shaping');
    } else {
      setOrbState('working');
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const historyPayload = messages
        .filter((m) => m.id !== 'welcome')
        .slice(-6)
        .map((m) => ({
          role: m.role,
          text: m.text
        }));

      const res = await fetch('/api/smopi/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: query,
          history: historyPayload
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Server error: ${res.status}`);
      }

      const data = await res.json();
      const actions: SmopiAction[] = data.actionsTaken || [];

      const modelMsg: SmopiMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: data.text || 'Done.',
        actions,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: data.model || 'Gemini 3.8 Flash'
      };

      setMessages((prev) => [...prev, modelMsg]);
      setAvatarStatus('success');
      setTimeout(() => setAvatarStatus('idle'), 2500);

      if (actions.length > 0) {
        onFilesChanged();
      }
    } catch (err: any) {
      setAvatarStatus('error');
      setTimeout(() => setAvatarStatus('idle'), 3000);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'model',
          text: `That didn't work: ${err.message || 'the task could not be completed'}.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'model',
        text: `Cleared. This drop currently holds **${files.length} ${files.length === 1 ? 'file' : 'files'}**. What next?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: 'Gemini 3.8 Flash'
      }
    ]);
  };

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(fileSearch.toLowerCase())
  );

  const hasOnlyWelcome = messages.length === 1 && messages[0].id === 'welcome';

  return (
    <div className="dd-root">
      {/* ---- Hero: the depletion spine + header ------------------------- */}
      <div>
        <Spine ratio={ratio} infinite={infinite} critical={critical} />

        <header className="dd-head">
          <div className="dd-head__id">
            <SmopiAvatar size={24} status={avatarStatus} />
            <span className="dd-mark">Dead Drop</span>
            <span aria-live="polite">
              <span className="dd-clock" data-critical={critical ? 'true' : 'false'}>
                {formatClock(left)}
              </span>
              <span className="dd-clock__unit">{infinite ? 'no expiry' : 'left'}</span>
            </span>
          </div>

          <div className="dd-head__acts">
            <GlideSelect
              options={[
                { label: 'Conversation', value: 'chat' },
                { label: 'Gallery', value: 'files' }
              ]}
              value={viewMode}
              onChange={(v) => setViewMode(v === 'files' ? 'files' : 'chat')}
              size="sm"
              ariaLabel="Switch workspace view"
              accentColor="#c2603c"
              surfaceColor="#131c20"
              textColor="#e8edec"
            />

            {status?.share_password && (
              <button type="button" className="dd-btn" onClick={handleCopyPassword} title="Copy the share password">
                {copiedPassword ? <Check size={14} /> : <KeyRound size={14} />}
                {copiedPassword ? 'Copied' : 'Password'}
              </button>
            )}

            <button
              type="button"
              className="dd-btn dd-btn--icon"
              onClick={() => setShowOrbStudio(true)}
              title="Orb Studio"
              aria-label="Open Orb Studio"
            >
              <Sliders size={14} />
            </button>

            <button type="button" className="dd-btn dd-btn--icon" onClick={handleResetChat} title="Clear the conversation" aria-label="Clear conversation">
              <RotateCcw size={14} />
            </button>

            {status?.is_owner && (
              <button type="button" className="dd-btn dd-btn--danger" onClick={onStopShare} title="Stop this share">
                <Power size={14} />
                Stop
              </button>
            )}
          </div>
        </header>
      </div>

      {/* ---- Body: manifest + exchange ---------------------------------- */}
      <div className="dd-body">
        {/* Manifest: rows with hairlines, not a card grid. */}
        <aside className="dd-manifest" aria-label="Files in this drop">
          <div className="dd-manifest__head">
            <h2 className="dd-title">Manifest</h2>
            <span className="dd-count">
              {files.length === 0
                ? 'empty'
                : `${files.length} ${files.length === 1 ? 'item' : 'items'} \u00b7 ${totalSize(files)}`}
            </span>
          </div>

          {files.length > 6 && (
            <div style={{ padding: '0 16px 8px' }}>
              <div className="dd-composer__box" style={{ padding: '6px 10px' }}>
                <Search size={13} color="#5f7370" />
                <input
                  className="dd-composer__input"
                  style={{ fontSize: '0.8125rem' }}
                  value={fileSearch}
                  placeholder="Filter"
                  aria-label="Filter files"
                  onChange={(e) => setFileSearch(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="dd-manifest__list">
            {filteredFiles.length === 0 && (
              <p className="dd-empty">
                {files.length === 0 ? (
                  <>
                    Nothing here yet.
                    <br />
                    Add a file to put it in the drop.
                  </>
                ) : (
                  'No file matches that filter.'
                )}
              </p>
            )}

            {filteredFiles.map((file) => (
              <div
                key={file.name}
                className="dd-row"
                data-selected={selectedFiles.includes(file.name) ? 'true' : 'false'}
                role="button"
                tabIndex={0}
                onClick={(e) => onSelectFile?.(file.name, e)}
                onDoubleClick={() => onPreviewFile(file)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onPreviewFile(file);
                }}
                aria-label={`${file.name}, ${file.size_human}`}
              >
                <span className="dd-row__name" title={file.name}>
                  {file.name}
                </span>
                <span className="dd-row__acts">
                  <button
                    type="button"
                    className="dd-btn dd-btn--ghost dd-btn--icon"
                    title="Preview"
                    aria-label={`Preview ${file.name}`}
                    onClick={(e) => { e.stopPropagation(); onPreviewFile(file); }}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    type="button"
                    className="dd-btn dd-btn--ghost dd-btn--icon"
                    title="Edit"
                    aria-label={`Edit ${file.name}`}
                    onClick={(e) => { e.stopPropagation(); onEditFile(file); }}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    type="button"
                    className="dd-btn dd-btn--ghost dd-btn--icon"
                    title="Download"
                    aria-label={`Download ${file.name}`}
                    onClick={(e) => { e.stopPropagation(); onDownloadFile(file); }}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    type="button"
                    className="dd-btn dd-btn--ghost dd-btn--icon"
                    title="Delete"
                    aria-label={`Delete ${file.name}`}
                    onClick={(e) => { e.stopPropagation(); onDeleteFile(file.name); }}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
                <span className="dd-row__meta">{file.size_human}</span>
              </div>
            ))}
          </div>

          <div className="dd-manifest__foot">
            <div
              className="dd-drop"
              role="button"
              tabIndex={0}
              onClick={onUploadClick}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onUploadClick(); }}
            >
              <Upload size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Add files to the drop
            </div>
          </div>
        </aside>

        {/* Exchange: transcript with no bubbles. */}
        <section className="dd-exchange" aria-label="Smopi conversation">
          <div className="dd-exchange__head">
            <h2 className="dd-title">{viewMode === 'chat' ? 'Smopi' : 'Gallery'}</h2>
            {isProcessing && (
              <span className="dd-count" aria-live="polite">
                <ThinkingOrb state={orbState} size={20} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
              </span>
            )}
          </div>

          {viewMode === 'files' ? (
            <div className="dd-exchange__log">{renderFilesGallery}</div>
          ) : (
            <div className="dd-exchange__log">
              {hasOnlyWelcome && (
                <div style={{ padding: '8px 0 20px' }}>
                  <FolderFloat
                    label="Quick prompts"
                    sublabel="Hover or drag an item"
                    items={[
                      { label: 'Create notes.md summary', value: 'Create notes.md with project summary' },
                      { label: 'Find duplicate files', value: 'Find duplicate or redundant files in workspace' },
                      { label: 'Organise & clean filenames', value: 'Organize and rename files cleanly' },
                      { label: 'Generate index.md contents', value: 'Generate an index.md table of contents for all files in this workspace.' },
                      { label: 'Audit file sizes', value: 'List all file sizes and types with analysis' }
                    ]}
                    onSelect={(val) => handleSendMessage(val)}
                    folderColor="#1c282d"
                    labelColor="#93a7a4"
                  />
                </div>
              )}

              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <article key={msg.id} className="dd-turn" data-role={msg.role}>
                    <header className="dd-turn__who">
                      <span className="dd-turn__name">{isUser ? 'You' : 'Smopi'}</span>
                      <span className="dd-turn__time">{msg.timestamp}</span>
                    </header>

                    <div className="dd-turn__body">
                      {isUser ? <p>{msg.text}</p> : <Markdown>{msg.text}</Markdown>}
                    </div>

                    {msg.actions && msg.actions.length > 0 && (
                      <div className="dd-ledger">
                        {msg.actions.map((act: SmopiAction, i: number) => (
                          <span className="dd-ledger__item" key={`${act.file}-${i}`}>
                            <span className="dd-ledger__verb" data-kind={act.type}>
                              {ACTION_VERB[act.type] ?? act.type}
                            </span>
                            <span>{act.file}</span>
                            {act.details && <span style={{ opacity: 0.7 }}>({act.details})</span>}
                          </span>
                        ))}
                      </div>
                    )}

                    {!isUser && msg.id !== 'welcome' && (
                      <div className="dd-ledger" style={{ borderTop: 0, alignItems: 'center', justifyContent: 'space-between' }}>
                        <PeekRating
                          size={16}
                          count={5}
                          value={ratings[msg.id] || 0}
                          onChange={(val) => setRatings((prev) => ({ ...prev, [msg.id]: val }))}
                          activeColor="#c2603c"
                          idleColor="#2a3a40"
                          labels={['Poor', 'Fair', 'Helpful', 'Great', 'Exceptional']}
                        />
                        <button
                          type="button"
                          className="dd-btn dd-btn--ghost"
                          onClick={() => handleCopyMessage(msg.id, msg.text)}
                          title="Copy response"
                        >
                          {copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                          {copiedId === msg.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}

              {isProcessing && (
                <div className="dd-turn" data-role="model">
                  <ThoughtLine
                    label={`Smopi is ${orbState}\u2026`}
                    glyph="orb"
                    orbState={orbState}
                    steps={[
                      'Scanning the drop and permissions',
                      'Tuning context for the model',
                      'Executing file operations'
                    ]}
                    working={true}
                    showTimer={true}
                    fontSize={14}
                    color="#93a7a4"
                  />
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Composer */}
          <div className="dd-composer">
            {usePromptBar ? (
              <PromptBar
                placeholder="Ask Smopi to summarise, inspect or organise files\u2026 (/ for commands)"
                busy={isProcessing}
                onSend={(text) => handleSendMessage(text)}
                onStop={() => setIsProcessing(false)}
                onAttach={() => {
                  onUploadClick();
                  return undefined;
                }}
                background="#0a1013"
                color="#e8edec"
                menuBackground="#131c20"
                sparkColor="#c2603c"
                radius={3}
                commands={[
                  { key: 'summarize', name: 'summarize', description: 'Summarise everything in the drop' },
                  { key: 'organize', name: 'organize', description: 'Organise and standardise filenames' },
                  { key: 'index', name: 'index', description: 'Generate index.md table of contents' },
                  { key: 'duplicates', name: 'duplicates', description: 'Find duplicate or redundant files' },
                  { key: 'sizes', name: 'sizes', description: 'List file sizes and types with analysis' }
                ]}
                models={[
                  { key: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tag: 'Fast' },
                  { key: 'smopi-agent', name: 'Smopi Agent', tag: 'Tool-use' },
                  { key: 'smopi-pro', name: 'Smopi Pro', tag: 'Reasoning' }
                ]}
                sources={[
                  { key: 'workspace', name: `Drop (${files.length} files)`, description: 'Files in this share' }
                ]}
              />
            ) : (
              <div className="dd-composer__box">
                <textarea
                  ref={textareaRef}
                  className="dd-composer__input"
                  rows={1}
                  placeholder="Ask Smopi to summarise, inspect or organise files\u2026"
                  aria-label="Message Smopi"
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <SlingButton
                  onSend={() => handleSendMessage()}
                  size={32}
                  padColor="#c2603c"
                  iconColor="#0e1518"
                  disabled={!inputPrompt.trim() || isProcessing}
                  ariaLabel="Send message"
                />
              </div>
            )}

            <div className="dd-composer__hint">
              <span>
                <kbd>Enter</kbd> to send \u00b7 <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
              </span>
              <SquishSwitch
                checked={usePromptBar}
                onChange={setUsePromptBar}
                label="Command composer"
                width={40}
                height={20}
                trackColor="#1c282d"
                trackOnColor="#c2603c"
              />
            </div>
          </div>
        </section>
      </div>

      {/* ---- Orb Studio ------------------------------------------------- */}
      {showOrbStudio && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Orb Studio"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            backgroundColor: 'rgba(10, 16, 19, 0.82)',
            display: 'grid',
            placeItems: 'center',
            padding: '20px'
          }}
          onClick={() => setShowOrbStudio(false)}
        >
          <div
            className="dd-root"
            style={{
              position: 'relative',
              display: 'block',
              inset: 'auto',
              backgroundColor: '#131c20',
              border: '1px solid #1c282d',
              borderRadius: '3px',
              padding: '24px',
              width: '100%',
              maxWidth: '640px',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <h3 className="dd-title" style={{ fontSize: '1.25rem' }}>Orb Studio</h3>
                <p className="dd-count" style={{ margin: '2px 0 0' }}>
                  Nine hand-tuned states for the thinking indicator
                </p>
              </div>
              <button type="button" className="dd-btn dd-btn--ghost" onClick={() => setShowOrbStudio(false)} aria-label="Close Orb Studio">
                Close
              </button>
            </div>

            {/* Dual-scale preview */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '16px',
                padding: '24px',
                backgroundColor: orbDark ? '#0a1013' : '#e8edec',
                color: orbDark ? '#e8edec' : '#0e1518',
                border: '1px solid #1c282d',
                borderRadius: '3px',
                marginBottom: '20px'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <ThinkingOrb state={orbState} size={64} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
                <span style={{ fontSize: '0.6875rem', opacity: 0.75 }}>Avatar scale, 64px</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ThinkingOrb state={orbState} size={20} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
                  <span style={{ fontSize: '0.8125rem' }}>Inline scale, 20px</span>
                </div>
                <span style={{ fontSize: '0.6875rem', opacity: 0.75 }}>State: {orbState}</span>
              </div>
            </div>

            {/* State grid */}
            <div style={{ marginBottom: '20px' }}>
              <label className="dd-label" style={{ display: 'block', marginBottom: '8px' }}>
                Active state
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {(['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping'] as OrbState[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    className="dd-btn"
                    style={{
                      justifyContent: 'flex-start',
                      borderColor: orbState === st ? '#c2603c' : '#1c282d',
                      color: orbState === st ? '#c2603c' : '#e8edec'
                    }}
                    onClick={() => setOrbState(st)}
                  >
                    <ThinkingOrb state={st} size={20} theme={orbDark ? 'dark' : 'light'} />
                    <span>{st}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', paddingTop: '16px', borderTop: '1px solid #1c282d' }}>
              <SquishSwitch
                checked={orbDark}
                onChange={setOrbDark}
                label="Dark tuning"
                width={48}
                height={24}
                trackColor="#1c282d"
                trackOnColor="#c2603c"
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label htmlFor="orb-speed" className="dd-label">Speed {orbSpeed}x</label>
                <input
                  id="orb-speed"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={orbSpeed}
                  onChange={(e) => setOrbSpeed(parseFloat(e.target.value))}
                  style={{ width: '110px', cursor: 'pointer', accentColor: '#c2603c' }}
                />
              </div>
              <SlingButton
                onSend={() => setShowOrbStudio(false)}
                size={32}
                padColor="#c2603c"
                iconColor="#0e1518"
                ariaLabel="Close Orb Studio"
              />
            </div>

            <div style={{ borderTop: '1px solid #1c282d', paddingTop: '16px', marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span className="dd-label">Dodge field</span>
                <span className="dd-count">Cursor physics</span>
              </div>
              <Suspense fallback={<div style={{ height: 100 }} aria-busy="true" />}>
                <DodgeField
                  fieldHeight={100}
                  patience={3}
                  taunts={['Catch the orb', 'Too fast', 'Almost', 'Caught']}
                  onCatch={() => setOrbState('composing')}
                  inkColor="#93a7a4"
                  contrastColor="#c2603c"
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
