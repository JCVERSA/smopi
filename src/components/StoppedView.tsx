import React, { useState } from 'react';
import { AlertTriangle, RotateCcw, Clock, ShieldX, HardDrive, Download } from 'lucide-react';
import type { ShareStatus } from '../types';

interface StoppedViewProps {
  status: ShareStatus | null;
  onRestart: () => void;
}

export const StoppedView: React.FC<StoppedViewProps> = ({ status, onRestart }) => {
  const [isRestarting, setIsRestarting] = useState(false);

  const handleRestartClick = async () => {
    setIsRestarting(true);
    try {
      await onRestart();
    } finally {
      setIsRestarting(false);
    }
  };

  const getReasonDetails = () => {
    if (status?.stop_reason === 'expired') {
      return {
        title: 'Share session expired',
        desc: 'The temporary time limit configured for this file share has elapsed.',
        icon: <Clock className="w-8 h-8 text-amber-400" />
      };
    }
    if (status?.stop_reason === 'one_time') {
      return {
        title: 'One-time transfer completed',
        desc: 'This file share was designated for a single transfer and closed after the download finished.',
        icon: <Download className="w-8 h-8 text-sky-400" />
      };
    }
    return {
      title: 'Share ended by operator',
      desc: 'The host has ended this file sharing session. The public link is inactive.',
      icon: <ShieldX className="w-8 h-8 text-red-400" />
    };
  };

  const reason = getReasonDetails();

  return (
    <main className="page">
      <section className="shell">
        <header className="topbar">
          <span className="brand">File Share</span>
          <div className="flex items-center gap-2 text-xs text-red-400">
            <span className="inline-block w-2 h-2 rounded-full bg-red-400"></span>
            <span>Link Inactive</span>
          </div>
        </header>

        <div className="content">
          <div className="auth-card text-center" style={{ maxWidth: '480px', margin: '40px auto' }}>
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-2xl bg-[var(--panel2)] border border-[var(--border)] shadow-lg">
                {reason.icon}
              </div>
            </div>

            <div className="eyebrow text-red-400 font-bold tracking-widest">
              {status?.stop_reason === 'expired' ? 'EXPIRED' : 'SHARE INACTIVE'}
            </div>

            <h1 className="text-2xl font-bold mt-1 text-[var(--text)]">{reason.title}</h1>
            <p className="muted mt-2 text-sm text-[var(--muted)]">
              {reason.desc}
            </p>

            {/* Session Stats */}
            <div className="grid grid-cols-2 gap-3 my-6 p-4 rounded-xl bg-[var(--panel2)] border border-[var(--border)] text-left">
              <div>
                <span className="text-xs text-[var(--muted)] block">Total Downloads</span>
                <span className="text-base font-bold text-[var(--text)]">{status?.downloads_total ?? 0} files</span>
              </div>
              <div>
                <span className="text-xs text-[var(--muted)] block">Data Transferred</span>
                <span className="text-base font-bold text-[var(--text)]">{status?.bytes_total_human ?? '0 B'}</span>
              </div>
            </div>

            {/* Restart Button */}
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleRestartClick}
                disabled={isRestarting}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[var(--text)] text-slate-900 font-semibold hover:bg-white transition-all disabled:opacity-50"
              >
                <RotateCcw className={`w-4 h-4 ${isRestarting ? 'animate-spin' : ''}`} />
                <span>{isRestarting ? 'Restarting…' : 'Restart File Share'}</span>
              </button>
              <p className="text-xs text-[var(--muted)] mt-2">
                Restarting resets the session and generates a fresh active share timer.
              </p>
            </div>
          </div>
        </div>

        <div className="fs-footer">
          <span className="fs-footer-note">Temporary access · Keep credentials private</span>
          <span className="text-xs text-[var(--muted)]">v4.0.0</span>
        </div>
      </section>
    </main>
  );
};

export default StoppedView;
