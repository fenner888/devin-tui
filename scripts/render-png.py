#!/usr/bin/env python3
"""Paint a raw PTY capture's final frame to a PNG.

Usage:
  python3 scripts/render-png.py <rawfile> --out <png> [--after <marker>]
                              [--cols N] [--rows N]

Uses `npx tsx scripts/snapshot.ts --json` for ANSI emulation, then paints the
cell grid with Pillow. Menlo for text; braille glyphs (U+2800-28FF) fall back
to a font that covers them (checked and reported on stderr).
"""
import argparse
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CELL_W = 10
CELL_H = 20

FONT_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFMono-Regular.otf",
    "/System/Library/Fonts/Monaco.ttf",
]
# per-glyph fallback chain for anything the main font lacks
FALLBACK_CANDIDATES = [
    "/System/Library/Fonts/Apple Braille.ttf",   # U+2800–28FF
    "/System/Library/Fonts/Apple Symbols.ttf",   # ∴ ◐ ○ ● ✎ etc.
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]

DEFAULT_FG = (216, 216, 216)  # #d8d8d8-ish terminal default
DEFAULT_BG = (0, 0, 0)


def parse_hex(h):
    if not h:
        return None
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def load_font(candidates, size):
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size), path
            except Exception:
                continue
    return None, None


def render_bitmap(font, ch):
    img = Image.new("L", (40, 44))
    d = ImageDraw.Draw(img)
    d.text((2, 2), ch, font=font, fill=255)
    return img.tobytes()


def has_glyph(font, ch):
    """True if `font` really draws `ch` (not the .notdef box / blank)."""
    try:
        bmp = render_bitmap(font, ch)
        if not any(bmp):
            return False
        # compare against a private-use char that is virtually never present —
        # identical pixels mean we are looking at the .notdef glyph
        return bmp != render_bitmap(font, "\ue000")
    except Exception:
        return False


def paint_color(cell, key, default):
    c = parse_hex(cell.get(key))
    return c if c is not None else default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rawfile")
    ap.add_argument("--out", required=True)
    ap.add_argument("--after")
    ap.add_argument("--after-last", dest="after_last")
    ap.add_argument("--before")
    ap.add_argument("--cols", type=int, default=120)
    ap.add_argument("--rows", type=int, default=36)
    a = ap.parse_args()

    cmd = [
        "npx",
        "tsx",
        os.path.join(HERE, "snapshot.ts"),
        a.rawfile,
        "--cols",
        str(a.cols),
        "--rows",
        str(a.rows),
        "--json",
    ]
    if a.after:
        cmd += ["--after", a.after]
    if a.after_last:
        cmd += ["--after-last", a.after_last]
    if a.before:
        cmd += ["--before", a.before]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        sys.exit(proc.returncode)
    frame = json.loads(proc.stdout)
    cols, rows, cells = frame["cols"], frame["rows"], frame["cells"]

    font, font_path = load_font(FONT_CANDIDATES, 17)
    if font is None:
        sys.exit("no monospace font found")
    # fallback chain: braille range → Apple Braille first; other missing
    # glyphs → Apple Symbols → Arial Unicode
    fb = {}
    for path in FALLBACK_CANDIDATES:
        if os.path.exists(path):
            try:
                fb[path] = ImageFont.truetype(path, 17)
            except Exception:
                pass
    print(f"font: {font_path} | fallbacks: {list(fb)}", file=sys.stderr)

    BRAILLE_FONT = "/System/Library/Fonts/Apple Braille.ttf"
    SYMBOLS_FONT = "/System/Library/Fonts/Apple Symbols.ttf"
    ARIAL_FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"

    glyph_cache = {}

    def font_for(ch):
        """Menlo first; only glyphs it lacks walk the fallback chain."""
        if ch in glyph_cache:
            return glyph_cache[ch]
        f = font
        if not has_glyph(font, ch):
            cp = ord(ch[0])
            chain = (
                [BRAILLE_FONT, SYMBOLS_FONT, ARIAL_FONT]
                if 0x2800 <= cp <= 0x28FF
                else [SYMBOLS_FONT, ARIAL_FONT, BRAILLE_FONT]
            )
            for path in chain:
                cand = fb.get(path)
                if cand is not None and has_glyph(cand, ch):
                    f = cand
                    break
        glyph_cache[ch] = f
        return f

    img = Image.new("RGB", (cols * CELL_W, rows * CELL_H), DEFAULT_BG)
    draw = ImageDraw.Draw(img)

    for y, row in enumerate(cells):
        for x, cell in enumerate(row):
            fg = paint_color(cell, "fg", DEFAULT_FG)
            bg = paint_color(cell, "bg", DEFAULT_BG)
            if cell.get("dim"):
                fg = tuple(int(c * 0.55) for c in fg)
            if cell.get("bold"):
                fg = tuple(min(255, int(c * 1.25) + 20) for c in fg)
            if cell.get("inverse"):
                fg, bg = bg, fg
            px, py = x * CELL_W, y * CELL_H
            draw.rectangle([px, py, px + CELL_W - 1, py + CELL_H - 1], fill=bg)
            ch = cell.get("ch") or " "
            if ch and ch != " ":
                draw.text((px, py + 1), ch, font=font_for(ch), fill=fg)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    img.save(a.out)
    print(a.out)


if __name__ == "__main__":
    main()
