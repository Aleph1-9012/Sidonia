#!/usr/bin/env bash
# Assemble Echelon from release assets and literal native GRUB entries.
set -Eeuo pipefail
export LC_ALL=C

RUNTIME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
THEME=$(cd -- "${1:?Theme directory is required}" && pwd)
shift
MODE="" CONFIG=""
while (($#)); do
    case "$1" in
        --mode) MODE=${2:?Graphics mode is required}; shift 2 ;;
        --config) CONFIG=${2:?Configuration file is required}; shift 2 ;;
        *) printf 'Echelon: unknown argument: %s\n' "$1" >&2; exit 1 ;;
    esac
done
[[ "$MODE" =~ ^[0-9]+x[0-9]+$ ]] || { echo 'Echelon: one numeric graphics mode is required' >&2; exit 1; }
[[ "${THEME##*/}" =~ ^Sidonia-T5-(720p|1080p|1440p)$ ]] || { echo 'Echelon: invalid installed theme directory' >&2; exit 1; }
IFS=x read -r WIDTH HEIGHT < "$THEME/framebuffer"
case "$WIDTH"x"$HEIGHT" in
    1280x720|1920x1080|2560x1440) ;;
    *) echo 'Echelon: unsupported canvas' >&2; exit 1 ;;
esac
PLAIN_FONT=plain.pf2
[[ "$WIDTH" == 1920 ]] && PLAIN_FONT=ui.pf2
if [[ -z "$CONFIG" ]]; then
    [[ -f /proc/self/fd/1 ]] || { echo 'Echelon requires grub-mkconfig -o FILE' >&2; exit 1; }
    CONFIG=/proc/self/fd/1
fi
umask 077
mkdir -p -- "$THEME/generated"
ECHELON_WORK=$(mktemp -d "$THEME/generated/.echelon.XXXXXX")
trap 'rm -rf -- "$ECHELON_WORK"' EXIT
export ECHELON_WORK
# Copy before emitting anything, since stdout can be this same configuration.
exec {CONFIG_FD}< "$CONFIG"
cat <&"$CONFIG_FD" > "$ECHELON_WORK/input.cfg"
exec {CONFIG_FD}<&-

cat <<EOF
# Echelon entries assembled from the current GRUB configuration.
set sidonia_base_dir="\$prefix/themes/${THEME##*/}"
export sidonia_base_dir
function sidonia_plain_menu {
  terminal_output console
  unset theme
  set gfxmode=auto
  if loadfont "\$sidonia_base_dir/fonts/$PLAIN_FONT"; then
    set gfxterm_font='Cascade UI 18'
  else
    loadfont "\$prefix/fonts/unicode.pf2"
    set gfxterm_font='Unifont Regular 16'
  fi
  if terminal_output gfxterm; then true; else terminal_output console; fi
}
EOF
fallback() {
    printf '%s\n' '# Echelon used the complete original menu.' 'sidonia_plain_menu'
}
if [[ -f "$THEME/../../custom.cfg" ]]; then fallback; exit; fi
if ! awk -f "$RUNTIME/menu.awk" "$ECHELON_WORK/input.cfg"; then fallback; exit; fi
COUNT=$(cat "$ECHELON_WORK/count")
ECHELON_VARIANT=$THEME
[[ "$COUNT" == 4 ]] || ECHELON_VARIANT="$THEME/variants/$COUNT"
ECHELON_GENERATION=$(
    cat -- "$ECHELON_WORK/native.cfg" "$THEME/SHA256SUMS" \
        "$RUNTIME/runtime.sh" "$RUNTIME/menu.awk" "$RUNTIME/labels.awk" | sha256sum
)
ECHELON_GENERATION=${ECHELON_GENERATION:0:20}
TARGET="$THEME/generated/$ECHELON_GENERATION"
ECHELON_READY="$ECHELON_WORK/ready"
export ECHELON_VARIANT ECHELON_GENERATION ECHELON_READY
if [[ -d "$TARGET" ]]; then
    (cd -- "$TARGET" && sha256sum --quiet -c SHA256SUMS) >&2
else
    mkdir -- "$ECHELON_READY"
    cp -- "$ECHELON_VARIANT/background.png" "$ECHELON_VARIANT/foreground.png" "$ECHELON_READY/"
    # Only the four entry fonts have a generation-specific name. Timer fonts
    # remain prebuilt because their content never depends on boot entries.
    sed -E "s/Cascade library (labels|shapes|status|status-selected) /Cascade $ECHELON_GENERATION \1 /g" \
        "$ECHELON_VARIANT/theme.txt" > "$ECHELON_READY/theme.txt"
    cp -- "$THEME"/timer-*.pf2 "$ECHELON_READY/"
    cp -- "$THEME/fonts/ui.pf2" "$ECHELON_READY/ui.pf2"
    # Decompress completely before awk, so a damaged library cannot be mistaken
    # for a supported title with only some of its character data present.
    gzip -cd -- "$THEME/characters.gz" > "$ECHELON_WORK/characters"
    if ! awk -f "$RUNTIME/labels.awk" "$ECHELON_WORK/characters"; then fallback; exit; fi
    UI_SIZE=$((36*WIDTH/3840))
    ((UI_SIZE>=14)) || UI_SIZE=14
    {
        cat <<'EOF'
function sidonia_graphics {
  terminal_output console
  insmod all_video
  insmod gfxterm
  insmod gfxmenu
  insmod png
  set sidonia_font_error=0
EOF
        for FONT in labels shapes status status-selected timer-detail timer-fill timer-ink ui; do
            printf '  if loadfont "$sidonia_theme_dir/%s.pf2"; then true; else set sidonia_font_error=1; fi\n' "$FONT"
        done
        cat <<EOF
  set gfxterm_font='Cascade UI $UI_SIZE'
  export gfxterm_font
  set gfxmode=\$sidonia_gfxmode,sidonia_no_auto_fallback
  export gfxmode
  set theme="\$sidonia_theme_dir/theme.txt"
  export theme
  if [ "\$sidonia_font_error" = 0 ]; then terminal_output gfxterm; else false; fi
}
EOF
        cat <<'EOF'
set default="$sidonia_system_default"
set config_directory="$sidonia_native_config_directory"
set config_file="$sidonia_native_config_file"
set timeout_style=menu
set timeout=6
if [ "$sidonia_original_timeout" = -1 ]; then set timeout=-1; fi
if [ "$sidonia_original_timeout" = 0 ]; then set timeout=0; fi
EOF
        cat -- "$ECHELON_WORK/remaps.cfg"
        printf '\nif sidonia_graphics; then\n'
        cat -- "$ECHELON_WORK/body.cfg"
        cat <<'EOF'
else
  set sidonia_original_menu=1
  export sidonia_original_menu
  configfile "$prefix/grub.cfg"
fi
EOF
    } > "$ECHELON_READY/menu.cfg"
    CHECK=${SIDONIA_GRUB_SCRIPT_CHECK:-}
    if [[ -z "$CHECK" ]]; then
        CHECK=$(command -v grub-script-check || command -v grub2-script-check)
    fi
    "$CHECK" "$ECHELON_READY/menu.cfg" >&2
    (cd -- "$ECHELON_READY" && sha256sum ./*.pf2 ./*.png menu.cfg theme.txt > SHA256SUMS)
    mv -- "$ECHELON_READY" "$TARGET"
fi
cat <<EOF
set sidonia_gfxmode=$MODE
export sidonia_gfxmode
set sidonia_theme_dir="\$sidonia_base_dir/generated/$ECHELON_GENERATION"
export sidonia_theme_dir
EOF
cat <<'EOF'
if [ "$sidonia_original_menu" = 1 ]; then
  sidonia_plain_menu
  set timeout_style=menu
  set timeout=-1
else
EOF
sort -u -- "$ECHELON_WORK/exports.cfg"
cat <<'EOF'
  set sidonia_native_config_directory="$config_directory"
  export sidonia_native_config_directory
  set sidonia_native_config_file="$config_file"
  export sidonia_native_config_file
  set sidonia_system_default="$default"
  export sidonia_system_default
  set sidonia_original_timeout="$timeout"
  export sidonia_original_timeout
  configfile "$sidonia_theme_dir/menu.cfg"
  sidonia_plain_menu
  set timeout_style=menu
  set timeout=-1
fi
EOF
