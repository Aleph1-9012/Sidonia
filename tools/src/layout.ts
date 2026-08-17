import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { assertExistingRepositoryFile, repositoryPath } from "./common.js";
import { readImageEvidence } from "./source-evidence.js";
import { LayoutSchema, ProfileSchema, type Layout, type Profile, type ThemeId } from "./schemas.js";

export const PROFILES: readonly Profile[] = [
  ProfileSchema.parse({ id: "720p", width: 1280, height: 720, scale: 0.625 }),
  ProfileSchema.parse({ id: "1080p", width: 1920, height: 1080, scale: 0.9375 }),
  ProfileSchema.parse({ id: "1440p", width: 2560, height: 1440, scale: 1.25 }),
];

export const THEME_IDS = ["t1", "t2", "t3", "t4"] as const satisfies readonly ThemeId[];

export const scaleInteger = (designValue: number, profile: Profile): number =>
  Math.floor((designValue * profile.scale) + 0.5);

type Rectangle = Readonly<{ x: number; y: number; width: number; height: number }>;

const assertRectangleInside = (
  rectangle: Rectangle,
  containerWidth: number,
  containerHeight: number,
  theme: ThemeId,
  field: string,
): void => {
  const right = rectangle.x + rectangle.width;
  const bottom = rectangle.y + rectangle.height;
  if (right > containerWidth || bottom > containerHeight) {
    throw new Error(
      `${theme} design field=${field} expected=inside-${containerWidth}x${containerHeight} actual=${rectangle.x},${rectangle.y},${right},${bottom}`,
    );
  }
};

const assertCanonicalThemeAsset = (layout: Layout, path: string, field: string): void => {
  const prefix = `source-assets/${layout.theme}/pack/`;
  if (!path.startsWith(prefix) || !path.toLowerCase().endsWith(".png")) {
    throw new Error(`${layout.theme} design field=${field} expected=${prefix}*.png actual=${path}`);
  }
};

const assertCropInsideSource = async (
  layout: Layout,
  source: string,
  crop: Rectangle | undefined,
  field: string,
): Promise<void> => {
  const absoluteSource = await assertExistingRepositoryFile(source);
  const image = await readImageEvidence(absoluteSource);
  if (!image.hasAlpha) {
    throw new Error(`${layout.theme} design field=${field}.alpha expected=true actual=false`);
  }
  if (crop !== undefined) {
    assertRectangleInside(crop, image.width, image.height, layout.theme, `${field}.crop`);
  }
};

const validateProfileGeometry = (layout: Layout): void => {
  for (const profile of PROFILES) {
    const menuHeight = scaleInteger(layout.menu.height, profile);
    const itemHeight = scaleInteger(layout.menu.itemHeight, profile);
    const itemSpacing = scaleInteger(layout.menu.itemSpacing, profile);
    const occupiedHeight = (itemHeight * layout.menu.visibleItems)
      + (itemSpacing * (layout.menu.visibleItems - 1));
    if (occupiedHeight <= 0 || occupiedHeight > menuHeight) {
      throw new Error(
        `${layout.theme} ${profile.id} field=menu.itemGeometry expected=1..${menuHeight} actual=${occupiedHeight}`,
      );
    }
    const selectorWidth = scaleInteger(layout.menu.selector.width, profile);
    const selectorHeight = scaleInteger(layout.menu.selector.height, profile);
    const horizontalCaps = scaleInteger(layout.menu.selector.slices.left, profile)
      + scaleInteger(layout.menu.selector.slices.right, profile);
    const verticalCaps = scaleInteger(layout.menu.selector.slices.top, profile)
      + scaleInteger(layout.menu.selector.slices.bottom, profile);
    if (horizontalCaps >= selectorWidth || verticalCaps >= selectorHeight) {
      throw new Error(
        `${layout.theme} ${profile.id} field=selector.slices expected=positive-center actual=${horizontalCaps}x${verticalCaps}`,
      );
    }
  }
};

const validateLayout = async (layout: Layout): Promise<void> => {
  if (layout.reference !== `source-assets/${layout.theme}/reference.png`) {
    throw new Error(
      `${layout.theme} design field=reference expected=source-assets/${layout.theme}/reference.png actual=${layout.reference}`,
    );
  }
  if (layout.font.source !== "vendor/fonts/DejaVuSansMono.ttf") {
    throw new Error(`${layout.theme} design field=font.source expected=vendor/fonts/DejaVuSansMono.ttf actual=${layout.font.source}`);
  }
  assertRectangleInside(layout.menu, layout.canvas.width, layout.canvas.height, layout.theme, "menu.bounds");
  assertRectangleInside(layout.progress, layout.canvas.width, layout.canvas.height, layout.theme, "progress.bounds");
  for (const [index, rectangle] of layout.background.eraseRects.entries()) {
    assertRectangleInside(rectangle, layout.canvas.width, layout.canvas.height, layout.theme, `background.eraseRects[${index}]`);
  }
  for (const [index, overlay] of layout.background.idleOverlays.entries()) {
    assertRectangleInside(overlay, layout.canvas.width, layout.canvas.height, layout.theme, `background.idleOverlays[${index}]`);
  }
  for (const [index, rectangle] of layout.background.lineRects.entries()) {
    assertRectangleInside(rectangle, layout.canvas.width, layout.canvas.height, layout.theme, `background.lineRects[${index}]`);
  }
  const occupiedHeight = (layout.menu.itemHeight * layout.menu.visibleItems)
    + (layout.menu.itemSpacing * (layout.menu.visibleItems - 1));
  if (occupiedHeight > layout.menu.height || occupiedHeight <= 0) {
    throw new Error(`${layout.theme} design field=menu.itemGeometry expected=1..${layout.menu.height} actual=${occupiedHeight}`);
  }
  if (layout.menu.itemPadding >= layout.menu.width) {
    throw new Error(`${layout.theme} design field=menu.itemPadding expected=0..${layout.menu.width - 1} actual=${layout.menu.itemPadding}`);
  }
  if (layout.menu.selector.width !== layout.menu.width || layout.menu.selector.height !== layout.menu.itemHeight) {
    throw new Error(
      `${layout.theme} design field=selector.dimensions expected=${layout.menu.width}x${layout.menu.itemHeight} actual=${layout.menu.selector.width}x${layout.menu.selector.height}`,
    );
  }
  const horizontalCaps = layout.menu.selector.slices.left + layout.menu.selector.slices.right;
  const verticalCaps = layout.menu.selector.slices.top + layout.menu.selector.slices.bottom;
  if (horizontalCaps >= layout.menu.selector.width || verticalCaps >= layout.menu.selector.height) {
    throw new Error(`${layout.theme} design field=selector.slices expected=positive-center actual=${horizontalCaps}x${verticalCaps}`);
  }
  validateProfileGeometry(layout);
  await assertExistingRepositoryFile(layout.reference);
  await assertExistingRepositoryFile(layout.font.source);
  assertCanonicalThemeAsset(layout, layout.menu.selector.source, "menu.selector.source");
  await assertCropInsideSource(layout, layout.menu.selector.source, layout.menu.selector.crop, "menu.selector.source");
  for (const [index, decoration] of (layout.menu.selector.decorations ?? []).entries()) {
    assertCanonicalThemeAsset(layout, decoration.source, `menu.selector.decorations[${index}].source`);
    assertRectangleInside(
      decoration.target,
      layout.menu.selector.width,
      layout.menu.selector.height,
      layout.theme,
      `menu.selector.decorations[${index}].target`,
    );
    await assertCropInsideSource(
      layout,
      decoration.source,
      decoration.crop,
      `menu.selector.decorations[${index}].source`,
    );
  }
  for (const [index, overlay] of layout.background.idleOverlays.entries()) {
    assertCanonicalThemeAsset(layout, overlay.source, `background.idleOverlays[${index}].source`);
    await assertCropInsideSource(layout, overlay.source, undefined, `background.idleOverlays[${index}].source`);
  }
};

export const loadLayout = async (theme: ThemeId): Promise<Layout> => {
  const absolutePath = repositoryPath(`themes/${theme}/layout.yaml`);
  const yamlText = await readFile(absolutePath, "utf8");
  const layout = LayoutSchema.parse(parse(yamlText));
  if (layout.theme !== theme) {
    throw new Error(`${theme} file=layout.yaml field=theme expected=${theme} actual=${layout.theme}`);
  }
  await validateLayout(layout);
  return layout;
};

export const loadLayouts = async (): Promise<readonly Layout[]> => {
  const layouts: Layout[] = [];
  for (const theme of THEME_IDS) {
    layouts.push(await loadLayout(theme));
  }
  return layouts;
};
