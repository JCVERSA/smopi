import React, { useState } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, File, Loader2 } from 'lucide-react';
import type { UploadItem } from '../types';

interface UploadDropzoneProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: FileList | null) => void;
  uploads: UploadItem[];
}

export const UploadDropzone: React.FC<UploadDropzoneProps> = ({
  fileInputRef,
  onFilesSelected,
  uploads
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full">
      {/* Dropzone Container */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-200 ${
          isDragOver
            ? 'border-sky-400 bg-sky-950/20 shadow-lg shadow-sky-900/20'
            : 'border-[var(--border-strong)] bg-[var(--panel2)] hover:border-slate-500 hover:bg-[var(--panel)]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFilesSelected(e.target.files);
              e.target.value = '';
            }
          }}
        />

        <div className="flex flex-col items-center justify-center gap-2 pointer-events-none">
          <div
            className={`p-3 rounded-full transition-transform duration-200 ${
              isDragOver ? 'bg-sky-500/20 text-sky-400 scale-110' : 'bg-slate-800 text-[var(--soft)]'
            }`}
          >
            <UploadCloud className="w-6 h-6" />
          </div>

          <div className="text-sm font-semibold text-[var(--text)]">
            <span>Drop files here to share, or </span>
            <span className="text-sky-400 hover:underline">browse files</span>
          </div>

          <p className="text-xs text-[var(--muted)]">
            Up to 500 MB per file · Multiple files supported · Encrypted transit
          </p>
        </div>
      </div>

      {/* Uploading Progress List */}
      {uploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploads.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-xl bg-[var(--panel3)] border border-[var(--border)] text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0 max-w-[60%]">
                <File className="w-4 h-4 shrink-0 text-sky-400" />
                <span className="truncate font-medium text-[var(--text)]">{item.name}</span>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-24 bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      item.status === 'error'
                        ? 'bg-red-500'
                        : item.status === 'success'
                        ? 'bg-emerald-400'
                        : 'bg-sky-400'
                    }`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>

                <div className="w-16 text-right">
                  {item.status === 'uploading' && (
                    <span className="text-[var(--muted)] flex items-center justify-end gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>{item.progress}%</span>
                    </span>
                  )}
                  {item.status === 'success' && (
                    <span className="text-emerald-400 flex items-center justify-end gap-1 font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Done</span>
                    </span>
                  )}
                  {item.status === 'error' && (
                    <span className="text-red-400 flex items-center justify-end gap-1 font-semibold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Failed</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UploadDropzone;
