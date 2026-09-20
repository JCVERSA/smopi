import React from 'react';
import type { DownloadProgressState } from '../types';

interface DownloadProgressModalProps {
  progress: DownloadProgressState;
  onCancel: () => void;
}

export const DownloadProgressModal: React.FC<DownloadProgressModalProps> = ({
  progress,
  onCancel
}) => {
  if (!progress.visible) return null;

  return (
    <div id="progressModal" className="fs-progress-modal">
      <div className="fs-progress-card">
        <div className="eyebrow">DOWNLOADING</div>
        <h2 id="progressFilename">{progress.name}</h2>
        <div className="fs-progress-track">
          <div
            id="progressBar"
            className="fs-progress-fill"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <div className="fs-progress-meta">
          <span id="progressPercent">{progress.percent}%</span>
          <span id="progressBytes">{progress.metaText}</span>
        </div>
        <p id="progressStatus" className="muted">{progress.statusText}</p>
        <button
          id="cancelDownload"
          type="button"
          className="ghost"
          style={{ marginTop: '14px', width: '100%' }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
