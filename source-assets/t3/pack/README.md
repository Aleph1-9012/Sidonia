# STARFIX HUD expanded transparent asset pack

Production-ready component pack derived from the supplied 2048×1152 HUD reference.

- 176 transparent PNG assets
- paired `*_blank.png` and `*_labeled.png` variants wherever applicable
- exact alpha-separated source crops plus normalized reusable components
- full labeled and blank overlays, separated red/ivory signal layers, selectors, frames, node states, countdown pieces, scrollbars, connectors, barcodes, icons, and micrographics
- `manifest.json` and `asset_index.csv` for dimensions and lookup

## Palette

- Signal red: `#EB1420`
- Warm ivory: `#EBE1CD`
- Dim ivory: `rgba(198,190,174,0.86)`
- Background: transparent (preview on near-black)

## Naming

`<category>/<asset>_blank.png` is the reusable frame/graphic without readable copy.

`<category>/<asset>_labeled.png` carries the reference label or a clear sample label.

The `10_source_extracts` folder contains exact labeled crops from the supplied screenshot. The normalized folders use clean, consistent geometry and interchangeable dimensions.

## Categories

- `00_masters` — 2 files
- `01_selectors` — 10 files
- `02_frames` — 12 files
- `03_nodes` — 42 files
- `04_countdown` — 18 files
- `05_icons` — 28 files
- `06_connectors` — 16 files
- `07_scrollbars` — 4 files
- `08_overlays` — 8 files
- `09_barcodes` — 6 files
- `10_micrographics` — 20 files
- `10_source_extracts` — 10 files

## Technical notes

All PNGs use RGBA transparency. Most normalized components include subtle baked glow while retaining a transparent canvas. The full-size overlay stays at 2048×1152.
