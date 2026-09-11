#!/usr/bin/env python3
"""Build Echelon's fixed artwork and font templates from the supplied SVG."""
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops

from pf2 import create_ui_font, empty_glyph, glyph, write_pf2

ROOT = Path(__file__).resolve().parent
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)


class Artwork:
    def __init__(self, width, height, output):
        self.width, self.height, self.output = width, height, output
        self.spec = json.loads((ROOT / "artwork/layout-spec.json").read_text())
        self.master = ET.parse(ROOT / "artwork/Gridcase-editable.svg").getroot()
        self.nodes = {e.get("id"): e for e in self.master.iter() if e.get("id")}
        self.scale = min(width / 3840, height / 2160)
        self.env = os.environ.copy()
        # Use only the bundled font files, with a cache inside this build.
        config = output / "fontconfig.xml"
        config.write_text(f'<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">'
                          f'<fontconfig><dir>{ROOT / "fonts"}</dir><cachedir>{output / "font-cache"}</cachedir></fontconfig>')
        self.env["FONTCONFIG_FILE"] = str(config)

    def parts(self, ids, fill=None, stroke=None, caption=None, status_width=None):
        result = []
        for name in ids:
            node = copy.deepcopy(self.nodes[name])
            for e in node.iter():
                if fill is not None and e.get("fill"):
                    e.set("fill", fill)
                if stroke is not None and e.get("stroke"):
                    e.set("stroke", stroke)
                if status_width and e.get("stroke-width"):
                    e.set("stroke-width", str(status_width))
                if caption is not None and e.tag == f"{{{NS}}}text":
                    e.text = f"AUTO BOOT // T-{caption:02}"
            result.append(node)
        return result

    def render(self, parts):
        root = ET.Element(f"{{{NS}}}svg", {"width":str(self.width),"height":str(self.height),
                                           "viewBox":"0 0 3840 2160", "fill":"none"})
        root.extend(parts)
        source = ET.tostring(root, encoding="utf-8")
        data = subprocess.run(["rsvg-convert"], input=source, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, env=self.env, check=True).stdout
        return Image.open(io.BytesIO(data)).convert("RGBA")

    def mask(self, parts):
        # Threshold alpha directly. Converting color to monochrome would erase black text.
        return self.render(parts).getchannel("A").point(lambda p: 255 if p >= 128 else 0, mode="1")


def menu(font, selected_font, color, selected_color, width, height, row_height):
    return f'''+ boot_menu {{
  left = 0
  top = 0
  width = {width}
  height = {height}
  item_height = {row_height}
  item_spacing = {1-row_height}
  item_padding = 0
  item_icon_space = 0
  icon_width = 0
  icon_height = 0
  scrollbar = false
  scrollbar_left_pad = 0
  scrollbar_right_pad = 0
  item_font = "{font}"
  selected_item_font = "{selected_font}"
  item_color = "{color}"
  selected_item_color = "{selected_color}"
}}
'''


def build(art, namespace):
    out = art.output.resolve()
    theme = out / "theme"
    theme.mkdir(parents=True, exist_ok=True)
    cards, colors = art.spec["cards"], art.spec["colors"]
    if not 1 <= len(cards) <= 4:
        raise ValueError("Echelon requires one to four entries")
    background_parts = art.parts(["background","grid","header","footer"])
    background_parts += art.parts([f"status-{i:02}-a" for i in range(1,len(cards)+1)])
    background_parts += art.parts([f"card{i:02}-ticks" for i in range(2,len(cards)+1)])
    background = art.render(background_parts)
    background.convert("RGB").save(theme / "background.png")
    foreground_parts = art.parts([c["surface"] for c in cards],fill="none")
    foreground_parts += art.parts(["card-edge-registration"])
    foreground = art.render(foreground_parts)
    foreground.save(theme / "foreground.png")
    masks = {k:[] for k in ("shapes","labels","status","status-selected")}
    for c in cards:
        masks["shapes"].append(art.mask(art.parts([c["surface"]],stroke="none")))
        masks["labels"].append(art.mask(art.parts([c["text"]]+c["rules"])))
        for key,width in (("status",3.28125),("status-selected",5.625)):
            masks[key].append(art.mask(art.parts(c["status"],status_width=width)))
    row_height = max(m.getbbox()[3]-i for group in masks.values() for i,m in enumerate(group))+2
    baseline = row_height-1
    if row_height+3 > art.height:
        raise ValueError("Glyphs do not fit this profile's menu viewport")
    fonts = {}
    for key,group in masks.items():
        fonts[key] = "Cascade " + namespace + " " + key + " 16"
        glyphs = {cp:empty_glyph() for cp in range(32,127)}
        for i,mask in enumerate(group):
            l,t,r,b = mask.getbbox()
            glyphs[cards[i]["marker"]] = glyph(mask.crop((l,t,r,b)),l,baseline-(t-i)-(b-t),0)
        write_pf2(theme / f"{key}.pf2",fonts[key],glyphs,baseline,1,16)
    uiname, _ = create_ui_font(theme / "ui.pf2",ROOT / "fonts/Inconsolata-Regular.ttf",max(14,round(36*art.scale)))
    # Three timeout glyph layers preserve the original fill, ink and detail colors.
    timer_parts = {}
    for remaining in range(7):
        lit = [c for c in art.spec["timer_cells"] if c["id"]<=remaining]
        empty = [c for c in art.spec["timer_cells"] if c["id"]>remaining]
        parts = {
            "timer-fill":art.parts([c["surface"] for c in lit],stroke="none"),
            "timer-ink":art.parts([c["label"] for c in lit]),
            "timer-detail":art.parts([c["surface"] for c in art.spec["timer_cells"]],fill="none") +
                art.parts([f"Vector_{i}" for i in range(297,302)]+["Vector_308","timer-end-ticks"]) +
                art.parts([c["label"] for c in empty]) + art.parts(["countdown-live-caption"],caption=remaining)}
        for c in lit:
            parts["timer-ink"] += art.parts([f"Vector_{308-c['id']}"])
        timer_parts[remaining] = {k:art.mask(v) for k,v in parts.items()}
    union = Image.new("1",(art.width,art.height))
    for state in timer_parts.values():
        for mask in state.values():
            union = ImageChops.lighter(union,mask)
    l,t,r,b = union.getbbox()
    timer_components = ""
    for key,color in (("timer-ink",colors["ink"]),("timer-detail",colors["detail"]),("timer-fill",colors["card"])):
        name = "Cascade " + namespace + " " + key + " 16"
        glyphs = {cp:empty_glyph() for cp in range(32,127)}
        for remaining,state in timer_parts.items():
            glyphs[ord(str(remaining))] = glyph(state[key].crop((l,t,r,b)),0,-1,r-l)
        write_pf2(theme / f"{key}.pf2",name,glyphs,b-t-1,1,16)
        timer_components += f'''+ label {{
  id = "__timeout__"
  left = {l}
  top = {t}
  width = {r-l}
  height = {b-t}
  text = "%d"
  font = "{name}"
  color = "{color}"
}}
'''
    # GRUB paints canvas children in reverse declaration order.
    themetxt = f'''desktop-image: "background.png"
desktop-image-scale-method: "stretch"
title-text: ""
message-font: "{uiname}"
terminal-font: "{uiname}"
{timer_components}
'''
    themetxt += menu(fonts["labels"],fonts["labels"],colors["ink"],colors["detail"],art.width,art.height,row_height)
    themetxt += menu(fonts["status"],fonts["status-selected"],colors["detail"],colors["status_selected"],art.width,art.height,row_height)
    themetxt += f'''+ image {{
  left = 0
  top = 0
  width = {art.width}
  height = {art.height}
  file = "foreground.png"
}}
'''
    themetxt += menu(fonts["shapes"],fonts["shapes"],colors["card"],colors["selected"],art.width,art.height,row_height)
    (theme / "theme.txt").write_text(themetxt)
    return theme
