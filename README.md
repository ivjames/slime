# SLIME

You are specimen 980, a culture of *Physarum polycephalum* — no brain, no
neurons, no centre, just several million nuclei sharing one cytoplasm and a
good nose for food. The lab runs twenty experiments. You run them from the
inside.

Fully static: one `index.html` and `js/sim.js`. No build step, no
dependencies, no framework. Open the file, that's the whole app.

## The experiments

Nine reproduce published *Physarum* results; the rest are the lab's own
follow-ups on the same machinery.

- **EXP-01 — FIRST CONTACT.** No apparatus, no hypothesis. Just being an
  organism in a dish: sense, extend, retract, feed. Everything else is built
  on top of this.
- **EXP-02 — THE LABYRINTH.** Find the shortest path between two food sources through
  a labyrinth by pruning every route that isn't it. Nakagaki, Yamada & Tóth,
  *Nature* 407, 470 (2000).
- **EXP-03 — THE COMMUTER MAP.** Reproduce a transport network by growing toward
  scattered food sources laid out as Greater Tokyo's cities, then thinning
  to an efficient tree. Tero et al., *Science* 327, 439–442 (2010).
- **EXP-04 — THE BITTER BRIDGE.** Learn to stop avoiding a harmless-but-repellent
  substance blocking the only route to food. Boisseau, Vogel & Dussutour,
  *Proc. R. Soc. B* 283: 20160446 (2016) — habituation to quinine and
  caffeine without a nervous system.
- **EXP-05 — THE FORECAST.** A hazard arrives on a fixed interval; slow down (or
  stop) in anticipation before it does. Saigusa, Tero, Nakagaki & Kuramoto,
  *Phys. Rev. Lett.* 100, 018101 (2008).
- **EXP-06 — THE U-TRAP.** Escape a U-shaped trap by avoiding your own spent
  slime — memory kept outside the body. Reid, Latty, Dussutour & Beekman,
  *PNAS* 109, 17490 (2012).
- **EXP-07 — THE LIT MAZE.** A lit shortcut against a dark detour: the network
  minimises risk × length, not length. Nakagaki et al., *Phys. Rev. Lett.*
  99, 068104 (2007).
- **EXP-08 — THE DIET.** Eight lopsided nutrient blends; compose a ~2:1
  protein:carbohydrate intake by eating some and refusing the rest.
  Dussutour, Latty, Beekman & Simpson, *PNAS* 107, 4607 (2010).
- **EXP-09 — THE DECOY.** Two good meals and one close, tempting, inferior
  one — context-dependent preference in an organism with no context to
  speak of. Latty & Beekman, *Proc. R. Soc. B* 278, 307 (2011).
- **EXP-10 — THE GRAFT.** Habituation acquired by fusing with a culture that
  already learned it, through the vein the two of you share. Vogel &
  Dussutour, *Proc. R. Soc. B* 283, 20162382 (2016).
- **EXP-11 — THE WARM ROOM.** A dish partitioned by heat instead of walls;
  the corridors are wherever it is cool.
- **EXP-12 — THE SWEEP.** A heater bar walks the dish end to end; grow around
  it, abandon ahead of it, regrow behind it.
- **EXP-13 — THE MISSED BEAT.** A fixed dry-shock rhythm, except the fourth
  beat is withheld — the anticipation probe run from the inside.
- **EXP-14 — THE SYNCOPATION.** Dry shocks on a contracting interval; build
  refuges while the rhythm still leaves room.
- **EXP-15 — THE TIDE.** Engulfed ground reverts when left unattended; hold
  six stations at once or watch them seal over.
- **EXP-16 — THE TRIAGE.** Eight flakes, resources for six. Choose what to
  hold and concede the rest.
- **EXP-17 — THE REVISION.** The labyrinth is re-cut twice mid-run; the
  network must abandon a solved answer and solve the new one.
- **EXP-18 — THE DRAWBRIDGE.** Two doors through the dividing wall, one open
  at a time, on a schedule. Time the crossing.
- **EXP-19 — THE FIRE DRILL.** Each dry shock also floods the open plain with
  heat: anticipate, contract to the refuges, re-expand.
- **EXP-20 — THE LONG NIGHT.** The capstone: resealing ground, accelerating
  shocks, a heat moat, and one wall that moves. Everything the schedule
  taught, at once.

Every run's 24-bit seed is printed on the result screen as a specimen line
(`#a3f2c1`) and reproduces that dish cell for cell — `SLIME.start(idx, seed)`
runs it again. It used to double as the run's colour, setting the hue the
organism grew in; it no longer does. The organism is the colour the organism
is, in every run: the chrome yellow of a *Physarum* plasmodium on agar,
lit toward a warm cream on the trunks and thinning to a pale, milky film at
the advancing front. The contrast solve that once had to survive any hue the
seed might name is still there, now as a guard on that one palette.

## Controls

| input | effect |
|---|---|
| hold left / drag | growth cue — the exploratory front flows toward it |
| hold right / shift | retract — pull cytoplasm back out of a region |
| space | pause (hold the clock) |
| F | time-lapse — cycle the dish clock ×1 / ×4 / ×12 |
| R | reset the dish |
| Escape | close the key list, leave a replay, abandon the dish — in that order |

### The cue reserve

Cueing is not free. Every dish but EXP-01 runs a reserve of cue-seconds:
holding the brush spends it, letting go rebuilds it at rather less than the
rate it went, and at zero the brush paints nothing until you release. The
meter on the console reads it, and the note line says so when it runs out.

It exists because a free brush had exactly one dominant line of play on all
twenty dishes — park the cue on the food and wait — which is not steering an
organism so much as holding a door open for it. The intended rhythm is nudge,
let the chemotaxis run, nudge again: the organism does the searching, and the
player only says which way looks interesting. Retract draws at half rate,
because pulling out of a dead end is the corrective move and the dishes that
need it most are the ones where being unable to afford it would be fatal
rather than instructive.

## Marks

A finished run is scored out of 100 on four axes, each a ratio of the run
against itself or against the dish's own geometry, so none of them needs a
hand-tuned par per dish.

| axis | weight | what it reads |
|---|---|---|
| economy | .40 | the network you were left holding, against the shortest one that could have joined the same points — Tero 2010's own comparison, plasmodium against minimum spanning tree |
| autonomy | .30 | how little of the run the brush was held for |
| vigour | .15 | biomass at the end against the peak — pruning is the result, arriving starved is a different outcome that satisfies the same gate |
| dispatch | .15 | how much of the plate's clock you left unspent (the sixteen dishes that set one; the other four renormalise over the first three) |

The mark bands are the observer's marginal note: **crude**, **workable**,
**sound**, **clean**, **exemplary**. Your best mark per dish is kept beside
your best time, and the run that earned it is kept with it — see below.

The economy axis measures the finished network against a straight-line
spanning tree, which ignores walls, so a cut labyrinth scores lower across the
board than open agar does. That is left alone on purpose: a mark is only ever
compared against your own best on that dish, or against other people running
that same dish on the same day, and both comparisons hold the geometry fixed.

## Replays, ghosts and links

Every run records the cues that produced it, and the dish is a pure function
of its seed and those cues — so the verdict screen can replay the run you just
finished, at ×1, ×4 or ×12.

- **Ghosts.** The run that earned your best mark on a dish is kept, and
  **Best run** on the verdict screen plays it back. It replays cell for cell,
  not approximately: the pointer is snapped to a sixteenth of a cell when it
  enters the program, which is below the resolution of the pointer that
  produced it and is what lets a whole run be written down and read back.
- **Plate links.** The fragment addresses a dish and a seed, so any plate can
  be handed to somebody else. `#EXP-03/a3f2c1` opens that dish on that exact
  plate, `#EXP-03` alone opens its brief, and `#daily` opens the day's.
  **Copy link** on the verdict screen puts the current one on the clipboard.
- **The plate of the day.** One dish and one seed derived from the UTC day
  number, so every copy of the page derives the same plate and two people
  comparing marks are comparing the same run. It ignores the unlock gate and
  logging it advances nothing — it is a plate, not a place in the schedule.

## The schedule

Dishes unlock on a count rather than in a chain: two beyond your logged total
stay open, so a dish you cannot beat can be walked around without the rest of
the schedule being skippable. A locked card says how many more runs would open
it. The daily plate and any plate link ignore the gate entirely.

On a touch screen the same verbs are a hold or drag for a growth cue, a second
finger to flip that drag into a retract, and a Grow / Retract switch on the
control row for retracting one-handed. Hold and the time-lapse sit beside it;
the rest — reset, abandon, and this table — are behind **Controls**.

## How the sim works

Each experiment runs the same agent-based Physarum model underneath: a swarm
of simulated pseudopodial "particles" sense a diffusing, decaying chemical
trail field a short distance ahead, rotate toward whichever sensor reads
strongest, step forward, and deposit trail behind them — the classic
sense–rotate–deposit loop (the discrete cousin of Jones' particle model of
*Physarum* growth). Food sources bias deposition, the trail field diffuses
and decays every tick, and reinforced paths simply persist while unused ones
fade — which is what produces maze-shortening and network-thinning behavior
without any pathfinding code telling it the answer.

Two things happen on top of that loop, because a plasmodium is not only
filaments. A front that reaches food stops being a front: it spreads across
the flake and thickens into a pad, which is where absorption actually happens
and is why the dish is eaten by contact area rather than by whichever tube
happens to be passing. And where tubes meet or turn a hard corner, the network
grows a lobe — a swelling of cytoplasm parked at the junction, marked by the
agents that notice they are standing at one and built by the traffic that goes
through it afterwards. Both are drawn as masses rather than as lines. And an
exploratory filament leaves a short-lived trace as it runs, which the nuclei
behind it follow: cytoplasm streams out along a pioneer's line and keeps its
young tube supplied, instead of letting it decay behind the tip and strand the
front — the chain still breaks for filaments nothing follows, which is the
pruning, but no longer for want of being noticed. It's a real, if modest,
implementation of that model, not a hand-scripted imitation of one; don't
expect anything close to a research-grade solver.

## Run locally

Open `index.html` in a browser. That's it — no server, no build, no install.

## Deploy

Deploying is a separate step from merging — see `DEPLOY.md` for the runbook
(`slime deploy` on the droplet). Landing a change on `main` does not put it
live.
