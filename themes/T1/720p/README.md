# Sidonia T1 — Industrial Device Frame (720p)

Required framebuffer: **1280×720**. This profile has absolute pixel geometry and is not a fallback for another resolution.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t1-720p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain dynamic and come from the existing GRUB configuration.

Known limitation: The live menu font is a stock-GRUB DejaVu approximation, and the continuous timeout fill can cover decorative ruler ticks while it advances.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.

