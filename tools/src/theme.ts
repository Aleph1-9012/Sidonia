import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryPath } from "./common.js";
import { scaleInteger } from "./layout.js";
import type { Layout, Profile } from "./schemas.js";

export const fontFamilyName = (layout: Layout, profile: Profile): string =>
  `${layout.font.family} ${profile.id}`;

export const fontDisplayName = (layout: Layout, profile: Profile): string =>
  `${fontFamilyName(layout, profile)} Regular ${scaleInteger(layout.font.designSize, profile)}`;

const generatedTheme = (layout: Layout, profile: Profile): string => {
  const menu = {
    x: scaleInteger(layout.menu.x, profile),
    y: scaleInteger(layout.menu.y, profile),
    width: scaleInteger(layout.menu.width, profile),
    height: scaleInteger(layout.menu.height, profile),
    itemHeight: scaleInteger(layout.menu.itemHeight, profile),
    itemSpacing: scaleInteger(layout.menu.itemSpacing, profile),
    itemPadding: scaleInteger(layout.menu.itemPadding, profile),
  };
  const progress = {
    x: scaleInteger(layout.progress.x, profile),
    y: scaleInteger(layout.progress.y, profile),
    width: scaleInteger(layout.progress.width, profile),
    height: scaleInteger(layout.progress.height, profile),
  };
  return [
    `# Sidonia ${layout.theme.toUpperCase()} ${profile.id}; exact framebuffer ${profile.width}x${profile.height}`,
    "title-text: \"\"",
    `desktop-color: "${layout.palette.background}"`,
    "desktop-image: \"background.png\"",
    "desktop-image-scale-method: \"normal\"",
    "terminal-box: \"0\"",
    "",
    "+ boot_menu {",
    "  id = \"__menu__\"",
    `  left = ${menu.x}`,
    `  top = ${menu.y}`,
    `  width = ${menu.width}`,
    `  height = ${menu.height}`,
    `  item_font = "${fontDisplayName(layout, profile)}"`,
    `  selected_item_font = "${fontDisplayName(layout, profile)}"`,
    `  item_color = "${layout.palette.idleText}"`,
    `  selected_item_color = "${layout.palette.selectedText}"`,
    `  item_height = ${menu.itemHeight}`,
    `  item_padding = ${menu.itemPadding}`,
    `  item_spacing = ${menu.itemSpacing}`,
    "  icon_width = 0",
    "  icon_height = 0",
    "  item_icon_space = 0",
    "  menu_pixmap_style = \"selectors/menu_*.png\"",
    "  selected_item_pixmap_style = \"selectors/selected_*.png\"",
    "  scrollbar = true",
    `  scrollbar_width = ${scaleInteger(7, profile)}`,
    "  scrollbar_frame = \"selectors/scrollbar_*.png\"",
    "  scrollbar_thumb = \"selectors/thumb_*.png\"",
    "  scrollbar_thumb_overlay = true",
    "  scrollbar_slice = east",
    "  scrollbar_left_pad = 0",
    "  scrollbar_right_pad = 0",
    "  scrollbar_top_pad = 0",
    "  scrollbar_bottom_pad = 0",
    "}",
    "",
    "+ progress_bar {",
    "  id = \"__timeout__\"",
    `  left = ${progress.x}`,
    `  top = ${progress.y}`,
    `  width = ${progress.width}`,
    `  height = ${progress.height}`,
    "  bar_style = \"progress/frame_*.png\"",
    "  highlight_style = \"progress/highlight_*.png\"",
    "  highlight_overlay = true",
    `  fg_color = "${layout.progress.foreground}"`,
    `  bg_color = "${layout.progress.background}"`,
    "  text = \"\"",
    "}",
    "",
  ].join("\n");
};

export const writeTheme = async (
  layout: Layout,
  profile: Profile,
  packageRoot: string,
): Promise<void> => {
  const template = await readFile(repositoryPath(`themes/${layout.theme}/theme.template.txt`), "utf8");
  const marker = "{{GENERATED_THEME}}";
  if (template.split(marker).length !== 2) {
    throw new Error(`${layout.theme} file=theme.template.txt field=marker expected=exactly-one actual=invalid`);
  }
  const content = template.replace(marker, generatedTheme(layout, profile));
  await writeFile(join(packageRoot, "theme.txt"), content, "utf8");
};

export const compiledLayoutReport = (layout: Layout, profile: Profile): string => `${JSON.stringify({
  schemaVersion: 1,
  theme: layout.theme,
  profile,
  rounding: "round-half-up-after-scaling-from-2048x1152",
  menu: {
    x: scaleInteger(layout.menu.x, profile),
    y: scaleInteger(layout.menu.y, profile),
    width: scaleInteger(layout.menu.width, profile),
    height: scaleInteger(layout.menu.height, profile),
    itemHeight: scaleInteger(layout.menu.itemHeight, profile),
    itemSpacing: scaleInteger(layout.menu.itemSpacing, profile),
    itemPadding: scaleInteger(layout.menu.itemPadding, profile),
  },
  progress: {
    x: scaleInteger(layout.progress.x, profile),
    y: scaleInteger(layout.progress.y, profile),
    width: scaleInteger(layout.progress.width, profile),
    height: scaleInteger(layout.progress.height, profile),
  },
  font: {
    family: fontFamilyName(layout, profile),
    displayName: fontDisplayName(layout, profile),
    pixelSize: scaleInteger(layout.font.designSize, profile),
  },
}, null, 2)}\n`;
