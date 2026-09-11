#!/usr/bin/env python3
"""Apply lossless, local optimizations to Sidonia's runtime theme assets."""

from __future__ import annotations

import argparse
import io
from pathlib import Path
import re
import struct
import zlib

from PIL import Image, PngImagePlugin


IMAGE_BLOCK = re.compile(r"(?m)^\+ image \{\n[^{}]*?^\}\n")
COMPONENT = re.compile(r"(?m)^\+ (\w+) \{\n[^{}]*?^\}\n")
PNG_REFERENCE = re.compile(r'"([^"\n]+\.png)"')
CANVASES = {"720p": (1280, 720), "1080p": (1920, 1080), "1440p": (2560, 1440)}
TIMER_BASE = "progress/timer_base.png"


def encode_with_original_filters(image: Image.Image, original: Image.Image) -> bytes | None:
    """Retain the source PNG's filter choices when baking into an RGB canvas."""
    if image.mode != "RGB" or original.mode != "RGB" or image.size != original.size:
        return None
    source = Path(original.filename).read_bytes()
    if source[:8] != b"\x89PNG\r\n\x1a\n" or source[24:29] != b"\x08\x02\x00\x00\x00":
        return None
    chunks = []
    offset = 8
    while offset < len(source):
        size = struct.unpack_from(">I", source, offset)[0]
        chunk = source[offset:offset + size + 12]
        chunks.append((chunk[4:8], chunk))
        offset += size + 12
    filtered = bytearray(zlib.decompress(b"".join(chunk[8:-4] for kind, chunk in chunks
                                               if kind == b"IDAT")))
    stride = image.width * 3
    if len(filtered) != (stride + 1) * image.height:
        raise ValueError("unexpected RGB PNG scanline length")
    pixels = image.tobytes()
    old_pixels = original.tobytes()
    previous = bytes(stride)
    previous_changed = False
    for row_index in range(image.height):
        start = row_index * stride
        row = pixels[start:start + stride]
        changed = row != old_pixels[start:start + stride]
        if changed or previous_changed:
            line_offset = row_index * (stride + 1)
            filter_type = filtered[line_offset]
            for index, value in enumerate(row):
                left = row[index - 3] if index >= 3 else 0
                above = previous[index]
                upper_left = previous[index - 3] if index >= 3 else 0
                if filter_type == 0:
                    prediction = 0
                elif filter_type == 1:
                    prediction = left
                elif filter_type == 2:
                    prediction = above
                elif filter_type == 3:
                    prediction = (left + above) // 2
                elif filter_type == 4:
                    estimate = left + above - upper_left
                    distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                    prediction = (left, above, upper_left)[distances.index(min(distances))]
                else:
                    raise ValueError(f"unsupported PNG row filter: {filter_type}")
                filtered[line_offset + 1 + index] = (value - prediction) & 255
        previous = row
        previous_changed = changed
    payload = zlib.compress(filtered, level=9)
    idat = struct.pack(">I", len(payload)) + b"IDAT" + payload
    idat += struct.pack(">I", zlib.crc32(b"IDAT" + payload))
    output = bytearray(source[:8])
    inserted = False
    for kind, chunk in chunks:
        if kind == b"IDAT":
            if not inserted:
                output.extend(idat)
                inserted = True
        else:
            output.extend(chunk)
    return bytes(output)


def property_value(block: str, name: str) -> str:
    match = re.search(rf"(?m)^\s*{re.escape(name)}\s*=\s*(.*?)\s*$", block)
    if match is None:
        raise ValueError(f"image component is missing {name}")
    return match[1].strip('"')


def coordinate(value: str, extent: int) -> int:
    if re.fullmatch(r"[0-9]+", value):
        return int(value)
    if re.fullmatch(r"50%[+-][0-9]+", value):
        return extent // 2 + int(value[3:])
    raise ValueError(f"unsupported image coordinate: {value}")


def encode_png(image: Image.Image, original: Image.Image) -> bytes:
    """Preserve text and color metadata while changing pixel storage."""
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    for key, value in getattr(original, "text", {}).items():
        metadata.add_text(key, value)
    if "chromaticity" in original.info:
        metadata.add(b"cHRM", struct.pack(">8I", *(round(value * 100000)
                     for value in original.info["chromaticity"])))
    if "gamma" in original.info:
        metadata.add(b"gAMA", struct.pack(">I", round(original.info["gamma"] * 100000)))
    if "srgb" in original.info:
        metadata.add(b"sRGB", bytes([original.info["srgb"]]))
    options = {key: original.info[key] for key in ("dpi", "icc_profile", "exif")
               if key in original.info}
    image.save(output, format="PNG", optimize=True, pnginfo=metadata, **options)
    encoded = output.getvalue()
    original_filters = encode_with_original_filters(image, original)
    if original_filters is not None and len(original_filters) < len(encoded):
        encoded = original_filters
    with Image.open(io.BytesIO(encoded)) as decoded:
        if decoded.mode != image.mode or decoded.size != image.size or decoded.tobytes() != image.tobytes():
            raise ValueError("PNG encoding changed image pixels")
    return encoded


def optimize_profile(directory: Path) -> tuple[dict[Path, bytes | None], int, bool]:
    theme_path = directory / "theme.txt"
    text = theme_path.read_text(encoding="utf-8")
    original_text = text
    changes: dict[Path, bytes | None] = {}
    converted = 0
    backing = False
    matches = [match for match in IMAGE_BLOCK.finditer(text)
               if property_value(match[0], "file") == TIMER_BASE]
    if len(matches) > 1:
        raise ValueError(f"{directory}: multiple timer backings")
    # Smaller profiles stretch the desktop background in custom framebuffers,
    # while their timer coordinates stay absolute. Keep that layer separate.
    if matches and directory.name == "1440p":
        match = matches[0]
        block = match[0]
        if re.search(r"(?m)^\s*id\s*=", block):
            raise ValueError(f"{directory}: timer backing is dynamic")
        # GRUB paints components in reverse declaration order. Baking cannot
        # move the backing underneath an overlapping component.
        trailing = text[match.end():]
        if re.search(r"(?m)^\+", COMPONENT.sub("", trailing)):
            raise ValueError(f"{directory}: unsupported component behind the timer backing")
        background_path = directory / "background.png"
        backing_path = directory / TIMER_BASE
        with Image.open(background_path) as background, Image.open(backing_path) as timer:
            if background.size != CANVASES[directory.name] or background.mode != "RGB":
                raise ValueError(f"{directory}: unexpected background canvas or pixel format")
            rgba = timer.convert("RGBA")
            if rgba.getchannel("A").getextrema() != (255, 255):
                raise ValueError(f"{directory}: timer backing is not fully opaque")
            width = int(property_value(block, "width"))
            height = int(property_value(block, "height"))
            if timer.size != (width, height):
                raise ValueError(f"{directory}: timer backing needs scaling")
            x = coordinate(property_value(block, "left"), background.width)
            y = coordinate(property_value(block, "top"), background.height)
            if x < 0 or y < 0 or x + width > background.width or y + height > background.height:
                raise ValueError(f"{directory}: timer backing extends outside the canvas")
            for later in COMPONENT.finditer(trailing):
                if later[1] == "image" and property_value(later[0], "file") == "background.png":
                    continue
                lx = coordinate(property_value(later[0], "left"), background.width)
                ly = coordinate(property_value(later[0], "top"), background.height)
                lw = int(property_value(later[0], "width"))
                lh = int(property_value(later[0], "height"))
                if max(x, lx) < min(x + width, lx + lw) and max(y, ly) < min(y + height, ly + lh):
                    raise ValueError(f"{directory}: baking would change overlapping layers")
            merged = background.copy()
            merged.paste(timer.convert("RGB"), (x, y))
            if merged.tobytes() != background.tobytes():
                changes[background_path] = encode_png(merged, background)
        end = match.end() + (1 if text[match.end():].startswith("\n") else 0)
        text = text[:match.start()] + text[end:]
        if TIMER_BASE in text:
            raise ValueError(f"{directory}: another reference still uses the timer backing")
        changes[backing_path] = None
        backing = True

    referenced = {path for pattern in PNG_REFERENCE.findall(text)
                  for path in directory.glob(pattern)}
    for path in sorted(referenced):
        with Image.open(path) as original:
            if original.mode != "RGBA" or original.getchannel("A").getextrema() != (255, 255):
                continue
            rgb = original.convert("RGB")
            if rgb.convert("RGBA").tobytes() != original.tobytes():
                raise ValueError(f"{path}: converting alpha changed pixels")
            changes[path] = encode_png(rgb, original)
            converted += 1
    if text != original_text:
        changes[theme_path] = text.encode("utf-8")
    return changes, converted, backing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1],
                        help="local directory containing themes/")
    parser.add_argument("--apply", action="store_true", help="write the planned local changes")
    args = parser.parse_args()
    changes: dict[Path, bytes | None] = {}
    try:
        for theme in ("T1", "T2", "T3", "T4"):
            for profile in CANVASES:
                directory = args.root / "themes" / theme / profile
                planned, converted, backing = optimize_profile(directory)
                changes.update(planned)
                print(f"{theme}/{profile}: {converted} opaque PNGs converted, "
                      f"{int(backing)} static timer backing baked")
        before = sum(path.stat().st_size for path in changes)
        after = sum(len(data) for data in changes.values() if data is not None)
        print(f"{len(changes)} files affected; stored bytes {before:,} -> {after:,}")
        if args.apply:
            # Validate every profile before writing any file. Replace each PNG
            # atomically so an interrupted write cannot leave a truncated image.
            for path, data in changes.items():
                if data is None:
                    continue
                temporary = path.with_name(path.name + ".sidonia-tmp")
                if temporary.exists():
                    raise ValueError(f"temporary file already exists: {temporary}")
                try:
                    temporary.write_bytes(data)
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
            for path, data in changes.items():
                if data is None:
                    path.unlink()
            print("Applied local asset changes.")
        else:
            print("Preview only. Use --apply to write these changes.")
    except (OSError, ValueError) as error:
        parser.exit(1, f"asset optimization failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
