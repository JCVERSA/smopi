#!/bin/sh
# ============================================================================
#  FILE SHARE — one-line installer (Node/Express + React 19)
#
#  Repo   : https://github.com/JCVERSA/file
#  Branch : main (override with --branch or FS_BRANCH)
#
#  Usage (from any Debian/Ubuntu VPS or container):
#    curl -fsSL "https://raw.githubusercontent.com/JCVERSA/file/main/scripts/install.sh" | sh
#
#  Or interactively (recommended — lets you configure .env at the end):
#    sh -c "$(curl -fsSL https://raw.githubusercontent.com/JCVERSA/file/main/scripts/install.sh)"
#
#  The script is idempotent: re-running it updates an existing installation.
#  At the end the `fsd` command is available everywhere (see: fsd help).
#
#  Options:
#    --dir PATH          install directory (default /opt/file-share as root,
#                        else ~/.local/share/file-share)
#    --bin-dir PATH      directory for the `fsd` launcher (default
#                        /usr/local/bin as root, else ~/.local/bin)
#    --branch NAME       git branch to install (default main)
#    --source-dir PATH   install from an existing checkout instead of GitHub
#    --skip-build        skip npm install + build (tests/CI only)
#    --help              show this help
#
#  Environment: FS_INSTALL_DIR, FS_BIN_DIR, FS_BRANCH, FS_REPO_URL,
#               FS_SKIP_BUILD
# ============================================================================
set -eu

REPO_URL="${FS_REPO_URL:-https://github.com/JCVERSA/file}"
BRANCH="${FS_BRANCH:-main}"
RAW_BASE="https://raw.githubusercontent.com/JCVERSA/file"
APP_NAME="file-share"
COMMAND_NAME="fsd"
SKIP_BUILD="${FS_SKIP_BUILD:-0}"
SOURCE_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)        [ $# -ge 2 ] || { printf 'ERREUR: --dir needs a path\n' >&2; exit 1; }
                  FS_INSTALL_DIR="$2"; shift 2 ;;
    --bin-dir)    [ $# -ge 2 ] || { printf 'ERREUR: --bin-dir needs a path\n' >&2; exit 1; }
                  FS_BIN_DIR="$2"; shift 2 ;;
    --branch)     [ $# -ge 2 ] || { printf 'ERREUR: --branch needs a name\n' >&2; exit 1; }
                  BRANCH="$2"; shift 2 ;;
    --source-dir) [ $# -ge 2 ] || { printf 'ERREUR: --source-dir needs a path\n' >&2; exit 1; }
                  SOURCE_DIR="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --help|-h)
      sed -n '2,33p' "$0" 2>/dev/null || echo "See https://github.com/JCVERSA/file"
      exit 0 ;;
    *) printf 'Unknown option: %s (try --help)\n' "$1" >&2; exit 1 ;;
  esac
done

# Locale UTF-8 so the output stays legible on fresh VPSes (locale "C").
export LC_ALL=C.UTF-8 LANG=C.UTF-8

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32mOK\033[0m  %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$1"; }
fail() { printf '\033[1;31mERREUR:\033[0m %s\n' "$1" >&2; exit 1; }

# Interactive ONLY when a controlling TTY exists - `curl | sh` stays non-interactive.
have_tty() { [ -t 0 ] || [ -t 1 ]; }
ask_yes_no() { # $1 question - default no
  have_tty || return 1
  printf '%s [y/N] ' "$1"
  IFS= read -r answer < /dev/tty || return 1
  case "$answer" in [Yy]|[Yy][Ee][Ss]) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------------------
step "1/7 · Base checks"
# ---------------------------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || fail "This script targets Linux (detected: $(uname -s))."
case "$(uname -m)" in
  x86_64|aarch64|arm64) ok "Architecture: $(uname -m)" ;;
  *) warn "Untested architecture $(uname -m) - continuing without guarantees." ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  INSTALL_DIR="${FS_INSTALL_DIR:-/opt/file-share}"
  BIN_DIR="${FS_BIN_DIR:-/usr/local/bin}"
else
  INSTALL_DIR="${FS_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/file-share}"
  BIN_DIR="${FS_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
  warn "Non-root mode: installing into ${INSTALL_DIR} and ${BIN_DIR}."
fi
printf '    Target dir: %s\n    Command   : %s/%s\n' "$INSTALL_DIR" "$BIN_DIR" "$COMMAND_NAME"

# The repo + node_modules + client build need roughly 1 GB.
avail_mb="$(df -Pm "${INSTALL_DIR%/*}" 2>/dev/null | awk 'NR==2{print $4}')"
case "$avail_mb" in
  ''|*[!0-9]*) : ;;                 # df unavailable - continue
  *)
    [ "$avail_mb" -ge 1000 ] || fail "Not enough disk space (${avail_mb} MB free on ${INSTALL_DIR%/*} - about 1 GB needed)."
    [ "$avail_mb" -ge 2000 ] || warn "Tight on disk space (${avail_mb} MB free - about 2 GB recommended)."
    ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required - install it first (apt install curl)."

APT=""
command -v apt-get >/dev/null 2>&1 && APT="apt-get"
APT_UPDATED=0
apt_install() { # $@ = packages; nonzero on failure
  [ -n "$APT" ] || return 1
  if [ "$APT_UPDATED" -eq 0 ]; then
    DEBIAN_FRONTEND=noninteractive $APT update -qq >/dev/null 2>&1 \
      || warn "apt update failed - trying the install anyway."
    APT_UPDATED=1
  fi
  DEBIAN_FRONTEND=noninteractive $APT install -y -qq "$@" >/dev/null 2>&1 && return 0
  warn "Quiet install of '$*' failed - retrying verbosely..."
  DEBIAN_FRONTEND=noninteractive $APT install -y "$@"
}

if ! command -v git >/dev/null 2>&1; then
  if [ -n "$APT" ] && [ "$(id -u)" -eq 0 ]; then
    step "· Installing git"
    apt_install git || fail "Could not install git (see apt output above)."
  else
    fail "git is required and apt-get is unavailable - install git manually."
  fi
fi
ok "git $(git --version 2>/dev/null | awk '{print $3}')"

# Best-effort user-space Node install (no root/apt) via a version manager
# already on the machine: fnm or mise. Returns 0 when node >= 22 is usable.
try_userland_node() {
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)" 2>/dev/null || true
    fnm install 22 >/dev/null 2>&1 || { warn "fnm install 22 failed."; return 1; }
    eval "$(fnm env)" 2>/dev/null || true
    return 0
  fi
  if command -v mise >/dev/null 2>&1; then
    mise install node@22 >/dev/null 2>&1 || { warn "mise install node@22 failed."; return 1; }
    eval "$(mise env)" 2>/dev/null || true
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
step "2/7 · Node.js (>= 22)"
# ---------------------------------------------------------------------------
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
fi

if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ -n "$APT" ] && [ "$(id -u)" -eq 0 ]; then
    warn "Node.js missing or too old (${NODE_MAJOR:-none}) - installing NodeSource 22.x..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sh - >/dev/null || fail "NodeSource setup failed."
    apt_install nodejs || fail "Could not install nodejs."
    NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
  elif try_userland_node; then
    NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
    [ "$NODE_MAJOR" -ge 22 ] || fail "Version manager installed node $(node -v) - still < 22."
    ok "Node $(node -v) provisioned via $(command -v fnm >/dev/null 2>&1 && echo fnm || echo mise)."
  else
    fail "Node.js >= 22 required, but only '${NODE_MAJOR:-none}' was found and no root/apt
or version manager is available.

No root needed - install Node 22 with nvm, then re-run this installer:

  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
  nvm install 22 && nvm alias default 22

Open a new shell (or: source ~/.bashrc), make sure 'node -v' prints v22.x,
then run the install command again."
  fi
fi
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js ${NODE_MAJOR} detected - >= 22 is required."
ok "node $(node -v) / npm $(npm -v)"

# ---------------------------------------------------------------------------
step "3/7 · Fetching the code"
# ---------------------------------------------------------------------------
if [ -n "$SOURCE_DIR" ]; then
  # Install from an existing checkout (no network, no git history kept).
  SOURCE_DIR=$(CDPATH= cd -- "$SOURCE_DIR" && pwd)
  [ -f "$SOURCE_DIR/package.json" ] || fail "Invalid source dir: $SOURCE_DIR (missing package.json)."
  [ -f "$SOURCE_DIR/server.ts" ]  || fail "Invalid source dir: $SOURCE_DIR (missing server.ts)."
  # Refuse to wipe a directory that does not look like a previous File Share
  # install (defense against a mistyped FS_INSTALL_DIR).
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    { [ -f "$INSTALL_DIR/server.ts" ] && [ -f "$INSTALL_DIR/package.json" ]; } \
      || [ -d "$INSTALL_DIR/.fsd" ] \
      || fail "$INSTALL_DIR exists and does not look like a File Share install - refusing to overwrite. Remove it or choose another --dir."
    # Preserve user data across a source-dir reinstall.
    PRESERVE_DIR="$(mktemp -d)"
    [ -f "$INSTALL_DIR/.env" ]         && mv "$INSTALL_DIR/.env" "$PRESERVE_DIR/.env"
    [ -d "$INSTALL_DIR/shared_files" ] && mv "$INSTALL_DIR/shared_files" "$PRESERVE_DIR/shared_files"
    rm -rf "$INSTALL_DIR"
  fi
  mkdir -p "$INSTALL_DIR"
  ( cd "$SOURCE_DIR" && tar -cf - . ) | ( cd "$INSTALL_DIR" && tar -xf - )
  rm -rf "$INSTALL_DIR/.git" "$INSTALL_DIR/node_modules" "$INSTALL_DIR/dist" \
         "$INSTALL_DIR/shared_files" "$INSTALL_DIR/.fsd"
  # Restore preserved user data on top of the fresh staging.
  if [ -n "${PRESERVE_DIR:-}" ]; then
    [ -f "$PRESERVE_DIR/.env" ]         && mv "$PRESERVE_DIR/.env" "$INSTALL_DIR/.env"
    [ -d "$PRESERVE_DIR/shared_files" ] && mv "$PRESERVE_DIR/shared_files" "$INSTALL_DIR/shared_files"
    rm -rf "$PRESERVE_DIR"
  fi
  ok "Installed from local source ($SOURCE_DIR) - git updates disabled."
elif [ -d "$INSTALL_DIR/.git" ]; then
  CUR_REMOTE="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)"
  case "$CUR_REMOTE" in
    "$REPO_URL"|"$REPO_URL.git"|'') ;;
    *)
      warn "Existing repository points at $CUR_REMOTE - re-linking to $REPO_URL ..."
      git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL.git" || fail "Could not change origin."
      ;;
  esac

  git -C "$INSTALL_DIR" config pull.ff only
  ok "Repository already present - fetching branch ${BRANCH} ..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH" || fail "Fetch failed from $REPO_URL (branch $BRANCH)."

  CUR_BRANCH="$(git -C "$INSTALL_DIR" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  if [ -n "$(git -C "$INSTALL_DIR" status --porcelain 2>/dev/null)" ]; then
    warn "Local tree has uncommitted changes - keeping the current code (no forced update)."
  elif [ "$CUR_BRANCH" = "$BRANCH" ]; then
    ok "On branch ${BRANCH} - fast-forwarding ..."
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" \
      || warn "Pull refused - continuing with the current code."
  else
    warn "Switching from branch '${CUR_BRANCH:-detached}' to '${BRANCH}' ..."
    git -C "$INSTALL_DIR" checkout -B "$BRANCH" FETCH_HEAD \
      || fail "Could not switch to branch ${BRANCH}."
    ok "Now on branch ${BRANCH} ($(git -C "$INSTALL_DIR" log -1 --format='%h'))."
  fi
else
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    fail "$INSTALL_DIR is not empty and is not a git repository."
  fi
  git clone --depth 1 --single-branch -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR" \
    || fail "Clone failed (network?). Try: --source-dir /path/to/checkout"
  git -C "$INSTALL_DIR" config pull.ff only
  ok "Repository cloned ($(git -C "$INSTALL_DIR" log -1 --format='%h'))."
fi

# Validate the fetched tree BEFORE touching the launcher - catches installing
# from a branch that predates scripts/ (e.g. an unmerged `main`), with a clear
# error instead of a cryptic `chmod: cannot access scripts/fsd.sh`.
if [ ! -f "$INSTALL_DIR/server.ts" ] || [ ! -f "$INSTALL_DIR/scripts/fsd.sh" ]; then
  fail "Branch '${BRANCH}' does not contain the File Share code (scripts/fsd.sh missing).
  Use --branch <branch-with-scripts>, e.g.:  --branch arena/01a0b7f8-file"
fi

# ---------------------------------------------------------------------------
step "4/7 · Launcher command '${COMMAND_NAME}'"
# ---------------------------------------------------------------------------
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/scripts/fsd.sh" "$BIN_DIR/$COMMAND_NAME"
chmod +x "$INSTALL_DIR/scripts/fsd.sh"
mkdir -p "$INSTALL_DIR/.fsd"
printf '%s\n' "$BIN_DIR" > "$INSTALL_DIR/.fsd/bin_dir"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    MARKER="# Added by File Share (fsd) installer"
    for prof in "$HOME/.profile" "$HOME/.bashrc"; do
      [ -f "$prof" ] || continue
      grep -qF "$BIN_DIR" "$prof" 2>/dev/null && continue
      printf '\n%s\nexport PATH="%s:$PATH"\n' "$MARKER" "$BIN_DIR" >> "$prof"
    done
    PATH="$BIN_DIR:$PATH"
    warn "$BIN_DIR added to PATH (open a new shell or: source ~/.profile)."
    ;;
esac
ok "Command \`${COMMAND_NAME}\` installed -> ${BIN_DIR}/${COMMAND_NAME}"

# ---------------------------------------------------------------------------
step "5/7 · Dependencies + build"
# ---------------------------------------------------------------------------
if [ "$SKIP_BUILD" = "1" ]; then
  warn "FS_SKIP_BUILD=1 - npm install + build skipped (test mode)."
else
  sh "$INSTALL_DIR/scripts/fsd.sh" setup || fail "Setup failed (npm install / build). See the messages above."
fi

[ -f "$INSTALL_DIR/dist/server.mjs" ] || warn "dist/server.mjs missing - run: fsd setup"

# ---------------------------------------------------------------------------
step "6/7 · Configuration (.env)"
# ---------------------------------------------------------------------------
if [ ! -f "$INSTALL_DIR/.env" ]; then
  if cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env" 2>/dev/null; then
    ok ".env created from the example (defaults applied)."
  else
    warn "Could not create .env - create it with: fsd env init"
  fi
  if ask_yes_no "Configure the .env now (set SHARE_PASSWORD, PORT, ...)?"; then
    sh "$INSTALL_DIR/scripts/fsd.sh" env || warn "Configurator interrupted - rerun: fsd env"
  else
    printf '    Later: \033[1mfsd env\033[0m  (or: fsd env set SHARE_PASSWORD yoursecret)\n'
  fi
else
  ok ".env already present (kept - not modified)."
fi

# ---------------------------------------------------------------------------
step "7/7 · Summary"
# ---------------------------------------------------------------------------
VERSION_LINE="$(git -C "$INSTALL_DIR" log -1 --format='%h %s' 2>/dev/null || echo 'local source')"

printf '\n'
printf '\033[1;36m=====================================================\033[0m\n'
printf '\033[1m  FILE SHARE installed successfully\033[0m\n'
printf '\033[1;36m=====================================================\033[0m\n'
printf '  Directory : %s\n' "$INSTALL_DIR"
printf '  Version   : %s (%s)\n' "$VERSION_LINE" "$BRANCH"
printf '  Command   : %s  (try: %s help)\n' "$COMMAND_NAME" "$COMMAND_NAME"
printf '\n'
printf '  Quick start:\n'
printf '   1. \033[1m%s env set SHARE_PASSWORD yoursecret\033[0m\n' "$COMMAND_NAME"
printf '   2. \033[1m%s start\033[0m        (production server on port 3000)\n' "$COMMAND_NAME"
printf '   3. \033[1m%s status\033[0m       (share stats + remaining time)\n' "$COMMAND_NAME"
printf '\n'
printf '  Development: \033[1m%s dev\033[0m    (Vite HMR, foreground)\n' "$COMMAND_NAME"
printf '  Update     : \033[1m%s update\033[0m\n' "$COMMAND_NAME"
printf '  Uninstall  : \033[1m%s uninstall\033[0m\n' "$COMMAND_NAME"
printf '\n'
