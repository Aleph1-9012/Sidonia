# Sidonia T2 — Cyber Red Structural Grid (720p)

Required framebuffer: **1280×720**. This profile has absolute pixel geometry and is not a fallback for another resolution.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t2-720p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain live, are not renamed or baked into the selector artwork, and come from the existing GRUB configuration. The selected-row centre is a flat 2D red surface; its structural edge slices remain unchanged.

The timer is driven entirely by stock GRUB's native `__timeout__` components. `T-%02d` is the live, zero-padded remaining time, while the flat red twelve-cell track advances from left to right to show elapsed time. Cancelling the timeout removes the live label and fill without exposing the former static `T-06` state.

Known limitation: Stock GRUB supplies one font and style per live title, so the reference's separate large number and smaller title cannot both remain dynamic.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.
