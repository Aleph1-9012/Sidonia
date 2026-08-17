from __future__ import annotations

import csv
import hashlib
import json
import math
import shutil
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "upload" / "T3-F.png"
AI_BLANK = ROOT / "generated_images" / "exec-bfd29c23-9f6e-4bec-bafe-c5f46fd2e61f.png"
OUT = ROOT / "starfix_hud_asset_pack"
ZIP_PATH = ROOT / "starfix_hud_asset_pack.zip"

IVORY = (235, 225, 205, 255)
IVORY_DIM = (198, 190, 174, 220)
RED = (235, 20, 32, 255)
RED_DIM = (184, 11, 25, 210)
TRANSPARENT = (0, 0, 0, 0)
AA = 3

FONT_NARROW = "/usr/share/fonts/type1/urw-base35/NimbusSansNarrow-Regular.pfb"
FONT_MONO = "/usr/share/fonts/opentype/urw-base35/NimbusMonoPS-Regular.otf"

MANIFEST: list[dict] = []


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, max(1, size * AA))


class HudCanvas:
    def __init__(self, size: tuple[int, int]):
        self.size = size
        self.im = Image.new("RGBA", (size[0] * AA, size[1] * AA), TRANSPARENT)
        self.d = ImageDraw.Draw(self.im)

    @staticmethod
    def p(point):
        return tuple(int(round(v * AA)) for v in point)

    def line(self, points, fill=IVORY, width=1, joint="curve"):
        self.d.line([self.p(p) for p in points], fill=fill, width=max(1, width * AA), joint=joint)

    def rect(self, box, outline=IVORY, width=1, fill=None):
        self.d.rectangle(self.p(box[:2]) + self.p(box[2:]), outline=outline, width=max(1, width * AA), fill=fill)

    def ellipse(self, box, outline=IVORY, width=1, fill=None):
        self.d.ellipse(self.p(box[:2]) + self.p(box[2:]), outline=outline, width=max(1, width * AA), fill=fill)

    def polygon(self, pts, outline=IVORY, width=1, fill=None):
        sp = [self.p(p) for p in pts]
        self.d.polygon(sp, fill=fill)
        if outline:
            self.d.line(sp + [sp[0]], fill=outline, width=max(1, width * AA), joint="curve")

    def text(self, xy, value, size=16, fill=IVORY, tracking=2, mono=False, anchor=None):
        f = font(FONT_MONO if mono else FONT_NARROW, size)
        x, y = self.p(xy)
        if anchor:
            self.d.text((x, y), value, font=f, fill=fill, anchor=anchor)
            return
        for ch in value:
            self.d.text((x, y), ch, font=f, fill=fill)
            x += int(f.getlength(ch) + tracking * AA)

    def finish(self, glow=True):
        if glow:
            halo = self.im.filter(ImageFilter.GaussianBlur(2.1 * AA))
            halo.putalpha(halo.getchannel("A").point(lambda a: int(a * 0.27)))
            out = Image.alpha_composite(halo, self.im)
        else:
            out = self.im
        return out.resize(self.size, Image.Resampling.LANCZOS)


def alpha_from_black(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    value = arr.max(axis=2)
    # Keep faint bloom only when it is close to a real, bright HUD stroke.
    # This rejects the near-black compression/grain field in the source.
    seed = Image.fromarray(np.where(value > 46, 255, 0).astype(np.uint8), "L")
    near_stroke = np.asarray(seed.filter(ImageFilter.MaxFilter(15))) > 0
    alpha = np.where(near_stroke, np.clip((value - 10.0) * 1.22, 0, 255), 0)
    alpha[value < 11] = 0
    red_mask = (arr[..., 0] > 42) & (arr[..., 0] > arr[..., 1] * 1.35) & (arr[..., 0] > arr[..., 2] * 1.20)
    rgb = np.zeros_like(arr)
    rgb[~red_mask] = np.array(IVORY[:3], dtype=np.float32)
    rgb[red_mask] = np.array(RED[:3], dtype=np.float32)
    rgba = np.dstack([rgb, alpha]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def alpha_from_checkerboard(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    warmth = np.maximum(r - b, 0) + 0.65 * np.maximum(r - g, 0)
    red_signal = np.maximum(r - np.maximum(g, b), 0)
    alpha = np.clip((warmth - 5) * 7.0 + red_signal * 1.5, 0, 255)
    alpha[alpha < 8] = 0
    red_mask = (r > 70) & (r > g * 1.35) & (r > b * 1.25)
    rgb = np.zeros_like(arr)
    rgb[~red_mask] = np.array(IVORY[:3], dtype=np.float32)
    rgb[red_mask] = np.array(RED[:3], dtype=np.float32)
    rgba = np.dstack([rgb, alpha]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def trim(im: Image.Image, pad=4) -> Image.Image:
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(im.width, r + pad), min(im.height, b + pad)
    return im.crop((l, t, r, b))


def save_rgba(category: str, name: str, im: Image.Image, *, variant: str, description: str, source_visible=True, extra=None):
    folder = OUT / category
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}_{variant}.png"
    # Pillow's optimizer can produce truncated output for very sparse 2K RGBA
    # layers on some libpng builds; regular compression is deterministic.
    im.convert("RGBA").save(path, compress_level=6)
    rec = {
        "id": name,
        "category": category,
        "variant": variant,
        "file": str(path.relative_to(OUT)),
        "width": im.width,
        "height": im.height,
        "description": description,
        "source_visible": bool(source_visible),
        "alpha": True,
    }
    if extra:
        rec.update(extra)
    MANIFEST.append(rec)
    return path


def save_pair(category: str, name: str, blank: Image.Image, labeled: Image.Image, description: str, source_visible=True, extra=None):
    assert blank.size == labeled.size, (name, blank.size, labeled.size)
    save_rgba(category, name, blank, variant="blank", description=description, source_visible=source_visible, extra=extra)
    save_rgba(category, name, labeled, variant="labeled", description=description, source_visible=source_visible, extra=extra)


def draw_warning(c: HudCanvas, center, size=18, fill=IVORY):
    x, y = center
    h = size * 0.86
    c.polygon([(x, y - h / 2), (x - size / 2, y + h / 2), (x + size / 2, y + h / 2)], outline=fill)
    c.line([(x, y - 3), (x, y + 3)], fill=fill)
    c.ellipse((x - 1, y + 6, x + 1, y + 8), fill=fill, outline=None)


def draw_crosshair(c: HudCanvas, center, radius=18, fill=IVORY, box=False, active=False):
    x, y = center
    if box:
        c.rect((x - radius, y - radius, x + radius, y + radius), outline=fill)
        c.rect((x - 4, y - 4, x + 4, y + 4), fill=fill, outline=None)
    else:
        c.ellipse((x - radius, y - radius, x + radius, y + radius), outline=fill)
        if active:
            c.ellipse((x - radius + 4, y - radius + 4, x + radius - 4, y + radius - 4), fill=RED, outline=RED)
        c.text((x, y - 1), "+", size=12, fill=IVORY, tracking=0, mono=True, anchor="mm")
    c.line([(x - radius - 11, y), (x - radius - 3, y)], fill=fill)
    c.line([(x + radius + 3, y), (x + radius + 11, y)], fill=fill)
    c.line([(x, y - radius - 11), (x, y - radius - 3)], fill=fill)
    c.line([(x, y + radius + 3), (x, y + radius + 11)], fill=fill)


def draw_cross_node(c: HudCanvas, center, fill=IVORY):
    x, y = center
    c.line([(x - 27, y), (x - 7, y)], fill=fill)
    c.line([(x + 7, y), (x + 27, y)], fill=fill)
    c.line([(x, y - 27), (x, y - 7)], fill=fill)
    c.line([(x, y + 7), (x, y + 27)], fill=fill)
    c.rect((x - 6, y - 6, x + 6, y + 6), outline=fill)
    c.rect((x - 2, y - 2, x + 2, y + 2), fill=fill, outline=None)


def node_asset(kind="circle", active=False, number="01", line1="P:01-17", line2="T:17.2", caution=False):
    size = (250, 152)
    blank = HudCanvas(size)
    labeled = HudCanvas(size)
    for c in (blank, labeled):
        center = (72, 54)
        if kind == "circle":
            draw_crosshair(c, center, radius=22, active=active)
        elif kind == "square":
            draw_crosshair(c, center, radius=22, box=True)
        else:
            draw_cross_node(c, center)
        c.line([(103, 54), (210, 54)], fill=IVORY_DIM)
        c.line([(210, 50), (210, 58)], fill=IVORY_DIM)
    labeled.text((42, 8), number, 18, mono=True, tracking=0)
    labeled.text((102, 84), line1, 13, mono=True, tracking=1)
    labeled.text((102, 105), line2, 13, mono=True, tracking=1)
    if caution:
        draw_warning(labeled, (214, 119), 18)
    return blank.finish(), labeled.finish()


def selector_row(index: str, label: str, active=False):
    size = (430, 66)
    b = HudCanvas(size)
    l = HudCanvas(size)
    color = RED if active else IVORY
    for c in (b, l):
        c.line([(18, 33), (78, 33)], fill=color)
        if active:
            c.ellipse((65, 21, 89, 45), outline=RED)
            c.ellipse((71, 27, 83, 39), fill=RED, outline=RED)
            c.text((77, 32), "+", 9, fill=IVORY, tracking=0, mono=True, anchor="mm")
        else:
            c.rect((71, 27, 83, 39), outline=color)
            c.rect((75, 31, 79, 35), fill=color, outline=None)
        c.line([(77, 4), (77, 21)], fill=color)
        c.line([(77, 45), (77, 62)], fill=color)
    l.text((110, 20), f"{index}  {label}", 18, fill=color, tracking=3)
    return b.finish(), l.finish()


def selector_list():
    size = (500, 300)
    b = HudCanvas(size)
    l = HudCanvas(size)
    rows = [("01", "SIDONIA SYSTEM", False), ("02", "ADVANCED OPTIONS", True), ("03", "RECOVERY VECTOR", False), ("04", "UEFI FIRMWARE", False)]
    for c in (b, l):
        c.line([(92, 25), (92, 274)], fill=IVORY_DIM)
    for i, (idx, txt, active) in enumerate(rows):
        y = 35 + i * 68
        color = RED if active else IVORY
        for c in (b, l):
            c.line([(28, y), (82, y)], fill=color)
            if active:
                c.ellipse((79, y - 18, 115, y + 18), outline=RED)
                c.ellipse((85, y - 12, 109, y + 12), fill=RED, outline=RED)
                c.text((97, y - 1), "+", 10, fill=IVORY, tracking=0, mono=True, anchor="mm")
            else:
                c.rect((86, y - 6, 98, y + 6), outline=color)
                c.rect((90, y - 2, 94, y + 2), fill=color, outline=None)
        l.text((126, y - 13), f"{idx}  {txt}", 19, fill=color, tracking=3)
    return b.finish(), l.finish()


def panel_title():
    size = (720, 150)
    b = HudCanvas(size)
    l = HudCanvas(size)
    for c in (b, l):
        c.line([(15, 106), (555, 106)], fill=IVORY_DIM)
    l.text((16, 17), "S H Ō I", 46, fill=RED, tracking=8)
    l.text((252, 17), "S T A R F I X", 46, fill=IVORY, tracking=8)
    l.text((16, 116), "TYPE-17", 17, fill=IVORY, tracking=3)
    l.text((128, 116), "//", 17, fill=RED, tracking=4)
    l.text((184, 116), "FORMATION LINK", 17, fill=IVORY, tracking=3)
    return b.finish(), l.finish()


def text_panel(lines, size, origin=(16, 16), title=None):
    b = HudCanvas(size)
    l = HudCanvas(size)
    for c in (b, l):
        c.line([(4, 18), (4, 4), (22, 4)], fill=IVORY_DIM)
        c.line([(size[0] - 22, size[1] - 4), (size[0] - 4, size[1] - 4), (size[0] - 4, size[1] - 18)], fill=IVORY_DIM)
    if title:
        l.text(origin, title, 15, fill=RED, tracking=2, mono=True)
        y = origin[1] + 28
    else:
        y = origin[1]
    for line in lines:
        l.text((origin[0], y), line, 14, fill=IVORY, tracking=2, mono=True)
        y += 22
    return b.finish(), l.finish()


def countdown_strip():
    size = (520, 130)
    b = HudCanvas(size)
    l = HudCanvas(size)
    l.text((15, 4), "AUTO LAUNCH 08", 23, fill=RED, tracking=3, mono=True)
    for i in range(8):
        x = 18 + i * 61
        for c in (b, l):
            c.rect((x, 42, x + 42, 73), outline=RED if i == 0 else IVORY_DIM, fill=RED if i == 0 else None)
        l.text((x + 9, 88), f"{i:02d}", 15, fill=IVORY, tracking=1, mono=True)
    return b.finish(), l.finish()


def countdown_slot(index=0, active=False):
    size = (78, 92)
    b = HudCanvas(size)
    l = HudCanvas(size)
    for c in (b, l):
        c.rect((17, 12, 61, 48), outline=RED if active else IVORY, fill=RED if active else None)
    l.text((27, 62), f"{index:02d}", 15, mono=True, tracking=1)
    return b.finish(), l.finish()


def keycap(letter, action):
    size = (250, 72)
    b = HudCanvas(size)
    l = HudCanvas(size)
    for c in (b, l):
        c.rect((12, 12, 54, 58), outline=IVORY)
    l.text((33, 35), letter, 18, fill=IVORY, tracking=0, mono=True, anchor="mm")
    l.text((76, 23), f"{letter}  {action}", 18, fill=IVORY, tracking=3)
    return b.finish(), l.finish()


def barcode_asset(code, size=(330, 120), subtitle=None):
    b = HudCanvas(size)
    l = HudCanvas(size)
    digest = hashlib.sha256(code.encode()).digest()
    pattern = []
    for byte in digest:
        for shift in (0, 2, 4, 6):
            pattern.append(1 + ((byte >> shift) & 0x3))
    x0, y0, maxw, h = 18, 36, size[0] - 36, 42
    total = sum(pattern)
    scale = maxw / total
    x = x0
    ink = True
    for width in pattern:
        w = max(1, int(round(width * scale)))
        if ink:
            for c in (b, l):
                c.rect((x, y0, min(x + w, x0 + maxw), y0 + h), outline=None, fill=IVORY)
        x += w
        ink = not ink
        if x >= x0 + maxw:
            break
    l.text((18, 7), code, 14, mono=True, tracking=1)
    if subtitle:
        l.text((18, 87), subtitle, 14, mono=True, tracking=1)
    return b.finish(), l.finish()


def icon_asset(kind, label):
    size = (220, 110)
    b = HudCanvas(size)
    l = HudCanvas(size)
    for c in (b, l):
        if kind == "warning":
            draw_warning(c, (48, 42), 42)
        elif kind == "crosshair":
            draw_crosshair(c, (48, 42), 18)
        elif kind == "target":
            draw_crosshair(c, (48, 42), 18, active=True)
        elif kind == "part_mark":
            c.polygon([(48, 12), (18, 68), (78, 68)], outline=IVORY)
            c.line([(48, 20), (48, 61)], fill=IVORY_DIM)
            c.ellipse((45, 39, 51, 45), fill=IVORY, outline=None)
            c.line([(24, 62), (72, 62)], fill=IVORY_DIM)
        elif kind == "plus":
            c.text((48, 41), "+", 24, fill=IVORY, tracking=0, mono=True, anchor="mm")
        elif kind == "square":
            draw_cross_node(c, (48, 42))
        elif kind == "dot":
            c.rect((43, 37, 53, 47), fill=IVORY, outline=None)
        elif kind.startswith("arrow_"):
            direction = kind.split("_", 1)[1]
            pts = {
                "right": [(32, 28), (66, 42), (32, 56)],
                "left": [(64, 28), (30, 42), (64, 56)],
                "up": [(34, 57), (48, 23), (62, 57)],
                "down": [(34, 27), (48, 61), (62, 27)],
            }[direction]
            c.polygon(pts, outline=IVORY)
        elif kind == "navigate":
            c.line([(24, 42), (72, 42)], fill=IVORY_DIM)
            c.line([(48, 18), (48, 66)], fill=IVORY_DIM)
            c.rect((42, 36, 54, 48), outline=IVORY)
        elif kind == "tick_cluster":
            c.line([(18, 42), (76, 42)], fill=IVORY)
            for x in [22, 32, 58, 70]:
                c.line([(x, 36), (x, 48)], fill=IVORY_DIM)
        elif kind == "endpoint":
            c.line([(22, 42), (70, 42)], fill=IVORY)
            c.line([(22, 33), (22, 51)], fill=IVORY)
            c.rect((66, 38, 74, 46), fill=IVORY, outline=None)
        elif kind == "dashed_drop":
            for y in range(12, 66, 10):
                c.line([(48, y), (48, y + 5)], fill=IVORY_DIM)
            c.polygon([(42, 62), (48, 74), (54, 62)], outline=IVORY)
        elif kind == "corner_tl":
            c.line([(18, 54), (18, 18), (56, 18)], fill=IVORY)
            c.rect((15, 15, 23, 23), fill=IVORY, outline=None)
        elif kind == "corner_tr":
            c.line([(40, 18), (78, 18), (78, 54)], fill=IVORY)
            c.rect((73, 15, 81, 23), fill=IVORY, outline=None)
        elif kind == "corner_bl":
            c.line([(18, 30), (18, 66), (56, 66)], fill=IVORY)
            c.rect((15, 61, 23, 69), fill=IVORY, outline=None)
        elif kind == "corner_br":
            c.line([(40, 66), (78, 66), (78, 30)], fill=IVORY)
            c.rect((73, 61, 81, 69), fill=IVORY, outline=None)
    l.text((95, 30), label, 15, fill=IVORY, tracking=2)
    return b.finish(), l.finish()


def connector_asset(kind, label):
    size = (330, 96)
    b = HudCanvas(size)
    l = HudCanvas(size)
    for c in (b, l):
        if kind == "horizontal":
            c.line([(18, 42), (310, 42)], fill=IVORY_DIM)
            c.line([(18, 36), (18, 48)], fill=IVORY)
            c.line([(310, 36), (310, 48)], fill=IVORY)
        elif kind == "vertical":
            c.line([(52, 10), (52, 84)], fill=IVORY_DIM)
            c.line([(46, 10), (58, 10)], fill=IVORY)
            c.line([(46, 84), (58, 84)], fill=IVORY)
        elif kind == "diagonal_up":
            c.line([(18, 76), (300, 18)], fill=IVORY_DIM)
        elif kind == "diagonal_down":
            c.line([(18, 18), (300, 76)], fill=IVORY_DIM)
        elif kind == "elbow":
            c.line([(18, 72), (112, 72), (112, 20), (300, 20)], fill=IVORY_DIM)
            c.rect((106, 66, 118, 78), outline=IVORY)
        elif kind == "fork":
            c.line([(18, 48), (160, 48)], fill=IVORY_DIM)
            c.line([(160, 48), (300, 16)], fill=IVORY_DIM)
            c.line([(160, 48), (300, 80)], fill=IVORY_DIM)
            c.rect((156, 44, 164, 52), fill=IVORY, outline=None)
        elif kind == "arrow_inline":
            c.line([(18, 42), (132, 42)], fill=IVORY_DIM)
            c.polygon([(132, 32), (150, 42), (132, 52)], outline=IVORY)
            c.line([(150, 42), (310, 42)], fill=IVORY_DIM)
        elif kind == "dashed":
            x = 18
            while x < 310:
                c.line([(x, 42), (min(x + 12, 310), 42)], fill=IVORY_DIM)
                x += 20
    l.text((188, 60), label, 12, fill=IVORY, tracking=1)
    return b.finish(), l.finish()


def scrollbar(horizontal=True):
    size = (520, 52) if horizontal else (52, 520)
    b = HudCanvas(size)
    l = HudCanvas(size)
    if horizontal:
        for c in (b, l):
            c.rect((8, 15, 512, 37), outline=IVORY_DIM)
            c.rect((18, 20, 148, 32), fill=RED, outline=RED)
            for x in range(170, 500, 42):
                c.line([(x, 18), (x, 34)], fill=IVORY_DIM)
        l.text((18, 1), "POS 02 / 08", 10, fill=IVORY, tracking=1, mono=True)
    else:
        for c in (b, l):
            c.rect((15, 8, 37, 512), outline=IVORY_DIM)
            c.rect((20, 18, 32, 148), fill=RED, outline=RED)
            for y in range(170, 500, 42):
                c.line([(18, y), (34, y)], fill=IVORY_DIM)
        l.text((25, 500), "02", 10, fill=IVORY, tracking=0, mono=True, anchor="mm")
    return b.finish(), l.finish()


def command_bar():
    size = (1780, 110)
    b = HudCanvas(size)
    l = HudCanvas(size)
    for c in (b, l):
        c.line([(10, 12), (1770, 12)], fill=IVORY_DIM)
        draw_crosshair(c, (42, 65), 15, active=True)
        c.rect((420, 42, 460, 86), outline=IVORY)
        c.rect((755, 42, 795, 86), outline=IVORY)
        c.line([(1125, 65), (1165, 65)], fill=IVORY_DIM)
        c.line([(1145, 45), (1145, 85)], fill=IVORY_DIM)
        c.rect((1139, 59, 1151, 71), outline=IVORY)
        draw_warning(c, (1450, 65), 34)
    l.text((82, 51), "ENTER BOOT", 18, fill=RED, tracking=4)
    l.text((440, 65), "E", 16, mono=True, tracking=0, anchor="mm")
    l.text((480, 51), "E EDIT", 18, tracking=4)
    l.text((775, 65), "C", 16, mono=True, tracking=0, anchor="mm")
    l.text((815, 51), "C CONSOLE", 18, tracking=4)
    l.text((1182, 51), "NAVIGATE", 18, tracking=4)
    l.text((1490, 51), "CAUTION", 18, tracking=4)
    l.text((1690, 51), "704", 18, fill=RED, tracking=3, mono=True)
    return b.finish(), l.finish()


def overlay_scanlines(labeled=False):
    size = (2048, 1152)
    im = Image.new("RGBA", size, TRANSPARENT)
    d = ImageDraw.Draw(im)
    for y in range(1, size[1], 4):
        d.line((0, y, size[0], y), fill=(225, 215, 197, 9), width=1)
    if labeled:
        d.text((26, 24), "SCAN / 17-A", font=ImageFont.truetype(FONT_MONO, 15), fill=IVORY_DIM)
    return im


def create_source_extracts(master: Image.Image):
    crops = {
        "title_header": (35, 24, 590, 158),
        "system_status": (35, 170, 270, 310),
        "countdown": (770, 25, 1265, 150),
        "coordinates": (1418, 35, 1608, 230),
        "checksum_barcode": (1755, 42, 2020, 190),
        "selector_list": (515, 420, 875, 730),
        "part_mark": (35, 865, 180, 1055),
        "diagnostic_panel": (1760, 846, 2025, 1070),
        "command_bar": (125, 1060, 1910, 1152),
        "network_map": (90, 192, 2020, 1055),
    }
    for name, box in crops.items():
        crop = trim(master.crop(box), 4)
        save_rgba("10_source_extracts", name, crop, variant="labeled", description="Exact alpha-separated crop from the supplied reference.")


def create_color_layers(master: Image.Image):
    arr = np.asarray(master, dtype=np.uint8)
    a = arr[..., 3]
    red_mask = (arr[..., 0] > arr[..., 1] * 1.5) & (arr[..., 0] > arr[..., 2] * 1.4) & (a > 0)
    red_arr = arr.copy()
    red_arr[..., 3] = np.where(red_mask, a, 0)
    ivory_arr = arr.copy()
    ivory_arr[..., 3] = np.where(~red_mask, a, 0)
    save_rgba("08_overlays", "red_signal_layer", Image.fromarray(red_arr, "RGBA"), variant="blank", description="Red active-state elements only.")
    save_rgba("08_overlays", "red_signal_layer", Image.fromarray(red_arr, "RGBA"), variant="labeled", description="Red active-state elements only.")
    save_rgba("08_overlays", "ivory_line_layer", Image.fromarray(ivory_arr, "RGBA"), variant="blank", description="Warm-ivory HUD elements only.")
    save_rgba("08_overlays", "ivory_line_layer", Image.fromarray(ivory_arr, "RGBA"), variant="labeled", description="Warm-ivory HUD elements only.")


def build_contact_sheet():
    records = [r for r in MANIFEST if r["variant"] in ("blank", "labeled") and r["category"] != "10_source_extracts"]
    pairs = {}
    for r in records:
        pairs.setdefault((r["category"], r["id"]), {})[r["variant"]] = r
    keys = sorted(pairs)
    cell_w, cell_h = 310, 210
    cols = 4
    rows = math.ceil(len(keys) / cols)
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h + 70), (8, 9, 9))
    d = ImageDraw.Draw(sheet)
    title_font = ImageFont.truetype(FONT_NARROW, 28)
    small_font = ImageFont.truetype(FONT_MONO, 12)
    d.text((24, 18), "STARFIX HUD — EXPANDED TRANSPARENT ASSET PACK", font=title_font, fill=(235, 225, 205))
    for i, key in enumerate(keys):
        x = (i % cols) * cell_w
        y = 70 + (i // cols) * cell_h
        d.rectangle((x + 6, y + 6, x + cell_w - 6, y + cell_h - 6), outline=(55, 56, 54), width=1)
        d.text((x + 14, y + 12), f"{key[0]}/{key[1]}", font=small_font, fill=(200, 194, 181))
        for j, variant in enumerate(("blank", "labeled")):
            rec = pairs[key].get(variant)
            if not rec:
                continue
            im = Image.open(OUT / rec["file"]).convert("RGBA")
            thumb = ImageOps.contain(im, (132, 142), Image.Resampling.LANCZOS)
            tx = x + 12 + j * 148 + (132 - thumb.width) // 2
            ty = y + 42 + (142 - thumb.height) // 2
            sheet.alpha_composite(thumb, (tx, ty)) if sheet.mode == "RGBA" else sheet.paste(thumb, (tx, ty), thumb)
            d.text((x + 44 + j * 148, y + 188), variant.upper(), font=small_font, fill=(235, 20, 32) if variant == "labeled" else (180, 176, 165))
    preview = OUT / "11_preview" / "contact_sheet.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(preview, compress_level=6)
    return preview


def build_full_previews(blank: Image.Image, labeled: Image.Image):
    folder = OUT / "11_preview"
    folder.mkdir(parents=True, exist_ok=True)
    for name, overlay in [("full_overlay_blank_preview", blank), ("full_overlay_labeled_preview", labeled)]:
        bg = Image.new("RGBA", overlay.size, (5, 6, 6, 255))
        bg.alpha_composite(overlay)
        bg.convert("RGB").save(folder / f"{name}.png", compress_level=6)


def write_docs():
    by_category = {}
    for r in MANIFEST:
        by_category.setdefault(r["category"], 0)
        by_category[r["category"]] += 1
    readme = f"""# STARFIX HUD expanded transparent asset pack

Production-ready component pack derived from the supplied 2048×1152 HUD reference.

- {len(MANIFEST)} transparent PNG assets
- paired `*_blank.png` and `*_labeled.png` variants wherever applicable
- exact alpha-separated source crops plus normalized reusable components
- full labeled and blank overlays, separated red/ivory signal layers, selectors, frames, node states, countdown pieces, scrollbars, connectors, barcodes, icons, and micrographics
- `manifest.json` and `asset_index.csv` for dimensions and lookup

## Palette

- Signal red: `#EB1420`
- Warm ivory: `#EBE1CD`
- Dim ivory: `rgba(198,190,174,0.86)`
- Background: transparent (preview on near-black)

## Naming

`<category>/<asset>_blank.png` is the reusable frame/graphic without readable copy.

`<category>/<asset>_labeled.png` carries the reference label or a clear sample label.

The `10_source_extracts` folder contains exact labeled crops from the supplied screenshot. The normalized folders use clean, consistent geometry and interchangeable dimensions.

## Categories

"""
    for k in sorted(by_category):
        readme += f"- `{k}` — {by_category[k]} files\n"
    readme += "\n## Technical notes\n\nAll PNGs use RGBA transparency. Most normalized components include subtle baked glow while retaining a transparent canvas. The full-size overlay stays at 2048×1152.\n"
    (OUT / "README.md").write_text(readme, encoding="utf-8")
    (OUT / "manifest.json").write_text(json.dumps({"pack": "STARFIX HUD", "version": "1.0", "asset_count": len(MANIFEST), "assets": MANIFEST}, indent=2), encoding="utf-8")
    with (OUT / "asset_index.csv").open("w", newline="", encoding="utf-8") as f:
        cols = ["category", "id", "variant", "file", "width", "height", "description", "source_visible", "alpha"]
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(MANIFEST)
    tokens = {
        "colors": {"signal_red": "#EB1420", "warm_ivory": "#EBE1CD", "dim_ivory": "#C6BEAE"},
        "typography": {"display": "condensed grotesk with wide tracking", "data": "condensed monospaced"},
        "line_weights_px": [1, 2],
        "reference_canvas": [2048, 1152],
        "recommended_background": "#050606",
    }
    (OUT / "style_tokens.json").write_text(json.dumps(tokens, indent=2), encoding="utf-8")


def make_zip():
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(OUT.rglob("*")):
            if p.is_file():
                z.write(p, Path(OUT.name) / p.relative_to(OUT))


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    source = Image.open(SOURCE).convert("RGB")
    master = alpha_from_black(source)
    ai_blank = alpha_from_checkerboard(Image.open(AI_BLANK)).resize((2048, 1152), Image.Resampling.LANCZOS)
    save_pair("00_masters", "full_overlay", ai_blank, master, "Full-canvas 2048×1152 HUD overlay.")
    create_color_layers(master)
    create_source_extracts(master)

    # Selectors
    blank, labeled = selector_list()
    save_pair("01_selectors", "selector_list", blank, labeled, "Four-row selector with active second row.")
    rows = [("01", "SIDONIA SYSTEM", False), ("02", "ADVANCED OPTIONS", True), ("03", "RECOVERY VECTOR", False), ("04", "UEFI FIRMWARE", False)]
    for idx, label, active in rows:
        blank, labeled = selector_row(idx, label, active)
        save_pair("01_selectors", f"selector_row_{idx}", blank, labeled, f"Selector row {idx}: {label}.")

    # Frames and panels
    blank, labeled = panel_title()
    save_pair("02_frames", "title_header", blank, labeled, "STARFIX title and formation-link header.")
    blank, labeled = text_panel(["SYS:SF17-000A", "LINK:OK", "HDR:17/17", "RES:STABLE", "PRM:07-α"], (300, 150))
    save_pair("02_frames", "system_status", blank, labeled, "System status data block.")
    blank, labeled = text_panel(["X:  -1937.45", "Y:  +0842.31", "Z:  -2210.77", "", "UNIT:MM", "GRD:17-A", "MAG:A07.1", "REF:K-129"], (290, 230))
    save_pair("02_frames", "coordinates_panel", blank, labeled, "Coordinate and grid data panel.")
    blank, labeled = barcode_asset("CHK: 7A1F-17C9-3E04", (340, 130), "IDX: SF17-0A63-85")
    save_pair("02_frames", "checksum_panel", blank, labeled, "Checksum and wide barcode panel.")
    blank, labeled = barcode_asset("MNT:17A-0085-JP", (330, 150), "SN: SF17-85-704")
    save_pair("02_frames", "diagnostic_panel", blank, labeled, "Diagnostic mount and serial panel.")
    blank, labeled = command_bar()
    save_pair("02_frames", "command_bar", blank, labeled, "Full bottom command/navigation strip.")

    # Node instance pack, including an expanded node 15 that is not visible in the source.
    nodes = [
        (1, "circle", True, "P:01-17", "T:17.2", True),
        (2, "cross", False, "P:02-17", "A:13.7°", True),
        (3, "circle", True, "P:03-17", "T:08.8", True),
        (4, "square", False, "P:04-17", "A:90.0°", False),
        (5, "circle", False, "P:05-17", "T:14.6", True),
        (6, "square", False, "P:06-17", "A:180.0°", False),
        (7, "cross", False, "P:07-17", "T:11.3", True),
        (8, "circle", False, "P:08-17", "A:135.0°", False),
        (9, "square", False, "P:09-17", "T:16.1", True),
        (10, "circle", True, "P:10-17", "T:09.3", True),
        (11, "cross", False, "P:11-17", "A:315.0°", False),
        (12, "circle", False, "P:12-17", "T:12.9", True),
        (13, "cross", False, "P:13-17", "A:225.0°", False),
        (14, "circle", True, "P:14-17", "T:19.8", True),
        (15, "circle", False, "P:15-17", "A:45.0°", False),
        (16, "square", False, "P:16-17", "A:270.0°", False),
        (17, "circle", False, "P:17-17", "T:22.4", True),
    ]
    for n, kind, active, line1, line2, caution in nodes:
        blank, labeled = node_asset(kind, active, f"{n:02d}", line1, line2, caution)
        save_pair("03_nodes", f"node_{n:02d}", blank, labeled, f"Node {n:02d} cluster.", source_visible=n != 15)
    for name, kind, active in [("circle_idle", "circle", False), ("circle_active", "circle", True), ("square_idle", "square", False), ("cross_junction", "cross", False)]:
        blank, labeled = node_asset(kind, active, "00", "P:00-17", "T:00.0", False)
        save_pair("03_nodes", f"generic_{name}", blank, labeled, f"Generic {name.replace('_', ' ')} node.")

    # Countdown
    blank, labeled = countdown_strip()
    save_pair("04_countdown", "countdown_strip", blank, labeled, "Eight-position auto-launch countdown.")
    for i in range(8):
        blank, labeled = countdown_slot(i, i == 0)
        save_pair("04_countdown", f"countdown_slot_{i:02d}", blank, labeled, f"Countdown slot {i:02d}.")

    # Icons and controls
    icons = [
        ("warning_triangle", "warning", "CAUTION"), ("crosshair", "crosshair", "CROSSHAIR"),
        ("active_target", "target", "ENTER BOOT"), ("part_mark", "part_mark", "PART MARK"),
        ("plus_mark", "plus", "PLUS"), ("junction_square", "square", "JUNCTION"),
        ("junction_dot", "dot", "NODE"), ("arrow_right", "arrow_right", "RIGHT"),
        ("arrow_left", "arrow_left", "LEFT"), ("arrow_up", "arrow_up", "UP"),
        ("arrow_down", "arrow_down", "DOWN"), ("navigate", "navigate", "NAVIGATE"),
    ]
    for name, kind, label in icons:
        blank, labeled = icon_asset(kind, label)
        save_pair("05_icons", name, blank, labeled, f"{label.title()} icon/control.")
    for letter, action in [("E", "EDIT"), ("C", "CONSOLE")]:
        blank, labeled = keycap(letter, action)
        save_pair("05_icons", f"keycap_{letter.lower()}", blank, labeled, f"{letter} keycap and {action.lower()} action.")

    # Connectors and rails
    connectors = [
        ("horizontal", "LINK H"), ("vertical", "LINK V"), ("diagonal_up", "UPLINK"),
        ("diagonal_down", "DOWNLINK"), ("elbow", "ELBOW"), ("fork", "FORK"),
        ("arrow_inline", "DIRECTION"), ("dashed", "DASHED"),
    ]
    for kind, label in connectors:
        blank, labeled = connector_asset(kind, label)
        save_pair("06_connectors", kind, blank, labeled, f"{label.title()} connector segment.")

    # Scrollbars
    blank, labeled = scrollbar(True)
    save_pair("07_scrollbars", "horizontal_scrollbar", blank, labeled, "Horizontal segmented scrollbar.", source_visible=False)
    blank, labeled = scrollbar(False)
    save_pair("07_scrollbars", "vertical_scrollbar", blank, labeled, "Vertical segmented scrollbar.", source_visible=False)

    # Overlays
    save_pair("08_overlays", "scanlines", overlay_scanlines(False), overlay_scanlines(True), "Subtle transparent scanline overlay.")
    network_label = master.crop((80, 185, 2028, 1060))
    network_blank = ai_blank.crop((80, 185, 2028, 1060))
    save_pair("08_overlays", "network_map", network_blank, network_label, "Central node-network overlay.")

    # Barcodes
    for name, code, subtitle, size in [
        ("checksum_wide", "CHK: 7A1F-17C9-3E04", "IDX: SF17-0A63-85", (360, 130)),
        ("serial_narrow", "MNT:17A-0085-JP", "SN: SF17-85-704", (340, 150)),
        ("micro_code", "A-63/85", "PART MARK", (240, 110)),
    ]:
        blank, labeled = barcode_asset(code, size, subtitle)
        save_pair("09_barcodes", name, blank, labeled, f"Decorative encoded stripe graphic for {name.replace('_', ' ')}.")

    # Micrographics
    micros = [
        ("micro_warning", "warning", "WARN"), ("micro_crosshair", "crosshair", "REF"),
        ("micro_target", "target", "ACTIVE"), ("micro_tick_cluster", "tick_cluster", "TICKS"),
        ("micro_endpoint", "endpoint", "END"), ("micro_dashed_drop", "dashed_drop", "DROP"),
        ("corner_top_left", "corner_tl", "TL"), ("corner_top_right", "corner_tr", "TR"),
        ("corner_bottom_left", "corner_bl", "BL"), ("corner_bottom_right", "corner_br", "BR"),
    ]
    for name, kind, label in micros:
        blank, labeled = icon_asset(kind, label)
        save_pair("10_micrographics", name, blank, labeled, f"{label} micrographic.")

    # Reproducibility script.
    source_dir = OUT / "12_source"
    source_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(__file__), source_dir / Path(__file__).name)

    write_docs()
    build_contact_sheet()
    build_full_previews(ai_blank, master)
    make_zip()
    print(json.dumps({"output": str(OUT), "zip": str(ZIP_PATH), "asset_count": len(MANIFEST)}, indent=2))


if __name__ == "__main__":
    main()
