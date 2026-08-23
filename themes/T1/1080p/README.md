# Sidonia T1 — Frame 704 (1080p)

Required framebuffer: **1920×1080**. This profile has absolute pixel geometry and is not a fallback for another resolution.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t1-1080p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain dynamic and come from the existing GRUB configuration.

The upper `T-%02d` counter, lower zero-padded counter, and thin right-anchored remaining-time line all use GRUB's native timeout value. They begin at the user's configured timeout; the theme does not change `GRUB_TIMEOUT`. Grey shows elapsed time and red shows remaining time.

Known limitation: The live menu font is a stock-GRUB DejaVu approximation.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.
