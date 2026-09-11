# Echelon design sources

`Gridcase-original.svg` is the supplied artwork, retained unchanged.
Current behavior and installation instructions are in `themes/T5/README.md`.

The editable production SVG and layout data are in `lib/cascade/artwork`.
The bundled fonts and their licenses are in `lib/cascade/fonts`.
`lib/cascade/fonts/sources.json` records their upstream sources and checksums.

The project preview, `previews/T5.png`, uses the original supplied SVG's four
example labels and selection, with the current title from the editable SVG.
The title is `SID0NIA // ECHEL0N`, set in Inconsolata SemiBold, weight 600.

Rebuild the three packaged canvases and the project preview with:

```bash
python3 tools/build_cascade_theme.py
```

The builder requires Python, Pillow and rsvg-convert on the maintainer's machine.
It prebuilds the fixed artwork and compressed character data for all three
profiles and all four card counts, using temporary directories while building.
Installed cards are assembled from current GRUB entries by
`lib/cascade/runtime.sh` and its awk helpers. Users do not need the build tools.
