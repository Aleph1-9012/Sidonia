import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readJson, REPOSITORY_ROOT, errorMessage, repositoryPath, sha256Text } from "./common.js";
import { lintFixture, lintTheme, safetyScan } from "./lint-theme.js";
import { loadLayouts, PROFILES, scaleInteger } from "./layout.js";
import {
  ensurePackageFolders,
  treeDigest,
  writeChecksumManifest,
  writePackageReadme,
} from "./package.js";
import {
  renderBackground,
  renderConstructedPreview,
  renderSelector,
  renderUtilityStyles,
} from "./render.js";
import { SourceLockSchema, T4ManifestCorrectionsSchema, type BuildState, type Layout, type Profile, type SourceLock, type Toolchain } from "./schemas.js";
import { verifySources } from "./verify-sources.js";
import { loadAndVerifyToolchain } from "./toolchain.js";
import { runCommand } from "./subprocess.js";
import { compiledLayoutReport, fontFamilyName, writeTheme } from "./theme.js";

const buildFont = async (
  toolchain: Toolchain,
  layout: Layout,
  profile: Profile,
  packageRoot: string,
): Promise<void> => {
  const size = scaleInteger(layout.font.designSize, profile);
  const output = join(packageRoot, "fonts", `sidonia-${layout.theme}-${profile.id}.pf2`);
  await runCommand(toolchain, {
    executable: "grubMkfont",
    args: [
      "-n",
      fontFamilyName(layout, profile),
      "-s",
      String(size),
      "-o",
      output,
      repositoryPath(layout.font.source),
    ],
    cwd: packageRoot,
    timeoutMs: 60_000,
  });
};

const writeDerivedT4Manifest = async (buildRoot: string): Promise<void> => {
  const sourcePath = repositoryPath("source-assets/t4/pack/manifest.json");
  const correctionPath = repositoryPath("themes/t4/compositions/manifest-corrections.json");
  const corrections = await readJson(T4ManifestCorrectionsSchema, correctionPath);
  let derived = await readFile(sourcePath, "utf8");
  for (const correction of corrections.corrections) {
    if (derived.split(correction.recorded).length !== 2) {
      throw new Error(`t4 derived manifest file=${correction.path} field=recorded-hash expected=once actual=invalid`);
    }
    derived = derived.replace(correction.recorded, correction.actual);
  }
  const outputRoot = join(buildRoot, "t4", "provenance");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, "manifest.corrected.json"), derived, "utf8");
};

const buildProfile = async (
  toolchain: Toolchain,
  sourceLock: SourceLock,
  layout: Layout,
  profile: Profile,
  distRoot: string,
  buildRoot: string,
): Promise<readonly BuildState[]> => {
  const packageName = `sidonia-${layout.theme}-${profile.id}`;
  const packageRoot = join(distRoot, packageName);
  const constructionRoot = join(buildRoot, layout.theme, profile.id);
  await ensurePackageFolders(packageRoot);
  await mkdir(constructionRoot, { recursive: true });

  const backgroundPath = join(packageRoot, "background.png");
  const referencePreviewPath = join(constructionRoot, "reference-resample.png");
  await renderBackground(layout, profile, backgroundPath, referencePreviewPath);
  await renderSelector(layout, profile, packageRoot, constructionRoot);
  await renderUtilityStyles(layout, profile, packageRoot);
  await buildFont(toolchain, layout, profile, packageRoot);
  await writeTheme(layout, profile, packageRoot);
  await writePackageReadme(layout, profile, sourceLock, packageRoot);
  await renderConstructedPreview(
    layout,
    profile,
    backgroundPath,
    join(constructionRoot, "selected-full.png"),
    join(constructionRoot, "constructed-selected.png"),
  );
  await writeFile(join(constructionRoot, "layout.compiled.json"), compiledLayoutReport(layout, profile), "utf8");
  await lintTheme(layout, profile, packageRoot);
  await writeChecksumManifest(packageRoot);
  const manifestText = await readFile(join(packageRoot, "manifest.sha256"), "utf8");
  const manifestSha256 = sha256Text(manifestText);
  return [
    { status: "validated", theme: layout.theme, profile: profile.id },
    { status: "built", theme: layout.theme, profile: profile.id, packagePath: `dist/${packageName}` },
    { status: "verified", theme: layout.theme, profile: profile.id, manifestSha256 },
  ];
};

const buildPass = async (
  toolchain: Toolchain,
  sourceLock: SourceLock,
  passRoot: string,
): Promise<void> => {
  const distRoot = join(passRoot, "dist");
  const buildRoot = join(passRoot, "build");
  await mkdir(distRoot, { recursive: true });
  await mkdir(buildRoot, { recursive: true });
  const layouts = await loadLayouts();
  const states: BuildState[] = [];
  for (const layout of layouts) {
    for (const profile of PROFILES) {
      states.push(...await buildProfile(toolchain, sourceLock, layout, profile, distRoot, buildRoot));
    }
  }
  await writeDerivedT4Manifest(buildRoot);
  const releaseGates = {
    referenceStateComposites: {
      status: "blocked",
      reason: "Construction previews place selector artwork only; live fixture text and timeout state are not yet rendered for comparison.",
    },
    t4SelectorGeometry: {
      status: "blocked",
      reason: "The stock-GRUB BIOS and UEFI capture comparison for all three profiles and four selector positions has not run.",
    },
  } as const;
  await writeFile(
    join(buildRoot, "index.json"),
    `${JSON.stringify({ schemaVersion: 1, states, releaseGates }, null, 2)}\n`,
    "utf8",
  );
};

const GENERATED_TREE_NAMES = ["dist", "build"] as const;
type GeneratedTreeName = typeof GENERATED_TREE_NAMES[number];

const publishGeneratedTrees = async (sourceRoot: string): Promise<void> => {
  const backupRoot = await mkdtemp(join(REPOSITORY_ROOT, ".sidonia-publish-"));
  const previousTrees = new Set<GeneratedTreeName>();
  const publishedTrees = new Set<GeneratedTreeName>();
  try {
    for (const treeName of GENERATED_TREE_NAMES) {
      const target = repositoryPath(treeName);
      if (existsSync(target)) {
        await rename(target, join(backupRoot, treeName));
        previousTrees.add(treeName);
      }
    }
    for (const treeName of GENERATED_TREE_NAMES) {
      await rename(join(sourceRoot, treeName), repositoryPath(treeName));
      publishedTrees.add(treeName);
    }
  } catch (cause: unknown) {
    try {
      for (const treeName of [...publishedTrees].reverse()) {
        await rm(repositoryPath(treeName), { recursive: true, force: true });
      }
      for (const treeName of [...previousTrees].reverse()) {
        await rename(join(backupRoot, treeName), repositoryPath(treeName));
      }
    } catch (rollbackCause: unknown) {
      throw new Error(`publish field=rollback expected=restored actual=${errorMessage(rollbackCause)}; original=${errorMessage(cause)}; backup=${backupRoot}`);
    }
    await rm(backupRoot, { recursive: true, force: true });
    throw cause;
  }
  await rm(backupRoot, { recursive: true, force: true });
};

const main = async (): Promise<void> => {
  await verifySources();
  const toolchain = await loadAndVerifyToolchain();
  await safetyScan();
  await lintFixture(toolchain);
  const sourceLock = await readJson(SourceLockSchema, repositoryPath("sources.lock.json"));
  const stagingRoot = await mkdtemp(join(REPOSITORY_ROOT, ".sidonia-build-"));
  try {
    const first = join(stagingRoot, "first");
    const second = join(stagingRoot, "second");
    await buildPass(toolchain, sourceLock, first);
    await buildPass(toolchain, sourceLock, second);
    const firstDistDigest = await treeDigest(join(first, "dist"));
    const secondDistDigest = await treeDigest(join(second, "dist"));
    const firstBuildDigest = await treeDigest(join(first, "build"));
    const secondBuildDigest = await treeDigest(join(second, "build"));
    if (firstDistDigest !== secondDistDigest || firstBuildDigest !== secondBuildDigest) {
      throw new Error(`reproducibility field=tree-digest expected=${firstDistDigest}/${firstBuildDigest} actual=${secondDistDigest}/${secondBuildDigest}`);
    }
    await publishGeneratedTrees(first);
    console.log(`built 12 candidate packages reproducibly: dist=${firstDistDigest}; release gates=reference composites blocked,T4 selector capture blocked`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
};

main().catch((cause: unknown) => {
  console.error(`theme build failed: ${errorMessage(cause)}`);
  process.exitCode = 1;
});
