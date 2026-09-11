#!/usr/bin/env python3
"""Package the three Echelon canvases. GRUB entry artwork is generated on install."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'lib/cascade'))
from runtime import checksum, render_theme
from pf2 import create_ui_font
from render import Artwork

PROFILES = {'720p': (1280,720), '1080p': (1920,1080), '1440p': (2560,1440)}


def build_preview():
    # Keep the supplied example cards and selection. Share only the current
    # title with the runtime artwork, so a host's entries never enter the preview.
    original = ET.parse(ROOT/'design/cascade/Gridcase-original.svg').getroot()
    with tempfile.TemporaryDirectory(prefix='sidonia-preview-') as temp:
        artwork = Artwork(2560, 1440, Path(temp))
        header = next(node for node in original.iter() if node.get('id') == 'header-title')
        header[:] = list(artwork.nodes['header-title'])
        preview = ROOT/'previews/T5.png'
        artwork.render(list(original)).convert('RGB').save(preview)
        print(preview)


def main():
    for profile, (width, height) in PROFILES.items():
        target = ROOT/'themes/T5'/profile
        with tempfile.TemporaryDirectory(prefix='sidonia-canvas-') as temp:
            source = render_theme(Path(temp), width, height, [{'title': f'Boot entry {i}'} for i in range(1,5)])
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)
        (target/'fonts').mkdir()
        (target/'ui.pf2').rename(target/'fonts/ui.pf2')
        if profile != '1080p':
            create_ui_font(target/'fonts/plain.pf2', ROOT/'lib/cascade/fonts/Inconsolata-Regular.ttf', 18)
        (target/'framebuffer').write_text(f'{width}x{height}\n')
        (target/'cascade.json').write_text(json.dumps({'version': 2, 'profile': profile, 'canvas': [width,height],
                                                     'entries': 'discovered by grub-mkconfig'}, indent=2)+'\n')
        for license in ['Inconsolata-OFL.txt', 'NotoSansJP-LICENSE.txt']:
            shutil.copyfile(ROOT/'lib/cascade/fonts'/license, target/license)
        (target/'README.md').write_text(f'# T5 Echelon {profile}\n\nFixed {width}×{height} canvas, centered with black padding.\n'
                                      'Install with Sidonia to generate the cards from your actual GRUB entries.\n'
                                      'Entry artwork refreshes each time grub-mkconfig writes a configuration file.\n')
        checksum(target)
        print(target)
    build_preview()


if __name__ == '__main__':
    main()
