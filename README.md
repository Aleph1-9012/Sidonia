<h1 align="center">Sidonia</h1>

<p align="center">
  A collection of cinematic GRUB themes inspired by industrial interfaces,
  navigation systems, and maintenance consoles.
</p>

<p align="center">
  <img alt="Themes" src="https://img.shields.io/badge/themes-4-e31a24">
  <img alt="Display profiles" src="https://img.shields.io/badge/profiles-720p%20%7C%201080p%20%7C%201440p-343638">
  <img alt="GRUB" src="https://img.shields.io/badge/bootloader-GRUB-111111">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-6f7478">
</p>

## Theme gallery

<table>
  <tr>
    <td align="center"><img src="previews/T1.png" alt="T1 Industrial Device Frame"><br><strong>T1 — Industrial Device Frame</strong></td>
    <td align="center"><img src="previews/T2.png" alt="T2 Cyber Red Structural Grid"><br><strong>T2 — Cyber Red Structural Grid</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="previews/T3.png" alt="T3 STARFIX Network Map"><br><strong>T3 — STARFIX Network Map</strong></td>
    <td align="center"><img src="previews/T4.png" alt="T4 Maintenance Console"><br><strong>T4 — Maintenance Console</strong></td>
  </tr>
</table>

## Install

Sidonia is for GNU GRUB systems that use `/etc/default/grub`. It does not
install or replace your bootloader.

Clone the repository and run the guided installer:

```bash
git clone https://github.com/Aleph1-9012/Sidonia.git
cd Sidonia
sudo ./install.sh
```

The installer asks you to choose a theme and display profile, backs up the
current GRUB appearance, installs the selected assets, and safely regenerates
`grub.cfg`. It never runs `grub-install` or changes boot entries, disks,
partitions, EFI variables, kernel arguments, or Secure Boot.

For a non-interactive install:

```bash
sudo ./install.sh T4 1440p
```

## Switch themes

After installation, switch at any time with one command:

```bash
sudo sidonia-theme set T2 1080p
```

Useful commands:

```bash
sidonia-theme list                  # Show available themes
sidonia-theme status                # Show the active Sidonia theme
sudo sidonia-theme set T4 1440p     # Apply a theme
sudo sidonia-theme rollback         # Undo the latest change
sudo sidonia-theme uninstall        # Restore the original GRUB appearance
```

## Choose a display profile

| Profile | Designed for | Notes |
| --- | --- | --- |
| `720p` | 1280×720 | Exact-size layout |
| `1080p` | 1920×1080 | Exact-size layout |
| `1440p` | 2560×1440 and larger | Fixed canvas, centred on larger framebuffers |

When switching between 1440p themes, Sidonia keeps an existing larger GRUB
mode such as `2560x1600`. An explicit mode can also be selected:

```bash
sudo sidonia-theme set T1 1440p --gfxmode 2560x1600
```

## More information

- [Advanced installation and troubleshooting](docs/ADVANCED.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE)
- [Artwork and font notices](NOTICE.md)

Sidonia is an independent project and is not affiliated with the GRUB project
or any media franchise.
