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

Every run's 24-bit seed doubles as its colour: the specimen line printed on
the result screen (`#a3f2c1`) sets the hue the organism grows in, with
saturation and lightness adjusted from the raw hex only as far as needed to
hold WCAG contrast against the agar whatever the seed.

## Controls

| input | effect |
|---|---|
| hold left / drag | growth cue — the exploratory front flows toward it |
| hold right / shift | retract — pull cytoplasm back out of a region |
| space | pause (hold the clock) |
| R | reset the dish |

## How the sim works

Each experiment runs the same agent-based Physarum model underneath: a swarm
of simulated pseudopodial "particles" sense a diffusing, decaying chemical
trail field a short distance ahead, rotate toward whichever sensor reads
strongest, step forward, and deposit trail behind them — the classic
sense–rotate–deposit loop (the discrete cousin of Jones' particle model of
*Physarum* growth). Food sources bias deposition, the trail field diffuses
and decays every tick, and reinforced paths simply persist while unused ones
fade — which is what produces maze-shortening and network-thinning behavior
without any pathfinding code telling it the answer. It's a real, if modest,
implementation of that model, not a hand-scripted imitation of one; don't
expect anything close to a research-grade solver.

## Run locally

Open `index.html` in a browser. That's it — no server, no build, no install.

## Deploy

Deploying is a separate step from merging — see `DEPLOY.md` for the runbook
(`slime deploy` on the droplet). Landing a change on `main` does not put it
live.
