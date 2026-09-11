#!/usr/bin/env python3
"""Compare Sidonia's optimized assets with an untouched checkout.

Requires Pillow. The baseline and candidate directories must contain themes/.
This checks source pixels and theme geometry, not GRUB's rendering or boot time.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops


CANVASES = {"720p": (1280, 720), "1080p": (1920, 1080), "1440p": (2560, 1440)}
PROFILES = {Path(theme) / resolution for theme in ("T1", "T2", "T3", "T4") for resolution in CANVASES}
COMPONENT = re.compile(r"^\+ (\w+) \{\n[^{}]*?^\}\n?", re.MULTILINE)
PROPERTY = re.compile(r'^\s*(\w+)\s*=\s*(.*?)\s*$', re.MULTILINE)
PNG_REFERENCE = re.compile(r'"([^"\n]+\.png)"')


class VerificationError(Exception):
    """An unexpected difference between the two asset trees."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def properties(block: str) -> dict[str, str]:
    return {key: value.strip('"') for key, value in PROPERTY.findall(block)}


def coordinate(value: str, length: int) -> int:
    match = re.fullmatch(r"(-?\d+)%([+-]\d+)?", value)
    if match:
        return int(match[1]) * length // 100 + int(match[2] or 0)
    require(re.fullmatch(r"-?\d+", value) is not None, f"Unsupported coordinate: {value}")
    return int(value)


def rectangle(props: dict[str, str], screen: tuple[int, int]) -> tuple[int, int, int, int]:
    x = coordinate(props["left"], screen[0])
    y = coordinate(props["top"], screen[1])
    width = coordinate(props["width"], screen[0])
    height = coordinate(props["height"], screen[1])
    return x, y, x + width, y + height


def overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return max(a[0], b[0]) < min(a[2], b[2]) and max(a[1], b[1]) < min(a[3], b[3])


def pixels_equal(a: Image.Image, b: Image.Image) -> bool:
    # Check every band: RGBA getbbox() can otherwise miss RGB changes at zero alpha.
    if a.size != b.size:
        return False
    difference = ImageChops.difference(a.convert("RGBA"), b.convert("RGBA"))
    return all(band.getbbox() is None for band in difference.split())


def referenced_pngs(profile: Path, text: str) -> set[Path]:
    referenced = set()
    for pattern in PNG_REFERENCE.findall(text):
        require(not Path(pattern).is_absolute() and ".." not in Path(pattern).parts,
                f"Unexpected image path in {profile}: {pattern}")
        matches = list(profile.glob(pattern))
        require(bool(matches), f"Missing image reference in {profile}: {pattern}")
        referenced.update(matches)
    return referenced


def image_totals(paths: set[Path]) -> tuple[int, int]:
    file_bytes = sum(path.stat().st_size for path in paths)
    decoded_bytes = 0
    for path in paths:
        with Image.open(path) as image:
            # GRUB expands palettes to color pixels. These assets use 8-bit channels.
            alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
            decoded_bytes += image.width * image.height * (4 if alpha else 3)
    return file_bytes, decoded_bytes


@dataclass
class Counts:
    baked: int = 0
    converted: int = 0
    deleted: int = 0
    identical: int = 0


def verify_profile(baseline: Path, candidate: Path, profile: Path, counts: Counts) -> tuple[set[Path], set[Path]]:
    old_dir = baseline / profile
    new_dir = candidate / profile
    before = (old_dir / "theme.txt").read_text()
    after = (new_dir / "theme.txt").read_text()
    canvas = CANVASES[profile.name]
    blocks = list(COMPONENT.finditer(before))
    original_bases = [block for block in blocks if block[1] == "image" and
                      properties(block[0]).get("file") == "progress/timer_base.png"]
    require(len(original_bases) == (0 if profile.parts[0] == "T1" else 1),
            f"{profile}: unexpected number of original timer backings")
    # Only fixed 1440p canvases can absorb the backing without changing its
    # placement when the actual framebuffer differs from the profile size.
    bases = original_bases if profile.name == "1440p" else []

    expected_text = before
    for block in reversed(bases):
        end = block.end()
        if before[end:end + 1] == "\n":
            end += 1
        expected_text = expected_text[:block.start()] + expected_text[end:]
    require(after == expected_text, f"{profile}: theme changed beyond removing the timer backing block")
    if bases:
        require("timer_base.png" not in after, f"{profile}: timer backing remains referenced")

    background_blocks = [block for block in blocks if block[1] == "image" and
                         properties(block[0]).get("file") == "background.png"]
    if profile.name == "1440p":
        require(len(background_blocks) == 1, f"{profile}: expected one fixed background image")
        background_props = properties(background_blocks[0][0])
        require(rectangle(background_props, canvas) == (0, 0, *canvas),
                f"{profile}: background is not the expected native canvas")
    else:
        require(not background_blocks and 'desktop-image: "background.png"' in before,
                f"{profile}: unexpected background setup")
        background_props = {"left": "0", "top": "0", "width": str(canvas[0]), "height": str(canvas[1])}

    with Image.open(old_dir / "background.png") as original:
        require(original.size == canvas, f"{profile}: original background has unexpected dimensions")
        expected_background = original.convert("RGBA")

    removable = set()
    for base in bases:
        props = properties(base[0])
        rect = rectangle(props, canvas)
        x, y, right, bottom = rect
        require(0 <= x < right <= canvas[0] and 0 <= y < bottom <= canvas[1],
                f"{profile}: timer backing extends beyond background")
        backing_path = old_dir / props["file"]
        with Image.open(backing_path) as backing:
            require(backing.size == (right - x, bottom - y), f"{profile}: timer backing would be scaled")
            rgba = backing.convert("RGBA")
            require(rgba.getchannel("A").getextrema() == (255, 255),
                    f"{profile}: timer backing is not fully opaque")
            expected_background.alpha_composite(rgba, (x, y))
        removable.add(Path(props["file"]))

        screens = [canvas]
        if profile.name == "1440p":
            screens += [(2560, 1600), (3440, 1440), (3840, 2160)]
        for screen in screens:
            bg_rect = rectangle(background_props, screen)
            base_rect = rectangle(props, screen)
            require((base_rect[0] - bg_rect[0], base_rect[1] - bg_rect[1]) == (x, y),
                    f"{profile}: timer does not preserve its canvas offset at {screen}")
            # GRUB draws later declarations first. Baking must not move the
            # backing behind another overlapping component it previously covered.
            for other in blocks:
                if other.start() <= base.start() or other in background_blocks:
                    continue
                require(not overlap(base_rect, rectangle(properties(other[0]), screen)),
                        f"{profile}: baking changes component overlap at {screen}")
        counts.baked += 1

    with Image.open(new_dir / "background.png") as result:
        require(result.size == canvas, f"{profile}: candidate background dimensions changed")
        require(pixels_equal(expected_background, result),
                f"{profile}: background pixels differ from original plus timer backing")

    old_files = {path.relative_to(old_dir) for path in old_dir.rglob("*") if path.is_file()}
    new_files = {path.relative_to(new_dir) for path in new_dir.rglob("*") if path.is_file()}
    require(not new_files - old_files, f"{profile}: unexpected added files: {sorted(new_files - old_files)}")
    removed = old_files - new_files
    require(removed <= removable, f"{profile}: unexpected removed files: {sorted(removed - removable)}")
    counts.deleted += len(removed)
    old_references = referenced_pngs(old_dir, before)
    new_references = referenced_pngs(new_dir, after)

    for relative in sorted(old_files & new_files):
        old_path, new_path = old_dir / relative, new_dir / relative
        if old_path.read_bytes() == new_path.read_bytes():
            counts.identical += 1
            continue
        if relative == Path("theme.txt") or (relative == Path("background.png") and bases):
            continue
        require(relative.suffix == ".png", f"{profile / relative}: non-image file changed")
        require(old_path in old_references, f"{profile / relative}: unreferenced source image changed")
        with Image.open(old_path) as original, Image.open(new_path) as result:
            require(original.mode == "RGBA" and original.getchannel("A").getextrema() == (255, 255),
                    f"{profile / relative}: changed image was not opaque RGBA")
            require(result.mode == "RGB" and "transparency" not in result.info,
                    f"{profile / relative}: changed image is not opaque RGB")
            require(pixels_equal(original, result), f"{profile / relative}: sprite pixels changed")
        counts.converted += 1
    return old_references, new_references


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path, help="Untouched directory containing themes/")
    parser.add_argument("--candidate", type=Path, default=Path(__file__).resolve().parents[1],
                        help="Candidate directory containing themes/, defaults to this repository")
    args = parser.parse_args()
    baseline = args.baseline.resolve() / "themes"
    candidate = args.candidate.resolve() / "themes"
    try:
        for root in (baseline, candidate):
            profiles = {path.parent.relative_to(root) for name in ("T1", "T2", "T3", "T4")
                        for path in (root / name).rglob("theme.txt")}
            require(profiles == PROFILES, f"{root}: expected exactly the 12 Sidonia theme profiles")
        counts = Counts()
        before_references: set[Path] = set()
        after_references: set[Path] = set()
        for profile in sorted(PROFILES):
            before, after = verify_profile(baseline, candidate, profile, counts)
            before_references.update(before)
            after_references.update(after)
            print(f"PASS {profile}")
        before_disk, before_decoded = image_totals(before_references)
        after_disk, after_decoded = image_totals(after_references)
    except (VerificationError, OSError, ValueError, KeyError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1

    print(f"Verified all 12 profiles: {counts.baked} baked timer backings, "
          f"{counts.converted} opaque RGB conversions, {counts.deleted} removed backing files.")
    print(f"Unchanged original files: {counts.identical}.")
    print(f"Referenced PNGs: {len(before_references)} -> {len(after_references)}.")
    print(f"Referenced PNG file bytes: {before_disk:,} -> {after_disk:,}; saved {before_disk - after_disk:,}.")
    print(f"Referenced PNG decoded pixel bytes: {before_decoded:,} -> {after_decoded:,}; "
          f"saved {before_decoded - after_decoded:,}.")
    print("Pixel checks cover native profile canvases and centered 1440p geometry on larger framebuffers.")
    print("GRUB rendering, off-profile 720p/1080p scaling, and boot-time changes require separate verification.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
