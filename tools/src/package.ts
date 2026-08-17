import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { listRegularFiles, repositoryPath, sha256File } from "./common.js";
import type { Layout, LockedFile, Profile, SourceLock } from "./schemas.js";

const packageRelative = (packageRoot: string, absolutePath: string): string =>
  relative(packageRoot, absolutePath).split(sep).join("/");

const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const requireLockedFile = (
  sourceLock: SourceLock,
  layout: Layout,
  profile: Profile,
  sourcePath: string,
): LockedFile => {
  const locked = sourceLock.files.find((file) => file.path === sourcePath);
  if (locked === undefined) {
    throw new Error(`${layout.theme} ${profile.id} file=${sourcePath} field=source-origin expected=locked actual=missing`);
  }
  return locked;
};

export const writePackageReadme = async (
  layout: Layout,
  profile: Profile,
  sourceLock: SourceLock,
  packageRoot: string,
): Promise<void> => {
  const reference = requireLockedFile(sourceLock, layout, profile, layout.reference);
  const selector = requireLockedFile(sourceLock, layout, profile, layout.menu.selector.source);
  const font = requireLockedFile(sourceLock, layout, profile, layout.font.source);
  const fontLicence = requireLockedFile(sourceLock, layout, profile, sourceLock.font.licence);
  const fontLicenceText = await readFile(repositoryPath(sourceLock.font.licence), "utf8");
  const derivedSources = [
    ...(layout.menu.selector.decorations ?? []).map((decoration) => decoration.source),
    ...layout.background.idleOverlays.map((overlay) => overlay.source),
  ].sort(compareText);
  const derivedSourceLines: string[] = [];
  for (const sourcePath of new Set(derivedSources)) {
    const locked = requireLockedFile(sourceLock, layout, profile, sourcePath);
    derivedSourceLines.push(`- Supporting composition asset: ${sourcePath} (${locked.sha256}); ledger-defined crop, resize, and placement.\n`);
  }
  const t4Warning = layout.theme === "t4"
    ? "T4 status: the stock-GRUB 160px selected / 112px pitch geometry requires the documented BIOS and UEFI capture gate before release approval.\n\n"
    : "";
  const content = `# Sidonia ${layout.theme.toUpperCase()} — ${profile.id}\n\n`
    + `Required framebuffer: **${profile.width}×${profile.height}** (16:9). Firmware must expose this exact mode. There is no automatic, fallback, or cross-resolution profile.\n\n`
    + "This folder is a GRUB runtime theme, not an installer. It does not change boot defaults, timeout policy, menu entries, kernel arguments, disks, firmware, or Secure Boot. Production menu titles and selection remain controlled by the existing GRUB configuration.\n\n"
    + t4Warning
    + "## Runtime contents\n\n"
    + "- `theme.txt`: absolute-pixel stock-GRUB layout\n"
    + "- `background.png`: neutral static composition at the exact framebuffer\n"
    + "- `selectors/`: selected-state, menu, and scrollbar styled-box slices\n"
    + "- `progress/`: standard `__timeout__` progress styles\n"
    + "- `fonts/`: uniquely named PF2 font for this profile\n"
    + "- `manifest.sha256`: runtime integrity list\n\n"
    + `Stock GRUB must load \`fonts/sidonia-${layout.theme}-${profile.id}.pf2\` before it selects this theme. This package documents that dependency but does not edit or generate the host boot configuration.\n\n`
    + "## Deterministic origin\n\n"
    + `- Background: ${layout.reference} (${reference.sha256}); full-frame Lanczos3 resize, then ledger-defined dynamic-region neutralization.\n`
    + `- Selector: ${layout.menu.selector.source} (${selector.sha256}); ledger-defined crop, resize, decorations, and nine-slice cuts.\n`
    + derivedSourceLines.join("")
    + `- Font: ${layout.font.source} (${font.sha256}); converted by pinned grub-mkfont at the ledger-defined size.\n`
    + `- Rounding: round half up after scaling from 2048×1152 by ${profile.scale}.\n\n`
    + "## Font licence\n\n"
    + `The PF2 is derived from DejaVu Sans Mono. Licence source: ${sourceLock.font.licence} (${fontLicence.sha256}).\n\n`
    + `${fontLicenceText.trimEnd()}\n`;
  await writeFile(join(packageRoot, "README.md"), content, "utf8");
};

export const writeChecksumManifest = async (packageRoot: string): Promise<void> => {
  const files = (await listRegularFiles(packageRoot))
    .filter((file) => packageRelative(packageRoot, file) !== "manifest.sha256")
    .sort((left, right) => compareText(packageRelative(packageRoot, left), packageRelative(packageRoot, right)));
  const lines: string[] = [];
  for (const file of files) {
    lines.push(`${await sha256File(file)}  ${packageRelative(packageRoot, file)}`);
  }
  await writeFile(join(packageRoot, "manifest.sha256"), `${lines.join("\n")}\n`, "utf8");
};

export const treeDigest = async (treeRoot: string): Promise<string> => {
  const files = await listRegularFiles(treeRoot);
  const lines: string[] = [];
  for (const file of files) {
    lines.push(`${packageRelative(treeRoot, file)}:${await sha256File(file)}`);
  }
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(lines.sort().join("\n"), "utf8").digest("hex");
};

export const ensurePackageFolders = async (packageRoot: string): Promise<void> => {
  for (const folder of ["selectors", "progress", "fonts"]) {
    await mkdir(join(packageRoot, folder), { recursive: true });
  }
};

export const readManifestText = async (packageRoot: string): Promise<string> =>
  readFile(join(packageRoot, "manifest.sha256"), "utf8");

export const ensureParent = async (absolutePath: string): Promise<void> => {
  await mkdir(dirname(absolutePath), { recursive: true });
};
