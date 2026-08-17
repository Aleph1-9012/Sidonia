import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import { errorMessage, readJson, repositoryPath, sha256File } from "./common.js";
import { AbsolutePathSchema, ToolchainSchema, type Toolchain } from "./schemas.js";

export const ExecutableIdSchema = z.enum(["grubMkfont", "grubScriptCheck"]);
export type ExecutableId = z.infer<typeof ExecutableIdSchema>;

type LockedTool = Readonly<{ path: string; sha256: string }>;

const RuntimeVersionsSchema = z.object({
  sharp: z.string().min(1),
  vips: z.string().min(1),
  png: z.string().min(1),
  spng: z.string().min(1),
});

const ProcessReportSchema = z.object({
  header: z.object({ glibcVersionRuntime: z.string().min(1) }),
});

const PackageMetadataSchema = z.object({
  packageManager: z.string().min(1),
  engines: z.object({ node: z.string().min(1), pnpm: z.string().min(1) }).strict(),
  dependencies: z.object({ sharp: z.string().min(1) }),
});

const ChildProcessFailureSchema = z.object({
  code: z.union([z.number().int(), z.string()]).nullable().optional(),
  signal: z.string().nullable().optional(),
  killed: z.boolean().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

const toolFor = (toolchain: Toolchain, executable: ExecutableId): LockedTool => {
  switch (executable) {
    case "grubMkfont":
      return toolchain.grub.mkfont;
    case "grubScriptCheck":
      return toolchain.grub.scriptCheck;
  }
};

const verifyLockedFile = async (tool: LockedTool, executable: boolean): Promise<void> => {
  const path = AbsolutePathSchema.parse(tool.path);
  const evidence = await lstat(path);
  if (evidence.isSymbolicLink() || !evidence.isFile() || evidence.size === 0) {
    throw new Error(`toolchain file=${path} field=fileType expected=non-empty-regular-file actual=invalid`);
  }
  if (executable) {
    try {
      await access(path, constants.X_OK);
    } catch (cause: unknown) {
      throw new Error(`toolchain file=${path} field=executable expected=true actual=${errorMessage(cause)}`);
    }
  }
  const actual = await sha256File(path);
  if (actual !== tool.sha256) {
    throw new Error(`toolchain file=${path} field=sha256 expected=${tool.sha256} actual=${actual}`);
  }
};

const verifyPlatform = (toolchain: Toolchain): void => {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(`toolchain field=platform expected=${toolchain.platform} actual=${process.platform}-${process.arch}`);
  }
  const report = ProcessReportSchema.parse(process.report.getReport());
  const actual = `linux-x86_64-glibc-${report.header.glibcVersionRuntime}`;
  if (actual !== toolchain.platform) {
    throw new Error(`toolchain field=platform expected=${toolchain.platform} actual=${actual}`);
  }
};

const verifyNodePackages = async (toolchain: Toolchain): Promise<void> => {
  const packageMetadata = await readJson(PackageMetadataSchema, repositoryPath("package.json"));
  const expectedPackageManager = `pnpm@${toolchain.pnpm.version}`;
  if (packageMetadata.packageManager !== expectedPackageManager) {
    throw new Error(`toolchain file=package.json field=packageManager expected=${expectedPackageManager} actual=${packageMetadata.packageManager}`);
  }
  if (packageMetadata.engines.node !== toolchain.node.version || packageMetadata.engines.pnpm !== toolchain.pnpm.version) {
    throw new Error(
      `toolchain file=package.json field=engines expected=${toolchain.node.version}/${toolchain.pnpm.version} actual=${packageMetadata.engines.node}/${packageMetadata.engines.pnpm}`,
    );
  }
  if (packageMetadata.dependencies.sharp !== toolchain.pngEncoder.packageVersion) {
    throw new Error(
      `toolchain file=package.json field=sharp expected=${toolchain.pngEncoder.packageVersion} actual=${packageMetadata.dependencies.sharp}`,
    );
  }
  const runtimeVersions = RuntimeVersionsSchema.parse(sharp.versions);
  const expectedRuntime = toolchain.pngEncoder.nativeRuntime;
  if (
    runtimeVersions.sharp !== toolchain.pngEncoder.packageVersion
    || runtimeVersions.vips !== expectedRuntime.vipsVersion
    || runtimeVersions.png !== expectedRuntime.libpngVersion
    || runtimeVersions.spng !== expectedRuntime.spngVersion
  ) {
    throw new Error(
      `toolchain field=pngEncoder expected=${toolchain.pngEncoder.packageVersion}/${expectedRuntime.vipsVersion}/${expectedRuntime.libpngVersion}/${expectedRuntime.spngVersion} actual=${runtimeVersions.sharp}/${runtimeVersions.vips}/${runtimeVersions.png}/${runtimeVersions.spng}`,
    );
  }
};

export const loadAndVerifyToolchain = async (): Promise<Toolchain> => {
  const toolchain = await readJson(ToolchainSchema, repositoryPath("toolchain.lock"));
  verifyPlatform(toolchain);
  const executableTools = [
    toolchain.imagemagick,
    toolchain.grub.mkfont,
    toolchain.grub.scriptCheck,
    toolchain.grub.mkstandalone,
    toolchain.qemu,
    toolchain.xorriso,
  ];
  for (const tool of executableTools) {
    await verifyLockedFile(tool, true);
  }
  await verifyLockedFile({ path: toolchain.ovmf.codePath, sha256: toolchain.ovmf.sha256 }, false);
  const nodeVersion = process.version.slice(1);
  if (nodeVersion !== toolchain.node.version) {
    throw new Error(`toolchain field=node.version expected=${toolchain.node.version} actual=${nodeVersion}`);
  }
  await verifyNodePackages(toolchain);
  return toolchain;
};

export const commandPath = (toolchain: Toolchain, executable: ExecutableId): string =>
  toolFor(toolchain, executable).path;

const outputExcerpt = (output: string | undefined): string =>
  output === undefined || output.length === 0 ? "empty" : JSON.stringify(output.slice(0, 2048));

export const toolFailure = (executable: ExecutableId, cause: unknown): Error => {
  const failure = ChildProcessFailureSchema.safeParse(cause);
  if (!failure.success) {
    return new Error(`subprocess executable=${executable} field=exitStatus expected=0 actual=${errorMessage(cause)}`);
  }
  return new Error(
    `subprocess executable=${executable} field=exitStatus expected=0 actual=${String(failure.data.code ?? failure.data.signal ?? "failure")}`
    + ` killed=${String(failure.data.killed ?? false)}`
    + ` stdout=${outputExcerpt(failure.data.stdout)}`
    + ` stderr=${outputExcerpt(failure.data.stderr)}`,
  );
};
