import React from 'react';
import { X, Download, Edit3, Loader2, FileText, AlertCircle, Copy, Check } from 'lucide-react';
import type { SharedFile, PreviewData } from '../types';
import { SmopiAvatar } from './smopi';

interface FilePreviewModalProps {
  previewFile: SharedFile | null;
  previewData: PreviewData | null;
  isLoading: boolean;
  onClose: () => void;
  onDownload: (e: React.MouseEvent, name: string, size: number) => void;
  downloadUrl: string;
  getFileIcon: (file: SharedFile) => React.ReactNode;
  onEditFile: (file: SharedFile, content?: string) => void;
  onAskSmopi: (prompt: string) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  previewFile,
  previewData,
  isLoading,
  onClose,
  onDownload,
  downloadUrl,
  getFileIcon,
  onEditFile,
  onAskSmopi
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!previewFile) return null;

  const handleCopyContent = () => {
    if (previewData?.content) {
      navigator.clipboard.writeText(previewData.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const isTextFile = previewData?.type === 'text';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[var(--panel)] border border-[var(--border-strong)] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--panel2)]">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <div className="shrink-0">{getFileIcon(previewFile)}</div>
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate text-[var(--text)]">{previewFile.name}</h2>
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span>{previewFile.size_human}</span>
                <span>•</span>
                <span>{previewFile.mtime}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => onDownload(e, previewFile.name, previewFile.size)}
              className="p-2 rounded-lg bg-[var(--panel3)] border border-[var(--border)] text-[var(--text)] hover:bg-slate-800 transition-colors"
              title="Download file"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-[var(--panel3)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-slate-800 transition-colors"
              title="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-auto p-6 min-h-[250px] flex items-center justify-center bg-[var(--bg)]">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
              <span className="text-sm">Loading preview…</span>
            </div>
          ) : previewData?.type === 'image' ? (
            <div className="flex items-center justify-center max-w-full max-h-[60vh] overflow-hidden rounded-lg">
              <img
                src={previewData.url}
                alt={previewFile.name}
                className="max-w-full max-h-[60vh] object-contain rounded-lg"
              />
            </div>
          ) : previewData?.type === 'text' ? (
            <div className="w-full h-full flex flex-col">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border)] text-xs text-[var(--muted)]">
                <span>File Content</span>
                <button
                  type="button"
                  onClick={handleCopyContent}
                  className="flex items-center gap-1 hover:text-[var(--text)] transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
              <pre className="p-4 rounded-xl bg-[var(--panel3)] border border-[var(--border)] text-xs font-mono text-slate-200 overflow-auto max-h-[55vh] leading-relaxed whitespace-pre-wrap word-break-break-word">
                {previewData.content}
              </pre>
            </div>
          ) : (
            <div className="text-center py-10 px-4 max-w-md">
              <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <p className="text-sm font-semibold text-[var(--text)]">Preview not supported</p>
              <p className="text-xs text-[var(--muted)] mt-1">
                {previewData?.message || 'This file type cannot be previewed directly in the browser.'}
              </p>
              <a
                href={downloadUrl}
                download={previewFile.name}
                className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl bg-[var(--text)] text-slate-950 text-xs font-bold hover:bg-white transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Download to view</span>
              </a>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-[var(--border)] bg-[var(--panel2)] text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onAskSmopi(`Please analyze or explain the file '${previewFile.name}'`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-950/40 border border-sky-800/60 text-sky-300 hover:bg-sky-900/40 transition-colors"
            >
              <SmopiAvatar size={18} status="idle" />
              <span>Ask Smopi about this file</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isTextFile && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditFile(previewFile, previewData?.content);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--panel3)] border border-[var(--border)] text-[var(--text)] hover:bg-slate-800 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit File</span>
              </button>
            )}

            <button
              type="button"
              onClick={(e) => onDownload(e, previewFile.name, previewFile.size)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[var(--text)] text-slate-950 font-bold hover:bg-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilePreviewModal;
