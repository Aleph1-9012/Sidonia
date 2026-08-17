import { execFile } from "node:child_process";
import { dirname, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { assertExistingRepositoryDirectory, toRepositoryRelative } from "./common.js";
import { AbsolutePathSchema, type Toolchain } from "./schemas.js";
import { commandPath, toolFailure } from "./toolchain.js";

const execFileAsync = promisify(execFile);
const OutputSchema = z.object({ stdout: z.string(), stderr: z.string() }).strict();
const CommandTextSchema = z.string().min(1).max(256)
  .refine((value) => [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
  }), "argument must not contain control characters");

export const CommandRequestSchema = z.discriminatedUnion("executable", [
  z.object({
    executable: z.literal("grubMkfont"),
    args: z.tuple([
      z.literal("-n"),
      CommandTextSchema,
      z.literal("-s"),
      z.string().regex(/^[1-9][0-9]{0,2}$/u),
      z.literal("-o"),
      AbsolutePathSchema,
      AbsolutePathSchema,
    ]),
    cwd: AbsolutePathSchema,
    timeoutMs: z.number().int().positive().max(120_000),
  }).strict(),
  z.object({
    executable: z.literal("grubScriptCheck"),
    args: z.tuple([AbsolutePathSchema]),
    cwd: AbsolutePathSchema,
    timeoutMs: z.number().int().positive().max(120_000),
  }).strict(),
]);

export type CommandRequest = z.infer<typeof CommandRequestSchema>;

export type CommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

const validateCommandPaths = async (request: CommandRequest): Promise<void> => {
  const cwdRelative = toRepositoryRelative(request.cwd);
  const resolvedCwd = await assertExistingRepositoryDirectory(cwdRelative);
  if (request.executable === "grubScriptCheck") {
    const scriptRelative = toRepositoryRelative(request.args[0]);
    if (!scriptRelative.startsWith("fixtures/") || !scriptRelative.endsWith(".cfg")) {
      throw new Error(`subprocess executable=${request.executable} field=input expected=fixtures/*.cfg actual=${scriptRelative}`);
    }
    if (resolvedCwd !== dirname(request.args[0])) {
      throw new Error(`subprocess executable=${request.executable} field=cwd expected=${dirname(request.args[0])} actual=${resolvedCwd}`);
    }
    return;
  }
  const outputPath = request.args[5];
  const fontPath = request.args[6];
  const outputRelative = toRepositoryRelative(outputPath);
  const fontRelative = toRepositoryRelative(fontPath);
  const permittedOutputRoot = outputRelative.startsWith(".sidonia-build-")
    || outputRelative.startsWith("build/")
    || outputRelative.startsWith("dist/");
  if (!permittedOutputRoot || !outputRelative.includes("/fonts/") || !outputRelative.endsWith(".pf2")) {
    throw new Error(`subprocess executable=${request.executable} field=output expected=temporary-build-font-pf2 actual=${outputRelative}`);
  }
  if (!outputPath.startsWith(`${resolvedCwd}${sep}`)) {
    throw new Error(`subprocess executable=${request.executable} field=output expected=below-cwd actual=${outputRelative}`);
  }
  if (fontRelative !== "vendor/fonts/DejaVuSansMono.ttf") {
    throw new Error(`subprocess executable=${request.executable} field=font expected=vendor/fonts/DejaVuSansMono.ttf actual=${fontRelative}`);
  }
  const size = Number(request.args[3]);
  if (size < 1 || size > 512) {
    throw new Error(`subprocess executable=${request.executable} field=font-size expected=1..512 actual=${request.args[3]}`);
  }
};

export const runCommand = async (toolchain: Toolchain, command: CommandRequest): Promise<CommandResult> => {
  const request = CommandRequestSchema.parse(command);
  await validateCommandPaths(request);
  const executablePath = commandPath(toolchain, request.executable);
  try {
    const output = await execFileAsync(executablePath, [...request.args], {
      cwd: request.cwd,
      env: {
        HOME: "/nonexistent/sidonia-build-home",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin",
        TZ: "UTC",
      },
      timeout: request.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      shell: false,
      encoding: "utf8",
    });
    return OutputSchema.parse(output);
  } catch (cause: unknown) {
    throw toolFailure(request.executable, cause);
  }
};
