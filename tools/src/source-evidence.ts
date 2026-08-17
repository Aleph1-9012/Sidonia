import { randomUUID } from "node:crypto";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  REPOSITORY_ROOT,
  compareText,
  listRegularFiles,
  repositoryPath,
  sha256File,
  toRepositoryRelative,
} from "./common.js";
import {
  ImageEvidenceSchema,
  SOURCE_FONT,
  SOURCE_PROVENANCE,
  SourceLockSchema,
  type ImageEvidence,
  type LockedFile,
  type SourceLock,
} from "./schemas.js";

const SharpMetadataSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  channels: z.union([z.literal(3), z.literal(4)]),
  depth: z.literal("uchar"),
  space: z.literal("srgb"),
  hasAlpha: z.boolean(),
  isProgressive: z.boolean().optional(),
});

const REFERENCE_SPECS = [
  {
    path: "source-assets/t1/reference.png",
    sha256: SOURCE_PROVENANCE[0].referenceSha256,
    width: 6688,
    height: 3764,
  },
  {
    path: "source-assets/t2/reference.png",
    sha256: SOURCE_PROVENANCE[1].referenceSha256,
    width: 6688,
    height: 3764,
  },
  {
    path: "source-assets/t3/reference.png",
    sha256: SOURCE_PROVENANCE[2].referenceSha256,
    width: 3344,
    height: 1882,
  },
  {
    path: "source-assets/t4/reference.png",
    sha256: SOURCE_PROVENANCE[3].referenceSha256,
    width: 3344,
    height: 1882,
  },
] as const;

export const readImageEvidence = async (absolutePath: string): Promise<ImageEvidence> => {
  const metadata = SharpMetadataSchema.parse(await sharp(absolutePath, { failOn: "error" }).metadata());
  return ImageEvidenceSchema.parse({
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
    depth: metadata.depth,
    space: metadata.space,
    hasAlpha: metadata.hasAlpha,
    isProgressive: metadata.isProgressive ?? false,
  });
};

const evidenceForFile = async (absolutePath: string): Promise<LockedFile> => {
  const fileEvidence = await stat(absolutePath);
  const base = {
    path: toRepositoryRelative(absolutePath),
    size: fileEvidence.size,
    sha256: await sha256File(absolutePath),
  };
  if (extname(absolutePath).toLowerCase() === ".png") {
    return { ...base, image: await readImageEvidence(absolutePath) };
  }
  return base;
};

const requiredLockedFile = (filesByPath: ReadonlyMap<string, LockedFile>, path: string): LockedFile => {
  const file = filesByPath.get(path);
  if (file === undefined) {
    throw new Error(`source file=${path} field=path expected=present actual=missing`);
  }
  return file;
};

const verifyReferenceEvidence = (filesByPath: ReadonlyMap<string, LockedFile>): void => {
  for (const reference of REFERENCE_SPECS) {
    const file = requiredLockedFile(filesByPath, reference.path);
    if (file.sha256 !== reference.sha256) {
      throw new Error(`source file=${reference.path} field=sha256 expected=${reference.sha256} actual=${file.sha256}`);
    }
    const image = file.image;
    if (image === undefined) {
      throw new Error(`source file=${reference.path} field=image expected=PNG-evidence actual=missing`);
    }
    if (image.width !== reference.width || image.height !== reference.height) {
      throw new Error(
        `source file=${reference.path} field=dimensions expected=${reference.width}x${reference.height} actual=${image.width}x${image.height}`,
      );
    }
    if (image.hasAlpha || image.channels !== 3) {
      throw new Error(
        `source file=${reference.path} field=color expected=opaque-RGB actual=channels-${image.channels}-alpha-${String(image.hasAlpha)}`,
      );
    }
  }
};

const verifyCanonicalRoots = (files: readonly LockedFile[]): void => {
  const permittedVendorPaths = new Set([
    SOURCE_FONT.path,
    SOURCE_FONT.licence,
    "vendor/fonts/SOURCE.md",
  ]);
  for (const file of files) {
    if (file.path.startsWith("vendor/fonts/")) {
      if (!permittedVendorPaths.has(file.path)) {
        throw new Error(`source file=${file.path} field=canonical-root expected=pinned-font-provenance actual=unexpected`);
      }
      continue;
    }
    const canonicalThemeRoot = SOURCE_PROVENANCE.find((source) =>
      file.path === `source-assets/${source.theme}/reference.png`
      || file.path.startsWith(`${source.importedRoot}/`));
    if (canonicalThemeRoot === undefined) {
      throw new Error(`source file=${file.path} field=canonical-root expected=t1..t4-reference-or-pack actual=unexpected`);
    }
  }
};

export const verifyTrustedSourceEvidence = (lock: SourceLock): void => {
  const filesByPath = new Map(lock.files.map((file) => [file.path, file]));
  verifyReferenceEvidence(filesByPath);
  const font = requiredLockedFile(filesByPath, SOURCE_FONT.path);
  if (font.sha256 !== SOURCE_FONT.sha256) {
    throw new Error(`source file=${SOURCE_FONT.path} field=sha256 expected=${SOURCE_FONT.sha256} actual=${font.sha256}`);
  }
  requiredLockedFile(filesByPath, SOURCE_FONT.licence);
  requiredLockedFile(filesByPath, "vendor/fonts/SOURCE.md");
  for (const source of SOURCE_PROVENANCE) {
    const hasPackFile = lock.files.some((file) => file.path.startsWith(`${source.importedRoot}/`));
    if (!hasPackFile) {
      throw new Error(`source root=${source.importedRoot} field=files expected=non-empty actual=missing`);
    }
  }
  verifyCanonicalRoots(lock.files);
};

export const collectSourceLock = async (): Promise<SourceLock> => {
  const roots = [repositoryPath("source-assets"), repositoryPath("vendor/fonts")];
  const absoluteFiles = (
    await Promise.all(roots.map(async (root) => listRegularFiles(root)))
  ).flat().sort(compareText);
  const files: LockedFile[] = [];
  for (const absoluteFile of absoluteFiles) {
    files.push(await evidenceForFile(absoluteFile));
  }
  const lock = SourceLockSchema.parse({
    schemaVersion: 1,
    rounding: "round-half-up-after-scaling-from-2048x1152",
    provenance: SOURCE_PROVENANCE,
    font: SOURCE_FONT,
    files,
  });
  verifyTrustedSourceEvidence(lock);
  return lock;
};

export const writeSourceLock = async (lock: SourceLock): Promise<void> => {
  const validatedLock = SourceLockSchema.parse(lock);
  verifyTrustedSourceEvidence(validatedLock);
  const output = `${JSON.stringify(validatedLock, null, 2)}\n`;
  const temporaryPath = repositoryPath(`.sources.lock.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, output, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, repositoryPath("sources.lock.json"));
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

export const sourceSummary = (lock: SourceLock): string =>
  `locked ${lock.files.length} files below ${REPOSITORY_ROOT}`;
