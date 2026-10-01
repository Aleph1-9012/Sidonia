#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Maintainer tool. Users install the bundled modules without a compiler.
set -Eeuo pipefail
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
GRUB_SOURCE=$(realpath "${1:?Usage: build.sh GRUB_2.14_SOURCE BUILD_DIRECTORY}")
mkdir -p -- "${2:?Build directory is required}"
BUILD=$(realpath "$2")
grep -Fq 'AC_INIT([GRUB],[2.14],' "$GRUB_SOURCE/configure.ac"
for TARGET in x86_64-efi i386-pc; do
    mkdir -p -- "$BUILD/$TARGET" "$SOURCE/$TARGET"
    (
        cd -- "$BUILD/$TARGET"
        if test ! -f Makefile; then
            "$GRUB_SOURCE/configure" --with-platform="${TARGET#*-}" --target="${TARGET%-*}" \
                --disable-werror --disable-nls --disable-grub-mkfont \
                --disable-grub-mount --disable-device-mapper --disable-libzfs
        fi
        make -C grub-core -f Makefile -f "$SOURCE/module.mk" \
            SIDONIA_SOURCE="$SOURCE/sidonia_motion.c" sidonia_motion.mod
    )
    cp -- "$BUILD/$TARGET/grub-core/sidonia_motion.mod" "$SOURCE/$TARGET/"
done
(cd -- "$SOURCE" && sha256sum */sidonia_motion.mod > SHA256SUMS)
