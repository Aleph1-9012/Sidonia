# Advanced installation and troubleshooting

The guided installer is the recommended way to use Sidonia. This document is
for manual installations, unusual GRUB layouts, and recovery.

## What the theme manager changes

`sudo sidonia set` performs these operations:

1. Saves the current `/etc/default/grub` and active `grub.cfg`.
2. Copies one selected theme profile into GRUB's theme directory.
3. Updates `GRUB_THEME`, `GRUB_FONT`, `GRUB_GFXMODE`,
   `GRUB_GFXPAYLOAD_LINUX`, and the graphical terminal output setting.
4. Installs `/etc/grub.d/99_zz_sidonia` so the selected Sidonia theme is applied
   after earlier theme loaders. The previous loader is backed up with the configuration.
5. Generates a candidate `grub.cfg`, validates it with `grub-script-check`,
   then activates it atomically.

It does not run `grub-install` and does not edit menu entries, kernel
arguments, disks, partitions, EFI variables, or Secure Boot.

For Echelon, the late loader reads the candidate configuration through its
stdout file descriptor and generates cards from the current top-level entries.
The generated menu retains the native boot commands, IDs, arguments, generator
conditions and entry order. Submenus use a readable list and return to the cards.
Escape opens the complete original menu. No OS names or boot paths are built
into the shipped profiles, and the theme adds no extra boot actions.

Use `grub-mkconfig -o FILE` or the distribution's equivalent. The shell runtime
uses awk to assemble entry-name glyphs from the compressed character library.
It requires Bash, awk, gzip and standard system utilities, alongside GRUB's
configuration checker. It writes each entry generation to a separate
directory, checks it, and then emits the loader that selects it. Earlier assets
stay available while an update is being generated. An unsuccessful Sidonia
installation restores the previous configuration and artwork.

Normal Echelon generation writes only the boot menu and its required assets.
Python, Pillow and rsvg-convert are maintainer tools used to build release
artwork and character libraries. Fresh installations copy only the shell/awk
runtime. An upgrade preserves an already-installed legacy Python renderer
so rollback to the previous T5 version can still regenerate its artwork.

Backups are stored below `/var/lib/sidonia`. The first installation preserves
the original GRUB appearance; every later switch also keeps one-step rollback
data.

## Manual installation

Each directory below `themes/T1` through `themes/T4` is a complete,
resolution-specific GRUB theme.

1. Copy one profile to the GRUB theme directory, commonly
   `/boot/grub/themes` or `/boot/grub2/themes`.
2. Set the matching theme, font, and graphics mode in `/etc/default/grub`.
3. Generate a new configuration with the command documented by your
   distribution.
4. Validate the generated configuration before replacing the active one.

Example for T4 at 1920×1080:

```text
GRUB_TERMINAL_OUTPUT="gfxterm"
GRUB_GFXMODE="1920x1080"
GRUB_GFXPAYLOAD_LINUX=keep
GRUB_FONT="/boot/grub/themes/Sidonia-T4-1080p/fonts/sidonia-t4-1080p.pf2"
GRUB_THEME="/boot/grub/themes/Sidonia-T4-1080p/theme.txt"
```

GRUB paths vary between distributions. Common active configurations include
`/boot/grub/grub.cfg` and `/boot/grub2/grub.cfg`.

## Fixed-canvas profiles

The 720p and 1080p profiles use exact pixel geometry. Their configured GRUB
mode should match the profile.

The 1440p profiles use a fixed 2560×1440 canvas. They render without scaling
and remain centred on larger framebuffers such as 2560×1600 or 3840×2160.
Unused framebuffer space is filled by the theme desktop colour.

T5 uses the same three profiles. Selecting 1440p preserves an existing larger
numeric GRUB mode. You can also specify it, for example
`sudo sidonia set T5 1440p --gfxmode 3840x2160`. The artwork, glyphs and timer
share the same centered canvas, so none of them stretch with the framebuffer.
The manager rejects a mode smaller than the selected T5 canvas before activation.

Echelon's graphics loader includes an invalid final mode candidate before
GRUB's implicit `auto` candidate. In stock GRUB 2.14, a rejected requested
mode reaches this sentinel and returns failure. Echelon then exposes the
original text menu. This behavior has dedicated boot tests; it avoids drawing
fixed geometry at an unexpected resolution. The implementation follows
[GRUB's mode parser](https://github.com/rhboot/grub2/blob/master/grub-core/video/video.c)
and [gfxterm initialization](https://github.com/rhboot/grub2/blob/master/grub-core/term/gfxterm.c).

## Recovery

If Linux still boots but the selected appearance is unsuitable, restore the
last configuration:

```bash
sudo sidonia rollback
```

From Echelon itself, press Escape to use the original boot entries. Rollback
restores the previous configuration, fonts, artwork and late-loader state.

To return to the exact GRUB state saved before Sidonia was first installed:

```bash
sudo sidonia uninstall
```

If GRUB cannot reach a graphical mode, boot through a known-good entry or
recovery medium and restore the files saved below `/var/lib/sidonia/original`.

## Stock-GRUB limitations

- Live menu titles come from the existing GRUB configuration.
- T5 uses one to four cards. Larger menus use the complete native GRUB list.
  Boot Loader Specification entries, external `custom.cfg` files and titles
  resolved only at boot also keep the native list so no entries are omitted.
- Long T5 titles shrink to fit, then use an ellipsis when needed. Their full
  names remain available through Escape and the entry editor.
- T5's character library covers the bundled Inconsolata and Noto Sans JP fonts.
  Unsupported characters or invalid UTF-8 use the complete original menu.
- GRUB supplies one font and style per live title; T2 cannot independently
  style a number and its title while keeping both dynamic.
- T3's continuous timeout fill may bridge gaps between its static slots.
- T4 uses negative item spacing for its overlapping selector; GRUB builds that
  clamp negative spacing may render it differently.
- Firmware graphics-mode availability varies by machine. Sidonia cannot add a
  mode that the firmware or GRUB does not expose.

## Reporting a problem

Include the selected theme/profile, GRUB version, distribution, firmware mode
(BIOS or UEFI), framebuffer size, and a photo of the menu. Never publish
partition UUIDs, private boot parameters, or other machine-specific secrets.
