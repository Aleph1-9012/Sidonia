# Sidonia GRUB Themes

Deterministic, resolution-specific GRUB themes built from the four supplied Sidonia references. The repository produces twelve runtime packages: T1–T4 at 720p, 1080p, and 1440p.

## Safety boundary

This project only builds theme files and isolated test fixtures. It has no installer and does not modify GRUB, `/boot`, `/etc/default/grub`, `/etc/grub.d`, disks, partitions, EFI variables, Secure Boot, firmware settings, menu-entry commands, kernel arguments, or boot policy.

## Requirements

- Node.js 24.19.0 and pnpm 11.19.0
- the exact tools recorded in `toolchain.lock`
- the vendored DejaVu Sans Mono font and licence

After dependencies have been acquired once, the normal build performs no network access.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm verify:sources
pnpm build:themes
pnpm verify:dist
```

Generated runtime packages are written to `dist/`. Generated construction reports and reference previews are written to `build/`.

Current status: the generated folders are reproducible **candidate packages**, not release-approved themes. `build/index.json` is the machine-readable gate record. Reference-state composites (live fixture text plus timeout state), timeout masks, and the T4 stock-GRUB selector captures are still blocked.

Each package README documents its one required framebuffer mode. The packages never select or install that mode for the user.

## Source authority

The locked final reference PNG for each theme controls composition and appearance. Extracted canonical asset packs are implementation material. `sources.lock.json` records every imported source byte; `pnpm verify:sources` rejects additions, removals, case changes, hash drift, image metadata drift, and escaping symlinks.

The reference fixture supplies the labels shown in the artwork. Production titles always come from the user's existing `grub.cfg`.
