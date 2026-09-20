import React, { useState } from 'react';
import { Lock, ArrowRight, ShieldCheck, KeyRound, AlertCircle, Eye, EyeOff, Sparkles } from 'lucide-react';
import type { ShareStatus } from '../types';

interface LoginViewProps {
  password: string;
  setPassword: (password: string) => void;
  handleLogin: (e: React.FormEvent) => void;
  loginError: string;
  isSubmittingLogin: boolean;
  status: ShareStatus | null;
}

export const LoginView: React.FC<LoginViewProps> = ({
  password,
  setPassword,
  handleLogin,
  loginError,
  isSubmittingLogin,
  status
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="page">
      <section className="shell">
        <header className="topbar">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="brand">File Share</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Protected Share</span>
          </div>
        </header>

        <div className="content">
          <section className="auth-card">
            <div className="eyebrow flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-sky-400" />
              <span>TEMPORARY SHARE</span>
            </div>
            <h1>Private file access</h1>
            <p className="muted">
              Enter the share password configured for this workspace to view and download files.
            </p>

            {loginError && (
              <div className="mt-4 p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-sm flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="auth-form">
              <label htmlFor="password" className="flex items-center justify-between text-xs text-[var(--soft)]">
                <span>Password</span>
                {status?.one_time && (
                  <span className="text-amber-400/90 text-[11px]">One-time download link</span>
                )}
              </label>

              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  autoFocus
                  placeholder="Enter share password…"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmittingLogin}
                  className="w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={isSubmittingLogin || !password.trim()}
                className="flex items-center justify-center gap-2 mt-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSubmittingLogin ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span>
                    <span>Verifying…</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Unlock Files</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </button>
            </form>

            {status?.remaining !== null && status?.remaining !== undefined && (
              <div className="mt-5 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>Temporary session · Expires automatically</span>
              </div>
            )}
          </section>
        </div>

        <div className="fs-footer">
          <span className="fs-footer-note">Temporary access · Keep credentials private</span>
          <span className="text-xs text-[var(--muted)]">v4.0.0</span>
        </div>
      </section>
    </main>
  );
};

export default LoginView;
