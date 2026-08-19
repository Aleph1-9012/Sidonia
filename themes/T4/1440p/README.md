# Sidonia T4 — Maintenance Console (1440p)

Design canvas: **2560×1440**. On framebuffers at least 2560 pixels wide and 1440 pixels high, the canvas is rendered unscaled and centred; unused space is filled with the theme desktop colour. Use the 1080p or 720p profile for smaller framebuffers.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t4-1440p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain dynamic and come from the existing GRUB configuration.

Known limitation: The intended overlap uses negative item spacing. Some GRUB builds may clamp or clip it; BIOS/UEFI capture testing is recommended.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.

