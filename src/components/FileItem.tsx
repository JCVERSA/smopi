import React from 'react';
import { Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { SharedFile } from '../types';

interface FileItemProps {
  file: SharedFile;
  viewMode: 'list' | 'grid';
  isSelected: boolean;
  onToggleSelect: (name: string, e: React.MouseEvent) => void;
  onPreview: (file: SharedFile) => void;
  onDelete: (name: string, e: React.MouseEvent) => void;
  onDownload: (e: React.MouseEvent, name: string, size: number) => void;
  downloadUrl: string;
  getFileIcon: (file: SharedFile) => React.ReactNode;
  index?: number;
}

const lettersOfDownload = 'Download'.split('');

export const FileItem: React.FC<FileItemProps> = ({
  file,
  viewMode,
  isSelected,
  onToggleSelect,
  onPreview,
  onDelete,
  onDownload,
  downloadUrl,
  getFileIcon,
  index = 0
}) => {
  const shouldReduceMotion = useReducedMotion();

  if (viewMode === 'grid') {
    return (
      <motion.div
        layout="position"
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, filter: 'blur(3px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
        transition={{
          duration: 0.3,
          delay: Math.min(index * 0.035, 0.35),
          ease: [0.22, 1, 0.36, 1]
        }}
        whileHover={shouldReduceMotion ? undefined : {
          y: -3,
          boxShadow: '0 10px 24px rgba(0, 0, 0, 0.28)',
          backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.05)',
          transition: { duration: 0.15 }
        }}
        whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
        className={`file-card ${isSelected ? 'is-selected' : ''}`}
        onClick={() => onPreview(file)}
        style={{
          backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255, 255, 255, 0.03)',
          border: isSelected ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '14px',
          padding: '16px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '12px',
          textAlign: 'left',
          position: 'relative'
        }}
      >
        {/* Top Row: Checkbox, Icon, Filename, and Delete Action */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div
            onClick={(e) => onToggleSelect(file.name, e)}
            style={{
              paddingTop: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title={isSelected ? 'Deselect file' : 'Select file'}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {}}
              style={{
                width: '16px',
                height: '16px',
                cursor: 'pointer',
                accentColor: 'var(--accent, #38bdf8)',
                borderRadius: '4px'
              }}
              aria-label={`Select ${file.name}`}
            />
          </div>

          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '10px',
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            {getFileIcon(file)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
            <strong
              style={{
                color: 'var(--text)',
                fontSize: '14px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              title={file.name}
            >
              {file.name}
            </strong>
            <span className="muted" style={{ fontSize: '11px' }}>
              {file.type}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => onDelete(file.name, e)}
            title={`Delete ${file.name}`}
            aria-label={`Delete ${file.name}`}
            style={{
              background: 'none',
              border: 'none',
              padding: '4px',
              color: 'var(--muted)',
              cursor: 'pointer',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#f87171'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '10px', marginTop: '4px' }}>
          <span className="muted">{file.size_human}</span>
          <span className="muted">{file.mtime.split(' ')[0]}</span>
        </div>

        <a
          className="fs-download-btn"
          href={downloadUrl}
          download
          aria-label={`Download ${file.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDownload(e, file.name, file.size);
          }}
          style={{
            width: '100%',
            textAlign: 'center',
            marginTop: '4px'
          }}
        >
          <span className="original">Download</span>
          <span className="letters">
            {lettersOfDownload.map((char, index) => (
              <span key={index}>{char}</span>
            ))}
          </span>
        </a>
      </motion.div>
    );
  }

  // List View
  return (
    <motion.div
      layout="position"
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: 'blur(2px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      transition={{
        duration: 0.26,
        delay: Math.min(index * 0.03, 0.3),
        ease: [0.22, 1, 0.36, 1]
      }}
      whileHover={shouldReduceMotion ? undefined : {
        x: 2,
        backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.05)',
        transition: { duration: 0.12 }
      }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.995 }}
      className={`file-row ${isSelected ? 'is-selected' : ''}`}
      onClick={() => onPreview(file)}
      style={{ cursor: 'pointer' }}
    >
      <div
        onClick={(e) => onToggleSelect(file.name, e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 4px'
        }}
        title={isSelected ? 'Deselect file' : 'Select file'}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          style={{
            width: '16px',
            height: '16px',
            cursor: 'pointer',
            accentColor: 'var(--accent, #38bdf8)',
            borderRadius: '4px'
          }}
          aria-label={`Select ${file.name}`}
        />
      </div>

      <span className="file-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {getFileIcon(file)}
      </span>
      <span className="file-main">
        <strong>{file.name}</strong>
        <span>{file.type} &middot; {file.size_human} &middot; {file.mtime}</span>
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <a
          className="fs-download-btn"
          href={downloadUrl}
          download
          aria-label={`Download ${file.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDownload(e, file.name, file.size);
          }}
        >
          <span className="original">Download</span>
          <span className="letters">
            {lettersOfDownload.map((char, index) => (
              <span key={index}>{char}</span>
            ))}
          </span>
        </a>

        <button
          type="button"
          onClick={(e) => onDelete(file.name, e)}
          title={`Delete ${file.name}`}
          aria-label={`Delete ${file.name}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            color: '#f87171',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
            e.currentTarget.style.borderColor = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)';
          }}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};
