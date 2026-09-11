#!/usr/bin/env python3
"""Prebuild Echelon's three canvases and character libraries for shell installation."""
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'lib/cascade'))
from render import Artwork
from echelon_library import build_profile

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
        build_profile(target, width, height)
        print(target)
    build_preview()


if __name__ == '__main__':
    main()
