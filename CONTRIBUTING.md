# Contributing to Sidonia

Contributions that improve compatibility, documentation, installation, or the
theme artwork are welcome.

## Before opening a pull request

- Keep each theme compatible with stock GRUB.
- Preserve all three profiles: 720p, 1080p, and 1440p.
- Do not bake machine-specific boot labels, UUIDs, or paths into theme assets.
- Keep generated captures, disk images, logs, and local test output out of Git.
- Run `bash -n install.sh bin/sidonia-theme` after changing shell code.
- Run `git diff --check` before committing.

For visual changes, include before/after images and state the tested GRUB,
firmware, and framebuffer versions. For installer changes, describe the backup
and failure-recovery behavior exercised during testing.

By contributing, you agree that your contribution is licensed under the
project's Apache License 2.0.
