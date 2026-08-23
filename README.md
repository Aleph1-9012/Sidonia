# Sidonia

Cinematic GRUB themes inspired by industrial interfaces, navigation systems,
and maintenance consoles.

## Themes

### T1 — Industrial Device Frame

![T1 Industrial Device Frame](previews/T1.png)

### T2 — Cyber Red Structural Grid

![T2 Cyber Red Structural Grid](previews/T2.png)

### T3 — STARFIX Network Map

![T3 STARFIX Network Map](previews/T3.png)

### T4 — Maintenance Console

![T4 Maintenance Console](previews/T4.png)

## Install

Sidonia is designed for GNU GRUB systems that use `/etc/default/grub`.

```bash
git clone https://github.com/Aleph1-9012/Sidonia.git
cd Sidonia
sudo ./install.sh
```

The installer guides you through choosing a theme and display profile. It also
keeps a rollback copy and never runs `grub-install`.

## Switch themes

Open the guided theme chooser whenever you want to switch:

```bash
sudo sidonia-theme
```

You can also select a theme directly:

```bash
sudo sidonia-theme set T2 1080p
```

Available display profiles:

- `720p` — 1280×720
- `1080p` — 1920×1080
- `1440p` — 2560×1440 and larger

## Restore

Undo the latest theme change:

```bash
sudo sidonia-theme rollback
```

Remove Sidonia and restore the original GRUB appearance:

```bash
sudo sidonia-theme uninstall
```

## More information

- [Advanced installation and troubleshooting](docs/ADVANCED.md)
- [License](LICENSE)
- [Artwork and font notices](NOTICE.md)

Sidonia is an independent project and is not affiliated with the GRUB project
or any media franchise.
