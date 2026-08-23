#!/usr/bin/env bash
set -Eeuo pipefail

if test "${EUID:-$(id -u)}" -ne 0; then
    echo "Run the installer with sudo:" >&2
    echo "  sudo ./install.sh" >&2
    exit 1
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_THEMES="$REPO_ROOT/themes"
SOURCE_COMMAND="$REPO_ROOT/bin/sidonia-theme"
INSTALL_ROOT="${SIDONIA_INSTALL_ROOT:-/usr/local/share/sidonia}"
COMMAND_PATH="${SIDONIA_COMMAND_PATH:-/usr/local/bin/sidonia-theme}"
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
SUCCESS=1

echo
echo "Sidonia is installed."
echo "Command: sidonia-theme"

if test "${1:-}" = "--no-apply"; then
    echo "No GRUB theme was changed."
    echo "Choose one later with: sudo sidonia-theme set T4 1440p"
    exit 0
fi

if test "$#" -gt 0; then
    export SIDONIA_ASSET_ROOT="$INSTALL_ROOT/themes"
    export SIDONIA_INSTALL_ROOT="$INSTALL_ROOT"
    export SIDONIA_COMMAND_PATH="$COMMAND_PATH"
    "$COMMAND_PATH" set "$@"
    exit 0
fi

if test -t 0 && test -t 1; then
    echo
    echo "Choose a theme:"
    echo "  1) T1 — Industrial Device Frame"
    echo "  2) T2 — Cyber Red Structural Grid"
    echo "  3) T3 — STARFIX Network Map"
    echo "  4) T4 — Maintenance Console"
    printf 'Theme [4]: '
    read -r THEME_CHOICE
    THEME_CHOICE="${THEME_CHOICE:-4}"

    echo
    echo "Choose a display profile:"
    echo "  1) 720p  — 1280×720"
    echo "  2) 1080p — 1920×1080"
    echo "  3) 1440p — 2560×1440 and larger"
    printf 'Profile [3]: '
    read -r PROFILE_CHOICE
    PROFILE_CHOICE="${PROFILE_CHOICE:-3}"

    case "$PROFILE_CHOICE" in
        1) PROFILE_CHOICE="720p" ;;
        2) PROFILE_CHOICE="1080p" ;;
        3) PROFILE_CHOICE="1440p" ;;
        *)
            echo "Unknown profile selection: $PROFILE_CHOICE" >&2
            exit 1
            ;;
    esac

    export SIDONIA_ASSET_ROOT="$INSTALL_ROOT/themes"
    export SIDONIA_INSTALL_ROOT="$INSTALL_ROOT"
    export SIDONIA_COMMAND_PATH="$COMMAND_PATH"
    "$COMMAND_PATH" set "$THEME_CHOICE" "$PROFILE_CHOICE"
    exit 0
fi

echo
echo "No interactive terminal was detected, so GRUB was not changed."
echo "Choose a theme with: sudo sidonia-theme set T4 1440p"
