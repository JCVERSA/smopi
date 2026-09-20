import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { ShareStatus } from '../types';
import { Spine } from './deaddrop/Spine';
import { useCountdown, formatClock } from './deaddrop/useCountdown';

interface LoginViewProps {
  password: string;
  setPassword: (password: string) => void;
  handleLogin: (e: React.FormEvent) => void;
  loginError: string;
  isSubmittingLogin: boolean;
  status: ShareStatus | null;
}

/**
 * The gate.
 *
 * Even before you are let in, the depletion spine is running — the first
 * thing the page communicates is that this drop is on a clock. The headline
 * states the situation plainly rather than describing the product.
 */
export const LoginView: React.FC<LoginViewProps> = ({
  password,
  setPassword,
  handleLogin,
  loginError,
  isSubmittingLogin,
  status
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const { left, infinite, ratio, critical } = useCountdown(status?.remaining);

  return (
    <div className="dd-gate">
      <div>
        <Spine ratio={ratio} infinite={infinite} critical={critical} />
        <header className="dd-head">
          <div className="dd-head__id">
            <span className="dd-mark">Dead Drop</span>
          </div>
          <span className="dd-count">
            {infinite ? 'No expiry set' : `${formatClock(left)} until this drop closes`}
          </span>
        </header>
      </div>

      <div className="dd-gate__center">
        <div className="dd-gate__form">
          <h1 className="dd-gate__title">
            Someone left
            <br />
            files here
            <br />
            for you.
          </h1>
          <p className="dd-gate__sub">
            {status?.one_time
              ? 'This drop closes the moment you finish downloading. Enter the password to open it.'
              : 'Enter the password you were given to open the drop.'}
          </p>

          <form onSubmit={handleLogin} className="dd-field">
            <label htmlFor="password" className="dd-label">
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                name="password"
                className="dd-input"
                style={{ paddingRight: 44 }}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                autoFocus
                placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmittingLogin}
              />
              <button
                type="button"
                className="dd-btn dd-btn--ghost dd-btn--icon"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <button
              type="submit"
              className="dd-btn dd-btn--primary"
              style={{ justifyContent: 'center', marginTop: 8, padding: '11px' }}
              disabled={isSubmittingLogin || !password.trim()}
            >
              {isSubmittingLogin ? 'Checking\u2026' : 'Open the drop'}
            </button>
          </form>

          {loginError && (
            <div className="dd-alert" role="alert">
              {loginError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginView;
