# Sidonia GRUB renderer

This directory contains the shared menu renderer and prebuilt modules for
GRUB 2.14, `x86_64-efi` and `i386-pc`. Normal installation does not build them.
The installer verifies `SHA256SUMS` before copying the modules.

The viewer keeps GRUB's normal menu input and boot actions. It wraps input
polling only while its menu is active, renders animation frames during idle
polls, and restores input callbacks when the menu closes. Menu scrolling uses
a complete list redraw. Other selection changes use the affected rectangles.
Echelon's generated glyphs are cached for the lifetime of the menu view.

Closing the menu restores the full-screen graphical terminal before GRUB runs
the selected entry. Loading messages, authentication prompts, and errors remain
visible without leaving the theme behind a small terminal window. Quiet entries
get a `Booting...` message, preserved across GRUB's first terminal clear. This
adds no wait and does not alter the entry's boot commands. Returning from an
entry, submenu, editor, or console redraws the theme.

`list-2.14.h` contains the private list layout from GNU GRUB 2.14. This is not a
stable ABI; do not enable these binaries on another GRUB version without
reviewing its source, rebuilding, and testing both platforms. The installer
checks the configuration generator's version again on each GRUB configuration
update, so a later GRUB upgrade disables the incompatible extension. A
mismatched or stale GRUB core installation must be corrected through the
distribution's normal GRUB update procedure.

To rebuild, unpack the official GNU GRUB 2.14 source release and run:

```bash
bash bin/renderer/build.sh /path/to/grub-2.14 /tmp/sidonia-grub-build
```

Maintainers need GCC with x86-64 and i386 support, Make, and GRUB's configure
dependencies. The build uses the upstream module compiler flags and module
verifier. Source releases are available from
[GNU's GRUB archive](https://ftp.gnu.org/gnu/grub/).

The renderer and derived GRUB declarations are licensed under GPL-3.0-or-later.
See [COPYING](COPYING). The rest of Sidonia retains its existing licenses.
