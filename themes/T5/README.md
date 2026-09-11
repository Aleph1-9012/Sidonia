# T5 Echelon

Install through Sidonia, for example:

```bash
sudo ./install.sh T5 1440p --gfxmode 2560x1600
```

Profiles are 720p at 1280×720, 1080p at 1920×1080, and 1440p at 2560×1440.
The 1440p canvas stays centered at that size on larger displays, with black
padding. Fonts, card geometry and the timer stay aligned without scaling.

The installer and each subsequent `grub-mkconfig -o FILE` assemble labels
from prebuilt characters and your current boot entries. Names, order, boot commands, IDs and entry
arguments come from GRUB. The theme does not add a memory tester, firmware
entry or any other action. Escape opens the original menu.

One to four entries use cards. Larger menus, BLS entries, external custom.cfg
files and titles resolved at boot use the complete standard GRUB list.
Long titles use a smaller prebuilt size or an ellipsis on the cards; the entry
editor and original menu retain their full names. Characters outside the
bundled font library also use the complete original menu.

Installation and configuration updates use Bash, awk, gzip, standard system
utilities and GRUB's own configuration checker. They do not run Python or
an image renderer. The fixed artwork and 17,049-character library are prebuilt
for each profile, including the one-, two-, three- and four-card layouts.

The runtime helpers are embedded in `install.sh` and written into the installed
Sidonia directory. Asset-building scripts are not shipped. The editable SVG,
layout data, Inconsolata fonts and Noto Sans JP font remain in
`docs/design/echelon` as source material.
