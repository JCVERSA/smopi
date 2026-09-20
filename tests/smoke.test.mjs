/**
 * Smoke / regression suite for the file-share server.
 *
 * Covers the security-critical contract: authentication, authorization,
 * path traversal, CSRF, download integrity, and error-message hygiene.
 *
 * Run with: npm test  (requires `npm run build` first)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { makeClient, startServer } from './helpers/server.mjs';

const json = { 'content-type': 'application/json' };

/** Build a multipart body for the `file` field (multer expects that name). */
function multipart(filename, content) {
  const boundary = '----smopitest' + Math.random().toString(36).slice(2);
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('file share server', () => {
  let server;
  let call;

  before(async () => {
    server = await startServer();
    call = makeClient(server.baseUrl);
  });

  after(async () => {
    await server?.stop();
  });

  describe('authentication', () => {
    it('does not disclose the share password to unauthenticated callers', async () => {
      const res = await fetch(`${server.baseUrl}/api/status`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.authorized, false);
      assert.equal(body.is_owner, false);
      assert.equal(body.share_password, undefined);
    });

    it('rejects protected endpoints without a session', async () => {
      const res = await fetch(`${server.baseUrl}/api/files`);
      assert.equal(res.status, 401);
    });

    it('rejects a wrong password', async () => {
      const res = await call('/api/login', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ password: 'not-the-password' })
      });
      assert.equal(res.status, 401);
    });

    it('accepts the correct password and issues a session cookie', async () => {
      const res = await call('/api/login', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ password: server.password })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.match(body.token, /^[a-f0-9]{48}$/);

      const cookies = res.headers.getSetCookie();
      const session = cookies.find((c) => c.startsWith('fs_session='));
      assert.ok(session, 'expected an fs_session cookie');
      assert.match(session, /HttpOnly/i);
      assert.match(session, /SameSite=Lax/i);
    });

    it('allows access once authenticated', async () => {
      const res = await call('/api/files');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.files, []);
    });
  });

  describe('upload and listing', () => {
    it('uploads a file and reports the server-side category contract', async () => {
      const { body, headers } = multipart('hello.txt', 'hello world\n');
      const res = await call('/api/upload', { method: 'POST', headers, body });
      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.equal(payload.success, true);
      assert.equal(payload.file.name, 'hello.txt');
      assert.equal(payload.file.size, 12);
      // Categories are plural server-side; the client icon map depends on this.
      assert.equal(payload.file.category, 'documents');
    });

    it('lists uploaded files with the SharedFile shape', async () => {
      const res = await call('/api/files');
      const { files } = await res.json();
      const entry = files.find((f) => f.name === 'hello.txt');
      assert.ok(entry, 'uploaded file should be listed');
      for (const key of ['name', 'size', 'size_human', 'mtime', 'type', 'category']) {
        assert.ok(key in entry, `SharedFile is missing "${key}"`);
      }
      assert.ok(['archives', 'images', 'documents', 'other'].includes(entry.category));
    });

    it('writes the upload inside SHARE_DIR', () => {
      assert.ok(fs.existsSync(path.join(server.shareDir, 'hello.txt')));
    });
  });

  describe('download', () => {
    it('serves file contents', async () => {
      const res = await call('/download/hello.txt');
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'hello world\n');
    });

    it('supports HTTP Range requests', async () => {
      const res = await call('/download/hello.txt', { headers: { range: 'bytes=0-4' } });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-range'), 'bytes 0-4/12');
      assert.equal(await res.text(), 'hello');
    });

    it('encodes non-ASCII filenames per RFC 5987', async () => {
      const { body, headers } = multipart('naïve fichier.txt', 'unicode\n');
      await call('/api/upload', { method: 'POST', headers, body });

      const res = await call(`/download/${encodeURIComponent('naïve fichier.txt')}`);
      assert.equal(res.status, 200);
      const cd = res.headers.get('content-disposition');
      // ASCII fallback in filename=, UTF-8 form in filename*=
      assert.match(cd, /filename="[\x20-\x7e]*"/);
      assert.match(cd, /filename\*=UTF-8''na%C3%AFve%20fichier\.txt/);
    });

    it('streams a valid ZIP of all files', async () => {
      const res = await call('/download-all');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/zip');
      const buf = Buffer.from(await res.arrayBuffer());
      // ZIP local file header magic.
      assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304');
      // End-of-central-directory must be present (truncated//broken streams fail here).
      assert.ok(buf.includes(Buffer.from('504b0506', 'hex')), 'missing EOCD record');
      assert.ok(buf.includes(Buffer.from('hello.txt', 'utf8')));
    });
  });

  describe('path traversal', () => {
    const payloads = [
      '/download/..%2f..%2fetc%2fpasswd',
      '/download/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/download/..%5c..%5cwindows%5cwin.ini'
    ];

    for (const p of payloads) {
      it(`rejects ${p}`, async () => {
        const res = await call(p);
        assert.ok(res.status >= 400, `expected 4xx, got ${res.status}`);
        const text = await res.text();
        assert.ok(!text.includes('root:'), 'traversal returned /etc/passwd content');
      });
    }

    it('rejects traversal in the file-content API', async () => {
      const res = await call('/api/files/..%2f..%2fetc%2fpasswd/content');
      assert.ok(res.status >= 400);
    });
  });

  describe('cross-site request protection', () => {
    it('rejects mutating requests from a foreign Origin', async () => {
      const res = await call('/stop-share', {
        method: 'POST',
        headers: { ...json, origin: 'https://evil.example' }
      });
      assert.equal(res.status, 403);
    });

    it('rejects a cross-site fetch declared via Sec-Fetch-Site', async () => {
      const res = await call('/api/files/hello.txt', {
        method: 'DELETE',
        headers: { 'sec-fetch-site': 'cross-site' }
      });
      assert.equal(res.status, 403);
    });

    it('still allows same-origin mutations', async () => {
      const { body, headers } = multipart('same-origin.txt', 'ok\n');
      const res = await call('/api/upload', {
        method: 'POST',
        headers: { ...headers, origin: server.baseUrl },
        body
      });
      assert.equal(res.status, 200);
    });
  });

  describe('error hygiene (regression: internal detail leak)', () => {
    it('does not leak filesystem paths or errno on read failure', async () => {
      const locked = path.join(server.shareDir, 'locked.txt');
      fs.writeFileSync(locked, 'secret\n');
      fs.chmodSync(locked, 0o000);
      try {
        const res = await call('/api/files/locked.txt/content');
        // Root (e.g. in some CI containers) can read regardless of mode.
        if (res.status === 500) {
          const body = await res.json();
          assert.equal(body.error, 'Could not read file');
          assert.ok(!/EACCES|\/tmp\/|errno/i.test(JSON.stringify(body)));
        }
      } finally {
        fs.chmodSync(locked, 0o644);
        fs.rmSync(locked, { force: true });
      }
    });

    it('returns a generic 404 for a missing file rather than a stack trace', async () => {
      const res = await call('/api/files/does-not-exist.txt/content');
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, 'File not found');
    });
  });

  describe('file mutation', () => {
    it('creates, edits, renames and deletes a file', async () => {
      let res = await call('/api/files/create', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'notes.md', content: '# notes\n' })
      });
      assert.equal(res.status, 200);

      res = await call('/api/files/notes.md/content', {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ content: '# updated\n' })
      });
      assert.equal(res.status, 200);

      res = await call('/api/files/notes.md/content');
      assert.equal((await res.json()).content, '# updated\n');

      res = await call('/api/files/notes.md/rename', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ newName: 'renamed.md' })
      });
      assert.equal(res.status, 200);
      assert.ok(fs.existsSync(path.join(server.shareDir, 'renamed.md')));

      res = await call('/api/files/renamed.md', { method: 'DELETE' });
      assert.equal(res.status, 200);
      assert.ok(!fs.existsSync(path.join(server.shareDir, 'renamed.md')));
    });

    it('refuses to overwrite an existing file on create', async () => {
      const res = await call('/api/files/create', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'hello.txt', content: 'clobber' })
      });
      assert.equal(res.status, 409);
      // Original content must survive.
      assert.equal(fs.readFileSync(path.join(server.shareDir, 'hello.txt'), 'utf8'), 'hello world\n');
    });
  });

  describe('logout', () => {
    it('invalidates the session', async () => {
      const logout = await call('/api/logout', { method: 'POST' });
      assert.equal(logout.status, 200);
      // The jar keeps the (now-cleared) cookie; the server must reject it.
      const res = await call('/api/files');
      assert.equal(res.status, 401);
    });
  });
});

describe('share expiry', () => {
  let server;
  let call;

  before(async () => {
    // Expires one second after boot.
    server = await startServer({ SHARE_EXPIRY: '1' });
    call = makeClient(server.baseUrl);
    await call('/api/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: server.password })
    });
  });

  after(async () => {
    await server?.stop();
  });

  it('blocks downloads after the share expires', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await call('/download-all');
    assert.equal(res.status, 403);
    const status = await (await fetch(`${server.baseUrl}/api/status`)).json();
    assert.equal(status.stopped, true);
    assert.equal(status.remaining, 0);
  });
});

describe('owner authorization (OWNER_SESSION_SECRET set)', () => {
  let server;
  let guest;

  before(async () => {
    server = await startServer({ OWNER_SESSION_SECRET: 'owner-secret-xyz' });
    guest = makeClient(server.baseUrl);
    await guest('/api/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: server.password })
    });
  });

  after(async () => {
    await server?.stop();
  });

  it('withholds the share password from a non-owner guest', async () => {
    const body = await (await guest('/api/status')).json();
    assert.equal(body.authorized, true);
    assert.equal(body.is_owner, false);
    assert.equal(body.share_password, undefined);
  });

  it('forbids a guest from stopping the share', async () => {
    const res = await guest('/stop-share', { method: 'POST' });
    assert.equal(res.status, 403);
  });

  it('forbids a guest from restarting the share', async () => {
    const res = await guest('/api/restart', { method: 'POST' });
    assert.equal(res.status, 403);
  });

  it('rejects a bad owner secret', async () => {
    const res = await guest('/api/login-owner', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ secret: 'wrong' })
    });
    assert.equal(res.status, 401);
  });

  it('grants owner rights with the correct secret', async () => {
    const owner = makeClient(server.baseUrl);
    const login = await owner('/api/login-owner', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ secret: 'owner-secret-xyz' })
    });
    assert.equal(login.status, 200);
    const { ownerToken } = await login.json();
    assert.ok(ownerToken);

    const auth = { authorization: `Bearer ${ownerToken}` };
    const status = await (await fetch(`${server.baseUrl}/api/status`, { headers: auth })).json();
    assert.equal(status.is_owner, true);
    assert.equal(status.share_password, server.password);

    const stop = await fetch(`${server.baseUrl}/stop-share`, { method: 'POST', headers: auth });
    assert.equal(stop.status, 200);
  });
});

describe('restart preserves credentials (regression: operator lockout)', () => {
  let server;
  let call;

  before(async () => {
    // No SHARE_PASSWORD => the server generates one; restart must not re-randomize it.
    server = await startServer({ SHARE_PASSWORD: '' });
    call = makeClient(server.baseUrl);
  });

  after(async () => {
    await server?.stop();
  });

  it('keeps the generated password across a restart', async () => {
    const generated = /Password  : (\S+)/.exec(server.logs())?.[1];
    assert.ok(generated, 'could not read the generated password from the boot banner');

    const login = await call('/api/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: generated })
    });
    assert.equal(login.status, 200);

    const restart = await call('/api/restart', { method: 'POST' });
    assert.equal(restart.status, 200);
    assert.equal((await restart.json()).share_password, generated);

    // The same credential must still work afterwards.
    const relogin = await makeClient(server.baseUrl)('/api/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: generated })
    });
    assert.equal(relogin.status, 200);
  });
});

describe('download auth channels', () => {
  let server;
  let token;

  before(async () => {
    server = await startServer();
    const res = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: server.password })
    });
    token = (await res.json()).token;

    const { body, headers } = multipart('auth-probe.txt', 'probe\n');
    await fetch(`${server.baseUrl}/api/upload`, {
      method: 'POST',
      headers: { ...headers, authorization: `Bearer ${token}` },
      body
    });
  });

  after(async () => {
    await server?.stop();
  });

  it('authorizes a download via the Authorization header alone (no ?token=)', async () => {
    const res = await fetch(`${server.baseUrl}/download/auth-probe.txt`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'probe\n');
  });

  it('still accepts ?token= for plain <a href> navigations (iframe fallback)', async () => {
    const res = await fetch(
      `${server.baseUrl}/download/auth-probe.txt?token=${encodeURIComponent(token)}`
    );
    assert.equal(res.status, 200);
  });

  it('rejects a bogus ?token=', async () => {
    const res = await fetch(`${server.baseUrl}/download/auth-probe.txt?token=deadbeef`);
    assert.equal(res.status, 401);
  });
});
