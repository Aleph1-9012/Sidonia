# Sidonia T1 — Frame 704 (1440p)

Minimum framebuffer: **2560×1440**. The 2560×1440 design is a fixed,
pixel-perfect canvas: it is centred without scaling or cropping on every
larger framebuffer, and all unused framebuffer space is solid black. When a
dimension leaves an odd number of unused pixels, the two opposite margins
differ by no more than one pixel.

Reference margins:

| Framebuffer | Left / right | Top / bottom |
| --- | ---: | ---: |
| 2560×1440 | 0 / 0 | 0 / 0 |
| 2560×1600 | 0 / 0 | 80 / 80 |
| 3440×1440 | 440 / 440 | 0 / 0 |
| 3840×2160 | 640 / 640 | 360 / 360 |
| 3840×2400 | 640 / 640 | 480 / 480 |

This is a stock-GRUB runtime theme, not an installer. It does not alter boot entries, timeout policy, kernel arguments, disks, firmware, Secure Boot, or host configuration.

Runtime files:

- `theme.txt`
- `background.png`
- `fonts/sidonia-t1-1440p.pf2`
- `selectors/*.png`
- `progress/*.png`

Load the PF2 through the distribution's `GRUB_FONT` mechanism before selecting `theme.txt`. Production menu titles remain dynamic and come from the existing GRUB configuration.

The upper `T-%02d` counter, lower zero-padded counter, and thin right-anchored remaining-time line all use GRUB's native timeout value. They begin at the user's configured timeout; the theme does not change `GRUB_TIMEOUT`. Grey shows elapsed time and red shows remaining time.

Known limitation: The live menu font is a stock-GRUB DejaVu approximation.

See the repository/package `NOTICE.md` for artwork and DejaVu font notices.
