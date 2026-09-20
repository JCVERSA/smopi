import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  FileText,
  FileCode,
  FileImage,
  FileArchive,
  File as FileIcon,
  Trash2,
  Download,
  Edit3,
  RotateCcw,
  Sparkles,
  Check,
  Copy,
  ExternalLink,
  Search,
  LayoutGrid,
  MessageSquare,
  Paperclip,
  Mic,
  ChevronRight,
  FolderSync,
  CheckCircle2,
  Wand2,
  Loader2,
  Share2,
  Power
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
  renderFilesGallery
}) => {
  const [messages, setMessages] = useState<SmopiMessage[]>(() => [
    {
      id: 'welcome',
      role: 'model',
      text: `👋 **Hi! I'm Smopi**, your AI file assistant for this workspace.\n\nI can **create**, **organize**, **modify**, **rename**, **summarize**, and **delete** files for you.\n\nWhat would you like me to do with your files today?`,
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
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // Thinking Orb & Interaction components state
  const [orbState, setOrbState] = useState<OrbState>('searching');
  const [orbDark, setOrbDark] = useState<boolean>(true);
  const [orbSpeed, setOrbSpeed] = useState<number>(1);
  const [usePromptBar, setUsePromptBar] = useState<boolean>(true);
  const [showOrbStudio, setShowOrbStudio] = useState<boolean>(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat container to bottom when messages update
  useEffect(() => {
    if (viewMode === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isProcessing, viewMode]);

  // Format remaining expiration time
  const formatRemaining = (seconds: number | null | undefined): string => {
    if (seconds === null || seconds === undefined) return 'Unlimited';
    if (seconds <= 0) return 'Expired';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

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
        text: data.text || 'Action completed successfully.',
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
          text: `⚠️ **Smopi encountered an error**: ${err.message || 'Failed to complete task'}. Please verify and try again.`,
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
        text: `🧹 **Chat reset.** Workspace currently has **${files.length} active files**.\n\nWhat would you like me to do next?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: 'Gemini 3.8 Flash'
      }
    ]);
  };

  const renderActionBadge = (act: SmopiAction, idx: number) => {
    const isCreated = act.type === 'created' || act.type === 'indexed';
    const isDeleted = act.type === 'deleted';
    const isRenamed = act.type === 'renamed';
    const isModified = act.type === 'modified';

    let color = 'rgba(75, 144, 255, 0.15)';
    let border = 'rgba(75, 144, 255, 0.3)';
    let textCol = '#4b90ff';
    let icon = <Wand2 className="w-3.5 h-3.5" />;

    if (isCreated) {
      color = 'rgba(52, 211, 153, 0.15)';
      border = 'rgba(52, 211, 153, 0.35)';
      textCol = '#34d399';
      icon = <CheckCircle2 className="w-3.5 h-3.5" />;
    } else if (isDeleted) {
      color = 'rgba(248, 113, 113, 0.15)';
      border = 'rgba(248, 113, 113, 0.35)';
      textCol = '#f87171';
      icon = <Trash2 className="w-3.5 h-3.5" />;
    } else if (isRenamed) {
      color = 'rgba(251, 191, 36, 0.15)';
      border = 'rgba(251, 191, 36, 0.35)';
      textCol = '#fbbf24';
      icon = <FolderSync className="w-3.5 h-3.5" />;
    } else if (isModified) {
      color = 'rgba(168, 85, 247, 0.15)';
      border = 'rgba(168, 85, 247, 0.35)';
      textCol = '#c084fc';
      icon = <FileText className="w-3.5 h-3.5" />;
    }

    return (
      <div
        key={idx}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '8px',
          backgroundColor: color,
          border: `1px solid ${border}`,
          color: textCol,
          fontSize: '12px',
          fontWeight: 600,
          marginTop: '6px',
          marginRight: '6px'
        }}
      >
        {icon}
        <span>{act.type.toUpperCase()}: {act.file}</span>
        {act.details && <span style={{ opacity: 0.8, fontWeight: 400 }}>({act.details})</span>}
      </div>
    );
  };

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(fileSearch.toLowerCase())
  );

  const getSidebarFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['md', 'txt', 'rtf', 'log'].includes(ext)) {
      return (
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-5-5zM13 3.5L18.5 9H13V3.5z"/>
        </svg>
      );
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
      return <FileImage className="w-4 h-4 text-emerald-400" />;
    }
    if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) {
      return <FileArchive className="w-4 h-4 text-amber-400" />;
    }
    if (['js', 'ts', 'jsx', 'tsx', 'json', 'py', 'html', 'css'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-sky-400" />;
    }
    return <FileIcon className="w-4 h-4 text-slate-400" />;
  };

  const hasOnlyWelcome = messages.length === 1 && messages[0].id === 'welcome';

  return (
    <div className="v5-layout">
      {/* Sidebar - Google style workspace tree */}
      <aside className="v5-sidebar">
        <div className="v5-sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SmopiAvatar size={28} status={avatarStatus} />
            <span style={{ fontWeight: 600, fontSize: '1.1rem', letterSpacing: '-0.5px' }}>Smopi AI</span>
          </div>
          <button
            onClick={() => onFilesChanged()}
            title="Refresh active files"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--v5-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'grid',
              placeItems: 'center'
            }}
          >
            <RotateCcw className="w-4 h-4 hover:text-white transition-colors" />
          </button>
        </div>

        {/* New Workspace / Upload Action Button */}
        <button
          className="v5-new-chat-btn"
          onClick={onUploadClick}
          title="Upload or add files to this workspace"
        >
          <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
          <span>New Workspace</span>
        </button>

        {/* Active Files Section */}
        <div className="v5-workspace-section">
          <div className="v5-section-label">
            <span>Active Files ({files.length})</span>
            <button
              onClick={() => onEditFile()}
              className="text-xs hover:text-white transition-colors flex items-center gap-1 font-mono normal-case"
              style={{ background: 'transparent', border: 'none', color: 'var(--v5-accent)', cursor: 'pointer' }}
              title="Create new file"
            >
              + File
            </button>
          </div>

          {files.length > 5 && (
            <div style={{ padding: '0 8px 10px' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Filter files..."
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px 6px 28px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--v5-border)',
                    color: 'var(--v5-ink)',
                    fontSize: '0.8rem',
                    outline: 'none'
                  }}
                />
                <Search
                  className="w-3.5 h-3.5 text-slate-500"
                  style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)' }}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {filteredFiles.map((file) => {
              const isActive = selectedFileName === file.name;
              return (
                <div
                  key={file.name}
                  className={`v5-file-item group ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedFileName(file.name);
                    onPreviewFile(file);
                  }}
                  title={`${file.name} (${file.size_human})`}
                >
                  <span style={{ color: isActive ? 'var(--v5-accent)' : 'inherit', display: 'flex', alignItems: 'center' }}>
                    {getSidebarFileIcon(file.name)}
                  </span>
                  <span className="truncate flex-1" style={{ fontSize: '0.85rem' }}>
                    {file.name}
                  </span>

                  {/* Quick Action Icons on Hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadFile(file);
                      }}
                      title="Download file"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--v5-muted)',
                        padding: '2px',
                        cursor: 'pointer'
                      }}
                    >
                      <Download className="w-3.5 h-3.5 hover:text-white" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFile(file.name);
                      }}
                      title="Delete file"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--v5-muted)',
                        padding: '2px',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 hover:text-red-400" />
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredFiles.length === 0 && (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--v5-muted)', fontSize: '0.8rem' }}>
                {fileSearch ? 'No files match search.' : 'No files in workspace yet.'}
                <button
                  onClick={onUploadClick}
                  style={{
                    display: 'block',
                    margin: '8px auto 0',
                    background: 'transparent',
                    border: '1px dashed var(--v5-border)',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    color: 'var(--v5-accent)',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  Drop or browse files
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stats Bar / Session Info */}
        <div className="v5-stats-bar">
          <div className="v5-label-mono">Session Info</div>
          <div>Expires in {formatRemaining(status?.remaining)}</div>
          <div>{status?.downloads_total || 0} downloads · {status?.bytes_total_human || '0 B'} transferred</div>
          
          {status?.share_password && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--v5-border)',
                marginTop: '4px'
              }}
            >
              <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: '0.72rem', letterSpacing: '0.05em' }}>
                PWD: <strong>{status.share_password}</strong>
              </span>
              <button
                onClick={handleCopyPassword}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedPassword ? '#34d399' : 'var(--v5-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.7rem'
                }}
              >
                {copiedPassword ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPassword ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <button
              onClick={() => setViewMode((prev) => (prev === 'chat' ? 'files' : 'chat'))}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--v5-accent)',
                cursor: 'pointer',
                fontSize: '0.72rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {viewMode === 'chat' ? <LayoutGrid className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
              <span>{viewMode === 'chat' ? 'Files Gallery' : 'AI Chat View'}</span>
            </button>
            <button
              onClick={onStopShare}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f87171',
                cursor: 'pointer',
                fontSize: '0.72rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Stop temporary share session"
            >
              <Power className="w-3 h-3" />
              <span>Stop</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat / Workspace Interface */}
      <main className="v5-main">
        {/* Dynamic Container: AI Chat or Files Workspace Gallery */}
        {viewMode === 'files' ? (
          <div className="v5-chat-container" style={{ padding: '24px 32px' }}>
            {renderFilesGallery}
          </div>
        ) : (
          <div className="v5-chat-container">
            {hasOnlyWelcome ? (
              /* Welcome View matching Variation 5 */
              <div className="welcome-view">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', marginBottom: '20px' }}>
                  <div
                    style={{ cursor: 'pointer', transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)' }}
                    title="Click or hover to interact with Smopi"
                    className="hover:scale-105 active:scale-95"
                  >
                    <SmopiAvatar size={84} status={avatarStatus} caption="Smopi AI Assistant" />
                  </div>

                  <div
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      borderRadius: '16px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--v5-border)',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => setShowOrbStudio(true)}
                    title="Click to open Thinking Orb Studio"
                    className="hover:border-sky-400"
                  >
                    <ThinkingOrb state={orbState} size={64} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
                    <span style={{ fontSize: '0.68rem', color: '#38bdf8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Orb: {orbState}
                    </span>
                  </div>
                </div>

                <div className="v5-hero-text">Hello, Workspace.</div>
                <div className="v5-sub-hero">How can I help you manage files today?</div>

                {/* Floating Interactive Suggestions Folder */}
                <div style={{ margin: '14px 0 24px', display: 'flex', justifyContent: 'center' }}>
                  <FolderFloat
                    label="Quick Workspace Prompts"
                    sublabel="Hover or drag items"
                    items={[
                      { label: 'Create notes.md summary', value: 'Create notes.md with project summary' },
                      { label: 'Find duplicate files', value: 'Find duplicate or redundant files in workspace' },
                      { label: 'Organize & clean filenames', value: 'Organize and rename files cleanly' },
                      { label: 'Generate index.md table of contents', value: 'Generate an index.md table of contents for all files in this workspace.' },
                      { label: 'Audit workspace sizes', value: 'List all file sizes and types with analysis' }
                    ]}
                    onSelect={(val) => handleSendMessage(val)}
                    folderColor="#27272a"
                  />
                </div>

                <div className="v5-card-grid">
                  <div
                    className="v5-prompt-card"
                    onClick={() => handleSendMessage('Create notes.md with project summary')}
                  >
                    <span>Create notes.md with project summary</span>
                    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  </div>

                  <div
                    className="v5-prompt-card"
                    onClick={() => handleSendMessage('Find duplicate or redundant files in workspace')}
                  >
                    <span>Find duplicate files in workspace</span>
                    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>

                  <div
                    className="v5-prompt-card"
                    onClick={() => handleSendMessage('Organize and rename files cleanly')}
                  >
                    <span>Organize and rename files cleanly</span>
                    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                  </div>

                  <div
                    className="v5-prompt-card"
                    onClick={() => handleSendMessage('List all file sizes and types with analysis')}
                  >
                    <span>List all file sizes and types</span>
                    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z" />
                    </svg>
                  </div>
                </div>
              </div>
            ) : (
              /* Message Stream */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        gap: '16px',
                        alignItems: 'flex-start',
                        maxWidth: '100%',
                        flexDirection: isUser ? 'row-reverse' : 'row'
                      }}
                    >
                      {/* Avatar */}
                      {isUser ? (
                        <div
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid var(--v5-border)',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            flexShrink: 0
                          }}
                        >
                          You
                        </div>
                      ) : (
                        <div style={{ flexShrink: 0, marginTop: '2px' }}>
                          <SmopiAvatar
                            size={28}
                            status={msg.id === messages[messages.length - 1]?.id && isProcessing ? 'thinking' : 'idle'}
                          />
                        </div>
                      )}

                      {/* Content Bubble */}
                      <div
                        style={{
                          maxWidth: isUser ? '80%' : '88%',
                          backgroundColor: isUser ? '#1e293b' : 'var(--v5-panel)',
                          border: `1px solid ${isUser ? 'rgba(75, 144, 255, 0.3)' : 'var(--v5-border)'}`,
                          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          padding: '14px 18px',
                          fontSize: '0.98rem',
                          lineHeight: '1.6',
                          color: 'var(--v5-ink)',
                          position: 'relative',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.75rem', color: 'var(--v5-muted)' }}>
                          <span style={{ fontWeight: 600, color: isUser ? '#94a3b8' : 'var(--v5-accent)' }}>
                            {isUser ? 'You' : 'Smopi AI'}
                          </span>
                          <span>{msg.timestamp}</span>
                        </div>

                        {/* Markdown Content */}
                        <div className="prose prose-invert max-w-none text-sm leading-relaxed" style={{ color: 'var(--v5-ink)' }}>
                          <Markdown>{msg.text}</Markdown>
                        </div>

                        {/* Actions Badge List */}
                        {msg.actions && msg.actions.length > 0 && (
                          <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--v5-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                              Actions Executed:
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                              {msg.actions.map((act: SmopiAction, i: number) => renderActionBadge(act, i))}
                            </div>
                          </div>
                        )}

                        {/* Message Action & Feedback Bar */}
                        {!isUser && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '0.72rem', color: 'var(--v5-muted)' }}>Rating:</span>
                              <PeekRating
                                size={18}
                                count={5}
                                value={ratings[msg.id] || 0}
                                onChange={(val) => setRatings((prev) => ({ ...prev, [msg.id]: val }))}
                                activeColor="#38bdf8"
                                idleColor="#475569"
                                labels={['Poor', 'Fair', 'Helpful', 'Great', 'Exceptional']}
                              />
                            </div>

                            <button
                              onClick={() => handleCopyMessage(msg.id, msg.text)}
                              title="Copy response"
                              style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--v5-border)',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                color: copiedId === msg.id ? '#34d399' : 'var(--v5-muted)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.7rem'
                              }}
                            >
                              {copiedId === msg.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Processing Indicator with Hand-Tuned Animated ThinkingOrb */}
                {isProcessing && (
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', margin: '12px 0' }}>
                    <div style={{ flexShrink: 0, marginTop: '2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                      <ThinkingOrb state={orbState} size={64} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
                      <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {orbState}
                      </span>
                    </div>
                    <div
                      style={{
                        backgroundColor: 'var(--v5-panel)',
                        border: '1px solid var(--v5-border)',
                        borderRadius: '16px',
                        padding: '16px 20px',
                        flex: 1,
                        minWidth: 0,
                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)'
                      }}
                    >
                      <ThoughtLine
                        label={`Smopi is ${orbState}…`}
                        glyph="orb"
                        orbState={orbState}
                        steps={[
                          'Scanning workspace directory & permissions',
                          'Tuning context with Gemini 3.8 Flash model',
                          'Executing structured workspace modifications'
                        ]}
                        working={true}
                        showTimer={true}
                        fontSize={14}
                        color="#e2e8f0"
                      />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        )}

        {/* Bottom Input Area matching Variation 5 with modern PromptBar support */}
        <div className="v5-input-wrapper">
          {usePromptBar ? (
            <div style={{ width: '100%', maxWidth: '820px', margin: '0 auto' }}>
              <PromptBar
                placeholder="Ask Smopi to summarize, inspect, or organize files... (/ for commands)"
                busy={isProcessing}
                onSend={(text) => handleSendMessage(text)}
                onStop={() => setIsProcessing(false)}
                onAttach={() => {
                  onUploadClick();
                  return undefined;
                }}
                background="#18181b"
                color="#f5f5f5"
                menuBackground="#27272a"
                commands={[
                  { key: 'summarize', name: 'summarize', description: 'Summarize all files in workspace' },
                  { key: 'organize', name: 'organize', description: 'Organize and standardize filenames' },
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
                  { key: 'workspace', name: `Workspace (${files.length} files)`, description: 'Active shared session files' }
                ]}
              />
            </div>
          ) : (
            <div className="v5-input-box">
              <textarea
                ref={textareaRef}
                rows={2}
                placeholder="Ask Smopi to summarize, inspect, or organize files..."
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className="v5-input-tools">
                <div className="v5-tools-left">
                  {/* Upload Attachment Trigger */}
                  <button
                    type="button"
                    onClick={onUploadClick}
                    title="Upload attachment / files"
                  >
                    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.31 2.69 6 6 6s6-2.69 6-6V6h-1.5z"/>
                    </svg>
                  </button>

                  {/* Voice / Mic / Action Trigger */}
                  <button
                    type="button"
                    onClick={() => handleSendMessage('Review all files and tell me if there are formatting or structure issues.')}
                    title="Smopi quick diagnosis"
                  >
                    <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                  </button>
                </div>

                {/* Send Button */}
                <button
                  type="button"
                  className="v5-send-btn"
                  disabled={!inputPrompt.trim() || isProcessing}
                  onClick={() => handleSendMessage()}
                  title="Send instruction to Smopi"
                >
                  <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          )}

          <p className="v5-disclaimer">
            Smopi can help you manage workspace files but may display inaccurate info.{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setViewMode((prev) => (prev === 'files' ? 'chat' : 'files'));
              }}
              style={{ color: 'var(--v5-ink)', textDecoration: 'underline' }}
            >
              Workspace: {files.length} files available ({viewMode === 'files' ? 'switch to Chat' : 'view Gallery'})
            </a>
          </p>
        </div>
      </main>

      {/* Thinking Orb Studio & Interactive Controls Modal */}
      {showOrbStudio && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'grid',
            placeItems: 'center',
            padding: '20px'
          }}
          onClick={() => setShowOrbStudio(false)}
        >
          <div
            style={{
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              borderRadius: '24px',
              padding: '28px',
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              overflowY: 'auto',
              color: '#f5f5f5',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <ThinkingOrb state={orbState} size={20} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Thinking Orb Studio</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#a1a1aa' }}>
                    Powered by thinking-orbs from Libraries.dev · 9 Hand-Tuned Animated States
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOrbStudio(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  padding: '4px 8px'
                }}
              >
                ✕
              </button>
            </div>

            {/* Live Dual-Scale Preview Box */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
                padding: '24px',
                borderRadius: '16px',
                backgroundColor: orbDark ? '#09090b' : '#f4f4f5',
                color: orbDark ? '#f5f5f5' : '#18181b',
                border: '1px solid #27272a',
                marginBottom: '20px'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <ThinkingOrb state={orbState} size={64} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
                <span style={{ fontSize: '0.75rem', fontWeight: 600, opacity: 0.8 }}>
                  Chat-avatar scale (64px)
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '999px', background: orbDark ? '#27272a' : '#e4e4e7' }}>
                  <ThinkingOrb state={orbState} size={20} theme={orbDark ? 'dark' : 'light'} speed={orbSpeed} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>
                    Inline scale (20px) · State: {orbState}
                  </span>
                </div>
                <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                  Separately tuned physics clock
                </span>
              </div>
            </div>

            {/* State Grid: 9 Hand-Tuned States */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px', color: '#e4e4e7' }}>
                Select Active State (9 Tuned States)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {(['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping'] as OrbState[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setOrbState(st)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '10px',
                      border: `1px solid ${orbState === st ? '#38bdf8' : '#27272a'}`,
                      backgroundColor: orbState === st ? 'rgba(56, 189, 248, 0.15)' : '#27272a',
                      color: orbState === st ? '#38bdf8' : '#e4e4e7',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <ThinkingOrb state={st} size={20} theme={orbDark ? 'dark' : 'light'} />
                    <span>{st}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Controls: Speed & SquishSwitch for Dark Mode */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderRadius: '12px', backgroundColor: '#27272a', marginBottom: '20px', flexWrap: 'wrap', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <SquishSwitch
                  checked={orbDark}
                  onChange={(val) => setOrbDark(val)}
                  label="Dark Tuning"
                  width={56}
                  height={28}
                  trackColor="#3f3f46"
                  trackOnColor="#38bdf8"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>Speed: {orbSpeed}x</span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={orbSpeed}
                  onChange={(e) => setOrbSpeed(parseFloat(e.target.value))}
                  style={{ width: '100px', cursor: 'pointer' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>Close Studio:</span>
                <SlingButton
                  onSend={() => setShowOrbStudio(false)}
                  size={36}
                  padColor="#0284c7"
                  iconColor="#ffffff"
                />
              </div>
            </div>

            {/* Playful Interactive DodgeField */}
            <div style={{ borderTop: '1px solid #27272a', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Playful Spark (DodgeField)</span>
                <span style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>Cursor physics element</span>
              </div>
              <Suspense fallback={<div style={{ height: 100 }} aria-busy="true" />}>
                <DodgeField
                  fieldHeight={100}
                  patience={3}
                  taunts={['Catch the Orb', 'Too fast', 'Almost!', 'Captured!']}
                  onCatch={() => setOrbState('composing')}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
