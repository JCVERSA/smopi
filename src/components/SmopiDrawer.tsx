import React from 'react';
import { X } from 'lucide-react';
import type { SharedFile } from '../types';
import { SmopiWorkspaceView } from './SmopiWorkspaceView';
import { SmopiAvatar } from './smopi';

interface SmopiDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  files: SharedFile[];
  onFilesChanged: () => void;
  authToken: string | null;
}

export const SmopiDrawer: React.FC<SmopiDrawerProps> = ({
  isOpen,
  onClose,
  files,
  onFilesChanged,
  authToken
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity">
      <div
        className="w-full max-w-2xl h-full flex flex-col bg-[var(--panel)] border-l border-[var(--border-strong)] shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--panel2)]">
          <div className="flex items-center gap-2.5">
            <SmopiAvatar size={34} status="idle" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[var(--text)]">Smopi AI File Agent</span>
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-semibold">Active</span>
              </div>
              <p className="text-[11px] text-[var(--muted)]">Workspace Assistant & Automation</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-slate-800 transition-colors"
            aria-label="Close Smopi assistant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body with SmopiWorkspaceView */}
        <div className="flex-1 overflow-hidden relative">
          <SmopiWorkspaceView
            files={files}
            status={null}
            authToken={authToken}
            onFilesChanged={onFilesChanged}
            onPreviewFile={() => {}}
            onEditFile={() => {}}
            onDownloadFile={(file) => {
              const a = document.createElement('a');
              a.href = `/download/${encodeURIComponent(file.name)}`;
              a.download = file.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
            onDeleteFile={async (filename) => {
              try {
                const headers: Record<string, string> = {};
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
                await fetch(`/api/files/${encodeURIComponent(filename)}`, {
                  method: 'DELETE',
                  headers
                });
                onFilesChanged();
              } catch (_) {}
            }}
            onUploadClick={() => {}}
            onStopShare={() => {}}
          />
        </div>
      </div>
    </div>
  );
};

export default SmopiDrawer;
