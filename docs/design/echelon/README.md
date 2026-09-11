# Echelon design sources

`Gridcase-original.svg` is the supplied artwork, retained unchanged.
Current behavior and installation instructions are in `themes/T5/README.md`.

The editable production SVG and layout data are in `docs/design/echelon/artwork`.
The bundled fonts and their licenses are in `docs/design/echelon/fonts`.
`docs/design/echelon/fonts/sources.json` records their upstream sources and checksums.

The project preview, `previews/T5.png`, uses the original supplied SVG's four
example labels and selection, with the current title from the editable SVG.
The title is `SID0NIA // ECHEL0N`, set in Inconsolata SemiBold, weight 600.

The release includes prebuilt artwork and compressed character data for all
three profiles and all four card counts. Asset-building scripts are not
included in this repository; the SVG, layout data and fonts remain available
as editable source material.

Installed cards are assembled from current GRUB entries by the shell/awk
runtime embedded in `install.sh`. Installation writes those helpers into the
installed Sidonia directory for later GRUB configuration updates.
