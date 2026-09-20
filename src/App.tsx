import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  FileImage,
  FileArchive,
  File,
  Grid,
  List,
  UploadCloud,
  RefreshCw,
  Search,
  Sparkles,
  Check,
  SlidersHorizontal,
  FilePlus,
  Folder,
  Download
} from 'lucide-react';

import type {
  SharedFile,
  ShareStatus,
  UploadItem,
  PreviewData,
  DownloadProgressState,
  PromptModel
} from './types';

import { LoginView } from './components/LoginView';
import { StoppedView } from './components/StoppedView';
import { BulkActionsBar } from './components/BulkActionsBar';
import { UploadDropzone } from './components/UploadDropzone';
import { FileItem } from './components/FileItem';
import { FilePreviewModal } from './components/FilePreviewModal';
import { DownloadProgressModal } from './components/DownloadProgressModal';
import { SmopiDrawer } from './components/SmopiDrawer';
import { SmopiWorkspaceView } from './components/SmopiWorkspaceView';
import { FileEditorModal } from './components/FileEditorModal';
import BranchedMenu, { type BranchedMenuItem } from './components/BranchedMenu';
import SwipeToast from './components/SwipeToast';
import { SmopiAvatar } from './components/smopi';
import { AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [isSubmittingLogin, setIsSubmittingLogin] = useState<boolean>(false);

  // Authentication token for cross-environment / iframe cookie isolation support
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('fs_token');
    } catch {
      return null;
    }
  });

  // Dashboard states
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [showQr, setShowQr] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isBundling, setIsBundling] = useState<boolean>(false);
  const [showStopConfirm, setShowStopConfirm] = useState<boolean>(false);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string>('Copy link');

  // Layout & Sorting states
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'physics'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'mtime'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Swipe Toast Notification State
  const [toast, setToast] = useState<{
    id: number;
    title: string;
    description?: string;
    icon?: React.ReactNode;
    actionLabel?: string;
    onAction?: () => void;
    duration?: number;
  } | null>(null);

  const showToast = (
    title: string,
    description = '',
    icon?: React.ReactNode,
    actionLabel = '',
    onAction?: () => void,
    duration = 4000
  ) => {
    setToast({
      id: Date.now(),
      title,
      description,
      icon,
      actionLabel,
      onAction,
      duration
    });
  };

  // AI PromptBar, ThoughtLine & CallChip Execution State
  const [promptBusy, setPromptBusy] = useState<boolean>(false);
  const [showCommandHub, setShowCommandHub] = useState<boolean>(false);
  const [activeThought, setActiveThought] = useState<{
    label: string;
    steps?: string[];
    working?: boolean;
    doneLabel?: string;
    elapsed?: number;
  } | null>(null);
  const [activeToolChip, setActiveToolChip] = useState<{
    name: string;
    argument: string;
    status: 'idle' | 'running' | 'done' | 'error';
    icon?: string;
  } | null>(null);

  // Drag and drop / upload states
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragOverDashboard, setIsDragOverDashboard] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File Preview States
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  // Smopi AI Agent & File Editor States
  const [isSmopiOpen, setIsSmopiOpen] = useState<boolean>(false);
  const [editorState, setEditorState] = useState<{
    isOpen: boolean;
    fileName?: string;
    content?: string;
    isCreatingNew?: boolean;
  }>({ isOpen: false });

  // Custom utilities
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [, setAccentColor] = useState<string>('#38bdf8');

  // Bulk Selection States
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState<boolean>(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState<boolean>(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Download tracking state
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState>({
    visible: false,
    name: '',
    percent: 0,
    statusText: 'Starting download…',
    metaText: 'Preparing transfer',
    loaded: 0,
    total: 0
  });

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const pollIntervalRef = useRef<any>(null);

  const shareUrl = status?.stopped ? '' : window.location.origin + '/';

  // Helper to build headers with Authorization bearer token
  const getAuthHeaders = (extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extra };
    const token = authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('fs_token') : null);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  // Helper to build download URL with token query fallback for sandbox iframes
  const getDownloadUrl = (name: string) => {
    const token = authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('fs_token') : null);
    const base = `/download/${encodeURIComponent(name)}`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  };

  // Check auth and load initial status on mount
  useEffect(() => {
    checkAuth();
    pollIntervalRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Generate QR code on canvas whenever showQr toggles
  useEffect(() => {
    if (showQr && shareUrl) {
      setTimeout(() => {
        const canvas = document.getElementById('qrCanvas');
        if (canvas) {
          QRCode.toCanvas(canvas, shareUrl, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 220,
            color: { dark: '#111317', light: '#ffffff' }
          }, (err) => {
            if (err) console.error('QR Code Generation Error:', err);
          });
        }
      }, 50);
    }
  }, [showQr, shareUrl]);

  // Live Auto-Refresh Effect
  useEffect(() => {
    if (!autoRefresh || !isAuthenticated || status?.stopped) return;
    const interval = setInterval(() => {
      loadFiles(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, isAuthenticated, status?.stopped]);

  // Reduce Motion Effect
  useEffect(() => {
    if (reduceMotion) {
      document.documentElement.classList.add('reduce-motion-active');
    } else {
      document.documentElement.classList.remove('reduce-motion-active');
    }
  }, [reduceMotion]);

  // Theme Accent Switcher
  const handleColorChange = (color: string) => {
    setAccentColor(color);
    document.documentElement.style.setProperty('--accent', color);
  };

  // Keyboard Shortcuts: 'S' for search, 'R' for refresh, 'Esc' to close dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isInputActive = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.isContentEditable
      );

      if (e.key === 'Escape') {
        if (editorState.isOpen) {
          setEditorState((prev) => ({ ...prev, isOpen: false }));
          return;
        }
        if (isSmopiOpen) {
          setIsSmopiOpen(false);
          return;
        }
        if (previewFile) {
          setPreviewFile(null);
          return;
        }
        if (showBulkDeleteConfirm) {
          setShowBulkDeleteConfirm(false);
          return;
        }
        if (showStopConfirm) {
          setShowStopConfirm(false);
          return;
        }
        if (showQr) {
          setShowQr(false);
          return;
        }
        if (selectedFiles.length > 0) {
          setSelectedFiles([]);
          return;
        }
      }

      if (isInputActive) return;

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        loadFiles(true);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setIsSmopiOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewFile, showBulkDeleteConfirm, showStopConfirm, showQr, selectedFiles, editorState.isOpen, isSmopiOpen]);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/status', {
        cache: 'no-store',
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        if (data.authorized) {
          setIsAuthenticated(true);
          loadFiles();
        } else {
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/status', {
        cache: 'no-store',
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        if (!data.authorized && !data.stopped) {
          setIsAuthenticated(false);
        } else if (data.stopped) {
          setIsAuthenticated(true);
        }
      }
    } catch (_) {}
  };

  const loadFiles = async (manual = false, explicitToken?: string) => {
    if (manual) {
      setIsRefreshing(true);
    }
    try {
      const headers = getAuthHeaders();
      if (explicitToken) {
        headers['Authorization'] = `Bearer ${explicitToken}`;
      }

      const response = await fetch('/api/files', { cache: 'no-store', headers });
      if (response.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (response.ok) {
        const data = await response.json();
        setFiles(Array.isArray(data.files) ? data.files : []);
        fetchStatus();
      }
    } catch (err) {
      console.error('Error fetching files:', err);
    } finally {
      if (manual) {
        setTimeout(() => {
          setIsRefreshing(false);
        }, 600);
      }
    }
  };

  const getFileIcon = (file: SharedFile) => {
    // Backend categories are plural: 'archives' | 'images' | 'documents' | 'other'.
    if (file.category === 'archives') {
      return <FileArchive className="w-5 h-5 text-amber-400" style={{ minWidth: '20px' }} />;
    }
    if (file.category === 'images') {
      return <FileImage className="w-5 h-5 text-emerald-400" style={{ minWidth: '20px' }} />;
    }
    if (file.category === 'documents') {
      return <FileText className="w-5 h-5 text-indigo-400" style={{ minWidth: '20px' }} />;
    }
    return <File className="w-5 h-5 text-slate-400" style={{ minWidth: '20px' }} />;
  };

  // Secure preview file fetcher
  const handlePreviewClick = async (file: SharedFile) => {
    setPreviewFile(file);
    setIsPreviewLoading(true);
    setPreviewData(null);
    try {
      const response = await fetch(`/api/preview/${encodeURIComponent(file.name)}`, {
        cache: 'no-store',
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setPreviewData(data);
      } else {
        setPreviewData({ type: 'error', message: 'Unable to fetch file preview from server.' });
      }
    } catch (_) {
      setPreviewData({ type: 'error', message: 'Unable to connect to the server for preview.' });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Open file editor (direct edit or new file)
  const handleOpenEditor = async (file?: SharedFile, initialContent?: string) => {
    if (!file) {
      setEditorState({ isOpen: true, isCreatingNew: true, fileName: '', content: '' });
      return;
    }

    if (initialContent !== undefined) {
      setEditorState({ isOpen: true, isCreatingNew: false, fileName: file.name, content: initialContent });
      return;
    }

    try {
      const res = await fetch(`/api/files/${encodeURIComponent(file.name)}/content`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setEditorState({ isOpen: true, isCreatingNew: false, fileName: file.name, content: data.content || '' });
      } else {
        setEditorState({ isOpen: true, isCreatingNew: false, fileName: file.name, content: '' });
      }
    } catch (_) {
      setEditorState({ isOpen: true, isCreatingNew: false, fileName: file.name, content: '' });
    }
  };

  const handleAskSmopi = (_prompt?: string) => {
    setIsSmopiOpen(true);
  };

  const handlePromptSend = async (
    text: string,
    details?: { attachments?: string[]; model?: PromptModel; effort?: string }
  ) => {
    if (!text.trim() || promptBusy) return;
    setPromptBusy(true);

    const startTime = performance.now();
    const modelName = details?.model?.name || 'Gemini Flash';

    setActiveThought({
      label: `Analyzing request: "${text.slice(0, 36)}${text.length > 36 ? '…' : ''}"`,
      working: true,
      steps: [
        'Inspecting workspace file directory context…',
        `Querying ${modelName} (${details?.effort || 'Balanced'} reasoning effort)…`
      ]
    });

    setActiveToolChip({
      name: 'smopi_ai',
      argument: text.slice(0, 24) + (text.length > 24 ? '…' : ''),
      status: 'running',
      icon: 'terminal'
    });

    try {
      const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/smopi/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          history: []
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${res.status}`);
      }

      const data = await res.json();
      const elapsed = Math.round(performance.now() - startTime);

      setActiveThought({
        label: 'Smopi AI Task Complete',
        working: false,
        doneLabel: 'Analysis Finished',
        elapsed,
        steps: [
          'Workspace files analyzed',
          `Executed via ${modelName} in ${elapsed}ms`,
          'Shared workspace state refreshed'
        ]
      });

      setActiveToolChip({
        name: 'smopi_ai',
        argument: 'completed',
        status: 'done',
        icon: 'terminal'
      });

      showToast(
        'Smopi AI Response',
        data.text ? (data.text.slice(0, 80) + '…') : 'AI task executed successfully.',
        <SmopiAvatar size={20} status="success" />,
        'Open Smopi',
        () => setIsSmopiOpen(true)
      );

      if (data.actionsTaken && data.actionsTaken.length > 0) {
        loadFiles(true);
        fetchStatus();
      }

      setTimeout(() => {
        setActiveThought(null);
        setActiveToolChip(null);
      }, 7000);
    } catch (err: any) {
      setActiveThought({
        label: 'Error Encountered',
        working: false,
        doneLabel: 'Execution Failed',
        steps: [err.message || 'Operation failed']
      });

      setActiveToolChip({
        name: 'smopi_ai',
        argument: 'failed',
        status: 'error',
        icon: 'terminal'
      });

      showToast('AI Task Failed', err.message || 'Check server connection.', undefined);
    } finally {
      setPromptBusy(false);
    }
  };

  // Upload utility to stream files to server
  const uploadFile = async (file: globalThis.File) => {
    const id = Math.random().toString(36).substring(2, 9);
    setUploads(prev => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }]);
    
    const formData = new FormData();
    formData.append('file', file);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    const token = authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('fs_token') : null);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        setUploads(prev => prev.map(u => u.id === id ? { ...u, progress } : u));
      }
    };
    
    xhr.onload = () => {
      if (xhr.status === 200) {
        setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: 100, status: 'success' } : u));
        loadFiles();
        showToast('File Uploaded', `${file.name} successfully shared.`, <Check className="w-4 h-4 text-emerald-400" />);
        setTimeout(() => {
          setUploads(prev => prev.filter(u => u.id !== id));
        }, 3000);
      } else {
        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error' } : u));
        showToast('Upload Failed', `Could not upload ${file.name}.`, undefined);
      }
    };
    
    xhr.onerror = () => {
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error' } : u));
    };
    
    xhr.send(formData);
  };

  const handleFilesSelected = (selectedList: FileList | null) => {
    if (!selectedList || selectedList.length === 0) return;
    Array.from(selectedList).forEach(file => {
      uploadFile(file);
    });
  };

  // Global Drag-and-drop listeners
  useEffect(() => {
    if (!isAuthenticated || status?.stopped) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOverDashboard(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX === 0 && e.clientY === 0) {
        setIsDragOverDashboard(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOverDashboard(false);
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFilesSelected(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [isAuthenticated, status?.stopped]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setIsSubmittingLogin(true);
    setLoginError('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          try {
            sessionStorage.setItem('fs_token', data.token);
          } catch (_) {}
          setAuthToken(data.token);
        }
        setIsAuthenticated(true);
        setPassword('');
        loadFiles(false, data.token);
      } else {
        const data = await response.json();
        setLoginError(data.error || 'The password is incorrect.');
      }
    } catch {
      setLoginError('Unable to connect to the server.');
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleLogout = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch (_) {}
    try {
      sessionStorage.removeItem('fs_token');
    } catch (_) {}
    setAuthToken(null);
    setIsAuthenticated(false);
    setFiles([]);
    setStatus(null);
  };

  const handleStopShare = async () => {
    setIsStopping(true);
    try {
      const response = await fetch('/stop-share', {
        method: 'POST',
        headers: getAuthHeaders({ 'X-Requested-With': 'XMLHttpRequest' })
      });
      if (response.ok) {
        setShowStopConfirm(false);
        fetchStatus();
      }
    } catch (_) {
    } finally {
      setIsStopping(false);
    }
  };

  const handleRestartShare = async () => {
    try {
      const response = await fetch('/api/restart', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        if (data.share_password) {
          setStatus((prev: ShareStatus | null) => (prev ? { ...prev, share_password: data.share_password, stopped: false } : prev));
        }
        checkAuth();
      } else {
        showToast('Restart Failed', data.error || 'Only the share owner can restart the share.', undefined);
      }
    } catch (_) {}
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedText('Copied');
      showToast('Link Copied', 'Public workspace link has been copied to your clipboard.', <Check className="w-4 h-4 text-emerald-400" />);
      setTimeout(() => setCopiedText('Copy link'), 1200);
    } catch (_) {
      window.prompt('Copy this link:', shareUrl);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  };

  const handleDownloadClick = (e: React.MouseEvent, name: string, size: number) => {
    const limit = 50 * 1024 * 1024; // 50 MiB limit for custom progress tracking
    if (size > limit) {
      return;
    }
    e.preventDefault();
    if (xhrRef.current) {
      xhrRef.current.abort();
    }

    setDownloadProgress({
      visible: true,
      name,
      percent: 0,
      statusText: 'Starting download…',
      metaText: `0 B / ${formatBytes(size)}`,
      loaded: 0,
      total: size
    });

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    const token = authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('fs_token') : null);
    xhr.open('GET', getDownloadUrl(name), true);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.responseType = 'blob';

    xhr.onprogress = (event) => {
      const loaded = event.loaded;
      const total = event.total || size;
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      setDownloadProgress((prev: DownloadProgressState) => ({
        ...prev,
        percent,
        loaded,
        total,
        statusText: 'Downloading…',
        metaText: `${formatBytes(loaded)} / ${formatBytes(total)}`
      }));
    };

    xhr.onload = () => {
      if (xhr.status !== 200 && xhr.status !== 206) {
        setDownloadProgress((prev: DownloadProgressState) => ({
          ...prev,
          statusText: 'Download failed',
          metaText: `Server returned HTTP ${xhr.status}`
        }));
        setTimeout(resetProgress, 1500);
        return;
      }

      const blob = xhr.response;
      const disposition = xhr.getResponseHeader('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const finalName = filenameMatch ? decodeURIComponent(filenameMatch[1]) : name;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDownloadProgress((prev: DownloadProgressState) => ({
        ...prev,
        percent: 100,
        statusText: 'Complete',
        metaText: formatBytes(size)
      }));

      setTimeout(resetProgress, 1200);
      fetchStatus();
    };

    xhr.onerror = () => {
      setDownloadProgress((prev: DownloadProgressState) => ({
        ...prev,
        statusText: 'Download failed',
        metaText: 'Connection interrupted'
      }));
      setTimeout(resetProgress, 1500);
    };

    xhr.send();
  };

  const resetProgress = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setDownloadProgress({
      visible: false,
      name: '',
      percent: 0,
      statusText: 'Starting download…',
      metaText: 'Preparing transfer',
      loaded: 0,
      total: 0
    });
  };

  const handleDownloadAll = () => {
    if (isBundling) return;
    setIsBundling(true);

    const token = authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('fs_token') : null);
    const downloadUrl = token ? `/download-all?token=${encodeURIComponent(token)}` : '/download-all';
    window.location.href = downloadUrl;

    setTimeout(() => {
      setIsBundling(false);
      fetchStatus();
    }, 4000);
  };

  const getRemainingText = () => {
    if (!status) return 'Checking…';
    if (status.stopped) return `Link closed (${status.stop_reason || 'stopped'})`;
    if (status.remaining === null) return 'No time limit';
    if (status.remaining <= 0) return 'Expired';
    const mins = Math.floor(status.remaining / 60);
    const secs = status.remaining % 60;
    return `Expires in ${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  // Filter and sort files
  const filteredFiles = files.filter(f => {
    const matchesSearch = f.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeFilter === 'all' || f.category === activeFilter;
    return matchesSearch && matchesCategory;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    let result = 0;
    if (sortBy === 'name') {
      result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (sortBy === 'size') {
      result = a.size - b.size;
    } else if (sortBy === 'mtime') {
      result = new Date(a.mtime).getTime() - new Date(b.mtime).getTime();
    }
    return sortOrder === 'asc' ? result : -result;
  });

  const visibleFileNames = sortedFiles.map(f => f.name);
  const allSelected = visibleFileNames.length > 0 && visibleFileNames.every(name => selectedFiles.includes(name));
  const isPartiallySelected = visibleFileNames.some(name => selectedFiles.includes(name)) && !allSelected;

  const toggleSelectFile = (name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedFiles(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      const visibleSet = new Set(visibleFileNames);
      setSelectedFiles(prev => prev.filter(name => !visibleSet.has(name)));
    } else {
      setSelectedFiles(prev => Array.from(new Set([...prev, ...visibleFileNames])));
    }
  };

  const handleBulkDownload = async () => {
    if (selectedFiles.length === 0) return;
    setIsBulkDownloading(true);
    try {
      const response = await fetch('/api/download-selected', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ names: selectedFiles })
      });
      if (!response.ok) {
        throw new Error('Failed to download selected files');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `selected_files_${selectedFiles.length}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error downloading selected files:', err);
    } finally {
      setIsBulkDownloading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const response = await fetch('/api/files/bulk-delete', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ names: selectedFiles })
      });
      const data = await response.json();
      if (data.success) {
        const deletedSet = new Set(data.deleted || selectedFiles);
        setFiles(prev => prev.filter(f => !deletedSet.has(f.name)));
        setSelectedFiles([]);
        setShowBulkDeleteConfirm(false);
        fetchStatus();
      }
    } catch (err) {
      console.error('Error deleting files:', err);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleSingleDelete = async (name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (response.ok) {
        setFiles(prev => prev.filter(f => f.name !== name));
        setSelectedFiles(prev => prev.filter(n => n !== name));
        if (previewFile?.name === name) {
          setPreviewFile(null);
        }
        fetchStatus();
      }
    } catch (err) {
      console.error('Error deleting file:', err);
    }
  };

  // LOADING SCREEN (Checking auth on first load)
  if (isAuthenticated === null) {
    return (
      <div id="loading-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
        <div className="fs-3d-loader" aria-hidden="true">
          <div className="ground"><div></div></div>
          <div className="box box0"><div></div></div>
          <div className="box box1"><div></div></div>
          <div className="box box2"><div></div></div>
          <div className="box box3"><div></div></div>
          <div className="box box4"><div></div></div>
          <div className="box box5"><div></div></div>
          <div className="box box6"><div></div></div>
          <div className="box box7"><div></div></div>
        </div>
        <span className="muted" style={{ fontSize: '13px', fontWeight: 600 }}>Loading workspace…</span>
      </div>
    );
  }

  // LOGIN VIEW
  if (!isAuthenticated) {
    return (
      <LoginView
        password={password}
        setPassword={setPassword}
        handleLogin={handleLogin}
        loginError={loginError}
        isSubmittingLogin={isSubmittingLogin}
        status={status}
      />
    );
  }

  // SHARE STOPPED / EXPIRED VIEW
  if (status?.stopped) {
    return <StoppedView status={status} onRestart={handleRestartShare} />;
  }

  // FULL WORKSPACE DASHBOARD
  const branchedMenuItems: BranchedMenuItem[] = [
    {
      label: `Shared Files (${files.length})`,
      children: [
        { value: 'upload', label: 'Upload Files', icon: Folder },
        { value: 'new_file', label: 'Create New File', icon: FilePlus },
        { value: 'download_zip', label: 'Download All ZIP', badge: files.length },
        { value: 'select_all', label: allSelected ? 'Deselect All' : 'Select All Files' }
      ]
    },
    {
      label: 'Smopi AI Operations',
      children: [
        { value: 'open_smopi', label: 'Open Smopi Assistant', icon: Sparkles },
        { value: 'summarize', label: 'Summarize Workspace', badge: 'Fast' },
        { value: 'organize', label: 'Auto-Organize & Clean' }
      ]
    },
    {
      label: 'Workspace Views',
      children: [
        { value: 'view_list', label: 'List Layout' },
        { value: 'view_grid', label: 'Grid Cards' },
        { value: 'view_physics', label: 'Physics Vault 🌌', badge: 'Matter' }
      ]
    },
    {
      label: 'Quick Utilities',
      children: [
        { value: 'copy_link', label: 'Copy Share Link' },
        { value: 'toggle_sync', label: autoRefresh ? 'Disable Live Sync' : 'Enable Live Sync (5s)' },
        { value: 'toggle_motion', label: reduceMotion ? 'Enable Full Motion' : 'Enable Eco Motion' }
      ]
    }
  ];

  const handleBranchedSelect = (value: string) => {
    switch (value) {
      case 'upload':
        fileInputRef.current?.click();
        break;
      case 'new_file':
        handleOpenEditor();
        break;
      case 'download_zip':
        handleDownloadAll();
        break;
      case 'select_all':
        toggleSelectAll();
        break;
      case 'open_smopi':
        setIsSmopiOpen(true);
        break;
      case 'summarize':
        handlePromptSend('/summarize Please analyze and synthesize all shared files.', {
          attachments: [],
          model: { key: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
          effort: 'Balanced'
        });
        break;
      case 'organize':
        handlePromptSend('/organize Please standardize and categorize files in this workspace.', {
          attachments: [],
          model: { key: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
          effort: 'Balanced'
        });
        break;
      case 'view_list':
        setViewMode('list');
        break;
      case 'view_grid':
        setViewMode('grid');
        break;
      case 'view_physics':
        setViewMode('physics');
        showToast('Physics Vault Activated', 'Toss, drag, and bounce files with 2D physics!', <Sparkles className="w-4 h-4 text-sky-400" />);
        break;
      case 'copy_link':
        handleCopyLink();
        break;
      case 'toggle_sync':
        setAutoRefresh((prev) => !prev);
        break;
      case 'toggle_motion':
        setReduceMotion((prev) => !prev);
        break;
    }
  };

  return (
    <div id="dashboard-container" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <SmopiWorkspaceView
        files={files}
        status={status}
        authToken={authToken}
        onFilesChanged={() => {
          loadFiles(true);
          fetchStatus();
        }}
        onPreviewFile={handlePreviewClick}
        onEditFile={(file, content) => handleOpenEditor(file, content)}
        onDownloadFile={(file) => {
          const dummyEvent = { preventDefault: () => {} } as React.MouseEvent;
          handleDownloadClick(dummyEvent, file.name, file.size);
        }}
        onDeleteFile={handleSingleDelete}
        onUploadClick={() => fileInputRef.current?.click()}
        onStopShare={() => setShowStopConfirm(true)}
        renderFilesGallery={
          <div style={{ width: '100%', maxWidth: '840px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--v5-ink)' }}>Workspace Files</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--v5-muted)' }}>
                  {files.length} active files in temporary share session
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  disabled={isBundling || files.length === 0}
                  className="v5-new-chat-btn"
                  style={{ margin: 0, padding: '8px 16px', fontSize: '0.8rem', width: 'auto' }}
                  title="Download all files as ZIP"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isBundling ? 'Creating ZIP…' : 'Download All (ZIP)'}</span>
                </button>
              </div>
            </div>

            {/* Quick Upload Dropzone */}
            <div style={{ marginBottom: '20px' }}>
              <UploadDropzone
                fileInputRef={fileInputRef}
                onFilesSelected={handleFilesSelected}
                uploads={uploads}
              />
            </div>

            {/* Search & Categories Toolbar */}
            <div className="toolbar" id="dashboard-toolbar" style={{ marginBottom: '16px' }}>
              <div className="search-wrap" style={{ position: 'relative' }}>
                <label className="sr-only" htmlFor="search">Search files</label>
                <input
                  ref={searchRef}
                  id="search"
                  type="search"
                  placeholder="Search files… (Press 'S' to focus)"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ paddingRight: '42px' }}
                />
                <span className="kbd-badge" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>S</span>
              </div>
              <div className="filter-group" role="group" aria-label="File filters">
                {['all', 'archives', 'images', 'documents', 'other'].map((filter) => (
                  <button
                    key={filter}
                    className={`filter ${activeFilter === filter ? 'active' : ''}`}
                    type="button"
                    onClick={() => setActiveFilter(filter)}
                  >
                    {filter === 'all' ? 'All' : filter === 'archives' ? 'ZIP' : filter === 'images' ? 'Images' : filter === 'documents' ? 'Docs' : 'Other'}
                  </button>
                ))}
              </div>
            </div>

            {/* Animated File Items List */}
            <div id="fileList" className={`file-list ${viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' : ''}`}>
              <AnimatePresence mode="popLayout">
                {sortedFiles.map((file, idx) => (
                  <FileItem
                    key={file.name}
                    index={idx}
                    file={file}
                    viewMode={viewMode === 'grid' ? 'grid' : 'list'}
                    isSelected={selectedFiles.includes(file.name)}
                    onToggleSelect={toggleSelectFile}
                    onPreview={handlePreviewClick}
                    onDelete={handleSingleDelete}
                    onDownload={handleDownloadClick}
                    downloadUrl={getDownloadUrl(file.name)}
                    getFileIcon={getFileIcon}
                  />
                ))}
              </AnimatePresence>

              {sortedFiles.length === 0 && (
                <div className="empty-state" id="emptyState" style={{ padding: '48px 24px' }}>
                  <Search className="w-8 h-8 text-slate-500 mb-2" />
                  <p><strong>{searchQuery || activeFilter !== 'all' ? 'No matching files found' : 'No files in share directory'}</strong></p>
                  <p className="muted">
                    {searchQuery || activeFilter !== 'all' ? 'Try adjusting your search query or filters above' : 'Drop or browse files above to share them with this link.'}
                  </p>
                </div>
              )}
            </div>

            {/* Sticky Bulk Actions Floating Bar */}
            <BulkActionsBar
              selectedCount={selectedFiles.length}
              onBulkDownload={handleBulkDownload}
              onBulkDelete={() => setShowBulkDeleteConfirm(true)}
              onClearSelection={() => setSelectedFiles([])}
              isBulkDownloading={isBulkDownloading}
              isBulkDeleting={isBulkDeleting}
            />
          </div>
        }
      />

      {/* File Preview Modal */}
      <FilePreviewModal
        previewFile={previewFile}
        previewData={previewData}
        isLoading={isPreviewLoading}
        onClose={() => setPreviewFile(null)}
        onDownload={handleDownloadClick}
        downloadUrl={previewFile ? getDownloadUrl(previewFile.name) : ''}
        getFileIcon={getFileIcon}
        onEditFile={(file: SharedFile, content?: string) => handleOpenEditor(file, content)}
        onAskSmopi={(prompt: string) => handleAskSmopi(prompt)}
      />

      {/* Smopi AI Agent Drawer */}
      <SmopiDrawer
        isOpen={isSmopiOpen}
        onClose={() => setIsSmopiOpen(false)}
        files={files}
        onFilesChanged={() => {
          loadFiles(true);
          fetchStatus();
        }}
        authToken={authToken}
      />

      {/* Direct File Editor Modal */}
      <FileEditorModal
        isOpen={editorState.isOpen}
        onClose={() => setEditorState((prev) => ({ ...prev, isOpen: false }))}
        fileName={editorState.fileName}
        initialContent={editorState.content}
        isCreatingNew={editorState.isCreatingNew}
        onSaved={() => {
          loadFiles(true);
          fetchStatus();
        }}
        authToken={authToken}
        onAskSmopi={() => {
          setIsSmopiOpen(true);
        }}
      />

      {/* Global Drag and Drop Overlay Indicator */}
      {isDragOverDashboard && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          backgroundColor: 'rgba(14, 165, 233, 0.15)',
          border: '4px dashed #38bdf8',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          color: '#ffffff',
          pointerEvents: 'none',
          animation: 'fadeIn 0.15s ease'
        }}>
          <UploadCloud className="w-20 h-20 text-sky-400 animate-bounce" />
          <h1 style={{ fontSize: '28px', fontWeight: 800, textShadow: '0 4px 12px rgba(0,0,0,0.5)', margin: 0 }}>Drop files anywhere to upload</h1>
          <p style={{ fontSize: '16px', fontWeight: 500, color: '#e2e8f0', textShadow: '0 2px 4px rgba(0,0,0,0.5)', margin: 0 }}>Release your mouse to dynamically share these files in this session.</p>
        </div>
      )}

      {/* Stop Share Confirmation Dialog */}
      {showStopConfirm && (
        <div id="stopConfirm" className="fs-confirm">
          <div className="fs-confirm-card">
            <div className="eyebrow">STOP SHARE</div>
            <h2>End this public link?</h2>
            <p className="muted">The sharing session will stop immediately. The original files will not be deleted.</p>
            <div className="fs-confirm-actions">
              <button id="cancelStop" className="ghost" type="button" onClick={() => setShowStopConfirm(false)}>
                Cancel
              </button>
              <button
                id="confirmStop"
                className="button fs-stop-btn"
                type="button"
                disabled={isStopping}
                onClick={handleStopShare}
              >
                <span>{isStopping ? 'Stopping…' : 'Stop share'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      {showBulkDeleteConfirm && (
        <div className="fs-confirm">
          <div className="fs-confirm-card">
            <div className="eyebrow" style={{ color: '#ef4444' }}>BULK DELETE</div>
            <h2>Delete {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''}?</h2>
            <p className="muted">
              Are you sure you want to delete these {selectedFiles.length} selected files from the shared workspace? This action cannot be undone.
            </p>
            <div className="fs-confirm-actions">
              <button className="ghost" type="button" onClick={() => setShowBulkDeleteConfirm(false)}>
                Cancel
              </button>
              <button
                className="button fs-stop-btn"
                type="button"
                disabled={isBulkDeleting}
                onClick={handleBulkDelete}
              >
                <span>{isBulkDeleting ? 'Deleting…' : `Delete ${selectedFiles.length} files`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zip Bundler Full-screen Overlay */}
      {isBundling && (
        <div id="archiveOverlay" className="fs-archive-overlay">
          <div className="fs-archive-card">
            <div className="eyebrow">PREPARING ARCHIVE</div>
            <div className="fs-stage-loading">
              <div className="fs-3d-loader" aria-hidden="true">
                <div className="ground"><div></div></div>
                <div className="box box0"><div></div></div>
                <div className="box box1"><div></div></div>
                <div className="box box2"><div></div></div>
                <div className="box box3"><div></div></div>
                <div className="box box4"><div></div></div>
                <div className="box box5"><div></div></div>
                <div className="box box6"><div></div></div>
                <div className="box box7"><div></div></div>
              </div>
            </div>
            <h2>Creating files.zip</h2>
            <p className="muted">Collecting the shared files. This may take a moment.</p>
          </div>
        </div>
      )}

      {/* Global Swipeable Toast Notification */}
      {toast && (
        <SwipeToast
          key={toast.id}
          open={true}
          title={toast.title}
          description={toast.description}
          icon={toast.icon}
          actionLabel={toast.actionLabel}
          onAction={toast.onAction}
          duration={toast.duration ?? 4000}
          onClose={() => setToast(null)}
          fuseColor="var(--accent, #38bdf8)"
        />
      )}
    </div>
  );
}
