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
in the sweeps are exercised, and a dish with timed events), `CHROMIUM` to point
at a browser other than the pre-installed one.

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
Two passes have been run. The first added `nodeHits`, `nodeLoad`, `reabCursor`
and `idleCursor`; the second added `tubeDist`, which is rebuilt every
`TUBE_EVERY` steps and read inside the agent loop by a streaming agent walking
its goal's geodesic.

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
question. Use `AT=` when the question really is "at this time".

### The measurement this replaces

`67e4a7a` claimed coverage went from 0.43 to 0.57 and was reverted by
`f50f3f8` because those two numbers came from different measurements — one
band-weighted at an instant, one a whole-disc fraction — so the comparison was
never like for like. Re-measured properly it was +0.033 against a pooled
standard error near 0.073, with the spread nearly tripled. There is one figure
here, its shape is stated above, and the moment it is taken at is printed with
it. A coverage claim that does not say *which* fraction, over *what*, *when* is
not a measurement.
