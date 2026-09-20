#!/bin/sh
# ============================================================================
#  sdf — Smopi File Share manager (installed by scripts/install.sh as `sdf`)
#  Usage: sdf <command>   (run: sdf help)
#
#  Commands:
#    setup      npm install (legacy-peer-deps) + build (produces dist/server.cjs)
#    build      rebuild dist/server.cjs only
#    start      start the production server (systemd when available, else nohup)
#    stop       stop a running server
#    restart    stop + start
#    status     show share stats (server must be running)
#    doctor     full diagnostic: node, build, port, disk, .env, permissions
#    dev        run the dev server (Vite HMR) in the foreground
#    logs       tail the server log (journalctl under systemd)
#    env        manage .env  (env | init | path | show | get KEY | set KEY VALUE | unset KEY)
#    service    manage the systemd unit (service install|remove|status)
#    test       run the end-to-end smoke suite
#    update     git pull --ff-only + rebuild + restart
#    version    print install dir + git commit
#    uninstall  remove this installation (keeps shared_files by default)
# ============================================================================
set -eu

REPO_URL="${FS_REPO_URL:-https://github.com/JCVERSA/smopi}"
COMMAND_NAME="sdf"
SERVICE_NAME="smopi"

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
RUN_DIR="$APP_DIR/.sdf"
LOG_FILE="$RUN_DIR/server.log"
PID_FILE="$RUN_DIR/server.pid"
SERVER_JS="$APP_DIR/dist/server.cjs"
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
ko()   { printf '%sERROR%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
warn() { printf '%s!!%s  %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
info() { printf '%s==%s  %s\n' "$C_CYAN" "$C_RESET" "$*"; }
die()  { ko "$*"; exit 1; }

# systemd is used only when we are root AND systemctl can talk to a running
# system manager (absent in most containers/WSL) — otherwise fall back to nohup.
use_systemd() {
  [ "$(id -u)" -eq 0 ] || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl list-units >/dev/null 2>&1 || return 1
  return 0
}
service_installed() { [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; }
service_active()    { systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; }

is_running() {
  if use_systemd && service_installed; then
    service_active && return 0
    return 1
  fi
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}
server_pid() {
  if use_systemd && service_installed; then
    systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null
  elif [ -f "$PID_FILE" ]; then
    cat "$PID_FILE"
  fi
}

# Load .env; the launcher needs PORT for health checks.
_exports() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
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
  [ -f "$SERVER_JS" ] || die "Build finished but dist/server.cjs is missing."
  ok "Setup complete - dist/server.cjs produced."
}

cmd_build() {
  node_detect
  ( cd "$APP_DIR" && npm run build ) || die "Build failed."
  ok "Build complete."
}

cmd_test() {
  node_detect
  ( cd "$APP_DIR" && npm test )
}

_wait_http() {
  n=0
  while [ "$n" -lt 20 ]; do
    if curl -fsS "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
      ok "Server responded on http://127.0.0.1:$PORT"
      return 0
    fi
    if ! is_running; then
      warn "Server process exited during startup - check: $COMMAND_NAME logs"
      return 1
    fi
    sleep 1
    n=$((n+1))
  done
  warn "Server did not respond within ${n}s - check: $COMMAND_NAME logs"
  return 0
}

# --- systemd unit ----------------------------------------------------------
cmd_service() {
  sub="${1:-status}"
  case "$sub" in
    install)
      use_systemd || die "systemd unavailable (need root + a running systemd)."
      _exports
      RUN_USER="${SUDO_USER:-root}"
      SHARE_PATH="${SHARE_DIR:-$APP_DIR/shared_files}"
      mkdir -p "$SHARE_PATH"
      NODE_BIN="$(command -v node)"
      cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Smopi File Share
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${SERVER_JS}
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${SHARE_PATH} ${RUN_DIR}

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
      ok "systemd unit installed and enabled (${SERVICE_NAME}.service)."
      ;;
    remove)
      use_systemd || die "systemd unavailable."
      systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
      rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
      systemctl daemon-reload
      ok "systemd unit removed."
      ;;
    status)
      if service_installed; then
        systemctl status "$SERVICE_NAME" --no-pager || true
      else
        info "No systemd unit installed (using nohup mode)."
      fi
      ;;
    *) die "Usage: $COMMAND_NAME service install|remove|status" ;;
  esac
}

cmd_start() {
  node_detect
  _exports
  if is_running; then
    warn "Already running (PID $(server_pid)) on port $PORT."
    return 0
  fi
  [ -f "$SERVER_JS" ] || die "dist/server.cjs missing - run: $COMMAND_NAME setup"

  if use_systemd; then
    service_installed || cmd_service install
    info "Starting via systemd on port $PORT ..."
    systemctl start "$SERVICE_NAME" || die "systemctl start failed - see: $COMMAND_NAME logs"
  else
    info "Starting production server on port $PORT (nohup) ..."
    (
      cd "$APP_DIR" || exit 1
      NODE_ENV=production
      export NODE_ENV
      nohup node "$SERVER_JS" >> "$LOG_FILE" 2>&1 &
      echo $! > "$PID_FILE"
    )
  fi
  _wait_http || true
  ok "Server started (PID $(server_pid)) - log: $COMMAND_NAME logs"
}

cmd_stop() {
  if use_systemd && service_installed; then
    if service_active; then
      info "Stopping systemd service ..."
      systemctl stop "$SERVICE_NAME" || true
      ok "Server stopped."
    else
      info "Server is not running."
    fi
    return 0
  fi
  if is_running; then
    pid="$(server_pid)"
    info "Stopping server (PID $pid) ..."
    kill "$pid" 2>/dev/null || true
    n=0
    while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 20 ]; do
      sleep 1; n=$((n+1))
    done
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
    rm -f "$PID_FILE"
    ok "Server stopped."
  else
    info "Server is not running."
  fi
}

cmd_restart() { cmd_stop; sleep 1; cmd_start; }

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
    warn "Could not query /api/status (server may still be warming up)."
  fi
}

cmd_logs() {
  if use_systemd && service_installed; then
    shift_n="${1:-50}"
    journalctl -u "$SERVICE_NAME" -n "$shift_n" --no-pager
    return 0
  fi
  [ -f "$LOG_FILE" ] || die "No log file yet - start the server first."
  tail -n "${1:-50}" "$LOG_FILE"
}

# --- doctor ----------------------------------------------------------------
cmd_doctor() {
  _exports
  rc=0
  printf '%s== Smopi File Share diagnostic ==%s\n\n' "$C_CYAN" "$C_RESET"

  # Node
  if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
    if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then ok "node $(node -v)"
    else ko "node $(node -v) - version >= 22 required"; rc=1; fi
  else
    ko "node not found in PATH"; rc=1
  fi
  command -v npm >/dev/null 2>&1 && ok "npm $(npm -v)" || { ko "npm not found"; rc=1; }

  # Build artifact
  if [ -f "$SERVER_JS" ]; then ok "build present (dist/server.cjs)"
  else ko "dist/server.cjs missing - run: $COMMAND_NAME setup"; rc=1; fi
  if [ -d "$APP_DIR/dist/assets" ]; then ok "client assets present"
  else warn "dist/assets missing - run: $COMMAND_NAME build"; fi
  [ -d "$APP_DIR/node_modules" ] && ok "node_modules present" \
    || { ko "node_modules missing - run: $COMMAND_NAME setup"; rc=1; }

  # .env
  if [ -f "$ENV_FILE" ]; then
    ok ".env present ($ENV_FILE)"
    perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
    case "$perms" in
      600|400) ok ".env permissions $perms" ;;
      *) warn ".env permissions $perms - consider: chmod 600 $ENV_FILE" ;;
    esac
    if [ -z "${SHARE_PASSWORD:-}" ] && [ -z "${PASSWORD:-}" ]; then
      warn "SHARE_PASSWORD not set - a random one is generated at each boot"
    else
      ok "SHARE_PASSWORD configured"
    fi
    if [ -z "${OWNER_SESSION_SECRET:-}" ]; then
      warn "OWNER_SESSION_SECRET unset - every guest with the password is admin"
    else
      ok "OWNER_SESSION_SECRET set (owner/guest split active)"
    fi
  else
    warn ".env missing - run: $COMMAND_NAME env"
  fi

  # Share dir
  SHARE_PATH="${SHARE_DIR:-$APP_DIR/shared_files}"
  if [ -d "$SHARE_PATH" ]; then
    if [ -w "$SHARE_PATH" ]; then ok "share dir writable ($SHARE_PATH)"
    else ko "share dir NOT writable ($SHARE_PATH)"; rc=1; fi
  else
    warn "share dir missing ($SHARE_PATH) - it is created on demand"
  fi

  # Port
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
      if is_running; then ok "port $PORT in use by this server"
      else warn "port $PORT already in use by ANOTHER process"; fi
    else
      ok "port $PORT free"
    fi
  fi

  # Disk
  avail_mb="$(df -Pm "$APP_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
  case "$avail_mb" in
    ''|*[!0-9]*) ;;
    *)
      if [ "$avail_mb" -lt 200 ]; then ko "low disk: ${avail_mb} MB free"; rc=1
      elif [ "$avail_mb" -lt 1000 ]; then warn "disk: ${avail_mb} MB free"
      else ok "disk: ${avail_mb} MB free"; fi ;;
  esac

  # Runtime
  if is_running; then
    ok "server running (PID $(server_pid))"
    curl -fsS "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1 \
      && ok "HTTP /api/status responding" \
      || { ko "server process up but HTTP not responding"; rc=1; }
  else
    info "server not running (start: $COMMAND_NAME start)"
  fi

  # Supervision mode
  if use_systemd; then
    service_installed && ok "systemd unit installed" || info "systemd available (unit not yet installed)"
  else
    info "systemd unavailable - nohup mode"
  fi

  printf '\n'
  [ "$rc" -eq 0 ] && ok "No blocking problem detected." || ko "Blocking problems found (see above)."
  return $rc
}

cmd_dev() {
  node_detect
  _exports
  info "Dev server (Vite HMR) on port $PORT - Ctrl+C to stop."
  ( cd "$APP_DIR" && npm run dev )
}

cmd_version() {
  echo "Smopi File Share @ $APP_DIR"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" log -1 --format='commit %h  %s' 2>/dev/null || true
    echo "branch $(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
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

# --- .env wizard -----------------------------------------------------------
_rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-12}"
  else node -e "console.log(require('crypto').randomBytes(${1:-12}).toString('hex'))"
  fi
}

_env_get() { [ -f "$ENV_FILE" ] && grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
_env_put() {
  key="$1"; val="$2"
  touch "$ENV_FILE"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    tmp="$(mktemp)"
    grep -vE "^${key}=" "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

_wizard() {
  [ -t 0 ] || die "The wizard needs an interactive terminal. Use: $COMMAND_NAME env set KEY VALUE"
  [ -f "$ENV_FILE" ] || { cp "$APP_DIR/.env.example" "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"; }
  printf '%s== .env wizard (Enter keeps the current value) ==%s\n\n' "$C_CYAN" "$C_RESET"

  cur="$(_env_get SHARE_PASSWORD)"
  printf 'Share password [%s]: ' "${cur:-generate}"
  IFS= read -r ans
  if [ -n "$ans" ]; then _env_put SHARE_PASSWORD "$ans"
  elif [ -z "$cur" ]; then g="$(_rand_hex 12)"; _env_put SHARE_PASSWORD "$g"; ok "Generated: $g"; fi

  cur="$(_env_get PORT)"
  printf 'HTTP port [%s]: ' "${cur:-3000}"
  IFS= read -r ans
  [ -n "$ans" ] && _env_put PORT "$ans" || _env_put PORT "${cur:-3000}"

  cur="$(_env_get SHARE_EXPIRY)"
  printf 'Share lifetime in seconds, 0 = never [%s]: ' "${cur:-1800}"
  IFS= read -r ans
  [ -n "$ans" ] && _env_put SHARE_EXPIRY "$ans" || _env_put SHARE_EXPIRY "${cur:-1800}"

  cur="$(_env_get SHARE_DIR)"
  printf 'Shared files directory [%s]: ' "${cur:-$APP_DIR/shared_files}"
  IFS= read -r ans
  [ -n "$ans" ] && _env_put SHARE_DIR "$ans" || _env_put SHARE_DIR "${cur:-$APP_DIR/shared_files}"

  printf '\nOwner/guest split: without it, every guest holding the share\npassword can delete files and stop the share.\n'
  printf 'Enable owner secret? [Y/n] '
  IFS= read -r ans
  case "$ans" in
    [Nn]*) ;;
    *)
      cur="$(_env_get OWNER_SESSION_SECRET)"
      if [ -n "$cur" ]; then ok "OWNER_SESSION_SECRET already set (kept)."
      else s="$(_rand_hex 24)"; _env_put OWNER_SESSION_SECRET "$s"; ok "Generated: $s"
           warn "Save it - it is required by POST /api/login-owner."; fi ;;
  esac

  printf '\nGemini API key (optional, blank = local Smopi engine) [%s]: ' \
    "$( [ -n "$(_env_get GEMINI_API_KEY)" ] && echo 'set' || echo 'none')"
  IFS= read -r ans
  [ -n "$ans" ] && _env_put GEMINI_API_KEY "$ans"

  chmod 600 "$ENV_FILE" 2>/dev/null || true
  printf '\n'; ok "Configuration written to $ENV_FILE"
  is_running && warn "Restart to apply: $COMMAND_NAME restart" || true
}

cmd_env() {
  sub="${1:-wizard}"
  shift 2>/dev/null || true
  case "$sub" in
    wizard) _wizard ;;
    init)
      if [ -f "$ENV_FILE" ]; then warn ".env already exists - not overwriting."
      else cp "$APP_DIR/.env.example" "$ENV_FILE" && chmod 600 "$ENV_FILE" && ok ".env created."; fi ;;
    path) echo "$ENV_FILE" ;;
    show)
      [ -f "$ENV_FILE" ] || { info "No .env yet - run: $COMMAND_NAME env"; return 0; }
      while IFS= read -r line; do
        case "$line" in ''|'#'*) continue ;; esac
        key="${line%%=*}"; val="${line#*=}"
        case "$key" in
          *PASSWORD*|*SECRET*|*KEY*|*TOKEN*)
            if [ -z "$val" ]; then shown="(empty)"; else shown="${val%"${val#?}"}***(${#val} chars)"; fi ;;
          *) shown="$val" ;;
        esac
        printf '  %s = %s\n' "$key" "$shown"
      done < "$ENV_FILE" ;;
    get)
      [ -n "${1:-}" ] || die "Usage: $COMMAND_NAME env get KEY"
      _env_get "$1" ;;
    set)
      [ -n "${1:-}" ] && [ $# -ge 2 ] || die "Usage: $COMMAND_NAME env set KEY VALUE"
      k="$1"; shift; _env_put "$k" "$*"; ok "$k set." ;;
    unset)
      [ -n "${1:-}" ] || die "Usage: $COMMAND_NAME env unset KEY"
      [ -f "$ENV_FILE" ] && sed -i "/^${1}=/d" "$ENV_FILE" || true
      ok "$1 removed." ;;
    *) die "Unknown env subcommand: $sub (use: wizard|init|path|show|get|set|unset)" ;;
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
      *) die "Refusing to uninstall non-interactively. Use: $COMMAND_NAME uninstall --keep-files | --remove-files" ;;
    esac
  fi

  cmd_stop
  if use_systemd && service_installed; then cmd_service remove || true; fi

  BIN_DIR="$(cat "$RUN_DIR/bin_dir" 2>/dev/null || true)"
  if [ -n "$BIN_DIR" ] && [ -L "$BIN_DIR/$COMMAND_NAME" ]; then
    rm -f "$BIN_DIR/$COMMAND_NAME" || true
    ok "Removed launcher: $BIN_DIR/$COMMAND_NAME"
  fi

  for prof in "$HOME/.profile" "$HOME/.bashrc"; do
    [ -f "$prof" ] || continue
    sed -i '/# Added by Smopi File Share (sdf) installer/d' "$prof" 2>/dev/null || true
    [ -n "$BIN_DIR" ] && sed -i "\|export PATH=\"$BIN_DIR:\$PATH\"|d" "$prof" 2>/dev/null || true
  done

  SHARED="${SHARE_DIR:-$APP_DIR/shared_files}"
  if [ "$KEEP_FILES" = "no" ]; then
    if [ -d "$SHARED" ] && [ -n "$(ls -A "$SHARED" 2>/dev/null)" ]; then
      warn "Deleting shared files at $SHARED"
      rm -rf "$SHARED"
    fi
  else
    KEEP_COPY=""
    case "$SHARED" in
      "$APP_DIR"/*)
        KEEP_COPY="${TMPDIR:-/tmp}/smopi-shared-$(date +%s)"
        if [ -d "$SHARED" ] && [ -n "$(ls -A "$SHARED" 2>/dev/null)" ]; then
          mv "$SHARED" "$KEEP_COPY" && warn "Shared files moved to $KEEP_COPY"
        fi ;;
      *) warn "Keeping shared files at $SHARED (outside the install dir)." ;;
    esac
  fi

  rm -rf "$APP_DIR"
  ok "Smopi File Share removed."
}

usage() { sed -n '3,22p' "$SRC" | sed 's/^# \{0,1\}//'; }

case "${1:-help}" in
  setup)                  cmd_setup ;;
  build)                  cmd_build ;;
  test)                   cmd_test ;;
  start)                  shift 2>/dev/null || true; cmd_start "$@" ;;
  dev)                    shift 2>/dev/null || true; cmd_dev "$@" ;;
  stop)                   cmd_stop ;;
  restart)                cmd_restart ;;
  status)                 cmd_status ;;
  doctor)                 cmd_doctor ;;
  logs)                   shift 2>/dev/null || true; cmd_logs "$@" ;;
  env)                    shift 2>/dev/null || true; cmd_env "$@" ;;
  service)                shift 2>/dev/null || true; cmd_service "$@" ;;
  update)                 cmd_update ;;
  version|--version|-V)   cmd_version ;;
  uninstall)              shift 2>/dev/null || true; cmd_uninstall "$@" ;;
  help|-h|--help)         usage ;;
  *) die "Unknown command: ${1:-} (try: $COMMAND_NAME help)" ;;
esac
