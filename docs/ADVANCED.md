# Advanced installation and troubleshooting

The guided installer is the recommended way to use Sidonia. This document is
for manual installations, unusual GRUB layouts, and recovery.

## What the theme manager changes

`sidonia-theme set` performs four scoped operations:

1. Saves the current `/etc/default/grub` and active `grub.cfg`.
2. Copies one selected theme profile into GRUB's theme directory.
3. Updates only `GRUB_THEME`, `GRUB_FONT`, `GRUB_GFXMODE`,
   `GRUB_GFXPAYLOAD_LINUX`, and the graphical terminal output setting.
4. Generates a candidate `grub.cfg`, validates it with `grub-script-check`,
   then activates it atomically.

It does not run `grub-install` and does not edit menu entries, kernel
arguments, disks, partitions, EFI variables, or Secure Boot.

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

## Recovery

If Linux still boots but the selected appearance is unsuitable, restore the
last configuration:

```bash
sudo sidonia-theme rollback
```

To return to the exact GRUB state saved before Sidonia was first installed:

```bash
sudo sidonia-theme uninstall
```

If GRUB cannot reach a graphical mode, boot through a known-good entry or
recovery medium and restore the files saved below `/var/lib/sidonia/original`.

## Stock-GRUB limitations

- Live menu titles come from the existing GRUB configuration.
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
