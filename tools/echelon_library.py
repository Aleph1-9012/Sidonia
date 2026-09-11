"""Build Echelon's character library and fixed artwork on the maintainer's machine."""
import gzip
import hashlib
from pathlib import Path
import re
import shutil
import struct
import tempfile

from PIL import Image, ImageDraw, ImageFont

from pf2 import validate_pf2, create_ui_font
from render import Artwork, build

ROOT = Path(__file__).resolve().parents[1]
FONT_ROOT = ROOT / 'lib/cascade/fonts'


def centered_theme(source, width, height):
    source = re.sub(r'^desktop-image[^\n]*\n', '', source, flags=re.M)
    for prop, half in (("left", width//2), ("top", height//2)):
        source = re.sub(rf'^(  {prop} = )(-?\d+)$',
                        lambda m: f'{m[1]}50%{int(m[2])-half:+d}', source, flags=re.M)
    return (f'# Fixed {width}x{height} canvas, centered with black padding.\n'
            'desktop-color: "#000000"\n' + source + f'''
+ image {{
  left = 50%-{width//2}
  top = 50%-{height//2}
  width = {width}
  height = {height}
  file = "background.png"
}}
''')


def checksum(folder):
    (folder/'SHA256SUMS').write_text(''.join(
        f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(folder)}\n'
        for p in sorted(folder.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'))


def codepoints(path):
    """Read Unicode cmap formats 4/12 without another build dependency."""
    raw = path.read_bytes()
    u16 = lambda p: struct.unpack_from('>H', raw, p)[0]
    u32 = lambda p: struct.unpack_from('>I', raw, p)[0]
    cmap = next(u32(p + 8) for p in range(12, 12 + 16*u16(4), 16)
                if raw[p:p+4] == b'cmap')
    result = set()
    for p in range(cmap + 4, cmap + 4 + 8*u16(cmap + 2), 8):
        platform, encoding = u16(p), u16(p+2)
        if platform != 0 and not (platform == 3 and encoding in (1, 10)):
            continue
        base = cmap + u32(p+4)
        if u16(base) == 12:
            for q in range(base+16, base+16+12*u32(base+12), 12):
                first, last, glyph = struct.unpack_from('>III', raw, q)
                result.update(range(first + (glyph == 0), last+1))
        elif u16(base) == 4:
            count = u16(base+6)//2
            for i in range(count):
                end = u16(base+14+2*i)
                start = u16(base+16+2*count+2*i)
                delta = u16(base+16+4*count+2*i)
                address = base+16+6*count+2*i
                offset = u16(address)
                for cp in range(start, min(end, 65534)+1):
                    glyph = u16(address+offset+2*(cp-start)) if offset else cp
                    if (glyph + delta) % 65536 if (glyph or not offset) else 0:
                        result.add(cp)
    # Controls, surrogates and private marker codepoints cannot be card titles.
    return {cp for cp in result if cp >= 32 and cp != 127 and not 0xD800 <= cp <= 0xF8FF}


def export_template(source, destination):
    raw = source.read_bytes()
    parsed = validate_pf2(source)
    pos, metrics = 0, {}
    while raw[pos:pos+4] != b'DATA':
        tag = raw[pos:pos+4].decode()
        size = struct.unpack_from('>I', raw, pos+4)[0]
        if tag in ('ASCE', 'DESC', 'PTSZ'):
            metrics[tag] = struct.unpack_from('>H', raw, pos+8)[0]
        pos += 8+size
    lines = [f"FONT {metrics['ASCE']} {metrics['DESC']} {metrics['PTSZ']}"]
    for g in parsed['glyphs']:
        if g['codepoint'] < 0xE000:
            continue
        bits = raw[g['offset']+10:g['end']].hex() or '-'
        lines.append('G {} {} {} {} {} {} {}'.format(
            g['codepoint'], g['width'], g['height'], g['x_offset'],
            g['y_offset'], g['advance'], bits))
    destination.write_text('\n'.join(lines)+'\n')


def character_library(target, geometry):
    primary = codepoints(FONT_ROOT/'Inconsolata-Medium.ttf')
    fallback = codepoints(FONT_ROOT/'NotoSansJP-Regular.otf')
    characters = sorted(primary | fallback)
    sizes = sorted({size for card in geometry for size in card[4:]})
    with (target/'characters.gz').open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=9) as stream:
            def line(value):
                stream.write((value+'\n').encode('ascii'))
            for i, card in enumerate(geometry, 1):
                line('CARD ' + ' '.join(map(str, (i, *card))))
            for size in sizes:
                fonts = [ImageFont.truetype(str(FONT_ROOT/name), size)
                         for name in ('Inconsolata-Medium.ttf', 'NotoSansJP-Regular.otf')]
                for cp in characters:
                    font = fonts[0 if cp in primary else 1]
                    char = chr(cp)
                    left, top, right, bottom = font.getbbox(char, anchor='ls')
                    w, h = right-left, bottom-top
                    mask = Image.new('L', (w, h))
                    if w and h:
                        ImageDraw.Draw(mask).text((-left, -top), char, font=font, fill=255, anchor='ls')
                    # Byte-aligned character rows simplify portable awk composition.
                    bits = mask.point(lambda p: 255 if p >= 128 else 0, mode='1').tobytes().hex() or '-'
                    advance = round(font.getlength(char)*64)
                    line(f'G {size} {cp} {left} {top} {w} {h} {advance} {bits}')
    print(f'{target.name}: {len(characters)} characters, {len(sizes)} sizes, '
          f'{(target/"characters.gz").stat().st_size:,} compressed bytes', flush=True)


def build_profile(target, width, height):
    with tempfile.TemporaryDirectory(prefix='echelon-library-') as temporary:
        work = Path(temporary)
        ready = work/'ready'
        ready.mkdir()
        geometry = []
        for count in range(1, 5):
            output = work/f'count-{count}'
            output.mkdir()
            art = Artwork(width, height, output)
            art.spec['cards'] = art.spec['cards'][:count]
            for i, card in enumerate(art.spec['cards'], 1):
                node = art.nodes[f'entry-{i:02}-title-live-text']
                if count == 4:
                    x, baseline = float(node.get('x')), float(node.get('y'))
                    available = card['bounds'][0]+card['bounds'][2]-x-30
                    size = float(node.get('font-size'))*art.scale
                    geometry.append([round(x*art.scale), round(baseline*art.scale),
                                     int(available*art.scale), i-1,
                                     *[max(8, round(size*scale)) for scale in (1, .85, .7)]])
                node.text = ''
                art.nodes[f'entry-{i:02}-code-live-text'].text = f'ENTRY_{i:03}'
            rendered = build(art, 'library')
            (rendered/'theme.txt').write_text(centered_theme((rendered/'theme.txt').read_text(), width, height))
            variant = ready if count == 4 else ready/'variants'/str(count)
            variant.mkdir(parents=True, exist_ok=True)
            for name in ('background.png', 'foreground.png', 'theme.txt'):
                shutil.copyfile(rendered/name, variant/name)
            for key in ('labels', 'shapes', 'status', 'status-selected'):
                export_template(rendered/f'{key}.pf2', variant/f'{key}.data')
            if count == 4:
                # Entry fonts are assembled from the exported templates on install.
                for p in [rendered/'ui.pf2', *rendered.glob('timer-*.pf2')]:
                    shutil.copyfile(p, ready/p.name)
        (ready/'fonts').mkdir()
        (ready/'ui.pf2').rename(ready/'fonts/ui.pf2')
        if (width, height) != (1920, 1080):
            create_ui_font(ready/'fonts/plain.pf2', FONT_ROOT/'Inconsolata-Regular.ttf', 18)
        (ready/'framebuffer').write_text(f'{width}x{height}\n')
        (ready/'library-version').write_text('1\n')
        for name in ('Inconsolata-OFL.txt', 'NotoSansJP-LICENSE.txt'):
            shutil.copyfile(FONT_ROOT/name, ready/name)
        character_library(ready, geometry)
        (ready/'README.md').write_text(f'# T5 Echelon {target.name}\n\n'
            f'{width}×{height} canvas, centered on larger displays.\n'
            'Install through Sidonia. Real entry labels are assembled with shell and awk.\n'
            'Python, Pillow and rsvg-convert are used only to build release assets.\n')
        checksum(ready)
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(ready, target)
