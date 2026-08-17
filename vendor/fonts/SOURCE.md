# DejaVu Sans Mono source

- File: `DejaVuSansMono.ttf`
- SHA-256: `b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582`
- Upstream family: DejaVu Fonts
- Local acquisition source: the pinned Codex workspace LibreOffice runtime, which redistributes the unmodified font and licence
- Build use: converted into uniquely named, profile-specific PF2 files with the pinned `grub-mkfont`

The font is vendored intentionally. Builds never discover or substitute a host font.

