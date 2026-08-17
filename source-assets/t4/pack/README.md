# T4-F3 Expanded Industrial HUD Asset Pack

A production-ready reconstruction of every visible component family in the supplied boot-console reference, plus a reusable 0–9 digit expansion.

## What is included

- 173 asset families across selectors, frames, icons, controls, countdown graphics, scrollbars/gauges, micrographics, and overlays.
- Labeled and blank variants for every family. Both variants share identical logical dimensions and anchors.
- Editable SVG masters and transparent sRGB RGBA PNG at 1x, 2x, and 4x.
- Labeled and blank atlases with JSON coordinates.
- Contact sheets, alpha-background tests, a component map, palette/tokens, nine-slice hints, manifest hashes, and QA results.

## Blank-variant behavior

Composite assets retain their base geometry while labels, numerals, status marks, and internal symbols are removed. Standalone glyphs that have no surrounding frame use a fully transparent same-size blank; this is intentional and lets you hide a glyph without changing layout.

## Folder guide

- source/svg: editable transparent vector masters.
- exports/png: separate transparent PNGs at 1x, 2x, and 4x.
- atlases: convenient labeled and blank sprite sheets plus JSON.
- previews: contact sheets and alpha tests.
- reference: original reference, component map, and AI reconstruction guides.
- qa/report.json: dimension, alpha-channel, and labeled/blank parity checks.

## Reuse

Use manifest.json to locate files and matching blank/labeled pairs. Long selectors, rails, and scrollbars include nine-slice metadata where applicable. SVG text remains editable and uses DejaVu Sans Mono with a generic monospace fallback.

## Quality notes

The source image is 2048×1152 and contains a fully opaque alpha channel. Final assets were reconstructed as vectors rather than color-keyed crops, preventing black/white detail loss and matte halos. PNG exports are generated directly from the SVG at each target scale.

Derived from the user-supplied visual reference. Confirm any third-party usage rights before commercial distribution.