#!/bin/sh
# ============================================================================
#  FILE SHARE — uninstaller
#
#  Removes the `sdf` launcher and the install directory, and offers to remove
#  the shared files. Downloadables are never touched by default.
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/JCVERSA/smopi/main/scripts/uninstall.sh | sh
#
#  Or from an installed launcher:
#    sdf uninstall [--keep-files | --remove-files]
#
#  If you don't have sdf and want to remove the DEFAULT non-root install:
#    rm -rf ~/.local/share/smopi ~/.local/bin/sdf
# ============================================================================
set -eu

remove_always=0
remove_files=0
remove_files_set=0
DRY_RUN=0
KEEP_DIRS=""

usage() { sed -n '2,20p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --remove-files) remove_files=1; remove_files_set=1; shift ;;
    --keep-files)   remove_files=0; remove_files_set=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --help|-h)      usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

run() {
  echo "+ $*"
  [ "$DRY_RUN" -eq 1 ] || "$@"
}

ask_yes_no() { # $1 question - default no
  [ -t 0 ] || return 1
  printf '%s [y/N] ' "$1"
  IFS= read -r answer
  case "$answer" in [Yy]|[Yy][Ee][Ss]) return 0 ;; *) return 1 ;; esac
}

INSTALL_DIR="${FS_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/smopi}"
if [ "$(id -u)" -eq 0 ]; then
  INSTALL_DIR="${FS_INSTALL_DIR:-/opt/smopi}"
fi

if [ ! -d "$INSTALL_DIR" ]; then
  printf '[INFO] No installation found at %s - nothing to do.\n' "$INSTALL_DIR"
  # Still remove the symlink if it dangles.
  BIN_DIR="${FS_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
  [ -L "$BIN_DIR/sdf" ] && run rm -f "$BIN_DIR/sdf"
  printf '[OK] Clean.\n'
  exit 0
fi

# Stop a running server before touching anything.
if [ -f "$INSTALL_DIR/.sdf/server.pid" ]; then
  pid="$(cat "$INSTALL_DIR/.sdf/server.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf '[INFO] Stopping running server (PID %s)...\n' "$pid"
    run kill "$pid"
  fi
fi
if [ -x "$INSTALL_DIR/scripts/sdf.sh" ]; then
  sh "$INSTALL_DIR/scripts/sdf.sh" stop 2>/dev/null || true
fi

# Remove the `sdf` symlink (default user bin dir, and the one recorded by the installer).
BIN_DIR="$(cat "$INSTALL_DIR/.sdf/bin_dir" 2>/dev/null || true)"
[ -z "$BIN_DIR" ] && BIN_DIR="${FS_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
for b in "$BIN_DIR" "${XDG_BIN_HOME:-$HOME/.local/bin}" /usr/local/bin; do
  [ -L "$b/sdf" ] && run rm -f "$b/sdf"
done

# Remove PATH additions from the usual profiles (best effort).
for prof in "$HOME/.profile" "$HOME/.bashrc"; do
  [ -f "$prof" ] || continue
  grep -q '# Added by File Share (sdf) installer' "$prof" 2>/dev/null || continue
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ sed -i remove File Share PATH block from $prof"
  else
    sed -i '/# Added by File Share (sdf) installer/,+1d' "$prof"
  fi
done

SHARED="$INSTALL_DIR/shared_files"
if [ $remove_files_set -eq 0 ]; then
  if ask_yes_no "Remove the shared files ($SHARED) too?"; then
    remove_files=1
  fi
fi

if [ "$remove_files" -eq 1 ]; then
  if [ -d "$SHARED" ] && [ -n "$(ls -A "$SHARED" 2>/dev/null)" ]; then
    printf '[INFO] Deleting shared files at %s...\n' "$SHARED"
    run rm -rf "$SHARED"
  else
    printf '[INFO] No shared files to delete.\n'
  fi
else
  printf '[INFO] Shared files left in place at %s\n' "$SHARED"
fi

run rm -rf "$INSTALL_DIR"

printf '[OK] File Share removed.\n'
if [ $remove_files -eq 0 ]; then
  printf '[INFO] Your shared files were not modified.\n'
fi
if [ "$DRY_RUN" -eq 1 ]; then
  printf '[INFO] Dry run - nothing was changed.\n'
fi
