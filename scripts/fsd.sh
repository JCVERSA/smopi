#!/bin/sh
# ============================================================================
#  fsd — File Share manager (installed by scripts/install.sh as `fsd`)
#  Usage: fsd <command>   (run: fsd help)
#
#  Commands:
#    setup      npm install (legacy-peer-deps) + build (produces dist/server.mjs)
#    build      rebuild dist/server.mjs only
#    start      start the production server in the background
#    stop       stop a running server
#    restart    stop + start
#    status     show share stats (server must be running)
#    dev        run the dev server (Vite HMR) in the foreground
#    logs       tail the server log file
#    env        manage .env  (env init|path|show|get KEY|set KEY VALUE|unset KEY)
#    update     git pull --ff-only + rebuild
#    version    print install dir + git commit
#    uninstall  remove this installation (keeps shared_files by default)
# ============================================================================
set -eu

REPO_URL="${FS_REPO_URL:-https://github.com/JCVERSA/file}"

# --- locate the real installation dir (resolve symlinks) --------------------
if [ -n "${BASH_SOURCE:-}" ]; then
  SRC="${BASH_SOURCE[0]}"
else
  SRC="$0"
fi
case "$SRC" in
  */*) ;;
  *) SRC="$(command -v "$SRC" 2>/dev/null || echo "$SRC")" ;;
esac
while [ -L "$SRC" ]; do
  DIR="$(cd "$(dirname "$SRC")" && pwd)"
  SRC="$(readlink "$SRC")"
  case "$SRC" in /*) ;; *) SRC="$DIR/$SRC" ;; esac
done
APP_DIR="$(cd "$(dirname "$SRC")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
LOG_FILE="$APP_DIR/.fsd/server.log"
PID_FILE="$APP_DIR/.fsd/server.pid"
RUN_DIR="$APP_DIR/.fsd"
mkdir -p "$RUN_DIR"

# --- helpers ---------------------------------------------------------------
have_tty() { [ -t 1 ]; }
if have_tty; then
  C_GREEN="\033[1;32m"; C_RED="\033[1;31m"; C_YELLOW="\033[1;33m"
  C_CYAN="\033[1;36m"; C_BOLD="\033[1m"; C_RESET="\033[0m"
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_CYAN=""; C_BOLD=""; C_RESET=""
fi
ok()   { printf '%sOK%s  %s\n' "$C_GREEN" "$C_RESET" "$*"; }
ko()   { printf '%sERREUR%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
warn() { printf '%s!!%s  %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
info() { printf '%s==%s  %s\n' "$C_CYAN" "$C_RESET" "$*"; }
die()  { ko "$*"; exit 1; }

is_running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }
server_pid() { if is_running; then cat "$PID_FILE"; fi }

# Load .env and make sure PORT is resolved (server.ts also has its own default,
# but the launcher needs PORT for the health check).
_exports() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi
  if [ -z "${PORT:-}" ]; then
    PORT="$(sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*["]?\([0-9]\{2,5\}\)["]?[[:space:]]*$/\1/p' "$ENV_FILE" 2>/dev/null | tail -n1)"
  fi
  : "${PORT:=3000}"
  export PORT
}

node_detect() {
  command -v node >/dev/null 2>&1 || die "node not found in PATH"
  NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
  { [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; } || die "Node.js >= 22 required (detected $(node -v))."
}

cmd_setup() {
  node_detect
  info "Installing dependencies (npm install --legacy-peer-deps) ..."
  ( cd "$APP_DIR" && npm install --legacy-peer-deps )
  info "Building (vite build + esbuild server) ..."
  ( cd "$APP_DIR" && npm run build )
  ok "Setup complete - dist/server.mjs produced."
}

cmd_build() {
  node_detect
  ( cd "$APP_DIR" && npm run build ) || die "Build failed."
  ok "Build complete."
}

_wait_http() {
  n=0
  while [ "$n" -lt 15 ]; do
    if curl -fsS "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
      ok "Server responded on http://127.0.0.1:$PORT"
      return 0
    fi
    if ! is_running; then
      warn "Server process exited during startup - check: fsd logs"
      return 1
    fi
    sleep 1
    n=$((n+1))
  done
  warn "Server did not respond within ${n}s - check: fsd logs"
  return 0
}

cmd_start() {
  node_detect
  _exports
  if is_running; then
    warn "Already running (PID $(server_pid)) on port $PORT."
    return 0
  fi
  [ -f "$APP_DIR/dist/server.mjs" ] || die "dist/server.mjs missing - run: fsd setup"
  info "Starting production server on port $PORT ..."
  (
    cd "$APP_DIR" || exit 1
    NODE_ENV=production
    export NODE_ENV
    nohup node dist/server.mjs >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )
  _wait_http || true
  ok "Server started (PID $(server_pid)) - log: fsd logs"
}

cmd_dev() {
  node_detect
  _exports
  info "Dev server (Vite HMR) on port $PORT - Ctrl+C to stop."
  ( cd "$APP_DIR" && npm run dev )
}

cmd_stop() {
  if is_running; then
    pid="$(server_pid)"
    info "Stopping server (PID $pid) ..."
    kill "$pid" 2>/dev/null || true
    n=0
    while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 20 ]; do
      sleep 0.5; n=$((n+1))
    done
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
    rm -f "$PID_FILE"
    ok "Server stopped."
  else
    info "Server is not running."
  fi
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  _exports
  if ! is_running; then
    info "Server not running (would listen on port $PORT)."
    return 0
  fi
  info "Server running (PID $(server_pid)) on port $PORT."
  if curl -fsS "http://127.0.0.1:$PORT/api/status" 2>/dev/null; then
    echo ""
  else
    warn "Could not query /api/status (server warming up, or PHP?)."
  fi
}

cmd_logs() {
  [ -f "$LOG_FILE" ] || die "No log file yet - start the server first."
  tail -n "${1:-50}" "$LOG_FILE"
}

cmd_version() {
  echo "File Share @ $APP_DIR"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" log -1 --format='commit %h  %s' 2>/dev/null || true
  else
    echo "(installed from local source - no git metadata)"
  fi
}

cmd_update() {
  [ -d "$APP_DIR/.git" ] || die "Installed from --source-dir; re-run install.sh to update."
  BRANCH="$(git -C "$APP_DIR" symbolic-ref --short -q HEAD 2>/dev/null || echo main)"
  if is_running; then was_running=1; else was_running=0; fi
  info "Pulling latest ($REPO_URL $BRANCH) ..."
  git -C "$APP_DIR" config pull.ff only
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || die "Pull failed - resolve local changes first."
  if [ "$was_running" -eq 1 ]; then cmd_stop; fi
  cmd_setup
  if [ "$was_running" -eq 1 ]; then cmd_start; fi
  ok "Update complete."
}

cmd_env() {
  sub="${1:-show}"
  shift || true
  case "$sub" in
    init)
      if [ -f "$ENV_FILE" ]; then warn ".env already exists - not overwriting."; else
        cp "$APP_DIR/.env.example" "$ENV_FILE" && ok ".env created."
      fi ;;
    path) echo "$ENV_FILE" ;;
    show)
      if [ ! -f "$ENV_FILE" ]; then info "No .env yet - run: fsd env init"; return 0; fi
      while IFS= read -r line; do
        case "$line" in ''|'#'*) continue ;; esac
        key="${line%%=*}"
        val="${line#*=}"
        case "$key" in
          *PASSWORD*|*SECRET*|*KEY*|*TOKEN*)
            if [ -z "$val" ]; then shown="(empty)"; else shown="${val%"${val#?}"}***(${#val} chars)"; fi ;;
          *) shown="$val" ;;
        esac
        printf '  %s = %s\n' "$key" "$shown"
      done < "$ENV_FILE" ;;
    get)
      key="${1:-}"
      [ -n "$key" ] || die "Usage: fsd env get KEY"
      [ -f "$ENV_FILE" ] || return 0
      grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- ;;
    set)
      key="${1:-}"
      [ -n "$key" ] && [ $# -ge 2 ] || die "Usage: fsd env set KEY VALUE"
      shift || true
      val="$*"
      touch "$ENV_FILE"
      if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
      else
        printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
      fi
      ok "$key set." ;;
    unset)
      key="${1:-}"
      [ -n "$key" ] || die "Usage: fsd env unset KEY"
      [ -f "$ENV_FILE" ] && sed -i "/^${key}=/d" "$ENV_FILE" || true
      ok "$key removed." ;;
    *) die "Unknown env subcommand: ${1:-} (use: init|path|show|get|set|unset)" ;;
  esac
}

cmd_uninstall() {
  arg="${1:-}"
  if [ -t 0 ]; then
    KEEP_FILES=yes
    printf 'Remove the shared files (%s/shared_files) too? [y/N] ' "$APP_DIR"
    IFS= read -r answer
    case "$answer" in [Yy]|[Yy][Ee][Ss]) KEEP_FILES=no ;; *) KEEP_FILES=yes ;; esac
  else
    case "$arg" in
      --keep-files)   KEEP_FILES=yes ;;
      --remove-files) KEEP_FILES=no ;;
      *) die "Refusing to uninstall non-interactively. Use: fsd uninstall --keep-files | --remove-files" ;;
    esac
  fi

  cmd_stop

  BIN_DIR="$(cat "$APP_DIR/.fsd/bin_dir" 2>/dev/null || true)"
  if [ -n "$BIN_DIR" ] && [ -L "$BIN_DIR/fsd" ]; then
    rm -f "$BIN_DIR/fsd" || true
    ok "Removed launcher: $BIN_DIR/fsd"
  fi

  for prof in "$HOME/.profile" "$HOME/.bashrc"; do
    [ -f "$prof" ] || continue
    sed -i '/# Added by File Share (fsd) installer/d' "$prof" 2>/dev/null || true
    sed -i "\|export PATH=\"$BIN_DIR:\$PATH\"|d" "$prof" 2>/dev/null || true
  done

  SHARED="$APP_DIR/shared_files"
  if [ "$KEEP_FILES" = "no" ]; then
    if [ -d "$SHARED" ] && [ -n "$(ls -A "$SHARED" 2>/dev/null)" ]; then
      warn "Deleting shared files at $SHARED"
      rm -rf "$SHARED"
    fi
  else
    warn "Keeping shared files (they will remain after removal at $SHARED)."
  fi

  rm -rf "$APP_DIR"
  ok "File Share removed."
}

usage() {
  sed -n '3,18p' "$SRC" | sed 's/^# \{0,1\}//'
}

case "${1:-help}" in
  setup)                  cmd_setup ;;
  build)                  cmd_build ;;
  start)                  shift; cmd_start "$@" ;;
  dev)                    shift; cmd_dev "$@" ;;
  stop)                   cmd_stop ;;
  restart)                cmd_restart ;;
  status)                 cmd_status ;;
  logs)                   shift; cmd_logs "$@" ;;
  env)                    shift; cmd_env "$@" ;;
  update)                 cmd_update ;;
  version|--version|-V)   cmd_version ;;
  uninstall)              shift; cmd_uninstall "$@" ;;
  help|-h|--help)         usage ;;
  *) die "Unknown command: ${1:-} (try: fsd help)" ;;
esac
