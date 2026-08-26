# SLIME

You are specimen 980, a culture of *Physarum polycephalum* — no brain, no
neurons, no centre, just several million nuclei sharing one cytoplasm and a
good nose for food. The lab runs five experiments. You run them from the
inside.

Fully static: one `index.html` and `js/sim.js`. No build step, no
dependencies, no framework. Open the file, that's the whole app.

## The five experiments

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
