# Sidonia QEMU visual tests

This harness builds repository-local GRUB rescue ISOs and boots them in an
isolated QEMU guest. It never attaches a host disk, enables guest networking,
or changes the host bootloader.

Run the first smoke case with explicit OVMF paths:

```sh
python3 tests/qemu/run.py \
  --case T1-1080p-uefi \
  --ovmf-code /usr/share/edk2/x64/OVMF_CODE.4m.fd \
  --ovmf-vars /usr/share/edk2/x64/OVMF_VARS.4m.fd
```

After the smoke case passes, run one six-case theme batch at a time:

```sh
python3 tests/qemu/run.py --theme T1 \
  --ovmf-code /usr/share/edk2/x64/OVMF_CODE.4m.fd \
  --ovmf-vars /usr/share/edk2/x64/OVMF_VARS.4m.fd
```

Use `--theme T2`, `T3`, then `T4` for the remaining selector matrix. Once all
24 selector cases pass, create the four required countdown captures with:

```sh
python3 tests/qemu/run.py --all --timeouts-only \
  --ovmf-code /usr/share/edk2/x64/OVMF_CODE.4m.fd \
  --ovmf-vars /usr/share/edk2/x64/OVMF_VARS.4m.fd
```

Generate side-by-side and difference images from all passing captures with:

```sh
python3 tests/qemu/run.py --all --comparisons-only
```

The runner validates all entries in `cases.json` before creating an ISO. A
successful selector run captures rows 1 and 4, sends three Down keys and Enter
through QMP, verifies the harmless `SIDONIA_ENTRY_04` serial marker, and asks
QEMU to quit through QMP. QMP uses standard input/output pipes, which keeps
the harness usable in sandboxes that do not permit Unix-domain sockets.

The 1080p/UEFI cases for T1–T3 and all six T4 cases capture every selector
row. Other selector cases capture rows 1 and 4. Reports are cumulative across
the staged theme runs, and unchanged theme/profile ISOs are reused for BIOS
and UEFI.

Generated state is written beneath `tests/qemu/work/`, `captures/`, and
`reports/`; these paths are ignored by Git.
