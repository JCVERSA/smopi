# File Share (Node/Express + React) — Audit Report

**Branch:** `arena/01a0b7f8-file` · **Base commit:** `94900ec` · **Date:** 2026-09-19
**Scope reviewed:** `server.ts`, `server/smopi.ts`, `src/**`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `.gitignore`, `cloned/` (reference upstream). 33 source files.

---

# Project Overview

A temporary, password-protected file-sharing server. Two independent implementations coexist in this repo:

1. **Active product (Node/Express + React 19 + Vite + Tailwind 4).** Express serves a JSON API and (in dev) a Vite middleware; `server/smopi.ts` adds a "Smopi" AI file-management agent backed by Gemini (`@google/genai`) with a local command fallback.
2. **Reference upstream (`cloned/`).** A Python stdlib implementation (`server.py`, v3.5.1) with Cloudflare Quick Tunnel support. It is read-only reference material and is **not** wired into the Node app.

The React dashboard exposes a rich UI (upload, preview, edit, bulk ops, physics vault, AI chat) far beyond the Python original.

## Architecture (data flow)

```
Browser (React SPA)
  ├─ auth: sessionStorage token + HTTP-only cookie "fs_session"
  ▼
Express server.ts (port 3000, trust proxy 1)
  ├─ Auth  : /api/login, /api/logout, sessions Map, loginAttempts limiter
  ├─ Files : /api/files, /api/upload, /api/preview, content CRUD, bulk-delete
  ├─ Export: /download/:name (Range), /download-all, /download-selected (archiver)
  ├─ AI    : /api/smopi/*, /api/quick-action  ──► server/smopi.ts ──► Gemini (or local fallback)
  └─ State : in-memory (password, expiry, one-time, counters)
  ▼
Filesystem: ./shared_files (flat dir, symlinks excluded)
```

- **Persistence:** none — `shared_files` directory plus in-memory session/state. Restart re-seeds everything.
- **Trust boundary:** the client password is the single credential; there is no host-vs-guest role separation.

## Evidence & Confidence

- **CONFIRMED** items are backed by direct source reading and/or executed commands in this workspace:
  - `npx tsc --noEmit` → PASS (exit 0)
  - `npm run build` → PASS (exit 0) but emits a server-bundle warning (see CRITICAL #1)
  - `node dist/server.cjs` → **CRASH** on boot (reproduced, log captured)
  - `npx tsx server.ts` (dev) → boots; `/api/status`, `/api/login` behavior verified with curl
  - `node_modules` installed via `npm install --legacy-peer-deps` (Bun lock present; Bun not installed in sandbox)
  - `npm audit` → 0 known vulnerabilities (checked against a generated npm lock; Bun lock cannot be audited by npm)
- **UNVERIFIED:** Gemini live calls (no API key present at audit time — falls back to local engine).

---

# Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19, Vite 8, Tailwind 4 | Single 665 KB chunk (207 KB gzip) |
| Backend | Express 4 (lock resolves 4.22.3) | `start` runs a bundled CJS server |
| AI | `@google/genai` ^2.23.0 (ESM-only) | Gemini "3.8-flash" |
| Archiving | `archiver` ^8.0.0 (ESM-only) | **API misuse — see CRITICAL #2** |
| Misc | multer, cookie-parser, qrcode, matter-js, ogl, motion | all actually imported/used |
| Tooling | tsx (dev), esbuild (server bundle), tsc (lint) | No ESLint, no test framework |

---

# Security Findings

## CRITICAL

### CRITICAL-1 — Production server crashes on boot (`npm start`) — CONFIRMED
- **Severity:** CRITICAL
- **Confidence:** CONFIRMED (reproduced)
- **Category:** Build/Runtime blocker
- **Location:** `server.ts:9-11` + `package.json` `build` script
- **Problem:** `package.json` bundles the server for production as **CJS** (`--format=cjs`). `server.ts` calls `createRequire(import.meta.url)`. Under CJS, `import.meta` is undefined (esbuild logs this exact warning during every `npm run build`: *“import.meta is not available with the cjs output format and will be empty”*). The built `dist/server.cjs` therefore aborts at load time.
- **Evidence (captured):**
  ```
  TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' must be a file URL object...
      at createRequire (node:internal/modules/cjs/loader:1992:11)
      at Object.<anonymous> (/home/user/file/dist/server.cjs:707:48)
  ```
- **Impact:** `npm run build && npm start` (the AI Studio / Cloud Run deploy path) cannot boot. The advertised "production" start script is broken.
- **Root Cause:** CJS output forced by the `@google/genai`-era scaffold, combined with the `import.meta.url` require shim. The shim is also redundant in dev (`tsx` runs ESM fine) — `archiver` is `require`d this way only because it was assumed CommonJS.
- **Recommended Fix:** Stop emitting CJS. Bundle the server as ESM (`--format=esm`, `--outfile=dist/server.mjs`, `start: node dist/server.mjs`) and replace the `createRequire` shim with a real ESM import of archiver. See CRITICAL-2 (the import itself must also change).
- **Regression Risk:** Low for a fix scoped to the build output format + import; dev mode (`tsx server.ts`) is untouched and already works.

### CRITICAL-2 — `archiver@8` is called with the removed v7 factory API — CONFIRMED
- **Severity:** CRITICAL (ZIP downloads functionally broken)
- **Confidence:** CONFIRMED (package source inspected)
- **Category:** Dependency API breakage
- **Location:** `server.ts` — `/api/download-selected` and `/download-all`
- **Problem:** The code calls `archiver('zip', { store: true })` (the v6/v7 factory signature). Installed `archiver@8.0.0` is **ESM-only and has no default/callable export** — `index.js` exports only named classes `Archiver`, `ZipArchive`, `TarArchive`, `JsonArchive`. Verified: `require('archiver')` yields `{Archiver, JsonArchive, TarArchive, ZipArchive}` and `archiver('zip')` is not callable.
- **Why it compiled silently:** `const archiver = require('archiver')` returns untyped `any` (via `createRequire`, `allowJs`, skip `strict`), so `tsc --noEmit` passes while the runtime contract is wrong.
- **Impact:** **Download All** and **Download Selected (ZIP)** throw at runtime in both dev and prod. This is a headline feature.
- **Root Cause:** Dependency was upgraded to v8 (in `bun.lock`) without updating the call sites, and the untyped `require` shim hid the regression from the type checker.
- **Recommended Fix:** `import { ZipArchive } from 'archiver'` and instantiate `new ZipArchive({ zlib: { level: 0 }, forceZip64: false })` for stored (no-compression) archives; or pin `archiver@^7` and restore the factory call. (Preferred: adopt the v8 API, since the lock already tracks v8.)
- **Regression Risk:** Medium — must re-verify streaming ZIP behavior (`data`/`end`/`error` events and `store` semantics) after the change.

---

## HIGH

### HIGH-1 — `/api/restart` regenerates credentials and signs out the operator — CONFIRMED
- **Category:** Authorization / availability
- **Location:** `server.ts` `/api/restart`
- **Problem:** The route calls `sessions.clear()` **then** `initializeState()`, which (when `SHARE_PASSWORD` is unset) generates a **new random password** printed only to the server console. The `StoppedView` → "Restart File Share" button therefore revokes the operator's own session and drops them to the login screen, where the only credential is a password they cannot see.
- **Evidence:** frontend `App.tsx:handleRestartShare` → `/api/restart` → `sessions.clear(); initializeState();` (server.ts).
- **Impact:** Restart is unusable/confusing in the default (no-`SHARE_PASSWORD`) deployment; the share effectively cannot be resumed by the host without server-log access.
- **Recommended Fix:** Preserve the current password across restart (re-read env, but do **not** re-randomize if a password is already set), and/or return the new password in the 200 response to the *pre-restart authenticated* caller.

### HIGH-2 — Single shared credential for every client; destructive actions unsegregated — CONFIRMED design weakness
- **Category:** Authorization model
- **Location:** server-wide (`/stop-share`, `/api/restart`, bulk-delete, content edit, Smopi ops)
- **Problem:** There is exactly one password. Anyone who knows it (i.e., every guest the host intentionally shares with) can **upload, overwrite, delete all files, stop the share, restart it, and drive the Gemini agent** (consuming paid API budget). The original Python app had the same single-secret model **but exposed only login/download** — this React port adds ~10 mutating endpoints with no additional gate.
- **Impact:** A shared link is de-facto admin access. One guest can destroy or shut down the share for everyone.
- **Recommended Fix:** Introduce a distinct **host/owner token** (separate cookie or header) required for destructive endpoints (`stop-share`, `restart`, `bulk-delete`, content overwrite). Keep guest password for view/download/upload. Minimal change: add an owner-session flag issued at boot and shown once to the host.

---

## MEDIUM

### MED-1 — Session token exposed in URLs and `sessionStorage`
- **Location:** `App.tsx:getDownloadUrl`, `/api/preview` image URLs, `/download-all?token=`
- **Problem:** The 48-hex session token is appended as a `?token=` query param for downloads/download-all and stored in `sessionStorage`. Query strings leak into browser history, server/proxy logs (if any access logging is added), and any tooling that records full URLs; `sessionStorage` is readable by any injected script.
- **Mitigations present:** HTTP-only cookie is the primary channel; `Referrer-Policy: strict-origin-when-cross-origin` truncates cross-origin Referers.
- **Recommended Fix:** Prefer the authenticated fetch/XHR path (which the app already supports) over query-token URLs; drop `?token=` in favor of cookie/Bearer-only auth for downloads, and remove the `sessionStorage` copy once the cookie path is validated in the embedded/preview environment.

### MED-2 — No cross-site request protection on mutating endpoints
- **Location:** all `POST/PUT/DELETE` routes
- **Problem:** No Origin/`Sec-Fetch-Site` verification and no CSRF token. `SameSite=Lax` cookie mitigates cross-site POST (cookie not attached on top-level cross-site POST), so **realistic CSRF risk is LOW**, but this is incidental rather than enforced — any future cookie-attribute change (e.g., `SameSite=None` for the AI Studio iframe/preview context) silently reopens CSRF on `/stop-share`, `/api/restart`, bulk-delete, etc.
- **Recommended Fix:** Add a tiny same-origin guard middleware for mutating methods (reject when `Origin`/`Sec-Fetch-Site` present and not same-origin).

### MED-3 — `/api/status` returns the share password to every authenticated client
- **Location:** `server.ts` `/api/status` (`share_password: authorized ? state.password : undefined`)
- **Problem:** The password is disclosed to **any** authenticated session, not just the host. This powers the "copy password" widget, but combined with HIGH-2 it means guests can always recover the credential. With no host/guest separation this is not an *additional* escalation (guests already know the password), but it cements the single-secret model and makes a future role split harder.
- **Recommended Fix:** Tie password disclosure to the owner role introduced under HIGH-2.

### MED-4 — Gemini (Smopi) endpoints lack authz scoping + rate limiting; error leakage
- **Location:** `/api/smopi/chat`, `/api/smopi/quick-action`
- **Problem:** Any authenticated client can spam the Gemini agent (cost/rate-limit exposure for the key owner). The chat catch returns `err.message` verbatim to the client (internal error detail). No per-IP or per-session throttle.
- **Recommended Fix:** Rate-limit AI calls (e.g., reuse the login limiter pattern), and sanitize the error payload to a generic message while logging the real error server-side.

### MED-5 — Frontend/backend category contract mismatch (icons always generic)
- **Location:** `App.tsx:getFileIcon` vs `server.ts:categoryFor`
- **Problem:** Backend emits `archives | images | documents | other` (plural). Frontend checks `archive | image | code | document`. Every file therefore falls back to the generic file icon and category coloring in the icons is dead code.
- **Impact:** Cosmetic, but symptomatic of unvalidated API contracts.
- **Recommended Fix:** Align the keys (and add a shared enum/type).

### MED-6 — Non-ASCII filenames download with percent-encoded names
- **Location:** `server.ts` `Content-Disposition`
- **Problem:** `attachment; filename="${encodeURIComponent(filename)}"` uses RFC 5987 (`filename*=UTF-8''…`) semantics on the plain `filename=` parameter. Browsers treat the literal `%20`-style string as the filename. The frontend even tries to parse `filename*=UTF-8''…`, which the server never sends.
- **Recommended Fix:** Emit only ASCII fallback in `filename=` and the encoded form in `filename*=UTF-8''…`, mirroring the Python `content_disposition()` helper.

### MED-7 — Upload filename collision check is racy (TOCTOU)
- **Location:** `server.ts` multer diskStorage `filename`
- **Problem:** The `while (fs.existsSync(...))` uniqueness loop is synchronous-but-not-atomic; two concurrent uploads of the same name can both pass the check and one overwrites the other (multer opens for write).
- **Recommended Fix:** Append a random suffix before writing, or accept the overwrite-after-check with `O_EXCL`-style handling; at minimum include `crypto.randomBytes` in the fallback name.

---

## LOW / RECOMMENDATION

- **LOW-1** (`vite.config.ts`): `__dirname` in an ESM config — Vite warns; use `import.meta.dirname`.
- **LOW-2** (security headers): `X-XSS-Protection: 1; mode=block` is deprecated (modern browsers ignore it; can misreport in scanners). Remove or replace with a CSP.
- **LOW-3** (`server.ts`): default generated password is `randomBytes(6).hex` = 12 hex chars (48 bits) vs upstream's ~72 bits. Acceptable short-term, weaker than the reference.
- **LOW-4**: rate limiter keyed on `req.ip` with `trust proxy 1` — behind Cloud Run the value may be a proxy hop; spoofing/resolution depends on the inbound chain. Verify configured trusted hops.
- **LOW-5**: session TTL (24 h) is not capped by the share expiry, so sessions can outlive the share.
- **LOW-6**: `.env.example` declares `GEMINI_API_KEY` twice (once "required", once "Smopi"), and `APP_URL` is documented but never read by the code.
- **RECOMMENDATION**: `_` no test framework exists — zero automated tests for a security-sensitive file server. Add at least a smoke suite (login, upload, download, traversal, expiry) — see Validation Plan.

---

# Critical / High Priority Issue Summary

| # | Severity | Status | Finding |
|---|---|---|---|
| CRITICAL-1 | CRITICAL | CONFIRMED | `npm start` crashes (CJS bundle + `import.meta.url` shim) |
| CRITICAL-2 | CRITICAL | CONFIRMED | `archiver@8` used with removed factory API → ZIP downloads broken |
| HIGH-1 | HIGH | CONFIRMED | `/api/restart` re-randomizes password + revokes operator session |
| HIGH-2 | HIGH | CONFIRMED | Single shared credential grants destructive admin actions |

---

# Code Quality

- **Strengths:** consistent path-traversal hardening (`safeChild`/`resolveSafePath` reject `..`, slashes, symlinks, NUL); `timingSafeEqual` password compare; login rate limiting with memory pruning; hidden-file and control-char stripping; Range support; `nosniff` + frame/referrer headers; clean component separation on the frontend.
- **Debt:**
  - `server.ts` is a ~1050-line monolith (routes + storage + state + serving mixed); `smopi.ts` is a ~720-line tool/fallback engine mixing regex-NLP with I/O.
  - Dead code: `getMimeType` duplicated vs `fileType` overlap; unused `category` → icon mapping (MED-5); several unused imports across components (`ArrowUpDown`, `Search`, `ExternalLink`, etc. — not flagged by tsc because `noUnusedLocals` is off).
  - "lint" script is only `tsc --noEmit` — it is a type check, not a linter; speed-of-light tier 7 wording in `package.json` scaffolding is stale.
  - No error-boundary or centralized API error handling on the client; many `catch (_) {}` swallow failures.

# Performance

- **Measured:** build 752 ms (client) + 12 ms (server bundle); client bundle 665 KB (207 KB gzip) single chunk.
- **Recommendations (not required now):** code-split the physics/AI/WebGL components via `React.lazy`/dynamic import to cut the initial 665 KB; `download-all`/`download-selected` stream with `store:true` (good — no CPU zip cost).

# Reliability

- In-memory sessions/state ⇒ any restart drops sessions and counters (acceptable for "temporary" semantics, but see HIGH-1 for the restart UX trap).
- `state.stopped` is set for expiry/one-time **in-memory only**; the process keeps serving expired-stream denial correctly via `isExpired()`.
- No process-level crash handler; a single `uncaughtException` in a route kills the share. (Express 4 returns 500 for sync throws; async errors in some handlers are caught, others are not.)

# Testing

- **Automated:** none present (no framework, no test files).
- **Manual verification performed in this audit:** `tsc` PASS · client build PASS · dev server boot PASS · login/auth API PASS. **Prod server boot: FAIL (CRITICAL-1).**

# UI/UX

- Rich, polished, and motion-heavy dashboard; `prefers-reduced-motion` handled via the "Eco Motion" toggle + `useReducedMotion`.
- Accessibility positives: `aria-live`, `sr-only` labels, keyboard shortcuts (S/R/Esc/A), `nosniff`/referrer policies.
- Gaps: several icon-only buttons rely on `title`/`aria-label` (OK) but focus styles appear minimal; `window.confirm`/`window.prompt` used for destructive confirmations and link copy fallback (blocking, non-restyled), keyboard trapping is not implemented in modals, and the `CodeSlots` login input is a custom widget (verify screen-reader behavior).

# Feature Opportunities

- Owner/guest role split (HIGH-2) would also unlock showing per-guest stats.
- Share-link deep-linking: the QR shares `window.location.origin + '/'` only; no mechanism to pre-share the password securely (by design, but worth documenting).

# Technical Debt

1. Untyped `require` shim masking a broken dependency (CRITICAL-2) — root of silent drift.
2. Duplicated backend (Node) vs `cloned/` (Python) with no README note explaining why both exist; `cloned/templates/index.html` is fully superseded by the React app.
3. No shared API contract types between server and client (category mismatch MED-5 proves the drift).
4. No CI, no lint step, no tests.

# Recommended Improvements (ranked)

1. **Fix the production boot + archiver import** (CRITICAL-1/2) — bundle server as ESM, adopt `ZipArchive`.
2. **Restart UX/credential fix** (HIGH-1) — preserve or return the password.
3. **Owner role for destructive ops** (HIGH-2) — minimal owner-token gate.
4. CSRF same-origin guard middleware (MED-2).
5. Stop leaking password to non-owner clients (MED-3); align category keys (MED-5); fix Content-Disposition (MED-6).
6. Rate-limit + sanitize Smopi errors (MED-4).
7. Add a smoke test suite + `noUnusedLocals`, and document the Node-vs-Python split.

# Proposed Execution Plan (upon approval)

1. **P1 build/runtime:** `package.json` build→ESM server bundle; `server.ts` replace `createRequire` shim with `import { ZipArchive } from 'archiver'`; update the two zip sites to `new ZipArchive({ zlib: { level: 0 } })`. Validate: `npm run build`, `node dist/server.mjs` boots, `tsc` passes, ZIP endpoints exercised end-to-end.
2. **P1 credential:** `/api/restart` preserves existing password across restart (re-read env only).
3. **P2 authorization:** owner-session flag for `stop-share`, `restart`, destructive ops; password disclosure gated to owner.
4. **P2 hardening:** same-origin CSRF guard middleware; Smopi rate limit + sanitized errors.
5. **P3 quality:** align category keys, fix Content-Disposition, remove deprecated header, tidy `.env.example`; add basic smoke tests.

# Validation Plan

- `npm run build` (PASS/FAIL) · `node dist/server.mjs` boot smoke (PASS/FAIL)
- `npx tsc --noEmit` (PASS/FAIL)
- End-to-end via curl: login → upload → list → single download (ASCII + non-ASCII names) → download-all ZIP → download-selected ZIP → bulk delete → stop/restart flow.
- npm audit (0 vulns already confirmed at audit time).

# Unknowns / Information Gaps

- **UNKNOWN:** Deployment target specifics (Cloud Run vs AI Studio vs bare VPS) — affects whether the CJS bundle was ever actually executed in production, and the correct proxy/trust configuration.
- **UNKNOWN:** Whether the `?token=` query-param mechanism is load-bearing for the embedded preview/iframe sandbox (the code comments suggest it was added for exactly that). Any change must be tested in that environment.
- **UNVERIFIED:** Gemini live behavior (no key at audit time).
- **UNKNOWN:** Owner preference for `archiver` fix (adopt v8 API vs pin v7).

---

## Summary

```text
Confirmed Problems:
- CRITICAL: `npm start` crashes on boot (CJS bundle + import.meta.url shim)
- CRITICAL: archiver@8 called via removed v7 factory API → ZIP downloads broken
- HIGH: /api/restart re-randomizes password and locks out the operator
- HIGH: single shared credential = admin access for every guest
- MEDIUM: token in URLs/sessionStorage, no CSRF guard, password disclosed to all authenticated clients,
         Smopi endpoints unthrottled + error leakage, category key mismatch (icons), filename encoding,
         racy upload collision check
- LOW: deprecated XSS header, 48-bit fallback password, trust-proxy/limiter caveat, stale .env.example

Likely Problems:
- Embedded-preview (iframe) auth relies on the ?token= mechanism; do not remove without re-testing there

Recommended Improvements:
- ESM server bundle + ZipArchive v8 API; owner role for destructive ops; same-origin CSRF guard;
  restart credential preservation; contract alignment; smoke test suite; code-splitting

Unknown:
- Exact production deployment topology; whether ?token= is load-bearing in the preview sandbox

Highest Priority:
1. Fix production boot crash (CRITICAL-1) + archiver v8 API (CRITICAL-2)
2. Fix /api/restart credential lockout (HIGH-1)
3. Add owner role separation for destructive operations (HIGH-2)
```

---

## Validation evidence (this audit)

```text
Build:         PASS  (vite client + esbuild server bundle; server bundle emits import.meta warning)
Prod Runtime:  FAIL  (dist/server.cjs crashes at createRequire — CRITICAL-1)
Dev Runtime:   PASS  (tsx server.ts boots; login/auth API verified via curl)
Tests:         NOT RUN (no test framework present)
Lint:          NOT RUN (no linter configured; "lint" == tsc only)
Type Check:    PASS  (npx tsc --noEmit, exit 0)
Security Scan: PASS  (npm audit: 0 known vulnerabilities)
```

---

# Addendum — Remediation round 2 (branch `arena/01a0bf28-smopi`, 2026-09-20)

Re-audit of base commit `8905440`. **Most findings from the original report were
already fixed in the codebase** and were re-verified rather than trusted:
CRITICAL-1, CRITICAL-2, HIGH-1, HIGH-2, MED-2, MED-3, MED-4, MED-5 and MED-6 all
now pass direct runtime checks. Remaining and newly-found work was completed in
five commits.

## New finding (not in the original report)

```text
Severity:   CRITICAL (tooling/type-safety blocker)
Confidence: CONFIRMED (reproduced)
Category:   Build / type safety
Location:   src/types.ts (absent) + 9 importers

Problem:
src/types.ts was never committed. `npm run lint` (tsc --noEmit) failed with
9 x TS2307.

Evidence:
`git ls-files | grep types` returned only src/components/smopi/types.ts;
the file is not .gitignore'd and absent from the HEAD tree.

Impact:
Vite/esbuild strip `import type` without resolving it, so `npm run build`
stayed GREEN while the only type-safety gate was red. This is the same
silent-drift mechanism that previously hid the archiver v7/v8 breakage.

Root Cause:
File omitted from the initial commit.

Fix:
Recreated from the actual server payloads. Doing so surfaced two real latent
bugs in FilePreviewModal (undiscriminated union access on `.content`, and a
client-only `type: 'error'` preview variant missing from the union).

Regression Risk:
Low — verified by tsc + 34 tests.
```

## Changes made

| Commit | Scope |
|---|---|
| `d9026b5` | Restore `src/types.ts`; sanitize 6 error-leaking routes; `__dirname` → `import.meta.dirname`; ignore `shared_files/` |
| `6ddefc4` | 31-test smoke suite (`node:test`, no new deps) + 3 stale README corrections |
| `d46a003` | GitHub Actions CI (lint + test + audit) |
| `0a2f170` | Remove 3 unused deps (`ogl`, `@hugeicons/*`) |
| `ef7add4` | Vendor chunk splitting + lazy `DodgeField` |
| `84030bd` | Drop redundant `?token=` from XHR downloads (+3 tests) |

## Measured results

- **Installed size:** 370 MB → 234 MB (−137 MB). Bundle unchanged — tree-shaking
  already excluded the unused deps, so this is supply-chain surface only.
- **Bundle chunking:** one 743.83 KB chunk → `react` 210.61 / `index` 321.50 /
  `markdown` 123.78 / `physics` 83.78 / `DodgeField` 4.49 (lazy). Initial
  transfer is roughly unchanged; the benefit is cache reuse across deploys.
  Size attribution came from the build sourcemap, not intuition.
- **Tests:** 0 → 34, verified non-vacuous by fault injection (reintroducing the
  error leak fails 1 test; removing `safeChild`'s guards fails 3).

## Still open

- **MED-1 (partial):** `?token=` remains on `<a href>` download links in
  `FileItem`/`FilePreviewModal`. A browser navigation cannot send an
  `Authorization` header and cookies may be withheld in the cross-origin AI
  Studio iframe, so the fallback is **LIKELY load-bearing**. Removing it needs
  verification inside that iframe, which is not possible from this environment.
- **MED-7 (racy upload collision):** unchanged; the `fs.existsSync` loop in the
  multer `filename` callback is still TOCTOU-prone under concurrent uploads of
  the same name.
- **LOW-2/3/4/5:** deprecated `X-XSS-Protection` header, 48-bit generated
  password, `trust proxy 1` limiter caveat, session TTL vs share expiry.
- **UNVERIFIED:** Gemini live behavior (no API key available); production
  deployment topology.

## Validation evidence (round 2, from a clean `node_modules`)

```text
Build:         PASS  (vite + esbuild, exit 0; no __dirname warning, no >500 KB warning)
Prod Runtime:  PASS  (NODE_ENV=production node dist/server.cjs boots; all emitted chunks served 200)
Type Check:    PASS  (npx tsc --noEmit, exit 0 — was FAIL with 9 errors)
Tests:         PASS  (34/34, 13 suites, node --test)
Lint:          NOT RUN (no ESLint configured; "lint" == tsc only)
Security Scan: PASS  (npm audit --omit=dev: 0 vulnerabilities)
Runtime E2E:   PASS  (login, upload, list, ZIP incl. EOCD, Range 206, RFC 5987
                      filenames, traversal 404, cross-origin POST 403, owner gating,
                      expiry, restart credential preservation, error hygiene)
```
