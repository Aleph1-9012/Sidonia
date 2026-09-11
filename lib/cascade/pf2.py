"""GRUB PF2 bitmap font writer and validator."""
from pathlib import Path
import struct
from PIL import Image, ImageDraw, ImageFont
MARKERS = tuple(0xE000 + i for i in range(4))

def section(name: str, data: bytes) -> bytes:
    assert len(name) == 4
    return name.encode("ascii") + struct.pack(">I", len(data)) + data


def packed_bits(mask: Image.Image) -> bytes:
    """PF2 bit stream does not pad individual scanlines to whole bytes."""
    binary = mask.convert("1")
    bits = binary.get_flattened_data() if hasattr(binary, "get_flattened_data") else binary.getdata()
    out = bytearray((mask.width * mask.height + 7) // 8)
    for index, on in enumerate(bits):
        if on:
            out[index // 8] |= 0x80 >> (index % 8)
    return bytes(out)


def glyph(mask: Image.Image, x: int, y: int, advance: int) -> bytes:
    return struct.pack(">HHhhh", mask.width, mask.height, x, y, advance) + packed_bits(mask)


def empty_glyph(advance: int = 0) -> bytes:
    return struct.pack(">HHhhh", 0, 0, 0, 0, advance)


def write_pf2(path: Path, name: str, glyphs: dict[int, bytes],
              ascent: int, descent: int, point_size: int) -> dict:
    # GRUB rejects zero ascent OR zero descent even for synthetic fonts.
    assert ascent > 0 and descent > 0
    allmetrics = [struct.unpack(">HHhhh", g[:10]) for g in glyphs.values()]
    header = section("FILE", b"PFF2")
    for tag, value in (("NAME", name), ("FAMI", name), ("WEIG", "normal"), ("SLAN", "normal")):
        header += section(tag, value.encode("ascii"))
    for tag, value in (("PTSZ", point_size), ("MAXW", max(g[0] for g in allmetrics)),
                       ("MAXH", max(g[1] for g in allmetrics)), ("ASCE", ascent), ("DESC", descent)):
        header += section(tag, struct.pack(">H", value))
    # CHIX payload is simply sorted 9-byte records, no extra count word.
    offset = len(header) + 8 + 9 * len(glyphs) + 8
    index, data = bytearray(), bytearray()
    for code, body in sorted(glyphs.items()):
        index.extend(struct.pack(">IBI", code, 0, offset))
        data.extend(body)
        offset += len(body)
    content = header + section("CHIX", bytes(index)) + b"DATA\xff\xff\xff\xff" + data
    path.write_bytes(content)
    parsed = validate_pf2(path)
    assert parsed["glyph_count"] == len(glyphs)
    return parsed


def validate_pf2(path: Path) -> dict:
    """Independently parse every CHIX offset, metric and bitmap extent."""
    raw, pos, blocks = path.read_bytes(), 0, {}
    while pos + 8 <= len(raw):
        tag = raw[pos:pos + 4].decode("ascii")
        length = struct.unpack(">I", raw[pos + 4:pos + 8])[0]
        pos += 8
        if tag == "DATA":
            assert length == 0xFFFFFFFF
            break
        assert pos + length <= len(raw), (tag, length)
        blocks[tag] = raw[pos:pos + length]
        pos += length
    assert blocks["FILE"] == b"PFF2"
    assert struct.unpack(">H", blocks["ASCE"])[0] > 0
    assert struct.unpack(">H", blocks["DESC"])[0] > 0
    index = blocks["CHIX"]
    assert len(index) % 9 == 0
    prev, metrics = -1, []
    for p in range(0, len(index), 9):
        code, flags, offset = struct.unpack(">IBI", index[p:p + 9])
        assert code > prev and flags == 0 and offset >= pos
        assert offset + 10 <= len(raw)
        w, h, x, y, advance = struct.unpack(">HHhhh", raw[offset:offset + 10])
        end = offset + 10 + (w * h + 7) // 8
        assert end <= len(raw)
        metrics.append({"codepoint": code, "width": w, "height": h,
                        "x_offset": x, "y_offset": y, "advance": advance,
                        "offset": offset, "end": end})
        prev = code
    for previous, following in zip(metrics, metrics[1:]):
        assert previous["end"] == following["offset"]
    assert metrics[-1]["end"] == len(raw)
    return {"name": blocks["NAME"].decode("ascii"), "glyph_count": len(metrics),
            "size_bytes": len(raw), "glyphs": metrics}


def font_at(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), max(8, size))


def create_ui_font(path: Path, ttf: Path, size: int) -> tuple[str, dict]:
    name = f"Cascade UI {size}"
    font = font_at(ttf, size)
    ascent, descent = font.getmetrics()
    glyphs = {code: empty_glyph() for code in MARKERS}
    # Normal terminal/editor UI also needs GRUB's box-drawing and arrow glyphs.
    for code in sorted(set(range(32, 127)) | set(range(0x2500, 0x2580)) | set(range(0x2190, 0x2195))):
        char = chr(code)
        left, top, right, bottom = font.getbbox(char, anchor="ls")
        w, h = right - left, bottom - top
        mask = Image.new("1", (w, h))
        if w and h:
            ImageDraw.Draw(mask).text((-left, -top), char, font=font, fill=1, anchor="ls")
        glyphs[code] = glyph(mask, left, -bottom, round(font.getlength(char)))
    return name, write_pf2(path, name, glyphs, ascent, descent, size)
