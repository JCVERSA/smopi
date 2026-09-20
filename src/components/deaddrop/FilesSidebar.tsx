import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Edit3, Eye, PanelLeftClose, Search, Trash2, Upload } from 'lucide-react';
import type { SharedFile } from '../../types';

interface FilesSidebarProps {
  files: SharedFile[];
  selectedFiles: string[];
  onSelectFile?: (filename: string, e: React.MouseEvent) => void;
  onPreviewFile: (file: SharedFile) => void;
  onEditFile: (file?: SharedFile, content?: string) => void;
  onDownloadFile: (file: SharedFile) => void;
  onDeleteFile: (filename: string) => void;
  onUploadClick: () => void;
  onCollapse: () => void;
}

function totalSize(files: SharedFile[]): string {
  const n = files.reduce((acc, f) => acc + (f.size || 0), 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Rows cascade in on mount; each row is a child of this list variant. */
const listVariants = {
  show: { transition: { staggerChildren: 0.025 } }
};
const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const } }
};

export const FilesSidebar: React.FC<FilesSidebarProps> = ({
  files,
  selectedFiles,
  onSelectFile,
  onPreviewFile,
  onEditFile,
  onDownloadFile,
  onDeleteFile,
  onUploadClick,
  onCollapse
}) => {
  const [query, setQuery] = useState('');
  const filtered = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="dd-side__inner">
      <div className="dd-side__head">
        <div>
          <h2 className="dd-title">Files</h2>
          <span className="dd-count">
            {files.length === 0 ? 'empty' : `${files.length} \u00b7 ${totalSize(files)}`}
          </span>
        </div>
        <button
          type="button"
          className="dd-btn dd-btn--ghost dd-btn--icon"
          onClick={onCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <button type="button" className="dd-side__upload" onClick={onUploadClick}>
        <Upload size={14} />
        Add files
      </button>

      {files.length > 6 && (
        <div className="dd-side__search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter"
            aria-label="Filter files"
          />
        </div>
      )}

      <motion.div className="dd-side__list" variants={listVariants} initial="hidden" animate="show">
        <AnimatePresence initial={false}>
          {filtered.length === 0 && (
            <p className="dd-empty">
              {files.length === 0 ? 'Nothing in this drop yet.' : 'No match.'}
            </p>
          )}

          {filtered.map((file) => (
            <motion.div
              key={file.name}
              layout
              variants={rowVariants}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, x: -8, transition: { duration: 0.15 } }}
              className="dd-frow"
              data-selected={selectedFiles.includes(file.name) ? 'true' : 'false'}
              role="button"
              tabIndex={0}
              onClick={(e) => onSelectFile?.(file.name, e as unknown as React.MouseEvent)}
              onDoubleClick={() => onPreviewFile(file)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onPreviewFile(file);
              }}
              aria-label={`${file.name}, ${file.size_human}`}
            >
              <span className="dd-frow__name" title={file.name}>
                {file.name}
              </span>
              <span className="dd-frow__meta">{file.size_human}</span>
              <span className="dd-frow__acts">
                <button
                  type="button"
                  className="dd-btn dd-btn--ghost dd-btn--icon"
                  aria-label={`Preview ${file.name}`}
                  title="Preview"
                  onClick={(e) => { e.stopPropagation(); onPreviewFile(file); }}
                >
                  <Eye size={13} />
                </button>
                <button
                  type="button"
                  className="dd-btn dd-btn--ghost dd-btn--icon"
                  aria-label={`Edit ${file.name}`}
                  title="Edit"
                  onClick={(e) => { e.stopPropagation(); onEditFile(file); }}
                >
                  <Edit3 size={13} />
                </button>
                <button
                  type="button"
                  className="dd-btn dd-btn--ghost dd-btn--icon"
                  aria-label={`Download ${file.name}`}
                  title="Download"
                  onClick={(e) => { e.stopPropagation(); onDownloadFile(file); }}
                >
                  <Download size={13} />
                </button>
                <button
                  type="button"
                  className="dd-btn dd-btn--ghost dd-btn--icon"
                  aria-label={`Delete ${file.name}`}
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); onDeleteFile(file.name); }}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
