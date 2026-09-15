# tools

Development harnesses. Not part of the page — nothing in `index.html` loads
anything here, and the droplet never runs them.

`*.md` is denied by the vhost, so this file is not served. The `.js` beside it
is (the checkout *is* the web root — see `../CLAUDE.md`), which is harmless: it
is a node script, it holds no secrets, and a browser asking for it gets text.

## determinism.js

The dish is a pure function of `(seed, brush)`, and `SIM_V` is the version of
that promise. This is how a change is held to it.

It runs fixed dishes for a fixed number of **steps** — `stepsRun` is the axis
determinism is defined over, not seconds and not frames — then hashes what the
simulation holds, field by field, through `SLIME.stateHash()`. Two builds that
hold the same dish agree on every digest; two that do not disagree on the field
that moved first, which names the pass that moved it.

```bash
npm i playwright            # not committed; node_modules is gitignored
node tools/determinism.js --self                        # this build, twice
node tools/determinism.js --label base --out /tmp/a.json
#   ...make a change...
node tools/determinism.js --label head --out /tmp/b.json
node tools/determinism.js --compare /tmp/a.json /tmp/b.json
```

Write the JSON to `/tmp`, not into the repo: the repo is the web root.

`--self` runs the same build at x1 and x4 and compares. **Run it first on a
checkout you have not measured before.** It answers whether the harness is
stable at all — if two speeds disagree, the sim has picked up a dependency on
frame timing and no comparison against that build means anything.

### What outcome.js caps at, and why it is not round

`CAP` defaults to 60,000 steps because the largest `timeLimit` in `EXPERIMENTS`
is 900 sim-seconds, which at 60 steps a second is 54,000. A cap below a dish's
own clock cannot be reached by a *losing* run of it: the harness would report
`CAPPED` where the dish actually reaches its `timeout` verdict, and a verdict
the harness cannot see is one a change can silently take away. The first
version capped at 40,000, under EXP-02's own 700s = 42,000.

Environment: `STEPS` (default 2000), `CASES` (default
`EXP-01/3039,EXP-02/a1b2,EXP-05/7f31` — an open plate, a maze so the wall tests
in the sweeps are exercised, and a dish with timed events), `BRUSH` (default
none — see below), `CHROMIUM` to point at a browser other than the
pre-installed one.

### The brush, and why it is not on by default

`BRUSH=1@210,130` holds the brush down at that grid cell for the whole run —
mode 1 a cue, 2 a retract. Without it the fixed cases paint **nothing**, so
`cueF` and `retF` are zero everywhere for the length of every run and no
comparison says one word about the code that maintains them. That blind spot
is not hypothetical: a build that never widened the player fields' box passes
every unbrushed case identically and is caught on all three brushed ones, with
`cueF` named among the fields that moved.

It is a HELD brush and not a moving one, because the harness sets the pointer
once before the run and the sim reads it from inside the step budget, so a
held brush stays a function of the step count and ×1 and ×4 still have to
agree. A held brush is not a weak test: the reserve drains within a few
hundred steps, the brush stops landing, and the rest of the run is the haze
fading to nothing — write, decay, shrink and empty, in one run.

What it does NOT catch is a box that is short by a cell or two at the disc's
rim. The cone falls to zero there, so those cells hold values under the
field's own 0.002 floor and are dead on the step they are written; a build
short by one cell on every side is identical to one that is not. Verified,
not assumed — that perturbation was run and it passed.

Off by default because it changes every digest: the brushed runs are their
own baseline, not comparable with the unbrushed ones.

The coordinates are checked against the grid the page reports, and an
off-plate one is a hard error rather than a quiet no-op. It has to be, because
the quiet version is the worst failure this file knows: the brush rectangle
clamps to the edge, every cell in it is then further from the centre than
`CUE_R`, nothing is painted, every digest matches an unbrushed run, and the
harness exits 0 having exercised none of the code the flag exists to cover.

On-plate is necessary and not sufficient — a point buried in a wall paints
nothing either, since `paintBrush` skips wall cells, and there is no cheap
test for that from outside the page. The confirmation is the one a brushed
comparison makes anyway: **a brushed digest must differ from the unbrushed
digest of the same build.** If it does not, the brush did not land, whatever
the coordinates said.

### What it is and is not sensitive to

Verified, on EXP-01/3039 at 600 steps:

- Perturbing `COND_RATE` by 5e-8 relative **diverges**, and is localised to
  `condF` with all forty-six other digests held. A change that moves the dish
  at all is caught, and named.
- Reassociating `cd += COND_RATE * (drive - cd)` into
  `cd = cd + COND_RATE * drive - COND_RATE * cd` **does not diverge.** Every
  field is a `Float32Array`, so a difference that appears only in the double
  used to compute the value is rounded away by the store.

The second result is worth reading carefully, because it is easy to take the
wrong lesson from it. It does **not** say reassociation is safe: it says the
float32 store hides a double-precision difference *for the values that came up
in that run*. A value that lands on a rounding boundary flips, and over a
hundred thousand cells and thousands of steps that is a question of
probability, not of principle. A green run is evidence, not a proof — so keep
an arithmetic edit to a form that is exactly equal rather than one that is
merely equal in exact arithmetic, and use this to catch the mistake, not to
license it.

A green comparison also says nothing about *speed*. It is the correctness half
of a performance change; the other half is a measurement.

### Why the scalars are enumerated rather than listed

The scalar digest walks `S` and hashes everything it holds except `exp` (the
shared dish definition, never written by a step). It is not a list of the fields
that matter, because that list was wrong twice — first missing `holdT0`, the one
field the win step writes, then missing `growAcc`/`starveAcc`/`nodeIdle`/
`nodeHeld`, accumulators that carry a difference for several steps before it
crosses a threshold and shows up anywhere else.

Both misses have the same shape and it is the worst one available here: every
digest matches, `--compare` says identical, and two genuinely different dishes
have been certified as one. A denylist fails safe (a new field is hashed until
someone excludes it); an allowlist fails silent. Keys are sorted, so the digest
depends on what `S` holds rather than on the order the literal declares it in.

`treePassN` is hashed alongside — `treeGrow` reads it, so two runs that differ
in it differ in what the next growth pass does.

### The module-scope list, and why that one stays a list

`S` is enumerated. The module-scope state beside it is not, and cannot be: a
script's top level holds some two hundred arrays, most of them the renderer's,
whose contents legitimately differ between two runs holding the same dish
because they depend on how many frames were drawn. Hashing those would report
divergences no dish can see, which is worse than missing one.

So that part needs judgement, and the rule it is built from is recorded next to
it in `sim.js`:

> hash every module-scope value that `step()` or its callees **write** and a
> **later step reads**.

Excluded with a reason each: `recN` (reset to -1 every step before use),
`scarW` (per-agent, for the three `sense()` calls), `attempts` (picks the seed,
not what a step does), the profiling counters, and everything the renderer owns.

To re-audit, list the module-scope declarations and ask that question of each.
Three passes have been run. The first added `nodeHits`, `nodeLoad`,
`reabCursor` and `idleCursor`; the second added `tubeDist`, which is rebuilt
every `TUBE_EVERY` steps and read inside the agent loop by a streaming agent
walking its goal's geodesic; the third added `cueX0`/`cueY0`/`cueX1`/`cueY1`,
the box the player fields' decay sweeps, written by the brush and by that
sweep and read by the next one.

The box is the case where the rule was nearly argued around, so it is worth
recording why it was not. A box that is too SMALL leaves a live cell
undecayed, and `cueF` and `retF` would report that on their own — so it is
true that hashing the box catches nothing `cueF` would miss. It is hashed
anyway: the rule is "state a step writes and a later step reads", not "state
whose errors nothing else would notice", and the second is a judgement that
has to be made again correctly every time the code around it moves.

**This coverage is verified, not assumed.** Starting `reabCursor` at 1 instead of
0 diverges at 600 steps with *only* the `scalars` digest moving and all
forty-six array digests held — that is, the cursor had not yet changed a single
field, so the previous hash would have called the two builds identical. That is
the whole failure mode, reproduced.

### One caveat about the double-buffered fields

`fedRelax` ends by swapping which array object each of `fedF`/`fedB`,
`padF`/`padB` and `bodyF`/`bodyB` names, and `stateHash` reads them through
those names. Within one build that is consistent — the swap count is fixed by
`FED_PASSES` — and after an even number of passes each name is back on the array
it started on.

It only matters if you compare two builds whose `FED_PASSES` differ in
**parity**: one would be hashing the half the other calls the spare, and every
one of those six digests would read as moved when nothing had. If you ever need
that comparison, hash the pair as a set rather than by name. Changing
`FED_PASSES` at all is a change to the plate, so `determinism.js` is the wrong
tool for it either way — `outcome.js` is.

## cover.js

How much of its food the culture is standing on, at the level the mass layer
draws. Two figures per station, each a plain fraction of a disc:

- **disc** — of the flake's own disc, how much is at or above the traced level.
- **dot** — the same, over the little disc the food ITSELF is drawn as. This is
  the one that decides whether the plate can draw the food as engulfed: tissue
  everywhere else on a flake does not cover the crumb in the middle of it.

```bash
node tools/cover.js                        # win + 15 s, four seeds of EXP-01
AT=59 node tools/cover.js                  # at a sim time instead of at the win
LEVELS=1 node tools/cover.js               # and sweep the level, BODY_LEVELS[0..6]
CASE=EXP-03 SEEDS=3039 node tools/cover.js
```

It reads `SLIME.cover(lvIdx)`, which takes the level so that "no tissue" and
"tissue below the line the renderer cuts at" cannot be confused — which is
exactly what they were. Measured on EXP-01 at 59 s, the dots read 0.00 at the
level pads were traced at and 1.00 four levels down: the tissue was on the
food the whole time and the mass layer was cutting above it. That is what
PUDDLE_SKIRT_LV answers.

### Why an unwon run is dropped rather than averaged

The default moment is fifteen seconds after the last flake goes down, inside
the `WIN_HOLD` window while the plate is still moving. A dish that never wins
has no such moment, so it is reported `NOT MEASURABLE` and left out of the
summary rather than sampled at the cap: a losing run's flakes are uncovered
because the culture never got there, which is a true fact about a different
question. Use `AT=` when the question really is "at this time" — and that
moment is held to the same rule, since a dish that ended or hit the step cap
before it never reached it either. Both cases are detected rather than waited
out: `runTo` parks a run on the cap with `S.paused` set and `S.running` still
true, so a harness that reads only `S.running` sits out its whole timeout on
every seed that does not finish.

### The measurement this replaces

`67e4a7a` claimed coverage went from 0.43 to 0.57 and was reverted by
`f50f3f8` because those two numbers came from different measurements — one
band-weighted at an instant, one a whole-disc fraction — so the comparison was
never like for like. Re-measured properly it was +0.033 against a pooled
standard error near 0.073, with the spread nearly tripled. There is one figure
here, its shape is stated above, and the moment it is taken at is printed with
it. A coverage claim that does not say *which* fraction, over *what*, *when* is
not a measurement.

## mass.js

What the mass layer draws, and whether it has an EDGE.

The layer paints the tissue heaped on the food. It used to do that by filling
the body's contour inside a circle at each station, and a fill that is opaque
where the circle lands draws an ARC wherever tissue crosses it. That is the
defect; `PAD_BUDGET` in `sim.js` is the replacement, and this is how both are
held to a number.

```bash
node tools/mass.js                              # EXP-01, one seed, three times
CLIP=1 node tools/mass.js                       # and what the circle does there
TUNE=13@0.6,18@0.43,26@0.3 node tools/mass.js   # sweep the budget
SHOTS=/tmp/shots TIMES=45 node tools/mass.js    # write the plate as a png too
```

Two figures, both at a stated moment and on one run:

- **mass** — per station, `core`/`crad`: the cells painted at a weight of half
  or better, and how far the furthest of them is. Cells, 0.551 mm each.
- **step** — the largest step the layer's opacity takes between neighbouring
  lattice cells that are both tissue, `any` anywhere and `wide` where both are
  at least six cells from the tissue's edge. An edge in a picture is a step in
  a line; this is that step, as a number.

`quads` is what the trace actually looked at on the last rebuild, against the
plate's 108,780 — 5 % of them at 45 s and 10.5 % at 120 s. It is printed
because the layer's whole performance claim rests on it, and a claim that is
not printed is a claim nobody re-checks.

`step` is the figure a clip cannot win, and `CLIP=1` prints why: the circle's
fill is at full alpha where it lands, so it steps by the whole of it —
0.92 — over the share of the circle that `in` reports as standing on tissue,
of which `thru` cuts tissue that carries on outside. Measured on
EXP-01/11f9a2, the origin's circle stands on tissue over 0.80 of itself at
20 s with 0.72 of it cutting, and each flake's over 0.23 to 0.41 at 120 s.
The budget's worst step over the same run is 0.26 where the tissue is wide
enough for a step to read.

### What TUNE trades

`budget@hold` — the budget in `PAD_D_REF` units, and the share of it held at
full weight before the fade begins. Hold is how far the mass reaches; budget
minus hold is how long it takes to fade; a longer fade is a smaller step at
the cost of a wider mass. There is no setting that is small and soft, and
that is the whole choice the layer offers:

| budget@hold | flake reach at 120 s | of the plate | step where wide |
|---|---|---|---|
| 13@0.6  | 29–34 cells | 7.0 % | 0.55 |
| 18@0.43 | 32–37 cells | 9.1 % | 0.26 |
| 26@0.3  | 36–41 cells | 12.8 % | 0.21 |

## vein.js

Whether a station wearing a mass has a vein drawn INTO it.

The complaint this was written for: a pad two thirds covered by a puddle that
no bright line reaches — tissue plainly on the food, and nothing on the plate
saying how the organism got there. The two layers are drawn from different
state. `PAD_BUDGET` seeds at each station's own food and spends a travel
budget outward from it; the tree grows from the inoculation drop into
`trail >= BODY_LEVELS[TREE_LV]` and can only ever extend from its own front.
Nothing makes them agree, so a station can carry one and not the other.

```bash
node tools/vein.js                          # five dishes' worth is the sweep
T0=10 T1=150 DT=5 node tools/vein.js        # the scan, by default
ROWS=1 SEEDS=efe8ba node tools/vein.js      # every station at every moment
TIMES=45 node tools/vein.js                 # or just this moment
LV=0 node tools/vein.js                     # the tree at the mass's level
SHOTS=/tmp/shots node tools/vein.js         # write the plate as a png too
```

Five verdicts, in the last column of each row:

- **ISLAND** — a mass is drawn and no live tree node stands in it.
- **FAINT** — a live node stands in it and the widest is a band-0 hairline,
  0.34 cells = 0.19 mm, which is what the record's own ink texture is.
- **GHOST** — the widest one's chain home crosses a ghosted segment.
- **CUT** — the chain home crosses a segment `paintTree` drops for a wall.
- **ok** — a node in the mass, band 1 or better, chain home solid.

### The station's own mass, and not the neighbourhood's

`mass.js` takes its figures over a disc of radius 35 lattice cells around each
station. That is right on a dish that spaces its flakes out and wrong on one
that does not: the disc swallows the next station's puddle, `crad` pins to the
cap, and a vein search over that radius then answers about somebody else's
trunk. On EXP-03 that produced twelve `FAINT` verdicts at stations whose own
`prog` was 0.00 — stations with no mass at all, sitting inside a neighbour's.

So this floods instead, from the station's own food, over lattice cells at a
weight of half or better, and measures the one piece the station is standing
in. It is the same figure on EXP-01 and a different one wherever stations
crowd.

### The gap, which is the number a fix has to move

Sampling on a fixed interval turns the verdicts into a per-station figure that
does not depend on where the samples fell: when the mass first appears, when a
live node first stands inside it, and the gap between them.

Measured over EXP-01/03/08/09/16, four seeds each, 10–150 s at 5 s:

| dish | stations with a gap | mean | worst |
|---|---|---|---|
| EXP-01 | 3 of 20 | 14.8 s | 19.8 s |
| EXP-03 | 3 of 40 | 5.0 s | 5.2 s |
| EXP-09 | 1 of 16 | 5.1 s | 5.1 s |
| EXP-08, EXP-16 | 0 of 72 | — | — |

It concentrates in EXP-01, which is the open plate with its four flakes in the
corners — the dish where the culture reaches food across bare agar rather than
down a channel. Every gap closes; none is permanent.

### treeWhy, which is why it is not a threshold

The obvious reading is that the tree's level is stricter than the mass's —
`BODY_LEVELS[TREE_LV]` is 9 against `BODY_LEVELS[PAD_MASK_LV]` 6 — and that
lowering it would let the tree follow. `LV=0` measures that, and it does not:
on EXP-01/efe8ba the vein still arrives at t=50.1, unchanged.

`SLIME.treeWhy(node, R)` says why. It replays `treeGrow`'s own attractor pass
over a window and classifies every jittered lattice point it would visit:
`nolv` below the growth level, `spent` already claimed by a node's kill disc,
`far` at the level and unspent with no live node within `TREE_INF`, and `pull`
a real pull the next pass acts on. On the island station, through the window:

```
  t    nearL |  level 9:  nolv spent  far  pull  pullNear | level 6: nolv  far  pull
 30.1   34.7 |             834    10    4     3      34.7 |           820   12     3
 40.3   34.7 |             797    10   30    14      34.7 |           757   43    26
 45.1   34.0 |             778    28   38     7      34.0 |           732   51    14
 50.1    4.2 |             765    81    0     5      12.1 |           720    0    19
```

`nolv` is ~800 of ~860 in-plate points at BOTH levels: the window is bare
agar, and level 6 offers only forty more points than level 9. That is why
lowering the level buys nothing — there is no tissue to grow into either way.

`far` is the defect's signature. It counts tissue that IS at the growth level
and unspent and has no live node near enough to be pulled by it — the flake's
own local mass, which agents reached and are eating. It climbs 4 → 38 across
the window and collapses to 0 the moment the vein arrives.

`pullNear` sits at 34.7 for twenty seconds and then jumps to 12.1. The front
does not creep toward the flake; it is held, and then crosses thirty cells at
once, which is one second of growth at `TREE_STEP` x the pass rate.

So the mechanism is not a threshold. The mass layer seeds at a station
independently and needs no connection to anything; the tree is by construction
one connected thing rooted at the drop. A flake the runners have reached grows
an island of tissue the mass draws at once and the tree cannot reach, because
the agar between them holds no tissue at any level the renderer uses — the
runners' own path decayed behind them.
