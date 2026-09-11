#!/usr/bin/env python3
"""Build immutable Echelon menu assets from grub-mkconfig's current output."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def quote(value):
    if any(ord(c) < 32 for c in value):
        raise ValueError("Control characters in a menu title")
    return "'" + value.replace("'", "'\\''") + "'"


def entries_in(source):
    """Find literal top-level entry blocks without evaluating any GRUB code."""
    entries, pending = [], None
    depth, quoted, escaped, expansion = 0, None, False, 0
    offset = 0
    for line in source.splitlines(keepends=True):
        match = re.match(r'''\s*(menuentry|submenu)\s+('(?:[^']*)'|"(?:\\.|[^"\\])*"|[^\s{]+)''', line) if depth == 0 and quoted is None else None
        if match:
            raw = match[2]
            if '$' in raw or '\\' in raw or raw[0] not in "'\"":
                raise ValueError("A generated menu title is not a literal string")
            title = shlex.split(raw)[0]
            quote(title)
            pending = {"kind": match[1], "title": title, "index": len(entries),
                       "start": offset, "title_start": offset + match.start(2),
                       "title_end": offset + match.end(2)}
        for i, char in enumerate(line):
            if escaped:
                escaped = False
                continue
            if char == '\\' and quoted != "'":
                escaped = True
            elif quoted:
                if char == quoted:
                    quoted = None
            elif char in "'\"":
                quoted = char
            elif char == '#':
                break
            elif char == '{':
                if expansion or (i and line[i-1] == '$'):
                    expansion += 1
                else:
                    if depth == 0 and pending:
                        pending["body"] = offset + i + 1
                        header = source[pending["start"]:offset+i]
                        words = shlex.split(header)
                        pending["id"] = None
                        for j, word in enumerate(words):
                            if word.startswith('--id='):
                                pending["id"] = word[5:]
                            elif word in ('--id', '$menuentry_id_option', '${menuentry_id_option}') and j+1 < len(words):
                                pending["id"] = words[j+1]
                    depth += 1
            elif char == '}':
                if expansion:
                    expansion -= 1
                else:
                    depth -= 1
                    if depth == 0 and pending:
                        pending["end"] = offset + i + 1
                        entries.append(pending)
                        pending = None
        offset += len(line)
    if pending or depth != 0 or quoted:
        raise ValueError("Incomplete generated menu blocks")
    return entries


def native_sections(source):
    # Keep each generator's conditions and setup with its entries, while avoiding
    # a second execution of 00_header's saved-default and one-shot boot handling.
    sections = re.findall(r'^### BEGIN [^\n]+ ###\n.*?^### END [^\n]+ ###\n?', source, re.M | re.S)
    if sections:
        return '\n'.join(section for section in sections if entries_in(section))
    entries = entries_in(source)
    return '\n'.join(source[e['start']:e['end']] for e in entries)


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


def render_theme(output, width, height, entries, *, development=False):
    from PIL import ImageFont
    from render import Artwork, build
    output.mkdir(parents=True, exist_ok=True)
    art = Artwork(width, height, output)
    art.spec['cards'] = art.spec['cards'][:len(entries)]
    for i, entry in enumerate(entries, 1):
        card = art.spec['cards'][i-1]
        node = art.nodes[f'entry-{i:02}-title-live-text']
        font_size = float(node.get('font-size'))
        available = card['bounds'][0] + card['bounds'][2] - float(node.get('x')) - 30
        font = ImageFont.truetype(str(ROOT/'fonts/Inconsolata-Medium.ttf'), round(font_size))
        title = entry['title']
        scale = max(.70, min(1, available / max(1, font.getlength(title))))
        node.set('font-size', str(font_size * scale))
        # A full title remains in GRUB's menu and editor when the card must elide it.
        while len(title) > 1 and font.getlength(title) * scale > available:
            title = title[:-4] + '...' if title.endswith('...') else title[:-1] + '...'
        node.text = title
        card.update(title=entry['title'], code=f'ENTRY_{i:03}')
        art.nodes[f'entry-{i:02}-code-live-text'].text = card['code']
    namespace = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()[:12]
    theme = build(art, namespace, development=development)
    (theme/'theme.txt').write_text(centered_theme((theme/'theme.txt').read_text(), width, height))
    return theme


def graphics(theme, width):
    fonts = sorted(p.name for p in theme.glob('*.pf2') if p.name != 'ui.pf2') + ['ui.pf2']
    loads = '\n'.join(f'  if loadfont "$sidonia_theme_dir/{f}"; then true; else set sidonia_font_error=1; fi' for f in fonts)
    return f'''function sidonia_graphics {{
  terminal_output console
  insmod all_video
  insmod gfxterm
  insmod gfxmenu
  insmod png
  set sidonia_font_error=0
{loads}
  set gfxterm_font='Cascade UI {max(14, round(36*width/3840))}'
  export gfxterm_font
  set gfxmode=$sidonia_gfxmode,sidonia_no_auto_fallback
  export gfxmode
  set theme="$sidonia_theme_dir/theme.txt"
  export theme
  if [ "$sidonia_font_error" = 0 ]; then terminal_output gfxterm; else false; fi
}}
'''


def menu_source(native, entries, theme, width):
    edits = []
    remaps = []
    for i, entry in enumerate(entries):
        title, native_id = entry['title'], entry['id'] or entry['title']
        edits.append((entry['title_start'], entry['title_end'], quote(chr(0xE000+i)+' '+title)))
        if entry['id'] is None:
            edits.append((entry['body']-1, entry['body']-1, '--id='+quote(native_id)+' '))
        # GRUB passes the displayed title as $1. Restore its original value and
        # preserve all remaining positional arguments before the native body.
        prelude = '\n  shift\n  setparams '+quote(title)+' "$@"\n'
        if entry['kind'] == 'submenu':
            prelude += '  unset theme\n'
        edits.append((entry['body'], entry['body'], prelude))
        remaps.append(f'if [ "$default" = {quote(title)} ]; then set default={quote(native_id)}; fi')
        if entry['kind'] == 'submenu' and title != native_id:
            pattern = '^' + re.escape(title.replace('>', '>>')) + '>(.*)$'
            remaps.append(f'if regexp --set=1:sidonia_default_tail {quote(pattern)} "$default"; then '
                          f'set default={quote(native_id.replace(">", ">>") + ">")}"$sidonia_default_tail"; fi')
    for start, end, text in sorted(edits, reverse=True):
        native = native[:start] + text + native[end:]
    return (graphics(theme, width) + '''set default="$sidonia_system_default"
set config_directory="$sidonia_native_config_directory"
set config_file="$sidonia_native_config_file"
set timeout_style=menu
set timeout=6
if [ "$sidonia_original_timeout" = -1 ]; then set timeout=-1; fi
if [ "$sidonia_original_timeout" = 0 ]; then set timeout=0; fi
''' + '\n'.join(remaps) + '''
if sidonia_graphics; then
''' + native + '''
else
  set sidonia_original_menu=1
  export sidonia_original_menu
  configfile "$prefix/grub.cfg"
fi
''')


PLAIN = '''function sidonia_plain_menu {
  terminal_output console
  unset theme
  set gfxmode=auto
  if loadfont "$sidonia_base_dir/fonts/@PLAIN_FONT@"; then
    set gfxterm_font='Cascade UI 18'
  else
    loadfont "$prefix/fonts/unicode.pf2"
    set gfxterm_font='Unifont Regular 16'
  fi
  if terminal_output gfxterm; then true; else terminal_output console; fi
}
'''


def checksum(folder):
    (folder/'SHA256SUMS').write_text(''.join(
        f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(folder)}\n'
        for p in sorted(folder.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'))


def generate(theme, config, mode, *, development=False):
    width, height = map(int, (theme/'framebuffer').read_text().strip().split('x'))
    plain_font = 'ui.pf2' if (width, height) == (1920, 1080) else 'plain.pf2'
    prefix = f'''# Cascade entries generated from current GRUB configuration.
set sidonia_base_dir="$prefix/themes/{theme.name}"
export sidonia_base_dir
''' + PLAIN.replace('@PLAIN_FONT@', plain_font)
    try:
        native = native_sections(config)
        entries = entries_in(native)
    except ValueError:
        return prefix + '# Cascade conventional menu: titles are resolved at boot.\nsidonia_plain_menu\n'
    # BLS and external custom.cfg entries are populated by GRUB at boot. Keep
    # their complete native menu rather than guessing a card-to-entry mapping.
    if re.search(r'^\s*blscfg\b', config, re.M) or (theme.parent.parent/'custom.cfg').is_file():
        return prefix + '# Cascade conventional menu: entries are loaded at boot.\nsidonia_plain_menu\n'
    if not 1 <= len(entries) <= 4:
        return prefix + '# Cascade conventional menu: entry count exceeds card layout.\nsidonia_plain_menu\n'
    digest = hashlib.sha256(native.encode() + (theme/'framebuffer').read_bytes())
    if development:
        digest.update(b'with-development-output')
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            digest.update(path.read_bytes())
    generation = digest.hexdigest()[:20]
    target = theme/'generated'/generation
    if target.exists():
        subprocess.run(['sha256sum', '--quiet', '-c', 'SHA256SUMS'], cwd=target, check=True, stdout=sys.stderr)
    else:
        target.parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.cascade-', dir=target.parent) as temporary:
            work = Path(temporary)
            rendered = render_theme(work/'build', width, height, entries, development=development)
            staged = work/'ready'
            shutil.copytree(rendered, staged)
            (staged/'menu.cfg').write_text(menu_source(native, entries, staged, width))
            if development:
                (staged/'native.cfg').write_text(native)
                (staged/'entries.json').write_text(json.dumps(entries, indent=2, ensure_ascii=False)+'\n')
                shutil.copyfile(work/'build/layout.json', staged/'layout.json')
                shutil.copytree(work/'build/expected-previews', staged/'expected-previews')
            subprocess.run(['grub-script-check', str(staged/'menu.cfg')], check=True, stdout=sys.stderr)
            checksum(staged)
            staged.rename(target)
    # configfile opens an environment context. Keep variables referenced by
    # native entries, including values loaded from grubenv and one-shot boots.
    variables = sorted(set(re.findall(r'\$\{?([a-zA-Z_][a-zA-Z_0-9]*)', config)) |
                       set(re.findall(r'\bset\s+([a-zA-Z_][a-zA-Z_0-9]*)\s*=', config)))
    exports = '\n'.join('export '+name for name in variables)
    return prefix + f'''set sidonia_gfxmode={mode}
export sidonia_gfxmode
set sidonia_theme_dir="$sidonia_base_dir/generated/{generation}"
export sidonia_theme_dir
if [ "$sidonia_original_menu" = 1 ]; then
  sidonia_plain_menu
  set timeout_style=menu
  set timeout=-1
else
  {exports}
  set sidonia_native_config_directory="$config_directory"
  export sidonia_native_config_directory
  set sidonia_native_config_file="$config_file"
  export sidonia_native_config_file
  set sidonia_system_default="$default"
  export sidonia_system_default
  set sidonia_original_timeout="$timeout"
  export sidonia_original_timeout
  configfile "$sidonia_theme_dir/menu.cfg"
  sidonia_plain_menu
  set timeout_style=menu
  set timeout=-1
fi
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('theme', type=Path)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--mode', required=True)
    parser.add_argument('--development', action='store_true',
                        help='Also write reference screenshots and diagnostic metadata for local checks')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9]+x[0-9]+', args.mode):
        parser.error('A single numeric GRUB graphics mode is required')
    if args.config:
        config = args.config.read_text()
    elif stat.S_ISREG(os.fstat(1).st_mode):
        # grub-mkconfig redirects stdout to its candidate file before running
        # grub.d scripts. Reopening this descriptor for reading has its own offset.
        config = Path('/proc/self/fd/1').read_text()
    else:
        parser.exit(1, 'Echelon requires grub-mkconfig -o FILE so it can read the generated entries.\n')
    print(generate(args.theme.resolve(), config, args.mode, development=args.development))


if __name__ == '__main__':
    main()
