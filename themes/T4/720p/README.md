# Sidonia T4 — Maintenance Console (720p)

Required framebuffer: **1280×720**. This profile has absolute pixel geometry and is not a fallback for another resolution.

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t4-720p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain dynamic and come from the existing GRUB configuration.

The `T-%02d` counter and the thin header line use GRUB's native timeout value. They begin at the user's configured timeout; the theme does not change `GRUB_TIMEOUT`. Black advances from the left as time elapses and red shows the remaining time. Interrupting the countdown removes both live components cleanly.

Transparent style padding confines GRUB's mandatory 200×28 progress-widget allocation to the intended 45×4 header line. The progress widget intentionally has no `text` property because an empty template still makes GRUB reserve font space.

Known limitation: The intended overlap uses negative item spacing. Some GRUB builds may clamp or clip it; BIOS/UEFI capture testing is recommended.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.
