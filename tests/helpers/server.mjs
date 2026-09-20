/**
 * Test harness: boots the built production server (dist/server.cjs) on an
 * ephemeral port with an isolated temp SHARE_DIR, so tests never touch the
 * developer's real ./shared_files and can run in parallel.
 *
 * We exercise the *built* artifact deliberately: it validates the esbuild
 * bundle and the `npm start` path, not just the TypeScript sources.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_BUNDLE = path.join(REPO_ROOT, 'dist', 'server.cjs');

/** Reserve a free TCP port by binding to :0 and releasing it. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start a server instance.
 *
 * @param {object} env Extra environment variables (SHARE_EXPIRY, OWNER_SESSION_SECRET, ...)
 * @returns {Promise<{baseUrl, shareDir, password, stop, logs}>}
 */
export async function startServer(env = {}) {
  if (!fs.existsSync(SERVER_BUNDLE)) {
    throw new Error(
      `Missing ${SERVER_BUNDLE}. Run "npm run build" before "npm test".`
    );
  }

  const port = await freePort();
  const shareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smopi-test-'));
  const password = 'test-password-123';

  const child = spawn(process.execPath, [SERVER_BUNDLE], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      SHARE_DIR: shareDir,
      SHARE_PASSWORD: password,
      // Keep AI off: no key => local fallback, no network, no cost.
      GEMINI_API_KEY: '',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  // Wait for the listen banner (or crash).
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server did not start in 15s. Logs:\n${logs.join('')}`)),
      15000
    );
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (code ${code}). Logs:\n${logs.join('')}`));
    });
    const check = setInterval(() => {
      if (logs.join('').includes('Server successfully started')) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });

  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((r) => {
        const t = setTimeout(() => {
          child.kill('SIGKILL');
          r();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(t);
          r();
        });
      });
    }
    fs.rmSync(shareDir, { recursive: true, force: true });
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    shareDir,
    password,
    stop,
    logs: () => logs.join('')
  };
}

/**
 * Minimal cookie-jar fetch wrapper: persists Set-Cookie between calls so tests
 * authenticate the way a browser does (HTTP-only cookie), not via ?token=.
 */
export function makeClient(baseUrl) {
  let cookie = '';
  return async function call(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`${baseUrl}${pathname}`, { ...options, headers, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      if (pair.startsWith('fs_session=')) cookie = pair;
    }
    return res;
  };
}
