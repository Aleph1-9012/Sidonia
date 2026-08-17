import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AbsolutePathSchema, RelativePathSchema } from "./schemas.js";

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const JsonTextSchema = z.string().min(1);

export const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

export const errorMessage = (cause: unknown): string => {
  const errorResult = z.instanceof(Error).safeParse(cause);
  if (errorResult.success) {
    return errorResult.data.message;
  }
  const stringResult = z.string().safeParse(cause);
  return stringResult.success ? stringResult.data : "unrecognized failure";
};

const assertAbsolutePathInsideRepository = (absolutePath: string, allowRoot: boolean): void => {
  const parsedPath = AbsolutePathSchema.parse(absolutePath);
  const prefix = `${REPOSITORY_ROOT}${sep}`;
  if ((!allowRoot && parsedPath === REPOSITORY_ROOT) || (parsedPath !== REPOSITORY_ROOT && !parsedPath.startsWith(prefix))) {
    throw new Error(`path escapes repository: ${absolutePath}`);
  }
};

export const repositoryPath = (repoRelativePath: string): string => {
  const parsedPath = RelativePathSchema.parse(repoRelativePath);
  const candidate = resolve(REPOSITORY_ROOT, parsedPath.replaceAll("/", sep));
  assertAbsolutePathInsideRepository(candidate, false);
  return candidate;
};

export const toRepositoryRelative = (absolutePath: string): string => {
  assertAbsolutePathInsideRepository(absolutePath, false);
  return RelativePathSchema.parse(relative(REPOSITORY_ROOT, absolutePath).split(sep).join("/"));
};

export const readJson = async <Output>(schema: z.ZodType<Output>, absolutePath: string): Promise<Output> => {
  const parsedPath = AbsolutePathSchema.parse(absolutePath);
  const text = JsonTextSchema.parse(await readFile(parsedPath, "utf8"));
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (cause: unknown) {
    throw new Error(`file=${parsedPath} field=json expected=valid actual=${errorMessage(cause)}`);
  }
  const result = schema.safeParse(decoded);
  if (!result.success) {
    throw new Error(`file=${parsedPath} field=schema expected=valid actual=${z.prettifyError(result.error)}`);
  }
  return result.data;
};

export const sha256File = async (absolutePath: string): Promise<string> => {
  const content = await readFile(AbsolutePathSchema.parse(absolutePath));
  return createHash("sha256").update(content).digest("hex");
};

export const sha256Text = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

const walkRegularFiles = async (absoluteRoot: string): Promise<readonly string[]> => {
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const candidate = resolve(absoluteRoot, entry.name);
    assertAbsolutePathInsideRepository(candidate, false);
    const entryEvidence = await lstat(candidate);
    if (entryEvidence.isSymbolicLink()) {
      throw new Error(`symbolic links are forbidden: ${toRepositoryRelative(candidate)}`);
    }
    if (entryEvidence.isDirectory()) {
      files.push(...await walkRegularFiles(candidate));
      continue;
    }
    if (!entryEvidence.isFile()) {
      throw new Error(`unsupported source entry: ${toRepositoryRelative(candidate)}`);
    }
    files.push(candidate);
  }
  return files;
};

export const assertExistingRepositoryDirectory = async (repoRelativePath: string): Promise<string> => {
  const absolutePath = repositoryPath(repoRelativePath);
  const linkEvidence = await lstat(absolutePath);
  if (linkEvidence.isSymbolicLink()) {
    throw new Error(`symbolic links are forbidden: ${repoRelativePath}`);
  }
  const resolved = await realpath(absolutePath);
  assertAbsolutePathInsideRepository(resolved, false);
  const evidence = await stat(resolved);
  if (!evidence.isDirectory()) {
    throw new Error(`required directory missing: ${repoRelativePath}`);
  }
  return resolved;
};

export const listRegularFiles = async (absoluteRoot: string): Promise<readonly string[]> => {
  const repoRelativeRoot = toRepositoryRelative(absoluteRoot);
  const resolvedRoot = await assertExistingRepositoryDirectory(repoRelativeRoot);
  return walkRegularFiles(resolvedRoot);
};

export const assertExistingRepositoryFile = async (repoRelativePath: string): Promise<string> => {
  const absolutePath = repositoryPath(repoRelativePath);
  const linkEvidence = await lstat(absolutePath);
  if (linkEvidence.isSymbolicLink()) {
    throw new Error(`symbolic links are forbidden: ${repoRelativePath}`);
  }
  const resolved = await realpath(absolutePath);
  assertAbsolutePathInsideRepository(resolved, false);
  const evidence = await stat(resolved);
  if (!evidence.isFile() || evidence.size === 0) {
    throw new Error(`required non-empty file missing: ${repoRelativePath}`);
  }
  return resolved;
};

export const exhaustive = (value: never): never => {
  throw new Error(`unhandled closed-union member: ${JSON.stringify(value)}`);
};
