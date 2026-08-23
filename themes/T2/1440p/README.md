# Sidonia T2 — Gridline (1440p)

Design canvas: **2560×1440**. On framebuffers at least 2560 pixels wide and 1440 pixels high, the canvas is rendered unscaled and centred; unused space is filled with the theme desktop colour. Use the 1080p or 720p profile for smaller framebuffers.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t2-1440p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain live, are not renamed or baked into the selector artwork, and come from the existing GRUB configuration. The selected-row centre is a flat 2D red surface; its structural edge slices remain unchanged.

The timer is driven entirely by stock GRUB's native `__timeout__` components. `T-%02d` is the live, zero-padded remaining time, while the flat red twelve-cell track advances from left to right to show elapsed time. Cancelling the timeout removes the live label and fill without exposing the former static `T-06` state.

Known limitation: Stock GRUB supplies one font and style per live title, so the reference's separate large number and smaller title cannot both remain dynamic.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.
