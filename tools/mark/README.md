# The Cascade mark

Generates the waterfall mark — curly streams falling into a spreading pool,
drawn on a grid where a run of neighbouring cells is one round-capped bar and a
lone cell is a dot — and proves it at the sizes that actually decide it.

```bash
python3 cascade_mark.py --search 400 --sheet best.png   # rank seeds at 32px
python3 cascade_mark.py --seed 234 --out mark           # 32, 128, 512 png + svg
```

Requires Pillow. Nothing here is part of Cascade's build; it is a design tool
that happens to live with the thing it draws.

## Why it is built this way

**The rule is resolution-independent, the grid is not.** The streams and the
pool are continuous functions, rasterised onto whatever grid the output size can
afford. One seed therefore gives an 8×8 mark for a 32px icon, a 16×16 for 128px
and a 32×32 for display, and they read as the same drawing at three densities
rather than one drawing blurred.

**Nothing is ever scaled.** The cell pitch is a whole number of pixels at every
size, because a mark of small dots that does not land on the pixel grid turns to
grey mush — which is what killed several earlier attempts at this style.

**The engine ranks its own output.** `score()` renders a candidate at 32px and
penalises three failures: too little ink to read, too much and it fills, and —
the one that catches people — a high proportion of mid-grey, measured on a 128px
render downsampled to 32, which is what a system that resamples an icon does to
it. `--search N` walks N seeds and ranks them, so the small-size test happens
before anyone falls for a mark at full size.

## Two things the sizes forced

**Below about five pixels a rounded rectangle is a plus sign.** The corner
radius eats the corners. So at those sizes the mark draws squares: rounding is a
property of the drawing, not something to fake at 3px.

**Eight columns cannot hold four wandering streams and a pool.** The result
reads as scattered debris. So a coarse grid gets a *reduced* composition from
the same rule — two streams, one lazy reversal, a wider pool — rather than a
shrunken one. This is what icon families do anyway: different artwork per size,
not one drawing resized.
