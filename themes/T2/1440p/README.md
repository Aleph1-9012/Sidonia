# Sidonia T2 — Cyber Red Structural Grid (1440p)

Required framebuffer: **2560×1440**. This profile has absolute pixel geometry and is not a fallback for another resolution.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t2-1440p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain dynamic and come from the existing GRUB configuration.

Known limitation: Stock GRUB supplies one font and style per live title, so the reference's separate large number and smaller title cannot both remain dynamic.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.

