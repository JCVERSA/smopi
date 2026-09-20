import React from 'react';
import { Download, Trash2, X } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  onBulkDownload: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  isBulkDownloading: boolean;
  isBulkDeleting: boolean;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  onBulkDownload,
  onBulkDelete,
  onClearSelection,
  isBulkDownloading,
  isBulkDeleting
}) => {
  if (selectedCount === 0) return null;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: '24px',
        zIndex: 100,
        backgroundColor: '#181b22',
        border: '1px solid var(--accent)',
        borderRadius: '12px',
        padding: '12px 20px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        marginTop: '16px',
        animation: 'slideUp 0.2s ease-out'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
          {selectedCount} item{selectedCount > 1 ? 's' : ''} selected
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '12px',
            textDecoration: 'underline',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px'
          }}
        >
          <X className="w-3 h-3" />
          <span>Clear</span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          className="button"
          onClick={onBulkDownload}
          disabled={isBulkDownloading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid #38bdf8',
            color: '#38bdf8',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isBulkDownloading ? 'Preparing ZIP…' : 'Download ZIP'}</span>
        </button>

        <button
          type="button"
          className="button"
          onClick={onBulkDelete}
          disabled={isBulkDeleting}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            color: '#f87171',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{isBulkDeleting ? 'Deleting…' : 'Delete Selected'}</span>
        </button>
      </div>
    </div>
  );
};
