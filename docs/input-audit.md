# Input audit

The canonical final references are the files from the supplied `Final-boot/Metdata` directory. Their pixels match the `Clean` and `Assets` copies, but T1–T3 differ in PNG metadata; the canonical hashes below intentionally follow the implementation plan.

| Theme | Dimensions | SHA-256 | Canonical pack archive | Archive SHA-256 |
|---|---:|---|---|---|
| T1 | 6688×3764 | `7510565cf8afde7a3afbcb46aa57a00a6105011a1436ccee1ff87924c75698aa` | `T1-F-ui-assets-expanded.zip` | `12d686f6e2b8b351ddca7b96b8ce713378de938e3472e7f73a65090f32c5c230` |
| T2 | 6688×3764 | `ec921f135bc9463988a5ef47bdfd5c371a418b1ab8640bcbaf8ac96b5eafcbea` | `Cyber_Red_UI_Asset_Pack.zip` | `83d2d5a31d8765fca2a9effbe64e15480c992f01e5e9e6618b126f9abc684dfb` |
| T3 | 3344×1882 | `f75914fc5681011dedcc13062d758b09eafe283deaa2648383d28069cd2519b5` | `starfix_hud_asset_pack.zip` | `3e50644e3b2f7166e6f5bc0e9bc4f273990829b413e8f31d7cd12c7ca7cc0d15` |
| T4 | 3344×1882 | `dbe6c3cd66690e3cfe1d40ec84ccd19edb6621d356aeb932a288d747d855a013` | `t4_f3_expanded_hud_asset_pack.zip` | `4e0a2f7fc6f1b4b6fd2a662280c8f36b8ada0063a6bdc2fce1116ec73fb96dac` |

All four ZIPs pass CRC validation. No archive contains a font. The older T4 V1 archive is intentionally excluded.

T4's source manifest is preserved byte-for-byte. Its two stale 4× hashes are corrected only in a generated derived manifest:

- `overlay-full-composition--blank@4x.png`: `44b644574528b002c57ba763eb99ef547f6cdf1433c954cac96a4ecbdfbe0515`
- `panel-main-console--labeled@4x.png`: `6634c6107ce1e6bdf33da0d7a5ed3a7695ef75e7107a7fe26518e0573e068c56`

The exhaustive imported-file lock is `sources.lock.json`.

