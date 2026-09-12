# Sidonia

A collection of five sci-fi themes for GNU GRUB, with 720p, 1080p and 1440p
layouts and an interactive installer.

## Themes

### T1 — Frame 704

![T1 Frame 704](previews/T1.png)

### T2 — Gridline

![T2 Gridline](previews/T2.png)

### T3 — Starfix

![T3 Starfix](previews/T3.png)

### T4 — System Bay

![T4 System Bay](previews/T4.png)

### T5 — Echelon

![T5 Echelon](previews/T5.png)

## Install

Sidonia is designed for GNU GRUB systems that use `/etc/default/grub`.

```bash
git clone --depth 1 https://github.com/Aleph1-9012/Sidonia.git
cd Sidonia
sudo ./install.sh
```

Choose a theme and display profile when prompted. The installer backs up your
current GRUB configuration, and the theme appears on the next boot.

## Switch themes

Open the guided theme chooser whenever you want to switch:

```bash
sudo sidonia
```

You can also select a theme directly:

```bash
sudo sidonia set T2 1080p
```

## Display profiles

All five themes include these profiles:

| Profile | Resolution |
| --- | --- |
| `720p` | 1280×720 |
| `1080p` | 1920×1080 |
| `1440p` | 2560×1440 and larger |

Choose the profile that matches your GRUB display mode. On larger displays,
the 1440p layout stays centered at 2560×1440 with padding around it.

## Restore

Undo the latest theme change:

```bash
sudo sidonia rollback
```

Remove Sidonia and restore the original GRUB appearance:

```bash
sudo sidonia uninstall
```

## More information

- [Editable source assets](https://github.com/Aleph1-9012/Sidonia/releases/tag/v1.0.0)
- [Advanced installation and troubleshooting](docs/ADVANCED.md)
- [License](LICENSE)
- [Artwork and font notices](docs/NOTICE.md)

Sidonia is an independent project and is not affiliated with the GRUB project
or any media franchise.
