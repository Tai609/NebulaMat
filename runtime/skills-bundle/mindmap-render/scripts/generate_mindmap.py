#!/usr/bin/env python3
"""
Generate a beautiful mindmap (HTML + PNG + PDF) from a Markdown unordered list.
Uses markmap autoloader (browser rendering) + Playwright for high-quality export.
"""

import argparse
import asyncio
import html as html_module
import json
import re
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None

try:
    from playwright.async_api import async_playwright
except ImportError as exc:  # pragma: no cover
    print("Error: playwright is not installed. Run: pip install playwright")
    raise SystemExit(1) from exc


# ---------------------------------------------------------------------------
# Themes
# ---------------------------------------------------------------------------
DEFAULT_THEME = "air"
MAX_CUSTOM_LAYOUT_TILE_PHYSICAL = 3072

THEMES = {
    "air": {
        "bg": "#f4f7ff",
        "text": "#23324d",
        "text_shadow": "0 1px 2px rgba(255,255,255,0.85)",
        "is_dark": False,
        "layout": "topic-matrix",
        "layout_config": {
            "distribution": "single-right",
            "canvas_width": 1220,
            "root_left": 56,
            "root_width": 254,
            "root_trunk_gap": 44,
            "groups_left": 370,
            "branch_width": 240,
            "branch_gap": 72,
            "item_width": 454,
            "group_gap": 58,
            "item_gap": 12,
            "padding_y": 42,
            "padding_right": 32,
            "side_padding": 56,
            "branch_hub_gap": 34,
        },
        "colors": [
            "#6A8DFF", "#61C58E", "#C58CFF", "#FFB15C",
            "#62CFE0", "#FF8AA3", "#8BA8FF", "#7FD4B3",
            "#D0A2FF", "#FFC77A",
        ],
        "font": "'SF Pro Display','Segoe UI','Noto Sans SC','Source Han Sans SC','PingFang SC',sans-serif",
        "body_font": "'SF Pro Text','Segoe UI','Noto Sans SC','Source Han Sans SC','PingFang SC',sans-serif",
        "custom_css": """
  body.theme-air {
    background:
      radial-gradient(circle at 18% 16%, rgba(127, 162, 255, 0.22) 0%, transparent 24%),
      radial-gradient(circle at 82% 12%, rgba(170, 198, 255, 0.16) 0%, transparent 18%),
      radial-gradient(circle at 52% 48%, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0) 52%),
      linear-gradient(135deg, #f4f7ff 0%, #eef3ff 45%, #f8fbff 100%);
  }
  body.theme-air #mindmap-wrapper {
    padding: 24px 30px;
  }
  body.theme-air .markmap.topic-matrix-host {
    min-width: 0;
    min-height: 0;
  }
  body.theme-air .topic-matrix {
    position: relative;
    overflow: hidden;
  }
  body.theme-air .topic-matrix-background {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 18% 16%, rgba(127, 162, 255, 0.22) 0%, transparent 24%),
      radial-gradient(circle at 82% 12%, rgba(170, 198, 255, 0.16) 0%, transparent 18%),
      radial-gradient(circle at 52% 48%, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0) 52%),
      linear-gradient(135deg, #f4f7ff 0%, #eef3ff 45%, #f8fbff 100%);
  }
  body.theme-air .topic-matrix-content {
    position: relative;
    z-index: 1;
    width: 100%;
    min-height: 100%;
  }
  body.theme-air .topic-matrix-svg {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: visible;
    pointer-events: none;
  }
  body.theme-air .topic-matrix-root {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    border-radius: 22px;
    padding: 20px 24px;
    background: linear-gradient(135deg, #4c6fff 0%, #667fff 55%, #738dff 100%);
    box-shadow:
      0 26px 58px rgba(76, 111, 255, 0.22),
      0 8px 18px rgba(76, 111, 255, 0.16);
    color: #ffffff;
  }
  body.theme-air .topic-matrix-root-text {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: -0.02em;
    white-space: normal;
  }
  body.theme-air .topic-matrix-groups {
    display: flex;
    flex-direction: column;
  }
  body.theme-air .topic-matrix-group {
    display: flex;
    align-items: center;
  }
  body.theme-air .topic-matrix-branch {
    position: relative;
    z-index: 2;
    box-sizing: border-box;
    border-radius: 18px;
    background: rgba(255,255,255,0.86);
    border: 1px solid rgba(198, 209, 234, 0.56);
    box-shadow:
      0 14px 36px rgba(119, 138, 181, 0.10),
      0 2px 10px rgba(119, 138, 181, 0.05);
    backdrop-filter: blur(10px);
    padding: 22px 24px 22px 28px;
  }
  body.theme-air .topic-matrix-branch-accent {
    position: absolute;
    left: 0;
    top: 18px;
    bottom: 18px;
    width: 5px;
    border-radius: 0 6px 6px 0;
  }
  body.theme-air .topic-matrix-branch-text {
    font-size: 17px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: -0.02em;
    color: #24324d;
    white-space: normal;
  }
  body.theme-air .topic-matrix-items {
    display: flex;
    flex-direction: column;
  }
  body.theme-air .topic-matrix-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    z-index: 2;
    position: relative;
    box-sizing: border-box;
    border-radius: 14px;
    background: rgba(255,255,255,0.88);
    border: 1px solid rgba(211, 220, 238, 0.58);
    box-shadow:
      0 10px 24px rgba(128, 145, 181, 0.08),
      0 2px 8px rgba(128, 145, 181, 0.04);
    backdrop-filter: blur(10px);
    padding: 12px 16px;
  }
  body.theme-air .topic-matrix-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }
  body.theme-air .topic-matrix-item-copy {
    min-width: 0;
  }
  body.theme-air .topic-matrix-item-title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.45;
    color: #2e3b57;
    letter-spacing: -0.01em;
    white-space: normal;
    word-break: break-word;
  }
  body.theme-air .topic-matrix-item-body {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.5;
    color: #7281a1;
    white-space: normal;
    word-break: break-word;
  }
  body.pdf-export .topic-matrix-branch,
  body.pdf-export .topic-matrix-item,
  body.pdf-export .markmap-foreign > div {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    box-shadow: none !important;
  }
  body.pdf-export .topic-matrix-branch {
    background: #ffffff !important;
    border-color: rgba(166, 181, 214, 0.9) !important;
  }
  body.pdf-export .topic-matrix-item {
    background: #ffffff !important;
    border-color: rgba(188, 201, 229, 0.95) !important;
  }
  body.pdf-export .markmap-foreign > div {
    background: #ffffff !important;
    border-color: rgba(151,173,219,0.72) !important;
  }
  .markmap-node circle {
    fill: #dbe6ff;
    stroke: #f7faff;
    stroke-width: 2px;
  }
  .markmap-link,
  .markmap-node line {
    stroke-width: 2px !important;
    stroke-linecap: round;
    opacity: 0.82;
  }
  .markmap-foreign > div {
    background: rgba(255,255,255,0.92) !important;
    border-radius: 16px !important;
    padding: 10px 14px !important;
    border: 1px solid rgba(151,173,219,0.26) !important;
    box-shadow:
      0 10px 30px rgba(122, 146, 193, 0.10),
      0 2px 8px rgba(122, 146, 193, 0.06) !important;
    backdrop-filter: blur(6px);
  }
  g[data-depth="1"] .markmap-foreign {
    color: #ffffff !important;
    text-shadow: none !important;
  }
  g[data-depth="1"] .markmap-foreign > div {
    background: linear-gradient(135deg, #4c6fff 0%, #6a82ff 52%, #728dff 100%) !important;
    border: 0 !important;
    border-radius: 18px !important;
    padding: 18px 22px !important;
    box-shadow:
      0 18px 42px rgba(76, 111, 255, 0.20),
      0 6px 18px rgba(76, 111, 255, 0.14) !important;
  }
  g[data-depth="1"] line {
    stroke: #6a8dff !important;
  }
  g[data-depth="1"] .markmap-foreign,
  g[data-depth="2"] .markmap-foreign,
  g[data-depth="3"] .markmap-foreign {
    letter-spacing: -0.015em;
    white-space: nowrap !important;
    word-break: keep-all !important;
    overflow-wrap: normal !important;
  }
  g[data-depth="1"] .markmap-foreign {
    font-size: 24px !important;
    font-weight: 700 !important;
  }
  g[data-depth="2"] .markmap-foreign {
    font-size: 20px !important;
    font-weight: 650 !important;
  }
  g[data-depth="3"] .markmap-foreign {
    font-size: 16px !important;
    font-weight: 600 !important;
  }
""",
    },
    "editorial": {
        "bg": "#f4f1ea",
        "text": "#1a1a1a",
        "text_shadow": "0 1px 2px rgba(244,241,234,0.9)",
        "is_dark": False,
        "colors": [
            "#8B2635", "#2D4A3E", "#1E3A5F", "#A67B5B",
            "#5B4A6B", "#8C4A2F", "#3A5A40", "#6B4C35",
            "#4A5568", "#2C5282",
        ],
        "font": "'Fraunces','Noto Serif SC','Source Han Serif SC',serif",
        "body_font": "'Newsreader','Noto Serif SC','Source Han Serif SC',serif",
        "custom_css": """
  body.theme-editorial {
    background-color: #f4f1ea;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
  }
  .markmap-node circle { fill: #1a1a1a; stroke: #f4f1ea; stroke-width: 2.5px; }
  .markmap-node line {
    stroke-width: 2.5px !important;
    stroke-linecap: round;
  }
  .markmap-foreign > div {
    background: rgba(255,255,255,0.45) !important;
    border-radius: 7px !important;
    padding: 7px 11px !important;
    border: 1px solid rgba(26,26,26,0.09) !important;
    box-shadow: 0 2px 6px rgba(26,26,26,0.04) !important;
  }
  .markmap-node-depth-0 text { letter-spacing: -0.02em; }
  .markmap-node-depth-1 text { letter-spacing: -0.01em; }
""",
    },
    "midnight": {
        "bg": "#050508",
        "text": "#e8e6e3",
        "text_shadow": "0 0 6px rgba(0,240,255,0.25), 0 1px 3px rgba(0,0,0,0.9)",
        "is_dark": True,
        "colors": [
            "#00F0FF", "#FF2A6D", "#05FFA1", "#B084FF",
            "#FF7B00", "#FFE600", "#00C2FF", "#FF5C8D",
            "#39FF14", "#BF00FF",
        ],
        "font": "'Chakra Petch','Noto Sans SC','Source Han Sans SC',sans-serif",
        "body_font": "'Chakra Petch','Noto Sans SC','Source Han Sans SC',sans-serif",
        "custom_css": """
  body.theme-midnight {
    background-color: #050508;
    background-image:
      radial-gradient(circle at 15% 25%, rgba(0,240,255,0.06) 0%, transparent 35%),
      radial-gradient(circle at 85% 75%, rgba(255,42,109,0.05) 0%, transparent 35%),
      url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23111' fill-opacity='0.5' fill-rule='evenodd'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/svg%3E");
  }
  .markmap-node circle {
    fill: #00F0FF;
    stroke: #050508;
    stroke-width: 2px;
    filter: drop-shadow(0 0 4px rgba(0,240,255,0.7));
  }
  .markmap-link,
  .markmap-node line {
    filter: drop-shadow(0 0 2px rgba(0,240,255,0.35));
  }
  .markmap-foreign > div {
    background: rgba(12,12,18,0.65) !important;
    border-radius: 5px !important;
    padding: 6px 10px !important;
    border: 1px solid rgba(0,240,255,0.18) !important;
    box-shadow: 0 0 12px rgba(0,240,255,0.08) !important;
  }
  .markmap-node-depth-0 text { text-transform: uppercase; letter-spacing: 0.04em; }
""",
    },
    "zen": {
        "bg": "#F5F3EF",
        "text": "#3D3B39",
        "text_shadow": "0 1px 2px rgba(245,243,239,0.9)",
        "is_dark": False,
        "colors": [
            "#7A9E7E", "#B89A84", "#C97B7B", "#6B7280",
            "#C4A35A", "#8B9DAE", "#A38B7A", "#8FA68E",
            "#B08D8D", "#9E8F7D",
        ],
        "font": "'Zen Kurenaido','Noto Serif SC','Source Han Serif SC',serif",
        "body_font": "'Klee One','Noto Serif SC','Source Han Serif SC',serif",
        "custom_css": """
  body.theme-zen {
    background-color: #F5F3EF;
    background-image:
      radial-gradient(circle at 80% 20%, rgba(122,158,126,0.06) 0%, transparent 40%),
      url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='w'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.5' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.35 0 0 0 0 0.35 0 0 0 0 0.32 0 0 0 0.12 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23w)' opacity='0.18'/%3E%3C/svg%3E");
  }
  .markmap-node circle {
    fill: #7A9E7E;
    stroke: #F5F3EF;
    stroke-width: 2px;
  }
  .markmap-link,
  .markmap-node line {
    stroke-width: 1.8px !important;
    opacity: 0.75;
  }
  .markmap-foreign > div {
    background: rgba(255,255,255,0.55) !important;
    border-radius: 12px !important;
    padding: 8px 13px !important;
    border: 1px solid rgba(122,158,126,0.15) !important;
    box-shadow: 0 3px 10px rgba(61,59,57,0.03) !important;
  }
  .markmap-node text { font-weight: 500 !important; }
  .markmap-node-depth-0 text { font-weight: 700 !important; letter-spacing: 0.02em; }
  .markmap-node-depth-1 text { font-weight: 600 !important; }
  .markmap-node-depth-2 text { font-weight: 500 !important; }
""",
    },
    "prism": {
        "bg": "#FFFFFF",
        "text": "#111111",
        "text_shadow": "none",
        "is_dark": False,
        "colors": [
            "#FF2D55", "#FF6A00", "#FFB800", "#22C55E",
            "#06B6D4", "#2563EB", "#7C3AED", "#EC4899",
            "#14B8A6", "#F97316",
        ],
        "font": "'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif",
        "body_font": "'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif",
        "custom_css": """
  body.theme-prism {
    background: #FFFFFF;
  }
  .markmap-node circle {
    stroke: #FFFFFF;
    stroke-width: 2px;
  }
  .markmap-node line {
    stroke-width: 2.5px !important;
  }
  .markmap-foreign > div {
    background: #FFFFFF !important;
    border-radius: 0 !important;
    padding: 8px 14px !important;
    border: 2px solid currentColor !important;
    box-shadow: none !important;
  }
  .markmap-node text,
  .markmap-foreign {
    text-shadow: none !important;
  }
  .markmap-node-depth-0 text,
  .markmap-node-depth-1 text,
  .markmap-node-depth-2 text {
    letter-spacing: 0 !important;
    font-weight: 700 !important;
  }
""",
    },
    "orthogonal": {
        "bg": "#FFFFFF",
        "text": "#111111",
        "text_shadow": "none",
        "is_dark": False,
        "orthogonal_links": True,
        "colors": [
            "#FF2D55", "#FF6A00", "#FFB800", "#22C55E",
            "#06B6D4", "#2563EB", "#7C3AED", "#EC4899",
            "#14B8A6", "#F97316",
        ],
        "font": "'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif",
        "body_font": "'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif",
        "custom_css": """
  body.theme-orthogonal {
    background: #FFFFFF;
  }
  .markmap-node circle {
    stroke: #FFFFFF;
    stroke-width: 2px;
  }
  .markmap-link,
  .markmap-node line {
    stroke-width: 2.5px !important;
    stroke-linecap: butt !important;
    stroke-linejoin: miter !important;
  }
  .markmap-foreign > div {
    background: #FFFFFF !important;
    border-radius: 0 !important;
    padding: 8px 14px !important;
    border: 2px solid currentColor !important;
    box-shadow: none !important;
  }
  .markmap-node text,
  .markmap-foreign {
    text-shadow: none !important;
  }
  .markmap-node-depth-0 text,
  .markmap-node-depth-1 text,
  .markmap-node-depth-2 text {
    letter-spacing: 0 !important;
    font-weight: 700 !important;
  }
""",
    },
}


MARKMAP_SCRIPT_URLS = [
    "https://cdn.jsdelivr.net/npm/markmap-autoloader@0.17.2/dist/index.min.js",
    "https://unpkg.com/markmap-autoloader@0.17.2/dist/index.min.js",
]


JS_HELPERS = """
  function fixForeignObjects() {
    const svg = document.querySelector('.markmap svg');
    if (!svg) return;
    svg.querySelectorAll('foreignObject.markmap-foreign').forEach(function(fo) {
      const div = fo.querySelector('div');
      if (!div) return;
      const neededHeight = Math.ceil(div.scrollHeight);
      const neededWidth = Math.ceil(div.scrollWidth);
      const currentH = parseFloat(fo.getAttribute('height') || 0);
      const currentW = parseFloat(fo.getAttribute('width') || 0);
      if (neededHeight > currentH) fo.setAttribute('height', neededHeight);
      if (neededWidth > currentW) fo.setAttribute('width', neededWidth);
    });
  }

  function hexToRgb(hex) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      switch (mx) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const R = Math.round(255 * f(0));
    const G = Math.round(255 * f(8));
    const B = Math.round(255 * f(4));
    return '#' + [R, G, B].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function shade(hex, depth, isDark) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const step = Math.max(0, depth - 1);
    let newL;
    let newS;
    if (isDark) {
      newL = Math.max(45, l - step * 5);
      newS = Math.max(55, s - step * 3);
    } else {
      newL = Math.min(62, l + step * 6);
      newS = Math.max(32, s - step * 4);
    }
    return hslToHex(h, newS, newL);
  }

  function applyFamilyShading(baseColors, isDark) {
    const svg = document.querySelector('.markmap svg');
    if (!svg) return;
    const nodeGs = Array.from(svg.querySelectorAll('g.markmap-node'));
    const nodeColors = new Map();
    nodeGs.forEach(g => {
      const d = g.__data__;
      if (!d) return;
      if (d.depth === 0) {
        const rootCircle = g.querySelector('circle');
        if (rootCircle) {
          rootCircle.style.display = 'none';
        }
        return;
      }
      let top = d;
      while (top.parent && top.depth > 1) top = top.parent;
      const siblings = (top.parent && top.parent.children) || [];
      const idx = Math.max(0, siblings.indexOf(top));
      const base = baseColors[idx % baseColors.length];
      const color = shade(base, d.depth, isDark);
      nodeColors.set(d, color);
      const circle = g.querySelector('circle');
      if (circle) {
        circle.style.fill = color;
        circle.style.stroke = color;
        circle.style.display = 'none';
      }
      const line = g.querySelector('line');
      if (line) line.style.stroke = color;
      const card = g.querySelector('.markmap-foreign > div');
      if (card) {
        card.style.setProperty('border-color', color, 'important');
      }
    });
    const links = Array.from(svg.querySelectorAll('path.markmap-link'));
    links.forEach(path => {
      const d = path.__data__;
      if (!d) return;
      const target = d.target || d;
      const color = nodeColors.get(target);
      if (color) path.style.stroke = color;
    });
  }

  function parseCubicPath(pathData) {
    const match = /^M([-\\d.]+),([-\\d.]+)C([-\\d.]+),([-\\d.]+),([-\\d.]+),([-\\d.]+),([-\\d.]+),([-\\d.]+)$/.exec(pathData);
    if (!match) return null;
    return {
      sx: parseFloat(match[1]),
      sy: parseFloat(match[2]),
      cx1: parseFloat(match[3]),
      cy1: parseFloat(match[4]),
      cx2: parseFloat(match[5]),
      cy2: parseFloat(match[6]),
      ex: parseFloat(match[7]),
      ey: parseFloat(match[8]),
    };
  }

  function applyOrthogonalLinks() {
    const svg = document.querySelector('.markmap svg');
    if (!svg) return;
    svg.querySelectorAll('path.markmap-link').forEach(path => {
      const d = path.getAttribute('d');
      const parsed = parseCubicPath(d || '');
      if (!parsed) return;
      const midX = parsed.sx + (parsed.ex - parsed.sx) / 2;
      path.setAttribute(
        'd',
        `M${parsed.sx},${parsed.sy}H${midX}V${parsed.ey}H${parsed.ex}`
      );
    });
  }

  function createSvgElement(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      el.setAttribute(key, String(value));
    });
    return el;
  }

  function getHierarchyRootData() {
    const svg = document.querySelector('.markmap svg');
    if (!svg) return null;
    const firstNode = Array.from(svg.querySelectorAll('g.markmap-node'))
      .map(g => g.__data__)
      .find(d => d && d.data);
    if (!firstNode) return null;
    let root = firstNode;
    while (root.parent && root.parent.data) {
      root = root.parent;
    }
    return root.data || null;
  }

  function decodeHtmlEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text || '';
    return textarea.value;
  }

  function buildRenderableTree(node) {
    const children = Array.isArray(node.children) ? node.children : [];
    return {
      title: decodeHtmlEntities((node.content || '').trim()),
      children: children
        .map(child => buildRenderableTree(child))
        .filter(child => child.title),
      level: 0,
      siblingIndex: 0,
      siblingCount: 1,
      color: '',
      card: null,
      cardWidth: 0,
      cardHeight: 0,
      subtreeHeight: 0,
      left: 0,
      top: 0,
    };
  }

  function getRelativeRect(element, ancestor) {
    const rect = element.getBoundingClientRect();
    const ancestorRect = ancestor.getBoundingClientRect();
    const left = rect.left - ancestorRect.left;
    const top = rect.top - ancestorRect.top;
    return {
      left,
      top,
      right: left + rect.width,
      bottom: top + rect.height,
      width: rect.width,
      height: rect.height,
      cx: left + rect.width / 2,
      cy: top + rect.height / 2,
    };
  }

  function styleTopicMatrixConnector(path, color, width) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', width);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }

  function splitBranchesForDistribution(branches, distribution) {
    if (distribution !== 'balanced' || branches.length <= 1) {
      return { left: [], right: branches.slice() };
    }
    const midpoint = Math.ceil(branches.length / 2);
    return {
      left: branches.slice(0, midpoint),
      right: branches.slice(midpoint),
    };
  }

  function getLevelWidth(level, layoutConfig) {
    return level === 0 ? layoutConfig.branch_width : layoutConfig.item_width;
  }

  function getColumnGap(layoutConfig) {
    return layoutConfig.column_gap || layoutConfig.branch_gap;
  }

  function getFirstColumnGap(layoutConfig) {
    return layoutConfig.first_column_gap || Math.max(40, layoutConfig.groups_left - (layoutConfig.root_left + layoutConfig.root_width));
  }

  function getSideMaxDepth(nodes) {
    function getNodeDepth(node) {
      if (!node.children.length) return 1;
      return 1 + Math.max(...node.children.map(getNodeDepth));
    }
    if (!nodes.length) return 0;
    return Math.max(...nodes.map(getNodeDepth));
  }

  function getSideWidth(depth, layoutConfig) {
    if (depth <= 0) return 0;
    let total = getFirstColumnGap(layoutConfig);
    for (let level = 0; level < depth; level += 1) {
      total += getLevelWidth(level, layoutConfig);
      if (level < depth - 1) total += getColumnGap(layoutConfig);
    }
    return total;
  }

  function getTopicMatrixCanvasWidth(layoutConfig, distribution, leftDepth, rightDepth) {
    if (distribution !== 'balanced') {
      return Math.max(
        layoutConfig.canvas_width,
        layoutConfig.root_left + layoutConfig.root_width + getSideWidth(rightDepth, layoutConfig) + layoutConfig.padding_right + 48
      );
    }
    const sidePadding = layoutConfig.side_padding || 32;
    return sidePadding * 2 + getSideWidth(leftDepth, layoutConfig) + layoutConfig.root_width + getSideWidth(rightDepth, layoutConfig);
  }

  function createTreeCard(node, level, color) {
    if (level === 0) {
      const branchCard = document.createElement('div');
      branchCard.className = 'topic-matrix-branch';
      branchCard.style.width = `${node.cardWidth || getLevelWidth(level, { branch_width: 240, item_width: 454 })}px`;
      const accent = document.createElement('span');
      accent.className = 'topic-matrix-branch-accent';
      accent.style.background = color;
      const branchText = document.createElement('div');
      branchText.className = 'topic-matrix-branch-text';
      branchText.textContent = node.title;
      branchCard.append(accent, branchText);
      return branchCard;
    }

    const card = document.createElement('div');
    card.className = 'topic-matrix-item';

    const copy = document.createElement('div');
    copy.className = 'topic-matrix-item-copy';
    const title = document.createElement('div');
    title.className = 'topic-matrix-item-title';
    title.textContent = node.title;
    copy.appendChild(title);

    if (node.siblingCount > 1) {
      const badge = document.createElement('span');
      badge.className = 'topic-matrix-badge';
      badge.textContent = String(node.siblingIndex + 1);
      badge.style.color = color;
      badge.style.background = `${color}14`;
      badge.style.border = `1px solid ${color}33`;
      card.append(badge, copy);
    } else {
      card.append(copy);
    }
    return card;
  }

  function initializeTreeNodes(nodes, content, baseColors, startIndex, level) {
    nodes.forEach((node, index) => {
      node.level = level;
      node.siblingIndex = index;
      node.siblingCount = nodes.length;
      node.color = baseColors[(startIndex + index) % baseColors.length];
      const card = createTreeCard(node, level, node.color);
      card.style.position = 'absolute';
      card.style.width = `${getLevelWidth(level, window.__TOPIC_MATRIX_LAYOUT_CONFIG__)}px`;
      node.card = card;
      content.appendChild(card);
      initializeTreeNodes(node.children, content, [node.color], 0, level + 1);
    });
  }

  function computeTreeMetrics(node, layoutConfig) {
    node.cardWidth = node.card.offsetWidth;
    node.cardHeight = node.card.offsetHeight;
    if (!node.children.length) {
      node.subtreeHeight = node.cardHeight;
      return node.subtreeHeight;
    }

    const gap = layoutConfig.item_gap;
    const childrenHeight = node.children.reduce((sum, child) => sum + computeTreeMetrics(child, layoutConfig), 0)
      + gap * Math.max(0, node.children.length - 1);
    node.subtreeHeight = Math.max(node.cardHeight, childrenHeight);
    return node.subtreeHeight;
  }

  function getTopLevelBlockHeight(nodes, layoutConfig) {
    if (!nodes.length) return 0;
    return nodes.reduce((sum, node) => sum + node.subtreeHeight, 0) + layoutConfig.group_gap * Math.max(0, nodes.length - 1);
  }

  function getRightColumnXs(rootRect, depth, layoutConfig) {
    const xs = [];
    let currentX = rootRect.right + getFirstColumnGap(layoutConfig);
    for (let level = 0; level < depth; level += 1) {
      xs.push(currentX);
      currentX += getLevelWidth(level, layoutConfig) + getColumnGap(layoutConfig);
    }
    return xs;
  }

  function getLeftColumnXs(rootRect, depth, layoutConfig) {
    const xs = [];
    if (depth <= 0) return xs;
    let currentX = rootRect.left - getFirstColumnGap(layoutConfig) - getLevelWidth(0, layoutConfig);
    xs.push(currentX);
    for (let level = 1; level < depth; level += 1) {
      currentX -= getColumnGap(layoutConfig) + getLevelWidth(level, layoutConfig);
      xs.push(currentX);
    }
    return xs;
  }

  function layoutTreeNode(node, columnXs, topY, layoutConfig) {
    node.left = columnXs[node.level];
    node.top = topY + (node.subtreeHeight - node.cardHeight) / 2;
    node.card.style.left = `${node.left}px`;
    node.card.style.top = `${node.top}px`;

    if (!node.children.length) return;

    const childrenBlockHeight = node.children.reduce((sum, child) => sum + child.subtreeHeight, 0)
      + layoutConfig.item_gap * Math.max(0, node.children.length - 1);
    let childTop = topY + (node.subtreeHeight - childrenBlockHeight) / 2;
    node.children.forEach(child => {
      layoutTreeNode(child, columnXs, childTop, layoutConfig);
      childTop += child.subtreeHeight + layoutConfig.item_gap;
    });
  }

  function layoutTopLevelNodes(nodes, columnXs, startY, layoutConfig) {
    let currentY = startY;
    nodes.forEach(node => {
      layoutTreeNode(node, columnXs, currentY, layoutConfig);
      currentY += node.subtreeHeight + layoutConfig.group_gap;
    });
  }

  function getNodeRect(node) {
    return {
      left: node.left,
      top: node.top,
      right: node.left + node.cardWidth,
      bottom: node.top + node.cardHeight,
      cx: node.left + node.cardWidth / 2,
      cy: node.top + node.cardHeight / 2,
    };
  }

  function getHubOffset(distance, layoutConfig) {
    return Math.max(18, Math.min(layoutConfig.branch_hub_gap, distance / 2));
  }

  function drawNodeChildrenConnectors(svg, node, side, layoutConfig, connectorColor) {
    if (!node.children.length) return;

    const parentRect = getNodeRect(node);
    const childRects = node.children.map(child => getNodeRect(child));

    if (side === 'right') {
      const hubX = parentRect.right + getHubOffset(childRects[0].left - parentRect.right, layoutConfig);
      const parentToHub = createSvgElement('path', {
        d: `M ${parentRect.right} ${parentRect.cy} C ${parentRect.right + 12} ${parentRect.cy} ${hubX - 12} ${parentRect.cy} ${hubX} ${parentRect.cy}`,
      });
      styleTopicMatrixConnector(parentToHub, connectorColor, 2);
      svg.appendChild(parentToHub);

      if (childRects.length > 1) {
        const hubLine = createSvgElement('path', {
          d: `M ${hubX} ${childRects[0].cy} V ${childRects[childRects.length - 1].cy}`,
        });
        styleTopicMatrixConnector(hubLine, connectorColor, 2);
        svg.appendChild(hubLine);
      }

      node.children.forEach((child, index) => {
        const childRect = childRects[index];
        const childPath = createSvgElement('path', {
          d: `M ${hubX} ${childRect.cy} C ${hubX + 10} ${childRect.cy} ${childRect.left - 14} ${childRect.cy} ${childRect.left} ${childRect.cy}`,
        });
        styleTopicMatrixConnector(childPath, connectorColor, 2);
        svg.appendChild(childPath);
        drawNodeChildrenConnectors(svg, child, side, layoutConfig, connectorColor);
      });
    } else {
      const hubX = parentRect.left - getHubOffset(parentRect.left - childRects[0].right, layoutConfig);
      const parentToHub = createSvgElement('path', {
        d: `M ${parentRect.left} ${parentRect.cy} C ${parentRect.left - 12} ${parentRect.cy} ${hubX + 12} ${parentRect.cy} ${hubX} ${parentRect.cy}`,
      });
      styleTopicMatrixConnector(parentToHub, connectorColor, 2);
      svg.appendChild(parentToHub);

      if (childRects.length > 1) {
        const hubLine = createSvgElement('path', {
          d: `M ${hubX} ${childRects[0].cy} V ${childRects[childRects.length - 1].cy}`,
        });
        styleTopicMatrixConnector(hubLine, connectorColor, 2);
        svg.appendChild(hubLine);
      }

      node.children.forEach((child, index) => {
        const childRect = childRects[index];
        const childPath = createSvgElement('path', {
          d: `M ${hubX} ${childRect.cy} C ${hubX - 10} ${childRect.cy} ${childRect.right + 14} ${childRect.cy} ${childRect.right} ${childRect.cy}`,
        });
        styleTopicMatrixConnector(childPath, connectorColor, 2);
        svg.appendChild(childPath);
        drawNodeChildrenConnectors(svg, child, side, layoutConfig, connectorColor);
      });
    }
  }

  function drawRootSideConnectors(svg, rootRect, nodes, side, layoutConfig, connectorColor) {
    if (!nodes.length) return;
    if (side === 'right') {
      const trunkX = rootRect.right + layoutConfig.root_trunk_gap;
      const rootLine = createSvgElement('path', {
        d: `M ${rootRect.right} ${rootRect.cy} H ${trunkX}`,
      });
      styleTopicMatrixConnector(rootLine, connectorColor, 2.2);
      svg.appendChild(rootLine);

      const nodeRects = nodes.map(node => getNodeRect(node));
      if (nodeRects.length > 1) {
        const vertical = createSvgElement('path', {
          d: `M ${trunkX} ${nodeRects[0].cy} V ${nodeRects[nodeRects.length - 1].cy}`,
        });
        styleTopicMatrixConnector(vertical, connectorColor, 2.2);
        svg.appendChild(vertical);
      }

      nodes.forEach((node, index) => {
        const rect = nodeRects[index];
        const path = createSvgElement('path', {
          d: `M ${trunkX} ${rect.cy} C ${trunkX + 16} ${rect.cy} ${rect.left - 18} ${rect.cy} ${rect.left} ${rect.cy}`,
        });
        styleTopicMatrixConnector(path, connectorColor, 2.2);
        svg.appendChild(path);
        drawNodeChildrenConnectors(svg, node, side, layoutConfig, connectorColor);
      });
    } else {
      const trunkX = rootRect.left - layoutConfig.root_trunk_gap;
      const rootLine = createSvgElement('path', {
        d: `M ${rootRect.left} ${rootRect.cy} H ${trunkX}`,
      });
      styleTopicMatrixConnector(rootLine, connectorColor, 2.2);
      svg.appendChild(rootLine);

      const nodeRects = nodes.map(node => getNodeRect(node));
      if (nodeRects.length > 1) {
        const vertical = createSvgElement('path', {
          d: `M ${trunkX} ${nodeRects[0].cy} V ${nodeRects[nodeRects.length - 1].cy}`,
        });
        styleTopicMatrixConnector(vertical, connectorColor, 2.2);
        svg.appendChild(vertical);
      }

      nodes.forEach((node, index) => {
        const rect = nodeRects[index];
        const path = createSvgElement('path', {
          d: `M ${trunkX} ${rect.cy} C ${trunkX - 16} ${rect.cy} ${rect.right + 18} ${rect.cy} ${rect.right} ${rect.cy}`,
        });
        styleTopicMatrixConnector(path, connectorColor, 2.2);
        svg.appendChild(path);
        drawNodeChildrenConnectors(svg, node, side, layoutConfig, connectorColor);
      });
    }
  }

  function renderTopicMatrixLayout(baseColors, layoutConfig) {
    const host = document.querySelector('.markmap');
    const wrapper = document.getElementById('mindmap-wrapper');
    if (!host || !wrapper || wrapper.dataset.customLayoutApplied === 'topic-matrix') {
      return;
    }

    const rootData = getHierarchyRootData();
    if (!rootData || !Array.isArray(rootData.children) || !rootData.children.length) {
      return;
    }

    const rootTree = buildRenderableTree(rootData);
    const distribution = layoutConfig.distribution || 'single-right';
    const split = splitBranchesForDistribution(rootTree.children, distribution);
    const leftDepth = getSideMaxDepth(split.left);
    const rightDepth = getSideMaxDepth(split.right);

    wrapper.dataset.customLayoutApplied = 'topic-matrix';
    window.__TOPIC_MATRIX_LAYOUT_CONFIG__ = layoutConfig;

    host.innerHTML = '';
    host.classList.add('topic-matrix-host');

    const layout = document.createElement('div');
    layout.className = 'topic-matrix';
    layout.style.width = `${getTopicMatrixCanvasWidth(layoutConfig, distribution, leftDepth, rightDepth)}px`;

    const background = document.createElement('div');
    background.className = 'topic-matrix-background';

    const content = document.createElement('div');
    content.className = 'topic-matrix-content';
    content.style.paddingTop = `${layoutConfig.padding_y}px`;
    content.style.paddingBottom = `${layoutConfig.padding_y}px`;
    content.style.paddingRight = `${layoutConfig.padding_right}px`;

    const svg = createSvgElement('svg', { class: 'topic-matrix-svg' });

    const rootCard = document.createElement('div');
    rootCard.className = 'topic-matrix-root';
    rootCard.style.width = `${layoutConfig.root_width}px`;
    const rootText = document.createElement('div');
    rootText.className = 'topic-matrix-root-text';
    rootText.textContent = rootTree.title;
    rootCard.appendChild(rootText);
    rootCard.style.position = 'absolute';

    content.append(rootCard);
    layout.append(background, svg, content);
    host.appendChild(layout);

    initializeTreeNodes(split.left, content, baseColors, 0, 0);
    initializeTreeNodes(split.right, content, baseColors, split.left.length, 0);

    split.left.forEach(node => computeTreeMetrics(node, layoutConfig));
    split.right.forEach(node => computeTreeMetrics(node, layoutConfig));

    const rootHeight = rootCard.offsetHeight;
    const rootWidth = rootCard.offsetWidth;
    const leftBlockHeight = getTopLevelBlockHeight(split.left, layoutConfig);
    const rightBlockHeight = getTopLevelBlockHeight(split.right, layoutConfig);
    const sideBlockHeight = Math.max(leftBlockHeight, rightBlockHeight, rootHeight);
    const totalHeight = sideBlockHeight + layoutConfig.padding_y * 2;

    let rootLeft = layoutConfig.root_left;
    if (distribution === 'balanced') {
      const sidePadding = layoutConfig.side_padding || 32;
      rootLeft = sidePadding + getSideWidth(leftDepth, layoutConfig);
    }
    const rootTop = layoutConfig.padding_y + (sideBlockHeight - rootHeight) / 2;
    rootCard.style.left = `${rootLeft}px`;
    rootCard.style.top = `${rootTop}px`;

    const rootRect = getRelativeRect(rootCard, content);
    const leftColumnXs = getLeftColumnXs(rootRect, leftDepth, layoutConfig);
    const rightColumnXs = getRightColumnXs(rootRect, rightDepth, layoutConfig);

    layoutTopLevelNodes(
      split.left,
      leftColumnXs,
      layoutConfig.padding_y + (sideBlockHeight - leftBlockHeight) / 2,
      layoutConfig
    );
    layoutTopLevelNodes(
      split.right,
      rightColumnXs,
      layoutConfig.padding_y + (sideBlockHeight - rightBlockHeight) / 2,
      layoutConfig
    );

    layout.style.height = `${totalHeight}px`;
    svg.setAttribute('width', String(layout.offsetWidth));
    svg.setAttribute('height', String(totalHeight));
    svg.setAttribute('viewBox', `0 0 ${layout.offsetWidth} ${totalHeight}`);

    drawRootSideConnectors(svg, rootRect, split.left, 'left', layoutConfig, '#c6d5fb');
    drawRootSideConnectors(svg, rootRect, split.right, 'right', layoutConfig, '#c6d5fb');

    wrapper.style.minWidth = `${layout.offsetWidth + 24}px`;
    wrapper.style.minHeight = `${Math.ceil(totalHeight)}px`;
  }

  function runPasses(baseColors, isDark, orthogonalLinks, customLayout, layoutConfig) {
    if (customLayout === 'topic-matrix') {
      renderTopicMatrixLayout(baseColors, layoutConfig);
      return;
    }
    fixForeignObjects();
    applyFamilyShading(baseColors, isDark);
    if (orthogonalLinks) applyOrthogonalLinks();
  }
"""


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  html, body {{
    margin: 0;
    padding: 0;
    color: {text};
    font-family: {body_font};
    overflow: visible;
  }}
  body.{theme_class} {{ background: {bg}; }}

  #mindmap-wrapper {{
    display: inline-block;
    min-width: 100vw;
    min-height: 100vh;
    padding: 80px;
    box-sizing: border-box;
  }}
  /* Prevent markmap from creating a tiny 300x150 SVG on load */
  .markmap {{
    display: block;
    min-width: 2000px;
    min-height: 2000px;
  }}
  .markmap svg {{
    width: 100%;
    height: 100%;
    display: block;
  }}

  /*
   * CRITICAL: .markmap-foreign is the class markmap uses BOTH for its internal
   * measurement div (appended to <body>) AND for the final <foreignObject> in SVG.
   * Styles here affect sizing calculations, so we must keep them consistent with
   * the final rendered look.
   */
  .markmap-foreign {{
    font-family: {body_font} !important;
    font-size: 15px !important;
    font-weight: 500 !important;
    line-height: 1.75 !important;
    color: {text} !important;
    max-width: 520px !important;
    white-space: normal !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    text-shadow: {text_shadow} !important;
  }}

  /* Slightly smaller for very deep descriptive leaves */
  .markmap-node-depth-4 .markmap-foreign,
  .markmap-node-depth-5 .markmap-foreign {{
    font-size: 13px !important;
    line-height: 1.8 !important;
  }}

  /* SVG text nodes (shallow, usually single-line) */
  .markmap-node text {{
    font-size: 15px !important;
    font-weight: 600;
    fill: {text} !important;
    text-shadow: {text_shadow};
  }}
  .markmap-node-depth-0 text {{
    font-family: {font} !important;
    font-size: 26px !important;
    font-weight: 700;
  }}
  .markmap-node-depth-1 text {{
    font-family: {font} !important;
    font-size: 21px !important;
    font-weight: 650;
  }}
  .markmap-node-depth-2 text {{
    font-family: {font} !important;
    font-size: 17px !important;
    font-weight: 600;
  }}

  .markmap-link,
  .markmap-node line {{
    stroke-width: 2.5px;
    stroke-linecap: round;
  }}

  /* Theme-specific injected CSS */
  {custom_css}
</style>
</head>
<body class="{theme_class}">
<div id="mindmap-wrapper">
  <div class="markmap" id="target-markmap">
    <script type="text/template">{markdown_html}</script>
  </div>
</div>
<script>
(function() {{
  const BASE_COLORS = {base_colors_json};
  const IS_DARK = {is_dark_js};
  const ORTHOGONAL_LINKS = {orthogonal_links_js};
  const CUSTOM_LAYOUT = {custom_layout_js};
  const LAYOUT_CONFIG = {layout_config_json};
  const MARKMAP_SCRIPT_URLS = {markmap_script_urls_json};
  const MD_FILE = '{md_filename}';

  window.markmap = window.markmap || {{}};
  window.markmap.autoLoader = Object.assign({{}}, window.markmap.autoLoader, {{
    manual: true,
  }});
  window.__MARKMAP_READY__ = false;
  window.__MARKMAP_ERROR__ = null;

  {js_helpers}

  function escapeHtml(text) {{
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }}

  async function loadMdAndRender() {{
    if (MD_FILE) {{
      try {{
        const response = await fetch('./' + MD_FILE);
        if (response.ok) {{
          const md = await response.text();
          const container = document.getElementById('target-markmap');
          if (container) {{
            container.innerHTML = '<script type="text/template">' + escapeHtml(md) + '<\\/script>';
          }}
        }}
      }} catch (e) {{
        // fetch failed (file:// protocol or network error), use embedded fallback
      }}
    }}
    loadMarkmapScripts(MARKMAP_SCRIPT_URLS);
  }}

  function schedulePasses() {{
    setTimeout(function() {{ runPasses(BASE_COLORS, IS_DARK, ORTHOGONAL_LINKS, CUSTOM_LAYOUT, LAYOUT_CONFIG); }}, 600);
    setTimeout(function() {{ runPasses(BASE_COLORS, IS_DARK, ORTHOGONAL_LINKS, CUSTOM_LAYOUT, LAYOUT_CONFIG); }}, 1400);
  }}

  function waitForSvg(attemptsLeft) {{
    if (document.querySelector('.markmap svg')) {{
      schedulePasses();
      return;
    }}
    if (window.__MARKMAP_ERROR__ || attemptsLeft <= 0) return;
    setTimeout(function() {{ waitForSvg(attemptsLeft - 1); }}, 250);
  }}

  function loadMarkmapScripts(urls) {{
    const remaining = urls.slice();

    function tryNext() {{
      const src = remaining.shift();
      if (!src) {{
        window.__MARKMAP_ERROR__ = 'Failed to load markmap-autoloader from all configured CDNs.';
        return;
      }}
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function() {{
        window.__MARKMAP_READY__ = true;
        if (window.markmap && window.markmap.autoLoader && window.markmap.autoLoader.renderAll) {{
          window.markmap.autoLoader.renderAll();
        }}
        waitForSvg(120);
      }};
      script.onerror = function() {{
        script.remove();
        tryNext();
      }};
      document.head.appendChild(script);
    }}

    tryNext();
  }}

  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', function() {{
      loadMdAndRender();
    }}, {{ once: true }});
  }} else {{
    loadMdAndRender();
  }}
}})();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def sanitize_filename(name: str) -> str:
    """Turn a title into a safe file base name."""
    name = re.sub(r"[^\w\u4e00-\u9fa5\- ]+", "_", name)
    name = re.sub(r"_+", "_", name).strip(" _")
    return name or "mindmap"


FRONTMATTER_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+\s*:")


def strip_yaml_frontmatter(markdown_text: str) -> str:
    """Strip a leading YAML frontmatter block when it is clearly present."""
    lines = markdown_text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return markdown_text

    closing_index = None
    for idx, line in enumerate(lines[1:], start=1):
        if line.strip() in {"---", "..."}:
            closing_index = idx
            break

    if closing_index is None:
        return markdown_text

    frontmatter_lines = [
        line.strip()
        for line in lines[1:closing_index]
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if not frontmatter_lines:
        return markdown_text
    if not any(FRONTMATTER_KEY_RE.match(line) for line in frontmatter_lines):
        return markdown_text

    return "".join(lines[closing_index + 1 :]).lstrip("\r\n")


LIST_ITEM_RE = re.compile(r"^(?P<indent>[ \t]*)(?P<marker>[-*+])\s+(?P<text>.+?)\s*$")


def promote_single_root_list_item(markdown_text: str) -> str:
    """Turn a single top-level list root into an H1 so markmap won't add an empty synthetic root."""
    lines = markdown_text.splitlines()
    matches = []
    top_level_items = []

    for idx, line in enumerate(lines):
        match = LIST_ITEM_RE.match(line)
        matches.append(match)
        if match:
            indent_len = len(match.group("indent"))
            if not top_level_items or indent_len < top_level_items[0][1]:
                top_level_items = [(idx, indent_len, match.group("text"))]
            elif indent_len == top_level_items[0][1]:
                top_level_items.append((idx, indent_len, match.group("text")))

    if len(top_level_items) != 1:
        return markdown_text

    root_idx, root_indent, root_text = top_level_items[0]
    if root_idx != 0:
        return markdown_text

    child_lines = lines[root_idx + 1 :]
    positive_deltas = []
    for line in child_lines:
        if not line.strip():
            continue
        indent_len = len(line) - len(line.lstrip(" \t"))
        delta = indent_len - root_indent
        if delta > 0:
            positive_deltas.append(delta)
    outdent = min(positive_deltas) if positive_deltas else 0

    normalized_children = []
    for line in child_lines:
        if outdent > 0 and line.startswith(" " * outdent):
            normalized_children.append(line[outdent:])
        else:
            normalized_children.append(line)

    body = "\n".join(normalized_children).strip("\n")
    if body:
        return f"# {root_text}\n\n{body}\n"
    return f"# {root_text}\n"


def normalize_markdown_for_markmap(markdown_text: str) -> str:
    """Normalize user outline into the shape markmap renders correctly."""
    return promote_single_root_list_item(markdown_text)


def positive_int(value: str) -> int:
    """argparse type that only accepts integers >= 1."""
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be >= 1")
    return parsed


def theme_uses_custom_layout_export(theme_def: dict) -> bool:
    """Whether the theme renders via a custom HTML layout instead of native markmap SVG."""
    return bool(theme_def.get("layout"))


def resolve_layout_config(theme_def: dict, layout_distribution: str | None = None) -> dict:
    """Resolve custom layout config with optional distribution override."""
    config = dict(theme_def.get("layout_config", {}))
    if layout_distribution:
        config["distribution"] = layout_distribution
    config.setdefault("distribution", "single-right")
    return config


def resolve_custom_layout_export_config(bbox: dict, scale: int) -> dict:
    """Export custom HTML layouts as tiles to avoid giant single-surface raster glitches."""
    width = max(int(bbox["width"]), 400)
    height = max(int(bbox["height"]), 400)
    device_scale_factor = max(int(scale), 1)
    max_tile_css = max(256, MAX_CUSTOM_LAYOUT_TILE_PHYSICAL // device_scale_factor)
    viewport_width = min(width, max_tile_css)
    viewport_height = min(height, max_tile_css)
    tiles = []
    for y in range(0, height, viewport_height):
        for x in range(0, width, viewport_width):
            tiles.append(
                {
                    "x": x,
                    "y": y,
                    "width": min(viewport_width, width - x),
                    "height": min(viewport_height, height - y),
                }
            )
    return {
        "origin_x": max(int(bbox.get("x", 0)), 0),
        "origin_y": max(int(bbox.get("y", 0)), 0),
        "viewport_width": viewport_width,
        "viewport_height": viewport_height,
        "device_scale_factor": device_scale_factor,
        "image_width": width,
        "image_height": height,
        "tiles": tiles,
    }


def resolve_vector_pdf_export_config(bbox: dict) -> dict:
    """Render PDF as a single browser-printed page so text/lines stay vector."""
    width = max(int(bbox["width"]), 400)
    height = max(int(bbox["height"]), 400)
    return {
        "width": f"{width}px",
        "height": f"{height}px",
        "print_background": True,
        "prefer_css_page_size": False,
        "margin": {"top": "0", "right": "0", "bottom": "0", "left": "0"},
        "page_ranges": "1",
    }


def resolve_compressed_image_export_config(format_name: str, quality: int) -> dict:
    """Resolve optional lightweight companion image export settings."""
    normalized_format = format_name.lower()
    if normalized_format != "webp":
        raise ValueError(f"unsupported compressed image format: {format_name}")
    if not 1 <= int(quality) <= 100:
        raise ValueError("compressed image quality must be between 1 and 100")
    return {
        "suffix": ".webp",
        "pil_format": "WEBP",
        "quality": int(quality),
        "method": 6,
    }


async def export_custom_layout_png(page, png_file: Path, export_config: dict) -> None:
    """Capture a custom layout as one or more viewport-sized tiles and stitch them."""
    tiles = export_config["tiles"]
    if not tiles:
        raise RuntimeError("custom layout export produced no tiles")

    await page.set_viewport_size(
        {
            "width": export_config["viewport_width"],
            "height": export_config["viewport_height"],
        }
    )

    if len(tiles) == 1:
        tile = tiles[0]
        await page.evaluate(
            """(opts) => {
                const wrapper = document.getElementById('mindmap-wrapper');
                const layout = document.querySelector('.topic-matrix');
                const host = document.querySelector('.markmap');
                if (!wrapper || !layout || !host) return;
                const offsetX = -(opts.origin_x + opts.tile.x);
                const offsetY = -(opts.origin_y + opts.tile.y);
                wrapper.style.padding = '0';
                wrapper.style.margin = '0';
                wrapper.style.width = `${opts.tile.width}px`;
                wrapper.style.height = `${opts.tile.height}px`;
                wrapper.style.minWidth = '0';
                wrapper.style.minHeight = '0';
                wrapper.style.overflow = 'hidden';
                host.style.minWidth = '0';
                host.style.minHeight = '0';
                layout.style.margin = '0';
                layout.style.transformOrigin = 'top left';
                layout.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
                document.body.style.margin = '0';
                document.documentElement.style.margin = '0';
            }""",
            {"origin_x": export_config["origin_x"], "origin_y": export_config["origin_y"], "tile": tile},
        )
        await asyncio.sleep(0.2)
        await page.screenshot(
            path=str(png_file),
            clip={"x": 0, "y": 0, "width": tile["width"], "height": tile["height"]},
            type="png",
        )
        return

    if Image is None:
        raise RuntimeError(
            "Pillow is required for tiled PNG export. Run: pip install -r scripts/requirements.txt"
        )

    stitched = Image.new(
        "RGBA",
        (
            export_config["image_width"] * export_config["device_scale_factor"],
            export_config["image_height"] * export_config["device_scale_factor"],
        ),
    )

    with tempfile.TemporaryDirectory(prefix="mindmap-tiles-") as temp_dir:
        temp_dir_path = Path(temp_dir)
        for index, tile in enumerate(tiles):
            await page.evaluate(
                """(opts) => {
                    const wrapper = document.getElementById('mindmap-wrapper');
                    const layout = document.querySelector('.topic-matrix');
                    const host = document.querySelector('.markmap');
                    if (!wrapper || !layout || !host) return;
                    const offsetX = -(opts.origin_x + opts.tile.x);
                    const offsetY = -(opts.origin_y + opts.tile.y);
                    wrapper.style.padding = '0';
                    wrapper.style.margin = '0';
                    wrapper.style.width = `${opts.tile.width}px`;
                    wrapper.style.height = `${opts.tile.height}px`;
                    wrapper.style.minWidth = '0';
                    wrapper.style.minHeight = '0';
                    wrapper.style.overflow = 'hidden';
                    host.style.minWidth = '0';
                    host.style.minHeight = '0';
                    layout.style.margin = '0';
                    layout.style.transformOrigin = 'top left';
                    layout.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
                    document.body.style.margin = '0';
                    document.documentElement.style.margin = '0';
                }""",
                {
                    "origin_x": export_config["origin_x"],
                    "origin_y": export_config["origin_y"],
                    "tile": tile,
                },
            )
            await asyncio.sleep(0.2)
            tile_file = temp_dir_path / f"tile-{index:03d}.png"
            await page.screenshot(
                path=str(tile_file),
                clip={"x": 0, "y": 0, "width": tile["width"], "height": tile["height"]},
                type="png",
            )
            with Image.open(tile_file) as tile_image:
                stitched.paste(
                    tile_image,
                    (
                        tile["x"] * export_config["device_scale_factor"],
                        tile["y"] * export_config["device_scale_factor"],
                    ),
                )

    stitched.save(png_file)


async def export_vector_pdf(page, pdf_file: Path, bbox: dict) -> None:
    """Export a single-page vector PDF directly from the browser page."""
    config = resolve_vector_pdf_export_config(bbox)
    await page.emulate_media(media="screen")
    await page.pdf(path=str(pdf_file), **config)


def build_html(
    markdown_text: str,
    title: str,
    theme_key: str,
    md_filename: str | None = None,
    layout_distribution: str | None = None,
) -> str:
    resolved_theme_key = theme_key if theme_key in THEMES else DEFAULT_THEME
    theme = THEMES[resolved_theme_key]
    layout_config = resolve_layout_config(theme, layout_distribution)
    # markmap-autoloader@0.17.2 reads render options ONLY from the markdown's
    # `markmap:` frontmatter (deriveOptions(frontmatter.markmap)); it has no
    # data-markmap / dataset support. Final node colors come from the skill's
    # own post-processing (applyFamilyShading + theme CSS), so only geometry
    # options are injected — injecting markmap `color` here would be redundant
    # and could regress themed output. These lines contain no HTML-special
    # characters, so html.escape() leaves the frontmatter intact.
    markmap_frontmatter = (
        "---\n"
        "markmap:\n"
        "  duration: 0\n"
        "  spacingVertical: 48\n"
        "  spacingHorizontal: 90\n"
        "  maxWidth: 520\n"
        "  paddingX: 14\n"
        "  paddingY: 10\n"
        "---\n\n"
    )
    md_html = html_module.escape(markmap_frontmatter + markdown_text)
    safe_title = html_module.escape(title, quote=True)
    custom_css = theme.get("custom_css", "")
    md_file_js = html_module.escape(md_filename) if md_filename else ""

    html = HTML_TEMPLATE.format(
        title=safe_title,
        bg=theme["bg"],
        text=theme["text"],
        text_shadow=theme.get("text_shadow", "none"),
        font=theme["font"],
        body_font=theme.get("body_font", theme["font"]),
        theme_class=f"theme-{resolved_theme_key}",
        custom_css=custom_css,
        markdown_html=md_html,
        md_filename=md_file_js,
        base_colors_json=json.dumps(theme["colors"]),
        is_dark_js="true" if theme.get("is_dark") else "false",
        orthogonal_links_js="true" if theme.get("orthogonal_links") else "false",
        custom_layout_js=json.dumps(theme.get("layout", "")),
        layout_config_json=json.dumps(layout_config, ensure_ascii=False),
        markmap_script_urls_json=json.dumps(MARKMAP_SCRIPT_URLS),
        js_helpers=JS_HELPERS,
    )
    return html


async def _fix_foreign_objects(page) -> None:
    await page.evaluate(
        f"""() => {{
            {JS_HELPERS}
            fixForeignObjects();
        }}"""
    )


async def _apply_family_shading(page, base_colors, is_dark: bool) -> None:
    await page.evaluate(
        f"""(args) => {{
            {JS_HELPERS}
            applyFamilyShading(args.colors, args.isDark);
        }}""",
        {"colors": base_colors, "isDark": is_dark},
    )


async def _wait_for_markmap(page) -> None:
    await page.wait_for_function(
        "() => window.__MARKMAP_READY__ || window.__MARKMAP_ERROR__",
        timeout=30000,
    )
    error = await page.evaluate("() => window.__MARKMAP_ERROR__")
    if error:
        raise RuntimeError(error)
    await page.wait_for_selector(".markmap svg", timeout=30000)


def export_pdf_from_png(png_file: Path, pdf_file: Path) -> None:
    """Create a single-page PDF from the rendered PNG so framing matches exactly."""
    if Image is None:
        raise RuntimeError(
            "Pillow is required for PDF export. Run: pip install -r scripts/requirements.txt"
        )

    with Image.open(png_file) as src:
        if src.mode in {"RGBA", "LA"}:
            background = Image.new("RGB", src.size, "white")
            background.paste(src, mask=src.getchannel("A"))
            image = background
        elif src.mode == "P":
            image = src.convert("RGB")
        elif src.mode != "RGB":
            image = src.convert("RGB")
        else:
            image = src.copy()

    image.save(pdf_file, "PDF", resolution=144.0)


def export_compressed_image(
    png_file: Path,
    output_file: Path,
    format_name: str,
    quality: int,
) -> None:
    """Create a smaller companion image from the final PNG without changing PNG export."""
    if Image is None:
        raise RuntimeError(
            "Pillow is required for compressed image export. Run: pip install -r scripts/requirements.txt"
        )

    config = resolve_compressed_image_export_config(format_name, quality)
    with Image.open(png_file) as src:
        image = src.convert("RGB")
        image.save(
            output_file,
            config["pil_format"],
            quality=config["quality"],
            method=config["method"],
        )


async def render_mindmap(
    md_path: str,
    output_dir: str,
    title: str,
    theme: str,
    scale: int,
    layout_distribution: str | None = None,
    pdf_mode: str = "raster",
    compressed_image_format: str | None = None,
    compressed_image_quality: int = 82,
) -> None:
    md_path = Path(md_path).resolve()
    if not md_path.exists():
        print(f"Error: Markdown file not found: {md_path}")
        sys.exit(1)

    markdown_text = strip_yaml_frontmatter(md_path.read_text(encoding="utf-8"))
    markdown_text = normalize_markdown_for_markmap(markdown_text)

    resolved_theme = theme if theme in THEMES else DEFAULT_THEME
    theme_def = THEMES[resolved_theme]
    base_colors = theme_def["colors"]
    is_dark = bool(theme_def.get("is_dark"))
    use_custom_layout_export = theme_uses_custom_layout_export(theme_def)

    html_content = build_html(
        markdown_text,
        title,
        resolved_theme,
        md_path.name,
        layout_distribution,
    )

    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    base_name = sanitize_filename(title)
    html_file = output_dir / f"{base_name}.html"
    png_file = output_dir / f"{base_name}.png"
    pdf_file = output_dir / f"{base_name}.pdf"
    compressed_file = None
    if compressed_image_format:
        compressed_config = resolve_compressed_image_export_config(
            compressed_image_format,
            compressed_image_quality,
        )
        compressed_file = output_dir / f"{base_name}{compressed_config['suffix']}"

    html_file.write_text(html_content, encoding="utf-8")
    print(f"[HTML] {html_file}")

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(device_scale_factor=1)
        page = await context.new_page()

        # ------------------------------------------------------------------
        # Pass 1: render in a large viewport so mindmap isn't constrained
        # ------------------------------------------------------------------
        await page.set_viewport_size({"width": 2400, "height": 2400})
        await page.goto(html_file.as_uri(), wait_until="domcontentloaded")
        await _wait_for_markmap(page)
        await asyncio.sleep(2.5)
        await _fix_foreign_objects(page)
        await _apply_family_shading(page, base_colors, is_dark)
        await asyncio.sleep(0.5)

        if use_custom_layout_export:
            bbox = await page.evaluate("""() => {
                const layout = document.querySelector('.topic-matrix');
                if (!layout) return null;
                const rect = layout.getBoundingClientRect();
                return {
                    x: Math.max(0, rect.left),
                    y: Math.max(0, rect.top),
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height),
                };
            }""")
        else:
            bbox = await page.evaluate("""() => {
                const svg = document.querySelector('.markmap svg');
                if (!svg) return null;
                const b = svg.getBBox();
                return { x: b.x, y: b.y, width: b.width, height: b.height };
            }""")

        if not bbox or (bbox.get("width", 0) == 0 or bbox.get("height", 0) == 0):
            bbox = await page.evaluate("""() => {
                const body = document.body;
                const html = document.documentElement;
                const width = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
                const height = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
                return { x: 0, y: 0, width, height };
            }""")

        custom_export_config = None
        if use_custom_layout_export:
            custom_export_config = resolve_custom_layout_export_config(bbox, scale)
            final_width = (
                custom_export_config["image_width"]
                * custom_export_config["device_scale_factor"]
            )
            final_height = (
                custom_export_config["image_height"]
                * custom_export_config["device_scale_factor"]
            )
        else:
            padding = 80
            # Natural size multiplied by scale so text is physically larger in the image
            final_width = int((bbox["width"] + padding * 2) * scale)
            final_height = int((bbox["height"] + padding * 2) * scale)
            final_width = max(final_width, 400)
            final_height = max(final_height, 400)
        pdf_bbox = (
            {"width": int(bbox["width"]), "height": int(bbox["height"])}
            if use_custom_layout_export
            else {
                "width": int(bbox["width"] + padding * 2),
                "height": int(bbox["height"] + padding * 2),
            }
        )
        await context.close()

        # ------------------------------------------------------------------
        # Pass 2: reload at the target viewport so markmap renders NATIVE high-res
        # ------------------------------------------------------------------
        if use_custom_layout_export:
            context = await browser.new_context(
                device_scale_factor=custom_export_config["device_scale_factor"]
            )
            page = await context.new_page()
            await page.set_viewport_size({"width": 2400, "height": 2400})
        else:
            context = await browser.new_context(device_scale_factor=1)
            page = await context.new_page()
            await page.set_viewport_size({"width": final_width, "height": final_height})
        await page.goto(html_file.as_uri(), wait_until="domcontentloaded")
        await _wait_for_markmap(page)
        await asyncio.sleep(2.5)
        await _fix_foreign_objects(page)
        await _apply_family_shading(page, base_colors, is_dark)
        await asyncio.sleep(0.5)

        if use_custom_layout_export:
            await export_custom_layout_png(page, png_file, custom_export_config)
        else:
            # Tight-crop the SVG around the actual content via viewBox,
            # but keep width/height at 100% so it fills the viewport natively.
            await page.evaluate(
                """(opts) => {
                    const wrapper = document.getElementById('mindmap-wrapper');
                    wrapper.style.padding = opts.padding + 'px';
                    const svg = document.querySelector('.markmap svg');
                    if (svg) {
                        const box = svg.getBBox();
                        const pad = opts.padding;
                        const vb = [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2];
                        svg.setAttribute('viewBox', vb.join(' '));
                        svg.setAttribute('width', '100%');
                        svg.setAttribute('height', '100%');
                        svg.style.maxWidth = 'none';
                    }
                }""",
                {"padding": padding},
            )
            await asyncio.sleep(0.8)
            # Screenshot with full_page to guarantee the entire expanding wrapper is captured
            await page.screenshot(path=str(png_file), full_page=True, type="png")
        print(f"[PNG] {png_file} ({final_width}x{final_height})")
        if compressed_file is not None:
            export_compressed_image(
                png_file,
                compressed_file,
                compressed_image_format,
                compressed_image_quality,
            )
            print(f"[WEBP] {compressed_file}")

        if pdf_mode == "vector":
            if use_custom_layout_export:
                await page.evaluate(
                    """() => {
                        document.body.classList.add('pdf-export');
                        const wrapper = document.getElementById('mindmap-wrapper');
                        const layout = document.querySelector('.topic-matrix');
                        const host = document.querySelector('.markmap');
                        if (!wrapper || !layout || !host) return;
                        wrapper.style.padding = '0';
                        wrapper.style.margin = '0';
                        wrapper.style.width = `${layout.offsetWidth}px`;
                        wrapper.style.height = `${layout.offsetHeight}px`;
                        wrapper.style.minWidth = '0';
                        wrapper.style.minHeight = '0';
                        wrapper.style.overflow = 'hidden';
                        host.style.minWidth = '0';
                        host.style.minHeight = '0';
                        layout.style.margin = '0';
                        layout.style.transformOrigin = 'top left';
                        layout.style.transform = 'none';
                        document.body.style.margin = '0';
                        document.documentElement.style.margin = '0';
                    }"""
                )
            else:
                await page.evaluate(
                    """(opts) => {
                        document.body.classList.add('pdf-export');
                        const wrapper = document.getElementById('mindmap-wrapper');
                        wrapper.style.padding = opts.padding + 'px';
                        const svg = document.querySelector('.markmap svg');
                        if (svg) {
                            const box = svg.getBBox();
                            const pad = opts.padding;
                            const vb = [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2];
                            svg.setAttribute('viewBox', vb.join(' '));
                            svg.setAttribute('width', '100%');
                            svg.setAttribute('height', '100%');
                            svg.style.maxWidth = 'none';
                        }
                        document.body.style.margin = '0';
                        document.documentElement.style.margin = '0';
                    }""",
                    {"padding": padding},
                )
            await asyncio.sleep(0.5)
            await export_vector_pdf(page, pdf_file, pdf_bbox)
        else:
            export_pdf_from_png(png_file, pdf_file)
        print(f"[PDF] {pdf_file}")

        await context.close()
        await browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render Markdown unordered list into a beautiful mindmap (HTML + PNG + PDF)."
    )
    parser.add_argument("--md", required=True, help="Path to input Markdown file")
    parser.add_argument("--output-dir", default="./mindmap-output", help="Output directory")
    parser.add_argument("--title", default=None, help="Title used for output file names and HTML title")
    parser.add_argument(
        "--theme",
        default=DEFAULT_THEME,
        choices=list(THEMES.keys()),
        help="Color theme for the mindmap",
    )
    parser.add_argument(
        "--scale",
        type=positive_int,
        default=1,
        help="Upscale factor for the output image (default: 1). Multiplies the native mindmap viewport so text is physically larger. Use 1 for compact output, 2 for crisp readable export, 3 for poster size.",
    )
    parser.add_argument(
        "--layout-distribution",
        choices=["single-right", "balanced"],
        default="single-right",
        help="Custom layout distribution for themes that support topic-matrix rendering.",
    )
    parser.add_argument(
        "--pdf-mode",
        choices=["raster", "vector"],
        default="raster",
        help="PDF export mode. raster is faster and matches PNG framing; vector keeps text/lines selectable but renders slower.",
    )
    parser.add_argument(
        "--compressed-image-format",
        choices=["webp"],
        default=None,
        help="Optional lightweight companion image export format.",
    )
    parser.add_argument(
        "--compressed-image-quality",
        type=positive_int,
        default=82,
        help="Quality for the optional compressed companion image (1-100).",
    )
    args = parser.parse_args()

    title = args.title or Path(args.md).stem
    try:
        asyncio.run(
            render_mindmap(
                args.md,
                args.output_dir,
                title,
                args.theme,
                args.scale,
                args.layout_distribution,
                args.pdf_mode,
                args.compressed_image_format,
                args.compressed_image_quality,
            )
        )
    except RuntimeError as exc:
        print(f"Error: {exc}")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
