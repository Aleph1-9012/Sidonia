import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { z } from "zod";
import { repositoryPath } from "./common.js";
import { scaleInteger } from "./layout.js";
import type { Layout, Profile } from "./schemas.js";

const png = (pipeline: sharp.Sharp): sharp.Sharp => pipeline
  .toColourspace("srgb")
  .png({
    compressionLevel: 9,
    progressive: false,
    palette: false,
    adaptiveFiltering: false,
    force: true,
  });

const ColorSchema = z.string().regex(/^#[0-9A-F]{6}$/u);

const rgba = (color: string, alpha: number) => {
  const parsed = ColorSchema.parse(color);
  return {
    r: Number.parseInt(parsed.slice(1, 3), 16),
    g: Number.parseInt(parsed.slice(3, 5), 16),
    b: Number.parseInt(parsed.slice(5, 7), 16),
    alpha,
  };
};

const solid = async (width: number, height: number, color: string, alpha = 1): Promise<Buffer> =>
  png(sharp({
    create: {
      width,
      height,
      channels: 4,
      background: rgba(color, alpha),
    },
  })).toBuffer();

const transparent = async (width: number, height: number): Promise<Buffer> =>
  solid(width, height, "#000000", 0);

const scaledOverlay = async (
  source: string,
  crop: Readonly<{ x: number; y: number; width: number; height: number }> | undefined,
  profile: Profile,
  width: number,
  height: number,
  x: number,
  y: number,
): Promise<OverlayOptions> => {
  let pipeline = sharp(repositoryPath(source), { failOn: "error" });
  if (crop !== undefined) {
    pipeline = pipeline.extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    });
  }
  return {
    input: await png(pipeline
      .resize(scaleInteger(width, profile), scaleInteger(height, profile), { fit: "fill", kernel: "lanczos3" }))
      .toBuffer(),
    left: scaleInteger(x, profile),
    top: scaleInteger(y, profile),
    blend: "over",
  };
};

export const renderBackground = async (
  layout: Layout,
  profile: Profile,
  outputPath: string,
  referencePreviewPath: string,
): Promise<void> => {
  const reference = repositoryPath(layout.reference);
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(referencePreviewPath), { recursive: true });
  await png(sharp(reference, { failOn: "error" })
    .resize(profile.width, profile.height, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha())
    .toFile(referencePreviewPath);

  const composites: OverlayOptions[] = [];
  for (const rect of layout.background.eraseRects) {
    const width = scaleInteger(rect.width, profile);
    const height = scaleInteger(rect.height, profile);
    composites.push({
      input: await solid(width, height, rect.color),
      left: scaleInteger(rect.x, profile),
      top: scaleInteger(rect.y, profile),
      blend: "over",
    });
  }
  for (const overlay of layout.background.idleOverlays) {
    composites.push(await scaledOverlay(
      overlay.source,
      overlay.crop,
      profile,
      overlay.width,
      overlay.height,
      overlay.x,
      overlay.y,
    ));
  }
  for (const rect of layout.background.lineRects) {
    composites.push({
      input: await solid(scaleInteger(rect.width, profile), scaleInteger(rect.height, profile), rect.color),
      left: scaleInteger(rect.x, profile),
      top: scaleInteger(rect.y, profile),
      blend: "over",
    });
  }

  await png(sharp(reference, { failOn: "error" })
    .resize(profile.width, profile.height, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .composite(composites))
    .toFile(outputPath);
};

const renderDecoration = async (
  source: string,
  crop: Readonly<{ x: number; y: number; width: number; height: number }> | undefined,
  width: number,
  height: number,
): Promise<Buffer> => {
  let pipeline = sharp(repositoryPath(source), { failOn: "error" });
  if (crop !== undefined) {
    pipeline = pipeline.extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    });
  }
  return png(pipeline.resize(width, height, { fit: "fill", kernel: "lanczos3" })).toBuffer();
};

const sliceSelector = async (
  selectorBuffer: Buffer,
  outputRoot: string,
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Promise<void> => {
  const centerWidth = width - left - right;
  const centerHeight = height - top - bottom;
  if (centerWidth <= 0 || centerHeight <= 0) {
    throw new Error(`selector field=slices expected=positive-center actual=${centerWidth}x${centerHeight}`);
  }
  const segments = [
    { id: "nw", x: 0, y: 0, width: left, height: top },
    { id: "n", x: left, y: 0, width: centerWidth, height: top },
    { id: "ne", x: left + centerWidth, y: 0, width: right, height: top },
    { id: "w", x: 0, y: top, width: left, height: centerHeight },
    { id: "c", x: left, y: top, width: centerWidth, height: centerHeight },
    { id: "e", x: left + centerWidth, y: top, width: right, height: centerHeight },
    { id: "sw", x: 0, y: top + centerHeight, width: left, height: bottom },
    { id: "s", x: left, y: top + centerHeight, width: centerWidth, height: bottom },
    { id: "se", x: left + centerWidth, y: top + centerHeight, width: right, height: bottom },
  ] as const;
  await mkdir(outputRoot, { recursive: true });
  for (const segment of segments) {
    await png(sharp(selectorBuffer).extract({
      left: segment.x,
      top: segment.y,
      width: segment.width,
      height: segment.height,
    })).toFile(join(outputRoot, `selected_${segment.id}.png`));
  }
};

export const renderSelector = async (
  layout: Layout,
  profile: Profile,
  packageRoot: string,
  constructionRoot: string,
): Promise<void> => {
  const selector = layout.menu.selector;
  const width = scaleInteger(selector.width, profile);
  const height = scaleInteger(selector.height, profile);
  let pipeline = sharp(repositoryPath(selector.source), { failOn: "error" });
  if (selector.crop !== undefined) {
    pipeline = pipeline.extract({
      left: selector.crop.x,
      top: selector.crop.y,
      width: selector.crop.width,
      height: selector.crop.height,
    });
  }
  const base = await png(pipeline.resize(width, height, { fit: "fill", kernel: "lanczos3" })).toBuffer();
  const decorations: OverlayOptions[] = [];
  for (const decoration of selector.decorations ?? []) {
    const targetWidth = scaleInteger(decoration.target.width, profile);
    const targetHeight = scaleInteger(decoration.target.height, profile);
    decorations.push({
      input: await renderDecoration(decoration.source, decoration.crop, targetWidth, targetHeight),
      left: scaleInteger(decoration.target.x, profile),
      top: scaleInteger(decoration.target.y, profile),
      blend: "over",
    });
  }
  const selected = decorations.length === 0
    ? base
    : await png(sharp(base).composite(decorations)).toBuffer();
  await mkdir(constructionRoot, { recursive: true });
  await writeFile(join(constructionRoot, "selected-full.png"), selected);
  await sliceSelector(
    selected,
    join(packageRoot, "selectors"),
    width,
    height,
    scaleInteger(selector.slices.left, profile),
    scaleInteger(selector.slices.top, profile),
    scaleInteger(selector.slices.right, profile),
    scaleInteger(selector.slices.bottom, profile),
  );
};

export const renderUtilityStyles = async (
  layout: Layout,
  profile: Profile,
  packageRoot: string,
): Promise<void> => {
  const progressRoot = join(packageRoot, "progress");
  const selectorRoot = join(packageRoot, "selectors");
  await mkdir(progressRoot, { recursive: true });
  await mkdir(selectorRoot, { recursive: true });
  const progressHeight = Math.max(1, scaleInteger(layout.progress.height, profile));
  await writeFile(join(progressRoot, "frame_c.png"), await solid(1, progressHeight, layout.progress.background));
  await writeFile(join(progressRoot, "highlight_c.png"), await solid(1, progressHeight, layout.progress.foreground));
  await writeFile(join(selectorRoot, "menu_c.png"), await transparent(1, 1));
  await writeFile(join(selectorRoot, "menu_e.png"), await transparent(Math.max(1, scaleInteger(7, profile)), 1));
  await writeFile(join(selectorRoot, "scrollbar_c.png"), await solid(Math.max(1, scaleInteger(2, profile)), 1, layout.palette.idleText, 0.45));
  await writeFile(join(selectorRoot, "thumb_c.png"), await solid(Math.max(1, scaleInteger(3, profile)), 1, layout.palette.signal));
};

export const renderConstructedPreview = async (
  layout: Layout,
  profile: Profile,
  backgroundPath: string,
  selectedPath: string,
  outputPath: string,
): Promise<void> => {
  const selectorLeft = scaleInteger(layout.menu.x, profile);
  const selectorTop = scaleInteger(
    layout.menu.y + (layout.preview.selectedIndex * (layout.menu.itemHeight + layout.menu.itemSpacing)),
    profile,
  );
  const itemHeight = scaleInteger(layout.menu.itemHeight, profile);
  const itemPitch = scaleInteger(layout.menu.itemHeight + layout.menu.itemSpacing, profile);
  const itemLeft = scaleInteger(layout.menu.x + layout.menu.itemPadding, profile);
  const menuRight = scaleInteger(layout.menu.x + layout.menu.width, profile);
  const fontSize = scaleInteger(layout.font.designSize, profile);
  const composites: OverlayOptions[] = [{ input: selectedPath, left: selectorLeft, top: selectorTop }];
  for (const [index, entry] of layout.preview.entries.entries()) {
    const color = index === layout.preview.selectedIndex
      ? layout.palette.selectedText
      : layout.palette.idleText;
    const text = await png(sharp({
      text: {
        text: `<span foreground="${color}">${entry.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</span>`,
        font: `DejaVu Sans Mono ${fontSize}`,
        fontfile: repositoryPath(layout.font.source),
        width: Math.max(1, menuRight - itemLeft),
        align: "left",
        rgba: true,
        wrap: "none",
      },
    })).toBuffer();
    const metadata = await sharp(text).metadata();
    if (metadata.height === undefined) {
      throw new Error(`${layout.theme} ${profile.id} preview field=text-height expected=known actual=missing`);
    }
    const rowTop = scaleInteger(layout.menu.y, profile) + (index * itemPitch);
    composites.push({
      input: text,
      left: itemLeft,
      top: rowTop + Math.max(0, Math.floor((itemHeight - metadata.height) / 2)),
      blend: "over",
    });
  }
  const progressLeft = scaleInteger(layout.progress.x, profile);
  const progressTop = scaleInteger(layout.progress.y, profile);
  const progressWidth = scaleInteger(layout.progress.width, profile);
  const progressHeight = Math.max(1, scaleInteger(layout.progress.height, profile));
  composites.push({
    input: await solid(progressWidth, progressHeight, layout.progress.background),
    left: progressLeft,
    top: progressTop,
    blend: "over",
  });
  const highlightWidth = Math.floor(progressWidth * (layout.preview.timeoutFraction ?? 0.6));
  if (highlightWidth > 0) {
    composites.push({
      input: await solid(highlightWidth, progressHeight, layout.progress.foreground),
      left: progressLeft,
      top: progressTop,
      blend: "over",
    });
  }
  await png(sharp(backgroundPath, { failOn: "error" }).composite(composites))
    .toFile(outputPath);
};

export const runtimePngName = (absolutePath: string): string => basename(absolutePath);
