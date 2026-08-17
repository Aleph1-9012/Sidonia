import { z } from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const VersionSchema = z.string().min(1).max(128).regex(/^[0-9A-Za-z][0-9A-Za-z.+:~_-]*$/u);
const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }
  return false;
};
const NonEmptyTextSchema = z.string().trim().min(1).max(512)
  .refine((value) => !hasControlCharacter(value), "text must not contain control characters");

export const RelativePathSchema = z.string().min(1).max(4096)
  .refine((value) => !value.startsWith("/"), "path must be repository-relative")
  .refine((value) => !value.endsWith("/"), "path must name a file or directory")
  .refine((value) => !value.includes("\\"), "path must use POSIX separators")
  .refine((value) => !hasControlCharacter(value), "path must not contain control characters")
  .refine(
    (value) => value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "path must be canonical and must not traverse",
  );

export const AbsolutePathSchema = z.string().min(2).max(4096)
  .refine((value) => value.startsWith("/"), "path must be absolute")
  .refine((value) => !value.endsWith("/"), "path must name a file or directory")
  .refine((value) => !value.includes("\\"), "path must use POSIX separators")
  .refine((value) => !hasControlCharacter(value), "path must not contain control characters")
  .refine(
    (value) => value.slice(1).split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "path must be canonical and must not traverse",
  );

export const ThemeIdSchema = z.enum(["t1", "t2", "t3", "t4"]);
export type ThemeId = z.infer<typeof ThemeIdSchema>;

export const ProfileIdSchema = z.enum(["720p", "1080p", "1440p"]);
export type ProfileId = z.infer<typeof ProfileIdSchema>;

export const ProfileSchema = z.discriminatedUnion("id", [
  z.object({
    id: z.literal("720p"),
    width: z.literal(1280),
    height: z.literal(720),
    scale: z.literal(0.625),
  }).strict(),
  z.object({
    id: z.literal("1080p"),
    width: z.literal(1920),
    height: z.literal(1080),
    scale: z.literal(0.9375),
  }).strict(),
  z.object({
    id: z.literal("1440p"),
    width: z.literal(2560),
    height: z.literal(1440),
    scale: z.literal(1.25),
  }).strict(),
]);
export type Profile = z.infer<typeof ProfileSchema>;

const HexColorSchema = z.string().regex(/^#[0-9A-F]{6}$/u);

const RectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

const ColoredRectSchema = RectSchema.extend({ color: HexColorSchema }).strict();

const OverlaySchema = RectSchema.extend({ source: RelativePathSchema }).strict();

const DecorationSchema = z.object({
  source: RelativePathSchema,
  crop: RectSchema.optional(),
  target: RectSchema,
}).strict();

const SelectorSchema = z.object({
  source: RelativePathSchema,
  crop: RectSchema.optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  slices: z.object({
    left: z.number().int().positive(),
    top: z.number().int().positive(),
    right: z.number().int().positive(),
    bottom: z.number().int().positive(),
  }).strict(),
  decorations: z.array(DecorationSchema).optional(),
}).strict();

const GrubTextSchema = z.string().min(1).max(256)
  .refine((value) => !hasControlCharacter(value), "text must not contain control characters");

export const LayoutSchema = z.object({
  schemaVersion: z.literal(1),
  theme: ThemeIdSchema,
  displayName: GrubTextSchema,
  reference: RelativePathSchema,
  canvas: z.object({
    width: z.literal(2048),
    height: z.literal(1152),
  }).strict(),
  palette: z.object({
    background: HexColorSchema,
    idleText: HexColorSchema,
    selectedText: HexColorSchema,
    signal: HexColorSchema,
  }).strict(),
  font: z.object({
    source: RelativePathSchema,
    family: GrubTextSchema.regex(/^[0-9A-Za-z][0-9A-Za-z ._-]*$/u),
    designSize: z.number().int().positive(),
  }).strict(),
  menu: RectSchema.extend({
    itemHeight: z.number().int().positive(),
    itemSpacing: z.number().int(),
    itemPadding: z.number().int().nonnegative(),
    visibleItems: z.literal(4),
    selector: SelectorSchema,
  }).strict(),
  background: z.object({
    eraseRects: z.array(ColoredRectSchema),
    idleOverlays: z.array(OverlaySchema),
    lineRects: z.array(ColoredRectSchema),
  }).strict(),
  progress: ColoredRectSchema.extend({
    foreground: HexColorSchema,
    background: HexColorSchema,
  }).omit({ color: true }).strict(),
  preview: z.object({
    selectedIndex: z.number().int().min(0).max(3),
    entries: z.tuple([GrubTextSchema, GrubTextSchema, GrubTextSchema, GrubTextSchema]),
  }).strict(),
}).strict();
export type Layout = z.infer<typeof LayoutSchema>;

export const ImageEvidenceSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  channels: z.union([z.literal(3), z.literal(4)]),
  depth: z.literal("uchar"),
  space: z.literal("srgb"),
  hasAlpha: z.boolean(),
  isProgressive: z.literal(false),
}).strict().superRefine((image, context) => {
  const expectedChannels = image.hasAlpha ? 4 : 3;
  if (image.channels !== expectedChannels) {
    context.addIssue({
      code: "custom",
      path: ["channels"],
      message: `expected ${expectedChannels} channels when hasAlpha=${String(image.hasAlpha)}`,
    });
  }
});
export type ImageEvidence = z.infer<typeof ImageEvidenceSchema>;

const LockedFileSchema = z.object({
  path: RelativePathSchema,
  size: z.number().int().positive(),
  sha256: Sha256Schema,
  image: ImageEvidenceSchema.optional(),
}).strict().superRefine((file, context) => {
  const isPng = file.path.toLowerCase().endsWith(".png");
  if (isPng !== (file.image !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["image"],
      message: isPng ? "PNG files require image evidence" : "non-PNG files must not carry image evidence",
    });
  }
});
export type LockedFile = z.infer<typeof LockedFileSchema>;

export const SOURCE_PROVENANCE = [
  {
    theme: "t1",
    referenceSha256: "7510565cf8afde7a3afbcb46aa57a00a6105011a1436ccee1ff87924c75698aa",
    archiveName: "T1-F-ui-assets-expanded.zip",
    archiveSha256: "12d686f6e2b8b351ddca7b96b8ce713378de938e3472e7f73a65090f32c5c230",
    importedRoot: "source-assets/t1/pack",
  },
  {
    theme: "t2",
    referenceSha256: "ec921f135bc9463988a5ef47bdfd5c371a418b1ab8640bcbaf8ac96b5eafcbea",
    archiveName: "Cyber_Red_UI_Asset_Pack.zip",
    archiveSha256: "83d2d5a31d8765fca2a9effbe64e15480c992f01e5e9e6618b126f9abc684dfb",
    importedRoot: "source-assets/t2/pack",
  },
  {
    theme: "t3",
    referenceSha256: "f75914fc5681011dedcc13062d758b09eafe283deaa2648383d28069cd2519b5",
    archiveName: "starfix_hud_asset_pack.zip",
    archiveSha256: "3e50644e3b2f7166e6f5bc0e9bc4f273990829b413e8f31d7cd12c7ca7cc0d15",
    importedRoot: "source-assets/t3/pack",
  },
  {
    theme: "t4",
    referenceSha256: "dbe6c3cd66690e3cfe1d40ec84ccd19edb6621d356aeb932a288d747d855a013",
    archiveName: "t4_f3_expanded_hud_asset_pack.zip",
    archiveSha256: "4e0a2f7fc6f1b4b6fd2a662280c8f36b8ada0063a6bdc2fce1116ec73fb96dac",
    importedRoot: "source-assets/t4/pack",
  },
] as const;

const sourceProvenanceSchema = <const Source extends (typeof SOURCE_PROVENANCE)[number]>(source: Source) =>
  z.object({
    theme: z.literal(source.theme),
    referenceSha256: z.literal(source.referenceSha256),
    archiveName: z.literal(source.archiveName),
    archiveSha256: z.literal(source.archiveSha256),
    importedRoot: z.literal(source.importedRoot),
  }).strict();

export const SOURCE_FONT = {
  path: "vendor/fonts/DejaVuSansMono.ttf",
  sha256: "b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582",
  licence: "vendor/fonts/LICENSES/DejaVu-Fonts.txt",
} as const;

export const SourceLockSchema = z.object({
  schemaVersion: z.literal(1),
  rounding: z.literal("round-half-up-after-scaling-from-2048x1152"),
  provenance: z.tuple([
    sourceProvenanceSchema(SOURCE_PROVENANCE[0]),
    sourceProvenanceSchema(SOURCE_PROVENANCE[1]),
    sourceProvenanceSchema(SOURCE_PROVENANCE[2]),
    sourceProvenanceSchema(SOURCE_PROVENANCE[3]),
  ]),
  font: z.object({
    path: z.literal(SOURCE_FONT.path),
    sha256: z.literal(SOURCE_FONT.sha256),
    licence: z.literal(SOURCE_FONT.licence),
  }).strict(),
  files: z.array(LockedFileSchema).min(1),
}).strict().superRefine((lock, context) => {
  const seenPaths = new Set<string>();
  const seenCaseFoldedPaths = new Set<string>();
  let previousPath: string | undefined;
  for (const [index, file] of lock.files.entries()) {
    if (!file.path.startsWith("source-assets/") && !file.path.startsWith("vendor/fonts/")) {
      context.addIssue({
        code: "custom",
        path: ["files", index, "path"],
        message: "locked files must be below source-assets/ or vendor/fonts/",
      });
    }
    if (seenPaths.has(file.path)) {
      context.addIssue({ code: "custom", path: ["files", index, "path"], message: "duplicate locked path" });
    }
    const caseFoldedPath = file.path.toLowerCase();
    if (seenCaseFoldedPaths.has(caseFoldedPath)) {
      context.addIssue({ code: "custom", path: ["files", index, "path"], message: "case-folding path collision" });
    }
    if (previousPath !== undefined && previousPath >= file.path) {
      context.addIssue({
        code: "custom",
        path: ["files", index, "path"],
        message: "locked paths must be strictly bytewise sorted",
      });
    }
    seenPaths.add(file.path);
    seenCaseFoldedPaths.add(caseFoldedPath);
    previousPath = file.path;
  }
});
export type SourceLock = z.infer<typeof SourceLockSchema>;

const ToolSchema = z.object({
  path: AbsolutePathSchema,
  sha256: Sha256Schema,
}).strict();

const ContainerBaseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pinned"),
    image: z.string().min(1).max(512),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  }).strict(),
  z.object({
    status: z.literal("not-used"),
    reason: NonEmptyTextSchema,
  }).strict(),
]);

export const ToolchainSchema = z.object({
  schemaVersion: z.literal(1),
  platform: z.string().regex(/^linux-x86_64-glibc-[0-9]+\.[0-9]+$/u),
  containerBase: ContainerBaseSchema,
  node: z.object({ version: VersionSchema }).strict(),
  pnpm: z.object({ version: VersionSchema }).strict(),
  imagemagick: ToolSchema.extend({ version: VersionSchema }).strict(),
  grub: z.object({
    version: VersionSchema,
    mkfont: ToolSchema,
    scriptCheck: ToolSchema,
    mkstandalone: ToolSchema,
  }).strict(),
  qemu: ToolSchema.extend({ version: VersionSchema }).strict(),
  ovmf: z.object({
    version: VersionSchema,
    codePath: AbsolutePathSchema,
    sha256: Sha256Schema,
  }).strict(),
  xorriso: ToolSchema.extend({ version: VersionSchema }).strict(),
  pngEncoder: z.object({
    implementation: z.literal("sharp/libvips"),
    packageVersion: VersionSchema,
    nativeRuntime: z.object({
      vipsVersion: VersionSchema,
      libpngVersion: VersionSchema,
      spngVersion: VersionSchema,
    }).strict(),
  }).strict(),
  fontConverter: z.object({
    implementation: z.literal("grub-mkfont"),
    version: VersionSchema,
  }).strict(),
}).strict().superRefine((toolchain, context) => {
  const paths = [
    toolchain.imagemagick.path,
    toolchain.grub.mkfont.path,
    toolchain.grub.scriptCheck.path,
    toolchain.grub.mkstandalone.path,
    toolchain.qemu.path,
    toolchain.ovmf.codePath,
    toolchain.xorriso.path,
  ];
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", path: ["grub"], message: "tool paths must be unique" });
  }
  if (toolchain.fontConverter.version !== toolchain.grub.version) {
    context.addIssue({
      code: "custom",
      path: ["fontConverter", "version"],
      message: "font-converter version must equal the locked GRUB version",
    });
  }
});
export type Toolchain = z.infer<typeof ToolchainSchema>;

export const T4ManifestCorrectionsSchema = z.object({
  schemaVersion: z.literal(1),
  corrections: z.tuple([
    z.object({
      path: z.literal("exports/png/4x/overlays/overlay-full-composition--blank@4x.png"),
      recorded: z.literal("1359ca9fcc8be0bf10cbba0045255fdd87df1ecb56f176a7171db74597bfbc30"),
      actual: z.literal("44b644574528b002c57ba763eb99ef547f6cdf1433c954cac96a4ecbdfbe0515"),
    }).strict(),
    z.object({
      path: z.literal("exports/png/4x/overlays/panel-main-console--labeled@4x.png"),
      recorded: z.literal("c64d1dfaf3fd42d7f2eb363a85d4aadb98c2d83cd552cc17580369afca0f2f9f"),
      actual: z.literal("6634c6107ce1e6bdf33da0d7a5ed3a7695ef75e7107a7fe26518e0573e068c56"),
    }).strict(),
  ]),
}).strict();

export const BuildStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("validated"), theme: ThemeIdSchema, profile: ProfileIdSchema }).strict(),
  z.object({
    status: z.literal("built"),
    theme: ThemeIdSchema,
    profile: ProfileIdSchema,
    packagePath: RelativePathSchema,
  }).strict(),
  z.object({
    status: z.literal("verified"),
    theme: ThemeIdSchema,
    profile: ProfileIdSchema,
    manifestSha256: Sha256Schema,
  }).strict(),
]);
export type BuildState = z.infer<typeof BuildStateSchema>;
