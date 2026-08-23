# Sidonia T4 — System Bay (1440p)

Design canvas: **2560×1440**. On framebuffers at least 2560 pixels wide and 1440 pixels high, the canvas is rendered unscaled and centred; unused space is filled with the theme desktop colour. Use the 1080p or 720p profile for smaller framebuffers.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t4-1440p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain dynamic and come from the existing GRUB configuration.

The `T-%02d` counter and the thin header line use GRUB's native timeout value. They begin at the user's configured timeout; the theme does not change `GRUB_TIMEOUT`. Black advances from the left as time elapses and red shows the remaining time. Interrupting the countdown removes both live components cleanly.

Transparent style padding confines GRUB's mandatory 200×28 progress-widget allocation to the intended 90×9 header line. The progress widget intentionally has no `text` property because an empty template still makes GRUB reserve font space.

Known limitation: The intended overlap uses negative item spacing. Some GRUB builds may clamp or clip it; BIOS/UEFI capture testing is recommended.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.
