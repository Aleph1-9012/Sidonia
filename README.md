# Sidonia GRUB Themes

Four resolution-specific Sidonia themes for stock GRUB. Every theme is available for exactly `1280×720`, `1920×1080`, and `2560×1440`; choose the folder that matches the framebuffer mode GRUB actually uses.

## T1 — Industrial Device Frame

![T1 preview](previews/T1.png)

- Resolutions: `720p`, `1080p`, `1440p`
- Release archive: `Sidonia-T1.zip`

## T2 — Cyber Red Structural Grid

![T2 preview](previews/T2.png)

- Resolutions: `720p`, `1080p`, `1440p`
- Release archive: `Sidonia-T2.zip`

## T3 — STARFIX Network Map

![T3 preview](previews/T3.png)

- Resolutions: `720p`, `1080p`, `1440p`
- Release archive: `Sidonia-T3.zip`

## T4 — Maintenance Console

![T4 preview](previews/T4.png)

- Resolutions: `720p`, `1080p`, `1440p`
- Release archive: `Sidonia-T4.zip`

## Manual installation

This repository has no installer and never edits the host boot configuration. Back up the existing GRUB configuration before making system changes.

1. Confirm that the firmware and GRUB support the intended framebuffer mode.
2. Copy one exact-resolution directory to the system's GRUB theme directory. For example, copy `themes/T1/1080p` to `/boot/grub/themes/Sidonia-T1-1080p`.
3. Configure GRUB to use that folder's `theme.txt`, its exact `GRUB_GFXMODE`, and its PF2 file through `GRUB_FONT`. For the example above, the three values are:

   ```text
   GRUB_GFXMODE=1920x1080
   GRUB_THEME=/boot/grub/themes/Sidonia-T1-1080p/theme.txt
   GRUB_FONT=/boot/grub/themes/Sidonia-T1-1080p/fonts/sidonia-t1-1080p.pf2
   ```

4. Regenerate the GRUB configuration using the documented procedure for the installed distribution, then reboot only when comfortable with the recovery path.

Paths differ across distributions, including `/boot/grub`, `/boot/grub2`, and EFI-specific layouts. Do not run `grub-install` merely to apply a theme.

## Stock-GRUB limitations

- Production menu titles remain dynamic; fixture labels exist only in the preview images.
- T2 cannot reproduce the reference's separately styled number and title with one stock-GRUB menu font.
- T3's continuous timeout fill can bridge the gaps between its static segmented slots while advancing.
- T4 uses negative item spacing for the intended overlapping selector. It passed the tested QEMU BIOS/UEFI matrix; other GRUB builds may behave differently.
- Each resolution is independent. GRUB does not automatically fall back to a different folder when the configured video mode is unavailable.

## QEMU validation

Tested on 2026-08-18 using QEMU 11.0.2 with SeaBIOS 1.17.0-2 and edk2-ovmf 202605-1. Test images used GRUB 2:2.14-1 and xorriso 1.5.8.pl02.

- Selector matrix: 24/24 passed
- Timeout captures: 4/4 reviewed
- Tested modes: `1280×720`, `1920×1080`, `2560×1440`
- Menu navigation and harmless entry activation passed

Real hardware and other GRUB or firmware versions may behave differently.

## Safety and licensing

The project only contains theme assets and documentation. It does not modify `/boot`, disks, partitions, EFI variables, Secure Boot, menu entries, kernel arguments, or firmware settings.

Project licensing is in [LICENSE](LICENSE). Artwork and font notices are in [NOTICE.md](NOTICE.md).
