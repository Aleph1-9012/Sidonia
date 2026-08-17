import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { errorMessage, listRegularFiles, readJson, repositoryPath, sha256File } from "./common.js";
import { lintFixture, lintTheme, safetyScan } from "./lint-theme.js";
import { loadLayout, PROFILES, scaleInteger } from "./layout.js";
import { ProfileIdSchema, SourceLockSchema, ThemeIdSchema, type Layout, type Profile } from "./schemas.js";
import { fontDisplayName } from "./theme.js";
import { verifySources } from "./verify-sources.js";
import { loadAndVerifyToolchain } from "./toolchain.js";

const PackageNameSchema = z.string().regex(/^sidonia-t[1-4]-(720p|1080p|1440p)$/u);
const ManifestLineSchema = z.string().regex(/^[0-9a-f]{64} {2}[a-zA-Z0-9._/-]+$/u);
const RuntimeMetadataSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  channels: z.number().int().min(3).max(4),
  depth: z.literal("uchar"),
  space: z.literal("srgb"),
  hasAlpha: z.boolean(),
  isProgressive: z.boolean().optional(),
});

type ImageExpectation = Readonly<{
  width: number;
  height: number;
  hasAlpha: boolean;
}>;

const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const profileById = (id: z.infer<typeof ProfileIdSchema>): Profile => {
  const profile = PROFILES.find((candidate) => candidate.id === id);
  if (profile === undefined) {
    throw new Error(`profile field=id expected=known actual=${id}`);
  }
  return profile;
};

const verifyManifest = async (
  packageRoot: string,
  expectedPaths: readonly string[],
): Promise<void> => {
  const manifestText = await readFile(join(packageRoot, "manifest.sha256"), "utf8");
  const lines = manifestText.trimEnd().split("\n").map((line) => ManifestLineSchema.parse(line));
  const listed = new Set<string>();
  for (const line of lines) {
    const hash = line.slice(0, 64);
    const path = line.slice(66);
    const pathSegments = path.split("/");
    if (path.startsWith("/") || pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`dist file=${path} field=manifest-path expected=package-relative actual=unsafe`);
    }
    if (path === "manifest.sha256") {
      throw new Error("dist file=manifest.sha256 field=manifest-path expected=non-self-reference actual=self-reference");
    }
    if (listed.has(path)) {
      throw new Error(`dist file=${path} field=manifest-entry expected=unique actual=duplicate`);
    }
    const actual = await sha256File(join(packageRoot, path));
    if (actual !== hash) {
      throw new Error(`dist file=${path} field=sha256 expected=${hash} actual=${actual}`);
    }
    listed.add(path);
  }
  const actualPaths = [...listed].sort(compareText);
  const sortedExpectedPaths = [...expectedPaths].sort(compareText);
  if (JSON.stringify(actualPaths) !== JSON.stringify(sortedExpectedPaths)) {
    throw new Error(`dist field=manifest-files expected=${sortedExpectedPaths.join(",")} actual=${actualPaths.join(",")}`);
  }
};

const verifyPng = async (absolutePath: string, expectation: ImageExpectation): Promise<void> => {
  const metadata = RuntimeMetadataSchema.parse(await sharp(absolutePath, { failOn: "error" }).metadata());
  if ((metadata.isProgressive ?? false) === true) {
    throw new Error(`dist file=${absolutePath} field=interlace expected=false actual=true`);
  }
  if (metadata.width !== expectation.width) {
    throw new Error(`dist file=${absolutePath} field=width expected=${expectation.width} actual=${metadata.width}`);
  }
  if (metadata.height !== expectation.height) {
    throw new Error(`dist file=${absolutePath} field=height expected=${expectation.height} actual=${metadata.height}`);
  }
  if (metadata.hasAlpha !== expectation.hasAlpha) {
    throw new Error(`dist file=${absolutePath} field=alpha expected=${expectation.hasAlpha} actual=${metadata.hasAlpha}`);
  }
  const expectedChannels = expectation.hasAlpha ? 4 : 3;
  if (metadata.channels !== expectedChannels) {
    throw new Error(`dist file=${absolutePath} field=channels expected=${expectedChannels} actual=${metadata.channels}`);
  }
};

const expectedPngs = (layout: Layout, profile: Profile): ReadonlyMap<string, ImageExpectation> => {
  const selectorWidth = scaleInteger(layout.menu.selector.width, profile);
  const selectorHeight = scaleInteger(layout.menu.selector.height, profile);
  const left = scaleInteger(layout.menu.selector.slices.left, profile);
  const top = scaleInteger(layout.menu.selector.slices.top, profile);
  const right = scaleInteger(layout.menu.selector.slices.right, profile);
  const bottom = scaleInteger(layout.menu.selector.slices.bottom, profile);
  const centerWidth = selectorWidth - left - right;
  const centerHeight = selectorHeight - top - bottom;
  return new Map([
    ["background.png", { width: profile.width, height: profile.height, hasAlpha: false }],
    ["progress/frame_c.png", { width: 1, height: Math.max(1, scaleInteger(layout.progress.height, profile)), hasAlpha: true }],
    ["progress/highlight_c.png", { width: 1, height: Math.max(1, scaleInteger(layout.progress.height, profile)), hasAlpha: true }],
    ["selectors/menu_c.png", { width: 1, height: 1, hasAlpha: true }],
    ["selectors/menu_e.png", { width: Math.max(1, scaleInteger(7, profile)), height: 1, hasAlpha: true }],
    ["selectors/scrollbar_c.png", { width: Math.max(1, scaleInteger(2, profile)), height: 1, hasAlpha: true }],
    ["selectors/thumb_c.png", { width: Math.max(1, scaleInteger(3, profile)), height: 1, hasAlpha: true }],
    ["selectors/selected_nw.png", { width: left, height: top, hasAlpha: true }],
    ["selectors/selected_n.png", { width: centerWidth, height: top, hasAlpha: true }],
    ["selectors/selected_ne.png", { width: right, height: top, hasAlpha: true }],
    ["selectors/selected_w.png", { width: left, height: centerHeight, hasAlpha: true }],
    ["selectors/selected_c.png", { width: centerWidth, height: centerHeight, hasAlpha: true }],
    ["selectors/selected_e.png", { width: right, height: centerHeight, hasAlpha: true }],
    ["selectors/selected_sw.png", { width: left, height: bottom, hasAlpha: true }],
    ["selectors/selected_s.png", { width: centerWidth, height: bottom, hasAlpha: true }],
    ["selectors/selected_se.png", { width: right, height: bottom, hasAlpha: true }],
  ]);
};

const verifyPf2Name = async (absolutePath: string, expectedName: string): Promise<void> => {
  const content = await readFile(absolutePath);
  if (content.length < 21
    || content.subarray(0, 4).toString("ascii") !== "FILE"
    || content.readUInt32BE(4) !== 4
    || content.subarray(8, 12).toString("ascii") !== "PFF2"
    || content.subarray(12, 16).toString("ascii") !== "NAME") {
    throw new Error(`dist file=${absolutePath} field=pf2-header expected=FILE/PFF2/NAME actual=invalid`);
  }
  const nameLength = content.readUInt32BE(16);
  const nameEnd = 20 + nameLength;
  if (nameLength < 2 || nameEnd > content.length || content[nameEnd - 1] !== 0) {
    throw new Error(`dist file=${absolutePath} field=pf2-name-length expected=terminated-in-file actual=${nameLength}`);
  }
  const actualName = content.subarray(20, nameEnd - 1).toString("utf8");
  if (actualName !== expectedName) {
    throw new Error(`dist file=${absolutePath} field=pf2-name expected=${JSON.stringify(expectedName)} actual=${JSON.stringify(actualName)}`);
  }
};

const verifyPackage = async (packageName: string): Promise<void> => {
  PackageNameSchema.parse(packageName);
  const match = /^sidonia-(t[1-4])-(720p|1080p|1440p)$/u.exec(packageName);
  if (match === null) {
    throw new Error(`dist field=package-name expected=canonical actual=${packageName}`);
  }
  const theme = ThemeIdSchema.parse(match[1]);
  const profileId = ProfileIdSchema.parse(match[2]);
  const profile = profileById(profileId);
  const layout = await loadLayout(theme);
  const packageRoot = repositoryPath(`dist/${packageName}`);
  const requiredEntries = ["README.md", "background.png", "fonts", "manifest.sha256", "progress", "selectors", "theme.txt"];
  const actualEntries = (await readdir(packageRoot)).sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(requiredEntries)) {
    throw new Error(`${theme} ${profileId} field=runtime-entries expected=${requiredEntries.join(",")} actual=${actualEntries.join(",")}`);
  }
  const pngs = expectedPngs(layout, profile);
  const files = await listRegularFiles(packageRoot);
  const actualRuntimePaths = files
    .map((file) => relative(packageRoot, file).split(sep).join("/"))
    .sort(compareText);
  const fontPath = `fonts/sidonia-${theme}-${profileId}.pf2`;
  const expectedRuntimePaths = [
    "README.md",
    ...pngs.keys(),
    fontPath,
    "manifest.sha256",
    "theme.txt",
  ].sort(compareText);
  if (JSON.stringify(actualRuntimePaths) !== JSON.stringify(expectedRuntimePaths)) {
    throw new Error(`${theme} ${profileId} field=runtime-files expected=${expectedRuntimePaths.join(",")} actual=${actualRuntimePaths.join(",")}`);
  }
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (extension === ".png") {
      const packagePath = relative(packageRoot, file).split(sep).join("/");
      const expectation = pngs.get(packagePath);
      if (expectation === undefined) {
        throw new Error(`${theme} ${profileId} file=${packagePath} field=png expected=declared actual=unknown`);
      }
      await verifyPng(file, expectation);
    }
    if (![".png", ".pf2", ".txt", ".md", ".sha256"].includes(extension)) {
      throw new Error(`${theme} ${profileId} file=${file} field=format expected=runtime-allowlist actual=${extension}`);
    }
    const evidence = await stat(file);
    if (evidence.size === 0) {
      throw new Error(`${theme} ${profileId} file=${file} field=size expected=positive actual=0`);
    }
  }
  const readme = await readFile(join(packageRoot, "README.md"), "utf8");
  if (!readme.includes(`${profile.width}×${profile.height}`)) {
    throw new Error(`${theme} ${profileId} file=README.md field=framebuffer expected=${profile.width}x${profile.height} actual=missing`);
  }
  await verifyPf2Name(join(packageRoot, fontPath), fontDisplayName(layout, profile));
  await lintTheme(layout, profile, packageRoot);
  await verifyManifest(packageRoot, expectedRuntimePaths.filter((path) => path !== "manifest.sha256"));
};

const main = async (): Promise<void> => {
  await verifySources();
  const toolchain = await loadAndVerifyToolchain();
  await safetyScan();
  await lintFixture(toolchain);
  await readJson(SourceLockSchema, repositoryPath("sources.lock.json"));
  const distRoot = repositoryPath("dist");
  const distEntries = await readdir(distRoot, { withFileTypes: true });
  const packages = distEntries.map((entry) => entry.name).sort(compareText);
  const expectedPackages = ThemeIdSchema.options
    .flatMap((theme) => ProfileIdSchema.options.map((profile) => `sidonia-${theme}-${profile}`))
    .sort(compareText);
  if (distEntries.some((entry) => !entry.isDirectory()) || JSON.stringify(packages) !== JSON.stringify(expectedPackages)) {
    throw new Error(`dist field=packages expected=${expectedPackages.join(",")} actual=${packages.join(",")}`);
  }
  for (const packageName of packages) {
    await verifyPackage(packageName);
  }
  console.log("candidate distribution verification passed: 12 packages, exact PNG modes, PF2 closure, checksums, fixture lint; T4 selector capture gate remains blocked");
};

main().catch((cause: unknown) => {
  console.error(`distribution verification failed: ${errorMessage(cause)}`);
  process.exitCode = 1;
});
