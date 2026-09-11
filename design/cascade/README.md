# Echelon design sources

`Gridcase-original.svg` is the supplied artwork, retained unchanged.
Current behavior and installation instructions are in `themes/T5/README.md`.

The editable production SVG and layout data are in `lib/cascade/artwork`.
The bundled fonts and their licenses are in `lib/cascade/fonts`.

The project preview, `previews/T5.png`, uses the original supplied SVG's four
example labels and selection, with the current title from the editable SVG.
The title is `SID0NIA // ECHEL0N`, set in Inconsolata SemiBold, weight 600.

Rebuild the three packaged canvases and the project preview with:

```bash
python3 tools/build_cascade_theme.py
```

The builder uses a temporary directory and removes it when finished. Installed
cards are generated from the current GRUB entries by `lib/cascade/runtime.py`.
