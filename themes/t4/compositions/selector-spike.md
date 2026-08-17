# T4 stock-GRUB selector geometry spike

The measured design-space menu is `1216×512` at `(604,318)`. The supplied selected state is `1216×160`; the idle state is `1216×112`. The only permitted candidate uses `item_height = 160` and `item_spacing = -48` so row origins retain a 112-pixel pitch.

The build emits exact-resolution selector slices and a fixture theme for this candidate. Passing requires stock pinned GRUB to render all four selected positions without clipping, stretching, displaced clamps, or altered neighboring idle lines at 1280×720, 1920×1080, and 2560×1440.

Status: **BLOCKED**. Candidate construction exists only to create the isolated spike fixture; BIOS and UEFI capture comparison remains unrun. Until all six firmware/profile cases and all four selection positions are approved, no generated T4 candidate is geometry- or release-approved.
