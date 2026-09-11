# T1 through T4 asset optimization

The selected display resolution and countdown duration are requirements. This
work reduces the assets GRUB loads and draws while preserving the menu's
appearance, fonts, selection behavior, and countdown.

## Plan

1. Preserve the original assets for comparison.
2. Bake the opaque, static timer backing into the 1440p background in T2,
   T3, and T4. Remove its separate image component and PNG.
3. Convert referenced PNGs with a fully opaque alpha channel from RGBA to
   RGB. Keep every color value and all actual transparency.
4. Compare original and optimized pixels across all 12 profiles. Check that
   only the removed static image blocks changed in the theme definitions.
5. Run isolated GRUB checks on representative profiles, then leave hardware
   appearance and boot-time verification to the user.

The tools in this document do not install themes or change the active GRUB
configuration.

## Scope

The 720p and 1080p profiles retain their separate timer backings. Their
backgrounds stretch when given a custom framebuffer, while the timer
coordinates stay fixed. Baking the backing into those backgrounds would
change that behavior. Their optimization only removes unused alpha data.

The 1440p profiles retain their centered 2560x1440 canvas on supported larger
framebuffers. No display mode, timeout, menu entry, font, or kernel setting
is changed.

Image-format experiments and changes to background scaling are a later pass.
They need separate rendering and timing comparisons. Fewer stored bytes or
decoded pixels alone do not establish a boot-time improvement.

## Asset results

All 12 profiles pass the original-versus-candidate pixel checks. The changes
convert 49 opaque RGBA PNGs to RGB and remove three static timer backing
components and their files. PNG color metadata is preserved. Fonts, menu
geometry, timeout widgets, the installer, and the theme manager are unchanged.

The encoder compares Pillow's PNG output with an encoding that retains the
original background's row-filter choices. It keeps the smaller result and
decodes it again to check every pixel before writing. This avoids the larger
T3 background produced by the first encoding attempt.

| Profile | Referenced PNG bytes before | Referenced PNG bytes after | Decoded pixel bytes removed |
| --- | ---: | ---: | ---: |
| T2 1440p | 3,549,441 | 3,189,311 | 511,329 |
| T3 1440p | 3,073,016 | 3,000,710 | 221,222 |
| T4 1440p | 1,524,879 | 1,471,181 | 322,838 |

Across all 12 alternative profiles, referenced PNG files shrink by 542,111
bytes and decoded pixel data by 1,539,172 bytes. GRUB loads the selected
profile only. The decoded figures count source bitmap pixels, not GRUB's
total memory usage or its additional scaled buffers.

The optimizer's second run reports zero changes. Python syntax checks and
`git diff --check` pass. Hardware timing remains unmeasured.

## GRUB rendering checks

Isolated QEMU guests compared the original assets against the local changes
using the same GRUB build, fixture entries, framebuffer, and countdown on
each side. All 42 menu and countdown screenshots match pixel-for-pixel after
RGB decoding.

| Theme and profile | Framebuffer | Firmware |
| --- | --- | --- |
| T2 1080p | 1920x1080 | UEFI |
| T2 1440p | 2560x1440 | UEFI |
| T3 1440p | 2560x1440 | UEFI |
| T3 1440p | 2560x1600 | UEFI |
| T4 1440p | 2560x1440 | BIOS |

These checks cover selected rows, live countdown updates, and cancellation.
The T2 cases also cover submenu entry and return. All five cases reached the
expected test entry after timeout expiry without GRUB errors or warnings.
Post-expiry screenshots are excluded from the 42-image comparison because
they can capture different stages of the transition to the test console.

The guests used temporary rescue ISOs, private firmware-variable copies, no
host disks, and no networking. This checks rendering and behavior, not
physical boot speed. Hardware verification remains the final acceptance step.

## Reproduce the asset changes

The optimization tools require Python 3 and Pillow. T1 through T4 do not need
them during installation or boot. Echelon has separate rendering dependencies.

Preview the changes against an original copy of the themes:

```sh
python3 tools/optimize_theme_assets.py --root /path/to/original-copy
```

Apply them to that local copy:

```sh
python3 tools/optimize_theme_assets.py --root /path/to/original-copy --apply
```

The optimizer checks the supported layouts and image opacity before writing.
It only processes PNGs referenced by the selected theme definitions. Running
it again after optimization should produce no changes.

## Verify against the original assets

In a full development checkout, extract the original themes from the baseline
commit before optimization into a temporary directory:

```sh
baseline_dir="$(mktemp -d /tmp/sidonia-baseline.XXXXXX)"
git archive 82c24c2 themes | tar -x -C "$baseline_dir"
python3 tools/verify_asset_optimization.py --baseline "$baseline_dir"
```

The comparison reconstructs the original background and static timer backing,
checks exact RGBA pixels for surviving sprites, and checks unchanged fonts and
other files. It also checks larger framebuffer placement for the 1440p
profiles. It does not simulate GRUB's complete renderer.

For hardware verification, use the same theme, resolution, countdown, and
boot entry before and after. Check the initial menu, each selected row,
countdown updates, cancellation by a key press, and submenu return. Measure
the delay before the first complete menu separately from the chosen countdown.
Repeat boots under the same conditions before attributing a timing difference
to the assets.
