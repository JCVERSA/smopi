import React, { useState, useEffect } from 'react';
import { X, Save, FilePlus, RefreshCw, FileText } from 'lucide-react';
import { SmopiAvatar } from './smopi';

interface FileEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName?: string;
  initialContent?: string;
  isCreatingNew?: boolean;
  onSaved: () => void;
  authToken: string | null;
  onAskSmopi?: (prompt: string) => void;
}

export const FileEditorModal: React.FC<FileEditorModalProps> = ({
  isOpen,
  onClose,
  fileName: defaultFileName = '',
  initialContent = '',
  isCreatingNew = false,
  onSaved,
  authToken,
  onAskSmopi
}) => {
  const [name, setName] = useState(defaultFileName);
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(defaultFileName);
      setContent(initialContent);
      setError(null);
    }
  }, [isOpen, defaultFileName, initialContent]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Filename cannot be empty');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      if (isCreatingNew) {
        const res = await fetch('/api/files/create', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: name.trim(), content })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to create file');
        }
      } else {
        const res = await fetch(`/api/files/${encodeURIComponent(name.trim())}/content`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ content })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save file changes');
        }
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Save error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSmopiAssist = (action: string) => {
    if (!onAskSmopi) return;
    if (action === 'format') {
      onAskSmopi(`Please clean up, format, and enhance the formatting of "${name}".`);
    } else if (action === 'summarize') {
      onAskSmopi(`Please review and summarize the contents of "${name}".`);
    }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#15171e',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '750px',
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                padding: '8px',
                borderRadius: '8px',
                backgroundColor: isCreatingNew ? 'rgba(52, 211, 153, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                color: isCreatingNew ? '#34d399' : '#38bdf8'
              }}
            >
              {isCreatingNew ? <FilePlus className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>
                {isCreatingNew ? 'Create New File' : `Editing: ${name}`}
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                {isCreatingNew ? 'Add a new text or markdown document to shared workspace' : 'Direct text and markdown editor'}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="ghost"
            style={{ padding: '8px', borderRadius: '8px' }}
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form
          onSubmit={handleSave}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '16px 20px' }}
        >
          {error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '12px'
              }}
            >
              {error}
            </div>
          )}

          {/* Filename Input */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px' }}>
              File Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isCreatingNew}
              placeholder="e.g. notes.md, data.json, script.js"
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: isCreatingNew ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '14px',
                fontFamily: 'monospace',
                outline: 'none'
              }}
            />
          </div>

          {/* Content Editor */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                Content (Text / Markdown / Code)
              </label>
              {!isCreatingNew && onAskSmopi && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', gap: '4px' }}
                    onClick={() => handleSmopiAssist('format')}
                  >
                    <SmopiAvatar size={15} status="idle" />
                    <span>Smopi: Polish formatting</span>
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', gap: '4px' }}
                    onClick={() => handleSmopiAssist('summarize')}
                  >
                    <SmopiAvatar size={15} status="idle" />
                    <span>Smopi: Summarize</span>
                  </button>
                </div>
              )}
            </div>

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type or paste text content here..."
              style={{
                flex: 1,
                width: '100%',
                backgroundColor: '#0c0e14',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '14px',
                color: '#e2e8f0',
                fontSize: '13px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                lineHeight: '1.6',
                resize: 'none',
                outline: 'none'
              }}
            />
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="ghost"
              onClick={onClose}
              disabled={isSaving}
              style={{ padding: '8px 16px', borderRadius: '8px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button"
              disabled={isSaving}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                backgroundColor: '#0284c7',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600
              }}
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{isCreatingNew ? 'Create File' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
