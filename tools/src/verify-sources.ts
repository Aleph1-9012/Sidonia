import { readFile } from "node:fs/promises";
import { z } from "zod";
import { collectSourceLock } from "./source-evidence.js";
import { compareText, errorMessage, readJson, repositoryPath } from "./common.js";
import {
  RelativePathSchema,
  SourceLockSchema,
  T4ManifestCorrectionsSchema,
  type LockedFile,
  type SourceLock,
} from "./schemas.js";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const PositiveIntegerSchema = z.number().int().positive();
const SizeSchema = z.tuple([PositiveIntegerSchema, PositiveIntegerSchema]);

const T1AssetSchema = z.object({
  height: PositiveIntegerSchema,
  name: z.string().min(1),
  path: RelativePathSchema,
  sha256: Sha256Schema,
  width: PositiveIntegerSchema,
}).strict();

const T1CategorySchema = z.object({
  asset_count: PositiveIntegerSchema,
  assets: z.array(T1AssetSchema),
  atlas: RelativePathSchema,
}).strict();

const T1ManifestSchema = z.object({
  categories: z.object({
    brand_lockups: T1CategorySchema,
    countdown: T1CategorySchema,
    footer_controls: T1CategorySchema,
    frames: T1CategorySchema,
    guide_overlays: T1CategorySchema,
    icons: T1CategorySchema,
    menu_blocks: T1CategorySchema,
    micrographics: T1CategorySchema,
    overlays: T1CategorySchema,
    scrollbars: T1CategorySchema,
    selectors: T1CategorySchema,
    status_labels: T1CategorySchema,
    structural_panels: T1CategorySchema,
    texture_overlays: T1CategorySchema,
  }).strict(),
  format: z.literal("PNG RGBA"),
  preview: z.literal("preview.png"),
  source_reference: z.literal("T1-F.png"),
  title: z.string().min(1),
  total_assets: z.literal(91),
}).strict();

const T2CategorySchema = z.enum([
  "countdown",
  "frames",
  "generated_micrographics",
  "icons",
  "micrographics",
  "overlays",
  "rails_scrollbars",
  "selectors",
]);

const T2FilesSchema = z.union([
  z.object({
    svg: RelativePathSchema,
    png_1x: RelativePathSchema,
    png_2x: RelativePathSchema,
  }).strict(),
  z.object({
    source_atlas: RelativePathSchema,
    png_1x: RelativePathSchema,
    png_2x: RelativePathSchema,
  }).strict(),
]);

const T2AssetSchema = z.object({
  id: z.string().min(1),
  category: T2CategorySchema,
  variant: z.enum(["active", "base", "blank", "generated", "labeled"]),
  description: z.string().min(1),
  base_size: SizeSchema,
  files: T2FilesSchema,
}).strict();

const T2ManifestSchema = z.object({
  name: z.literal("Cyber Red UI Asset Pack"),
  asset_count: z.literal(110),
  categories: z.object({
    countdown: z.literal(13),
    frames: z.literal(14),
    generated_micrographics: z.literal(16),
    icons: z.literal(16),
    micrographics: z.literal(15),
    overlays: z.literal(14),
    rails_scrollbars: z.literal(12),
    selectors: z.literal(10),
  }).strict(),
  assets: z.array(T2AssetSchema).length(110),
}).strict();

const T3AssetSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  variant: z.enum(["blank", "labeled"]),
  file: RelativePathSchema,
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  description: z.string().min(1),
  source_visible: z.boolean(),
  alpha: z.literal(true),
}).strict();

const T3ManifestSchema = z.object({
  pack: z.literal("STARFIX HUD"),
  version: z.literal("1.0"),
  asset_count: z.literal(176),
  assets: z.array(T3AssetSchema).length(176),
}).strict();

const T4FileSchema = z.object({
  path: RelativePathSchema,
  sha256: Sha256Schema,
}).strict();

const T4PngFileSchema = T4FileSchema.extend({ size: SizeSchema }).strict();

const T4VariantSchema = z.object({
  svg: T4FileSchema,
  png: z.object({
    "1x": T4PngFileSchema,
    "2x": T4PngFileSchema,
    "4x": T4PngFileSchema,
  }).strict(),
}).strict();

const T4AssetSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["selectors", "frames", "icons", "controls", "countdown", "scrollbars", "micrographics", "overlays"]),
  description: z.string().min(1),
  logicalSize: SizeSchema,
  sourceRect: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    PositiveIntegerSchema,
    PositiveIntegerSchema,
  ]).nullable(),
  variants: z.object({ labeled: T4VariantSchema, blank: T4VariantSchema }).strict(),
  blankBehavior: z.enum(["structure-only", "transparent-placeholder"]),
  nineSlice: z.object({
    left: PositiveIntegerSchema,
    right: PositiveIntegerSchema,
    top: PositiveIntegerSchema,
    bottom: PositiveIntegerSchema,
  }).strict().nullable(),
  expandedBeyondVisibleSet: z.boolean(),
}).strict();

const T4ManifestSchema = z.object({
  name: z.literal("T4-F3 Expanded Industrial HUD Asset Pack"),
  version: z.literal("1.0.0"),
  sourceCanvas: z.tuple([z.literal(2048), z.literal(1152)]),
  palette: z.literal("palette.json"),
  variants: z.object({
    labeled: z.string().min(1),
    blank: z.string().min(1),
  }).strict(),
  formats: z.tuple([z.literal("SVG"), z.literal("PNG RGBA")]),
  pngScales: z.tuple([z.literal(1), z.literal(2), z.literal(4)]),
  categories: z.tuple([
    z.literal("selectors"),
    z.literal("frames"),
    z.literal("icons"),
    z.literal("controls"),
    z.literal("countdown"),
    z.literal("scrollbars"),
    z.literal("micrographics"),
    z.literal("overlays"),
  ]),
  counts: z.object({
    families: z.literal(173),
    variantFiles: z.literal(346),
    pngFiles: z.literal(1038),
    svgFiles: z.literal(346),
  }).strict(),
  assets: z.array(T4AssetSchema).length(173),
}).strict();

const T2CsvRowSchema = z.tuple([
  z.string().min(1),
  T2CategorySchema,
  z.enum(["active", "base", "blank", "generated", "labeled"]),
  z.string().min(1),
  z.coerce.number().int().positive(),
  z.coerce.number().int().positive(),
  z.string(),
  RelativePathSchema,
  RelativePathSchema,
]);

const T3CsvRowSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.enum(["blank", "labeled"]),
  RelativePathSchema,
  z.coerce.number().int().positive(),
  z.coerce.number().int().positive(),
  z.string().min(1),
  z.enum(["True", "False"]),
  z.literal("True"),
]);

const requiredLockedFile = (filesByPath: ReadonlyMap<string, LockedFile>, path: string): LockedFile => {
  const file = filesByPath.get(path);
  if (file === undefined) {
    throw new Error(`source file=${path} field=path expected=present actual=missing`);
  }
  return file;
};

const packFile = (
  filesByPath: ReadonlyMap<string, LockedFile>,
  theme: "t1" | "t2" | "t3" | "t4",
  relativePath: string,
): LockedFile => requiredLockedFile(filesByPath, `source-assets/${theme}/pack/${RelativePathSchema.parse(relativePath)}`);

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} field=path expected=unique actual=duplicate`);
  }
};

const assertImage = (
  file: LockedFile,
  expectedWidth: number,
  expectedHeight: number,
  expectedAlpha: boolean,
): void => {
  const image = file.image;
  if (image === undefined) {
    throw new Error(`source file=${file.path} field=image expected=PNG-evidence actual=missing`);
  }
  if (image.width !== expectedWidth || image.height !== expectedHeight) {
    throw new Error(
      `source file=${file.path} field=dimensions expected=${expectedWidth}x${expectedHeight} actual=${image.width}x${image.height}`,
    );
  }
  if (image.hasAlpha !== expectedAlpha) {
    throw new Error(`source file=${file.path} field=alpha expected=${String(expectedAlpha)} actual=${String(image.hasAlpha)}`);
  }
};

const readCsvRows = async (path: string, expectedHeader: string): Promise<readonly (readonly string[])[]> => {
  const text = await readFile(repositoryPath(path), "utf8");
  const lines = text.trimEnd().split(/\r?\n/u);
  const header = lines.shift();
  if (header !== expectedHeader) {
    throw new Error(`source file=${path} field=header expected=${expectedHeader} actual=${header ?? "missing"}`);
  }
  return lines.map((line) => line.split(","));
};

const verifyT1Pack = async (filesByPath: ReadonlyMap<string, LockedFile>): Promise<void> => {
  const manifest = await readJson(T1ManifestSchema, repositoryPath("source-assets/t1/pack/manifest.json"));
  const categories = Object.values(manifest.categories);
  const assets = categories.flatMap((category) => category.assets);
  if (assets.length !== manifest.total_assets) {
    throw new Error(`source theme=t1 field=asset-count expected=${manifest.total_assets} actual=${assets.length}`);
  }
  for (const category of categories) {
    if (category.asset_count !== category.assets.length) {
      throw new Error(`source theme=t1 atlas=${category.atlas} field=asset-count expected=${category.asset_count} actual=${category.assets.length}`);
    }
    packFile(filesByPath, "t1", category.atlas);
  }
  packFile(filesByPath, "t1", manifest.preview);
  assertUnique(assets.map((asset) => asset.path), "source theme=t1");
  for (const asset of assets) {
    const file = packFile(filesByPath, "t1", asset.path);
    if (file.sha256 !== asset.sha256) {
      throw new Error(`source file=${file.path} field=sha256 expected=${asset.sha256} actual=${file.sha256}`);
    }
    assertImage(file, asset.width, asset.height, true);
  }
};

const verifyT2Csv = async (manifest: z.infer<typeof T2ManifestSchema>): Promise<void> => {
  const rawRows = await readCsvRows(
    "source-assets/t2/pack/manifest.csv",
    "id,category,variant,description,width,height,svg,png_1x,png_2x",
  );
  const rows = rawRows.map((row, index) => {
    const result = T2CsvRowSchema.safeParse(row);
    if (!result.success) {
      throw new Error(`source file=source-assets/t2/pack/manifest.csv row=${index + 2} field=csv expected=valid actual=${z.prettifyError(result.error)}`);
    }
    return result.data;
  });
  if (rows.length !== manifest.assets.length) {
    throw new Error(`source theme=t2 field=csv-row-count expected=${manifest.assets.length} actual=${rows.length}`);
  }
  for (const [index, asset] of manifest.assets.entries()) {
    const files = asset.files;
    const svg = "svg" in files ? files.svg : "";
    const expected = [
      asset.id,
      asset.category,
      asset.variant,
      asset.description,
      asset.base_size[0],
      asset.base_size[1],
      svg,
      files.png_1x,
      files.png_2x,
    ];
    const actual = rows[index];
    if (actual === undefined || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`source theme=t2 field=manifest-csv row=${index + 2} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    }
  }
};

const verifyT2Pack = async (filesByPath: ReadonlyMap<string, LockedFile>): Promise<void> => {
  const manifest = await readJson(T2ManifestSchema, repositoryPath("source-assets/t2/pack/manifest.json"));
  const ids = manifest.assets.map((asset) => asset.id);
  assertUnique(ids, "source theme=t2 asset-id");
  const svgPaths: string[] = [];
  const pngPaths: string[] = [];
  for (const asset of manifest.assets) {
    const [width, height] = asset.base_size;
    const files = asset.files;
    if ("svg" in files) {
      svgPaths.push(files.svg);
      packFile(filesByPath, "t2", files.svg);
    } else {
      packFile(filesByPath, "t2", files.source_atlas);
    }
    pngPaths.push(files.png_1x, files.png_2x);
    assertImage(packFile(filesByPath, "t2", files.png_1x), width, height, true);
    assertImage(packFile(filesByPath, "t2", files.png_2x), width * 2, height * 2, true);
  }
  assertUnique(svgPaths, "source theme=t2 svg");
  assertUnique(pngPaths, "source theme=t2 png");
  if (svgPaths.length !== 94 || pngPaths.length !== 220) {
    throw new Error(`source theme=t2 field=declared-files expected=94-svg/220-png actual=${svgPaths.length}-svg/${pngPaths.length}-png`);
  }
  await verifyT2Csv(manifest);
};

const verifyT3Csv = async (manifest: z.infer<typeof T3ManifestSchema>): Promise<void> => {
  const rawRows = await readCsvRows(
    "source-assets/t3/pack/asset_index.csv",
    "category,id,variant,file,width,height,description,source_visible,alpha",
  );
  const rows = rawRows.map((row, index) => {
    const result = T3CsvRowSchema.safeParse(row);
    if (!result.success) {
      throw new Error(`source file=source-assets/t3/pack/asset_index.csv row=${index + 2} field=csv expected=valid actual=${z.prettifyError(result.error)}`);
    }
    return result.data;
  });
  if (rows.length !== manifest.assets.length) {
    throw new Error(`source theme=t3 field=csv-row-count expected=${manifest.assets.length} actual=${rows.length}`);
  }
  for (const [index, asset] of manifest.assets.entries()) {
    const expected = [
      asset.category,
      asset.id,
      asset.variant,
      asset.file,
      asset.width,
      asset.height,
      asset.description,
      asset.source_visible ? "True" : "False",
      "True",
    ];
    const actual = rows[index];
    if (actual === undefined || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`source theme=t3 field=manifest-csv row=${index + 2} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    }
  }
};

const verifyT3Pack = async (filesByPath: ReadonlyMap<string, LockedFile>): Promise<void> => {
  const manifest = await readJson(T3ManifestSchema, repositoryPath("source-assets/t3/pack/manifest.json"));
  assertUnique(manifest.assets.map((asset) => asset.file), "source theme=t3");
  for (const asset of manifest.assets) {
    assertImage(packFile(filesByPath, "t3", asset.file), asset.width, asset.height, asset.alpha);
  }
  await verifyT3Csv(manifest);
};

const verifyT4File = (
  filesByPath: ReadonlyMap<string, LockedFile>,
  declared: z.infer<typeof T4FileSchema>,
  correctionsByPath: ReadonlyMap<string, { readonly recorded: string; readonly actual: string }>,
): LockedFile => {
  const file = packFile(filesByPath, "t4", declared.path);
  const correction = correctionsByPath.get(declared.path);
  const expectedHash = correction?.actual ?? declared.sha256;
  if (correction !== undefined && declared.sha256 !== correction.recorded) {
    throw new Error(`t4 source manifest file=${declared.path} field=sha256 expected=${correction.recorded} actual=${declared.sha256}`);
  }
  if (file.sha256 !== expectedHash) {
    throw new Error(`source file=${file.path} field=sha256 expected=${expectedHash} actual=${file.sha256}`);
  }
  return file;
};

const verifyT4Pack = async (filesByPath: ReadonlyMap<string, LockedFile>): Promise<void> => {
  const manifest = await readJson(T4ManifestSchema, repositoryPath("source-assets/t4/pack/manifest.json"));
  const correctionFile = await readJson(
    T4ManifestCorrectionsSchema,
    repositoryPath("themes/t4/compositions/manifest-corrections.json"),
  );
  const correctionsByPath: ReadonlyMap<string, { readonly recorded: string; readonly actual: string }> =
    new Map(correctionFile.corrections.map((correction) => [correction.path, correction]));
  const declaredPaths: string[] = [];
  const correctedPaths = new Set<string>();
  for (const asset of manifest.assets) {
    const nineSlice = asset.nineSlice;
    if (nineSlice !== null) {
      const horizontalCaps = nineSlice.left + nineSlice.right;
      const verticalCaps = nineSlice.top + nineSlice.bottom;
      if (horizontalCaps >= asset.logicalSize[0] || verticalCaps >= asset.logicalSize[1]) {
        throw new Error(`source theme=t4 asset=${asset.id} field=nine-slice expected=positive-center actual=${horizontalCaps}x${verticalCaps}`);
      }
    }
    for (const variant of [asset.variants.labeled, asset.variants.blank]) {
      declaredPaths.push(variant.svg.path);
      verifyT4File(filesByPath, variant.svg, correctionsByPath);
      for (const png of [variant.png["1x"], variant.png["2x"], variant.png["4x"]]) {
        declaredPaths.push(png.path);
        const file = verifyT4File(filesByPath, png, correctionsByPath);
        assertImage(file, png.size[0], png.size[1], true);
        if (correctionsByPath.has(png.path)) {
          correctedPaths.add(png.path);
        }
      }
    }
  }
  assertUnique(declaredPaths, "source theme=t4");
  const expectedDeclaredCount = manifest.counts.svgFiles + manifest.counts.pngFiles;
  if (declaredPaths.length !== expectedDeclaredCount) {
    throw new Error(`source theme=t4 field=declared-files expected=${expectedDeclaredCount} actual=${declaredPaths.length}`);
  }
  if (correctedPaths.size !== correctionFile.corrections.length) {
    throw new Error(`source theme=t4 field=manifest-corrections expected=${correctionFile.corrections.length} actual=${correctedPaths.size}`);
  }
};

export const verifyCanonicalSourcePacks = async (lock: SourceLock): Promise<void> => {
  const filesByPath = new Map(lock.files.map((file) => [file.path, file]));
  await verifyT1Pack(filesByPath);
  await verifyT2Pack(filesByPath);
  await verifyT3Pack(filesByPath);
  await verifyT4Pack(filesByPath);
};

const compareLocks = (expected: SourceLock, actual: SourceLock): void => {
  const expectedText = JSON.stringify(expected);
  const actualText = JSON.stringify(actual);
  if (expectedText === actualText) {
    return;
  }
  const expectedByPath = new Map(expected.files.map((file) => [file.path, file]));
  const actualByPath = new Map(actual.files.map((file) => [file.path, file]));
  const paths = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])].sort(compareText);
  for (const path of paths) {
    const locked = expectedByPath.get(path);
    const current = actualByPath.get(path);
    if (locked === undefined) {
      throw new Error(`source field=path expected=absent actual=${path}`);
    }
    if (current === undefined) {
      throw new Error(`source file=${path} field=path expected=present actual=missing`);
    }
    if (JSON.stringify(locked) !== JSON.stringify(current)) {
      throw new Error(`source file=${path} field=evidence expected=${JSON.stringify(locked)} actual=${JSON.stringify(current)}`);
    }
  }
  throw new Error("source field=provenance expected=locked-metadata actual=different");
};

export const verifySources = async (): Promise<void> => {
  const expected = await readJson(SourceLockSchema, repositoryPath("sources.lock.json"));
  const actual = await collectSourceLock();
  compareLocks(expected, actual);
  await verifyCanonicalSourcePacks(actual);
};

const main = async (): Promise<void> => {
  await verifySources();
  console.log("source verification passed: 4 references, 4 canonical packs, vendored font");
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((cause: unknown) => {
    console.error(`source verification failed: ${errorMessage(cause)}`);
    process.exitCode = 1;
  });
}
