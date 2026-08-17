import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { fontDisplayName } from "./theme.js";
import { scaleInteger } from "./layout.js";
import type { Layout, Profile, Toolchain } from "./schemas.js";
import { runCommand } from "./subprocess.js";
import { repositoryPath } from "./common.js";

const ThemeTextSchema = z.string().min(1);
const QuotedPngSchema = z.string().regex(/^[a-z0-9/_*-]+\.png$/u);

type ThemeComponentKind = "boot_menu" | "progress_bar";

type ThemeComponent = Readonly<{
  kind: ThemeComponentKind;
  properties: ReadonlyMap<string, string>;
}>;

type ThemeDocument = Readonly<{
  rootProperties: ReadonlyMap<string, string>;
  components: readonly ThemeComponent[];
}>;

const captured = (match: RegExpExecArray, index: number, lineNumber: number): string => {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`theme.txt line=${lineNumber} field=capture expected=present actual=missing`);
  }
  return value;
};

const addProperty = (
  properties: Map<string, string>,
  key: string,
  value: string,
  lineNumber: number,
): void => {
  if (properties.has(key)) {
    throw new Error(`theme.txt line=${lineNumber} field=property expected=unique actual=${key}`);
  }
  properties.set(key, value);
};

const parseThemeDocument = (text: string): ThemeDocument => {
  const rootProperties = new Map<string, string>();
  const components: ThemeComponent[] = [];
  let active: { kind: ThemeComponentKind; properties: Map<string, string> } | undefined;
  const lines = text.split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (active === undefined) {
      const componentMatch = /^\+ (boot_menu|progress_bar) \{$/u.exec(line);
      if (componentMatch !== null) {
        const kind = z.enum(["boot_menu", "progress_bar"]).parse(captured(componentMatch, 1, lineNumber));
        active = { kind, properties: new Map<string, string>() };
        continue;
      }
      if (components.length !== 0) {
        throw new Error(`theme.txt line=${lineNumber} field=structure expected=component actual=${JSON.stringify(line)}`);
      }
      const rootMatch = /^([a-z][a-z-]*): (.+)$/u.exec(line);
      if (rootMatch === null) {
        throw new Error(`theme.txt line=${lineNumber} field=root-syntax expected=key-colon-value actual=${JSON.stringify(line)}`);
      }
      addProperty(
        rootProperties,
        captured(rootMatch, 1, lineNumber),
        captured(rootMatch, 2, lineNumber),
        lineNumber,
      );
      continue;
    }
    if (line === "}") {
      components.push({ kind: active.kind, properties: active.properties });
      active = undefined;
      continue;
    }
    const propertyMatch = /^ {2}([a-z][a-z_]*) = (.+)$/u.exec(line);
    if (propertyMatch === null) {
      throw new Error(`theme.txt line=${lineNumber} field=component-syntax expected=indented-key-equals-value actual=${JSON.stringify(line)}`);
    }
    addProperty(
      active.properties,
      captured(propertyMatch, 1, lineNumber),
      captured(propertyMatch, 2, lineNumber),
      lineNumber,
    );
  }
  if (active !== undefined) {
    throw new Error(`theme.txt field=structure expected=closing-brace actual=unterminated-${active.kind}`);
  }
  return { rootProperties, components };
};

const assertProperties = (
  theme: Layout["theme"],
  profile: Profile,
  component: string,
  actual: ReadonlyMap<string, string>,
  expected: ReadonlyMap<string, string>,
): void => {
  if (actual.size !== expected.size) {
    throw new Error(`${theme} ${profile.id} file=theme.txt field=${component}.property-count expected=${expected.size} actual=${actual.size}`);
  }
  for (const [key, expectedValue] of expected) {
    const actualValue = actual.get(key);
    if (actualValue !== expectedValue) {
      throw new Error(`${theme} ${profile.id} file=theme.txt field=${component}.${key} expected=${JSON.stringify(expectedValue)} actual=${JSON.stringify(actualValue)}`);
    }
  }
};

const referencedPngPatterns = (text: string): readonly string[] => {
  const patterns: string[] = [];
  const matches = text.matchAll(/"([^"\n]+\.png)"/gu);
  for (const match of matches) {
    const value = match[1];
    if (value === undefined) {
      throw new Error("theme field=png-reference expected=capture actual=missing");
    }
    patterns.push(QuotedPngSchema.parse(value));
  }
  return patterns;
};

const verifyPngPattern = async (packageRoot: string, pattern: string): Promise<void> => {
  if (pattern.startsWith("/") || pattern.split("/").includes("..")) {
    throw new Error(`theme field=png-reference expected=package-relative actual=${pattern}`);
  }
  const absolutePattern = resolve(packageRoot, pattern);
  const prefix = `${packageRoot}${sep}`;
  if (!absolutePattern.startsWith(prefix)) {
    throw new Error(`theme field=png-reference expected=inside-package actual=${pattern}`);
  }
  const directory = dirname(absolutePattern);
  const filename = pattern.split("/").at(-1);
  if (filename === undefined) {
    throw new Error(`theme field=png-reference expected=filename actual=${pattern}`);
  }
  const pieces = filename.split("*");
  if (pieces.length > 2) {
    throw new Error(`theme field=png-reference expected=at-most-one-wildcard actual=${pattern}`);
  }
  const before = pieces[0] ?? "";
  const after = pieces[1] ?? "";
  const entries = await readdir(directory, { withFileTypes: true });
  const matching = entries.filter((entry) => entry.isFile() && entry.name.startsWith(before) && entry.name.endsWith(after));
  if (matching.length === 0) {
    throw new Error(`theme field=png-reference expected=matching-file actual=${pattern}`);
  }
};

export const lintTheme = async (
  layout: Layout,
  profile: Profile,
  packageRoot: string,
): Promise<void> => {
  const themePath = join(packageRoot, "theme.txt");
  const text = ThemeTextSchema.parse(await readFile(themePath, "utf8"));
  if (text.includes("%")) {
    throw new Error(`${layout.theme} ${profile.id} file=theme.txt field=geometry expected=absolute-integers actual=percentage`);
  }
  const document = parseThemeDocument(text);
  assertProperties(layout.theme, profile, "root", document.rootProperties, new Map([
    ["title-text", "\"\""],
    ["desktop-color", `"${layout.palette.background}"`],
    ["desktop-image", "\"background.png\""],
    ["desktop-image-scale-method", "\"normal\""],
    ["terminal-box", "\"0\""],
  ]));
  const bootMenu = document.components[0];
  const progressBar = document.components[1];
  if (document.components.length !== 2 || bootMenu?.kind !== "boot_menu" || progressBar?.kind !== "progress_bar") {
    throw new Error(`${layout.theme} ${profile.id} file=theme.txt field=components expected=boot_menu,progress_bar actual=${document.components.map((component) => component.kind).join(",")}`);
  }
  assertProperties(layout.theme, profile, "boot_menu", bootMenu.properties, new Map([
    ["id", "\"__menu__\""],
    ["left", String(scaleInteger(layout.menu.x, profile))],
    ["top", String(scaleInteger(layout.menu.y, profile))],
    ["width", String(scaleInteger(layout.menu.width, profile))],
    ["height", String(scaleInteger(layout.menu.height, profile))],
    ["item_font", `"${fontDisplayName(layout, profile)}"`],
    ["selected_item_font", `"${fontDisplayName(layout, profile)}"`],
    ["item_color", `"${layout.palette.idleText}"`],
    ["selected_item_color", `"${layout.palette.selectedText}"`],
    ["item_height", String(scaleInteger(layout.menu.itemHeight, profile))],
    ["item_padding", String(scaleInteger(layout.menu.itemPadding, profile))],
    ["item_spacing", String(scaleInteger(layout.menu.itemSpacing, profile))],
    ["icon_width", "0"],
    ["icon_height", "0"],
    ["item_icon_space", "0"],
    ["menu_pixmap_style", "\"selectors/menu_*.png\""],
    ["selected_item_pixmap_style", "\"selectors/selected_*.png\""],
    ["scrollbar", "true"],
    ["scrollbar_width", String(scaleInteger(7, profile))],
    ["scrollbar_frame", "\"selectors/scrollbar_*.png\""],
    ["scrollbar_thumb", "\"selectors/thumb_*.png\""],
    ["scrollbar_thumb_overlay", "true"],
    ["scrollbar_slice", "east"],
    ["scrollbar_left_pad", "0"],
    ["scrollbar_right_pad", "0"],
    ["scrollbar_top_pad", "0"],
    ["scrollbar_bottom_pad", "0"],
  ]));
  assertProperties(layout.theme, profile, "progress_bar", progressBar.properties, new Map([
    ["id", "\"__timeout__\""],
    ["left", String(scaleInteger(layout.progress.x, profile))],
    ["top", String(scaleInteger(layout.progress.y, profile))],
    ["width", String(scaleInteger(layout.progress.width, profile))],
    ["height", String(scaleInteger(layout.progress.height, profile))],
    ["bar_style", "\"progress/frame_*.png\""],
    ["highlight_style", "\"progress/highlight_*.png\""],
    ["highlight_overlay", "true"],
    ["fg_color", `"${layout.progress.foreground}"`],
    ["bg_color", `"${layout.progress.background}"`],
    ["text", "\"\""],
  ]));
  for (const pattern of referencedPngPatterns(text)) {
    await verifyPngPattern(packageRoot, pattern);
  }
};

export const lintFixture = async (toolchain: Toolchain): Promise<void> => {
  await runCommand(toolchain, {
    executable: "grubScriptCheck",
    args: [repositoryPath("fixtures/grub.cfg")],
    cwd: repositoryPath("fixtures"),
    timeoutMs: 20_000,
  });
  await runCommand(toolchain, {
    executable: "grubScriptCheck",
    args: [repositoryPath("fixtures/entries/t3-grub.cfg")],
    cwd: repositoryPath("fixtures/entries"),
    timeoutMs: 20_000,
  });
};

export const safetyScan = async (): Promise<void> => {
  const sourceRoot = repositoryPath("tools/src");
  const files = (await import("./common.js")).listRegularFiles(sourceRoot);
  const forbidden = [
    ["grub", "install"].join("-"),
    ["update", "grub"].join("-"),
    ["grub", "mkconfig"].join("-"),
    ["/", "boot"].join(""),
    ["/etc", "/default/grub"].join(""),
    ["/etc", "/grub.d"].join(""),
  ];
  for (const file of await files) {
    const text = await readFile(file, "utf8");
    for (const token of forbidden) {
      if (text.includes(token)) {
        throw new Error(`safety file=${file} field=forbidden-token expected=absent actual=${token}`);
      }
    }
  }
};
