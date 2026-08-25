# Sidonia T1 — Frame 704 (1080p)

Required framebuffer: **1920×1080**. This profile has absolute pixel geometry and is not a fallback for another resolution.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t1-1080p.pf2`
- `f/sidonia-t1-1080p-upper.pf2`
- `f/sidonia-t1-1080p-lower.pf2`
- `selectors/*.png`
- `progress/*.png`

Load `fonts/sidonia-t1-1080p.pf2` through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. GRUB's standard theme loader loads the two role-specific PF2 files under `f/`. Production menu titles remain dynamic and come from the existing GRUB configuration.

The upper `T-%02d` counter, lower zero-padded counter, and thin right-anchored remaining-time line all use GRUB's native timeout value. They begin at the user's configured timeout; the theme does not change `GRUB_TIMEOUT`. Grey shows elapsed time and red shows remaining time.

The menu uses Space Mono Bold at the 46px master-design scale. Both countdown labels also use Space Mono Bold at their independently scaled reference sizes.

See the repository/package `NOTICE.md` for artwork and font notices.
