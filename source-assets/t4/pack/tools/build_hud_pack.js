#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const WORKSPACE = process.cwd();
const PACK = path.join(WORKSPACE, "t4_f3_expanded_hud_asset_pack");
const SOURCE = path.join(WORKSPACE, "upload", "T4-F(3).png");
const AI_MASTERS = [
  ["structural-components.png", path.join(WORKSPACE, "generated_images", "exec-ba3ec843-a8cf-4373-9282-ae9b10cb2b9a.png")],
  ["icons-micrographics.png", path.join(WORKSPACE, "generated_images", "exec-a1dc8ae4-4d56-4e56-a61b-7ad2cd66c05c.png")],
  ["diagnostics-overlays.png", path.join(WORKSPACE, "generated_images", "exec-05b35e31-5be0-4242-991b-afb501c2b788.png")]
];

const C = {
  black: "#000000",
  ink: "#191918",
  white: "#FEFEFD",
  whiteLow: "#F6F6F5",
  gray200: "#D1D1D1",
  gray350: "#AFAFAF",
  gray500: "#909090",
  gray650: "#6D6D6D",
  gray750: "#505050",
  red: "#D51F1D",
  redDark: "#A4130F",
  redSignal: "#EE1006",
  yellow: "#FFC601"
};

const FONT = "DejaVu Sans Mono, monospace";
const assets = [];
const assetMap = new Map();
const scales = [1, 2, 4];

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function attrs(o) {
  return Object.entries(o).filter(function(kv) { return kv[1] !== undefined && kv[1] !== null; }).map(function(kv) {
    return " " + kv[0] + "=\"" + esc(kv[1]) + "\"";
  }).join("");
}
function tag(name, a, body) { return "<" + name + attrs(a || {}) + ">" + (body || "") + "</" + name + ">"; }
function emptyTag(name, a) { return "<" + name + attrs(a || {}) + "/>"; }
function group(body, a) { return tag("g", a || {}, body); }
function rect(x, y, w, h, fill, stroke, sw, rx) {
  return emptyTag("rect", { x: x, y: y, width: w, height: h, rx: rx || 0, fill: fill || "none", stroke: stroke || "none", "stroke-width": sw || 0, "vector-effect": "non-scaling-stroke" });
}
function line(x1, y1, x2, y2, stroke, sw, extra) {
  return emptyTag("line", Object.assign({ x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke || C.white, "stroke-width": sw || 1, "stroke-linecap": "square", "vector-effect": "non-scaling-stroke" }, extra || {}));
}
function pathEl(d, fill, stroke, sw, extra) {
  return emptyTag("path", Object.assign({ d: d, fill: fill || "none", stroke: stroke || "none", "stroke-width": sw || 0, "stroke-linejoin": "miter", "stroke-linecap": "square", "vector-effect": "non-scaling-stroke" }, extra || {}));
}
function circle(cx, cy, r, fill, stroke, sw) {
  return emptyTag("circle", { cx: cx, cy: cy, r: r, fill: fill || "none", stroke: stroke || "none", "stroke-width": sw || 0, "vector-effect": "non-scaling-stroke" });
}
function polygon(points, fill, stroke, sw) {
  return emptyTag("polygon", { points: points, fill: fill || "none", stroke: stroke || "none", "stroke-width": sw || 0, "stroke-linejoin": "miter", "vector-effect": "non-scaling-stroke" });
}
function textEl(x, y, str, size, color, anchor, weight, extra) {
  const a = Object.assign({
    x: x, y: y, fill: color || C.white, "font-family": FONT,
    "font-size": size || 16, "font-weight": weight || 400,
    "text-anchor": anchor || "start", "letter-spacing": Math.max(0.5, (size || 16) * 0.055)
  }, extra || {});
  return tag("text", a, esc(str));
}
function chamferPath(x, y, w, h, c) {
  return "M " + (x + c) + " " + y + " H " + (x + w - c) + " L " + (x + w) + " " + (y + c) +
    " V " + (y + h - c) + " L " + (x + w - c) + " " + (y + h) + " H " + (x + c) +
    " L " + x + " " + (y + h - c) + " V " + (y + c) + " Z";
}
function slashBand(x, y, count, color, sw, gap, height) {
  let s = "";
  const w = sw || 12, g = gap || 7, h = height || 24;
  for (let i = 0; i < count; i++) {
    const xx = x + i * (w + g);
    s += polygon((xx + w) + "," + y + " " + (xx + 2 * w) + "," + y + " " + (xx + w) + "," + (y + h) + " " + xx + "," + (y + h), color, "none", 0);
  }
  return s;
}
function fastener(cx, cy, color, symbol) {
  let s = circle(cx, cy, 10, C.white, color, 2) + circle(cx, cy, 3, "none", color, 1.5);
  if (symbol === "plus") s += line(cx - 5, cy, cx + 5, cy, color, 2) + line(cx, cy - 5, cx, cy + 5, color, 2);
  if (symbol === "target") s += circle(cx, cy, 5, "none", color, 1.5) + circle(cx, cy, 1.4, color, "none", 0);
  return s;
}
function keycapFrame(w, h) {
  return rect(6, 6, w - 12, h - 12, "none", C.white, 2, 4);
}
function arrowUpDown(x, y, color) {
  const c = color || C.white;
  return line(x, y + 26, x, y - 10, c, 3) + polygon((x - 7) + "," + (y - 4) + " " + x + "," + (y - 14) + " " + (x + 7) + "," + (y - 4), c) +
    line(x + 20, y - 14, x + 20, y + 22, c, 3) + polygon((x + 13) + "," + (y + 16) + " " + (x + 20) + "," + (y + 26) + " " + (x + 27) + "," + (y + 16), c);
}
function enterArrow(x, y, color) {
  const c = color || C.white;
  return pathEl("M " + (x + 30) + " " + (y - 16) + " V " + (y + 8) + " H " + x, "none", c, 3) +
    polygon((x + 8) + "," + y + " " + x + "," + (y + 8) + " " + (x + 8) + "," + (y + 16), c);
}
function dotMatrix(x, y, cols, rows, gap, r, color) {
  let s = "";
  for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) {
    s += circle(x + xx * gap, y + yy * gap, r, color || C.white, "none", 0);
  }
  return s;
}
function barcode(x, y, w, h, color, seed) {
  const pattern = [2,1,1,3,1,2,2,1,3,1,1,2,1,1,3,2,1,2,1,3,1,1,2,2,1,3,1,2,1,1,3,1,2,2,1,1,3,2,1,2,1,1,2,3];
  let total = pattern.reduce(function(a,b) { return a+b; }, 0);
  let scale = w / total;
  let xx = x;
  let s = "";
  for (let i = 0; i < pattern.length; i++) {
    const bw = pattern[(i + (seed || 0)) % pattern.length] * scale;
    if (i % 2 === 0) s += rect(xx, y, Math.max(1, bw), h, color || C.white);
    xx += bw;
  }
  return s;
}
function hatch(x, y, w, h, color) {
  let s = rect(0, 0, w, h, "none", color, 1);
  for (let i = -h; i < w + h; i += 8) s += line(i, h, i + h, 0, color, 2);
  return tag("svg", { x: x, y: y, width: w, height: h, viewBox: "0 0 " + w + " " + h, overflow: "hidden" }, s);
}
function tickRuler(x, y, w, count, color, redMarker) {
  let s = line(x, y, x + w, y, color || C.gray200, 1);
  for (let i = 0; i <= count; i++) {
    const xx = x + w * i / count;
    const len = i % 10 === 0 ? 18 : (i % 5 === 0 ? 12 : 7);
    s += line(xx, y - len / 2, xx, y + len / 2, color || C.gray200, 1);
  }
  s += line(x + w - 12, y - 14, x + w - 12, y + 14, C.white, 2);
  s += line(x + w - 22, y, x + w - 2, y, C.white, 2);
  if (redMarker) s += line(x + w * 0.80, y, x + w * 0.88, y, C.redSignal, 6);
  return s;
}
function svgDoc(a, inner, scale) {
  const sw = a.w * scale, sh = a.h * scale;
  const defs = "<defs><clipPath id=\"clip-hatch\"><rect x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"/></clipPath></defs>";
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + sw + "\" height=\"" + sh + "\" viewBox=\"0 0 " + a.w + " " + a.h + "\" shape-rendering=\"geometricPrecision\">" +
    defs + inner + "</svg>";
}
function addAsset(id, category, w, h, description, draw, options) {
  const a = Object.assign({ id: id, category: category, w: w, h: h, description: description, draw: draw, sourceRect: null, blankBehavior: "structure-only" }, options || {});
  assets.push(a);
  assetMap.set(id, a);
}
function embed(id, variant, x, y, sx, sy) {
  const a = assetMap.get(id);
  if (!a) throw new Error("Unknown embedded asset " + id);
  return group(a.draw(variant), { transform: "translate(" + x + " " + y + ") scale(" + (sx || 1) + " " + (sy || sx || 1) + ")" });
}

function clampRailDetailed(w, y, color, detailed) {
  let s = pathEl("M 12 " + y + " L 22 " + (y - 8) + " H " + (w - 18) + " L " + (w - 10) + " " + y + " L " + (w - 18) + " " + (y + 16) + " H 22 L 12 " + (y + 8) + " Z", C.white, C.black, 2);
  if (detailed) {
    s += fastener(26, y + 4, C.black, "target") + fastener(w - 26, y + 4, C.black, "target");
    s += line(132, y - 4, 144, y + 8, C.black, 2) + line(w - 144, y + 8, w - 132, y - 4, C.black, 2);
  }
  return s;
}

function drawActiveSelector(variant) {
  let s = clampRailDetailed(1216, 16, C.white, variant === "labeled");
  s += rect(18, 40, 1186, 80, C.white, C.black, 2);
  s += pathEl("M 18 40 H 154 V 120 H 18 Z", C.red, C.black, 2);
  s += clampRailDetailed(1216, 136, C.white, variant === "labeled");
  if (variant === "labeled") {
    s += textEl(85, 96, "01", 48, C.white, "middle", 400);
    s += textEl(216, 91, "PRIMARY SYSTEM", 30, C.black, "start", 400);
    s += textEl(970, 88, "SELECTED", 16, C.black, "start", 700);
    s += slashBand(1068, 70, 5, C.black, 10, 5, 28);
    s += polygon("1198,80 1208,72 1208,88", C.redSignal);
  }
  return s;
}

function drawInactiveSelector(number, label, variant) {
  let s = rect(18, 0, 1186, 112, C.black, "none", 0);
  s += rect(18, 0, 136, 112, C.black, C.gray500, 1);
  s += line(18, 110, 1204, 110, C.gray200, 1);
  if (variant === "labeled") {
    s += textEl(86, 73, number, 44, C.gray500, "middle", 400);
    s += textEl(216, 67, label, 29, C.whiteLow, "start", 400);
    s += dotMatrix(1118, 62, 4, 2, 14, 1.2, C.gray200);
  }
  return s;
}

addAsset("active-selector", "selectors", 1216, 160, "Complete selected menu row with clamps, red index tab and status.", drawActiveSelector, {
  sourceRect: [604, 318, 1216, 157], nineSlice: { left: 168, right: 96, top: 32, bottom: 32 }
});
addAsset("inactive-selector-02", "selectors", 1216, 112, "Inactive row 02 / ADVANCED OPTIONS.", function(v) { return drawInactiveSelector("02", "ADVANCED OPTIONS", v); }, { sourceRect: [636, 470, 1140, 110], nineSlice: { left: 164, right: 80, top: 8, bottom: 8 } });
addAsset("inactive-selector-03", "selectors", 1216, 112, "Inactive row 03 / MEMORY TEST.", function(v) { return drawInactiveSelector("03", "MEMORY TEST", v); }, { sourceRect: [636, 581, 1140, 111] });
addAsset("inactive-selector-04", "selectors", 1216, 112, "Inactive row 04 / UEFI FIRMWARE.", function(v) { return drawInactiveSelector("04", "UEFI FIRMWARE", v); }, { sourceRect: [636, 693, 1140, 112] });
addAsset("inactive-selector-generic", "selectors", 1216, 112, "Generic inactive row; blank is ready for custom labels.", function(v) { return drawInactiveSelector("00", "OPTION LABEL", v); });
addAsset("number-tab-active", "selectors", 144, 96, "Red active number tab.", function(v) {
  let s = pathEl(chamferPath(8, 8, 128, 80, 8), C.red, C.black, 2);
  if (v === "labeled") s += textEl(72, 65, "01", 44, C.white, "middle");
  return s;
});
addAsset("number-tab-inactive", "selectors", 144, 96, "Black inactive number tab.", function(v) {
  let s = pathEl(chamferPath(8, 8, 128, 80, 8), C.black, C.gray500, 2);
  if (v === "labeled") s += textEl(72, 65, "02", 44, C.gray500, "middle");
  return s;
});
addAsset("selected-status", "selectors", 248, 56, "SELECTED status word, hazard slashes, and pointer.", function(v) {
  if (v === "blank") return "";
  return textEl(8, 34, "SELECTED", 16, C.white, "start", 700) + slashBand(116, 14, 5, C.white, 9, 5, 26) + polygon("232,28 244,18 244,38", C.redSignal);
}, { blankBehavior: "transparent-placeholder" });
addAsset("side-index-stack", "selectors", 112, 480, "Vertical 01–04 rail index stack.", function(v) {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += line(12, 24 + i * 112, 92, 24 + i * 112, C.redDark, 1);
    if (v === "labeled") s += textEl(56, 62 + i * 112, "0" + (i + 1), 18, C.white, "middle", 700);
  }
  return s;
});
addAsset("menu-stack", "selectors", 1216, 512, "Full four-row menu stack.", function(v) {
  return rect(0, 0, 1216, 512, C.black) +
    embed("active-selector", v, 0, 0, 1) +
    group(drawInactiveSelector("02", "ADVANCED OPTIONS", v), { transform: "translate(0 160)" }) +
    group(drawInactiveSelector("03", "MEMORY TEST", v), { transform: "translate(0 272)" }) +
    group(drawInactiveSelector("04", "UEFI FIRMWARE", v), { transform: "translate(0 384)" });
});

addAsset("clamp-rail", "frames", 1216, 40, "Stretchable white selector clamp rail.", function(v) { return clampRailDetailed(1216, 12, C.white, v === "labeled"); }, {
  nineSlice: { left: 160, right: 80, top: 8, bottom: 8 }
});
addAsset("row-divider", "frames", 1216, 24, "Long thin row divider.", function(v) {
  let s = line(8, 12, 1208, 12, C.gray200, 1);
  if (v === "labeled") s += line(8, 7, 8, 17, C.white, 2) + line(1208, 7, 1208, 17, C.white, 2);
  return s;
});
addAsset("corner-bracket", "frames", 112, 112, "Angular clipped corner bracket.", function(v) {
  let s = pathEl("M 16 96 V 38 L 38 16 H 96", "none", C.white, 2);
  if (v === "labeled") s += pathEl("M 24 96 V 44 L 44 24 H 96", "none", C.gray500, 1) + line(36, 28, 48, 16, C.black, 3);
  return s;
});
addAsset("left-panel-frame", "frames", 505, 1152, "Full-height left maintenance panel frame.", function(v) {
  let s = rect(1, 1, 503, 1150, "none", C.black, 2);
  s += pathEl("M 336 0 V 118 L 292 162 V 292 L 334 338 V 608 L 280 680 V 828 L 388 898 V 1152", "none", C.black, 2);
  s += line(388, 898, 476, 898, C.black, 2);
  if (v === "labeled") {
    s += fastener(42, 44, C.black, "target") + fastener(470, 44, C.black, "plus");
    s += fastener(450, 980, C.black, "target") + fastener(470, 1108, C.black, "plus");
  }
  return s;
}, { sourceRect: [0, 0, 505, 1152] });
addAsset("service-rail-frame", "frames", 180, 1152, "Full red service rail with angular reliefs.", function(v) {
  let s = rect(0, 0, 180, 1152, C.red, C.black, 2);
  s += pathEl("M 178 0 V 174 L 136 190 V 242 L 178 258 V 856 L 138 820 V 798 L 112 774 V 374 L 126 360 V 324 L 178 286", "none", C.redDark, 4);
  s += line(10, 104, 170, 104, C.black, 2) + line(10, 890, 28, 890, C.redDark, 2);
  if (v === "labeled") {
    s += slashBand(42, 52, 3, C.white, 15, 6, 28);
    s += hatch(40, 1018, 58, 86, C.black);
  }
  return s;
}, { sourceRect: [505, 0, 180, 1152], nineSlice: { left: 36, right: 36, top: 128, bottom: 128 } });
addAsset("diagnostic-strip-frame", "frames", 224, 1152, "Right diagnostic strip frame and separators.", function(v) {
  let s = rect(1, 1, 222, 1150, C.black, C.white, 1);
  [108, 421, 660, 804, 1062].forEach(function(y) { s += line(18, y, 222, y, C.gray200, 1); });
  s += pathEl("M 0 108 H 145 L 190 64 H 222", "none", C.white, 2);
  s += pathEl("M 0 660 H 138 L 150 668 H 222", "none", C.white, 2);
  if (v === "labeled") s += fastener(28, 150, C.white, "plus") + fastener(3, 108, C.white, "target");
  return s;
}, { sourceRect: [1824, 0, 224, 1152] });
addAsset("header-frame", "frames", 1139, 104, "Main workspace header rule and end stop.", function(v) {
  let s = line(8, 102, 1131, 102, C.gray200, 1);
  if (v === "labeled") s += tickRuler(420, 76, 680, 48, C.gray200, true);
  return s;
}, { sourceRect: [685, 0, 1139, 104] });
addAsset("footer-frame", "frames", 1070, 240, "Footer boundary and command area frame.", function(v) {
  let s = line(0, 4, 1068, 4, C.gray200, 1) + line(0, 154, 1068, 154, C.gray200, 1);
  if (v === "labeled") s += line(0, 204, 1068, 204, C.gray200, 1);
  return s;
});
addAsset("rail-latch", "frames", 84, 152, "Angular red rail latch/bracket.", function(v) {
  let s = pathEl("M 74 8 L 20 28 V 54 L 8 66 V 88 L 20 100 V 124 L 74 144", "none", C.redDark, 4);
  if (v === "labeled") s += pathEl("M 68 18 L 30 34 V 48 L 18 66 V 88 L 30 106 V 118 L 68 134", "none", C.black, 2);
  return s;
});

addAsset("brand-triple-slash", "icons", 112, 64, "Three-bar white rail emblem.", function(v) { return v === "labeled" ? slashBand(18, 18, 3, C.white, 18, 6, 28) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("hazard-five-slash", "icons", 144, 64, "Five-bar hazard emphasis mark.", function(v) { return v === "labeled" ? slashBand(14, 18, 5, C.white, 14, 6, 28) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("fastener-plus", "icons", 64, 64, "Circular fastener with plus insert.", function(v) { return fastener(32, 32, C.white, v === "labeled" ? "plus" : null); });
addAsset("fastener-target", "icons", 64, 64, "Circular target/pivot fastener.", function(v) { return fastener(32, 32, C.white, v === "labeled" ? "target" : null); });
addAsset("registration-crosshair", "icons", 64, 64, "Four-way registration crosshair.", function(v) {
  if (v === "blank") return "";
  return line(32, 8, 32, 56, C.white, 1) + line(8, 32, 56, 32, C.white, 1) + circle(32, 32, 4, C.black, C.white, 1);
}, { blankBehavior: "transparent-placeholder" });
addAsset("warning-triangle", "icons", 72, 72, "Yellow maintenance warning triangle.", function(v) {
  let s = polygon("36,8 66,62 6,62", C.yellow, C.black, 3);
  if (v === "labeled") s += line(36, 25, 36, 44, C.black, 5, { "stroke-linecap": "round" }) + circle(36, 53, 3, C.black);
  return s;
});
function pointerAsset(points, fill, stroke) {
  return function(v) { return v === "labeled" ? polygon(points, fill, stroke || "none", stroke ? 2 : 0) : ""; };
}
addAsset("pointer-red-right", "icons", 40, 40, "Signal-red right pointer.", pointerAsset("10,7 30,20 10,33", C.redSignal), { blankBehavior: "transparent-placeholder" });
addAsset("pointer-red-down", "icons", 40, 40, "Signal-red down pointer.", pointerAsset("7,10 33,10 20,30", C.redSignal), { blankBehavior: "transparent-placeholder" });
addAsset("pointer-white-down", "icons", 40, 40, "White down pointer.", pointerAsset("7,10 33,10 20,30", C.white), { blankBehavior: "transparent-placeholder" });
addAsset("pointer-gray-down", "icons", 40, 40, "Gray down pointer.", pointerAsset("7,10 33,10 20,30", C.gray500), { blankBehavior: "transparent-placeholder" });
addAsset("pointer-outline-down", "icons", 40, 40, "Outlined down pointer.", pointerAsset("7,10 33,10 20,30", "none", C.white), { blankBehavior: "transparent-placeholder" });
addAsset("cable-coil", "icons", 104, 88, "Coiled cable/vent micro-icon.", function(v) {
  if (v === "blank") return "";
  let s = "";
  for (let i = 0; i < 6; i++) s += rect(10, 10 + i * 11, 78, 8, "none", C.white, 1.5, 4);
  return s;
}, { blankBehavior: "transparent-placeholder" });
addAsset("angular-connector", "icons", 72, 104, "Angular cable connector glyph.", function(v) {
  if (v === "blank") return "";
  return pathEl("M 56 8 L 30 24 V 78 L 56 94", "none", C.white, 3) + line(46, 17, 60, 8, C.black, 4) + line(46, 85, 60, 94, C.black, 4);
}, { blankBehavior: "transparent-placeholder" });
addAsset("lock-hatch", "icons", 80, 80, "Diagonal lock hatch tile.", function(v) {
  let s = rect(8, 8, 64, 64, "none", C.redSignal, 1);
  if (v === "labeled") s += hatch(8, 8, 64, 64, C.black);
  return s;
});

addAsset("keycap-up-down", "controls", 96, 72, "Up/down navigation keycap.", function(v) { return keycapFrame(96, 72) + (v === "labeled" ? arrowUpDown(36, 36, C.white) : ""); });
addAsset("keycap-enter", "controls", 96, 72, "Return/enter keycap.", function(v) { return keycapFrame(96, 72) + (v === "labeled" ? enterArrow(32, 36, C.white) : ""); });
addAsset("keycap-e", "controls", 72, 72, "E edit keycap.", function(v) { return keycapFrame(72, 72) + (v === "labeled" ? textEl(36, 50, "E", 34, C.white, "middle") : ""); });
addAsset("keycap-c", "controls", 72, 72, "C console keycap.", function(v) { return keycapFrame(72, 72) + (v === "labeled" ? textEl(36, 50, "C", 34, C.white, "middle") : ""); });
addAsset("control-select", "controls", 240, 72, "SELECT command control.", function(v) {
  let s = group(keycapFrame(72, 72), { transform: "translate(0 0)" });
  if (v === "labeled") s += arrowUpDown(25, 36, C.white) + textEl(90, 48, "SELECT", 24, C.white);
  return s;
});
addAsset("control-enter-boot", "controls", 320, 72, "ENTER BOOT command control.", function(v) {
  let s = keycapFrame(96, 72);
  if (v === "labeled") s += enterArrow(32, 36, C.white) + textEl(116, 48, "ENTER BOOT", 24, C.white);
  return s;
});
addAsset("control-edit", "controls", 200, 72, "EDIT command control.", function(v) {
  let s = keycapFrame(72, 72);
  if (v === "labeled") s += textEl(36, 50, "E", 34, C.white, "middle") + textEl(92, 48, "EDIT", 24, C.white);
  return s;
});
addAsset("control-console", "controls", 240, 72, "CONSOLE command control.", function(v) {
  let s = keycapFrame(72, 72);
  if (v === "labeled") s += textEl(36, 50, "C", 34, C.white, "middle") + textEl(92, 48, "CONSOLE", 24, C.white);
  return s;
});

for (let d = 0; d <= 9; d++) {
  addAsset("digit-" + d, "countdown", 64, 80, "Reusable condensed display digit " + d + ".", function(v) {
    return v === "labeled" ? textEl(32, 62, String(d), 58, C.white, "middle", 400) : "";
  }, { blankBehavior: "transparent-placeholder", expanded: true });
}
["01", "02", "03", "04"].forEach(function(n) {
  addAsset("count-" + n, "countdown", 128, 80, "Visible two-digit preset " + n + ".", function(v) {
    return v === "labeled" ? textEl(64, 62, n, 58, n === "01" ? C.white : C.gray500, "middle", 400) : "";
  }, { blankBehavior: "transparent-placeholder" });
});
addAsset("countdown-t06", "countdown", 176, 64, "AUTO BOOT countdown fragment T-06.", function(v) {
  return v === "labeled" ? textEl(88, 46, "T-06", 34, C.redSignal, "middle", 400) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [958, 48, 112, 40] });
addAsset("header-auto-boot", "countdown", 424, 72, "AUTO BOOT // T-06 header label.", function(v) {
  if (v === "blank") return "";
  return textEl(12, 48, "AUTO BOOT //", 28, C.white, "start") + textEl(286, 48, "T-06", 28, C.redSignal, "start");
}, { blankBehavior: "transparent-placeholder" });
addAsset("vertical-id-a63", "countdown", 96, 256, "Vertical maintenance ID A-63.", function(v) {
  return v === "labeled" ? textEl(0, 0, "A-63", 54, C.black, "middle", 400, { transform: "translate(56 210) rotate(-90)" }) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [350, 354, 92, 224] });
["01", "02", "03", "04"].forEach(function(n) {
  addAsset("small-index-" + n, "countdown", 64, 48, "Small service-rail index " + n + ".", function(v) {
    return v === "labeled" ? textEl(32, 33, n, 18, C.white, "middle", 700) : "";
  }, { blankBehavior: "transparent-placeholder" });
});

addAsset("top-ruler", "scrollbars", 768, 56, "Header tick ruler with red active segment.", function(v) {
  return tickRuler(12, 28, 744, 56, C.gray200, v === "labeled");
}, { nineSlice: { left: 32, right: 32, top: 8, bottom: 8 }, sourceRect: [1108, 58, 678, 40] });
addAsset("bottom-scrollbar", "scrollbars", 1050, 72, "Bottom scrollbar/timeline with thumbs and down marker.", function(v) {
  let s = line(8, 18, 1042, 18, C.gray200, 1);
  for (let i = 0; i < 16; i++) s += line(8 + i * 66, 24, 8 + i * 66, 34, C.gray200, 1);
  s += line(8, 4, 8, 24, C.gray200, 2) + line(1042, 4, 1042, 24, C.gray200, 2);
  if (v === "labeled") {
    s += rect(670, 28, 22, 6, C.gray200) + rect(810, 28, 22, 6, C.gray200) + rect(938, 28, 62, 6, C.gray200);
    s += polygon("506,46 522,46 514,60", C.gray500);
  }
  return s;
}, { nineSlice: { left: 48, right: 48, top: 8, bottom: 8 }, sourceRect: [748, 1034, 1004, 72] });
function gaugeDraw(name, variant) {
  let s = line(22, 72, 22, 350, C.white, 2);
  for (let i = 0; i <= 12; i++) {
    const yy = 72 + i * 23;
    s += line(22, yy, 30 + (i % 6 === 0 ? 8 : 0), yy, C.white, 1);
  }
  s += polygon("16,338 28,350 16,362", C.white);
  if (variant === "labeled") {
    s += textEl(16, 38, name, 18, C.white, "start", 700);
    s += rect(76, 17, 44, 28, C.gray200, C.white, 1);
    s += textEl(98, 38, "OK", 16, C.black, "middle", 700);
    s += textEl(38, 88, "-100", 13, C.white);
    s += textEl(38, 202, "50", 13, C.white);
    s += textEl(38, 350, "00", 13, C.white);
  }
  return s;
}
addAsset("gauge-temp", "scrollbars", 128, 384, "TEMP vertical diagnostic gauge.", function(v) { return gaugeDraw("TEMP", v); }, { sourceRect: [1840, 190, 180, 224] });
addAsset("gauge-volt", "scrollbars", 128, 384, "VOLT vertical diagnostic gauge.", function(v) { return gaugeDraw("VOLT", v); }, { sourceRect: [1840, 430, 180, 230] });
addAsset("fan-status", "scrollbars", 160, 160, "FAN status label, OK badge, and dot matrix.", function(v) {
  let s = dotMatrix(24, 88, 4, 3, 20, 1.6, C.gray200);
  if (v === "labeled") {
    s += textEl(16, 30, "FAN", 18, C.white, "start", 700) + rect(90, 8, 48, 28, C.gray200, C.white, 1) + textEl(114, 29, "OK", 16, C.black, "middle", 700);
  }
  return s;
}, { sourceRect: [1840, 684, 180, 112] });
addAsset("ok-badge", "scrollbars", 72, 40, "Reusable OK status badge.", function(v) {
  let s = rect(5, 5, 62, 30, C.gray200, C.white, 1);
  if (v === "labeled") s += textEl(36, 28, "OK", 18, C.black, "middle", 700);
  return s;
});

addAsset("barcode-short", "micrographics", 144, 96, "Short vertical service barcode.", function(v) { return v === "labeled" ? barcode(12, 12, 120, 72, C.black, 2) : ""; }, { blankBehavior: "transparent-placeholder", sourceRect: [48, 360, 104, 278] });
addAsset("barcode-long", "micrographics", 240, 64, "Long horizontal part-number barcode.", function(v) { return v === "labeled" ? barcode(8, 8, 224, 48, C.white, 7) : ""; }, { blankBehavior: "transparent-placeholder", sourceRect: [1860, 910, 168, 38] });
addAsset("hatch-square", "micrographics", 80, 80, "Diagonal hatch status square.", function(v) { return v === "labeled" ? hatch(8, 8, 64, 64, C.black) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("slash-band-3", "micrographics", 112, 48, "Three diagonal technical slashes.", function(v) { return v === "labeled" ? slashBand(12, 10, 3, C.black, 16, 6, 28) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("slash-band-5", "micrographics", 160, 48, "Five diagonal technical slashes.", function(v) { return v === "labeled" ? slashBand(12, 10, 5, C.black, 16, 6, 28) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("dot-matrix-4x2", "micrographics", 80, 48, "Four-by-two micro dot matrix.", function(v) { return v === "labeled" ? dotMatrix(16, 16, 4, 2, 16, 1.7, C.white) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("dot-matrix-4x3", "micrographics", 80, 64, "Four-by-three status dot matrix.", function(v) { return v === "labeled" ? dotMatrix(16, 16, 4, 3, 16, 1.7, C.white) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("ellipsis-3", "micrographics", 72, 32, "Three-dot ellipsis.", function(v) { return v === "labeled" ? dotMatrix(18, 16, 3, 1, 18, 3.5, C.black) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("caution-stripe", "micrographics", 176, 32, "Red caution stripe band.", function(v) { return v === "labeled" ? slashBand(8, 8, 9, C.redSignal, 8, 4, 16) : ""; }, { blankBehavior: "transparent-placeholder" });
addAsset("micro-ruler", "micrographics", 224, 48, "Compact measurement ruler.", function(v) {
  let s = tickRuler(8, 28, 208, 16, C.black, false);
  if (v === "labeled") s += textEl(112, 15, "X=834.500", 9, C.black, "middle", 700);
  return s;
});
addAsset("circuit-node-line", "micrographics", 184, 112, "Angular circuit line with pivot nodes.", function(v) {
  let s = pathEl("M 12 16 H 72 V 48 L 112 88 H 172", "none", C.black, 1.5);
  s += circle(12, 16, 4, C.white, C.black, 1.5) + circle(72, 48, 4, C.white, C.black, 1.5) + circle(112, 88, 4, C.white, C.black, 1.5);
  if (v === "labeled") s += circle(172, 88, 3, C.black);
  return s;
});
addAsset("grid-label", "micrographics", 232, 72, "GRID // A-17 coordinate label.", function(v) {
  if (v === "blank") return "";
  return textEl(8, 24, "GRID // A-17", 16, C.black, "start", 700) + textEl(8, 48, "X= 834.500   Y= 887.250", 10, C.black, "start", 700);
}, { blankBehavior: "transparent-placeholder" });
addAsset("console-data", "micrographics", 232, 80, "System console status text block.", function(v) {
  if (v === "blank") return "";
  return textEl(8, 22, "SYS.CONSOLE.DATA", 12, C.black, "start", 700) + textEl(8, 43, "// LINK STABLE", 11, C.black, "start", 700) + textEl(8, 62, "// CRC-32 : OK", 11, C.black, "start", 700);
}, { blankBehavior: "transparent-placeholder" });
addAsset("part-number", "micrographics", 200, 96, "Diagnostic part number and lot text block.", function(v) {
  if (v === "blank") return "";
  return textEl(8, 22, "PART NO.", 14, C.white, "start") + textEl(8, 42, "SDN-DD1-7702-00", 11, C.white, "start") + textEl(8, 70, "LOT // 2405", 14, C.white, "start");
}, { blankBehavior: "transparent-placeholder" });

addAsset("overlay-left-panel", "overlays", 505, 1152, "Complete left maintenance access-panel overlay.", function(v) {
  let s = rect(0, 0, 505, 1152, C.white);
  s += embed("left-panel-frame", v, 0, 0, 1);
  if (v === "labeled") {
    s += embed("grid-label", "labeled", 84, 52, 1);
    s += embed("console-data", "labeled", 84, 194, 1);
    s += embed("barcode-short", "labeled", 40, 350, 1);
    s += textEl(122, 592, "SDN-A63-DU-2405", 10, C.black, "start", 700, { transform: "rotate(-90 122 592)" });
    s += embed("vertical-id-a63", "labeled", 326, 334, 1);
    s += textEl(52, 734, "CAUTION", 16, C.redSignal, "start", 700);
    s += embed("caution-stripe", "labeled", 46, 736, 0.9);
    s += textEl(52, 774, "MOVING PARTS", 12, C.black, "start", 700);
    s += textEl(52, 794, "KEEP CLEAR", 12, C.black, "start", 700);
    s += embed("warning-triangle", "labeled", 298, 758, 0.75);
    s += textEl(84, 958, "MAINT.ACCESS", 16, C.black, "start", 700);
    s += textEl(84, 986, "PANEL // 04A", 16, C.black, "start", 700);
    s += embed("pointer-red-down", "labeled", 222, 955, 0.7);
    s += embed("ellipsis-3", "labeled", 78, 1018, 1);
    s += embed("registration-crosshair", "labeled", 10, 1080, 1);
  }
  return s;
}, { sourceRect: [0, 0, 505, 1152] });
addAsset("overlay-service-rail", "overlays", 180, 1152, "Complete red service-rail overlay.", function(v) {
  let s = embed("service-rail-frame", v, 0, 0, 1);
  if (v === "labeled") {
    s += textEl(38, 192, "LOCK", 14, C.white, "start", 700) + embed("pointer-white-down", "labeled", 36, 190, 0.7);
    s += embed("small-index-01", "labeled", 20, 372, 1);
    s += embed("small-index-02", "labeled", 20, 484, 1);
    s += embed("small-index-03", "labeled", 20, 596, 1);
    s += embed("small-index-04", "labeled", 20, 708, 1);
    s += textEl(40, 892, "SERV.RAIL", 14, C.white, "start", 700);
    s += textEl(40, 914, "SR-01", 13, C.white, "start", 700);
    s += embed("pointer-white-down", "labeled", 34, 912, 0.65);
  }
  return s;
}, { sourceRect: [505, 0, 180, 1152] });
addAsset("overlay-header", "overlays", 1139, 104, "Main AUTO BOOT header and ruler overlay.", function(v) {
  let s = rect(0, 0, 1139, 104, C.black) + embed("header-frame", v, 0, 0, 1);
  if (v === "labeled") s += embed("header-auto-boot", "labeled", 50, 22, 1);
  return s;
}, { sourceRect: [685, 0, 1139, 104] });
addAsset("overlay-menu", "overlays", 1216, 512, "Full main menu overlay.", function(v) { return embed("menu-stack", v, 0, 0, 1); }, { sourceRect: [604, 318, 1216, 486] });
addAsset("overlay-footer-controls", "overlays", 1070, 240, "Footer controls and scrollbar overlay.", function(v) {
  let s = rect(0, 0, 1070, 240, C.black) + embed("footer-frame", v, 0, 0, 1);
  s += embed("control-select", v, 18, 36, 0.85);
  s += embed("control-enter-boot", v, 258, 36, 0.85);
  s += embed("control-edit", v, 590, 36, 0.85);
  s += embed("control-console", v, 786, 36, 0.85);
  s += embed("bottom-scrollbar", v, 0, 158, 1);
  return s;
}, { sourceRect: [748, 914, 1070, 220] });
addAsset("overlay-diagnostics", "overlays", 224, 1152, "Complete right diagnostic strip overlay.", function(v) {
  let s = embed("diagnostic-strip-frame", v, 0, 0, 1);
  if (v === "labeled") {
    s += textEl(20, 56, "DIAG.STRIP // D-01", 14, C.white, "start");
    s += embed("pointer-red-down", "labeled", 14, 58, 0.55);
  }
  s += embed("gauge-temp", v, 18, 170, 1);
  s += embed("gauge-volt", v, 18, 410, 1);
  s += embed("fan-status", v, 16, 678, 1);
  if (v === "labeled") {
    s += embed("part-number", "labeled", 20, 824, 1);
    s += embed("barcode-long", "labeled", 16, 904, 0.85);
    s += textEl(20, 990, "INSPECT", 13, C.white, "start") + circle(22, 1019, 3, C.redSignal) + textEl(32, 1024, "OK", 12, C.white);
    s += embed("cable-coil", "labeled", 12, 1068, 0.72);
    s += embed("angular-connector", "labeled", 112, 1064, 0.72);
    s += embed("registration-crosshair", "labeled", 170, 1080, 0.75);
  }
  return s;
}, { sourceRect: [1824, 0, 224, 1152] });
addAsset("overlay-full-composition", "overlays", 2048, 1152, "Recomposed full interface using all reusable families.", function(v) {
  let s = rect(685, 0, 1139, 1152, C.black);
  s += embed("overlay-left-panel", v, 0, 0, 1);
  s += embed("overlay-service-rail", v, 505, 0, 1);
  s += embed("overlay-header", v, 685, 0, 1);
  s += embed("overlay-menu", v, 604, 318, 1);
  s += embed("overlay-footer-controls", v, 748, 912, 1);
  s += embed("overlay-diagnostics", v, 1824, 0, 1);
  return s;
}, { sourceRect: [0, 0, 2048, 1152] });

/*
 * Exhaustive subcomponents. These exports intentionally duplicate geometry
 * found in larger composites so every visible piece can be addressed alone.
 */
addAsset("maintenance-trace-upper", "frames", 184, 704, "Upper/right maintenance-panel circuit trace.", function(v) {
  let s = pathEl("M 48 0 V 118 L 4 162 V 292 L 46 338 V 606 L 0 676", "none", C.black, 2);
  s += circle(48, 58, 4, C.white, C.black, 1.5) + circle(4, 118, 4, C.white, C.black, 1.5) + circle(4, 292, 3, C.black);
  if (v === "labeled") s += line(46, 338, 76, 338, C.black, 1);
  return s;
}, { sourceRect: [291, 0, 173, 683] });
addAsset("maintenance-edge-lower", "frames", 296, 128, "Lower maintenance edge trace with two latches.", function(v) {
  let s = pathEl("M 8 8 V 96 H 278", "none", C.black, 2);
  s += rect(42, 92, 18, 8, C.white, C.black, 2) + circle(278, 96, 7, C.white, C.black, 2);
  if (v === "labeled") s += line(8, 96, 286, 96, C.black, 1);
  return s;
}, { sourceRect: [0, 734, 280, 107] });
addAsset("maintenance-trace-lower", "frames", 192, 336, "Lower maintenance-panel diagonal and vertical trace.", function(v) {
  let s = pathEl("M 10 8 L 74 72 H 164 V 326", "none", C.black, 2);
  s += circle(74, 72, 4, C.white, C.black, 1.5) + circle(164, 118, 4, C.white, C.black, 1.5);
  if (v === "labeled") s += circle(164, 326, 4, C.white, C.black, 1.5);
  return s;
}, { sourceRect: [304, 826, 173, 326] });
addAsset("rail-divider-spine", "frames", 24, 1152, "Black/red separator spine between access panel and service rail.", function(v) {
  let s = rect(8, 0, 8, 1152, C.black);
  if (v === "labeled") s += rect(10, 316, 4, 44, C.white) + rect(10, 886, 4, 8, C.redDark);
  return s;
}, { sourceRect: [504, 0, 12, 1152] });
addAsset("panel-main-console", "overlays", 1139, 1152, "Main black console field; labeled version composes header, menu and footer.", function(v) {
  let s = rect(0, 0, 1139, 1152, C.black);
  if (v === "labeled") {
    s += embed("overlay-header", "labeled", 0, 0, 1);
    s += embed("overlay-menu", "labeled", -81, 318, 1);
    s += embed("overlay-footer-controls", "labeled", 63, 912, 1);
  }
  return s;
}, { sourceRect: [685, 0, 1139, 1152] });
addAsset("left-panel-vignette", "overlays", 505, 1152, "Optional transparent edge-softening overlay for the white panel.", function(v) {
  if (v === "blank") return "";
  return rect(0, 0, 8, 1152, "#00000010") + rect(497, 0, 8, 1152, "#00000018") + rect(0, 0, 505, 8, "#0000000D") + rect(0, 1144, 505, 8, "#0000000D");
}, { blankBehavior: "transparent-placeholder", sourceRect: [0, 0, 506, 1152] });
addAsset("service-rail-red-glow", "overlays", 180, 1152, "Optional transparent red rail glow/tonal overlay.", function(v) {
  return v === "labeled" ? rect(8, 0, 164, 1152, "#EE10061A") : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [516, 0, 169, 1152] });
addAsset("selector-white-surface", "overlays", 1193, 112, "Clean selected-row white surface underlay.", function(v) {
  return rect(8, 8, 1177, 96, v === "labeled" ? C.white : C.whiteLow, C.black, 1);
}, { sourceRect: [638, 348, 1177, 97], nineSlice: { left: 16, right: 16, top: 16, bottom: 16 } });
addAsset("selector-red-tab-surface", "overlays", 131, 113, "Clean red number-tab underlay.", function(v) {
  return rect(8, 8, 115, 97, v === "labeled" ? C.red : C.redDark, C.black, 1);
}, { sourceRect: [638, 348, 115, 97], nineSlice: { left: 12, right: 12, top: 12, bottom: 12 } });
addAsset("header-baseline", "frames", 1120, 16, "Header horizontal baseline.", function(v) {
  return line(8, 8, 1112, 8, v === "labeled" ? C.white : C.gray500, 1);
}, { sourceRect: [694, 102, 1104, 2], nineSlice: { left: 8, right: 8, top: 4, bottom: 4 } });
addAsset("header-ruler-progress", "scrollbars", 696, 48, "Source-proportion header ruler with progress marker.", function(v) {
  return tickRuler(12, 24, 672, 50, C.gray200, v === "labeled");
}, { sourceRect: [1111, 62, 671, 31], nineSlice: { left: 28, right: 28, top: 8, bottom: 8 } });
addAsset("selector-top-assembly", "frames", 1230, 72, "Top selector rail plus external hinge shroud.", function(v) {
  let s = clampRailDetailed(1216, 24, C.white, v === "labeled");
  s += pathEl("M 6 8 H 34 L 54 24 V 52 L 34 66 H 6 L 0 58 V 16 Z", C.white, C.black, 2);
  if (v === "labeled") s += fastener(18, 36, C.black, "target");
  return s;
}, { sourceRect: [603, 307, 1214, 56], nineSlice: { left: 176, right: 80, top: 8, bottom: 8 } });
addAsset("selector-bottom-assembly", "frames", 1230, 72, "Bottom selector rail plus external hinge shroud.", function(v) {
  let s = clampRailDetailed(1216, 24, C.white, v === "labeled");
  s += pathEl("M 6 8 H 34 L 54 24 V 52 L 34 66 H 6 L 0 58 V 16 Z", C.white, C.black, 2);
  if (v === "labeled") s += fastener(18, 36, C.black, "target");
  return s;
}, { sourceRect: [603, 435, 1214, 57], nineSlice: { left: 176, right: 80, top: 8, bottom: 8 } });
addAsset("unselected-grid", "frames", 1152, 352, "Three-row inactive grid with number column and dividers.", function(v) {
  let s = rect(8, 8, 1136, 333, C.black);
  s += line(124, 8, 124, 341, C.gray500, 1);
  [117, 229, 341].forEach(function(y) { s += line(8, y, 1144, y, C.gray200, 1); });
  if (v === "labeled") {
    s += textEl(64, 78, "02", 44, C.gray500, "middle") + textEl(64, 190, "03", 44, C.gray500, "middle") + textEl(64, 302, "04", 44, C.gray500, "middle");
  }
  return s;
}, { sourceRect: [638, 472, 1136, 333], nineSlice: { left: 136, right: 16, top: 16, bottom: 16 } });
addAsset("footer-divider", "frames", 1016, 16, "Footer rule above controls.", function(v) { return line(8, 8, 1008, 8, v === "labeled" ? C.white : C.gray500, 1); }, { sourceRect: [751, 915, 1000, 2] });

const diagSeparators = [
  ["diag-header-frame", 224, 64, "M 8 56 H 142 L 188 12 H 216", [1823,61,208,50]],
  ["diag-mid-separator", 224, 32, "M 0 8 H 136 L 150 18 H 216", [1824,658,224,15]],
  ["diag-lower-separator", 224, 16, "M 0 8 H 224", [1824,803,224,2]],
  ["diag-bottom-separator", 120, 16, "M 8 8 H 112", [1843,1062,99,1]],
  ["diag-temp-rule", 112, 16, "M 8 8 H 105", [1860,421,97,1]]
];
diagSeparators.forEach(function(d) {
  addAsset(d[0], "frames", d[1], d[2], "Diagnostic strip separator: " + d[0] + ".", function(v) {
    let s = pathEl(d[3], "none", C.white, 1.5);
    if (v === "labeled" && d[0] === "diag-header-frame") s += fastener(8, 56, C.white, "target");
    return s;
  }, { sourceRect: d[4] });
});

const selectorLabels = [
  ["selector-label-primary", "PRIMARY SYSTEM", 288, 48, 30, [816,386,245,22]],
  ["selector-label-advanced", "ADVANCED OPTIONS", 320, 48, 29, [815,516,281,22]],
  ["selector-label-memory", "MEMORY TEST", 240, 48, 29, [815,626,194,22]],
  ["selector-label-uefi", "UEFI FIRMWARE", 272, 48, 29, [816,738,228,22]]
];
selectorLabels.forEach(function(d) {
  addAsset(d[0], "selectors", d[2], d[3], "Text-only selector label " + d[1] + ".", function(v) {
    return v === "labeled" ? textEl(8, 34, d[1], d[4], d[0] === "selector-label-primary" ? C.black : C.white, "start") : "";
  }, { blankBehavior: "transparent-placeholder", sourceRect: d[5] });
});
addAsset("selector-selected-word", "selectors", 104, 40, "Text-only SELECTED word.", function(v) {
  return v === "labeled" ? textEl(8, 28, "SELECTED", 16, C.white, "start", 700) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1569, 391, 76, 19] });
addAsset("selector-selected-slashes", "selectors", 104, 48, "Selected-state five-slash mark.", function(v) {
  return v === "labeled" ? slashBand(8, 10, 5, C.white, 9, 4, 28) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1659,386,82,24] });
addAsset("selector-selected-arrow", "selectors", 32, 32, "Selected-state left-facing red arrow.", pointerAsset("24,5 6,16 24,27", C.redSignal), { blankBehavior: "transparent-placeholder", sourceRect: [1790,391,10,14] });
addAsset("selector-grip-dots", "selectors", 72, 32, "Inactive-row grip-dot family.", function(v) {
  return v === "labeled" ? dotMatrix(12, 10, 4, 2, 15, 1.4, C.gray200) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1698,531,53,11] });
addAsset("selector-hinge-shroud", "frames", 64, 72, "Selector hinge shroud with pivot bolt.", function(v) {
  let s = pathEl("M 6 8 H 34 L 58 28 V 52 L 34 66 H 6 L 0 58 V 16 Z", C.white, C.black, 2);
  if (v === "labeled") s += fastener(18, 36, C.black, "target");
  return s;
}, { sourceRect: [603,307,42,56] });
addAsset("rail-interlock-upper", "frames", 72, 104, "Upper red rail interlock.", function(v) {
  let s = pathEl("M 66 4 L 18 26 V 72 L 66 98", "none", C.redDark, 4);
  if (v === "labeled") s += pathEl("M 58 16 L 28 30 V 66 L 58 82", "none", C.black, 2);
  return s;
}, { sourceRect: [634,173,51,83] });
addAsset("rail-interlock-lower", "frames", 72, 120, "Lower red rail interlock.", function(v) {
  let s = pathEl("M 66 4 L 18 26 V 90 L 66 116", "none", C.redDark, 4);
  if (v === "labeled") s += pathEl("M 58 16 L 28 32 V 84 L 58 100", "none", C.black, 2);
  return s;
}, { sourceRect: [634,1014,51,98] });
["02", "03"].forEach(function(n) {
  addAsset("rail-edge-tab-" + n, "frames", 32, 48, "Small service-rail edge tab " + n + ".", function(v) {
    let s = pathEl("M 28 4 L 8 16 V 34 L 28 44", "none", C.redDark, 3);
    if (v === "labeled") s += line(22, 12, 22, 36, C.black, 1);
    return s;
  }, { sourceRect: n === "02" ? [615,565,14,31] : [615,675,14,31] });
});
addAsset("rail-edge-tab-04-transition", "frames", 40, 64, "Larger lower rail transition tab.", function(v) {
  let s = pathEl("M 36 4 L 8 20 V 42 L 36 60", "none", C.redDark, 3);
  if (v === "labeled") s += line(28, 10, 28, 54, C.black, 1);
  return s;
}, { sourceRect: [615,783,24,44] });

for (let d = 0; d <= 4; d++) {
  addAsset("digit-gray-" + d, "countdown", 64, 80, "Reusable inactive gray digit " + d + ".", function(v) {
    return v === "labeled" ? textEl(32, 62, String(d), 58, C.gray500, "middle") : "";
  }, { blankBehavior: "transparent-placeholder", expanded: d > 4 });
}
addAsset("gauge-numeric-scale", "countdown", 56, 160, "Reusable -100 / 50 / 00 gauge numeric scale.", function(v) {
  if (v === "blank") return "";
  return textEl(4, 22, "-100", 13, C.white) + textEl(16, 82, "50", 13, C.white) + textEl(16, 148, "00", 13, C.white);
}, { blankBehavior: "transparent-placeholder", sourceRect: [1879,251,26,137] });

addAsset("scrollbar-track", "scrollbars", 1010, 32, "Footer scrollbar track with tick family.", function(v) {
  let s = line(8, 8, 1002, 8, C.white, 1);
  for (let i = 0; i < 16; i++) s += line(8 + i * 63, 16, 8 + i * 63, 25, C.white, 1);
  if (v === "labeled") s += line(8, 0, 8, 18, C.white, 2) + line(1002, 0, 1002, 18, C.white, 2);
  return s;
}, { sourceRect: [750,1065,993,15], nineSlice: { left: 20, right: 20, top: 4, bottom: 4 } });
addAsset("scrollbar-end-cap", "scrollbars", 24, 40, "Vertical scrollbar end cap.", function(v) {
  return line(12, 4, 12, 36, v === "labeled" ? C.white : C.gray500, 2);
}, { sourceRect: [1740,1035,3,18] });
addAsset("scrollbar-tick", "scrollbars", 16, 24, "Single reusable scrollbar tick.", function(v) {
  return line(8, 4, 8, v === "labeled" ? 20 : 14, C.white, 1);
}, { sourceRect: [813,1072,2,9] });
addAsset("scrollbar-fill-short", "scrollbars", 40, 24, "Short scrollbar fill/thumb block.", function(v) {
  return v === "labeled" ? rect(8, 9, 24, 6, C.gray200) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1414,1075,19,5] });
addAsset("scrollbar-fill-long", "scrollbars", 80, 24, "Long scrollbar fill/thumb block.", function(v) {
  return v === "labeled" ? rect(8, 9, 64, 6, C.gray200) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1678,1075,57,5] });
addAsset("scrollbar-pointer-down", "scrollbars", 32, 32, "Footer scrollbar down pointer.", function(v) {
  return v === "labeled" ? polygon("6,8 26,8 16,26", C.gray500) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1234,1086,12,10] });
addAsset("progress-red-segment", "scrollbars", 88, 24, "Adjustable red progress segment.", function(v) {
  return v === "labeled" ? rect(8, 8, 72, 8, C.redSignal) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1648,75,72,7] });

addAsset("rail-logo-slanted", "icons", 104, 48, "Source-proportion three-part slanted rail logo.", function(v) {
  return v === "labeled" ? slashBand(8, 8, 3, C.white, 18, 6, 28) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [544,52,82,29] });
addAsset("crosshair-dark", "icons", 48, 48, "Black registration crosshair for light surfaces.", function(v) {
  if (v === "blank") return "";
  return line(24, 4, 24, 44, C.black, 1) + line(4, 24, 44, 24, C.black, 1) + circle(24, 24, 4, C.white, C.black, 1);
}, { blankBehavior: "transparent-placeholder", sourceRect: [29,30,27,28] });
addAsset("crosshair-light", "icons", 48, 48, "White registration crosshair for dark surfaces.", function(v) {
  if (v === "blank") return "";
  return line(24, 4, 24, 44, C.white, 1) + line(4, 24, 44, 24, C.white, 1) + circle(24, 24, 4, C.black, C.white, 1);
}, { blankBehavior: "transparent-placeholder", sourceRect: [1989,1094,29,29] });
addAsset("screw-ring-small", "icons", 40, 40, "Small ring fastener.", function(v) { return fastener(20, 20, C.black, v === "labeled" ? "target" : null); }, { sourceRect: [464,202,17,17] });
addAsset("selector-bolt", "icons", 40, 40, "Small selector clamp bolt.", function(v) { return fastener(20, 20, C.black, v === "labeled" ? "target" : null); }, { sourceRect: [620,323,17,18] });
addAsset("keycap-select-box", "controls", 72, 64, "Blank/select-arrow box without legend.", function(v) { return keycapFrame(72, 64) + (v === "labeled" ? arrowUpDown(25, 32, C.white) : ""); }, { sourceRect: [769,951,60,49] });
addAsset("keycap-enter-box", "controls", 72, 64, "Blank/enter-arrow box without legend.", function(v) { return keycapFrame(72, 64) + (v === "labeled" ? enterArrow(22, 32, C.white) : ""); }, { sourceRect: [1016,951,61,49] });
addAsset("keycap-edit-box", "controls", 60, 64, "Blank/E keycap box without legend.", function(v) { return keycapFrame(60, 64) + (v === "labeled" ? textEl(30, 45, "E", 30, C.white, "middle") : ""); }, { sourceRect: [1318,951,47,49] });
addAsset("keycap-console-box", "controls", 60, 64, "Blank/C keycap box without legend.", function(v) { return keycapFrame(60, 64) + (v === "labeled" ? textEl(30, 45, "C", 30, C.white, "middle") : ""); }, { sourceRect: [1530,951,45,49] });
addAsset("key-glyph-up-down", "controls", 56, 48, "Transparent up/down arrow glyph.", function(v) { return v === "labeled" ? arrowUpDown(18, 24, C.white) : ""; }, { blankBehavior: "transparent-placeholder", sourceRect: [783,964,33,22] });
addAsset("key-glyph-enter", "controls", 56, 48, "Transparent enter/return glyph.", function(v) { return v === "labeled" ? enterArrow(12, 24, C.white) : ""; }, { blankBehavior: "transparent-placeholder", sourceRect: [1032,964,29,20] });

const textOnlyLabels = [
  ["label-grid-title", "GRID // A-17", 152, 32, 16, C.black, [94,60,118,14]],
  ["label-grid-coordinates", "X=834.500  Y=887.250", 216, 28, 10, C.black, [94,87,155,10]],
  ["label-auto-boot", "AUTO BOOT // T-06", 320, 40, 26, C.white, [746,61,283,22]],
  ["label-diag-strip", "DIAG.STRIP // D-01", 208, 36, 14, C.white, [1844,41,174,17]],
  ["label-footer-select", "SELECT", 112, 36, 22, C.white, [854,966,86,18]],
  ["label-footer-enter-boot", "ENTER BOOT", 176, 36, 22, C.white, [1102,966,147,18]],
  ["label-footer-edit", "EDIT", 88, 36, 22, C.white, [1389,966,56,18]],
  ["label-footer-console", "CONSOLE", 128, 36, 22, C.white, [1600,966,101,18]],
  ["label-lock", "LOCK", 80, 36, 14, C.white, [552,182,52,75]],
  ["label-service-rail", "SERV.RAIL  SR-01", 168, 40, 14, C.white, [554,881,78,58]],
  ["label-inspect-status", "INSPECT  • OK", 128, 48, 13, C.white, [1860,993,63,35]]
];
textOnlyLabels.forEach(function(d) {
  addAsset(d[0], "micrographics", d[2], d[3], "Text-only label " + d[1] + ".", function(v) {
    return v === "labeled" ? textEl(8, Math.round(d[3] * 0.7), d[1], d[4], d[5], "start", 700) : "";
  }, { blankBehavior: "transparent-placeholder", sourceRect: d[6] });
});
addAsset("label-caution-full", "micrographics", 168, 96, "Complete CAUTION / MOVING PARTS / KEEP CLEAR label.", function(v) {
  if (v === "blank") return "";
  return textEl(8, 22, "CAUTION", 16, C.redSignal, "start", 700) + slashBand(8, 30, 9, C.redSignal, 8, 4, 14) + textEl(8, 66, "MOVING PARTS", 12, C.black, "start", 700) + textEl(8, 86, "KEEP CLEAR", 12, C.black, "start", 700);
}, { blankBehavior: "transparent-placeholder", sourceRect: [55,716,137,78] });
addAsset("label-maintenance-access", "micrographics", 176, 112, "Complete MAINT.ACCESS PANEL // 04A label.", function(v) {
  if (v === "blank") return "";
  return textEl(8, 28, "MAINT.ACCESS", 16, C.black, "start", 700) + textEl(8, 56, "PANEL // 04A", 16, C.black, "start", 700) + line(8, 84, 38, 84, C.black, 1) + dotMatrix(12, 104, 3, 1, 18, 3.5, C.black);
}, { blankBehavior: "transparent-placeholder", sourceRect: [93,944,149,98] });
addAsset("status-temp", "scrollbars", 112, 40, "TEMP label with reusable OK badge.", function(v) {
  let s = v === "labeled" ? textEl(4, 28, "TEMP", 16, C.white, "start", 700) : "";
  s += group(assetMap.get("ok-badge").draw(v), { transform: "translate(56 0) scale(0.7)" });
  return s;
}, { sourceRect: [1861,206,95,19] });
addAsset("status-volt", "scrollbars", 112, 40, "VOLT label with reusable OK badge.", function(v) {
  let s = v === "labeled" ? textEl(4, 28, "VOLT", 16, C.white, "start", 700) : "";
  s += group(assetMap.get("ok-badge").draw(v), { transform: "translate(56 0) scale(0.7)" });
  return s;
}, { sourceRect: [1861,445,96,18] });
addAsset("status-fan", "scrollbars", 112, 40, "FAN label with reusable OK badge.", function(v) {
  let s = v === "labeled" ? textEl(4, 28, "FAN", 16, C.white, "start", 700) : "";
  s += group(assetMap.get("ok-badge").draw(v), { transform: "translate(48 0) scale(0.7)" });
  return s;
}, { sourceRect: [1861,705,88,18] });

addAsset("barcode-maintenance-bars", "micrographics", 96, 296, "Vertical barcode bars without serial code.", function(v) {
  return v === "labeled" ? barcode(8, 8, 64, 280, C.black, 2) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [54,361,63,276] });
addAsset("barcode-maintenance-code", "micrographics", 32, 256, "Vertical maintenance serial code.", function(v) {
  return v === "labeled" ? textEl(0, 0, "SDN-A63-DU-2405", 10, C.black, "middle", 700, { transform: "translate(18 224) rotate(-90)" }) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [126,383,11,233] });
addAsset("micro-barcode-short", "micrographics", 40, 40, "Tiny maintenance barcode.", function(v) {
  return v === "labeled" ? barcode(8, 8, 24, 24, C.black, 5) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [235,714,19,18] });
addAsset("micro-slashes-black", "micrographics", 104, 40, "Black five-slash micrographic.", function(v) {
  return v === "labeled" ? slashBand(8, 8, 5, C.black, 10, 4, 24) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [373,138,82,24] });
addAsset("hatch-caution-red", "micrographics", 160, 32, "Red caution hatch band.", function(v) {
  return v === "labeled" ? slashBand(8, 8, 10, C.redSignal, 7, 3, 16) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [55,739,137,11] });
addAsset("hatch-lock-black", "micrographics", 72, 56, "Black diagonal lock hatch block.", function(v) {
  return v === "labeled" ? hatch(8, 8, 56, 40, C.black) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [552,218,52,38] });
addAsset("hatch-rail-lower", "micrographics", 80, 112, "Tall lower rail hatch block.", function(v) {
  return v === "labeled" ? hatch(8, 8, 64, 96, C.black) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [545,1027,59,92] });
addAsset("micro-underline", "micrographics", 48, 16, "Short maintenance underline.", function(v) {
  return v === "labeled" ? line(8, 8, 40, 8, C.black, 1) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [93,1014,27,1] });
addAsset("micro-diag-dash", "micrographics", 48, 16, "Short diagnostic dash.", function(v) {
  return v === "labeled" ? line(8, 8, 40, 8, C.white, 1) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1921,681,27,2] });
addAsset("micro-red-status-dot", "micrographics", 24, 24, "Small red diagnostic status dot.", function(v) {
  return v === "labeled" ? circle(12, 12, 3, C.redSignal) : "";
}, { blankBehavior: "transparent-placeholder", sourceRect: [1860,1019,5,5] });

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function renderAssets() {
  const manifestAssets = [];
  for (const a of assets) {
    const item = {
      id: a.id,
      category: a.category,
      description: a.description,
      logicalSize: [a.w, a.h],
      sourceRect: a.sourceRect,
      variants: {},
      blankBehavior: a.blankBehavior,
      nineSlice: a.nineSlice || null,
      expandedBeyondVisibleSet: !!a.expanded
    };
    for (const variant of ["labeled", "blank"]) {
      const inner = a.draw(variant);
      const svgRel = path.join("source", "svg", a.category, a.id + "--" + variant + ".svg");
      const svgAbs = path.join(PACK, svgRel);
      mkdirp(path.dirname(svgAbs));
      fs.writeFileSync(svgAbs, svgDoc(a, inner, 1));
      const files = { svg: { path: svgRel.replace(/\\/g, "/"), sha256: sha256(svgAbs) }, png: {} };
      for (const scale of scales) {
        const pngRel = path.join("exports", "png", scale + "x", a.category, a.id + "--" + variant + "@" + scale + "x.png");
        const pngAbs = path.join(PACK, pngRel);
        mkdirp(path.dirname(pngAbs));
        await sharp(Buffer.from(svgDoc(a, inner, scale))).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toFile(pngAbs);
        files.png[scale + "x"] = { path: pngRel.replace(/\\/g, "/"), sha256: sha256(pngAbs), size: [a.w * scale, a.h * scale] };
      }
      item.variants[variant] = files;
    }
    manifestAssets.push(item);
  }
  return manifestAssets;
}

function checkerSvg(w, h, cell) {
  let s = rect(0, 0, w, h, "#EBEBEB");
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
    if (((x / cell) + (y / cell)) % 2 === 0) s += rect(x, y, cell, cell, "#FFFFFF");
  }
  return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + w + "\" height=\"" + h + "\" viewBox=\"0 0 " + w + " " + h + "\">" + s + "</svg>";
}

async function contactSheet(variant) {
  const cols = 5, cellW = 400, cellH = 230, margin = 20;
  const rows = Math.ceil(assets.length / cols);
  const w = cols * cellW + margin * 2, h = rows * cellH + margin * 2 + 70;
  const comps = [];
  const bg = await sharp(Buffer.from(checkerSvg(w, h, 20))).png().toBuffer();
  comps.push({ input: bg, left: 0, top: 0 });
  const title = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + w + "\" height=\"70\"><rect width=\"100%\" height=\"100%\" fill=\"#111\"/><text x=\"24\" y=\"45\" fill=\"#fff\" font-family=\"" + FONT + "\" font-size=\"26\" letter-spacing=\"2\">T4-F3 HUD PACK — " + variant.toUpperCase() + " COMPONENTS</text></svg>";
  comps.push({ input: Buffer.from(title), left: 0, top: 0 });
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i], col = i % cols, row = Math.floor(i / cols);
    const left = margin + col * cellW, top = 80 + row * cellH;
    const src = path.join(PACK, "exports", "png", "1x", a.category, a.id + "--" + variant + "@1x.png");
    const maxW = cellW - 36, maxH = cellH - 54;
    const thumb = await sharp(src).resize({ width: maxW, height: maxH, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const md = await sharp(thumb).metadata();
    comps.push({ input: thumb, left: Math.round(left + (cellW - md.width) / 2), top: Math.round(top + 4 + (maxH - md.height) / 2) });
    const cap = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + cellW + "\" height=\"34\"><rect width=\"100%\" height=\"100%\" fill=\"#111\" fill-opacity=\"0.86\"/><text x=\"12\" y=\"23\" fill=\"#fff\" font-family=\"" + FONT + "\" font-size=\"13\">" + esc(a.category + " / " + a.id) + "</text></svg>";
    comps.push({ input: Buffer.from(cap), left: left, top: top + cellH - 38 });
  }
  const out = path.join(PACK, "previews", "contact-sheet-" + variant + ".png");
  mkdirp(path.dirname(out));
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png({ compressionLevel: 9 }).toFile(out);
}

async function makeAtlas(variant) {
  const eligible = assets.filter(function(a) { return a.w <= 600 && a.h <= 600; });
  const atlasW = 2048, pad = 12;
  let x = pad, y = pad, rowH = 0;
  const placements = [];
  for (const a of eligible) {
    if (x + a.w + pad > atlasW) { x = pad; y += rowH + pad; rowH = 0; }
    placements.push({ asset: a, x: x, y: y });
    x += a.w + pad;
    rowH = Math.max(rowH, a.h);
  }
  const atlasH = y + rowH + pad;
  const comps = [];
  for (const p of placements) {
    comps.push({ input: path.join(PACK, "exports", "png", "1x", p.asset.category, p.asset.id + "--" + variant + "@1x.png"), left: p.x, top: p.y });
  }
  const out = path.join(PACK, "atlases", "hud-components-" + variant + ".png");
  mkdirp(path.dirname(out));
  await sharp({ create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png({ compressionLevel: 9 }).toFile(out);
  const index = {};
  placements.forEach(function(p) { index[p.asset.id] = { x: p.x, y: p.y, width: p.asset.w, height: p.asset.h, category: p.asset.category }; });
  fs.writeFileSync(path.join(PACK, "atlases", "hud-components-" + variant + ".json"), JSON.stringify({ image: path.basename(out), width: atlasW, height: atlasH, variant: variant, assets: index }, null, 2));
}

async function alphaPreview() {
  const picks = ["active-selector", "warning-triangle", "keycap-up-down", "gauge-temp", "barcode-long", "service-rail-frame"];
  const w = 1920, h = 1080, colW = 480, rowH = 170;
  const panels = [C.black, C.white, C.red, "#808080"];
  let base = "";
  panels.forEach(function(color, i) {
    base += rect(i * colW, 0, colW, h, color);
    base += textEl(i * colW + 18, 36, ["BLACK", "WHITE", "SIGNAL RED", "50% GRAY"][i], 18, i === 1 ? C.black : C.white, "start", 700);
  });
  const comps = [{ input: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + w + "\" height=\"" + h + "\">" + base + "</svg>"), left: 0, top: 0 }];
  for (let r = 0; r < picks.length; r++) {
    const a = assetMap.get(picks[r]);
    const src = path.join(PACK, "exports", "png", "1x", a.category, a.id + "--labeled@1x.png");
    const thumb = await sharp(src).resize({ width: 420, height: 125, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const md = await sharp(thumb).metadata();
    for (let c = 0; c < 4; c++) comps.push({ input: thumb, left: c * colW + Math.round((colW - md.width) / 2), top: 60 + r * rowH + Math.round((125 - md.height) / 2) });
  }
  const out = path.join(PACK, "previews", "alpha-background-test.png");
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png({ compressionLevel: 9 }).toFile(out);
}

async function qa(manifestAssets) {
  const results = [];
  let allAlpha = true, parity = true, dimensionPass = true, placeholderPass = true;
  let checkedPngFiles = 0;
  for (const a of assets) {
    const pair = {};
    for (const variant of ["labeled", "blank"]) {
      pair[variant] = { scales: {} };
      for (const scale of scales) {
        const p = path.join(PACK, "exports", "png", scale + "x", a.category, a.id + "--" + variant + "@" + scale + "x.png");
        const m = await sharp(p).metadata();
        let alphaMin = null, alphaMax = null;
        if (variant === "blank" && a.blankBehavior === "transparent-placeholder" && scale === 1) {
          const raw = await sharp(p).raw().toBuffer({ resolveWithObject: true });
          alphaMin = 255;
          alphaMax = 0;
          for (let px = 3; px < raw.data.length; px += raw.info.channels) {
            alphaMin = Math.min(alphaMin, raw.data[px]);
            alphaMax = Math.max(alphaMax, raw.data[px]);
          }
        }
        const data = {
          width: m.width,
          height: m.height,
          channels: m.channels,
          colorSpace: m.space,
          hasAlpha: !!m.hasAlpha,
          alphaMin: alphaMin,
          alphaMax: alphaMax,
          sha256: sha256(p)
        };
        pair[variant].scales[scale + "x"] = data;
        checkedPngFiles++;
        allAlpha = allAlpha && !!m.hasAlpha && m.channels === 4;
        dimensionPass = dimensionPass && m.width === a.w * scale && m.height === a.h * scale;
        if (variant === "blank" && a.blankBehavior === "transparent-placeholder" && scale === 1) {
          placeholderPass = placeholderPass && alphaMax === 0;
        }
      }
    }
    let pairMatch = true;
    for (const scale of scales) {
      const l = pair.labeled.scales[scale + "x"], b = pair.blank.scales[scale + "x"];
      pairMatch = pairMatch && l.width === b.width && l.height === b.height;
    }
    parity = parity && pairMatch;
    results.push({ id: a.id, category: a.category, labeled: pair.labeled, blank: pair.blank, pairDimensionsMatchAtEveryScale: pairMatch });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    source: { filename: "T4-F(3).png", dimensions: [2048, 1152], alphaInSource: "channel present but fully opaque" },
    summary: {
      assetFamilies: assets.length,
      labeledBlankPairs: assets.length,
      svgFiles: assets.length * 2,
      transparentPngFiles: assets.length * 2 * scales.length,
      checkedPngFiles: checkedPngFiles,
      scales: scales,
      allPngsHaveAlphaChannel: allAlpha,
      allLogicalDimensionsPass: dimensionPass,
      allVariantPairsMatchDimensions: parity,
      allTransparentPlaceholderBlanksAreEmpty: placeholderPass
    },
    checks: results
  };
  fs.writeFileSync(path.join(PACK, "qa", "report.json"), JSON.stringify(report, null, 2));
  if (!allAlpha || !dimensionPass || !parity || !placeholderPass) throw new Error("QA failed: " + JSON.stringify(report.summary));
  return report;
}

function writeSupportFiles(manifestAssets) {
  mkdirp(path.join(PACK, "reference", "ai-style-masters"));
  fs.copyFileSync(SOURCE, path.join(PACK, "reference", "T4-F3-reference.png"));
  AI_MASTERS.forEach(function(pair) { if (fs.existsSync(pair[1])) fs.copyFileSync(pair[1], path.join(PACK, "reference", "ai-style-masters", pair[0])); });
  fs.copyFileSync(__filename, path.join(PACK, "tools", "build_hud_pack.js"));

  const palette = {
    colorSpace: "sRGB IEC61966-2.1",
    transparency: "straight alpha",
    colors: C,
    lineWeightsAt1x: { hairline: 1, thin: 2, standard: 3, strong: 4, signal: 6 },
    spacingGrid: 4,
    chamfers: [4, 8, 12, 24, 40],
    font: { primary: "DejaVu Sans Mono", fallback: "monospace", note: "Live text is used in editable SVG sources; raster exports are self-contained." }
  };
  fs.writeFileSync(path.join(PACK, "palette.json"), JSON.stringify(palette, null, 2));
  fs.writeFileSync(path.join(PACK, "design-tokens.css"), [
    ":root {",
    "  --hud-black: " + C.black + ";",
    "  --hud-white: " + C.white + ";",
    "  --hud-gray: " + C.gray500 + ";",
    "  --hud-red: " + C.red + ";",
    "  --hud-red-signal: " + C.redSignal + ";",
    "  --hud-warning: " + C.yellow + ";",
    "  --hud-grid: 4px;",
    "  --hud-line-thin: 2px;",
    "  --hud-line-standard: 3px;",
    "}"
  ].join("\n"));

  const manifest = {
    name: "T4-F3 Expanded Industrial HUD Asset Pack",
    version: "1.0.0",
    sourceCanvas: [2048, 1152],
    palette: "palette.json",
    variants: {
      labeled: "Reference-style visible marks, text, numerals, and internal symbols.",
      blank: "Same logical canvas and anchors; text/symbols removed. Pure glyphs use an intentionally transparent same-size placeholder."
    },
    formats: ["SVG", "PNG RGBA"],
    pngScales: scales,
    categories: Array.from(new Set(assets.map(function(a) { return a.category; }))),
    counts: { families: assets.length, variantFiles: assets.length * 2, pngFiles: assets.length * 2 * scales.length, svgFiles: assets.length * 2 },
    assets: manifestAssets
  };
  fs.writeFileSync(path.join(PACK, "manifest.json"), JSON.stringify(manifest, null, 2));

  const prompts = [
    "# Image-generation provenance",
    "",
    "Built-in image generation was used with Image 1 as the sole style reference. The generated sheets are retained only as visual reconstruction guides; final production assets were rebuilt deterministically as SVG and exported to transparent RGBA PNG.",
    "",
    "## Structural components",
    "",
    "Reconstruct the structural UI language as an orthographic transparent asset atlas: selected and inactive selector frames, clamp rails, angular corner brackets, service rail segments, technical panel borders, and tick rulers. Use crisp flat 2D vector-like geometry, black/off-white/signal-red/gray, no full-screen mockup, no watermark.",
    "",
    "## Icons and micrographics",
    "",
    "Reconstruct isolated keycaps, fasteners, crosshairs, pointers, caution triangle, hazard slashes, emblem, dot matrices, barcodes, hatch tiles, cable coil, and connector glyph. Use monoline industrial sci-fi boot-console styling on a genuinely transparent background.",
    "",
    "## Diagnostics and overlays",
    "",
    "Reconstruct 01–04 number states, T-06 countdown, TEMP/VOLT gauges, FAN status, OK tag, bottom scrollbar, top ruler, right diagnostic strip, and left technical frame as separated transparent assets with exact thin tick spacing."
  ].join("\n");
  fs.writeFileSync(path.join(PACK, "prompts", "imagegen-prompts.md"), prompts);

  const mapSvg = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2048\" height=\"1152\" viewBox=\"0 0 2048 1152\">" +
    rect(0, 0, 2048, 1152, "#111") +
    rect(0, 0, 505, 1152, "none", "#FFFFFF", 4) + textEl(24, 48, "LEFT PANEL 505×1152", 22, "#FFFFFF") +
    rect(505, 0, 180, 1152, "none", C.redSignal, 4) + textEl(520, 48, "RAIL", 20, C.redSignal) +
    rect(685, 0, 1139, 104, "none", "#39D0FF", 4) + textEl(704, 48, "HEADER 1139×104", 22, "#39D0FF") +
    rect(604, 318, 1216, 512, "none", "#52FF86", 4) + textEl(624, 356, "MENU 1216×512", 22, "#52FF86") +
    rect(748, 912, 1070, 240, "none", "#FFD84A", 4) + textEl(768, 950, "FOOTER 1070×240", 22, "#FFD84A") +
    rect(1824, 0, 224, 1152, "none", "#FF69D4", 4) + textEl(1844, 48, "DIAG", 20, "#FF69D4", "start", 700, { transform: "rotate(90 1844 48)" }) +
    "</svg>";
  fs.writeFileSync(path.join(PACK, "reference", "component-map.svg"), mapSvg);

  const readme = [
    "# T4-F3 Expanded Industrial HUD Asset Pack",
    "",
    "A production-ready reconstruction of every visible component family in the supplied boot-console reference, plus a reusable 0–9 digit expansion.",
    "",
    "## What is included",
    "",
    "- " + assets.length + " asset families across selectors, frames, icons, controls, countdown graphics, scrollbars/gauges, micrographics, and overlays.",
    "- Labeled and blank variants for every family. Both variants share identical logical dimensions and anchors.",
    "- Editable SVG masters and transparent sRGB RGBA PNG at 1x, 2x, and 4x.",
    "- Labeled and blank atlases with JSON coordinates.",
    "- Contact sheets, alpha-background tests, a component map, palette/tokens, nine-slice hints, manifest hashes, and QA results.",
    "",
    "## Blank-variant behavior",
    "",
    "Composite assets retain their base geometry while labels, numerals, status marks, and internal symbols are removed. Standalone glyphs that have no surrounding frame use a fully transparent same-size blank; this is intentional and lets you hide a glyph without changing layout.",
    "",
    "## Folder guide",
    "",
    "- source/svg: editable transparent vector masters.",
    "- exports/png: separate transparent PNGs at 1x, 2x, and 4x.",
    "- atlases: convenient labeled and blank sprite sheets plus JSON.",
    "- previews: contact sheets and alpha tests.",
    "- reference: original reference, component map, and AI reconstruction guides.",
    "- qa/report.json: dimension, alpha-channel, and labeled/blank parity checks.",
    "",
    "## Reuse",
    "",
    "Use manifest.json to locate files and matching blank/labeled pairs. Long selectors, rails, and scrollbars include nine-slice metadata where applicable. SVG text remains editable and uses DejaVu Sans Mono with a generic monospace fallback.",
    "",
    "## Quality notes",
    "",
    "The source image is 2048×1152 and contains a fully opaque alpha channel. Final assets were reconstructed as vectors rather than color-keyed crops, preventing black/white detail loss and matte halos. PNG exports are generated directly from the SVG at each target scale.",
    "",
    "Derived from the user-supplied visual reference. Confirm any third-party usage rights before commercial distribution."
  ].join("\n");
  fs.writeFileSync(path.join(PACK, "README.md"), readme);
}

async function main() {
  if (!fs.existsSync(SOURCE)) throw new Error("Missing source: " + SOURCE);
  if (process.argv.includes("--qa-only")) {
    const reportOnly = await qa([]);
    console.log(JSON.stringify({ pack: PACK, qaOnly: true, report: reportOnly.summary }, null, 2));
    return;
  }
  mkdirp(PACK);
  ["qa", "previews", "atlases", "tools", "prompts", "reference"].forEach(function(d) { mkdirp(path.join(PACK, d)); });
  const manifestAssets = await renderAssets();
  writeSupportFiles(manifestAssets);
  await contactSheet("labeled");
  await contactSheet("blank");
  await makeAtlas("labeled");
  await makeAtlas("blank");
  await alphaPreview();
  const report = await qa(manifestAssets);
  console.log(JSON.stringify({ pack: PACK, assets: assets.length, report: report.summary }, null, 2));
}

main().catch(function(err) {
  console.error(err.stack || err);
  process.exit(1);
});
