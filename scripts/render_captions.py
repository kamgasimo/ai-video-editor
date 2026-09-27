#!/usr/bin/env python3
"""Caption chunks -> the images that change, and a concat list that holds each one while it shows.

    python render_captions.py captions.json --out-dir DIR --width 1080 --height 1920 --fps 30
        --duration 22.09 --font FONT.ttf --y 0.70 --size 0.075 [--style highlight|color|simple]
        [--accent "#7C5CFF"]

burn-captions.mjs decides the placement and calls this. Only a band across the frame is drawn,
centred at --y (a fraction of the height). A new image is
written only when something visible changes: a chunk appears, its active word moves on, or a pop-in
frame scales it up. So a minute of captions is a few hundred small images, not thousands of full
frames. --size is the text height as a fraction of the frame's shorter side.

Styles: highlight boxes the spoken word in the accent colour; color paints the spoken word in it;
simple shows each chunk in plain outlined white. The text on an accent box is white when it reads at
3:1 or better against the accent, the contrast large text needs, and black otherwise.

Prints {"y", "height", "images", "entries", "fontSize"} as JSON; burn-captions.mjs lays the band over
the picture at that y.
"""
import argparse
import json
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

WHITE, BLACK = (255, 255, 255), (0, 0, 0)


def hex_rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    if len(h) != 6:
        raise SystemExit(f'not a hex colour: #{h}')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def luminance(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('captions')
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--width', type=int, required=True)
    ap.add_argument('--height', type=int, required=True)
    ap.add_argument('--fps', type=float, required=True)
    ap.add_argument('--duration', type=float, required=True)
    ap.add_argument('--font', required=True)
    ap.add_argument('--style', choices=['highlight', 'color', 'simple'], default='highlight')
    ap.add_argument('--accent', default='#7C5CFF')
    ap.add_argument('--y', type=float, required=True)
    ap.add_argument('--size', type=float, required=True)
    a = ap.parse_args()

    W, H, FPS = a.width, a.height, a.fps
    y_frac = a.y
    base = max(12, round(a.size * min(W, H)))
    accent = hex_rgb(a.accent)
    on_accent = WHITE if contrast(WHITE, accent) >= 3 else BLACK

    chunks = json.load(open(a.captions))['chunks']
    spoken_case = any(ch != ch.upper() for c in chunks for w in c['words'] for ch in w['text'])

    fonts = {}

    def font(px):
        if px not in fonts:
            fonts[px] = ImageFont.truetype(a.font, px)
        return fonts[px]

    band_h = int(base * 3.6)
    band_top = max(0, min(H - band_h, round(y_frac * H - band_h / 2)))
    max_w = W * 0.86
    probe = ImageDraw.Draw(Image.new('RGBA', (8, 8)))

    def widths(words, px):
        f, sw = font(px), max(1, round(px * 0.09))
        return [probe.textbbox((0, 0), w['text'], font=f, anchor='ls', stroke_width=sw)[2] for w in words]

    # The size and line breaks for a chunk: shrink to fit one line, down to 70 %; past that, two lines;
    # a single word too long for any line shrinks until it fits.
    def fit(words):
        px = base
        gap = lambda p: round(p * 0.28)
        line_w = lambda ws, p: sum(widths(ws, p)) + gap(p) * (len(ws) - 1)
        while px > base * 0.7 and line_w(words, px) > max_w:
            px -= 1
        if line_w(words, px) <= max_w or len(words) == 1:
            while len(words) == 1 and px > 12 and line_w(words, px) > max_w:
                px -= 1
            return px, [words]
        px = base
        cut = math.ceil(len(words) / 2)
        lines = [words[:cut], words[cut:]]
        while px > 12 and max(line_w(l, px) for l in lines) > max_w:
            px -= 1
        return px, lines

    def render(ci, active, scale):
        words = chunks[ci]['words']
        px, lines = fit(words)
        f, sw = font(px), max(1, round(px * 0.09))
        gap = round(px * 0.28)
        cap = -probe.textbbox((0, 0), 'H', font=f, anchor='ls')[1]
        desc = probe.textbbox((0, 0), 'gjpqy', font=f, anchor='ls')[3] if spoken_case else 0
        line_h = round((cap + desc) * 1.55)
        layer = Image.new('RGBA', (W, band_h), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        top = band_h / 2 - (line_h * len(lines)) / 2
        k = 0
        for li, line in enumerate(lines):
            ws = widths(line, px)
            x = (W - (sum(ws) + gap * (len(line) - 1))) / 2
            baseline = top + li * line_h + (line_h + cap - desc) / 2
            for w, wd in zip(line, ws):
                is_active = a.style != 'simple' and k == active
                if is_active and a.style == 'highlight':
                    pad_x, pad_y = round(px * 0.18), round(px * 0.14)
                    d.rounded_rectangle((x - pad_x, baseline - cap - pad_y, x + wd + pad_x, baseline + desc + pad_y),
                                        radius=round(px * 0.24), fill=accent + (255,))
                    d.text((x, baseline), w['text'], font=f, fill=on_accent, anchor='ls')
                else:
                    fill = accent if is_active and a.style == 'color' else WHITE
                    d.text((x, baseline), w['text'], font=f, fill=fill, anchor='ls', stroke_width=sw, stroke_fill=BLACK)
                x += wd + gap
                k += 1
        shadow_alpha = layer.getchannel('A').filter(ImageFilter.GaussianBlur(max(2, px * 0.12))).point(lambda v: int(v * 0.55))
        out = Image.new('RGBA', (W, band_h), (0, 0, 0, 0))
        shadow = Image.new('RGBA', (W, band_h), (0, 0, 0, 0))
        shadow.putalpha(shadow_alpha)
        out.alpha_composite(shadow, (0, max(1, round(px * 0.07))))
        out.alpha_composite(layer)
        if scale < 1:
            sw_, sh_ = max(1, round(W * scale)), max(1, round(band_h * scale))
            small = out.resize((sw_, sh_), Image.LANCZOS)
            out = Image.new('RGBA', (W, band_h), (0, 0, 0, 0))
            out.alpha_composite(small, ((W - sw_) // 2, (band_h - sh_) // 2))
        return out, px

    # Which image each output frame shows.
    total = max(1, math.ceil(a.duration * FPS - 1e-6))
    frame = lambda t: int(round(t * FPS))
    pop = 0 if a.style == 'simple' else max(1, round(0.14 * FPS))
    keys = [None] * total
    for ci, c in enumerate(chunks):
        f0, f1 = max(0, frame(c['start'])), min(total, frame(c['end']))
        starts = [frame(w['start']) for w in c['words']]
        for f in range(f0, f1):
            active = -1
            if a.style != 'simple':
                active = 0
                for j, s in enumerate(starts):
                    if s <= f:
                        active = j
            n = f - f0
            keys[f] = (ci, active, n if n < pop else pop)

    os.makedirs(a.out_dir, exist_ok=True)
    names, sizes = {}, []
    blank = os.path.join(a.out_dir, 'blank.png')
    Image.new('RGBA', (W, band_h), (0, 0, 0, 0)).save(blank)
    entries = []
    for f, k in enumerate(keys):
        if entries and entries[-1][1] == k:
            continue
        entries.append((f, k))
    for _, k in entries:
        if k is None or k in names:
            continue
        ci, active, n = k
        scale = 0.82 + 0.18 * ease(n / pop) if pop and n < pop else 1.0
        img, px = render(ci, active, scale)
        sizes.append(px)
        name = f'c{len(names):05d}.png'
        img.save(os.path.join(a.out_dir, name), compress_level=1)
        names[k] = name

    # Each change lands 2 ms before its frame, so rounding can never hold an image one frame too long.
    starts = [0.0] + [max(0.0, f / FPS - 0.002) for f, _ in entries[1:]]
    end = total / FPS
    lines = ['ffconcat version 1.0']
    for i, (f, k) in enumerate(entries):
        nxt = starts[i + 1] if i + 1 < len(entries) else end
        lines.append(f"file '{names[k] if k is not None else 'blank.png'}'")
        lines.append(f'duration {max(0.0, nxt - starts[i]):.6f}')
    last = entries[-1][1]
    lines.append(f"file '{names[last] if last is not None else 'blank.png'}'")
    with open(os.path.join(a.out_dir, 'list.ffconcat'), 'w') as fh:
        fh.write('\n'.join(lines) + '\n')

    print(json.dumps({'y': band_top, 'height': band_h, 'images': len(names), 'entries': len(entries),
                      'fontSize': {'base': base, 'min': min(sizes) if sizes else base}}))


if __name__ == '__main__':
    main()
