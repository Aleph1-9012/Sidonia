# Cyber Red UI Asset Pack

Expanded, production-ready asset pack rebuilt from the supplied cyber-industrial interface reference.

## Included

- **110 individual transparent assets** across 8 categories.
- Editable **SVG** for every clean geometric asset.
- Transparent **PNG at 1x and 2x** for rapid compositing.
- Both **labeled** and **blank reusable versions** wherever visible text is part of the component.
- A transparent, generated micro-detail atlas and sixteen isolated raster micrographics.
- Category contact sheets, overview preview, JSON/CSV manifest, and palette file.

## Categories

- `countdown`: 13 assets
- `frames`: 14 assets
- `generated_micrographics`: 16 assets
- `icons`: 16 assets
- `micrographics`: 15 assets
- `overlays`: 14 assets
- `rails_scrollbars`: 12 assets
- `selectors`: 10 assets

## Folder layout

- `assets/svg/<category>/` — editable masters.
- `assets/png/1x/<category>/` — production PNGs at base resolution.
- `assets/png/2x/<category>/` — double-resolution PNGs.
- `masters/` — generated style atlas.
- `preview/` — overview and category contact sheets.
- `manifest.json` / `manifest.csv` — asset index and dimensions.

## Visual system

- Signal red: `#E30613`
- Highlight red: `#FF2432`
- Cold white: `#F4F2EC`
- Warning yellow: `#F5D34A`
- Panel black: `#07080A`
- Recommended type: DejaVu Sans Mono or another squared monospaced face.

All exported asset backgrounds are genuinely transparent. Dark fills inside panel assets are intentional and remain isolated from the canvas.

## Reuse notes

- Start from a `_blank` SVG when changing wording.
- Use the 2x PNGs for large screens, motion graphics, or downsampling.
- The `generated_micrographics` folder contains the more distressed raster details; the parallel `micrographics` folder contains crisp editable equivalents.
- The supplied reference image is not redistributed inside this pack. Confirm that you have the necessary rights for your intended use.
