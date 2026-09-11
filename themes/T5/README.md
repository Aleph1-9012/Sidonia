# T5 Echelon

Install through Sidonia, for example:

```bash
sudo ./install.sh T5 1440p --gfxmode 2560x1600
```

Profiles are 720p at 1280×720, 1080p at 1920×1080, and 1440p at 2560×1440.
The 1440p canvas stays centered at that size on larger displays, with black
padding. Fonts, card geometry and the timer stay aligned without scaling.

The installer and each subsequent `grub-mkconfig -o FILE` generate artwork
from your current boot entries. Names, order, boot commands, IDs and entry
arguments come from GRUB. The theme does not add a memory tester, firmware
entry or any other action. Escape opens the original menu.

One to four entries use cards. Larger menus, BLS entries, external custom.cfg
files and titles resolved at boot use the complete standard GRUB list.
Long titles shrink or use an ellipsis on the cards; the entry editor and
original menu retain their full names.

Runtime generation requires Python 3, Pillow and rsvg-convert from librsvg.
The editable SVG, Inconsolata fonts and Noto Sans JP font are bundled in
lib/cascade. Run `python3 tools/build_cascade_theme.py` to rebuild the three
base profiles and the project preview. The generated boot menus are created
during installation.
