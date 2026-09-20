import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
dotenv.config();
import { ZipArchive } from 'archiver';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { runSmopiAgent, executeSmopiTool, sanitizeFileName, resolveSafePath } from './server/smopi';

const app = express();
app.set('trust proxy', 1);
const PORT = Math.max(1, Math.min(65535, parseInt(process.env.PORT || '') || 3000));
// SHARE_DIR override allows deployments and automated tests to relocate the
// backing directory; the default is ./shared_files relative to the process cwd.
const SHARE_DIR = process.env.SHARE_DIR
  ? path.resolve(process.env.SHARE_DIR)
  : path.resolve(process.cwd(), 'shared_files');

// Ensure the shared directory exists
if (!fs.existsSync(SHARE_DIR)) {
  fs.mkdirSync(SHARE_DIR, { recursive: true });
}

// Recover UTF-8 filenames from multipart uploads: browsers send the filename
// as raw UTF-8 bytes, which busboy/multer surface as a latin1 string
// (e.g. "caf\u00c3\u00a9" instead of "caf\u00e9"). Round-tripping latin1 -> bytes
// -> utf8 restores the correct name; fall back to the raw name if the result
// contains U+FFFD (i.e. the original bytes were not valid UTF-8).
function decodeMultipartName(name: string): string {
  try {
    const repaired = Buffer.from(name, 'latin1').toString('utf8');
    if (repaired.includes('\uFFFD') && !name.includes('\uFFFD')) {
      return name;
    }
    return repaired;
  } catch {
    return name;
  }
}

// Multer storage configuration for saving uploaded files with security hardening
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, SHARE_DIR);
  },
  filename: (_req, file, cb) => {
    // Strip directory structures to avoid traversal
    let sanitized = path.basename(decodeMultipartName(file.originalname)).trim();
    // Forbid hidden files starting with .
    if (sanitized.startsWith('.')) {
      sanitized = sanitized.replace(/^\.+/, '') || 'upload.bin';
    }
    // Strip control characters
    sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');
    if (!sanitized) {
      sanitized = `upload_${Date.now()}.bin`;
    }

    // Collision avoidance: append (1), (2), etc. if a file with the same name exists (capped at 1000)
    let candidate = sanitized;
    let counter = 1;
    const ext = path.extname(sanitized);
    const base = path.basename(sanitized, ext);

    while (fs.existsSync(path.join(SHARE_DIR, candidate)) && counter <= 1000) {
      candidate = `${base} (${counter})${ext}`;
      counter++;
    }

    // Ensure uniqueness even under concurrent uploads (name check is not atomic).
    if (fs.existsSync(path.join(SHARE_DIR, candidate))) {
      candidate = `${base}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
    }

    cb(null, candidate);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB max per uploaded file
    files: 1
  }
});


// In-memory state
const state = {
  password: '',
  expiresAt: null as number | null,
  stopped: false,
  stopReason: '',
  downloadsTotal: 0,
  bytesTotal: 0,
  activeDownloads: 0,
  oneTime: false,
  expiresInSec: 30 * 60, // default 30 minutes
  ownerToken: '',
  ownerSessions: new Map<string, number>(),
  smopiTimestamps: {} as Record<string, number[]>,
};

interface SessionRecord {
  createdAt: number;
  expiresAt: number;
}
const sessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours TTL

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, data] of sessions.entries()) {
    if (now >= data.expiresAt) {
      sessions.delete(token);
    }
  }
}

const loginAttempts: Record<string, number[]> = {};
const OWNER_RATE_LIMIT = 3; // generous: the owner only logs in once per deploy
const OWNER_RATE_WINDOW_SEC = 60;
const SMOPI_WINDOW_MS = 60 * 1000;
const SMOPI_MAX_REQUESTS_PER_WINDOW = 20;

// Safe human-readable byte sizes
function humanSize(size: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return unit === "B" ? `${value.toFixed(0)} ${unit}` : `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${size} B`;
}

// Map extensions to MIME types
function getMimeType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const mimes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.xml': 'application/xml',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.rar': 'application/vnd.rar',
  };
  return mimes[ext] || 'application/octet-stream';
}

// Assign category based on file suffix/mime
function categoryFor(name: string, mime: string): string {
  const ext = path.extname(name).toLowerCase();
  if ([".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz2"].includes(ext)) {
    return "archives";
  }
  if (mime.startsWith("image/") || [".svg", ".ico"].includes(ext)) {
    return "images";
  }
  if (mime.startsWith("text/") || ["application/json", "application/xml", "application/pdf"].includes(mime) || [".md", ".csv", ".log", ".yaml", ".yml", ".toml"].includes(ext)) {
    return "documents";
  }
  return "other";
}

// Return formatted type name or extension
function fileType(name: string): string {
  const mime = getMimeType(name);
  if (mime !== 'application/octet-stream') {
    return mime;
  }
  const ext = path.extname(name).toLowerCase().slice(1);
  return ext ? ext.toUpperCase() : "FILE";
}

// Extensions that are safe to render inline in the browser (non-executable image formats).
function isInlineImageExt(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico'].includes(ext);
}

// Build a Content-Disposition header with an ASCII fallback filename plus an
// RFC 5987 filename* parameter for non-ASCII names (mirrors the Python origin).
function contentDisposition(filename: string): string {
  const clean = filename.replace(/[\r\n]/g, '');
  const asciiFallback = clean.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '') || 'download';
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

// Scan directory for regular files (ignores folders, links, dots, path traversal)
async function getRegularFiles(rootDir: string) {
  const result: any[] = [];
  try {
    const entries = await fs.promises.readdir(rootDir);
    // Sort case-insensitively
    entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    for (const name of entries) {
      if (name.startsWith('.')) continue; // ignore hidden system files
      const fullPath = path.join(rootDir, name);
      try {
        const stat = await fs.promises.lstat(fullPath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          continue;
        }
        const mime = getMimeType(name);
        const mtimeDate = stat.mtime;
        const formattedMtime = mtimeDate.toISOString().replace('T', ' ').substring(0, 16);
        result.push({
          name,
          size: stat.size,
          size_human: humanSize(stat.size),
          mtime: formattedMtime,
          type: fileType(name),
          category: categoryFor(name, mime),
        });
      } catch {
        continue;
      }
    }
  } catch (err) {
    console.error("Error reading shared directory:", err);
  }
  return result;
}

// Secure safe-path resolve for downloads (strictly avoids directory traversal / symlinks)
function safeChild(rootDir: string, name: string): string | null {
  if (!name || name === '.' || name === '..' || name.length > 255) {
    return null;
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return null;
  }
  const candidate = path.normalize(path.join(rootDir, name));
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  try {
    const stat = fs.lstatSync(resolvedCandidate);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return null;
    }
    return resolvedCandidate;
  } catch {
    return null;
  }
}

// Login rate limiter: 5 attempts per IP per minute with memory cleanup
function allowLoginAttempt(ip: string): { allowed: boolean; waitSec: number } {
  const now = Date.now();
  const windowMs = 60 * 1000;

  // Evict empty or expired IP records to prevent memory leak
  for (const [key, timestamps] of Object.entries(loginAttempts)) {
    const valid = timestamps.filter(t => now - t < windowMs);
    if (valid.length === 0) {
      delete loginAttempts[key];
    } else {
      loginAttempts[key] = valid;
    }
  }

  if (!loginAttempts[ip]) {
    loginAttempts[ip] = [];
  }
  if (loginAttempts[ip].length >= 5) {
    const oldest = loginAttempts[ip][0];
    const waitSec = Math.ceil((windowMs - (now - oldest)) / 1000);
    return { allowed: false, waitSec: Math.max(1, waitSec) };
  }
  loginAttempts[ip].push(now);
  return { allowed: true, waitSec: 0 };
}

// Initialize active state with environment variables or secure random fallback
function initializeState() {
  try {
    dotenv.config({ override: true });
  } catch (_) {
    // ignore
  }

  // Primary: Check SHARE_PASSWORD or PASSWORD environment variable
  const envPassword = (process.env.SHARE_PASSWORD || process.env.PASSWORD || '').trim();
  // Preserve a previously generated password across restarts so the share link
  // stays valid (do not silently re-randomize and lock the operator out).
  const keptExistingPassword = !envPassword && Boolean(state.password);
  let sharePassword = envPassword || state.password || crypto.randomBytes(6).toString('hex');
  const isFromEnv = Boolean(envPassword);

  const expiresSec = process.env.SHARE_EXPIRY ? parseInt(process.env.SHARE_EXPIRY) : 30 * 60; // 30 minutes default
  const oneTime = process.env.SHARE_ONE_TIME === 'true' || false;

  state.password = sharePassword;
  state.expiresAt = expiresSec > 0 ? Date.now() + expiresSec * 1000 : null;
  state.stopped = false;
  state.stopReason = '';
  state.downloadsTotal = 0;
  state.bytesTotal = 0;
  state.activeDownloads = 0;
  state.oneTime = oneTime;
  state.expiresInSec = expiresSec;
  state.ownerToken = (process.env.OWNER_TOKEN || '').trim() || state.ownerToken || crypto.randomBytes(24).toString('hex');
  state.ownerSessions.clear();
  state.smopiTimestamps = {};

  console.log("\n" + "=".repeat(72));
  console.log(`  TEMPORARY FILE SHARE SERVER (Node/Express)`);
  console.log("=".repeat(72));
  console.log(`  Directory : ${SHARE_DIR}`);
  console.log(`  Password  : ${sharePassword} (${isFromEnv ? 'from SHARE_PASSWORD env' : keptExistingPassword ? 'kept from previous session' : 'generated'})`);
  console.log(`  Owner acc.: token at /api/login-owner`);
  console.log(`  Lifetime  : ${expiresSec > 0 ? expiresSec + 's' : 'disabled'}`);
  console.log(`  One-time  : ${oneTime ? 'YES' : 'NO'}`);
  console.log("=".repeat(72) + "\n");
}

function isExpired(): boolean {
  if (state.stopped) return true;
  if (state.expiresAt && Date.now() >= state.expiresAt) {
    state.stopped = true;
    state.stopReason = 'expired';
    return true;
  }
  return false;
}

function remainingSeconds(): number | null {
  if (state.stopped) return 0;
  if (!state.expiresAt) return null;
  return Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000));
}

// Apply middlewares
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Same-origin guard for mutating methods: reject cross-site requests when the
// browser supplies an Origin or Sec-Fetch-Site header that does not match the
// request's host. This blocks CSRF regardless of future cookie attribute changes.
function sameOriginGuard(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const secFetchSite = req.headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string' && (secFetchSite === 'same-origin' || secFetchSite === 'same-site')) {
    next();
    return;
  }

  // Requests that authenticate explicitly (Bearer / query token, e.g. the
  // embedded preview) do not rely on the ambient cookie, so cross-site origin
  // is acceptable.
  const hasExplicitAuth = Boolean(
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) ||
    (typeof req.query?.token === 'string' && req.query.token.length > 0)
  );
  if (hasExplicitAuth) {
    next();
    return;
  }

  // Hostnames this request may legitimately be addressed at (proxies can keep
  // the public host in Host or forward it via X-Forwarded-Host).
  const allowedHostnames = new Set<string>();
  for (const header of [req.headers.host, req.headers['x-forwarded-host']]) {
    if (typeof header !== 'string' || !header) continue;
    for (const part of header.split(',')) {
      const hostname = part.trim().split(':')[0].toLowerCase();
      if (hostname) allowedHostnames.add(hostname);
    }
  }

  // Compare the Origin's hostname only: behind the TLS-terminating preview
  // proxy the request arrives over http while the browser Origin is https,
  // so a scheme-sensitive comparison would false-positive.
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) {
    let originHostname: string | null = null;
    try {
      originHostname = new URL(origin).hostname.toLowerCase();
    } catch {
      originHostname = null;
    }
    if (originHostname && !allowedHostnames.has(originHostname)) {
      console.warn(`Rejected cross-site ${method} request (origin host: ${originHostname})`);
      res.status(403).json({ error: 'Cross-site request rejected' });
      return;
    }
    next();
    return;
  }

  // No Origin, but the browser explicitly declared a cross-site fetch.
  if (typeof secFetchSite === 'string' && secFetchSite === 'cross-site') {
    console.warn(`Rejected cross-site ${method} request (sec-fetch-site: cross-site)`);
    res.status(403).json({ error: 'Cross-site request rejected' });
    return;
  }

  next();
}
app.use(sameOriginGuard);

// Minimal access logger that never records session tokens (avoids leaking
// bearer/query credentials into stdout/log aggregation).
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(express.json());
app.use(cookieParser());

// Initialize share configurations
initializeState();

// Resolve the session token(s) presented on a request (cookie, bearer, or query).
function presentedTokens(req: express.Request): string[] {
  const tokens: string[] = [];
  const cookieToken = req.cookies?.fs_session;
  if (typeof cookieToken === 'string' && cookieToken) tokens.push(cookieToken);
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.substring(7).trim();
    if (bearerToken) tokens.push(bearerToken);
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken) tokens.push(queryToken);
  return tokens;
}

// Whether the request presents a valid, non-expired owner session token.
function ownerSessionValid(req: express.Request): boolean {
  const now = Date.now();
  return presentedTokens(req).some((token) => {
    const expiresAt = state.ownerSessions.get(token);
    if (expiresAt === undefined) return false;
    if (now >= expiresAt) {
      state.ownerSessions.delete(token);
      return false;
    }
    return true;
  });
}

// Check if cookies, Authorization header, or query token has a valid, non-expired
// session. An owner session is a superset of an authenticated session.
function isSessionValid(req: express.Request): boolean {
  if (ownerSessionValid(req)) return true;
  pruneExpiredSessions();
  const now = Date.now();

  return presentedTokens(req).some((token) => {
    const session = sessions.get(token);
    if (!session) return false;
    if (now >= session.expiresAt) {
      sessions.delete(token);
      return false;
    }
    return true;
  });
}

// Whether the current request is authenticated as the share owner (host).
//
// When OWNER_SESSION_SECRET is unset, the server runs in single-admin mode:
// anyone holding the share password is the owner (identical to the original
// behavior). When set, owner rights are limited to sessions established via
// POST /api/login-owner.
function isOwner(req: express.Request): boolean {
  if (!(process.env.OWNER_SESSION_SECRET || '').trim()) {
    return isSessionValid(req);
  }
  return ownerSessionValid(req);
}

// Owner login (optional credential gate; disabled when OWNER_SESSION_SECRET is unset).
app.post('/api/login-owner', (req, res) => {
  const ip = req.ip || 'unknown';
  const secretEnv = (process.env.OWNER_SESSION_SECRET || '').trim();
  if (!secretEnv) {
    return res.status(404).json({ error: 'Owner login is disabled' });
  }

  // Owner gate: 3 attempts per minute per IP, tracked separately from the
  // general login limiter.
  const now = Date.now();
  const windowStart = now - OWNER_RATE_WINDOW_SEC * 1000;
  if (Array.isArray(loginAttempts[`owner:${ip}`]) && loginAttempts[`owner:${ip}`].filter((t) => t > windowStart).length >= OWNER_RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many owner login attempts. Please wait a minute.' });
  }

  const untyped = req.body;
  const provided = (untyped && (typeof untyped.secret === 'string' ? untyped.secret : (typeof untyped.password === 'string' ? untyped.password : ''))) || '';
  const providedBuf = Buffer.from(provided);
  const secretBuf = Buffer.from(secretEnv);
  const isMatch = providedBuf.length === secretBuf.length && crypto.timingSafeEqual(providedBuf, secretBuf);

  if (!isMatch) {
    if (!loginAttempts[`owner:${ip}`]) loginAttempts[`owner:${ip}`] = [];
    loginAttempts[`owner:${ip}`].push(now);
    return res.status(401).json({ error: 'Owner credential was not accepted.' });
  }

  // Success: clear owner attempts only (not the general login limiter).
  delete loginAttempts[`owner:${ip}`];

  const token = crypto.randomBytes(32).toString('hex');
  state.ownerSessions.set(token, now + 12 * 60 * 60 * 1000); // 12h owner session
  res.json({ success: true, ownerToken: token });
});

// API: Get current metrics & lifetime status
app.get('/api/status', (req, res) => {
  // Update expired states lazily
  isExpired();

  // Determine if authorized (and whether the caller is the share owner)
  const authorized = isSessionValid(req);
  const owner = authorized && isOwner(req);

  res.json({
    active_downloads: state.activeDownloads,
    bytes_total: state.bytesTotal,
    bytes_total_human: humanSize(state.bytesTotal),
    downloads_total: state.downloadsTotal,
    one_time: state.oneTime,
    remaining: remainingSeconds(),
    stopped: state.stopped,
    stop_reason: state.stopReason,
    authorized,
    is_owner: owner,
    // Disclose the share password only to the share owner (host).
    share_password: owner ? state.password : undefined
  });
});

// API: File Upload Endpoint with Multer Error Handling & Authentication
app.post('/api/upload', (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }

  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File exceeds the maximum upload limit of 500 MB.' });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      success: true,
      file: {
        name: req.file.filename,
        size: req.file.size,
        size_human: humanSize(req.file.size),
        mtime: new Date().toISOString().replace('T', ' ').substring(0, 16),
        type: fileType(req.file.filename),
        category: categoryFor(req.file.filename, getMimeType(req.file.filename))
      }
    });
  });
});

// API: File Preview Endpoint
app.get('/api/preview/:filename', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { filename } = req.params;
  const filePath = safeChild(SHARE_DIR, filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const stat = await fs.promises.stat(filePath);
    const size = stat.size;
    const mime = getMimeType(filename);

    if (mime.startsWith('image/')) {
      const activeToken = req.cookies?.fs_session || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7).trim() : '');
      const tokenParam = activeToken ? `?token=${encodeURIComponent(activeToken)}` : '';
      const isInline = mime === 'image/svg+xml';
      return res.json({ type: 'image', url: `/download/${encodeURIComponent(filename)}${tokenParam}`, svg: isInline });
    }

    const ext = path.extname(filename).toLowerCase();
    const isText = mime.startsWith('text/') || 
                   ['.json', '.xml', '.js', '.ts', '.tsx', '.jsx', '.py', '.sh', '.yaml', '.yml', '.toml', '.ini', '.csv', '.md'].includes(ext);

    if (isText) {
      if (size > 2 * 1024 * 1024) { // limit preview reading to 2MB to keep it blazing fast
        return res.json({ type: 'text', content: 'This file is too large to preview directly in the browser (max 2MB).' });
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return res.json({ type: 'text', content });
    }

    return res.json({ type: 'unsupported', message: 'No browser preview is available for this file type.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read file content' });
  }
});

// API: Login verification
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const { allowed, waitSec } = allowLoginAttempt(ip);

  if (!allowed) {
    return res.status(429).json({ error: `Too many attempts. Please wait ${waitSec} seconds.` });
  }

  const { password } = req.body || {};
  const userPassBuf = Buffer.from(typeof password === 'string' ? password : '');
  const actualPassBuf = Buffer.from(state.password);

  const isPasswordMatch = userPassBuf.length === actualPassBuf.length &&
    crypto.timingSafeEqual(userPassBuf, actualPassBuf);

  if (isPasswordMatch) {
    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    // Cap session lifetime so it does not outlive the share itself.
    const remainingMs = state.expiresAt ? Math.max(60_000, state.expiresAt - now) : SESSION_TTL_MS;
    const ttlMs = Math.min(SESSION_TTL_MS, remainingMs);
    sessions.set(token, {
      createdAt: now,
      expiresAt: now + ttlMs
    });

    // Set cookie with SameSite: 'lax' for broader compatibility
    res.cookie('fs_session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS
    });

    return res.json({ success: true, token });
  }

  return res.status(401).json({ error: 'The password is incorrect.' });
});

// API: End session / Logout
app.post('/api/logout', (req, res) => {
  const cookieToken = req.cookies?.fs_session;
  if (cookieToken) {
    sessions.delete(cookieToken);
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.substring(7).trim();
    if (bearerToken) {
      sessions.delete(bearerToken);
    }
  }
  const queryToken = req.query?.token;
  if (queryToken && typeof queryToken === 'string') {
    sessions.delete(queryToken);
  }
  res.clearCookie('fs_session');
  res.json({ success: true });
});

// API: Get listed files (Requires valid session)
app.get('/api/files', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired', files: [] });
  }
  const filesList = await getRegularFiles(SHARE_DIR);
  res.json({ files: filesList });
});

// API: Bulk delete files
app.post('/api/files/bulk-delete', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }
  const { names } = req.body;
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'No files specified' });
  }
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const name of names) {
    const filePath = safeChild(SHARE_DIR, name);
    if (!filePath || !fs.existsSync(filePath)) {
      errors.push(`File not found: ${name}`);
      continue;
    }
    try {
      await fs.promises.unlink(filePath);
      deleted.push(name);
    } catch (err) {
      console.error(`Bulk delete failed for "${name}":`, err);
      errors.push(`Failed to delete ${name}`);
    }
  }

  res.json({ success: true, deleted, errors });
});

// API: Delete single file
app.delete('/api/files/:name', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }
  const { name } = req.params;
  const filePath = safeChild(SHARE_DIR, name);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  try {
    await fs.promises.unlink(filePath);
    res.json({ success: true, deleted: name });
  } catch (err) {
    console.error(`Delete failed for "${name}":`, err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// API: Smopi AI status
app.get('/api/smopi/status', (_req, res) => {
  const hasKey = Boolean((process.env.GEMINI_API_KEY || '').trim());
  res.json({
    hasApiKey: hasKey,
    agentName: 'Smopi',
    model: hasKey ? 'gemini-3.8-flash' : 'local-smopi-engine',
    capabilities: [
      'File creation & markdown writing',
      'File modification & editing',
      'Intelligent organization & renaming',
      'Batch deletion & cleanup',
      'Workspace indexing & catalog generation',
      'Document summarization & synthesis'
    ]
  });
});

// Per-IP rate limiter for the Smopi agent (protects the Gemini API budget).
function allowSmopi(ip: string): boolean {
  const now = Date.now();
  for (const [key, timestamps] of Object.entries(state.smopiTimestamps)) {
    const valid = timestamps.filter((t) => now - t < SMOPI_WINDOW_MS);
    if (valid.length === 0) {
      delete state.smopiTimestamps[key];
    } else {
      state.smopiTimestamps[key] = valid;
    }
  }
  if (!state.smopiTimestamps[ip]) {
    state.smopiTimestamps[ip] = [];
  }
  if (state.smopiTimestamps[ip].length >= SMOPI_MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  state.smopiTimestamps[ip].push(now);
  return true;
}

// API: Smopi AI Chat / Action Loop
app.post('/api/smopi/chat', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }
  if (!allowSmopi(req.ip || 'unknown')) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many AI requests. Please wait a minute.' });
  }
  const { message, history } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const result = await runSmopiAgent(message, SHARE_DIR, history || []);
    res.json(result);
  } catch (err: any) {
    console.error('Smopi chat route error:', err);
    res.status(500).json({ error: 'Smopi failed to process request' });
  }
});

// API: Smopi Quick Action (generate_index, standardize_names)
app.post('/api/smopi/quick-action', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }
  const { action } = req.body;
  const actionsTaken: any[] = [];
  const toolResult = executeSmopiTool('organize_workspace', { operation: action }, SHARE_DIR, actionsTaken);
  
  if (toolResult.error) {
    return res.status(400).json({ error: toolResult.error });
  }

  res.json({
    success: true,
    result: toolResult.result,
    actionsTaken
  });
});

// API: Read file text content
app.get('/api/files/:name/content', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { name } = req.params;
  const filePath = safeChild(SHARE_DIR, name);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'File is too large to preview directly (> 2MB)' });
    }
    const content = await fs.promises.readFile(filePath, 'utf8');
    res.json({ success: true, name, content, size: stat.size });
  } catch (err) {
    console.error(`Read file failed for "${name}":`, err);
    res.status(500).json({ error: 'Could not read file' });
  }
});

// API: Update/modify file text content
app.put('/api/files/:name/content', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }
  const { name } = req.params;
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Content must be a string' });
  }
  const filePath = safeChild(SHARE_DIR, name);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    res.json({ success: true, name, size: Buffer.byteLength(content, 'utf8') });
  } catch (err) {
    console.error(`Save file failed for "${name}":`, err);
    res.status(500).json({ error: 'Could not save file' });
  }
});

// API: Create new file directly
app.post('/api/files/create', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }
  const { name, content } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Filename is required' });
  }
  const sanitized = sanitizeFileName(name);
  const filePath = resolveSafePath(SHARE_DIR, sanitized);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  if (fs.existsSync(filePath)) {
    return res.status(409).json({ error: `File "${sanitized}" already exists` });
  }
  try {
    await fs.promises.writeFile(filePath, content || '', 'utf8');
    res.json({ success: true, name: sanitized, size: Buffer.byteLength(content || '', 'utf8') });
  } catch (err) {
    console.error(`Create file failed for "${sanitized}":`, err);
    res.status(500).json({ error: 'Could not create file' });
  }
});

// API: Rename file directly
app.post('/api/files/:name/rename', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isExpired()) {
    return res.status(403).json({ error: 'Share expired' });
  }
  const { name } = req.params;
  const { newName } = req.body;
  if (!newName || typeof newName !== 'string') {
    return res.status(400).json({ error: 'New name is required' });
  }
  const oldPath = safeChild(SHARE_DIR, name);
  if (!oldPath || !fs.existsSync(oldPath)) {
    return res.status(404).json({ error: 'Original file not found' });
  }
  const sanitizedNew = sanitizeFileName(newName);
  const newPath = resolveSafePath(SHARE_DIR, sanitizedNew);
  if (!newPath) {
    return res.status(400).json({ error: 'Invalid new filename' });
  }
  if (fs.existsSync(newPath) && oldPath !== newPath) {
    return res.status(409).json({ error: `Target file "${sanitizedNew}" already exists` });
  }
  try {
    await fs.promises.rename(oldPath, newPath);
    res.json({ success: true, oldName: name, newName: sanitizedNew });
  } catch (err) {
    console.error(`Rename failed for "${name}" -> "${sanitizedNew}":`, err);
    res.status(500).json({ error: 'Could not rename file' });
  }
});

// API: Download selected files as zip
app.post('/api/download-selected', (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).send('Unauthorized');
  }
  if (isExpired()) {
    return res.status(403).send('Share expired');
  }

  const { names } = req.body;
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).send('No files specified');
  }

  const validFiles: { name: string; path: string }[] = [];
  for (const name of names) {
    const filePath = safeChild(SHARE_DIR, name);
    if (filePath && fs.existsSync(filePath)) {
      validFiles.push({ name, path: filePath });
    }
  }

  if (validFiles.length === 0) {
    return res.status(404).send('None of the requested files were found');
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('selected_files.zip'));
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const archive = new ZipArchive({ store: true });
  archive.on('error', (err: any) => {
    console.error('ZIP archiver error:', err);
    if (!res.headersSent) {
      res.status(500).send('Archiving error');
    }
  });
  archive.on('warning', (err: any) => {
    if (err && err.code === 'ENOENT') {
      console.warn('ZIP archiver warning (file vanished):', err.message);
    } else {
      archive.emit('error', err);
    }
  });

  state.activeDownloads++;
  let sentBytes = 0;
  let activeDecremented = false;
  const cleanupActive = () => {
    if (!activeDecremented) {
      activeDecremented = true;
      state.activeDownloads = Math.max(0, state.activeDownloads - 1);
    }
  };

  res.on('close', cleanupActive);

  archive.on('data', (chunk: any) => {
    sentBytes += chunk.length;
  });
  archive.on('end', () => {
    cleanupActive();
    state.downloadsTotal++;
    state.bytesTotal += sentBytes;
  });

  archive.pipe(res);

  for (const file of validFiles) {
    archive.file(file.path, { name: file.name });
  }

  archive.finalize();
});

// API: Manually terminate share
app.post('/stop-share', (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!isOwner(req)) {
    return res.status(403).json({ error: 'Only the share owner can stop the share.' });
  }
  state.stopped = true;
  state.stopReason = 'stopped from dashboard';
  sessions.clear(); // revoke all sessions
  res.json({ success: true });
});

// API: Full server restart/refresh (Requires owner session)
app.post('/api/restart', (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!isOwner(req)) {
    return res.status(403).json({ error: 'Only the share owner can restart the share.' });
  }
  initializeState();
  res.json({ success: true, share_password: state.password, ownerToken: state.ownerToken });
});

// API: Single File download streaming with Range support
app.get('/download/:name', (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).send('Unauthorized');
  }
  if (isExpired()) {
    return res.status(403).send('Share expired');
  }

  const filename = req.params.name;
  const fullPath = safeChild(SHARE_DIR, filename);
  if (!fullPath) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(fullPath);
  const size = stat.size;
  const mime = getMimeType(filename);

  // Guard against serving active content (SVG/HTML/XML/JS/CSS/JSON) with a
  // browser-executable content type — force it to a neutral binary download.
  const forcedDownload = !isInlineImageExt(filename) && mime !== 'application/octet-stream';
  const contentType = forcedDownload ? 'application/octet-stream' : mime;

  let start = 0;
  let end = size - 1;
  let isRange = false;

  // Range parsing (only when NOT in one-time download mode)
  const rangeHeader = req.headers.range;
  if (rangeHeader && !state.oneTime) {
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const partialStart = parts[0];
    const partialEnd = parts[1];

    const parsedStart = parseInt(partialStart, 10);
    const parsedEnd = parseInt(partialEnd, 10);

    if (!isNaN(parsedStart)) {
      start = parsedStart;
    }
    if (!isNaN(parsedEnd)) {
      end = parsedEnd;
    } else {
      end = size - 1;
    }

    if (start >= size || end >= size || start > end) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).send('Requested Range Not Satisfiable');
    }
    isRange = true;
  }

  const chunksize = (end - start) + 1;
  state.activeDownloads++;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Accept-Ranges', state.oneTime ? 'none' : 'bytes');

  if (isRange) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.status(206);
  } else {
    res.setHeader('Content-Length', chunksize);
    res.status(200);
  }

  const stream = fs.createReadStream(fullPath, { start, end });
  let sentBytes = 0;
  let activeDecremented = false;
  const cleanupActive = () => {
    if (!activeDecremented) {
      activeDecremented = true;
      state.activeDownloads = Math.max(0, state.activeDownloads - 1);
    }
  };

  res.on('close', cleanupActive);

  stream.on('data', (chunk) => {
    sentBytes += chunk.length;
  });

  stream.on('end', () => {
    cleanupActive();
    
    // Check if fully and successfully completed
    if (start === 0 && end === size - 1 && sentBytes === chunksize) {
      state.downloadsTotal++;
      state.bytesTotal += sentBytes;
      if (state.oneTime) {
        state.stopped = true;
        state.stopReason = 'one-time download completed';
        sessions.clear();
      }
    } else {
      state.bytesTotal += sentBytes;
    }
  });

  stream.on('close', () => {
    // Fallback in case 'end' never fired (client abort mid-stream)
    cleanupActive();
  });

  stream.on('error', (err) => {
    console.error('Download stream error:', err);
    cleanupActive();
  });

  stream.pipe(res);
});

// API: ZIP archive bundling & streaming on the fly
app.get('/download-all', async (req, res) => {
  if (!isSessionValid(req)) {
    return res.status(401).send('Unauthorized');
  }
  if (isExpired()) {
    return res.status(403).send('Share expired');
  }

  const filesList = await getRegularFiles(SHARE_DIR);
  if (filesList.length === 0) {
    return res.status(404).send('No files to bundle');
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('files.zip'));
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Fast archiving without CPU compression load (ZIP_STORED)
  const archive = new ZipArchive({ store: true });

  archive.on('error', (err: any) => {
    console.error('ZIP archiver error:', err);
    if (!res.headersSent) {
      res.status(500).send('Archiving error');
    }
  });
  archive.on('warning', (err: any) => {
    if (err && err.code === 'ENOENT') {
      console.warn('ZIP archiver warning (file vanished):', err.message);
    } else {
      archive.emit('error', err);
    }
  });

  state.activeDownloads++;

  let sentBytes = 0;
  let activeDecremented = false;
  const cleanupActive = () => {
    if (!activeDecremented) {
      activeDecremented = true;
      state.activeDownloads = Math.max(0, state.activeDownloads - 1);
    }
  };

  res.on('close', cleanupActive);

  archive.on('data', (chunk: any) => {
    sentBytes += chunk.length;
  });

  archive.on('end', () => {
    cleanupActive();
    state.downloadsTotal++;
    state.bytesTotal += sentBytes;

    if (state.oneTime) {
      state.stopped = true;
      state.stopReason = 'one-time download completed';
      sessions.clear();
    }
  });

  archive.pipe(res);

  for (const item of filesList) {
    const filePath = safeChild(SHARE_DIR, item.name);
    if (filePath) {
      archive.file(filePath, { name: item.name });
    }
  }

  archive.finalize();
});


// FRONTEND ASSET SERVING & VITE INTEGRATION
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Vite Dev Mode Middleware setup
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production compiled static assets
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully started on port ${PORT}`);
  });
}

startServer();
