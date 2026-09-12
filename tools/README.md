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

Environment: `STEPS` (default 2000), `CASES` (default
`EXP-01/3039,EXP-02/a1b2,EXP-05/7f31` — an open plate, a maze so the wall tests
in the sweeps are exercised, and a dish with timed events), `CHROMIUM` to point
at a browser other than the pre-installed one.

### What it is and is not sensitive to

Verified, on EXP-01/3039 at 600 steps:

- Perturbing `COND_RATE` by 5e-8 relative **diverges**, and is localised to
  `condF` with all forty-two other digests held. A change that moves the dish
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
