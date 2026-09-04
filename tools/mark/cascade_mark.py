#!/usr/bin/env python3
"""Generate Cascade's waterfall mark, and prove it at icon sizes.

The mark is a continuous rule — curly streams falling into a spreading pool —
rasterised onto a grid, where a run of neighbouring cells is drawn as one
round-capped bar and a lone cell as a dot.

Everything here follows from one constraint: the mark has to work at 32 and 128
pixels. That rules out a fine grid, because a legible dot needs about three
pixels with a pixel of air around it, so 32 pixels buys eight columns and no
more. It also rules out drawing once and scaling, which is what turns these
marks to grey mush: at each size the cell pitch must be a whole number of
pixels so every dot lands on the pixel grid.

So the rule is resolution-independent and the grid is not. The same seed and
parameters produce an 8x8 mark for the 32px slot, a 16x16 for 128px and a 32x32
for display, and they read as the same drawing at three densities rather than
as one drawing blurred.

    python3 cascade_mark.py --seed 7 --out icon            # 32, 128, 512 + svg
    python3 cascade_mark.py --search 400                   # rank seeds at 32px
    python3 cascade_mark.py --sheet best.png --search 400  # contact sheet
"""
from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass, field

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    raise SystemExit("Pillow is required: python3 -m pip install pillow")


# One grid per output size. The cell pitch is the size divided by the columns
# and must stay a whole number, which is what keeps the dots crisp.
TIERS = {32: 8, 128: 16, 256: 16, 512: 32, 1024: 32}


@dataclass
class Params:
    """The rule. Resolution-independent: every value is a fraction of the grid."""
    streams: int = 4
    freq: float = 2.6          # sway reversals over the fall
    amp: float = 0.14          # sway amplitude, as a fraction of the width
    split: float = 0.60        # where the fall becomes the pool
    pool_width: float = 0.62   # widest run, as a fraction of the width
    double: float = 0.14       # chance of a neighbour cell, so curves read drawn
    dissolve: float = 0.55     # how fast the pool breaks up below its widest
    seed: int = 0
    extras: dict = field(default_factory=dict)


def _streams(rng: random.Random, cols: int, rows: int, p: Params) -> set[tuple[int, int]]:
    cells: set[tuple[int, int]] = set()
    split_row = max(1, int(rows * p.split))
    phase0 = rng.uniform(0, math.tau)
    amp = p.amp * cols
    for i in range(p.streams):
        lane = cols / 2 + (i - (p.streams - 1) / 2) * amp * 1.5
        ph = phase0 + rng.uniform(-0.5, 0.5)
        freq = p.freq * rng.uniform(0.9, 1.12)
        a = amp * rng.uniform(0.7, 1.15)
        start = int(rows * rng.uniform(0.0, 0.08))
        end = split_row + int(rows * rng.uniform(0.0, 0.06))
        for r in range(start, max(start + 1, end)):
            u = (r - start) / max(1, end - start)
            x = lane + a * (math.sin(u * math.pi * freq + ph)
                            + 0.4 * math.sin(u * math.pi * freq * 1.8 + ph * 1.5))
            c = int(round(x))
            if 0 <= c < cols:
                cells.add((c, r))
            if rng.random() < p.double:
                c2 = c + rng.choice((-1, 1))
                if 0 <= c2 < cols:
                    cells.add((c2, r))
    return cells


def _pool(rng: random.Random, cols: int, rows: int, p: Params) -> set[tuple[int, int]]:
    cells: set[tuple[int, int]] = set()
    split_row = max(1, int(rows * p.split))
    for r in range(split_row, rows):
        t = (r - split_row) / max(1, rows - split_row)
        width = (1 - abs(t - 0.30) * 1.5) * cols * p.pool_width
        if width < 1:
            continue
        left = cols / 2 - width / 2 + rng.uniform(-1, 1)
        while left < cols / 2 + width / 2:
            run = max(1, int(rng.triangular(1, max(2.0, width * 0.6), width * 0.32)))
            if rng.random() < 0.35 + (1 - t) * p.dissolve:
                for c in range(int(left), int(left) + run):
                    if 0 <= c < cols:
                        cells.add((c, r))
            left += run + rng.choice((1, 1, 2))
    return cells


# At eight columns there is no room for four wandering streams and a pool: the
# result is scattered cells that read as debris. Real icon families ship
# different artwork per size for exactly this reason, so a coarse grid gets a
# reduced composition from the same rule — fewer streams, one lazy reversal, a
# wider pool — rather than a shrunken one.
COARSE = dict(streams=2, freq=1.4, amp=0.11, split=0.5, pool_width=0.8, double=0.0,
              dissolve=0.35)


def for_grid(cols: int, p: Params) -> Params:
    if cols > 10:
        return p
    return Params(**{**p.__dict__, **COARSE, "seed": p.seed, "extras": p.extras})


def generate(cols: int, rows: int, p: Params) -> set[tuple[int, int]]:
    """The same rule on any grid, so one seed gives a coherent family of sizes."""
    p = for_grid(cols, p)
    rng = random.Random(p.seed)
    cells = _streams(rng, cols, rows, p)
    rng = random.Random(p.seed ^ 0x5EED)   # pool independent of stream draws
    return cells | _pool(rng, cols, rows, p)



def runs(cells: set[tuple[int, int]]) -> list[tuple[int, int, int]]:
    """Horizontal runs as (row, first_col, last_col). A run is one bar."""
    by_row: dict[int, list[int]] = {}
    for c, r in cells:
        by_row.setdefault(r, []).append(c)
    out = []
    for r, cs in sorted(by_row.items()):
        cs.sort()
        first = prev = cs[0]
        for c in cs[1:] + [None]:
            if c is not None and c == prev + 1:
                prev = c
                continue
            out.append((r, first, prev))
            if c is not None:
                first = prev = c
    return out


def render(p: Params, size: int, cols: int | None = None) -> Image.Image:
    """Exact-size render with a whole-pixel cell pitch."""
    cols = cols or TIERS.get(size, 16)
    cell = size // cols
    if cell < 2:
        raise SystemExit(f"{size}px cannot hold {cols} columns")
    rows = cols                      # square grid, square icon
    dot = max(2, cell - max(1, cell // 4))   # a pixel or so of air per cell
    cells = generate(cols, rows, p)
    image = Image.new("L", (size, size), 255)
    draw = ImageDraw.Draw(image)
    pad = (cell - dot) / 2
    # Under about five pixels a rounded rectangle's corner radius eats the
    # corners into a plus sign, so at those sizes the honest mark is a square.
    # Rounding is a property of the drawing, not something to fake at 3px.
    radius = (dot - 1) / 2 if dot >= 5 else 0
    for r, first, last in runs(cells):
        x0 = first * cell + pad
        x1 = last * cell + pad + dot
        y0 = r * cell + pad
        draw.rounded_rectangle([x0, y0, x1 - 1, y0 + dot - 1], radius=radius, fill=0)
    return image


def score(p: Params) -> dict:
    """Rank a seed by whether it survives 32 pixels.

    Three things kill a mark at that size: too little ink to read, too much and
    it fills, and — the one that catches people — a lot of mid-grey, which is
    what a shape that does not fit the pixel grid turns into. Mid-grey is
    measured on a 32px render downscaled from 128, since that is what a system
    that resamples an icon will do to it.
    """
    small = render(p, 32)
    hist = small.histogram()
    ink = sum(hist[:110]) / (32 * 32)

    resampled = render(p, 128).resize((32, 32), Image.LANCZOS)
    mid = sum(resampled.histogram()[90:200]) / (32 * 32)

    # How much of the frame the drawing actually uses.
    box = small.point(lambda v: 255 if v < 128 else 0).getbbox() or (0, 0, 1, 1)
    fill = ((box[2] - box[0]) * (box[3] - box[1])) / (32 * 32)

    penalty = abs(ink - 0.16) * 4 + mid * 2.2 + max(0.0, 0.55 - fill) * 1.5
    return {"seed": p.seed, "ink": round(ink, 3), "mid": round(mid, 3),
            "fill": round(fill, 3), "penalty": round(penalty, 4)}


def to_svg(p: Params, cols: int = 16) -> str:
    cell, dot = 16, 12
    pad = (cell - dot) / 2
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {cols * cell} {cols * cell}">',
             f'<rect width="100%" height="100%" fill="#fff"/>']
    for r, first, last in runs(generate(cols, cols, p)):
        x = first * cell + pad
        w = (last - first) * cell + dot
        parts.append(f'<rect x="{x:g}" y="{r * cell + pad:g}" width="{w:g}" '
                     f'height="{dot}" rx="{dot / 2}" fill="#000"/>')
    parts.append("</svg>")
    return "\n".join(parts)


def search(n: int, base: Params) -> list[dict]:
    results = []
    for seed in range(n):
        p = Params(**{**base.__dict__, "seed": seed})
        try:
            results.append(score(p))
        except SystemExit:
            continue
    return sorted(results, key=lambda d: d["penalty"])


def sheet(seeds: list[int], base: Params, path: str) -> None:
    """Every candidate shown at the sizes that decide it: 32 and 128 actual
    pixels, plus a large render for the eye."""
    tile, gap, strip = 300, 28, 150
    per_row = 3
    rows_n = (len(seeds) + per_row - 1) // per_row
    image = Image.new("L", (per_row * (tile + gap) + gap,
                            rows_n * (tile + strip)), 255)
    draw = ImageDraw.Draw(image)
    for i, seed in enumerate(seeds):
        p = Params(**{**base.__dict__, "seed": seed})
        col, row = i % per_row, i // per_row
        x = gap + col * (tile + gap)
        y = row * (tile + strip)
        image.paste(render(p, 512).resize((tile, tile), Image.NEAREST), (x, y))
        # The two sizes that decide it, at their real pixel count, with the
        # 32 blown up next to it so the cell pattern is visible.
        image.paste(render(p, 128), (x, y + tile + 8))
        image.paste(render(p, 32), (x + 140, y + tile + 8))
        image.paste(render(p, 32).resize((96, 96), Image.NEAREST), (x + 184, y + tile + 8))
        s = score(p)
        draw.text((x, y + tile + 116),
                  f"seed {seed}   ink {s['ink']}   mid {s['mid']}", fill=0)
    image.save(path)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--streams", type=int, default=4)
    ap.add_argument("--freq", type=float, default=2.6)
    ap.add_argument("--amp", type=float, default=0.14)
    ap.add_argument("--split", type=float, default=0.60)
    ap.add_argument("--out", help="basename; writes 32, 128, 512 png and an svg")
    ap.add_argument("--search", type=int, metavar="N", help="rank N seeds at 32px")
    ap.add_argument("--sheet", metavar="PATH", help="contact sheet of the best seeds")
    ap.add_argument("--top", type=int, default=9)
    args = ap.parse_args()

    base = Params(streams=args.streams, freq=args.freq, amp=args.amp,
                  split=args.split, seed=args.seed)

    if args.search:
        ranked = search(args.search, base)
        for row in ranked[:args.top]:
            print(f"seed {row['seed']:>4}  penalty {row['penalty']:.3f}  "
                  f"ink {row['ink']:.3f}  mid {row['mid']:.3f}  fill {row['fill']:.3f}")
        if args.sheet:
            sheet([r["seed"] for r in ranked[:args.top]], base, args.sheet)
            print(f"wrote {args.sheet}")
        return

    if args.sheet:
        sheet([args.seed + i for i in range(args.top)], base, args.sheet)
        print(f"wrote {args.sheet}")

    if args.out:
        for size in (32, 128, 512):
            render(base, size).save(f"{args.out}-{size}.png")
        with open(f"{args.out}.svg", "w") as fh:
            fh.write(to_svg(base))
        print(f"wrote {args.out}-32.png, -128.png, -512.png, {args.out}.svg")


if __name__ == "__main__":
    main()
