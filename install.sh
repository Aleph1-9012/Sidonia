#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Aleph1-9012

set -Eeuo pipefail

if test "${EUID:-$(id -u)}" -ne 0; then
    echo "Run the installer with sudo:" >&2
    echo "  sudo ./install.sh" >&2
    exit 1
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_THEMES="$REPO_ROOT/themes"
SOURCE_COMMAND="$REPO_ROOT/bin/sidonia"
INSTALL_ROOT="${SIDONIA_INSTALL_ROOT:-/usr/local/share/sidonia}"
COMMAND_PATH="${SIDONIA_COMMAND_PATH:-/usr/local/bin/sidonia}"
LEGACY_COMMAND_PATH="${SIDONIA_LEGACY_COMMAND_PATH:-$(dirname "$COMMAND_PATH")/sidonia-theme}"
STAGE=""
OLD_INSTALL=""
SUCCESS=0

usage() {
    cat <<'EOF'
Usage:
  sudo ./install.sh
  sudo ./install.sh THEME PROFILE [--gfxmode WIDTHxHEIGHT]
  sudo ./install.sh --no-apply

Examples:
  sudo ./install.sh T4 1440p
  sudo ./install.sh T2 1080p
EOF
}

cleanup() {
    local STATUS=$?

    trap - EXIT
    set +e
    test -z "$STAGE" || rm -rf -- "$STAGE"
    if test "$SUCCESS" -ne 1 && test -n "$OLD_INSTALL" && test -d "$OLD_INSTALL"; then
        rm -rf -- "$INSTALL_ROOT"
        mv -- "$OLD_INSTALL" "$INSTALL_ROOT"
    elif test "$SUCCESS" -eq 1 && test -n "$OLD_INSTALL"; then
        rm -rf -- "$OLD_INSTALL"
    fi
    exit "$STATUS"
}
trap cleanup EXIT

test -d "$SOURCE_THEMES" || {
    echo "Theme directory is missing: $SOURCE_THEMES" >&2
    exit 1
}
test -f "$SOURCE_COMMAND" || {
    echo "Theme manager is missing: $SOURCE_COMMAND" >&2
    exit 1
}

if test "${1:-}" = "--help" || test "${1:-}" = "-h"; then
    usage
    exit 0
fi

for THEME in T1 T2 T3 T4; do
    for PROFILE in 720p 1080p 1440p; do
        test -f "$SOURCE_THEMES/$THEME/$PROFILE/theme.txt"
        test -f "$SOURCE_THEMES/$THEME/$PROFILE/background.png"
    done
done

install -d -o root -g root -m 0755 "$(dirname "$INSTALL_ROOT")"
STAGE="$(mktemp -d "$(dirname "$INSTALL_ROOT")/.sidonia.new.XXXXXX")"
umask 022
cp -R --no-preserve=ownership -- "$SOURCE_THEMES" "$STAGE/themes"
install -o root -g root -m 0644 "$REPO_ROOT/LICENSE" "$STAGE/LICENSE"
install -o root -g root -m 0644 "$REPO_ROOT/NOTICE.md" "$STAGE/NOTICE.md"

if test -e "$INSTALL_ROOT"; then
    OLD_INSTALL="$(dirname "$INSTALL_ROOT")/.sidonia.old.$$"
    test ! -e "$OLD_INSTALL"
    mv -- "$INSTALL_ROOT" "$OLD_INSTALL"
fi
mv -- "$STAGE" "$INSTALL_ROOT"
STAGE=""

install -D -o root -g root -m 0755 "$SOURCE_COMMAND" "$COMMAND_PATH"
if test "$LEGACY_COMMAND_PATH" != "$COMMAND_PATH"; then
    rm -f -- "$LEGACY_COMMAND_PATH"
fi
SUCCESS=1

echo
echo "Sidonia is installed."
echo "Run the theme chooser with:"
echo "  sudo sidonia"

if test "${1:-}" = "--no-apply"; then
    echo "No GRUB theme was changed."
    echo "Choose one later with: sudo sidonia"
    exit 0
fi

export SIDONIA_ASSET_ROOT="$INSTALL_ROOT/themes"
export SIDONIA_INSTALL_ROOT="$INSTALL_ROOT"
export SIDONIA_COMMAND_PATH="$COMMAND_PATH"
export SIDONIA_LEGACY_COMMAND_PATH="$LEGACY_COMMAND_PATH"

if test "$#" -gt 0; then
    "$COMMAND_PATH" set "$@"
    exit 0
fi

if test -t 0 && test -t 1; then
    "$COMMAND_PATH" choose
    exit 0
fi

echo
echo "No interactive terminal was detected, so GRUB was not changed."
echo "Choose a theme with: sudo sidonia"
