# Fidelity contract

The locked final PNG is the visual authority for each theme. Asset-pack components are construction material and never override it.

All outputs are deterministic full-frame resamples of the same 2048×1152 composition. The references are fractionally taller than exact 16:9, so the build performs one locked resize to the exact framebuffer. It does not crop, add bars, use percentages in GRUB, or rely on GRUB image scaling.

Static decorative art remains rasterized. Only menu titles, selection, timeout progress, and scrollbar position are dynamic. Fixture-only numeric prefixes are not injected into production menu entries. Reference selection state is a preview and never changes production boot policy.

If stock GRUB cannot reproduce required geometry, the affected theme is blocked rather than visually altered or supported through a custom GRUB fork or host-configuration change.

