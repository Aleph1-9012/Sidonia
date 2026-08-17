# Security and boot-safety policy

Sidonia is an unprivileged asset compiler. No project command requires root.

Project code must not invoke `grub-install`, `update-grub`, or a host `grub-mkconfig`; write below `/boot` or `/etc`; access disks, partitions, EFI variables, or NVRAM; change boot defaults, timeouts, kernel arguments, Secure Boot, or firmware settings; or replace a GRUB binary.

Build subprocesses use absolute allowlisted executables, argument arrays, a controlled working directory, a minimal environment, captured output, a timeout, and checked exit status. Build output is restricted to validated temporary directories plus repository-local `build/` and `dist/` roots.

Report a suspected safety-boundary violation privately to the repository owner. Do not test a suspected violation on a real boot volume.

