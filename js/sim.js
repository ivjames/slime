/* ============================================================
   SLIME — Physarum polycephalum, specimen 980
   Agent-based physarum simulation + the five experiments.
   Plain script. No modules, no imports, no fetch, no deps.
   Safe from file://. Loaded at the end of <body>.
   ============================================================ */
(function () {
'use strict';

/* ------------------------------------------------------------
   0. small helpers
   ------------------------------------------------------------ */
function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function pad2(n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; }
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  return pad2(s / 60 | 0) + ':' + pad2(s % 60);
}
/* A rate off the time-lapse ladder, as a label. Below ×1 the stops are
   inverse powers of two, and "1/8" is what those are called — 0.125 is the
   same number answering a different question, and reads as a measurement
   rather than as a stop on a dial. Anything off the ladder (a harness may set
   any rate in range) prints as a trimmed decimal rather than as a fraction it
   is not. */
function fmtSpeed(t) {
  if (!isFinite(t) || t <= 0) t = 1;
  if (t < 1) {
    var d = Math.round(1 / t);
    if (d > 0 && Math.abs(1 / d - t) < 1e-9) return '1/' + d;
  }
  return String(Math.round(t * 1000) / 1000);
}
function fmtNum(n) {
  n = Math.round(n);
  var s = String(n), out = '', c = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    out = s.charAt(i) + out;
    if (++c % 3 === 0 && i > 0) out = ',' + out;
  }
  return out;
}
/* ------------------------------------------------------------
   0b. seeded RNG — the whole simulation draws from here
   ------------------------------------------------------------
   Everything in the sim path that used to call Math.random() calls rnd()
   instead. One consequence is the contract the time-lapse control depends
   on: the draw sequence is a function of the SEED and the number of sim
   STEPS executed, and of nothing else — not the wall clock, not the frame
   rate, not how many steps a given frame happened to fit in. So the same
   seed with the same player input produces the same dish at 1x and at 12x,
   on a fast machine and a slow one.

   mulberry32: one imul-avalanche per draw, 32 bits of state, no allocation.
   Fast enough to sit in the per-agent inner loop (it runs ~5x per agent per
   step, so ~70k times a step at the agent ceiling). */
var RNG_STATE = 0;
function rndSeed(s) { RNG_STATE = s >>> 0; }
function rnd() {
  RNG_STATE = (RNG_STATE + 0x6D2B79F5) | 0;
  var t = RNG_STATE;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* Seeds are 24-bit so the notebook stamp (#a3f2c1) round-trips exactly:
   what the result screen prints is the whole seed, not a truncation of it,
   so a player who copies it back into SLIME.start() gets that dish again. */
var SEED_MASK = 0xFFFFFF;

function mix32(a, b, c) {
  var h = (0x811C9DC5 ^ (a | 0)) | 0;
  h = Math.imul(h ^ (b | 0), 0x01000193);
  h = Math.imul(h ^ (c | 0), 0x01000193);
  h ^= h >>> 15; h = Math.imul(h, 0x2545F491); h ^= h >>> 13;
  return h >>> 0;
}
function normSeed(s) {
  if (typeof s === 'string') {
    var v = parseInt(s.replace(/^#/, ''), 16);
    return isFinite(v) ? (v >>> 0) & SEED_MASK : 0;
  }
  return (s >>> 0) & SEED_MASK;
}
function seedLabel(s) {
  var h = ((s >>> 0) & SEED_MASK).toString(16);
  while (h.length < 6) h = '0' + h;
  return '#' + h;
}

function pick(arr) { return arr[(rnd() * arr.length) | 0]; }

/* ------------------------------------------------------------
   0c. colour: HSL, WCAG contrast
   ------------------------------------------------------------
   The organism is grown in the colour the organism actually is: the chrome
   yellow of a Physarum plasmodium on agar. One palette, every run — the seed
   still names the plate and still reproduces it cell for cell, but it no
   longer names its colour, because a specimen line is a specimen line and a
   slime mold is yellow.

   The machinery below outlived the seed that needed it. It was written when
   the seed picked the hue and so could pick one that vanished against a
   nearly black dish or turned the dark-on-accent buttons into mud, and it
   answers that by COMPUTING contrast against the real backgrounds and walking
   the lightness until it clears the bar. With one fixed colour the walk has
   nothing to do — the shipped tone clears every floor with margin, see
   applyPalette — so what is left is a guard: change PLASMODIUM to a tone that
   does not clear, and the dish stays legible rather than silently going
   unreadable. Pure arithmetic, no draws — the palette must not perturb the
   sim stream. */
function srgbLin(c) {
  c = c / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relLum(r, g, b) {
  return 0.2126 * srgbLin(r) + 0.7152 * srgbLin(g) + 0.0722 * srgbLin(b);
}
function contrast(l1, l2) {
  var hi = l1 > l2 ? l1 : l2, lo = l1 > l2 ? l2 : l1;
  return (hi + 0.05) / (lo + 0.05);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  var h = 0, s = 0, l = (mx + mn) / 2, d = mx - mn;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  var r, g, b;
  if (s === 0) { r = l; g = l; b = l; }
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function mixToward(c, t, k) {
  return [Math.round(c[0] + (t[0] - c[0]) * k),
          Math.round(c[1] + (t[1] - c[1]) * k),
          Math.round(c[2] + (t[2] - c[2]) * k)];
}
/* Two different walks, and which one a thing takes is a claim about what the
   thing IS. mixWhite is translucency: a film thin enough to see the lamp
   through loses colour as it thins, which is what the advancing fan does.
   mixLamp is illumination: a lit surface keeps its pigment and gains the
   lamp's, which is what a tube's crest does. Walking a crest toward white was
   the old way and it bleached the trunks — see VEIN_BANDS. */
function mixWhite(c, k) { return mixToward(c, [255, 255, 255], k); }
function mixLamp(c, k) { return mixToward(c, LAMP, k); }
function hex2(n) { var h = (n | 0).toString(16); return h.length < 2 ? '0' + h : h; }
function hexOf(c) { return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]); }
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

/* Coarse pointer = phone/tablet. Feature-tested, never UA-sniffed: the media
   query answers for the primary pointer, the touch-point count catches a
   touchscreen the query calls fine. Latched on, so a laptop that is both
   keeps its mouse copy until a finger actually lands (see markTouch). */
var TOUCH = false;
function detectCoarse() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  } catch (err) { /* no matchMedia — fall through to the touch-point test */ }
  if (navigator && (navigator.maxTouchPoints | 0) > 0) return true;
  return ('ontouchstart' in window);
}
/* A page zoomed before the guard above existed — or zoomed deliberately
   somewhere else and never zoomed back — opens the dish showing a corner of
   it. There is no API for "set the scale to 1", so this does the one thing
   that works: pins maximum-scale for a few frames, which makes the page
   re-lay out at 1, then hands zooming straight back. It fires only when the
   page is actually zoomed in, and nothing is left pinned afterwards. */
var zoomPinned = false;
function resetZoom() {
  var vv = window.visualViewport;
  if (zoomPinned || !vv || !(vv.scale > 1.01)) return;
  var m = document.querySelector('meta[name=viewport]');
  if (!m) return;
  var was = m.getAttribute('content');
  zoomPinned = true;
  m.setAttribute('content', was + ',maximum-scale=1');
  window.setTimeout(function () {
    m.setAttribute('content', was);
    zoomPinned = false;
  }, 350);
}

function markTouch() {
  if (TOUCH) return;
  TOUCH = true;
  document.body.classList.add('touch');
  /* touch buttons are 44px and carry more padding, so the row needs more
     width than it did a moment ago — see DOCK */
  dockActions();
}

/* ------------------------------------------------------------
   1. simulation constants
   ------------------------------------------------------------ */
var GW = 420, GH = 260, NCELL = GW * GH;   // internal grid resolution
var MAXA = 14000;                          // hard agent ceiling (typed array size)
var DT = 1 / 60;                           // fixed sim timestep
/* ---- pace ----
   How many dish-seconds the organism now takes to do what it used to do in
   one. The supply test (see TIP_FEED) stops a tip outrunning the network, so
   the front advances at the speed cytoplasm follows it rather than at the
   speed a lone thread can be laid, and that is slower by about this factor.
   Every dish was tuned to the fast organism: its grace period, time limit,
   shock schedule and wall events are in dish-seconds, and so are the rates
   it starves, eats, habituates and takes damage at. Stretching the
   schedules by PACE and dividing the rates by it puts every dish back where
   it was, measured in the organism's own progress rather than in seconds.
   paceDish() applies it to the dish definitions once at load; the handful
   of rates that live outside them are scaled where they are declared or
   used. What is NOT scaled is anything per step tied to the organism's own
   motion — trail decay, the trace, conductivity, the adrift clock — since an
   agent still moves the same cells per step; it is the front that is slower,
   not the cytoplasm. At 1 now: the front is the filament front again (see
   TIP_FEED), which is the organism every dish was tuned to, and the scaffold
   stays for the next time the organism's pace moves. Growth is not scaled either, and that one is measured
   rather than argued: a sheet's reach is set by its biomass, not by time, so
   a dish whose far food is reached by eating the near food first and growing
   is reached at the speed the culture grows. Dividing growth by PACE doubled
   the time to win EXP-03 at PACE 2 and left it unwon at 18000 steps at PACE
   3. The clocks that punish the organism are stretched; the one that feeds
   it is left alone. */
var PACE = 1;

/* Motion + trail are the Jones (2010) lattice-forming regime, in grid cells:
   a 45 deg rotation toward the better sensor, one cell of travel per step, a
   fat deposit onto a field that decays a few percent a frame and is blurred
   once a frame. Every one of these matters for reticulation — the previous
   values (a 0.62-cell step, a 0.34 deposit onto a 0.962 decay) smeared the
   field into one blob instead of resolving veins.

   The one deliberate departure is the sensor offset: Jones' ~9 cells sets the
   mesh scale, and 9 on a dish only 420x260 leaves room for about six tubes
   and no holes at all. Five halves the vein width and buys a mesh of
   twenty-to-fifty cells, which is what reads as physarum at this size. */
var SENS_D = 6.5;      // sensor distance, cells
var SENS_A = 0.40;     // sensor half-angle, rad (~23 deg)
var TURN   = 0.79;     // rotation per step toward the better sensor, rad (45 deg)
var SPEED  = 1.0;      // cells per step
var JITTER = 0.11;     // random heading jitter per step — the probing of the front

/* ---- the advancing tip ----
   Physarum does not advance as a wall. It advances as a fan of filaments that
   run, split and run again, and the constants below are what separate a tip
   at the front from cytoplasm inside a tube. Without them every agent obeys
   one rule, the front random-walks as a blob, and the branching structure has
   to be imagined rather than seen.

   What counts as a tip is decided by what is AHEAD of the agent, not by what
   is under it. Reading the cell it stands on looks equivalent and is not: a
   tip lays a tube as it goes, so within a step or two it is standing on its
   own fresh deposit, tests as cytoplasm, drops back to the short-range rule
   and the filament stalls one cell after it started. The frontier test has no
   such feedback — an agent is a tip exactly while there is open agar in front
   of it, which is also what the word means.

   TIP_SENS is a longer reach, because a tip has nothing local to read and must
   commit to a direction over a distance; TIP_PERSIST is an apical bias added
   to the forward sensor only, so a tip holds its line unless a flank sensor
   genuinely beats it (against SENS_NOISE of 1.5 this is a lean, not a veto — a
   real gradient still turns it); TIP_JIT is the reduced wander that makes the
   result a needle rather than a scribble. */
var TIP_LOOK    = 3.5;   // how far ahead the frontier test looks, cells
var TIP_TRAIL   = 9.0;   // trail ahead below which the agent is at the front
var TIP_SENS    = 9.5;   // a tip's sensor reach, cells
var TIP_PERSIST = 1.15;  // forward-sensor bonus: apical dominance
var TIP_JIT     = 0.045; // a tip's heading jitter
var TIP_SPEED   = 0.20;  // a supplied tip's fraction of full speed

/* ---- supply ----
   A tip is fed by the tube behind it, and this is the constant that keeps the
   organism an organism. Granting every tip the same speed and the same deposit
   looks like the obvious reading of "the front moves faster", and it is a
   runaway: a fast straight tip is out on clean agar, where the frontier test
   is trivially satisfied, so it stays a tip, keeps its speed, and keeps going.
   Every agent it passes becomes a tip by the same argument. Measured, that
   regime put trail in 96% of the cells in the dish — a uniform haze with no
   edge, no lattice and nothing to look at, which is the opposite of the
   filaments it was reaching for.

   Reading the trail BEHIND the tip closes the loop. Cytoplasm has to come from
   somewhere: a tip connected to a real tube streams and advances, a tip whose
   own tail has decayed is not a tip at all but a detached scrap, and it slows
   to VOID_SPEED and is reabsorbed. Filaments can therefore only extend as far
   as the network can keep them supplied, branches compete for that supply, and
   the ones that lead nowhere are starved out — which is the pruning the whole
   game is about, arrived at from the growth rule rather than bolted on. */
var TIP_BACK = 6.0;      // how far BEHIND a tip its supply is read, cells
/* The bar a tip must clear: the trail TIP_BACK cells behind it, below
   TIP_FEED x TIP_MIN. The product is 3.0, and at 3.0 a tip on nothing but
   its own thread passes — it lays 36 trail per cell and six cells back that
   has decayed to about 23 — so a single agent can run a hairline out across
   the plate at twelve cells a second. That is the organism: a plasmodium
   sends out filaments that cost almost nothing, and that is how it reaches
   food a solid front cannot. Raising the bar to 18 was tried and measured
   (3/15/18/22/26/30 on EXP-01 and EXP-02): the fragments went away, and so
   did the reach — a 4500-agent sheet plateaus near 120 cells and EXP-01's
   flakes are at 200, so the first dish could not be won without a cue.
   The bar is back where it was. What was wrong with the hairlines was never
   that they were thin; it was that they BROKE — the thread behind a runner
   decayed, the runner and whatever followed it became an island, and the
   island lived on its own trail for good. That is handled where it happens,
   by the body test (CONN_T), which draws an island back into the body
   rather than asking the tip to be fat. */
var TIP_FEED = 12.0;     // trail there that counts as a supplied tube
var TIP_MIN  = 0.25;     // ...and the fraction of it below which this is no tip
/* What a tip lays per STEP, as a multiple of DEPOSIT — not per cell travelled
   like everything else. That exception is the point. Deposit is otherwise
   proportional to distance because trail is material dragged through a cell by
   flow, and charging a stalled agent a full dose is what used to wash the dish
   grey. But a tip is not one particle being dragged anywhere; it is the front
   of an advancing bulge, and the tube behind it is built by the cytoplasm
   arriving into it, at a rate that has nothing to do with how fast the front
   happens to be creeping. Charging it by distance makes a slow tip lay a thin
   tube, which supplies a slower tip, which lays a thinner one — the front
   stalls a few cells out of the body and the culture starves in place. The
   floor is what lets a pioneer lay a tube worth following. It is safe against
   the grey wash because it is gated on being a tip at all, and the supply test
   above denies that to anything that has come adrift. */
var TIP_LAY  = 3.0;      // trail a tip lays per step, as a multiple of DEPOSIT
/* The stalk. A tip's tube is a pseudopod, and a pseudopod has a stalk: the
   thread runs back from the tip to the body for as long as the tip is out,
   and in the organism it is cytoplasm, so it does not fade behind the tip
   the way a pheromone does. Here the trail IS a pheromone, and decayed at
   DECAY a runner's thread went below anything the eye or the body test could
   see about thirty cells behind it — so a runner two hundred cells out was a
   hair with a bead on the end and nothing between it and the body, which is
   the picture of a break. So what a tip lays is laid a second time into
   stalkF, which does not diffuse and decays at STALK_HOLD, and the trail is
   floored at the stalk: a runner's thread stays trail, and so stays drawn,
   stays followed and stays part of the body, for about sixteen seconds
   behind the tip — the width of the plate at a runner's speed. When the
   runner stops, its stalk fades over the same sixteen seconds, and the
   cytoplasm that followed it is off the body only once the thread has gone
   from under it; then it is drawn home. A hair that shortens and fades
   rather than a hair that snaps. */
var STALK_HOLD = 0.997;  // per-step decay of the stalk: 36 -> 2 in ~16 s
/* The floor is a fraction of the stalk, not the stalk. At the full value a
   runner's thread rendered as fat as a followed vein from the moment it was
   laid, because the trail under it read 36 whether anything had followed or
   not. At STALK_W the thread is a faint hairline until cytoplasm follows it
   and lays trail of its own — the vein is what following makes — and a
   thread nothing followed fades as the faint line it was. Connectivity is
   unaffected: 36 x 0.3 is still five times CONN_T for a hundred cells. */
var STALK_W    = 0.3;

/* ---- branching ----
   New cytoplasm is not sprinkled near the food any more; it is spent FORKING
   a tip, which is the one edit that turns a spreading front into a fractal.
   A fork takes a tip that is already running and splits it in two: apically
   (both halves turn, a Y), or laterally (a daughter leaves the flank of a
   trunk and the parent runs on). Each daughter is a tip in its own right and
   can fork again, so the structure that comes out is recursive rather than
   merely rough — a branch of a branch of a branch, which is what the dish
   actually looks like down a microscope.

   BRANCH_P is a share of the growth budget, not an extra population: the
   spawn accounting above it is unchanged, so forking cannot outrun the
   biomass a dish's engulfed nodes are paying for. The remainder still goes
   where it went before, thickening the network near food and under the
   player's cue, which is what keeps a trunk a trunk. */
var BRANCH_P    = 0.55;  // share of new cytoplasm spent forking a tip
var BRANCH_APEX = 0.66;  // ...of which this share are apical splits, not lateral
var BRANCH_A    = 0.60;  // apical half-angle, rad (~34 deg)
var BRANCH_LAT  = 1.28;  // lateral branch angle off the trunk, rad (~73 deg)
/* Sensor noise, and the reason it exists. The turn is decided by COMPARING
   three samples, so a field's weight changes nothing where it is the only
   field present — an arbitrarily faint food gradient still wins every
   comparison and still produces a dead-straight run at the flake. Noise of
   this size is the scale below which a gradient is only a statistical bias:
   the trail in a real vein (tens) is read exactly, the food gradient (~0.5
   per sensor step) merely tilts the odds, and an agent out on clean agar with
   nothing to sense random-walks instead of flying off in a straight line. */
var SENS_NOISE = 1.5;
/* Cytoplasm creep. An agent standing on established trail is inside the
   plasmodium and travels at full speed; one that has wandered out onto clean
   agar is a probing tip with no cytoplasm behind it and crawls. Without this
   the population is a gas: it expands ballistically to the dish walls in ten
   seconds, ends up at a fraction of a percent per cell, and a network cannot
   form at that density however well the sensors are tuned. With it the front
   advances only as fast as trail can be laid behind it, which is what a
   growing plasmodium actually looks like. */
var VOID_SPEED = 0.05; // fraction of full speed out on bare agar
var SPEED_REF  = 20.0; // trail level that buys full speed
var CUE_FLOW   = 0.95; // and a player cue buys it outright

var DEPOSIT   = 2.4;   // trail laid per agent per CELL TRAVELLED (see step())
var TRAIL_MAX = 90.0;
/* Per-step trail decay, and the constant that decides whether a filament can
   exist at all. At 0.945 a tube's half-life is a fifth of a second, which is
   shorter than the time a pioneering tip takes to advance its own body length:
   the tube it lays has decayed to nothing a few cells behind it, so it reads
   no supply, slows, lays less, and reads even less. Traced, the front crawled
   out at a sixtieth of a cell per step and the culture starved with every
   flake still untouched. Nothing downstream can fix that — an organism whose
   veins forget themselves faster than it can grow them is not going to build a
   network.

   At 0.985 the half-life is about three quarters of a second, which is long
   enough for cytoplasm to follow a new filament in and start maintaining it,
   and still short enough that a branch nothing uses is gone within a few
   seconds. DEPOSIT drops by the same factor the decay rose, so the level a
   busy tube settles at — deposit over one-minus-decay, which is what every
   other threshold in the file is scaled against — is where it was. */
var DECAY     = 0.985; // per-step trail decay
/* Side weight of the separable blur run once a frame. It sets how fat a vein
   can get: the classic 3x3 mean smears a one-cell tube out to six or seven,
   which on a 420x260 dish leaves room for about six tubes and no mesh at all. */
var DIFF      = 0.055;

/* Food is a WEAK bias, not the field the organism follows. It used to be
   worth 15x a normalised attractant against a trail that maxed out at 6, so
   every agent in the dish pointed at the nearest flake from birth and the
   culture flew there as a single filament. The lattice only appears when the
   agent's own trail is the dominant sensed term; food supplies a slow drift
   at the front, and gets its real pull only inside a flake's own aura. */
var FOODW = 2.6;       // weight of the static food attractant
var CUEW  = 26.0;      // weight of the player's growth cue
var RETW  = 30.0;      // weight of the player's retract field
var WALL_PEN = -9000;  // sensed cost of a wall cell

var CUE_DECAY = 0.905; // player fields dissipate after release
/* Brush radius. This has to be MUCH larger than the sensor reach: a cue
   is only sensed inside its own footprint, so a small brush laid even 25 cells
   off the slime edge is invisible to it and the front never moves. The radius
   is the range at which the player can lead the organism. */
var CUE_R = 52;

/* ---- the cue reserve ----
   A cue used to be free: holding the pointer cost nothing, so the dominant
   line of play on every one of the twenty dishes was the same one — park the
   brush on the food and wait. That is not steering an organism, it is holding
   a door open, and it flattened dishes whose whole difference is WHERE the
   organism has to be persuaded to go.

   So directing the front is now the scarce thing. The reserve is a pool of
   cue-seconds: holding spends it, releasing refills it, and at zero the brush
   paints nothing until you let go. The rule is deliberately one sentence long,
   because the player has to be able to feel it without reading it — and it
   makes the good line of play the one the biology already suggests. Nudge, let
   the chemotaxis run, nudge again. The organism does the search; the player
   only says which way is interesting.

   Retract draws at a reduced rate. Pulling cytoplasm out of a dead end is the
   corrective move, and the dishes that need it most — the shock schedules,
   where a refuge has to be held through a dry cycle — are the ones where being
   unable to afford it would be fatal rather than instructive.

   REGEN is below 1: a full reserve costs more real time to rebuild than it
   does to spend, which is what stops "hold, release, hold" from being the same
   free brush at a stutter. */
var CUE_CAP   = 26 * PACE;   // seconds of continuous cueing a full reserve buys (paced)
var CUE_REGEN = 0.55; // reserve-seconds recovered per second released
var CUE_RET   = 0.5;  // retract's share of the drain rate
var CUE_LOW   = 0.22; // fraction below which the meter reads critical

/* Sub-cell quantum the pointer is snapped to, so a recorded position is an
   Int16 rather than a double and a whole run fits in storage. The reasoning
   is at toGrid, which is the one place it is applied. */
var CUE_Q = 16;

var HAZ_HEAT = 9.0;    // repulsion of a heat zone
var HAZ_QUIN = 5.2;    // repulsion of a quinine zone (scaled by 1 - habituation)

/* Extracellular slime. A plasmodium leaves a non-living mat behind it and will
   not re-search ground that carries one — memory held outside the organism
   rather than inside it, which is the only kind it has. It never decays: that
   is the point. Deposit is small because every agent lays it every step,
   moved or blocked, so a front crossing once is enough to mark the ground. */
var SLIME_DEP = 0.015;

/* ---- the filamental trace ----
   The slime mat's living opposite. A pioneering filament is a supply chain
   with one weak link: the tube behind the tip decays on the same clock as
   every other tube, and if cytoplasm does not follow the filament in before
   that tube thins past TIP_MIN, the tip comes adrift and is reabsorbed — the
   chain breaks not because the direction was wrong but because nothing knew
   to follow. The trail field cannot carry that message: a young tube is
   faint, and faint trail is exactly what an agent's sensors rank last.

   So a tip that is actually supplied leaves a second mark as it runs — a
   trace saying "a filament passed here, moments ago" — and the trace is what
   other nuclei follow. It is laid three cells wide because it is READ by
   point sensors: a one-cell line at sensor range is a lottery, a three-cell
   corridor is a signal. It decays in a couple of seconds, so it recruits
   followers onto ground the front holds NOW and never becomes a map of
   everywhere the front has ever been. And it is weighted so that it wins on
   thin ground and loses inside the body: the sensed term is scaled down by
   the trail under it, the same shape as the slime mat's aversion, so a vein
   that has become established stops advertising and the followers it pulled
   in go back to reading the tube itself.

   Three fields now say three different things about a cell: trail is the
   tube (sensed, fast-decaying), the trace is the recent front (sensed,
   seconds), slime is the searched past (sensed where a dish asks, never
   fades). The knot field is the odd one out on purpose — a lobe is read from
   the tube it sits in, so marking one is not a message to anybody.

   None of this touches the supply test itself: a tip's feed is still read
   from the trail, so a filament nothing follows still starves and the
   pruning the game is built on still happens. The trace only gives the
   network a fair chance to keep the chain fed — inhibition, not immunity. */
var TRACE_DEP  = 0.50;  // trace a supplied tip lays into its own cell per step
var TRACE_SIDE = 0.50;  // ...and this fraction of it into the four neighbours
var TRACE_W    = 7.0;   // sensed weight of a full-strength trace
var TRACE_HOLD = 0.995; // per-step decay: half-life ~2.3s at 60 steps/s

/* ---- conductivity: the tube that carries is the tube that keeps ----
   The Tero/Kobayashi/Nakagaki result, which the Jones rule on its own does
   not contain: a tube THICKENS with the flux through it and a tube carrying
   nothing is withdrawn, and because the feedback is nonlinear the two
   outcomes separate rather than settling into an average. That is the whole
   difference between a network and a scribble. Without it the trail field is
   a footprint — every cell decays on the same clock whether it is a trunk
   carrying the culture's whole traffic or a dead end nothing has visited
   since it was laid — so two parallel routes to the same flake both survive
   at the same weight, and neither the reinforcement of the good one nor the
   pruning of the bad one ever happens. Measured on EXP-01 that is exactly
   what the dish did: the tissue mask turned over by a third every twenty
   seconds, which is a body with no skeleton, redrawing itself.

   The flux is not modelled separately. What a cell's traffic delivers is
   already computed once per agent per step as its deposit, so the flow
   accumulator sums that, and the conductivity is a slow low-pass of it
   through a saturating nonlinearity. Slow because a tube commits over
   seconds rather than frames — the point is a memory the trail field does
   not have — and saturating with a square because q^2/(1+q^2) is the cheapest
   form of the feedback with an exponent above one, which is what makes it
   winner-take-all rather than proportional.

   And it is spent as a FLOOR under the trail rather than as a slower decay.
   Slower decay was the first form and it is the wrong shape twice over. It is
   too weak where it matters — the whole point is a network that is still the
   same network half a minute later, and stretching a tube's half-life from
   three quarters of a second to one and a half is nothing on that scale
   (measured: the tissue mask still turned over by 71% between samples thirty
   seconds apart, against 76% before the change). And it cannot be made strong
   enough, because a cell's resting level is its deposit over one minus its
   decay, so buying a ten-second memory that way multiplies every busy tube by
   thirteen, pins the dish at TRAIL_MAX and flattens the vein bands, the tier
   histogram and the junction test, all of which read the trail for contrast
   rather than for presence.

   A floor states the thing itself. COND_LEVEL x conductivity is the calibre
   this cell's traffic maintains, and the cell does not fall below it while
   the traffic lasts; above it, deposit and decay do exactly what they did.
   Persistence is then bounded by construction — a fully committed tube holds
   at COND_LEVEL and no higher, so nothing saturates that was not already
   saturating — and the length of the memory is set by COND_RATE alone rather
   than by an exponent on a decay. That is also the honest reading of the
   source: in Tero's model the conductivity relaxes toward a function of the
   flux and the tube's calibre follows the conductivity, which is a floor
   under the tube, not a discount on its evaporation.

   COND_RATE is therefore the constant that decides how long the organism
   remembers a route. At 0.02 a sweep the time constant is about seven
   seconds: a tube has to carry traffic for that long before it is held, and
   a tube abandoned for that long stops being. Both halves matter — the first
   is why a single filament sweeping past does not leave a permanent tube
   behind it, the second is the pruning. */
var COND_Q     = 1 / 6;    // deposit per cell per sweep that counts as unit flux
var COND_RATE  = 0.02;     // share of the way to the drive taken per sweep
/* What a fully conductive cell holds. Comfortably over ADRIFT_T, so cytoplasm
   standing in a held tube is never mistaken for a scrap, and comfortably
   under TRAIL_MAX, so a maintained tube is still a tube rather than the
   ceiling — the vein bands, the tier histogram and the junction test all read
   the trail for contrast, and a floor set near the top would flatten all
   three. It was 46 first, which is high enough that the core outbid the food
   gradient for the agents that should have been following it. */
var COND_LEVEL = 34.0;     // the tube a fully conductive cell maintains
/* ---- the return signal: a find travels back down the tube ----
   Nothing above travels backwards. Food is a weak static attractant, a
   feeding agent lays a little more than a walking one, and conductivity is
   earned cell by cell from the traffic a cell happens to carry — so a tip
   that finds a flake tells the rest of the culture nothing, and the route it
   came by is held exactly as hard as any other route with the same traffic.
   The organism is not like that. Shuttle streaming carries a find back
   through the network within a minute, flow reorganises toward the fed
   route, and the exploratory branches beside it are drawn back into it:
   the plate thickens one tube and thins the ones next to it, and it does
   so from the food end, not from the core.

   Two signals, then, meeting in the middle. fedF is the find: every feeding
   agent stamps its cell 1 while the flake has food in it. At 1 and not at
   the share of food left, which was the first form: the fields keep one
   value and one label per cell, so where two flakes' signals overlap the
   louder wins, and a flake half eaten was being shouted down by a fresher
   one across the last forty cells of its own route — the connection cut
   from the core end while the pad was still feeding (measured on EXP-01 at
   fifty seconds: link 0.002 at the pad end of flake a's path, 0.4 at the
   core end, with a's pad at 0.44 and c's at 0.55). At 1 the boundary
   between two flakes' signals is the midline between them, each keeps its
   route to the core, and a route lapses when its flake is done and not
   before. bodyF is the body: the cytoplasm
   within FED_CORE_R of the inoculation point, stamped 1 every sweep, which
   is the mass the culture was seeded from and where nearly all of it still
   sits. Each PROPAGATES as a relaxation: every pass a cytoplasm cell takes
   the best of its own faded value and FED_STEP times the strongest of its
   eight neighbours, so the front advances one cell per pass and the value
   falls off as FED_STEP to the path length. Max, not sum, because a signal
   is a message rather than a substance: two routes to the same flake do not
   add up to a louder one.

   The CONNECTION is where the two meet. Along the shortest path between
   flake and body, fedF x bodyF is FED_STEP to the whole path length — the
   same number at every cell, since what one signal loses the other has not
   yet lost — and off that path it is lower by FED_STEP to the detour: how
   many more cells the best route through this cell is than the best route
   there is. A branch off the trunk, a parallel loop of the mesh, the far
   side of the core, are all just detours of different lengths, and one
   number says which they are. It is normalised per flake rather than
   across the dish: the find carries a label, padF, which starts as the
   product at the pad it was stamped on and is raised, cell by cell along
   the signal's own path, to the largest product that path has crossed. So
   the ratio fedF x bodyF / padF is 1 on any flake's trunk and pure
   geometry everywhere else, whatever the flake's distance or how much of
   it is left. Both halves of the label are needed. Stamped alone it goes
   stale: a trunk thickens from the core end first, the product there
   rises above what the pad knew when it stamped, and the ratio clamps to
   one across the whole core-side mesh (measured: the blob covered every
   tube within forty cells of the centre). Running-max alone normalises
   each path to itself, so a parallel route that never touches the trunk
   is a trunk in its own right. Together, the trunk carries its own current
   best and everything else is measured against it. Raised to FED_SHARP,
   that ratio is linkF, and a detour of n cells
   costs FED_STEP to n x FED_SHARP: at these numbers a four-cell detour
   keeps two thirds, a twenty-cell one an eighth, and the trunk is a
   corridor a few cells either side of the shortest path.

   Two things about the metric, both measured. A diagonal step costs
   FED_STEP to root two, not FED_STEP: with all eight neighbours a step
   apart the distance is Chebyshev, every path with the same max(dx, dy) is
   shortest, and for a route that is not on an axis or a diagonal the tie
   zone is a lens tens of cells wide — on EXP-01 a third of the cytoplasm,
   17,000 cells, came out as trunk. Octile narrows the lens; it does not
   close it, since a route at an odd angle still has its diagonal steps and
   its straight ones in any order. What closes it is thickness: a cell
   passes a signal on at a little less than the step when it is thin,
   FED_THIN less at no trail than at FED_THICK, so among paths of one length
   the thickest carries the signal best and is the one the link picks out.
   A thin stretch of twenty cells against a thick one of the same length
   costs a tenth at the sixteenth power, and once the link is thickening
   the winner that is the whole of the contest. The weight is on trail
   rather than conductivity because trail is what is thick NOW: the
   feedback should close in the time a tube thickens, not the seven seconds
   conductivity takes to notice.

   Both ride CYTOPLASM (trail at or above FED_BODY) rather than committed
   tube, and that is measured rather than chosen. On EXP-01 at forty
   seconds, with three flakes being eaten, not one of their pads was joined
   to the inoculation point through cells at IDLE_C — the discs' tube
   components were 66 to 185 cells against a 200-cell route — while every
   one was joined through cytoplasm at trail 3, in a body of nineteen
   thousand cells. A signal gated on tube would never have left the pad.
   Off cytoplasm a signal is multiplied by FED_OFF a pass and is gone in a
   few, so it cannot cross bare agar or a wall.

   FED_STEP is both the attenuation with distance and the clock a signal
   dies on once its source stops. It has to be both: with the step at 1 a
   ring of cells all at 1 would hold each other up forever, since each is
   the other's best neighbour. At 0.995 the value two hundred cells from a
   flake — the corners of EXP-01 to its centre — is 0.37, and with the
   source gone a field's maximum falls by 0.995 a pass, fifteen passes a
   second, a half-life of nine seconds; the link, being that to the
   sixteenth, lapses in two. FED_FADE is only what an isolated cell does
   with its own value between neighbours: lower than the step, so a cell
   cannot remember more than its neighbours can bring it. FED_PASSES sets
   the speed: two passes a sweep at KNOT_EVERY steps is fifteen cells a
   second, so a corner flake reaches the centre of EXP-01 in about ten
   seconds (measured: nine) — the organism's minute, at this dish's pace,
   and slow enough to watch happen.

   What the link DOES is two things, and both go through conductivity,
   because that is the field that decides which tubes the culture keeps.

   Fortify. On the connection the flux counts for more: q is multiplied by
   1 + FED_GAIN x linkF before the saturating feedback, so a tube on the
   route to a flake commits at a third of the traffic a tube anywhere else
   needs. Through the flux and not as a floor on the drive, deliberately: a
   floor would hold every cell the link reached, sheet and all, and
   multiplying the flux holds only cells that carry traffic, which is what
   a route is. Deposit on the connection rises with it (FED_LAY_GAIN,
   applied where the agent steps), so the thickening lands on the trunk and
   on nothing else.

   Shrink. A cytoplasm cell within FED_R of the trunk — a cell whose link
   is at least FED_HI — that is itself well off it, link under FED_LOW, is
   SHADED: a branch that leaves the connection and goes nowhere the
   connection does not already go. Its conductivity loses an extra
   FED_SHADE a sweep and the traffic through it lays FED_SHADE_DEP less, so
   it thins from both ends at once. The body's own source disc is never
   shaded, since it is the body; and the far side of the core, which is a
   long detour from any flake, is not within FED_R of a trunk either, so
   the shade stays on the flanks of the route — measured, not assumed.

   The route is safe from its own shade by construction: linkF is 1 along
   the shortest path and the trunk's corridor keeps well over FED_LOW, so
   the thing shaded is only ever what is beside it. The winner-take-all is
   the same one Tero's model has; this only points it at the fed route. */
var FED_BODY     = 3.0;   // trail at which a cell is cytoplasm a signal can ride
var FED_STEP     = 0.995; // share of the strongest neighbour a cell takes per pass, straight
var FED_STEP_D   = Math.pow(FED_STEP, Math.SQRT2); // ...and diagonally: octile, not Chebyshev
var FED_THIN     = 0.005; // extra share lost per cell at no trail, against FED_THICK
var FED_THICK    = 18.0;  // trail at which a cell passes the signal at the full step (= ADRIFT_T)
var FED_FADE     = 0.90;  // what a cell keeps of its own value per pass, on cytoplasm
var FED_OFF      = 0.50;  // ...and off it, where a signal dies in a few passes
var FED_PASSES   = 2;     // relaxation passes per slow sweep: cells per KNOT_EVERY steps
var FED_CORE_R   = 16;    // cells around the inoculation point that are the body signal's source
var FED_SHARP_LOG = 4;    // the exponent on the detour ratio is 2 to this: squarings, not Math.pow
var FED_SHARP    = 1 << FED_SHARP_LOG; // ...which is 16: how tight a corridor the trunk is
var FED_GAIN     = 2.0;   // flux multiplier on the connection, before the feedback
var FED_LAY_GAIN = 0.50;  // extra deposit per step on the connection
var FED_R        = 8;     // cells: how far the connection's shade reaches
var FED_HI       = 0.60;  // link at which a cell is trunk enough to cast a shade
var FED_LOW      = 0.25;  // link below which a cell in that shade is shaded
var FED_SHADE    = 0.03;  // extra share of conductivity a shaded cell loses per sweep
var FED_SHADE_DEP = 0.50; // share of deposit traffic through a shaded cell does not lay
/* ---- the vein scar: where a tube HAS been ----
   The residual the dish has been missing. Three fields already say something
   about a cell and all three are short: trail is the tube now, the trace is
   the front seconds ago, the mat is ground that has been searched. None of
   them is the organism's own skeleton, so when a tube is withdrawn the ground
   under it goes back to being indistinguishable from agar the culture has
   never seen, and regrowth into that quarter starts from nothing and lands
   somewhere else. That is why the network never looks like the same network
   twice.

   A real plasmodium does not lose a vein that cleanly. The tube wall is gel
   the organism built and left, and cytoplasm returning to that quarter runs
   back down the channel it already has rather than cutting a new one — which
   is why a timelapse of a plate shows the same lattice in the same places for
   minutes on end, thickening and thinning, and not a new lattice every pass.

   What scars is a cell the network was MAINTAINING — conductivity over
   SCAR_COND — and not merely one that carried a lot of trail. The difference
   is the whole value of the field and it was measured rather than reasoned:
   with the mark keyed to trail instead, at a threshold well above what a
   stray can manufacture, a fifth of the dish was fully scarred by the first
   half minute and rather more than the whole standing tissue area by the
   second. That is not a skeleton, it is a map of everywhere the organism has
   ever put a foot, and a uniform attractant over half the plate guides
   nothing. Conductivity already asks the right question — is this cell a
   tube the culture is keeping — so the scar is its slow record and covers
   what the veins cover.

   It is laid slowly (some seconds of held tube for a full mark, so a
   filament withdrawn as soon as it was cut leaves nothing) and lifted far
   more slowly still, on a half-life of minutes, which over one dish is close
   enough to never. And it is weighted like the trace and the mat, scaled
   DOWN by the trail already present: a live tube is its own signal and does
   not need its history repeated, so the scar speaks only where the tube has
   gone. */
var SCAR_COND = 0.45;      // conductivity at which this cell is a tube worth remembering
var SCAR_DEP  = 0.02;      // scar laid per sweep while it is
var SCAR_FADE = 0.99975;   // per-sweep decay: half-life ~6 min of dish time
var SCAR_W    = 3.0;       // sensed weight of a full scar on bare ground
var SCAR_REF  = 25.0;      // trail at which a live tube silences its own scar

/* ---- coming adrift ----
   A plasmodium is one cell. It has no way to leave a piece of itself behind,
   and a dish that grows detached islands of tissue is not drawing physarum
   however good the veins are. The supply test in the tip block is the only
   thing in the file that knows about connection, and all it does is DEMOTE:
   a filament that loses its tube stops being a front and becomes ordinary
   cytoplasm, which then wanders on bare agar at VOID_SPEED for the rest of
   the run, laying just enough trail under itself to stay visible. Measured,
   a lone wanderer settles at a trail of about eight — DEPOSIT x VOID_SPEED
   over one minus DECAY — which is the level the renderer starts drawing
   tissue at. Every scrap that ever came adrift is still on the plate.

   So the demotion is finished. An agent that is not a tip, is not feeding,
   and has been standing on less trail than a tube carries for a sustained
   time is reabsorbed. The threshold sits above what a scrap can manufacture
   for itself and far below what a tube holds, and the delay is what keeps it
   honest — a fresh daughter, an agent crossing a gap, a front that has
   outrun its own deposit for a moment all recover well inside it, and only
   something that has spent seconds attached to nothing does not.

   Reabsorbed, and the word is meant literally: the scrap is MOVED back into
   the body rather than deleted. Deleting it was the first version and it is
   both the wrong biology and, measured, a real cost to the dish. Wrong
   biology because cytoplasm withdrawn from a dead end is not lost — it is
   the material the organism reinvests in the tubes that are working, which
   is the same sentence as the pruning this whole change is about. And a cost
   because before the first flake goes in a dish has no growth budget at all:
   engulfed is zero, the biomass target is zero, and every agent deleted is
   gone for the rest of the search. That version culled about one agent in
   eight over the first minute and paid for it exactly where you would
   expect — EXP-01 took 27% longer to solve, across three seeds, because the
   population doing the searching was smaller. Moving the scrap home costs
   the dish nothing and puts the cytoplasm where it is useful. */
var ADRIFT_T     = 18.0;  // trail below which an agent is not standing on tube
var ADRIFT_TIME  = 2.5;   // seconds of that before the scrap is drawn home
var ADRIFT_DRAWS = 8;     // draws taken looking for somewhere to put it
var ADRIFT_R     = 1.5;   // ...and how far from that cell it may land, cells
/* Cytoplasm stays in the tube. Everything the organism does starts on the
   line and moves outward from it: a tip leaves the tube, and the tube
   follows the tip. Nothing else leaves. Ordinary cytoplasm standing on tube
   that would step onto bare agar is turned instead — the same treatment as
   a wall — so the mass between two veins is never seeded by an agent that
   wandered off one and laid trail where it stood, which was what the
   patches in the holes of the lattice were: a stray, its own puddle, and
   then a bridge to it. The tube it may step onto is anything at TUBE_LEAVE
   or more, which a stalk is (STALK_W x 36) and bare agar is not; food is
   always open, since a pad spreads across its flake before it has trail. */
var TUBE_LEAVE   = 6.0;   // trail below which a cell is bare agar to a follower

var SPENT_FOOD = 0.30; // an engulfed node's remaining pull (a refuge, not a beacon)
var SPENT_FALL = 34;   // and only over this reach, so spent food cannot outbid fresh
/* Not paced. Eating is the organism's own flow, like growth: a front in
   contact with a node consumes it at the speed cytoplasm arrives, and a
   dish's far food is reached by eating the near food first. Paced, this
   added 3.3 s x (PACE - 1) per node to every multi-node dish for nothing the
   dish was asking. */
var MAX_ENGULF_RATE = 1 / 200; // a node takes >= 3.3s to consume however big the front
/* Half-rate front, as a fraction of the node's own area. Blocked agents count
   as contact, which roughly doubled the hits a jammed front reports — but
   simply doubling this to compensate is wrong, and measurably so. A cued front
   is dense and jams, an idle one is sparse and is limited by how long it takes
   to arrive at all, so this constant prices ACTIVE play almost alone: at 0.26
   EXP-01 ran 100s led against 114s untouched, erasing the point of the
   controls, where at 0.13 it is nearer 70s against 105s. The two dishes that
   came out genuinely too quick are corrected by their own `engulf` multiplier
   instead, which is the knob meant for per-dish pacing. */
var ENGULF_SOFT = 0.42;
var ENGULF_DECAY = 0.0022 / PACE; // an abandoned node re-forms: commit, or lose the ground (paced)

/* ---- the fan on a flake ----
   A plasmodium that reaches food does not file past it. It stops advancing
   there and spreads over the flake as a sheet: a fan, then a pad of cytoplasm
   covering as much of the surface as it can reach, because absorption happens
   across the contact area and nowhere else. The filament model had no term
   for that — a tube crossed a flake, kept its heading, and the meal was eaten
   by whatever fraction of the front happened to be walking through it.
   Measured on EXP-01 at the step the last flake went down, tissue covered
   between a fifth and a half of each flake's own disc, and the picture was
   four veins running through four circles.

   Each constant here does one thing. FEED_R is how far past the rim the pad
   may spread, since a real one overhangs the food it sits on. FEED_OUT and
   FEED_HOLD are the two halves of the shape — outward across the flake, then
   held inside the fan — and the reasoning for needing both is at the site
   where they are applied. FEED_LAY is what a feeding agent lays while it is
   there, charged per STEP rather than per cell travelled for the same reason
   a tip's deposit is: this is cytoplasm ARRIVING somewhere, not cytoplasm
   being dragged through. FEED_SPEED is the floor under its speed, because the
   pad has to be able to spread before there is any trail under it to move on.

   FEED_FILL is the release valve, and the pad is a trap without it. Retention
   with no ceiling means the first flake found keeps every agent that touches
   it for as long as it has food, and the rest of the dish is never explored.
   So the hold is scaled by how much room is left in the pad: an uncovered
   flake pulls its arrivals in hard, a covered one lets them wander off again.

   It is a share of the flake's own area rather than a count of agents per
   cell, and the difference is the whole value of the constant. Written as
   agents-per-cell it reads like a packing limit and is not one — the
   exclusion is on cells, but a pad's agents are moving, so a saturated pad
   never approaches one agent per cell. Measured across a run, the peak load
   on a flake's own disc is 0.19 to 0.34 of its area on EXP-01's four big
   flakes and 0.55 to 0.76 on EXP-03's nine small ones. The first value here
   was 1.10, which is above every one of those: the valve never opened, it
   only sagged to two thirds of the hold on the dish where it mattered least.
   At 0.55 it opens fully on the crowded dishes — the ones with enough flakes
   for hoarding to cost the culture anything — and eases the hold on the
   sparse ones, where there is nothing to hoard against. */
var FEED_R     = 1.35; // fan radius, as a multiple of the flake's own
var FEED_OUT   = 0.34; // share of the way toward the rim taken per step, at the centre
var FEED_HOLD  = 0.55; // ...and back toward the centre, at the edge of the fan
var FEED_FILL  = 0.55; // share of the flake's own area, in agents, that opens the valve
var FEED_LAY   = 1.30; // trail a feeding agent lays per step (multiple of DEPOSIT)
var FEED_SPEED = 0.30; // floor under a feeding agent's speed, so the pad can fill

/* ---- the pad thins as the food goes ----
   A flake is at its fullest when the food is fresh and the pad on it thins as
   the food is used up; what is left when the last of it goes is the thin
   refuge that SPENT_FOOD describes. The first version had the hold and the
   pull switch from full to spent in the one step the dial completed, so a
   flake sat fat and full while its arc filled and then drained as if a plug
   had been pulled: measured on the commuter map, the trail on a flake fell
   by nine tenths in the twenty seconds after the arc closed. Both now run
   down along the same line as progress runs up, from 1 at first contact to
   SPENT_FOOD at done, so nothing jumps at the flag — done is the far end of
   the curve the flake was already on. The hold is not scaled down; the pad
   it holds is sized down (see FEED_FILL's use in the step), which is the
   same thinning on a full pad and no loosening at all on a sparse one. The
   rate a flake is eaten at follows the same size (ENGULF_SOFT's use), so a
   smaller pad on less food eats it at the pace the full pad ate the whole. Rebuilding the field is
   a pass over the dish per flake, so it happens when a flake's progress
   crosses one of FOOD_Q steps, not every step. */
var FOOD_Q = 8;        // progress steps between rebuilds of the food field

/* ---- lobes at the corners ----
   The other structure the filament rule would not draw. A physarum network is
   not tubes meeting at mathematical points: where three tubes meet, and where
   one turns a hard corner, there is a visible swelling — a lobe of cytoplasm
   parked at the junction, which is where the streaming reverses and where the
   nuclei pile up between runs. They are the waypoints of the network, and a
   drawing without them reads as a diagram of a network rather than a
   photograph of one.

   They are grown, not drawn. An agent inside the body occasionally asks
   whether the cell it is standing on is a junction, by reading a ring of
   samples at KNOT_R and counting how many contiguous ARMS of tube leave it:
   three or more is a fork, exactly two closer together than KNOT_BEND is a
   corner, and two opposite each other is a tube passing through, which is not
   a junction at all. What a passing test does with that answer is the subject
   of the second block below.

   Two things keep this from eating the dish. The arm test is RELATIVE to the
   trail under the agent, so the inside of a saturated sheet — where every
   sample reads as high as the centre — comes back as one continuous arm and
   is rejected. And a lobe grown past the ring radius covers its own sampling
   ring, which is the same rejection: a swelling stops at about KNOT_R across,
   with no size cap written anywhere. */
var KNOT_P      = 0.06; // chance per step an interior agent tests its cell
var KNOT_N      = 12;   // samples around the ring
var KNOT_R      = 5.5;  // radius of the ring the test reads, cells
var KNOT_MIN    = 26.0; // trail below which this is not tube and cannot be a junction
var KNOT_ARM    = 0.55; // ring trail counting as an arm, as a fraction of the centre's
var KNOT_BEND   = 2.40; // arms closer than this (rad) are a corner, not a through-tube
var KNOT_SPREAD = 3.40; // radius of the lobe a passing test marks out, cells
/* What a mark is worth, and how a lobe actually gets built.

   The first version of this laid the lobe's trail directly, inside the test:
   a qualifying agent dumped a disc of trail and that was the swelling. It
   does not work, and the arithmetic says why before the picture does. A given
   junction passes the test about once every fifty steps — the test is cheap
   because it is rare, and it is rare because most interior cells are inside a
   sheet or along a tube passing through — while a lobe held at four fifths of
   the trail ceiling loses more than a unit per cell per step to decay alone.
   Deposits fifty steps apart against a loss taken every step is not a
   swelling, it is a twitch, and the field showed exactly that: nothing
   anywhere in the dish above the level of an ordinary trunk.

   So the test does not build the lobe. It MARKS one — writes a soft disc into
   a field that says "there is a junction here" and decays slowly — and the
   lobe is then built by the traffic that was going through the junction
   anyway, which lays a heavier deposit for as long as the mark stands. That
   is both the cheaper mechanism and the truer one: cytoplasm piles up at a
   junction because that is where the streaming turns over, not because
   something arrived and put it there.

   It also closes the loop in the right direction. A lobe that grows past the
   sampling ring reads as a sheet and stops being marked; the mark decays, the
   lobe thins, and the ring can see arms leaving it again. Nothing in this
   file caps the size of a lobe, and nothing needs to. */
var KNOT_HOLD = 0.9975; // per-step decay of the junction mark
var KNOT_GAIN = 2.60;   // extra deposit a marked cell takes, as a multiple

/* ------------------------------------------------------------
   2. the five experiments
   ------------------------------------------------------------ */
var BORDER = [[0, 0, GW, 8], [0, GH - 8, GW, 8], [0, 0, 8, GH], [GW - 8, 0, 8, GH]];

var EXPERIMENTS = [
  {
    code: 'EXP-01', name: 'FIRST CONTACT',
    blurb: 'Open agar, four oat flakes, no complications. Find out which way is out.',
    obj: 'Engulf all four oat flakes.',
    objShort: 'FLAKES',
    chips: [['ok', 'open agar'], ['ok', '4 oat flakes'], ['ok', 'no toxins']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 34, y: 36, r: 13, label: 'flake a' },
      { x: 386, y: 36, r: 13, label: 'flake b' },
      { x: 34, y: 224, r: 13, label: 'flake c' },
      { x: 386, y: 224, r: 13, label: 'flake d' }
    ],
    walls: [], hazards: [],
    start: 4500, cap: 11000, sustain: 3200, grow: 300, starve: 40, grace: 40, engulf: 1.6,
    /* the one dish with no cue reserve. It is where a player finds out what a
       cue does at all, and finding that out while being rationed teaches the
       ration instead of the cue. Every dish after this one runs the default. */
    timeLimit: 0, hab: false, shocks: false, cue: 0,
    script: [
      { t: 1.5, hi: true, text: 'hold the pointer on the agar — the front flows toward the cue.' },
      { t: 6, hi: true, text: 'right-click or shift pulls cytoplasm back out of a region.',
        textTouch: 'the RETRACT pad — or a second finger — pulls cytoplasm back out of a region.' },
      { t: 14, text: 'the dish is very quiet. there is sugar in it somewhere.' }
    ],
    ambient: [
      'no centre, no committee, and yet a decision gets made.',
      'the agar gives slightly. you take that as encouragement.',
      'somewhere a graduate student writes down that you are spreading.',
      'this tastes like arithmetic. simple arithmetic.'
    ],
    win: 'All four flakes taken, the network pruned back to the veins that mattered. The observer notes an efficient result and, in the margin, that it took a colony with no nervous system to produce it.',
    lose: 'The culture thinned to nothing on clean agar with food eleven centimetres away in four directions. The observer notes the dish, the date, and nothing else.'
  },

  {
    code: 'EXP-02', name: 'THE LABYRINTH',
    blurb: 'A labyrinth cut into the agar, food at two ends. Shortest path, no brain.',
    obj: 'Engulf both agar blocks before the culture starves.',
    objShort: 'BLOCKS',
    chips: [['', 'cut labyrinth'], ['', 'accelerated starvation'], ['ok', 'two agar blocks']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 40, y: 46, r: 13, label: 'block NW' },
      { x: 380, y: 214, r: 13, label: 'block SE' }
    ],
    walls: BORDER.concat([
      [90, 8, 8, 172], [170, 80, 8, 172], [250, 8, 8, 172], [330, 80, 8, 172],
      [98, 100, 44, 7], [258, 170, 54, 7]
    ]),
    hazards: [],
    start: 5000, cap: 11000, sustain: 5800, grow: 320, starve: 11, grace: 260, reach: 260, engulf: 1.7,
    timeLimit: 700, hab: false, shocks: false,
    script: [
      { t: 2, hi: true, text: 'walls. the agar has been cut into corridors.' },
      { t: 12, text: 'dead ends cost cytoplasm. retract out of them.' }
    ],
    ambient: [
      'every corridor gets tried at once. that is the whole trick.',
      'the branches that found nothing are being reabsorbed.',
      'a shortest path is just the tube nobody withdrew from.',
      'somebody will call this problem-solving. it is only plumbing.'
    ],
    win: 'Both blocks connected by a single thickened tube, the exploratory branches withdrawn from every dead end. Measured against the maze, the surviving path is the shortest one available. The observer has stopped calling it a mould.',
    lose: 'The culture spread evenly into every corridor at once and ran out of cytoplasm before it ran out of maze. Thorough. Fatal, but thorough.'
  },

  {
    code: 'EXP-03', name: 'THE COMMUTER MAP',
    blurb: 'Nine depots laid out in a rough map of Tokyo. Build the network.',
    obj: 'Engulf all nine depots before the dish times out, then let the network settle.',
    objShort: 'DEPOTS',
    chips: [['ok', 'nine agar depots'], ['ok', 'open dish'], ['', 'clock is running']],
    inoc: { x: 206, y: 138 },
    nodes: [
      { x: 196, y: 58, r: 10, label: 'omiya' },
      { x: 312, y: 66, r: 10, label: 'tsuchiura' },
      { x: 376, y: 96, r: 10, label: 'narita' },
      { x: 352, y: 152, r: 10, label: 'chiba' },
      { x: 240, y: 198, r: 10, label: 'kawasaki' },
      { x: 190, y: 226, r: 10, label: 'yokohama' },
      { x: 76, y: 214, r: 10, label: 'odawara' },
      { x: 92, y: 124, r: 10, label: 'hachioji' },
      { x: 46, y: 84, r: 10, label: 'kofu' }
    ],
    walls: [], hazards: [],
    start: 4200, cap: 12000, sustain: 1500, grow: 340, starve: 44, grace: 45, engulf: 12.0,
    timeLimit: 340, hab: false, shocks: false,
    /* The experiment's second half. Tero's plasmodium covered the plate in a
       fine mesh in eight hours and spent the next day pruning it: the tubes
       carrying traffic thickened, the rest lapsed, and what was left was the
       sparse network the paper compared to the rail map. Nothing prunes
       here while the culture sits at cap, measured: 200 s after the ninth
       depot the mesh still covered nine tenths of the plate. So once the
       last one is taken: the sustain target settles from the cap to `keep`
       of it over `dur` seconds, the cull takes the idlest cytoplasm first,
       `flow` agents a second stream out of idle tubes into the busiest, and
       the agents read `sense` times further ahead — the sensor offset being
       what sets the scale of the net a population settles into. Measured on
       seed 12345: cull alone left the mesh whole and fainter; a faster trail
       decay made a haze; the reach is what coarsens it, x3 into large holes
       and broad bands at keep 0.5, x5 into fat lobes, and x3 for 90 s at
       keep 0.3 into a few thick tubes between the depots with the plate
       between them bare, which is the paper's second day. The verdict comes
       at the end of the settling, not at the ninth depot. */
    refine: { dur: 120, keep: 0.3, flow: 60, sense: 3, stream: 250,
              text: 'nine on one network. now the network decides which of itself to keep.' },
    script: [
      { t: 2, hi: true, text: 'nine depots. the dish is the wrong shape for a city and you do not care.' },
      { t: 15, text: 'links that carry nothing are being thinned out.' }
    ],
    ambient: [
      'the busy tubes thicken. the idle ones are quietly abandoned.',
      'redundancy, cost and length, weighed without anyone weighing them.',
      'this tastes like mathematics.',
      'a network is only the argument you did not lose.'
    ],
    win: 'Nine depots on one network, the heavy tubes running where the traffic is and the rest allowed to lapse. Compared against the surveyed rail map the layout is not identical, which is the interesting part rather than the disappointing one.',
    lose: 'The dish ran out of time with depots still dark. The observer files it under promising and books the plate again for Thursday.'
  },

  {
    code: 'EXP-04', name: 'THE BITTER BRIDGE',
    blurb: 'Bitter strips between you and dinner. Learn that bitter is not poison.',
    obj: 'Cross the quinine and engulf the far agar.',
    objShort: 'FAR AGAR',
    chips: [['q', 'quinine barrier × 2'], ['q', 'bitter, not toxic'], ['ok', 'agar beyond']],
    inoc: { x: 54, y: 130 },
    nodes: [
      { x: 348, y: 66, r: 12, label: 'far agar N' },
      { x: 384, y: 148, r: 12, label: 'far agar E' },
      { x: 336, y: 218, r: 12, label: 'far agar S' }
    ],
    walls: [],
    hazards: [
      { type: 'q', x: 150, y: 0, w: 32, h: GH },
      { type: 'q', x: 246, y: 0, w: 32, h: GH }
    ],
    start: 5000, cap: 11000, sustain: 3900, grow: 320, starve: 18, grace: 130, reach: 290,
    timeLimit: 440, hab: true, shocks: false,
    script: [
      { t: 2, hi: true, text: 'two purple strips. everything past them smells like dinner.' },
      { t: 8, hi: true, text: 'hold a cue across the strip to push the front through it.' },
      { t: 30, text: 'the bitterness is doing no actual damage. you have not worked that out yet.' }
    ],
    ambient: [
      'bitter. bitter. still bitter. still, apparently, alive.',
      'the front hesitates at the edge, then hesitates less.',
      'nothing here is learning. something here is changing.',
      'quinine, on reflection, is only a flavour.'
    ],
    win: 'The far agar reached across both strips, and by the end the crossings were made at nearly full speed. Nothing was rewarded and nothing was punished; the response simply faded. The observer writes habituation, then writes it again with a question mark.',
    lose: 'The culture spent itself at the bitter edge, crossing and dying and crossing again, and never lived long enough to find out that the quinine was harmless the whole time.'
  },

  {
    code: 'EXP-05', name: 'THE FORECAST',
    blurb: 'The dish dries on a schedule. The interesting part is noticing the schedule.',
    obj: 'Engulf every flake and outlast at least three dry cycles.',
    objShort: 'FLAKES',
    chips: [['', 'dry shock every ~25 s'], ['', 'desiccation damage'], ['ok', 'engulfed agar = refuge']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 74, y: 62, r: 12, label: 'flake NW' },
      { x: 346, y: 62, r: 12, label: 'flake NE' },
      { x: 210, y: 40, r: 12, label: 'flake N' },
      { x: 64, y: 200, r: 12, label: 'flake SW' },
      { x: 356, y: 200, r: 12, label: 'flake SE' },
      { x: 210, y: 222, r: 12, label: 'flake S' }
    ],
    walls: [], hazards: [],
    start: 4200, cap: 11500, sustain: 2100, grow: 320, starve: 44, grace: 40,
    timeLimit: 0, hab: false, shocks: true,
    /* the win needs the flakes AND enough cycles outlasted for the anticipation
       to have somewhere to show — see the finish() gate */
    minShocks: 3,
    shock: { first: 16, period: 25, warn: 5, dur: 6, dmg: 0.0012 },
    script: [
      { t: 2, hi: true, text: 'the air in here is not stable. it will be pulled dry, and soon.' },
      { t: 12, text: 'agar you have already engulfed holds water. remember where it is.' }
    ],
    ambient: [
      'humidity is a thing you can feel across your entire surface, which is all of you.',
      'you are counting something. you would not call it counting.',
      'the interval has a shape.',
      'the refuges are the only wet part of the world.'
    ],
    win: 'Every flake taken and every dry cycle survived, with the culture visibly slowing ahead of shocks that had not yet arrived. The observer withheld one shock to see what would happen. Something happened anyway.',
    lose: 'Caught in the open when the air went dry, repeatedly, until there was not enough left to catch. The cycle was regular. That was the entire point.'
  },

  {
    code: 'EXP-06', name: 'THE U-TRAP',
    blurb: 'A U-shaped trap between you and food. Escaping means moving away from the food first.',
    obj: 'Retreat out of the trap\'s dead end and engulf both flakes on the far side of the wall.',
    objShort: 'FLAKES',
    chips: [['', 'u-shaped trap wall'], ['', 'old ground repels'], ['ok', '2 flakes beyond it']],
    inoc: { x: 200, y: 130 },
    nodes: [
      { x: 310, y: 110, r: 12, label: 'flake beyond' },
      { x: 320, y: 215, r: 12, label: 'flake south' }
    ],
    walls: [
      [252, 68, 8, 124],
      [150, 68, 110, 8],
      [150, 184, 110, 8]
    ],
    hazards: [],
    start: 5000, cap: 11000, sustain: 5000, grow: 320, starve: 16, grace: 180, reach: 280, engulf: 1.7,
    timeLimit: 620, hab: false, shocks: false,
    slimeAvoid: 2.5,
    preSlime: [[98, 76, 50, 108]],
    script: [
      { t: 2, hi: true, text: 'three walls and a door behind you. the food is past the fourth.' },
      { t: 9, hi: true, text: 'retract on purpose. ground you deliberately leave starts to smell like nothing.' },
      { t: 22, text: 'the wall does not care that you can smell dinner through it.' }
    ],
    ambient: [
      'the back wall has been pushed on for a while now.',
      'somewhere behind you, the door is still open. you have not looked.',
      'searched and un-searched are, it turns out, different smells.',
      'the shortest way to dinner is currently a wall. the second-shortest works.'
    ],
    win: 'Both flakes taken by a network that never returned to the wall it first tried. The dead end reads, in the trail record, as one thick stub with nothing built past it — the door was found by ruling out every place that wasn\'t one. The observer notes that nothing here has anywhere to keep a memory, and files the trail record as one.',
    lose: 'The front spent itself pressing on the same stretch of wall long after the wall had made its point, and there was nothing left to send around it. The dish records a very determined failure to learn.'
  },

  {
    code: 'EXP-07', name: 'THE LIT MAZE',
    blurb: 'A lit shortcut and a dark detour. Physarum minimises risk, not distance.',
    obj: 'Engulf both agar blocks across the maze.',
    objShort: 'BLOCKS',
    chips: [['', 'two-route maze'], ['l', 'lit shortcut'], ['ok', 'dark route clear']],
    inoc: { x: 50, y: 130 },
    nodes: [
      { x: 370, y: 60, r: 12, label: 'block N' },
      { x: 370, y: 200, r: 12, label: 'block S' }
    ],
    walls: [
      [0, 0, 420, 8],
      [0, 252, 420, 8],
      [0, 0, 8, 260],
      [412, 0, 8, 260],
      [130, 8, 200, 76],
      [130, 124, 200, 8],
      [220, 132, 8, 90]
    ],
    hazards: [
      { type: 'l', x: 130, y: 84, w: 200, h: 40 }
    ],
    start: 5000, cap: 11000, sustain: 5600, grow: 320, starve: 12, grace: 250, reach: 250, engulf: 1.6,
    timeLimit: 650, hab: false, shocks: false,
    heatDmg: 0.004,
    script: [
      { t: 2, hi: true, text: 'two ways across. one of them is lit.' },
      { t: 10, hi: true, text: 'the light does not block you. it only charges admission.' },
      { t: 20, text: 'the dark corridor costs nothing but time, and time is also a cost.' }
    ],
    ambient: [
      'the lit corridor gets shorter every time you measure it. it does not get cheaper.',
      'the dark route sits open and mostly ignored.',
      'something in you keeps a running tab on the light.',
      'shortest was never the only variable.'
    ],
    win: 'Both blocks taken, and the log shows a front that paid real biomass to cross the lit corridor rather than route around it every time. The dark detour saw traffic too — the network hedged, the way the paper\'s plasmodia did. The observer notes the two routes never fully agreed on which was cheaper.',
    lose: 'The culture bled itself thin in the light, crossing and recrossing a shortcut it never learned to avoid. The dark corridor sat open the whole time.'
  },

  {
    code: 'EXP-08', name: 'THE DIET',
    blurb: 'Eight lopsided blends. Eat the ones that balance, not all eight.',
    obj: 'Compose a mix near two parts protein to one from at least four blends, and leave the rest.',
    objShort: 'BLENDS',
    chips: [['ok', '8 blend nodes'], ['ok', 'open dish'], ['', 'target ratio 2:1']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 60, y: 50, r: 11, label: 'blend 8:1', nut: [24, 3] },
      { x: 210, y: 30, r: 11, label: 'blend 5:1', nut: [15, 3] },
      { x: 360, y: 50, r: 11, label: 'blend 3:1', nut: [9, 3] },
      { x: 380, y: 150, r: 11, label: 'blend 2:1', nut: [6, 3] },
      { x: 360, y: 220, r: 11, label: 'blend 1:2', nut: [3, 6] },
      { x: 210, y: 235, r: 11, label: 'blend 1:3', nut: [3, 9] },
      { x: 60, y: 220, r: 11, label: 'blend 1:5', nut: [3, 15] },
      { x: 40, y: 130, r: 11, label: 'blend 1:8', nut: [3, 24] }
    ],
    walls: [],
    hazards: [],
    start: 4200, cap: 11000, sustain: 2200, grow: 310, starve: 40, grace: 45, engulf: 2.5,
    timeLimit: 420, hab: false, shocks: false,
    holdWin: 4,
    diet: { target: 2, tol: 0.4, min: 4 },
    script: [
      { t: 2, hi: true, text: 'eight blends on the agar, and none of them taste like enough.' },
      { t: 12, text: 'more protein is not the same question as more food.' },
      { t: 22, hi: true, text: 'something in you is already weighing this against that.' }
    ],
    ambient: [
      'protein and carbohydrate, and an appetite doing the arithmetic nobody taught it.',
      'too much of a good blend is only a bad blend, later.',
      'the tongue you do not have has opinions anyway.',
      'a diet is only another shape to hold.'
    ],
    win: 'Blends enough held, the protein:carbohydrate ratio settling near two to one — inside the band, and nowhere close to what all eight nodes together would have produced. The observer notes that the untouched flakes were the important decision, not the eaten ones.',
    lose: 'The culture took whatever blend sat nearest until the ratio drifted past saving, or ran out of clock still short of four. The observer writes appetite, not diet, and closes the notebook.'
  },

  {
    code: 'EXP-09', name: 'THE DECOY',
    blurb: 'Two good meals far apart, one bad one close by. Preference is not supposed to flip.',
    obj: 'Engulf the two far meals; the near one is not required.',
    objShort: 'BASINS',
    chips: [['ok', 'two required meals'], ['', 'one decoy, close'], ['', 'engulf costs mass']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 246, y: 108, r: 10, label: 'near crumb', trap: true },
      { x: 52, y: 44, r: 12, label: 'north basin' },
      { x: 368, y: 216, r: 12, label: 'south basin' }
    ],
    walls: [],
    hazards: [],
    start: 4500, cap: 11000, sustain: 3200, grow: 300, starve: 40, grace: 150, reach: 260, engulf: 1.5,
    timeLimit: 480, hab: false, shocks: false,
    required: [1, 2],
    script: [
      { t: 1.5, hi: true, text: 'something is close and something is far, and closeness is not an argument.' },
      { t: 9, text: 'the near one bites back. mostly cellulose, all rind.' },
      { t: 20, text: 'two real meals, opposite ends of the dish, still exactly as far as they were.' }
    ],
    ambient: [
      'the near one keeps getting sniffed and left again.',
      'distance was never the argument. proximity just felt like one.',
      'somewhere an economist is taking this personally.',
      'two good meals, unrelated to a third, ought to stay unrelated.'
    ],
    win: 'Both basins taken. What became of the crumb between them the notebook does not record, only that the third option never got a vote on the other two. Latty and Beekman would want the mechanism; the page has room for the outcome.',
    lose: 'The near crumb went first, then most of an afternoon, and the far basins stayed exactly as far as they started. A preference got reversed by something that was never on the menu.'
  },

  {
    code: 'EXP-10', name: 'THE GRAFT',
    blurb: 'A habituated donor waits in the corner. Fuse before you learn the quinine alone.',
    obj: 'Fuse with the donor culture, then cross the quinine and engulf the far agar.',
    objShort: 'GRAFT',
    chips: [['q', 'two quinine strips'], ['', 'alone, too slow to learn'], ['ok', 'donor culture waits']],
    inoc: { x: 66, y: 130 },
    nodes: [
      { x: 352, y: 56, r: 12, label: 'far agar N' },
      { x: 392, y: 140, r: 12, label: 'far agar E' },
      { x: 346, y: 216, r: 12, label: 'far agar S' }
    ],
    walls: [],
    hazards: [
      { type: 'q', x: 160, y: 0, w: 34, h: 260 },
      { type: 'q', x: 256, y: 0, w: 34, h: 260 }
    ],
    donor: { x: 66, y: 222, r: 18, hab: 0.85 },
    start: 5000, cap: 11000, sustain: 4200, grow: 320, starve: 12, grace: 260, reach: 300,
    timeLimit: 560, hab: true, shocks: false,
    habRate: 0.12,
    script: [
      { t: 2, hi: true, text: 'two bitter strips ahead, and a second ring of cytoplasm in the corner that is not yet yours.' },
      { t: 9, hi: true, text: 'hold the cue on the ring. two veins that meet become one vein, and it remembers for both.' },
      { t: 22, text: 'crossing the strips alone is teaching yourself a lesson slower than the clock allows.' }
    ],
    ambient: [
      'the ring in the corner made up its mind about this dish before you arrived.',
      'a shared vein does not ask where the memory came from.',
      'bitterness, secondhand, is somehow still bitterness.',
      'nobody in this dish learned the quinine alone. that was rather the point.'
    ],
    win: 'The donor\'s vein met yours in the corner of the dish, and the crossing that followed afterward barely registered — a fraction of a flake\'s worth of cytoplasm, not the toll a first crossing usually takes. The observer notes that the lesson was learned exactly once, by someone else, and still counted.',
    lose: 'The strips were crossed and recrossed first-hand while the donor culture sat three centimetres away, untouched. The lesson it already knew stayed exactly where it was — filed under owned by someone else.'
  },

  {
    code: 'EXP-11', name: 'THE WARM ROOM',
    blurb: 'No walls at all — the dish is partitioned by heat, and heat can be crossed.',
    obj: 'Engulf all five flakes scattered across the warm rooms.',
    objShort: 'FLAKES',
    chips: [['', 'heat, not walls'], ['', 'crossable, at a cost'], ['ok', '5 flakes, 5 rooms']],
    inoc: { x: 45, y: 130 },
    nodes: [
      { x: 30, y: 210, r: 11, label: 'flake near' },
      { x: 161, y: 130, r: 12, label: 'flake one' },
      { x: 277, y: 100, r: 12, label: 'flake two' },
      { x: 390, y: 55, r: 11, label: 'flake far n' },
      { x: 390, y: 215, r: 11, label: 'flake far s' }
    ],
    walls: [],
    hazards: [
      { type: 'h', x: 90, y: 1, w: 26, h: 222 },
      { type: 'h', x: 206, y: 37, w: 26, h: 222 },
      { type: 'h', x: 322, y: 1, w: 26, h: 222 }
    ],
    start: 4800, cap: 11500, sustain: 3400, grow: 310, starve: 20, grace: 110, reach: 280, engulf: 1.3,
    timeLimit: 640, hab: false, shocks: false,
    script: [
      { t: 1.5, hi: true, text: 'the warm patches are not walls. cross them and you pay for it in cytoplasm.' },
      { t: 10, text: 'a front left sitting in the heat keeps paying. cross it, do not settle in it.' },
      { t: 22, text: 'the gaps between the warm strips are the only agar that costs nothing at all.' }
    ],
    ambient: [
      'the thermometer in here has opinions about where you go.',
      'a room is only a room because of what it costs to leave.',
      'the cool ground is a corridor, not a destination.',
      'somewhere a technician is adjusting a dial and calling it architecture.'
    ],
    win: 'All five rooms taken, the network threading the gaps between the warm strips instead of through them. The front never lingered in the heat long enough to be charged much for it. The observer records the whole run under consumables.',
    lose: 'The culture parked itself on a warm strip and burned down to nothing arguing the point. The heat did not have to move.'
  },

  {
    code: 'EXP-12', name: 'THE SWEEP',
    blurb: 'A wall of warmth sweeps the dish end to end. Grow where it isn\'t, not where it was.',
    obj: 'Engulf all six oat flakes before the dish times out.',
    objShort: 'FLAKES',
    chips: [['', 'heat bar sweeps'], ['', 'no ground stays cool'], ['ok', 'six oat flakes']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 60, y: 66, r: 12, label: 'flake w' },
      { x: 60, y: 196, r: 12, label: 'flake sw' },
      { x: 195, y: 34, r: 11, label: 'flake n' },
      { x: 225, y: 228, r: 11, label: 'flake s' },
      { x: 360, y: 66, r: 12, label: 'flake e' },
      { x: 360, y: 196, r: 12, label: 'flake se' }
    ],
    walls: [],
    hazards: [
      { type: 'h', x: 0, y: 0, w: 40, h: 260 }
    ],
    events: [
      { t: 22, hazards: [
        { type: 'h', x: 54, y: 0, w: 40, h: 260 }
      ], note: 'the element ticks. the warm bar moves a hand-width right.', hi: true },
      { t: 44, hazards: [
        { type: 'h', x: 108, y: 0, w: 40, h: 260 }
      ] },
      { t: 66, hazards: [
        { type: 'h', x: 162, y: 0, w: 40, h: 260 }
      ], note: 'the bar keeps to schedule. always right, never back — not yet.' },
      { t: 88, hazards: [
        { type: 'h', x: 216, y: 0, w: 40, h: 260 }
      ] },
      { t: 110, hazards: [
        { type: 'h', x: 270, y: 0, w: 40, h: 260 }
      ] },
      { t: 132, hazards: [
        { type: 'h', x: 324, y: 0, w: 40, h: 260 }
      ] },
      { t: 154, hazards: [
        { type: 'h', x: 378, y: 0, w: 40, h: 260 }
      ], note: 'the bar touches the far wall. that should be the end of it.' },
      { t: 176, hazards: [
        { type: 'h', x: 0, y: 0, w: 40, h: 260 }
      ], note: 'it is not. the bar resets to the near wall and starts again.', hi: true },
      { t: 198, hazards: [
        { type: 'h', x: 54, y: 0, w: 40, h: 260 }
      ] },
      { t: 220, hazards: [
        { type: 'h', x: 108, y: 0, w: 40, h: 260 }
      ] },
      { t: 242, hazards: [
        { type: 'h', x: 162, y: 0, w: 40, h: 260 }
      ] },
      { t: 264, hazards: [
        { type: 'h', x: 216, y: 0, w: 40, h: 260 }
      ], note: 'second pass. the ground it clears now was already yours once.' },
      { t: 286, hazards: [
        { type: 'h', x: 270, y: 0, w: 40, h: 260 }
      ] },
      { t: 308, hazards: [
        { type: 'h', x: 324, y: 0, w: 40, h: 260 }
      ] },
      { t: 330, hazards: [
        { type: 'h', x: 378, y: 0, w: 40, h: 260 }
      ], note: 'the bar reaches the far wall again. the observer notes the regularity and nothing else.' },
      { t: 352, hazards: [
        { type: 'h', x: 0, y: 0, w: 40, h: 260 }
      ], note: 'back to the near wall. the schedule does not tire.' },
      { t: 374, hazards: [
        { type: 'h', x: 54, y: 0, w: 40, h: 260 }
      ] },
      { t: 396, hazards: [
        { type: 'h', x: 108, y: 0, w: 40, h: 260 }
      ] },
      { t: 418, hazards: [
        { type: 'h', x: 162, y: 0, w: 40, h: 260 }
      ] }
    ],
    start: 4200, cap: 11500, sustain: 2100, grow: 320, starve: 40, grace: 50,
    timeLimit: 420, hab: false, shocks: false,
    script: [
      { t: 2, hi: true, text: 'a bar of warmth stands at the near wall. it will not stand there long.' },
      { t: 10, text: 'watch where it is. then guess where it is going.' },
      { t: 20, text: 'it moves on a clock, not on anything you do. losing ground to it is only geography.' }
    ],
    ambient: [
      'warmth, evenly applied, is still a threat.',
      'the front leaves without complaint. it has done this before, seconds ago.',
      'behind the bar the agar is already cooling. you are not the first to notice.',
      'the schedule does not care what you were doing when it moved.'
    ],
    win: 'Every flake taken while the bar kept walking. The observer notes a network that never stopped moving and so never lost much of anything. The bar kept its own schedule throughout and noticed none of it.',
    lose: 'Ground was held past the point the bar allows, and the bar does not negotiate that point. The observer logs the time of the last retreat that came too late and leaves the rest of the page for the next culture.'
  },

  {
    code: 'EXP-13', name: 'THE MISSED BEAT',
    blurb: 'The dry shocks keep a fixed beat. On schedule, the fourth one doesn\'t land.',
    obj: 'Engulf every flake and outlast six dry cycles, including the one that never lands.',
    objShort: 'FLAKES',
    chips: [['', 'dry shock every ~22s'], ['', 'one shock withheld'], ['ok', 'engulfed agar holds water']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 370, y: 130, r: 12, label: 'flake 1' },
      { x: 290, y: 48, r: 12, label: 'flake 2' },
      { x: 130, y: 48, r: 12, label: 'flake 3' },
      { x: 50, y: 130, r: 12, label: 'flake 4' },
      { x: 130, y: 212, r: 12, label: 'flake 5' },
      { x: 290, y: 212, r: 12, label: 'flake 6' }
    ],
    walls: [],
    hazards: [],
    shock: { first: 14, period: 22, warn: 5, dur: 6, dmg: 0.0015, skip: [4] },
    start: 4200, cap: 11500, sustain: 2100, grow: 320, starve: 46, grace: 40,
    timeLimit: 0, hab: false, shocks: true,
    minShocks: 6,
    script: [
      { t: 2, hi: true, text: 'the dry cycles are back, same schedule as before. you have done this.' },
      { t: 10, text: 'engulfed agar holds moisture. root yourself in it before the first cycle lands.' },
      { t: 65, text: 'you have started slowing before the warning even sounds. good. or bad. hard to say from here.' }
    ],
    ambient: [
      'the interval has not changed. you have.',
      'a slowdown arriving early is still, technically, correct.',
      'somewhere a clock is being trusted more than it has earned.',
      'not every held breath ends in something. this might be one of those.'
    ],
    win: 'Six flakes taken, six scheduled cycles logged, and the fourth one never came — the culture slowed for it anyway, on time, into an empty interval. The observer writes down anticipation surviving contact with nothing at all. The rhythm resumed on the next beat as if nothing had been withheld, which is either resilience or a short memory.',
    lose: 'The culture never slowed for anything, dry or otherwise, and spent itself flat against the next real cycle. The schedule kept its appointment; the culture did not keep pace with it.'
  },

  {
    code: 'EXP-14', name: 'THE SYNCOPATION',
    blurb: 'Dry shocks on a shrinking clock. Build your refuges before the rhythm outruns you.',
    obj: 'Engulf every flake and outlast seven accelerating dry cycles.',
    objShort: 'FLAKES',
    chips: [['', 'dry shock, shrinking gap'], ['', '7 cycles required'], ['ok', 'engulfed agar = refuge']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 210, y: 40, r: 12, label: 'flake n' },
      { x: 348, y: 78, r: 12, label: 'flake ne' },
      { x: 356, y: 196, r: 12, label: 'flake se' },
      { x: 210, y: 224, r: 12, label: 'flake s' },
      { x: 64, y: 196, r: 12, label: 'flake sw' },
      { x: 72, y: 78, r: 12, label: 'flake nw' }
    ],
    walls: [],
    hazards: [],
    shock: { first: 14, period: 26, warn: 5, dur: 6, dmg: 0.0013, accel: 0.88, minPeriod: 13 },
    start: 4200, cap: 11500, sustain: 2100, grow: 320, starve: 44, grace: 40,
    timeLimit: 0, hab: false, shocks: true,
    minShocks: 7,
    script: [
      { t: 2, hi: true, text: 'the air in here has a metronome. it is not going to keep the tempo.' },
      { t: 10, text: 'engulfed agar holds water. it is also the only ground that will still be dry later.' },
      { t: 20, hi: true, text: 'each gap is shorter than the one before it. spend the wide ones now.' }
    ],
    ambient: [
      'the interval used to feel generous. it no longer does.',
      'the metronome is being wound tighter, not reset.',
      'you count the gap before it counts you.',
      'the refuges do not care what tempo it is outside them.'
    ],
    win: 'All six flakes taken and seven cycles survived, the last of them landing on top of the one before it with almost no gap left to work with. The refuges held because they were built while the schedule still allowed it. The observer notes the tempo, then notes that nobody asked the culture whether it wanted to keep time.',
    lose: 'The gaps ran out before the flakes did, and the last few dry cycles arrived close enough together to be one long one. The observer marks the interval where the rhythm won.'
  },

  {
    code: 'EXP-15', name: 'THE TIDE',
    blurb: 'Six stations in a ring, and ground that reverts the moment you look away.',
    obj: 'Hold all six stations engulfed at the same time.',
    objShort: 'HELD',
    chips: [['', 'ground reseals'], ['ok', 'six stations'], ['', 'hold, don\'t tour']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 210, y: 35, r: 12, label: 'shore n' },
      { x: 344, y: 83, r: 12, label: 'shoal ne' },
      { x: 344, y: 178, r: 12, label: 'shoal se' },
      { x: 210, y: 225, r: 12, label: 'shore s' },
      { x: 76, y: 178, r: 12, label: 'shoal sw' },
      { x: 76, y: 83, r: 12, label: 'shoal nw' }
    ],
    walls: [],
    hazards: [],
    start: 4800, cap: 10000, sustain: 1700, grow: 310, starve: 32, grace: 70, reach: 200, engulf: 1.2,
    timeLimit: 520, hab: false, shocks: false,
    reseal: 16,
    script: [
      { t: 2, hi: true, text: 'six stations, no walls, and ground you leave alone stops being yours.' },
      { t: 16, hi: true, text: 'the first one you touched and left is already thinking about reverting.' },
      { t: 40, text: 'a network that only visits is not the same as a network that stays.' }
    ],
    ambient: [
      'agar is not grateful. agar is only recently touched, or not.',
      'the tide is not water. the tide is you, elsewhere.',
      'every station you are not touching is quietly reconsidering.',
      'six mouths, one cytoplasm, and nowhere it can afford to stop.'
    ],
    win: 'All six stations held at once, the network finally still instead of touring. The observer notes that holding is a different verb from finding, and a harder one. Nothing in the dish reverted while the note was being written.',
    lose: 'Something was always mid-reversion. The observer counts five held, one skinning over, and writes down that six is not five plus patience.'
  },

  {
    code: 'EXP-16', name: 'THE TRIAGE',
    blurb: 'Eight flakes, and enough of you for six. Choose which two you were never going to keep.',
    obj: 'Hold six of the eight stations at once.',
    objShort: 'FLAKES',
    chips: [['', 'hold 6 of 8'], ['', 'idle ground reseals'], ['ok', 'no hazards']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 210, y: 50, r: 11, label: 'flake n' },
      { x: 320, y: 80, r: 11, label: 'flake ne' },
      { x: 320, y: 180, r: 11, label: 'flake se' },
      { x: 210, y: 210, r: 11, label: 'flake s' },
      { x: 100, y: 180, r: 11, label: 'flake sw' },
      { x: 100, y: 80, r: 11, label: 'flake nw' },
      { x: 30, y: 30, r: 11, label: 'far flake nw' },
      { x: 390, y: 230, r: 11, label: 'far flake se' }
    ],
    walls: [],
    hazards: [],
    start: 4800, cap: 10500, sustain: 1500, grow: 320, starve: 24, grace: 85, reach: 240,
    timeLimit: 520, hab: false, shocks: false,
    reseal: 15, holdWin: 6,
    script: [
      { t: 2, hi: true, text: 'eight stations. tending is not the same as holding.' },
      { t: 9, hi: true, text: 'ground you leave alone for too long seals back over. it does not ask first.' },
      { t: 22, text: 'there is not enough of you for all eight. six will have to be the whole answer.' }
    ],
    ambient: [
      'six is not a compromise. six is the number that was always available.',
      'the far bench costs more just to remember it exists.',
      'a flake left alone does not starve. it simply stops being yours.',
      'nothing is being sacrificed here. two things are simply not being reached.'
    ],
    win: 'Stations enough held at once, and whatever could not be kept was let go early and without ceremony. The observer notes the concession was always the correct answer, not a shortfall met halfway. Holding everything was never on offer.',
    lose: 'The network spread thin across all eight, held none of them long enough, and watched the reseal timers win every argument at once. Ambition, on this agar, is just starvation with better publicity.'
  },

  {
    code: 'EXP-17', name: 'THE REVISION',
    blurb: 'A labyrinth re-cut twice mid-run. Trust nothing you have already built.',
    obj: 'Engulf both agar blocks; the maze will be re-cut twice along the way.',
    objShort: 'BLOCKS',
    chips: [['', 'cut labyrinth'], ['', 'walls recut mid-run'], ['ok', 'two agar blocks']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 40, y: 220, r: 13, label: 'block SW' },
      { x: 380, y: 40, r: 13, label: 'block NE' }
    ],
    walls: [
      [0, 0, 420, 8],
      [0, 252, 420, 8],
      [0, 0, 8, 260],
      [412, 0, 8, 260],
      [40, 90, 60, 7],
      [320, 160, 60, 7],
      [140, 52, 8, 200],
      [280, 8, 8, 200]
    ],
    hazards: [],
    requireEvents: true,
    events: [
      { t: 100, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [40, 90, 60, 7],
        [320, 160, 60, 7],
        [140, 8, 8, 200],
        [280, 52, 8, 200]
      ], note: 'somewhere a wall you trusted is being poured.', hi: true },
      { t: 210, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [40, 90, 60, 7],
        [320, 160, 60, 7],
        [140, 52, 8, 200],
        [280, 52, 8, 200]
      ], note: 'a second pour. the shortcut that saved you the first time is gone.', hi: true }
    ],
    start: 5000, cap: 11000, sustain: 5800, grow: 320, starve: 10, grace: 260, reach: 280, engulf: 1.7,
    timeLimit: 820, hab: false, shocks: false,
    script: [
      { t: 2, hi: true, text: 'a labyrinth again. this one is not finished being cut.' },
      { t: 15, text: 'dead ends still cost cytoplasm. retract out of them.' },
      { t: 80, hi: true, text: 'the walls you have not tested yet are the ones that matter most.' }
    ],
    ambient: [
      'a corridor this well-worn should be permanent. it is not.',
      'the tubes remember a shape the walls no longer have.',
      'concrete would be kinder. concrete would also be data-poor.',
      'a map is only useful while the room agrees with it.'
    ],
    win: 'Both blocks taken, the network rebuilt twice over without complaint. The tubes that carried you through the second revision were laid after it, not before — whatever survived the repour was in the organism, not the plumbing. The observer writes this down and immediately wants to run it a third time.',
    lose: 'The culture kept feeding a corridor that had already been poured shut. The observer notes that the tubes were entirely correct about a dish that no longer existed.'
  },

  {
    code: 'EXP-18', name: 'THE DRAWBRIDGE',
    blurb: 'A wall down the middle, two doors, one open at a time. Time the crossing.',
    obj: 'Engulf all three agar patches, timing each crossing to an open gate.',
    objShort: 'AGAR',
    chips: [['', 'gated centre wall'], ['', '~30s door cycle'], ['ok', '3 agar patches']],
    inoc: { x: 100, y: 130 },
    nodes: [
      { x: 60, y: 130, r: 11, label: 'near agar' },
      { x: 330, y: 87, r: 12, label: 'far agar n' },
      { x: 330, y: 177, r: 12, label: 'far agar s' }
    ],
    walls: [
      [0, 0, 420, 8],
      [0, 252, 420, 8],
      [0, 0, 8, 260],
      [412, 0, 8, 260],
      [206, 8, 8, 62],
      [206, 104, 8, 90],
      [206, 194, 8, 58]
    ],
    hazards: [],
    events: [
      { t: 30, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'south opens. north is a wall again.', hi: true },
      { t: 60, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 62],
        [206, 104, 8, 90],
        [206, 194, 8, 58]
      ], note: 'north opens. south is a wall again.', hi: true },
      { t: 90, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'the south door again. the north one you were counting on is gone.' },
      { t: 120, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 62],
        [206, 104, 8, 90],
        [206, 194, 8, 58]
      ], note: 'the north door again. the south one you were counting on is gone.' },
      { t: 150, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'south stands open. whatever you left at the north door is on its own now.' },
      { t: 180, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 62],
        [206, 104, 8, 90],
        [206, 194, 8, 58]
      ], note: 'north stands open. whatever you left at the south door is on its own now.' },
      { t: 210, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'south lifts. the north seam closes without asking who is still in it.' },
      { t: 240, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 62],
        [206, 104, 8, 90],
        [206, 194, 8, 58]
      ], note: 'north lifts. the south seam closes without asking who is still in it.' },
      { t: 270, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'south opens. north is a wall again.' },
      { t: 300, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 62],
        [206, 104, 8, 90],
        [206, 194, 8, 58]
      ], note: 'north opens. south is a wall again.' },
      { t: 330, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'the south door again. the north one you were counting on is gone.' },
      { t: 360, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 62],
        [206, 104, 8, 90],
        [206, 194, 8, 58]
      ], note: 'the north door again. the south one you were counting on is gone.' },
      { t: 390, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'south stands open. whatever you left at the north door is on its own now.' },
      { t: 420, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 62],
        [206, 104, 8, 90],
        [206, 194, 8, 58]
      ], note: 'north stands open. whatever you left at the south door is on its own now.' },
      { t: 450, walls: [
        [0, 0, 420, 8],
        [0, 252, 420, 8],
        [0, 0, 8, 260],
        [412, 0, 8, 260],
        [206, 8, 8, 96],
        [206, 104, 8, 56],
        [206, 194, 8, 58]
      ], note: 'south lifts. the north seam closes without asking who is still in it.' }
    ],
    start: 4800, cap: 11500, sustain: 3400, grow: 310, starve: 18, grace: 80, reach: 260,
    timeLimit: 480, hab: false, shocks: false,
    script: [
      { t: 2, hi: true, text: 'a wall splits the dish top to bottom. two doors sit in it, and only one is open.' },
      { t: 14, text: 'feed close first — the doors are not going anywhere, but starving while you wait for one is still starving.' },
      { t: 27, hi: true, text: 'a door is closing. whatever is standing in the frame does not get pulled back first.' }
    ],
    ambient: [
      'the wall does not care which side you meant to be on.',
      'a door about to close looks exactly like one that just opened.',
      'cytoplasm left in a closing frame does not get a vote.',
      'the near flake was never the point. it was groceries.'
    ],
    win: 'All three patches taken, both doors caught open when it mattered and shut on nothing of yours. Nobody adjusted the schedule for you; you adjusted to it. The observer records this as punctuality, a word rarely applied to a mould.',
    lose: 'The dish timed out with agar still dark on the far side, the front parked at a door that was never going to open on request. The observer notes the timing, and files the effort separately.'
  },

  {
    code: 'EXP-19', name: 'THE FIRE DRILL',
    blurb: 'Dry shocks flood the centre with heat too. Anticipate, contract, re-expand.',
    obj: 'Engulf all five flakes and survive at least four heat drills.',
    objShort: 'FLAKES',
    chips: [['', 'dry shock every ~25 s'], ['', 'centre floods with heat'], ['ok', 'corners hold cool']],
    inoc: { x: 210, y: 130 },
    nodes: [
      { x: 50, y: 40, r: 12, label: 'flake NW' },
      { x: 370, y: 40, r: 12, label: 'flake NE' },
      { x: 50, y: 220, r: 12, label: 'flake SW' },
      { x: 370, y: 220, r: 12, label: 'flake SE' },
      { x: 40, y: 130, r: 12, label: 'flake W' }
    ],
    walls: [],
    hazards: [],
    events: [
      { t: 18, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'the plain goes hot. the middle of the dish is the whole of the danger.', hi: true },
      { t: 24, hazards: [
        
      ], note: 'the heat lifts. the middle is agar again, briefly.', hi: true },
      { t: 43, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'again. the floor under the inoculation point floods with heat.' },
      { t: 49, hazards: [
        
      ], note: 'cool returns to the centre. use it.' },
      { t: 68, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'on schedule. the centre is not safe and was never going to stay that way.' },
      { t: 74, hazards: [
        
      ], note: 'the plain clears. the window will not stay open.' },
      { t: 93, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'fourth flood. the corners are still cool. that is the entire strategy.' },
      { t: 99, hazards: [
        
      ], note: 'four survived. the middle goes quiet again.' },
      { t: 118, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'the drill repeats. repetition is the point of a drill.' },
      { t: 124, hazards: [
        
      ], note: 'heat off. the clock toward the next one has already started.' },
      { t: 143, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'hot again, dead centre, same as every time before.' },
      { t: 149, hazards: [
        
      ], note: 'the centre cools. nothing here forgives lateness.' },
      { t: 168, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'the middle floods once more. you should not still be surprised.' },
      { t: 174, hazards: [
        
      ], note: 'clear again, for a while that is shorter than it feels.' },
      { t: 193, hazards: [
        { type: 'h', x: 130, y: 70, w: 80, h: 120 },
        { type: 'h', x: 210, y: 70, w: 80, h: 120 }
      ], note: 'last scheduled flood. the plain earns its name.' },
      { t: 199, hazards: [
        
      ], note: 'the last flood recedes. the plain is done for the day.' }
    ],
    shock: { first: 18, period: 25, warn: 5, dur: 6, dmg: 0.0018 },
    start: 4300, cap: 11500, sustain: 2400, grow: 320, starve: 40, grace: 150, reach: 270,
    timeLimit: 300, hab: false, shocks: true,
    minShocks: 4,
    script: [
      { t: 2, hi: true, text: 'the air here dries on a clock, and when it does the middle of this dish is not agar. it is a stove.' },
      { t: 11, hi: true, text: 'the warning means leave the centre now. corners hold, the plain does not.' },
      { t: 25, text: 'it lifts as fast as it came. cross back while it is open.' },
      { t: 60, text: 'you are slowing before the warning fires. nobody rang a bell yet.' }
    ],
    ambient: [
      'the middle of the dish keeps a schedule better than you do.',
      'cool at the edges, hot in the middle, and the middle is where you started.',
      'you have started flinching before the warning finishes.',
      'the corners do not care what the centre is doing. that is the entire appeal of a corner.'
    ],
    win: 'All five flakes taken and four floods of the centre survived, the network learning to empty the middle before the warning finished and refill it before the window closed. Nobody told the culture the schedule. A drill, it turns out, is something you can get good at.',
    lose: 'Caught in the middle when the floor went hot, more than once, until there was less network than there was schedule. The clock did not slow down to wait.'
  },

  {
    code: 'EXP-20', name: 'THE LONG NIGHT',
    blurb: 'Hold five stations, survive the shocks, and lose a wall along the way.',
    obj: 'Hold all five stations at once and outlast six dry cycles before the clock runs out.',
    objShort: 'HELD',
    chips: [['', 'hold all five'], ['', 'shocks accelerate'], ['', 'heat + one revision']],
    inoc: { x: 210, y: 90 },
    nodes: [
      { x: 210, y: 34, r: 12, label: 'night bench' },
      { x: 50, y: 40, r: 12, label: 'west rack' },
      { x: 380, y: 40, r: 12, label: 'east rack' },
      { x: 60, y: 220, r: 11, label: 'south cell' },
      { x: 385, y: 225, r: 11, label: 'warm cell' }
    ],
    walls: [
      [100, 150, 320, 8]
    ],
    hazards: [
      { type: 'h', x: 330, y: 176, w: 20, h: 83 },
      { type: 'h', x: 350, y: 176, w: 70, h: 20 }
    ],
    events: [
      { t: 150, walls: [
        [0, 150, 320, 8]
      ], note: 'the near door is shutting. the far one was never locked, only walled — until now.', hi: true }
    ],
    shock: { first: 34, period: 34, warn: 7, dur: 6, dmg: 0.0011, accel: 0.93, minPeriod: 15 },
    start: 5000, cap: 13500, sustain: 2500, grow: 320, starve: 14, grace: 200, reach: 280, engulf: 1.8,
    timeLimit: 900, hab: false, shocks: true,
    minShocks: 6, reseal: 20,
    script: [
      { t: 2, hi: true, text: 'five stations. holding one is not the same as having held it.' },
      { t: 10, text: 'ground you leave alone for long enough remembers that you left.' },
      { t: 20, hi: true, text: 'the southeast corner is warm on purpose. go in anyway.' },
      { t: 35, text: 'the dry cycles are not on the same clock twice. each one arrives sooner.' }
    ],
    ambient: [
      'the observer has stopped writing dates on this one.',
      'five is not a large number until you are trying to be in five places.',
      'warmth, like everything else in this dish, is a decision someone made for you.',
      'the schedule does not slow down because you are tired. neither have you, which nobody planned for.'
    ],
    win: 'All five stations held at the moment the sixth cycle closed, the network still standing in the southeast corner it was never going to like. The wall came down where the notes said it would, and the culture went around it anyway. The observer writes the date, closes the notebook, and — this once — does not immediately open a new one.',
    lose: 'One station skinned over while the culture held the other four, and the sixth cycle never came. The dish is logged, the lamp switched off, and the notebook left open to a page that was not quite finished.'
  }
];

/* Stretch a dish's schedule and slow its rates by PACE — see the pace block
   in section 1. Idempotent by construction only because it runs once, here,
   over the literal above. Times: grace, time limit, reseal, the shock
   schedule, every scripted line and every wall or hazard event. Rates per
   dish-second: starvation, and not growth — see the pace block for why.
   Per-step probabilities: a dish's own heat damage and the shock's damage,
   so a shock that lasts PACE times as many steps kills the same share of
   the culture. */
function paceDish(e) {
  var k = PACE, i;
  if (k === 1) return;
  if (e.grace) e.grace *= k;
  if (e.timeLimit) e.timeLimit *= k;
  if (e.reseal) e.reseal *= k;
  if (e.refine && e.refine.dur) e.refine.dur *= k;
  if (e.refine && e.refine.flow) e.refine.flow /= k;
  if (e.refine && e.refine.stream) e.refine.stream /= k;
  if (e.starve) e.starve /= k;
  if (e.heatDmg != null) e.heatDmg /= k;
  if (e.shock) {
    var sh = e.shock;
    if (sh.first) sh.first *= k;
    if (sh.period) sh.period *= k;
    if (sh.warn) sh.warn *= k;
    if (sh.dur) sh.dur *= k;
    if (sh.minPeriod) sh.minPeriod *= k;
    if (sh.dmg) sh.dmg /= k;
  }
  if (e.events) for (i = 0; i < e.events.length; i++) if (e.events[i].t) e.events[i].t *= k;
  /* A chip that quotes a period ("dry shock every ~25 s", "~30s door cycle")
     quotes the schedule stretched above, so the number moves with it. Only
     the ~Ns form is a period; counts of cycles in an objective are not. */
  if (e.chips) for (i = 0; i < e.chips.length; i++) {
    if (e.chips[i] && typeof e.chips[i][1] === 'string') {
      e.chips[i][1] = e.chips[i][1].replace(/~(\d+)( ?)s\b/g, function (m, n, sp) { return '~' + (n * k) + sp + 's'; });
    }
  }
  if (e.script) for (i = 0; i < e.script.length; i++) if (e.script[i].t) e.script[i].t *= k;
}
for (var pdi = 0; pdi < EXPERIMENTS.length; pdi++) paceDish(EXPERIMENTS[pdi]);

/* ------------------------------------------------------------
   3. field + agent storage (all typed, allocated once)
   ------------------------------------------------------------ */
var trail = new Float32Array(NCELL);
var gdist = new Float32Array(NCELL);   // scratch for the geodesic sweep
var bfsQ  = new Int32Array(NCELL + 1); // ring buffer, one slot per cell + 1
var inQ   = new Uint8Array(NCELL);
var nodeDist = [];                     // per node: geodesic distance, built once
var tmpF  = new Float32Array(NCELL);
var stalkF = new Float32Array(NCELL);  // see STALK_HOLD
var foodF = new Float32Array(NCELL);
var statF = new Float32Array(NCELL);   // food*FOODW - hazard repel + wall penalty
var cueF  = new Float32Array(NCELL);
var retF  = new Float32Array(NCELL);
var wallM = new Uint8Array(NCELL);
var hazM  = new Uint8Array(NCELL);     // 0 none, 1 heat, 2 quinine, 3 light
var slimeF = new Float32Array(NCELL);  // extracellular slime, laid and never lifted
/* Where the network has a junction, and how strongly. Written by the ring
   test, decayed every step, read by the deposit rule and by the renderer. It
   is not sensed: what the organism senses is the tube, and the lobe is
   already part of that. */
var knotF = new Float32Array(NCELL);
/* Where the front has just been: laid by supplied tips, followed by the
   cytoplasm behind them, gone in seconds. See the trace block in section 1. */
var traceF = new Float32Array(NCELL);
/* Flux, and what the network has made of it. flowF is the deposit this cell
   has taken since the last slow sweep and is zeroed by it; condF is the slow
   low-pass of that, and is what buys a tube its longer memory. Neither is
   sensed: the organism senses the tube, and conductivity is the reason the
   tube is still there. See the conductivity block in section 1. */
var flowF = new Float32Array(NCELL);
var condF = new Float32Array(NCELL);
/* Where a tube has been, long after it has gone — the one field in the dish
   with a memory measured in minutes. Sensed. See the scar block. */
var scarF = new Float32Array(NCELL);
/* The return signal, and its shade. fedF is what the plate knows of a find
   here, sourced on the pads and relaxed back through the cytoplasm, and
   padF is the label it carries — the body signal at the pad it came from;
   bodyF is the body, sourced at the core and relaxed outward. Each has the
   other half of a double buffer (fedB, padB, bodyB), so a pass reads one
   sweep's values and writes the next and no cell's answer depends on where
   it sits in the scan; the spare halves double as the dilation's scratch.
   linkF is the connection — the two signals' product against the label,
   sharpened — and shadeF marks the cells standing beside it. Not sensed,
   any of them: the organism senses the tube, and these are among the
   reasons the tube is the shape it is. See the return-signal block. */
var fedF = new Float32Array(NCELL), fedB = new Float32Array(NCELL);
var padF = new Float32Array(NCELL), padB = new Float32Array(NCELL);
var bodyF = new Float32Array(NCELL), bodyB = new Float32Array(NCELL);
var linkF = new Float32Array(NCELL);
var shadeF = new Uint8Array(NCELL);
var fedLastY = new Int16Array(GW);     // the column pass of the shade's dilation: last row written, per column
var nodeAt = new Int16Array(NCELL);    // cell -> node index, -1 for none
/* And the same map at the fan's radius: which flake an agent standing here is
   feeding on, which is a wider disc than the flake itself because a pad
   overhangs its meal. Kept separate from nodeAt rather than widening it,
   because nodeAt is what counts contact for engulfment and that has to stay
   the flake's own area — a wider one would credit the culture for cytoplasm
   sitting beside the food rather than on it. */
var feedAt = new Int16Array(NCELL);
/* One agent per cell. Without it the whole population collapses into whichever
   vein is currently strongest and the network is a single rope; with it a
   saturated tube spills sideways, which is exactly how the mesh gets its holes
   and how the front stays a fan rather than a beam.

   COUNTS, not a flag. Placement (inoculation, growth) can still put two agents
   in one cell, and with a flag the first of them to leave cleared the cell for
   everyone — the exclusion quietly eroded exactly where the population is
   densest, which is where it does the work. Counts also mean every path that
   removes an agent has to decrement: the death branch below does, and the
   whole grid is restamped from real positions at the top of every step, so
   spawnAgent/killWeakest (which run after the agent loop) cannot leave it
   drifted for more than the rest of the frame. */
var occ = new Uint16Array(NCELL);

var ax = new Float32Array(MAXA);
var ay = new Float32Array(MAXA);
var ah = new Float32Array(MAXA);
/* Was this agent at the front on the last step it took? The renderer needs
   this and cannot recompute it: an agent's own tube deposit puts the cell
   under a tip well up into trunk territory within a step, so reading the
   trail there and calling anything low a tip mis-sorts every filament in the
   dish into the trunk band and the front stops being drawn. Written where it
   is decided, read where it is needed. */
var atip = new Uint8Array(MAXA);
/* How long this agent has been standing on nothing, in seconds. The one piece
   of per-agent state the adrift rule needs, and it has to be per-agent: the
   question is not whether a cell is thin — plenty of legitimate cells are —
   but whether this piece of cytoplasm has been attached to anything for the
   last few seconds. Cleared wherever an agent is placed and carried by every
   swap that removes one, exactly like atip. */
var astv = new Float32Array(MAXA);
var nAgents = 0;

/* ------------------------------------------------------------
   Palette and body transfer, taken off a photograph of the organism
   ------------------------------------------------------------
   Physarum on agar is not a glow. It is flat pigment with a hard edge, on
   translucent grey-green agar: solid trunks forking down through several
   generations into finer veins, the fine ones closing loops into a net, and
   the growing ends spreading into lobed fans. The old ramp fought that. It ran
   through olive to near-white, which turned dense tissue grey; and it ramped
   SMOOTHLY, so every vein was a gradient with no edge anywhere and the dish
   read as luminous goo. The threshold below fixed most of that and then
   underdid its own idea: at three trail units of crossing, every boundary
   still wore a band of the muddy in-between tones, and a bright body edged
   in dark mud against a dark dish is the anatomy of a DROP SHADOW — the
   whole organism read as a sticker with a shadow behind it, which is a
   different wrong dish from the luminous one but wrong the same amount.

   So the transfer is a soft-edged THRESHOLD rather than a ramp. Below BODY_T
   there is no organism and the cell is agar; across the next BODY_SOFT of
   trail it becomes tissue; above that it is tissue, at one flat colour,
   however much trail it carries. The narrow crossing band draws the edge —
   wide enough to antialias at this grid resolution, narrow enough that a
   boundary reads as a boundary. How much trail a tube carries is then
   expressed the way the organism expresses it, by how WIDE the tube is, which
   the field renders directly and the vein lines in 9b render as line weight.

   WHICH flat colour is the photograph's. PLASMODIUM feeds this ramp and the
   vein bands below it, so the threshold keeps the hard edge and the plate
   keeps the colour of the thing it is a plate of. It used to be the RUN'S
   instead — derived from the seed, any hue at all — and the reference yellow
   survived only as the tone a run got when its seed happened to land near it.
   A dish of magenta slime is a nice number and the wrong organism. */
var AGAR = [20, 22, 17];        // the dish, unoccupied
var BODY_T    = 9.0;            // trail at which tissue begins
var BODY_SOFT = 1.4;            // trail over which the edge resolves
/* The floor the same edge resolves from along a BRIDGE — see buildBridges.
   A tube thin enough to need bridging sits well under BODY_T by definition,
   so measuring it against BODY_T would draw nothing. This sits BELOW
   BRIDGE_MIN, and the gap between the two is load-bearing rather than
   incidental: paintField reads a bridged cell's coverage off the same trail
   field the flood qualified it on, so a cell that cleared 3.0 to be routed
   cannot then fail to be drawn. It resolves at 79% coverage at worst and full
   tissue by 3.4. What the remaining distance to zero is for is a cell the mask
   still names after its tube has decayed out from under it, which fades rather
   than being asserted. */
var BODY_LO   = 2.0;            // ...and the floor it resolves from on a bridge

/* Everything the dish can ADD to a cell, named in one place, because the
   tint solve has to model the brightest ground a shaded rim can border and
   numbers copied into it would drift from the painter's. paintField composes
   cells from these; the solve takes its worst case over them. Index of
   HAZ_ADD is the hazM code; 3 is the lit field — not an ember: the same
   aversion, told cold. */
var HAZ_ADD = [null, [38, 20, 9], [27, 12, 40], [30, 34, 40]];
var CUE_ADD = [26, 24, 8];    // growth-cue haze, per unit of cueF
var RET_ADD = [26, 6, 16];    // retract haze, per unit of retF
var MAT_ADD = [7, 8, 11];     // slime mat, per unit of slimeF — ground only
var BRUSH_PEAK = 1.15;        // the brush cone's tip, the most cueF/retF holds

/* Every ground the body's shaded rim can border, worst case: each hazard
   field (and bare agar), under a brush cone's full cue haze, retract haze,
   or BOTH — the brush writes one field without clearing the other, so a
   mode switch mid-gesture (the second-finger override) leaves cue and
   retract on the same cells, and the painter adds them both — with and
   without the slime mat's film on the unoccupied side. The mat is the
   unkind one: it fades under tissue, so it lifts the ground WITHOUT lifting
   the rim. Additive light compresses a contrast ratio from below, so the
   floor in applyPalette is demanded against all of these, not against bare
   agar. Sixteen bases, each with a matless and a matted ground luminance;
   the body beside them shares everything but the mat. All static, so built
   once. */
var FLOOR_STACKS = (function () {
  var out = [];
  var overs = [
    [0, 0, 0],
    [CUE_ADD[0] * BRUSH_PEAK, CUE_ADD[1] * BRUSH_PEAK, CUE_ADD[2] * BRUSH_PEAK],
    [RET_ADD[0] * BRUSH_PEAK, RET_ADD[1] * BRUSH_PEAK, RET_ADD[2] * BRUSH_PEAK],
    [(CUE_ADD[0] + RET_ADD[0]) * BRUSH_PEAK,
     (CUE_ADD[1] + RET_ADD[1]) * BRUSH_PEAK,
     (CUE_ADD[2] + RET_ADD[2]) * BRUSH_PEAK]
  ];
  for (var hz = 0; hz < 4; hz++) {
    var h = hz ? HAZ_ADD[hz] : [0, 0, 0];
    for (var ov = 0; ov < overs.length; ov++) {
      var bx = AGAR[0] + h[0] + overs[ov][0];
      var by = AGAR[1] + h[1] + overs[ov][1];
      var bz = AGAR[2] + h[2] + overs[ov][2];
      out.push({
        base: [bx, by, bz],
        gL:  relLum(bx, by, bz),
        gmL: relLum(bx + MAT_ADD[0], by + MAT_ADD[1], bz + MAT_ADD[2])
      });
    }
  }
  return out;
})();
/* 1.4, down from 3.0: the crossing keeps about a cell of width against the
   trail gradients the body actually has, and the drawImage upscale antialiases
   that cell, so the edge stays smooth on screen. What the narrower window
   removes is the apron — the muddy blend tones that ringed every lobe and
   hole and read, against the dark dish, as a shadow the body was casting. */

/* The inner shadow: the shading of the WHOLE shape of the mold, and the only
   shadow on the plate. The organism is a raised mass on the agar, lit from
   up and to the left of the bench; where its surface rolls away from that
   light — the down-light side of its outline, the up-light wall inside every
   hole — the tissue darkens. Computed in paintField from the body's own
   coverage: a cell is shaded by how much the body is ABSENT a little way
   down-light of it, sampled at two throws so the shade curls off soft instead
   of stamping a band. Two throws are the whole feather; the field is coarse
   enough that more would buy nothing.

   It is a multiply on the body's own contribution to the cell — not on the
   finished pixel — so a shaded green is a darker green, never grey, and the
   ground underneath keeps its own light: the agar, and the hazard glow that
   bleeds through the organism on a heat, quinine or light field. It touches
   nothing but tissue — the agar carries no coverage, so nothing is ever
   drawn OFF the body. That is the line every earlier attempt crossed:
   shadows drawn along the veins, at any depth or offset, traced the body's
   skeleton and summed to a drop shadow under the whole network. The shape's
   own shadow lives on the shape. */
var ISH_D     = 2;      // throw, in cells, diagonally down-light per tap
var ISH_DEPTH = 0.30;   // full-shade depth, on the body's contribution
/* The depth the plate actually paints with. ISH_DEPTH, unless applyPalette's
   guard has to trim it: a tissue tone that cannot be walked light enough for
   its fully shaded edge to keep the 3:1 body floor gives up shadow instead
   (see the solve). The shipped yellow needs no trim, so this is ISH_DEPTH
   today; it exists because legibility outranks modelling, and a specimen the
   player can see beats one with the handsomest shading. */
var ishDepth  = ISH_DEPTH;

var LUT = new Uint8Array(256 * 3);
var GAMN = 2048;
var GAM = new Uint8Array(GAMN);
/* the same ramp, anchored at BODY_LO — the transfer a bridged cell is drawn
   through, so a bridge is tissue at the body's own colour and not a tone
   between body and agar */
var GAM_LO = new Uint8Array(GAMN);
var GAM_SCALE = (GAMN - 1) / TRAIL_MAX;
(function buildGamma() {
  for (var j = 0; j < GAMN; j++) {
    var q = j / GAM_SCALE;
    var u = (q - BODY_T) / BODY_SOFT;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    var v = u * u * (3 - 2 * u);          /* smoothstep: the edge */
    GAM[j] = (v * 255) | 0;
    var w = (q - BODY_LO) / BODY_SOFT;
    if (w < 0) w = 0; else if (w > 1) w = 1;
    GAM_LO[j] = (w * w * (3 - 2 * w) * 255) | 0;
  }
})();
/* The lowest sharpened value at which the painter actually puts ink on the
   plate. Not BODY_T, and not derivable from the ramp alone: a cell's colour
   reaches the pixel through TWO quantisations, and either can round a live
   cell away to nothing.

   GAM is the first. It holds 256 steps of coverage over GAMN buckets, and
   smoothstep leaves its first bucket rounding to zero, so coverage begins at
   9.0572 rather than at 9.0. LUT is the second and the sharper one: it stores
   a whole channel delta per coverage step, `((tr - AGAR[0]) * i / 255) | 0`,
   so coverage 1 truncates to zero for any colour the dish can hold — 235 of
   delta at the very brightest is 0.92 of a channel — and a dark enough plate
   is still at zero by coverage 4 or 7. The floor is therefore a function of
   the RUN'S palette, which is why it is computed here, in the one place that
   knows it, and recomputed whenever the palette changes.

   Composed, the question is exactly "which sharpened value is the first whose
   coverage survives LUT", and it is asked once per palette so the per-cell
   test using it stays a compare. If no coverage inks at all — a tint equal to
   the agar, which the contrast solve does not permit — it falls back to
   BODY_T and the pass behaves as it did before any of this. */
var BODY_DRAW = BODY_T;

function buildLUT(tr, tg, tb) {
  var i;
  for (i = 0; i < 256; i++) {
    var t = i / 255;
    LUT[i * 3]     = ((tr - AGAR[0]) * t) | 0;
    LUT[i * 3 + 1] = ((tg - AGAR[1]) * t) | 0;
    LUT[i * 3 + 2] = ((tb - AGAR[2]) * t) | 0;
  }
  var lo = 0;
  while (lo < 256 && !LUT[lo * 3] && !LUT[lo * 3 + 1] && !LUT[lo * 3 + 2]) lo++;
  BODY_DRAW = BODY_T;
  if (lo < 256) {
    for (var j = 0; j < GAMN; j++) if (GAM[j] >= lo) { BODY_DRAW = j / GAM_SCALE; break; }
  }
}

/* The organism's colour, and the lamp that lights it. Everything the plate is
   painted in comes from these two.

   PLASMODIUM is a Physarum polycephalum plasmodium as it looks on agar under
   bench light: chrome yellow, the egg-yolk tone the cultures are known for.
   It is warmer and considerably more saturated than the yellow that used to
   sit here — hue 45° rather than 53°, so it leans amber instead of lime, and
   HSL saturation 0.86 rather than 0.73, which is 189 of chroma against 153.
   That old value was the DEFAULT of a per-seed palette rather than a claim
   about the organism, and it had drifted the way a default does.

   LAMP is where a lit crest walks TO. Not white: a warm cream at the tissue's
   own hue, saturated to the top of the cube. A lamp on a yellow tube leaves a
   golden highlight, not a colourless one, so the crest brightens without
   draining — see VEIN_BANDS for the arithmetic and for what walking toward
   white cost instead. */
var PLASMODIUM = [239, 193, 50];
var LAMP       = [255, 240, 176];

/* The live palette. One run's is every run's, but the painter reads these
   rather than the constants above, because applyPalette owns the contrast
   guard and would hand back a lightened tone if PLASMODIUM were ever edited
   to one that does not clear the floors. */
var TINT = PLASMODIUM;
var ACC_CUE = rgba(TINT, '1');
buildLUT(TINT[0], TINT[1], TINT[2]);
/* The vein bands want the same. tintVeins is a hoisted declaration so it is
   callable here, but VEIN_BANDS is a var initialised further down and is
   still undefined at this point — so the whole solve is deferred to the
   applyPalette() call at the bottom of the file rather than run inline.
   Nothing renders before that (render returns early without S.exp), so this
   is belt and braces against a future caller that paints earlier. */

/* The two backgrounds the accent has to survive: the page ground, and the dark
   ink the primary button paints ITSELF onto the accent. Both are floors rather
   than a window, but they are different floors, so both get measured. */
/* The agar as it is actually painted. This used to be the old near-black
   ground; the threshold transfer lightened it, and a contrast solve measured
   against a floor the dish no longer has is solving the wrong problem. */
var DISH_L = relLum(AGAR[0], AGAR[1], AGAR[2]);
var PAGE_L = relLum(11, 13, 12);
var INK_L  = relLum(20, 23, 13);

/* Build the plate's palette from PLASMODIUM, and prove it legible before the
   painter is allowed to use it.

   What has to stay legible is not the sheet but the RIM: the down-light side
   of the body's outline, at the bottom of the inner shadow, is the darkest
   tissue the dish draws, and if that falls into its background the organism
   loses its edge. What it must stay distinguishable FROM is not bare agar but
   FLOOR_STACKS — each hazard field, under the brush's full cue or retract
   haze, with the slime mat's film on the unoccupied side. Additive light
   lands on rim and ground alike (the painter shades only the body's
   contribution, so the two ride the same base), and equal addition always
   compresses a contrast ratio, so the floor is demanded where the adding is
   worst. Checking bare agar alone used to leave the rim under 3:1 in the
   lit-field corner, which is exactly where a player is most likely to be
   cueing. The lit tone clears 7:1, and the unshaded sheet clears 3:1 a
   fortiori.

   Every number here was tuned when the SEED picked the hue, which meant the
   palette could be any colour at all and the walk was load-bearing: without
   it, four in ten seeds shaded their own outline below the floor, and deep
   blues needed the shadow DEPTH trimmed on top of that. One fixed yellow
   needs none of it — the shipped tone clears the rim at 3.98 against its
   worst ground and the trunk clears the dish at 12.8, and both loops below
   fall through on their first pass. They are kept as a GUARD rather than as a
   mechanism: PLASMODIUM is a constant someone will one day want to nudge, and
   the difference between nudging it and breaking the dish should be a fact
   the code checks rather than one a reviewer remembers. When it holds, the
   tone is used exactly as written — no round trip through HSL — so the plate
   is painted in the constant and not in a re-derivation of it.

   The lit tone MUST be the one the widest band actually strokes, and is read
   off VEIN_BANDS rather than written here as a number so it cannot drift from
   it. A brighter stand-in does not make the test safer: the agar is dark, so
   contrast RISES with brightness, and asking 7:1 of a tone brighter than
   anything drawn is a weaker demand than asking it of the band itself. That
   was a live gap and not a theoretical one — this solve once tested a mix of
   0.70 against a band drawn at 0.48, which held by luck rather than by
   construction, and the moment the band came down to 0.40 the trunk fell
   under 7:1 for a fifth of all seeds while the solve went on reporting
   success. Reading the band closes it by construction.

   VEIN_BANDS is a var initialised further down the file, so this reads it at
   CALL time, not definition time. The fallback covers a future caller that
   runs before the file has finished evaluating rather than any path that
   exists today. */
function hotBandK() {
  return VEIN_BANDS ? VEIN_BANDS[VEIN_BANDS.length - 1].hot : 0.44;
}
function applyPalette() {
  var hsl = rgbToHsl(PLASMODIUM[0], PLASMODIUM[1], PLASMODIUM[2]);
  var hue = hsl[0], sat = hsl[1], l = hsl[2];
  var hotK = hotBandK();
  var rimHolds = function (v, k) {
    var m = 1 - k, i2, st, bl;
    for (i2 = 0; i2 < FLOOR_STACKS.length; i2++) {
      st = FLOOR_STACKS[i2];
      bl = relLum(
        Math.min(255, Math.round(st.base[0] + (v[0] - AGAR[0]) * m)),
        Math.min(255, Math.round(st.base[1] + (v[1] - AGAR[1]) * m)),
        Math.min(255, Math.round(st.base[2] + (v[2] - AGAR[2]) * m)));
      if (contrast(bl, st.gL) < 3.0 || contrast(bl, st.gmL) < 3.0) return false;
    }
    return true;
  };
  var vein = PLASMODIUM, hot = mixLamp(vein, hotK), i;
  for (i = 0; i < 24; i++) {
    if (rimHolds(vein, ISH_DEPTH) &&
        contrast(relLum(hot[0], hot[1], hot[2]), DISH_L) >= 7.0) break;
    if (l >= 0.72) break;
    l = Math.min(0.72, l + 0.02);
    vein = hslToRgb(hue, sat, l);
    hot = mixLamp(vein, hotK);
  }
  ishDepth = ISH_DEPTH;
  while (ishDepth > 0 && !rimHolds(vein, ishDepth)) {
    ishDepth = Math.max(0, ishDepth - 0.02);
  }
  TINT = vein;
  buildLUT(vein[0], vein[1], vein[2]);
  tintVeins(vein);
  ACC_CUE = rgba(vein, '1');

  /* The UI accent is a separate solve: it is text on the page ground AND the
     background under dark button ink, so it has to clear both at 4.5:1. The
     tissue tone clears both, so the accent IS the tissue tone and the chrome
     around the dish is the colour of what is in it. */
  var ul = l, ui = vein;
  for (i = 0; i < 30; i++) {
    var uL = relLum(ui[0], ui[1], ui[2]);
    if (contrast(uL, PAGE_L) >= 4.5 && contrast(uL, INK_L) >= 4.5) break;
    if (ul >= 0.92) break;
    ul = Math.min(0.92, ul + 0.02);
    ui = hslToRgb(hue, sat, ul);
  }
  setAccent(hexOf(ui), hexOf(mixLamp(ui, 0.75)));
}

function setAccent(a, hotA) {
  var root = document.documentElement;
  if (!root || !root.style || !root.style.setProperty) return;
  root.style.setProperty('--slime', a);
  root.style.setProperty('--slime-hot', hotA);
}

/* ------------------------------------------------------------
   4. run state
   ------------------------------------------------------------ */
var S = {
  exp: null, idx: -1, seed: 0,
  running: false, paused: false, over: false,
  simT: 0, peak: 0, cues: 0,
  /* the cue reserve, in reserve-seconds, and how long the brush was actually
     held — both stepped at a fixed DT inside the frame loop, so a replay of a
     recorded run rebuilds them exactly rather than approximately */
  cueRes: 0, cueHeld: 0,
  /* how this run was reached, and for a daily, which day's plate it was —
     see VIA_* by the daily */
  via: 0, viaDay: 0,
  /* whether this run actually wrote anything to the save — read by the verdict
     heading, which used to announce "Result logged" for every win including
     the ones deliberately not logged */
  logged: false,
  nodeProg: null, nodeDone: null, nodeIdle: null, engulfed: 0,
  hab: 0, habPeak: 0, habBuilt: -1, fused: false,
  dietP: 0, dietC: 0, dietDoomedT: 0,
  growAcc: 0, starveAcc: 0,
  refineT0: -1,   /* sim time the settling began, or -1 — see EXP-03's refine */
  flowAcc: 0, streamAcc: 0,
  shockNext: 0, shockActive: false, shockWarn: false, shocksSurvived: 0,
  shockWarned: -1, shockCycle: 0, shockPeriod: 0,
  quinTime: 0, slow: 1, anticipated: false,
  /* the ACTIVE wall and hazard lists. They start as the experiment's own and
     are replaced by dish events, which is why they live here: the experiment
     object is shared across every run of that dish and must not be written to. */
  walls: [], hazards: [], eventIdx: 0,
  ambientAt: 0, scriptIdx: 0,
  note: '', failReason: ''
};

/* Hoisted out of S for the inner loop: sense() runs three times per agent per
   step and reads this on every call, so it is a plain number, not a lookup. */
var SLIME_W = 0;
/* The scar's weight for the agent currently being sensed, set once by the
   loop before its three calls: SCAR_W for cytoplasm, zero for a tip. Carried
   here rather than passed as a fourth argument for the same reason SLIME_W
   is — three calls an agent a step is the hottest path in the file. */
var scarW = 0;

/* ------------------------------------------------------------
   5. building the dish
   ------------------------------------------------------------ */
function fillRect(arr, val, rx, ry, rw, rh) {
  var x0 = clamp(Math.round(rx), 0, GW), y0 = clamp(Math.round(ry), 0, GH);
  var x1 = clamp(Math.round(rx + rw), 0, GW), y1 = clamp(Math.round(ry + rh), 0, GH);
  for (var y = y0; y < y1; y++) {
    var row = y * GW;
    for (var x = x0; x < x1; x++) arr[row + x] = val;
  }
}

/* Masks from the ACTIVE lists, not the experiment's. Startup and a mid-run
   dish event are the same operation — stamp from scratch — so they share it
   rather than one of them growing its own half-correct copy. */
function stampMasks() {
  var i;
  wallM.fill(0); hazM.fill(0);
  for (i = 0; i < S.walls.length; i++) {
    var w = S.walls[i];
    fillRect(wallM, 1, w[0], w[1], w[2], w[3]);
  }
  for (i = 0; i < S.hazards.length; i++) {
    var hz = S.hazards[i];
    fillRect(hazM, hz.type === 'q' ? 2 : (hz.type === 'l' ? 3 : 1), hz.x, hz.y, hz.w, hz.h);
  }
}

/* Everything downstream of the walls: distance along open agar, then the
   static field built from it. A few SPFA sweeps, so it runs at dish setup and
   at event times and nowhere else. */
function rebuildGeo(e) {
  nodeDist = [];
  for (var nq = 0; nq < e.nodes.length; nq++) nodeDist.push(geodesicFrom(e.nodes[nq]));
  buildFood();
}

function buildDish(e) {
  /* A NEW dish, not the next step of the old one — so the next frame has to
     rebuild rather than wait its turn under REBUILD_EVERY. Marking the field
     dirty alone is not enough: the run is already S.running by this point and
     dirtyFrames starts the count at zero, so the first frame of every run took
     the deferred branch and drew the PREVIOUS run's field image and cached
     vein paths over the new dish (a black frame on the very first run). One
     frame, but a deterministic one — and longest on exactly the slow devices
     the deferral exists to help. Priming the counter makes the next render
     due immediately. */
  fieldDirty = true;
  dirtyFrames = REBUILD_EVERY;
  resetVeinTemporal();
  trail.fill(0); tmpF.fill(0); stalkF.fill(0); foodF.fill(0);
  cueF.fill(0); retF.fill(0); slimeF.fill(0); knotF.fill(0); traceF.fill(0);
  flowF.fill(0); condF.fill(0); scarF.fill(0);
  fedF.fill(0); fedB.fill(0); padF.fill(0); padB.fill(0);
  bodyF.fill(0); bodyB.fill(0); linkF.fill(0); shadeF.fill(0);
  nodeAt.fill(-1);
  feedAt.fill(-1);

  var i, y, x;

  stampMasks();

  /* A dish can arrive already smelling searched — the control condition, where
     the mat is there but the culture did not lay it. */
  if (e.preSlime) {
    for (i = 0; i < e.preSlime.length; i++) {
      var pr = e.preSlime[i];
      fillRect(slimeF, 1, pr[0], pr[1], pr[2], pr[3]);
    }
  }

  for (var ni = 0; ni < e.nodes.length; ni++) {
    var nd = e.nodes[ni];
    var fr = nd.r * FEED_R, fr2 = fr * fr, r2 = nd.r * nd.r;
    var y0 = clamp((nd.y - fr) | 0, 0, GH), y1 = clamp((nd.y + fr + 1) | 0, 0, GH);
    var x0 = clamp((nd.x - fr) | 0, 0, GW), x1 = clamp((nd.x + fr + 1) | 0, 0, GW);
    for (y = y0; y < y1; y++) {
      var dy = y - nd.y, row = y * GW;
      for (x = x0; x < x1; x++) {
        var dx = x - nd.x, d2 = dx * dx + dy * dy;
        if (d2 <= r2) nodeAt[row + x] = ni;
        /* Nearest flake wins an overlap, so two flakes close enough for their
           pads to meet do not hand the further one an agent to hold. */
        if (d2 <= fr2) {
          var was = feedAt[row + x];
          if (was < 0) feedAt[row + x] = ni;
          else {
            var ox = x - e.nodes[was].x, oy = y - e.nodes[was].y;
            if (d2 < ox * ox + oy * oy) feedAt[row + x] = ni;
          }
        }
      }
    }
  }
  rebuildGeo(e);
}

/* A dish event: the plate is re-cut, or a lamp comes on, part-way through the
   run. The replacement lists become the active ones, everything derived from
   them is rebuilt, and anything standing where a wall now is does not survive
   being enclosed by it. */
function applyEvent(e, ev) {
  /* Geodesics and food answer only to walls, so a hazard-only event — and
     the sweeping dishes fire a dozen of them — pays for a mask restamp and
     a static-field rebuild, not for re-flooding every node's distance
     field in the middle of a step. */
  if (ev.walls) {
    S.walls = ev.walls;
    if (ev.hazards) S.hazards = ev.hazards;
    stampMasks();
    var k = 0;
    while (k < nAgents) {
      var ci = (ay[k] | 0) * GW + (ax[k] | 0);
      if (wallM[ci]) {
        if (occ[ci]) occ[ci]--;
        nAgents--;
        /* atip travels with the rest of the agent. Left behind, the agent
           moved down into this slot inherited the flag of the one the wall
           just killed — a stray tip in the middle of the body for the fork
           pool to spend growth on, and a whisker drawn where there is no
           front, until the next step's frontier test corrected it.

           And astv with it, for the same reason and with no frontier test to
           correct it afterwards: the adrift clock is the only per-agent state
           nothing recomputes, so a survivor that inherits a dead agent's
           clock is reabsorbed early or late by up to ADRIFT_TIME on the
           strength of a wall appearing somewhere else in the dish. */
        ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents];
        atip[k] = atip[nAgents]; astv[k] = astv[nAgents]; aoff[k] = aoff[nAgents]; aidle[k] = aidle[nAgents]; agoal[k] = agoal[nAgents];
        continue;
      }
      k++;
    }
    rebuildGeo(e);
  } else if (ev.hazards) {
    S.hazards = ev.hazards;
    stampMasks();
    rebuildStatic();
  }
  if (ev.note) logLine(ev.note, !!ev.hi);
}

/* Geodesic distance from a node, flooding only through open agar. A radial
   field points its gradient straight through walls, which packs the front into
   dead ends; distance along the corridors is what makes a maze solvable — and
   is what "finds the shortest path" is supposed to mean. SPFA-style sweep: the
   inQ flag keeps each cell queued at most once, so the ring buffer is bounded. */
var DIAG = Math.SQRT2;
function geodesicFrom(nd) {
  gdist.fill(Infinity);
  inQ.fill(0);
  var head = 0, tail = 0, CAP = NCELL + 1;
  var x, y, i;
  var y0 = clamp((nd.y - nd.r) | 0, 0, GH), y1 = clamp((nd.y + nd.r + 1) | 0, 0, GH);
  var x0 = clamp((nd.x - nd.r) | 0, 0, GW), x1 = clamp((nd.x + nd.r + 1) | 0, 0, GW);
  for (y = y0; y < y1; y++) {
    for (x = x0; x < x1; x++) {
      i = y * GW + x;
      if (wallM[i]) continue;
      var ddx = x - nd.x, ddy = y - nd.y;
      if (ddx * ddx + ddy * ddy > nd.r * nd.r) continue;
      gdist[i] = 0;
      if (!inQ[i]) { inQ[i] = 1; bfsQ[tail] = i; tail = (tail + 1) % CAP; }
    }
  }
  while (head !== tail) {
    i = bfsQ[head]; head = (head + 1) % CAP; inQ[i] = 0;
    var d = gdist[i];
    var cx = i % GW, cy = (i / GW) | 0;
    for (var oy = -1; oy <= 1; oy++) {
      var ny = cy + oy;
      if (ny < 0 || ny >= GH) continue;
      for (var ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        var nx2 = cx + ox;
        if (nx2 < 0 || nx2 >= GW) continue;
        var j = ny * GW + nx2;
        if (wallM[j]) continue;
        var nd2 = d + ((ox && oy) ? DIAG : 1);
        if (nd2 < gdist[j]) {
          gdist[j] = nd2;
          if (!inQ[j]) { inQ[j] = 1; bfsQ[tail] = j; tail = (tail + 1) % CAP; }
        }
      }
    }
  }
  return Float32Array.from(gdist);
}

/* Static food attractant. Per node: a long reach along open agar plus a sharp core.
   Combined with max(), NOT sum() — summing radial falloffs turns a ring of
   nodes into a well at its centre, which pins the inoculation in place.
   Rebuilt whenever a node is engulfed: spent food stops dominating the
   gradient, so the front moves on to what it has not eaten yet. */
/* Share of a flake's food still there: 1 at first contact, 0 once done. The
   one number the hold on a flake and its pull in the field both run on. */
function foodLeft(ni) {
  return S.nodeDone[ni] ? 0 : 1 - S.nodeProg[ni];
}
var foodBuiltQ = new Int8Array(16);   // progress step each flake's field was built at

function buildFood() {
  /* Chemotaxis reach, in cells of open agar. This is the game's main dial: it
     is how far the organism can find food BY ITSELF. Set it wide and the dish
     solves itself with no player at all; this is short enough that only the
     nearest flake is smellable and everything beyond has to be led there.
     Read it together with FOODW: reach says where food is felt at all, FOODW
     says how loudly against the agent's own trail, and it is deliberately
     quiet — the front should brush into food, not be aimed at it. */
  /* Per-dish reach, because the dishes ask different questions. The default is
     short: the flake has to be brushed into, not homed in on. EXP-02 and EXP-04
     are premised on the food being smelled from across the plate — the maze is
     only a maze if there is something to head for, and the bitter bridge's own
     script says everything past the strips smells like dinner — so those two
     widen it and put the difficulty in the walls and the quinine instead. */
  var e = S.exp, FALL = e.reach || 34;
  foodF.fill(0);
  for (var ni = 0; ni < e.nodes.length; ni++) {
    var dm = nodeDist[ni];
    if (!dm) continue;
    /* A spent node keeps a short, shallow pull: enough to hold the plasmodium
       on it as a refuge, not enough to outbid fresh food further away. Giving
       it the full reach made the gradient point back at food already eaten. */
    var left = foodLeft(ni);
    var fall = SPENT_FALL + (FALL - SPENT_FALL) * left;
    var amp = SPENT_FOOD + (1 - SPENT_FOOD) * left;
    /* the core bonus runs down in HEIGHT, not radius: the geodesic is 0 over
       the whole disc, so a shrinking radius left the bonus at its full 0.85
       everywhere on the flake until the radius reached zero and it went in
       one step — the very jump this taper is here to remove */
    var core = e.nodes[ni].r * 2.4, coreAmp = 0.85 * left;
    for (var i = 0; i < NCELL; i++) {
      var d = dm[i];
      if (d >= fall) continue;
      var v = amp * (1 - d / fall);
      if (d < core) v += coreAmp * (1 - d / core);
      if (v > foodF[i]) foodF[i] = v;
    }
    foodBuiltQ[ni] = Math.floor((1 - left) * FOOD_Q);
  }
  rebuildStatic();
}

/* statF folds together everything static for this frame's sensing:
   food attraction, hazard repulsion (quinine scaled by habituation), walls. */
function rebuildStatic() {
  fieldDirty = true;
  var qs = HAZ_QUIN * (1 - S.hab * 0.92);
  /* Light and heat are the same aversion with different scenery: a dish that
     wants a gentler or fiercer field says so once and both follow. */
  var hs = (S.exp && S.exp.heatRepel != null) ? S.exp.heatRepel : HAZ_HEAT;
  for (var i = 0; i < NCELL; i++) {
    var v = foodF[i] * FOODW;
    var h = hazM[i];
    if (h === 1 || h === 3) v -= hs;
    else if (h === 2) v -= qs;
    if (wallM[i]) v += WALL_PEN;
    statF[i] = v;
  }
  S.habBuilt = S.hab;
}

/* ------------------------------------------------------------
   6. agents
   ------------------------------------------------------------ */
function inoculate(e) {
  fieldDirty = true;
  nAgents = 0;
  var n = Math.min(e.start, MAXA);
  /* The drop fills outward from the inoculation point through CONNECTED open
     agar, one agent per cell. A plain disk of the needed radius would cross
     maze walls and seed agents in corridors the culture has never reached
     (EXP-02's radius spans two baffles); a flood-fill cannot start anywhere
     it could not physically flow.

     The flood finds the cells; it does not ORDER them. It used to — one
     agent per cell in breadth-first order — and a breadth-first flood over
     four neighbours grows a Manhattan ball, which is a diamond: every dish
     began as a rotated square of tissue, plain to see the moment the drop
     was drawn as its own edge. So the flood gathers INOC_OVER times the
     cells the drop needs, those are sorted by their true distance from the
     inoculation point (ties by index, so the order is fixed), and the drop
     is the nearest of them: a disc where the agar is open, and where it is
     not, the round part of one that the walls allow. */
  occ.fill(0);
  var seen = new Uint8Array(GW * GH);
  var q = new Int32Array(GW * GH);
  var qh = 0, qt = 0, want = Math.min(GW * GH, (n * INOC_OVER) | 0);
  var s = (e.inoc.y | 0) * GW + (e.inoc.x | 0);
  q[qt++] = s; seen[s] = 1;
  while (qh < qt && qt < want) {
    var ci0 = q[qh++];
    var w0 = ci0 - 1, e0 = ci0 + 1, n0 = ci0 - GW, s0 = ci0 + GW;
    var cx0 = ci0 % GW, cy0 = (ci0 / GW) | 0;
    if (cx0 < 1 || cy0 < 1 || cx0 >= GW - 1 || cy0 >= GH - 1 || wallM[ci0]) continue;
    if (!seen[w0]) { seen[w0] = 1; q[qt++] = w0; }
    if (!seen[e0]) { seen[e0] = 1; q[qt++] = e0; }
    if (!seen[n0]) { seen[n0] = 1; q[qt++] = n0; }
    if (!seen[s0]) { seen[s0] = 1; q[qt++] = s0; }
  }
  var order = Array.prototype.slice.call(q.subarray(0, qt));
  var icx = e.inoc.x, icy = e.inoc.y;
  var d2 = function (c) { var dx = (c % GW) + 0.5 - icx, dy = ((c / GW) | 0) + 0.5 - icy; return dx * dx + dy * dy; };
  order.sort(function (a, b) { var da = d2(a), db = d2(b); return da < db ? -1 : da > db ? 1 : a - b; });
  for (var oi = 0; oi < order.length && nAgents < n; oi++) {
    var ci = order[oi];
    var cx = ci % GW, cy = (ci / GW) | 0;
    if (cx < 1 || cy < 1 || cx >= GW - 1 || cy >= GH - 1 || wallM[ci]) continue;
    /* jitter clear of the cell edges so Float32 rounding cannot carry the
       stored position into a neighbouring cell (see the movement fround note) */
    ax[nAgents] = cx + 0.05 + rnd() * 0.9;
    ay[nAgents] = cy + 0.05 + rnd() * 0.9;
    var si = (ay[nAgents] | 0) * GW + (ax[nAgents] | 0);
    if (!wallM[si] && !occ[si]) {
      occ[si] = 1;
      ah[nAgents] = rnd() * Math.PI * 2;
      atip[nAgents] = 0;
      astv[nAgents] = 0; aoff[nAgents] = 0; aidle[nAgents] = 0; agoal[nAgents] = 0;
      nAgents++;
    }
  }
}
/* how many times the drop's own cell count the flood gathers before the
   sort: enough that a disc's worth of nearest cells is always among them
   in an open dish (a diamond of 2n cells holds the disc of n), with room
   for the cells a wall takes away */
var INOC_OVER = 3;

/* Place a daughter at (nx, ny) heading nh, if that cell will take one. */
/* `tip` says whether the daughter is being put at the FRONT or into the body,
   and the caller has to say, because emit() cannot tell. It used to mark every
   daughter a tip on the reasoning that a daughter is a front by definition —
   true of a fork, false of a thickening spawn, which lands in the middle of
   the culture with a random heading. Nothing corrected it until the frontier
   test ran on the next step, and a step can spawn many times: a thickening
   daughter born early in one growth loop was an eligible fork parent for the
   rest of it, so the atip filter that fork selection was just rewritten around
   could be handed exactly the interior agent it exists to exclude. The
   renderer would draw it a whisker for a frame, too. */
function emit(nx, ny, nh, tip) {
  if (nAgents >= MAXA) return false;
  if (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1) return false;
  var ci = (ny | 0) * GW + (nx | 0);
  /* respect the exclusion at birth too: a spawn landing on top of a sibling
     is a stack the movement rule then has to unpick, and at a fork (where
     growth is busiest) that is precisely where the mesh wants room */
  if (wallM[ci] || occ[ci]) return false;
  ax[nAgents] = Math.fround(nx); ay[nAgents] = Math.fround(ny); ah[nAgents] = nh;
  atip[nAgents] = tip ? 1 : 0;
  astv[nAgents] = 0; aoff[nAgents] = 0; aidle[nAgents] = 0; agoal[nAgents] = 0;
  occ[ci]++;
  nAgents++;
  return true;
}

/* Fork a tip. Best-of-K sampling picks a candidate that is actually AT the
   front — an agent buried in a saturated trunk has nowhere to branch to, and
   spending the growth budget on one produces a fatter tube instead of a new
   filament. Food and the player's cue still bias which front gets the
   cytoplasm, so a cue held out on open agar draws branches toward it. */
/* Draws taken looking for a tip to fork. Tips are a small minority — measured
   across a run, four to eighteen per cent of the population, since only the
   frontier of the culture is a frontier — so a handful of uniform draws mostly
   comes back with none and the branching budget falls through to thickening
   instead. At one in ten, five draws find a tip 41% of the time and twenty
   find one 88%, which is the difference between a culture that branches and
   one that mostly just fattens. It is only a few dozen extra draws per spawn
   against roughly five per agent per step, so the cost is nothing. */
var FORK_DRAWS = 20;

function forkTip() {
  var best = -1, bestV = -1e9;
  for (var t = 0; t < FORK_DRAWS; t++) {
    var k = (rnd() * nAgents) | 0;
    /* Ask whether it IS a tip, rather than inferring it from the trail under
       it. That inference — anything below a trail of 36 — predates the tip
       flag and had gone quietly backwards: a supplied tip lays a heavy tube as
       it advances, so it often stands on MORE trail than the threshold allows,
       while a detached scrap out on clean agar stands on almost none. The test
       was therefore rejecting the fronts it wanted and admitting the interior
       and the strays, and the budget went on daughters spawned somewhere in
       the middle of the culture that had no filament to extend. */
    if (!atip[k]) continue;
    var ci = ((ay[k] | 0) * GW + (ax[k] | 0));
    var v = foodF[ci] + cueF[ci] * 0.8;
    if (v > bestV) { bestV = v; best = k; }
  }
  if (best < 0) return false;

  var h = ah[best], x = ax[best], y = ay[best];
  var side = rnd() < 0.5 ? 1 : -1;
  if (rnd() < BRANCH_APEX) {
    /* apical split: the tip stops being one tip and becomes two, so the
       PARENT turns as well. Splitting only the daughter leaves the trunk
       running dead ahead and reads as a twig, not a bifurcation. */
    var a = BRANCH_A * (0.7 + rnd() * 0.6);
    if (!emit(x + Math.cos(h + a * side) * 1.2, y + Math.sin(h + a * side) * 1.2, h + a * side, 1)) return false;
    ah[best] = h - a * side * 0.85;
    return true;
  }
  /* lateral branch: a daughter leaves the flank and the parent runs on */
  var b = BRANCH_LAT * (0.75 + rnd() * 0.5) * side;
  return emit(x + Math.cos(h + b) * 1.4, y + Math.sin(h + b) * 1.4, h + b, 1);
}

/* Thicken instead: new cytoplasm appears where the food is and where the
   player is asking for it, so holding a cue fattens that part of the network
   rather than only steering the tips that happen to be inside the brush. */
/* Draws are up from three, because the candidate now has to pass a test as
   well as win a comparison and a draw that fails it is not a candidate at
   all. Eight keeps the chance of finding no supported agent negligible on a
   dish where most of the population is inside the body, which is every dish. */
var THICK_DRAWS = 8;

function thicken() {
  var best = -1, bestV = -1e9;
  for (var t = 0; t < THICK_DRAWS; t++) {
    var k = (rnd() * nAgents) | 0;
    var ci = ((ay[k] | 0) * GW + (ax[k] | 0));
    /* Thicken the ORGANISM, not whatever the draw happened to land on. The
       parent is only a position: the daughter is placed up to four cells away
       in a random direction, so a parent adrift on bare agar spends the
       growth budget putting a second scrap next to the first one, and a
       clump of them is self-sustaining — each new arrival is another
       eligible parent. Requiring the parent to be standing on tube is what
       makes new cytoplasm arrive INTO the body, which is where a plasmodium
       makes it and the only place it has to put it.

       fork selection already has this for free: a fork parent must be a tip,
       and a tip must have passed the supply test. This is the same condition
       stated for the other half of the budget. */
    if (trail[ci] < ADRIFT_T) continue;
    var v = foodF[ci] + cueF[ci] * 0.8;
    if (v > bestV) { bestV = v; best = k; }
  }
  if (best < 0) return false;
  for (var tries = 0; tries < 12; tries++) {   /* a pad is dense; six tries stalled growth in it */
    /* within a cell and a half of the parent, which is on tube: new
       cytoplasm arrives ON the line, not in the hole beside it */
    if (emit(ax[best] + (rnd() - 0.5) * 4, ay[best] + (rnd() - 0.5) * 4, rnd() * Math.PI * 2, 0)) return true;
  }
  return false;
}

function spawnAgent() {
  if (nAgents <= 0 || nAgents >= MAXA) return;
  if (rnd() < BRANCH_P) { if (forkTip()) return; }
  thicken();
}

/* Draw a scrap home. Best-of-K over the population for a cell that is
   actually tube, then a free cell near it — the same shape as thicken(),
   because it is the same act: cytoplasm arriving into the body. Returns
   false if nowhere would take it, in which case the caller reabsorbs it the
   only other way there is.

   The occupancy grid is fixed up here rather than by the caller, because
   this runs inside the agent loop and the loop's own bookkeeping has already
   accounted for the cell the scrap is leaving. */
function drawHome(k, from) {
  var best = -1, bestV = ADRIFT_T;
  for (var t = 0; t < ADRIFT_DRAWS; t++) {
    var c = (rnd() * nAgents) | 0;
    if (c === k) continue;
    var cc = (ay[c] | 0) * GW + (ax[c] | 0);
    if (mainOK && !mainC[cc]) continue;   /* home is the body, not an island */
    var v = trail[cc];
    if (v > bestV) { bestV = v; best = c; }
  }
  if (best < 0) return false;
  /* twice ADRIFT_R: home is beside a trunk, whose core is mostly occupied,
     and a scrap that finds no free cell in six tries is deleted by the
     caller — the flank of a trunk is still the line */
  for (var tries = 0; tries < 6; tries++) {
    var nx = ax[best] + (rnd() - 0.5) * 4 * ADRIFT_R;
    var ny = ay[best] + (rnd() - 0.5) * 4 * ADRIFT_R;
    if (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1) continue;
    var ci = (ny | 0) * GW + (nx | 0);
    if (wallM[ci] || occ[ci]) continue;
    if (occ[from]) occ[from]--;
    occ[ci]++;
    ax[k] = Math.fround(nx); ay[k] = Math.fround(ny);
    ah[k] = rnd() * Math.PI * 2;
    atip[k] = 0; astv[k] = 0; aoff[k] = 0; aidle[k] = 0; agoal[k] = 0;
    return true;
  }
  return false;
}

/* --- one body ---------------------------------------------------------
   A plasmodium is one cell. Every photograph shows filaments, lobes, a
   lattice, a margin — and no islands: a branch that finds nothing is drawn
   back through the tube it came out on, and a piece that is cut off dies
   or is a different organism. The step had no idea of this. An island of
   agents stands on its own trail, its trail feeds its own tips, and it
   lives for good; the plate filled with crescents and beads that were once
   the far end of a hairline whose near end had decayed.

   So every CONN_EVERY steps the trail field is labelled into 8-connected
   pieces of tube (trail >= CONN_T, not wall), and the piece holding the
   most cytoplasm is the body. An agent that is not a tip and has been off
   the body for CONN_GRACE labellings is drawn back into it — beside a tip
   if there is one, so the biomass a dead end tied up goes to the front,
   else beside the nearest tube. A tip off the body is left alone: it is a
   runner, and runners are the reach. Demoting them was measured (EXP-01,
   seed 12345): reach at step 2400 fell from 188 cells to 137 and the dish
   was not won at 7200 where the runners-free version wins at 4693, against
   the deployed 4471 — with islands at zero either way. What the body test
   takes back is what a runner LEAVES: the followers on a thread that has
   decayed behind them, the beads and crescents, never the runner itself. The draw is rate-limited (REAB_BASE a step plus a
   share of what is off), so an island dissolves over a second or two and
   a large lobe that loses its connection retreats over several rather
   than vanishing, and it keeps its trail where it was, which is what the
   scar and trace fields then fade: a branch withdrawn, not deleted.

   CONN_T is low on purpose. A hairline is the organism — a followed thread
   carries a few units of trail for tens of cells, a lone runner's thread
   holds 2 for about thirty cells behind it before it falls away — so 2.0
   keeps every filament that is still a filament and breaks exactly the
   ones that have already broken. ADRIFT_T (18) is a different question,
   whether an agent is standing ON tube, and stays what it is.

   mainOK guards the cold start and a body that has genuinely split in two:
   with less than half the cytoplasm in the largest piece there is no body
   to draw into, and nothing is drawn. Labelling is a BFS over the grid
   every CONN_EVERY steps, so a step pays about a tenth of a pass. */
var CONN_EVERY = 10;    // steps between labellings
var CONN_T     = 2.0;   // trail that counts as tube for connectivity
/* Six seconds, not two. A bead in a corridor is often the stalled train of
   a runner that turned, and the next runner through picks it up and lays
   the vein over it — the deployed build got through EXP-06 and EXP-10 that
   way. At two seconds the beads were gone before that happened: EXP-10
   unwon at 12000 on two seeds against deployed wins near 10000, EXP-06
   1.4x slower. At six, EXP-10 9592/9829 against 9795/10182 and EXP-06
   7547/8755 against 7626/6376, with islands of five or more agents at 0 to
   3 per sample on EXP-01 and each gone within the six seconds. */
var CONN_GRACE = 36;    // labellings off the body before a scrap is drawn home (6 s)
var REAB_BASE  = 1;     // scraps drawn home per step, plus one per 256 off
var mainC   = new Uint8Array(NCELL);
var connLab = new Int32Array(NCELL);
var connQ   = new Int32Array(NCELL);
var aoff    = new Uint16Array(MAXA);   // labellings this agent has spent off the body
/* Withdrawal from a dead end. A filament that found nothing is, in the
   organism, drawn back through its own tube and the tube collapses behind
   the cytoplasm; here the followers sat on it for as long as their own
   deposit kept it a tube, which was indefinitely. Tube is idle when the
   trail says tube and the conductivity says nothing is moving through it;
   an agent that has stood on idle tube for IDLE_GRACE labellings, and is
   not a tip, not feeding and not streaming, is drawn to the nearest tip,
   rate-limited like the reabsorption. What the branch leaves is its stalk,
   at STALK_W: the faint line of where the filament went, fading. */
var IDLE_C     = 0.12;   // conductivity below which tube is idle
var IDLE_GRACE = 18;     // labellings on idle tube before withdrawal (3 s)
var IDLE_BASE  = 2;      // withdrawn per step, plus one per 256 idle
var aidle   = new Uint16Array(MAXA);
var idleCursor = 0;
var agoal   = new Int16Array(MAXA);    // streaming: 1 + the node this agent is bound for, or 0
var mainOK  = false;
var reabCursor = 0;

function labelMain() {
  var i, lab = 0, bestLab = 0, bestOcc = 0;
  for (i = 0; i < NCELL; i++) connLab[i] = 0;
  for (var s = 0; s < NCELL; s++) {
    if (connLab[s] || wallM[s] || trail[s] < CONN_T) continue;
    lab++;
    var head = 0, tail = 0, sum = 0;
    connQ[tail++] = s; connLab[s] = lab;
    while (head < tail) {
      var c = connQ[head++];
      sum += occ[c];
      var cx = c % GW, cy = (c / GW) | 0;
      for (var dy = -1; dy <= 1; dy++) {
        var ny = cy + dy;
        if (ny < 0 || ny >= GH) continue;
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = cx + dx;
          if (nx < 0 || nx >= GW) continue;
          var nc = ny * GW + nx;
          if (connLab[nc] || wallM[nc] || trail[nc] < CONN_T) continue;
          connLab[nc] = lab; connQ[tail++] = nc;
        }
      }
    }
    if (sum > bestOcc) { bestOcc = sum; bestLab = lab; }
  }
  for (i = 0; i < NCELL; i++) mainC[i] = (bestLab && connLab[i] === bestLab) ? 1 : 0;
  mainOK = bestLab > 0 && nAgents > 0 && bestOcc * 2 >= nAgents;
  for (i = 0; i < nAgents; i++) {
    var ac = (ay[i] | 0) * GW + (ax[i] | 0);
    if (mainC[ac]) aoff[i] = 0;
    else if (aoff[i] < 65535) aoff[i]++;
    if (trail[ac] >= ADRIFT_T && condF[ac] < IDLE_C && !atip[i] && feedAt[ac] < 0) {
      if (aidle[i] < 65535) aidle[i]++;
    } else aidle[i] = 0;
  }
}

/* Starvation, and WHERE it takes the cytoplasm from. Uniformly at random is
   the obvious reading of "the culture is losing biomass" and it is the wrong
   shape: a trunk carrying the culture's traffic holds most of the agents in
   the dish, so a uniform draw takes most of its losses out of exactly the
   tubes the organism is depending on, and the thin dead ends — which are all
   of the biomass the organism has no use for — are culled in proportion to
   how little of it they are. Starving that way thins the whole network
   evenly, which is not what withdrawal looks like on a plate: a plasmodium
   under-fed pulls its cytoplasm OUT of the branches that lead nowhere and
   back into the ones that carry, and the network gets coarser rather than
   fainter.

   Best-of-K says that in four lines, and what it reads is the CONDUCTIVITY
   under the candidate rather than the trail. The trail is how much tube is
   here; conductivity is whether the tube is carrying anything, which is the
   question a withdrawal has to answer — a fat vein that has stopped
   streaming is exactly the cytoplasm a starving plasmodium recovers first,
   and a thin one that is working is the last. Reading the trail instead gets
   that backwards on both counts.

   The draws stay uniform, so this is a bias rather than a rule and a trunk
   agent is not immune; what changes is that the losses land, on average,
   where nothing is moving. K is small on purpose — at six draws the weakest
   candidate is well below the median without the cull becoming a
   deterministic sweep, which would strip one part of the dish bare. */
var KILL_DRAWS = 6;

/* ---- retraction feeds the front ----
   A sheet has a reach. Its rim needs cytoplasm along the whole perimeter to
   keep its tips supplied, and a fixed population can only stretch so far
   before the rim thins under TIP_FEED and the front stops. Measured at every
   supply threshold that gives the sheet shape, EXP-01's front stalls near
   ninety cells with thousands of agents still alive, and its food is at two
   hundred. The old organism escaped that limit by not being a sheet: a lone
   thread costs nothing to extend, so it reached food that a front cannot,
   and every dish was tuned to that.

   A plasmodium reaches distant food as a sheet all the same, and does it by
   WITHDRAWING: cytoplasm streams out of the interior and into the front,
   and what it leaves behind is the lattice — the dense margin with the open
   net behind it that every photograph of the organism shows. Nothing in the
   step did that. Starvation culled the idlest agent and that was all; the
   biomass it took was simply gone.

   Drawing the idlest agents to the front every step was tried for that and
   measured: it thinned the interior and extended the reach of a sheet by
   nothing (p95 107 against 93 with no recruitment and 122 with starvation
   softened), and worse, it fed tips that were no longer attached to
   anything — a recruit lands beside a tip and lays the tube the supply test
   then reads, so an island with a tip on it was kept alive by the very
   mechanism meant to feed the front. It is gone. What is left of it is
   drawFront(), which is how a scrap drawn back into the body arrives: beside
   a tip, heading the way the front is going, so retraction feeds the front
   in the one case where cytoplasm is actually moving — see CONN_T. */
/* The tips, listed once per step on the first tick that needs them. Tips are
   one or two per cent of the population, so drawing at random over the whole
   of it found one about one time in six (measured: 3157 of 5279 attempts
   came back empty) and the mechanism ran at a third of its stated strength.
   A list costs one pass over the agents on a step that recruits at all. */
var recTips = new Int32Array(MAXA);
var recN = -1;             // -1: not built this step
function listTips() {
  recN = 0;
  for (var i = 0; i < nAgents; i++) {
    if (!atip[i]) continue;
    if (mainOK && !mainC[(ay[i] | 0) * GW + (ax[i] | 0)]) continue;   /* the body's tips */
    recTips[recN++] = i;
  }
}

/* The idlest agent: best-of-K on conductivity, front priced up — the same
   choice killWeakest made, lifted out so retraction and culling pick the
   same cytoplasm. Returns -1 on an empty dish. */

/* Move agent k to the front: beside a tip, in a free cell. False if no tip
   could be found or nothing near one would take it, in which case the
   caller culls instead — a body with no front has nothing to feed. */
function drawFront(k) {
  if (recN < 0) listTips();
  if (recN === 0) return false;
  var from = (ay[k] | 0) * GW + (ax[k] | 0);
  /* The NEAREST of a handful of tips, not any tip. Cytoplasm withdrawn
     from a dead end flows back down the tube it came out on and into the
     front nearest it — which in a corridor is the runner still working
     that corridor, so the vein it is laying is what gets fed. Sent to a
     random tip anywhere on the plate, the corridor dishes ran slower than
     the deployed build (EXP-10 unwon at 12000 on two seeds where deployed
     won near 10000); this is the difference. Best-of-eight is enough to
     land in the right corridor without being a search. */
  for (var t = 0; t < 4; t++) {
    var c = -1, cd = 1e9;
    for (var d = 0; d < 8; d++) {
      var cand = recTips[(rnd() * recN) | 0];
      if (cand === k) continue;
      var ddx = ax[cand] - ax[k], ddy = ay[cand] - ay[k], dist = ddx * ddx + ddy * ddy;
      if (dist < cd) { cd = dist; c = cand; }
    }
    if (c < 0) continue;
    for (var tries = 0; tries < ADRIFT_DRAWS; tries++) {
      var nx = ax[c] + (rnd() - 0.5) * 2 * ADRIFT_R;
      var ny = ay[c] + (rnd() - 0.5) * 2 * ADRIFT_R;
      if (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1) continue;
      var ci = (ny | 0) * GW + (nx | 0);
      if (wallM[ci] || occ[ci]) continue;
      if (occ[from]) occ[from]--;
      occ[ci]++;
      ax[k] = Math.fround(nx); ay[k] = Math.fround(ny);
      ah[k] = ah[c];           /* arrives heading the way the front is going */
      atip[k] = 0; astv[k] = 0; aoff[k] = 0; aidle[k] = 0; agoal[k] = 0;
      return true;
    }
  }
  return false;
}

function killWeakest() {
  if (nAgents <= 0) return;
  var k = -1, worst = 1e9;
  for (var t = 0; t < KILL_DRAWS; t++) {
    var c = (rnd() * nAgents) | 0;
    var ci2 = (ay[c] | 0) * GW + (ax[c] | 0);
    var v = condF[ci2];
    /* The front is where cytoplasm is being spent on purpose, and it stands
       on ground with no history at all, so it reads at the bottom of this
       scale for a reason that is not slack. Both halves of the front are
       priced up rather than excluded — a tip, and the trace a tip leaves for
       the cytoplasm following it in — so the search is protected while there
       is anything genuinely idle to take instead. */
    if (atip[c]) v += 1;
    if (agoal[c]) v += 1;           /* streaming: on a bare tube by design */
    if (traceF[ci2] > 0) v += 0.5;
    if (v < worst) { worst = v; k = c; }
  }
  if (k < 0) return;
  var ci = (ay[k] | 0) * GW + (ax[k] | 0);
  if (occ[ci]) occ[ci]--;          /* every removal path decrements */
  nAgents--;
  ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents];
  atip[k] = atip[nAgents]; astv[k] = astv[nAgents]; aoff[k] = aoff[nAgents]; aidle[k] = aidle[nAgents]; agoal[k] = agoal[nAgents];
}

/* The idlest agent, by the same reading killWeakest uses, without the kill:
   who to move when the settling moves cytoplasm rather than losing it. */
function pickIdle() {
  var k = -1, worst = 1e9;
  for (var t = 0; t < KILL_DRAWS; t++) {
    var c = (rnd() * nAgents) | 0;
    var ci2 = (ay[c] | 0) * GW + (ax[c] | 0);
    var v = condF[ci2];
    if (atip[c]) v += 1;
    if (agoal[c]) v += 1;           /* streaming: on a bare tube by design */
    if (traceF[ci2] > 0) v += 0.5;
    if (v < worst) { worst = v; k = c; }
  }
  return k;
}

/* Cytoplasm streaming into the tube. Best-of-K over random cells for the
   strongest tube cell nobody is standing on — trail at least TUBE_T, free,
   not wall — and the idle agent is put there. Aimed at the busiest AGENT it
   piled the settling culture onto its flakes and let every long tube between
   them empty and lapse: the plate ended as pads with short bridges between
   the close pairs and nothing across it. Aimed at the strongest empty tube
   cell, the tubes the mesh built are kept manned in order of their strength,
   the weakest lapse first, and a tube between two distant flakes is a tube
   with cytoplasm in it. Mass is conserved; what moves is where it stands. */
var TUBE_T = 20;

/* Geodesics over TUBE, for the streaming: from each flake, the distance to
   every cell along cells that carry at least TUBE_T / 2 of trail, 8-connected.
   The open-agar geodesic sent streaming agents straight across bare plate,
   which laid specks and no tube; on the tube network the shortest route
   between two flakes is a route the mesh already built, and walking it is
   what keeps it. Rebuilt every TUBE_EVERY steps while a dish settles, so the
   routes follow the tubes that survive. -1 where no tube reaches. */
var TUBE_EVERY = 30;
var tubeDist = [];
function rebuildTubeGeo(e) {
  var i, ni, half = TUBE_T * 0.5;
  for (ni = 0; ni < e.nodes.length; ni++) {
    var D = tubeDist[ni];
    if (!D) { D = new Int32Array(NCELL); tubeDist[ni] = D; }
    D.fill(-1);
    var nd = e.nodes[ni], head = 0, tail = 0;
    var x0 = Math.max(0, (nd.x - nd.r) | 0), x1 = Math.min(GW - 1, (nd.x + nd.r) | 0);
    var y0 = Math.max(0, (nd.y - nd.r) | 0), y1 = Math.min(GH - 1, (nd.y + nd.r) | 0);
    for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
      var dx = xx - nd.x, dy = yy - nd.y;
      if (dx * dx + dy * dy > nd.r * nd.r) continue;
      var c0 = yy * GW + xx;
      if (wallM[c0]) continue;
      D[c0] = 0; connQ[tail++] = c0;
    }
    while (head < tail) {
      var c = connQ[head++], d = D[c] + 1;
      var cx = c % GW, cy = (c / GW) | 0;
      for (var oy = -1; oy <= 1; oy++) {
        var ny = cy + oy; if (ny < 0 || ny >= GH) continue;
        for (var ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          var nx = cx + ox; if (nx < 0 || nx >= GW) continue;
          var nc = ny * GW + nx;
          if (D[nc] >= 0 || wallM[nc] || trail[nc] < half) continue;
          D[nc] = d; connQ[tail++] = nc;
        }
      }
    }
  }
}
function drawTube(k) {
  var best = -1, bestV = TUBE_T;
  for (var t = 0; t < 16; t++) {
    var c = (rnd() * NCELL) | 0;
    if (wallM[c] || occ[c]) continue;
    var v = trail[c];
    if (v > bestV) { bestV = v; best = c; }
  }
  if (best < 0) return false;
  var from = (ay[k] | 0) * GW + (ax[k] | 0);
  if (occ[from]) occ[from]--;
  occ[best]++;
  ax[k] = Math.fround((best % GW) + 0.5); ay[k] = Math.fround(((best / GW) | 0) + 0.5);
  ah[k] = rnd() * Math.PI * 2;
  atip[k] = 0; astv[k] = 0; aoff[k] = 0; aidle[k] = 0; agoal[k] = 0;
  return true;
}

/* sample the combined desirability field (nearest cell) */
function sense(x, y) {
  if (x < 0 || y < 0 || x >= GW || y >= GH) return WALL_PEN;
  var i = (y | 0) * GW + (x | 0);
  var v = trail[i] + statF[i] + cueF[i] * CUEW - retF[i] * RETW;
  /* Slime aversion, where a dish has asked for it. The organism must not flee
     its own living tubes: a vein carrying traffic is home, and the mat only
     repels where the trail has gone thin — abandoned ground, not occupied
     ground. One multiply-add, and a single comparison when the dish is off. */
  if (SLIME_W > 0) {
    var sm = slimeF[i];
    if (sm > 0) {
      var occupied = trail[i] * 0.125;
      if (occupied > 1) occupied = 1;
      v -= SLIME_W * sm * (1 - occupied);
    }
  }
  /* The filamental trace, scaled by the same occupancy the slime mat uses,
     with the opposite sign: fresh front pulls, established tube does not need
     to. Where a dish runs both, a filament crossing old ground reads as trace
     minus slime — a pioneer can lead followers back across searched ground,
     but only while it is actually out there leading. */
  var tf = traceF[i];
  if (tf > 0) {
    var est = trail[i] * 0.125;
    if (est > 1) est = 1;
    v += TRACE_W * tf * (1 - est);
  }
  /* And the oldest thing the ground remembers, on the same scaling again: a
     channel the organism cut and later withdrew from is still the cheapest
     way back into that quarter of the dish. Weighted well under the trail in
     a live tube — the scar is a lean, not an instruction — but over
     SENS_NOISE, so on bare agar it is a bias an agent can actually follow
     rather than a rounding error. Where a dish runs the mat as well the two
     read against each other, which is the right argument: searched ground
     repels, but searched ground the culture built a tube through does not.

     Read by the cytoplasm and NOT by the front, which is what scarW carries
     in from the loop. A scar is a route home; a tip's whole job is to be
     somewhere the organism has not been, and an old vein is the one thing
     that cannot help it do that. Sensed by everything, the field is a
     standing pull back toward the body that competes with the food gradient
     for exactly the agents that should be following it — measured, that cost
     EXP-01 17% of its time to solve, with no flake reached by the minute
     mark on any of three seeds where the plate had reached one or two
     before. Silent for tips, the search is unaffected and the followers
     still run home down the channels that are already cut, which was the
     whole point of the field. */
  if (scarW > 0) {
    var sc = scarF[i];
    if (sc > 0) {
      var liv = trail[i] / SCAR_REF;
      if (liv > 1) liv = 1;
      v += scarW * sc * (1 - liv);
    }
  }
  return v;
}

/* ------------------------------------------------------------
   7. field maintenance: diffuse + decay, once per step
   ------------------------------------------------------------ */
function diffuseTrail() {
  var x, y, i, row;
  var sw = DIFF, cw = 1 - 2 * DIFF;
  /* horizontal blur into tmpF */
  for (y = 0; y < GH; y++) {
    row = y * GW;
    for (x = 0; x < GW; x++) {
      i = row + x;
      var l = x > 0 ? trail[i - 1] : trail[i];
      var r = x < GW - 1 ? trail[i + 1] : trail[i];
      tmpF[i] = sw * l + cw * trail[i] + sw * r;
    }
  }
  /* vertical blur back into trail, with decay, and player fields decayed too.

     The floor under the decay is the reinforcement rule, and it is two lines
     because that is all it is: a cell that has been carrying traffic does not
     fall below the tube its traffic maintains. Applied after the decay and
     before the wall test, so a baffle that appeared this step still zeroes
     the cell under it — conductivity is cleared on walls by the slow sweep,
     but the sweep runs one step in eight and the wall test runs every one. */
  for (y = 0; y < GH; y++) {
    row = y * GW;
    var up = y > 0 ? row - GW : row;
    var dn = y < GH - 1 ? row + GW : row;
    for (x = 0; x < GW; x++) {
      i = row + x;
      var v = (sw * tmpF[up + x] + cw * tmpF[i] + sw * tmpF[dn + x]) * DECAY;
      var cd = condF[i];
      if (cd > 0) { var hold = COND_LEVEL * cd; if (v < hold) v = hold; }
      var sk = stalkF[i];
      if (sk > 0) {
        sk *= STALK_HOLD;
        if (sk < 0.05 || wallM[i]) sk = 0;
        stalkF[i] = sk;
        var skf = sk * STALK_W;
        if (v < skf) v = skf;   /* the stalk is a floor under the trail */
      }
      trail[i] = wallM[i] ? 0 : (v < 0.0016 ? 0 : v);
      if (cueF[i] > 0) { var c = cueF[i] * CUE_DECAY; cueF[i] = c < 0.002 ? 0 : c; }
      if (retF[i] > 0) { var q = retF[i] * CUE_DECAY; retF[i] = q < 0.002 ? 0 : q; }
    }
  }
}

/* ------------------------------------------------------------
   7b. junction lobes
   ------------------------------------------------------------ */
/* The marks fade far slower than a player field and are not blurred at all: a
   lobe is a place, and a place does not spread. A crossroads the network has
   abandoned loses its lobe over a few seconds, which is about how long the
   tubes into it take to go.

   Swept every KNOT_EVERY steps rather than folded into the field loop that
   runs every step. It looks like it belongs there — it is one multiply per
   cell, next to the two the player fields already take — and putting it there
   cost a sixth of diffuseTrail, which is a seventh of the whole simulation:
   109,200 cells is a lot of cells to touch sixty times a second for a field
   whose half-life is measured in seconds and which is empty nearly
   everywhere. Eight steps of decay applied once every eight steps is the same
   curve sampled more coarsely, on a quantity nothing reads for an edge. */
var KNOT_EVERY = 8;
var KNOT_FADE = Math.pow(KNOT_HOLD, KNOT_EVERY);
/* The trace rides the same coarse clock, for the same reason: a field whose
   half-life is seconds does not need sixty samples of its own curve a second,
   and this way the two slow fields cost one sweep between them. */
var TRACE_FADE = Math.pow(TRACE_HOLD, KNOT_EVERY);
/* The conductivity and the scar ride it too, and for them it is not merely an
   economy: both are deliberately slow — a tube commits over seconds, a scar
   over minutes — so sampling their curves sixty times a second would be
   measuring a quantity nothing reads for an edge, sixty times more often than
   it changes. All four fields, one pass. */
function slowFields() {
  for (var i = 0; i < NCELL; i++) {
    var wall = wallM[i];
    var kf = knotF[i];
    if (kf > 0) {
      kf = wall ? 0 : kf * KNOT_FADE;
      knotF[i] = kf < 0.004 ? 0 : kf;
    }
    var tf = traceF[i];
    if (tf > 0) {
      tf = wall ? 0 : tf * TRACE_FADE;
      traceF[i] = tf < 0.01 ? 0 : tf;
    }
    /* Flux this sweep, through the saturating feedback, low-passed. The early
       out is what makes this affordable: the organism occupies a small share
       of a hundred thousand cells, so on most of the dish this is two loads
       and a test and nothing else happens. */
    var fl = flowF[i], cd = condF[i];
    if (fl > 0 || cd > 0) {
      var q = fl * COND_Q, drive = 0;
      /* the return signal: traffic on the connection counts for more, and
         a cell in the connection's shade loses conductivity faster than an
         idle one would — both from the previous sweep's answer, which is the
         one that exists when this cell is read. See the return-signal block. */
      var lk = linkF[i];
      if (lk > 0) q *= 1 + FED_GAIN * lk;
      if (q > 0) { var q2 = q * q; drive = q2 / (1 + q2); }
      cd += COND_RATE * (drive - cd);
      if (shadeF[i]) cd *= 1 - FED_SHADE;
      cd = wall ? 0 : (cd < 0.002 ? 0 : cd);
      condF[i] = cd;
      flowF[i] = 0;
    }
    /* And the scar: laid only under a tube the network is MAINTAINING, off
       the conductivity computed just above rather than off the trail, so the
       two are one statement — which tubes the culture is keeping, and where
       it has kept them. Lifted on a clock long enough that a dish keeps its
       skeleton for the length of a run. */
    var sc = scarF[i];
    if (cd >= SCAR_COND) {
      sc += SCAR_DEP;
      scarF[i] = wall ? 0 : (sc > 1 ? 1 : sc);
    } else if (sc > 0) {
      sc = wall ? 0 : sc * SCAR_FADE;
      scarF[i] = sc < 0.004 ? 0 : sc;
    }
  }
  fedSweep();
}

/* The return signal's own pass: source the body, relax both signals through
   the cytoplasm, take their product against the label, and work out what
   stands beside the connection. Runs at the end of every slow sweep, after
   the conductivity has been brought up to date. See the return-signal block
   in section 1 for what each step is for.

   The relaxation is double-buffered rather than in place. In place, a cell
   would read neighbours already updated this pass on one side and not yet
   on the other, and the front would run a whole row a pass in the scan
   direction and one cell in the other — a signal that travels faster
   south-east than north-west is not a signal, and a field that depends on
   the scan order is one the determinism guarantee (section 0b) cannot
   cover. Two arrays and a swap cost nothing the sim notices.

   Both signals in the one pass, since they ride the same cytoplasm: the
   cell test, the row offsets and the neighbour indices are shared, and
   that halves what the pass costs (measured: 7.1 ms a step with the two
   fields swept separately against 5.7 on main, and the two relaxations
   were most of the difference). Almost all of the dish is agar carrying no
   signal, and the loop pays for that as it does for the other slow fields:
   a load and a test per field. The neighbour reads are spent only on
   cytoplasm. */
function fedRelax() {
  var fs = fedF, fd = fedB, ls = padF, ld = padB, bs = bodyF, bd = bodyB;
  var i, x, y, row;
  for (y = 0; y < GH; y++) {
    row = y * GW;
    var up = y > 0 ? row - GW : -1;
    var dn = y < GH - 1 ? row + GW : -1;
    for (x = 0; x < GW; x++) {
      i = row + x;
      var v = fs[i], b = bs[i];
      if (trail[i] < FED_BODY || wallM[i]) {
        /* off cytoplasm: a signal has nothing to ride and dies */
        if (v > 0) { v *= FED_OFF; fd[i] = v < 0.004 ? 0 : v; } else fd[i] = 0;
        if (b > 0) { b *= FED_OFF; bd[i] = b < 0.004 ? 0 : b; } else bd[i] = 0;
        ld[i] = ls[i];
        continue;
      }
      /* the strongest neighbour of each, and which — the find's label
         follows its own. Straight neighbours first at the straight step,
         then the diagonals at the diagonal one, and the neighbour order is
         fixed, so a tie is broken the same way on every machine, which is
         what the label needs to be deterministic. */
      var m = 0, mi = -1, mb = 0, n, j;
      if (up >= 0) { j = up + x; n = fs[j]; if (n > m) { m = n; mi = j; } n = bs[j]; if (n > mb) mb = n; }
      if (x > 0) { j = i - 1; n = fs[j]; if (n > m) { m = n; mi = j; } n = bs[j]; if (n > mb) mb = n; }
      if (x < GW - 1) { j = i + 1; n = fs[j]; if (n > m) { m = n; mi = j; } n = bs[j]; if (n > mb) mb = n; }
      if (dn >= 0) { j = dn + x; n = fs[j]; if (n > m) { m = n; mi = j; } n = bs[j]; if (n > mb) mb = n; }
      m *= FED_STEP; mb *= FED_STEP;
      var md = 0, mdi = -1, mdb = 0;
      if (up >= 0) {
        if (x > 0) { j = up + x - 1; n = fs[j]; if (n > md) { md = n; mdi = j; } n = bs[j]; if (n > mdb) mdb = n; }
        if (x < GW - 1) { j = up + x + 1; n = fs[j]; if (n > md) { md = n; mdi = j; } n = bs[j]; if (n > mdb) mdb = n; }
      }
      if (dn >= 0) {
        if (x > 0) { j = dn + x - 1; n = fs[j]; if (n > md) { md = n; mdi = j; } n = bs[j]; if (n > mdb) mdb = n; }
        if (x < GW - 1) { j = dn + x + 1; n = fs[j]; if (n > md) { md = n; mdi = j; } n = bs[j]; if (n > mdb) mdb = n; }
      }
      md *= FED_STEP_D; mdb *= FED_STEP_D;
      if (md > m) { m = md; mi = mdi; }
      if (mdb > mb) mb = mdb;
      /* and the receiving cell's thickness: a thin cell passes a little less on */
      var tw = trail[i];
      if (tw < FED_THICK) { tw = 1 - FED_THIN * (1 - tw / FED_THICK); m *= tw; mb *= tw; }
      /* the find, with its label: the largest product the path has crossed,
         this cell included — the body field read is the one being read,
         not the one being written, so it is the same for every cell
         however the scan is ordered. A cell keeping its own value keeps its
         label, raised to its own product if the body signal under it has
         risen since, so the ratio is bounded by one rather than clamped. */
      var lb, pr;
      v *= FED_FADE;
      if (m > v) {
        fd[i] = m < 0.004 ? 0 : m;
        lb = ls[mi]; pr = m * b;
      } else {
        fd[i] = v < 0.004 ? 0 : v;
        lb = ls[i]; pr = v * b;
      }
      ld[i] = pr > lb ? pr : lb;
      /* the body, no label */
      b *= FED_FADE;
      if (mb > b) b = mb;
      bd[i] = b < 0.004 ? 0 : b;
    }
  }
  /* swap: the written halves become the fields */
  fedF = fd; fedB = fs; padF = ld; padB = ls; bodyF = bd; bodyB = bs;
}

function fedSweep() {
  var i, x, y, pass, row;
  /* The body's source: cytoplasm within FED_CORE_R of the inoculation point
     is the body, at 1, every sweep. */
  var inoc = S.exp.inoc, cx = inoc.x | 0, cy = inoc.y | 0, r2 = FED_CORE_R * FED_CORE_R;
  var y0 = cy - FED_CORE_R, y1 = cy + FED_CORE_R, x0 = cx - FED_CORE_R, x1 = cx + FED_CORE_R;
  if (y0 < 0) y0 = 0;
  if (y1 > GH - 1) y1 = GH - 1;
  if (x0 < 0) x0 = 0;
  if (x1 > GW - 1) x1 = GW - 1;
  for (y = y0; y <= y1; y++) {
    row = y * GW;
    for (x = x0; x <= x1; x++) {
      var dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2 && trail[row + x] >= FED_BODY && !wallM[row + x]) bodyF[row + x] = 1;
    }
  }
  for (pass = 0; pass < FED_PASSES; pass++) fedRelax();

  /* The connection: the product of the two signals against the label, to
     the FED_SHARP. Cells with either signal missing, or no label, are not
     on any connection and get 0; a ratio over 1 — a label stamped on the
     far side of a pad — is a trunk and is clamped to one. The power is
     FED_SHARP_LOG squarings rather than Math.pow, for two reasons that
     point the same way: pow was a fifth of the whole sweep (measured: 2.3
     ms of 11.4), and it is not specified to the bit across engines, where
     an IEEE multiply is — so this is the form the determinism guarantee
     (section 0b) can actually make. */
  for (i = 0; i < NCELL; i++) {
    var f = fedF[i], lk = 0;
    if (f > 0) {
      var b = bodyF[i], pd = padF[i];
      if (b > 0 && pd > 0) {
        lk = f * b / pd;
        if (lk > 1) lk = 1;
        for (var sq = 0; sq < FED_SHARP_LOG; sq++) lk *= lk;
        if (lk < 0.001) lk = 0;
      }
    }
    linkF[i] = lk;
  }

  /* Where the trunk is within FED_R: a mask of link >= FED_HI dilated by two
     separable passes, a row pass into bodyB and a column pass into fedB,
     like rnear in buildVeins — both spare halves are free until the next
     sweep. Each pass spreads only from cells that have something to spread,
     and each remembers how far along its row (its column) it has already
     written, so a run of trunk cells writes each cell of the band once
     rather than FED_R times over. The mask is the same union of windows
     either way; this is only the cost of stamping it. */
  var nearH = bodyB, near = fedB, lastX, xa, xb, ya, yb, xx, yy;
  nearH.fill(0);
  for (y = 0; y < GH; y++) {
    row = y * GW;
    lastX = -1;
    for (x = 0; x < GW; x++) {
      if (linkF[row + x] < FED_HI) continue;
      xa = x - FED_R; xb = x + FED_R;
      if (xa <= lastX) xa = lastX + 1;
      if (xb > GW - 1) xb = GW - 1;
      for (xx = xa; xx <= xb; xx++) nearH[row + xx] = 1;
      lastX = xb;
    }
  }
  near.fill(0);
  fedLastY.fill(-1);
  for (y = 0; y < GH; y++) {
    row = y * GW;
    for (x = 0; x < GW; x++) {
      if (nearH[row + x] === 0) continue;
      ya = y - FED_R; yb = y + FED_R;
      if (ya <= fedLastY[x]) ya = fedLastY[x] + 1;
      if (yb > GH - 1) yb = GH - 1;
      for (yy = ya; yy <= yb; yy++) near[yy * GW + x] = 1;
      fedLastY[x] = yb;
    }
  }

  /* And the shade: cytoplasm beside the trunk that is well off it, and not
     the body's own source. Read by the next sweep's conductivity update and
     by the deposit rule until then. */
  for (i = 0; i < NCELL; i++) {
    var sh = 0;
    if (near[i] !== 0 && linkF[i] < FED_LOW && trail[i] >= FED_BODY && !wallM[i]) {
      x = i % GW; y = (i - x) / GW;
      var ddx = x - cx, ddy = y - cy;
      if (ddx * ddx + ddy * ddy > r2) sh = 1;
    }
    shadeF[i] = sh;
  }
}

/* The ring the junction test reads: KNOT_N unit directions at KNOT_R, as
   cell offsets and as the vectors they point along. Built once, because GW
   does not change.

   Twelve samples rather than eight, and the count is set by the radius
   rather than by taste. A tube is about three cells wide, so two samples more
   than three cells apart around the ring can straddle one and report a gap
   where an arm is — at a radius of five and a half cells, eight samples sit
   four and a quarter apart and miss tubes; twelve sit under three apart and
   do not. The radius itself is what sets how big a lobe can get, since a
   swelling that reaches the ring stops reading as a junction. */
var KNOT_OFF = new Int32Array(KNOT_N);
var KNOT_DX = new Float32Array(KNOT_N);
var KNOT_DY = new Float32Array(KNOT_N);
(function buildKnotRing() {
  for (var d = 0; d < KNOT_N; d++) {
    var a = d * Math.PI * 2 / KNOT_N;
    KNOT_DX[d] = Math.cos(a); KNOT_DY[d] = Math.sin(a);
    KNOT_OFF[d] = Math.round(Math.sin(a) * KNOT_R) * GW + Math.round(Math.cos(a) * KNOT_R);
  }
})();

/* Mark a disc of the junction field, rather than adding to it. A junction
   sits still, so an agent that passes the test again a hundred steps later is
   re-stating the same fact rather than reporting a second one, and adding
   would let a busy crossroads climb without limit while a quiet one never
   arrives. Taking the maximum states it once: the mark is how strongly this
   is a junction, and it is the decay, not the arithmetic here, that lets one
   stop being one.

   The bounds are taken with a ceiling and a floor rather than left as the
   floats they are computed from. A loop counter that starts at a fraction
   indexes a typed array at a fraction, and a typed array silently DISCARDS a
   write to a fractional index — the disc drew nothing at all, at any
   strength, with no error anywhere to say so. */
function markDisc(cx, cy, amt, rad) {
  var x0 = Math.ceil(cx - rad), x1 = Math.floor(cx + rad);
  var y0 = Math.ceil(cy - rad), y1 = Math.floor(cy + rad);
  if (x0 < 1) x0 = 1;
  if (y0 < 1) y0 = 1;
  if (x1 > GW - 2) x1 = GW - 2;
  if (y1 > GH - 2) y1 = GH - 2;
  var inv = 1 / rad;
  for (var y = y0; y <= y1; y++) {
    var dy = y - cy, row = y * GW;
    for (var x = x0; x <= x1; x++) {
      var dx = x - cx, d2 = dx * dx + dy * dy;
      if (d2 > rad * rad) continue;
      var i = row + x;
      if (wallM[i]) continue;
      /* smoothstep in from the rim, so a lobe has a shoulder rather than a
         cliff and two overlapping marks read as one mass */
      var u = 1 - Math.sqrt(d2) * inv;
      var v = amt * u * u * (3 - 2 * u);
      if (v > knotF[i]) knotF[i] = v;
    }
  }
}

/* Is this cell a junction or a corner, and if so, mark it. Counts contiguous
   ARMS around the ring: a run of ring samples carrying tube, separated from
   the next run by samples that do not. Three runs is a fork, two close
   together is a corner, two opposite is a tube running through, one run is
   the inside of a sheet and none is bare agar — and the last two are exactly
   the cases that must not grow a lobe. */
function markKnot(ci) {
  var v = trail[ci];
  if (v < KNOT_MIN) return;
  var cx = ci % GW, cy = (ci / GW) | 0;
  var edge = (KNOT_R | 0) + 2;
  if (cx < edge || cy < edge || cx >= GW - edge || cy >= GH - edge) return;

  var arm = KNOT_ARM * v;
  var mask = 0, n = 0, d;
  for (d = 0; d < KNOT_N; d++) {
    var j = ci + KNOT_OFF[d];
    if (!wallM[j] && trail[j] >= arm) { mask |= 1 << d; n++; }
  }
  if (n === 0 || n === KNOT_N) return;

  /* Runs around the ring, and the direction each one points: the sum of the
     unit vectors of its members, which is the arm's own bearing however many
     samples wide it happens to be.

     Traversed from a GAP rather than from sample zero, and it has to be. An
     arm that straddles the wrap — samples eleven and zero, with ten clear —
     is one run, but walked from zero its head arrives before any run has been
     opened and lands in no sum at all, so the arm's bearing is computed from
     whatever tail happens to sit before the wrap. The COUNT survives that (a
     run is tallied where it starts, and a wrapped run starts at its tail), so
     the bug is invisible in whether a junction is found and shows up only in
     where its arms are pointing: the same corner, rotated, scores a different
     separation and can fall the other side of KNOT_BEND. Since n is neither 0
     nor KNOT_N there is always a clear sample to start after, and starting
     there makes every run contiguous. */
  var gap = 0;
  while (mask & (1 << gap)) gap++;
  var arms = 0, a0x = 0, a0y = 0, a1x = 0, a1y = 0;
  for (var t = 1; t <= KNOT_N; t++) {
    d = (gap + t) % KNOT_N;
    if (!(mask & (1 << d))) continue;
    var prev = (mask & (1 << ((d + KNOT_N - 1) % KNOT_N))) !== 0;
    if (!prev) arms++;                       /* a run starts here */
    if (arms === 1) { a0x += KNOT_DX[d]; a0y += KNOT_DY[d]; }
    else if (arms === 2) { a1x += KNOT_DX[d]; a1y += KNOT_DY[d]; }
  }
  if (arms < 2) return;

  var w;
  if (arms >= 3) {
    /* a fork, and the more ways out of it the more cytoplasm parks there */
    w = 0.70 + 0.15 * (arms - 3);
    if (w > 1) w = 1;
  } else {
    /* two arms: a corner only if they leave at an angle. The weight falls to
       nothing as the two straighten into a single tube passing through. */
    var m0 = Math.sqrt(a0x * a0x + a0y * a0y), m1 = Math.sqrt(a1x * a1x + a1y * a1y);
    if (m0 < 1e-4 || m1 < 1e-4) return;
    var cs = (a0x * a1x + a0y * a1y) / (m0 * m1);
    if (cs < -1) cs = -1; else if (cs > 1) cs = 1;
    var sep = Math.acos(cs);
    if (sep > KNOT_BEND) return;
    w = (KNOT_BEND - sep) / KNOT_BEND;
  }
  markDisc(cx, cy, w, KNOT_SPREAD);
}

/* ------------------------------------------------------------
   8. one simulation step
   ------------------------------------------------------------ */
var nodeHits = new Int32Array(16);
var nodeLoad = new Int32Array(16);   // ...and the same counts from the step before

function step() {
  var e = S.exp;
  S.simT += DT;
  fieldDirty = true;

  /* Dish events, at most one a step and strictly in order, before anything
     else reads the masks — so the trail under a wall that has just appeared is
     zeroed by this step's diffusion rather than the next one's. */
  if (e.events && S.eventIdx < e.events.length && S.simT >= e.events[S.eventIdx].t) {
    applyEvent(e, e.events[S.eventIdx]);
    S.eventIdx++;
  }

  diffuseTrail();
  if (stepsRun % KNOT_EVERY === 0) slowFields();
  if (VEIN_TREE && stepsRun % TREE_EVERY === 0) treeGrow();

  var i, k;
  /* Last step's contact counts, kept before this step's are zeroed: the fan
     on a flake needs to know how full it already is, and the only honest
     measure of that is how many agents were standing on the flake when it was
     last counted. Reading the counter this step is building instead would
     make an agent's retention depend on where it sits in the array. */
  for (i = 0; i < nodeHits.length; i++) { nodeLoad[i] = nodeHits[i]; nodeHits[i] = 0; }

  /* --- anticipation (EXP-05) ---
     After two cycles the interval has been felt often enough that the culture
     thickens and slows *before* the air changes, which is the whole Saigusa
     result. One multiplier, read per agent, no per-agent state: eased in across
     the warn window and dropped the instant the shock lands or the window
     passes. Deposit is trimmed alongside it because a slower agent revisits the
     same cell more often — without the trim the tubes bloom rather than thicken. */
  var slow = 1;
  if (e.shocks && e.shock && S.shockWarn && S.shocksSurvived >= 2) {
    var into = clamp((S.simT - (S.shockNext - e.shock.warn)) / e.shock.warn, 0, 1);
    slow = 1 - 0.55 * (into * into * (3 - 2 * into));   /* smoothstep 1 -> 0.45 */
    if (!S.anticipated) {
      S.anticipated = true;
      logLine('the tubes are already thickening. nothing has happened yet.', true);
    }
  } else if (!S.shockWarn) {
    S.anticipated = false;
  }
  S.slow = slow;
  /* Deposit is per unit DISTANCE TRAVELLED, applied below — trail is material
     laid down by cytoplasm flowing through a cell, so an agent that covers a
     twentieth of a cell this step leaves a twentieth of a dose. Charging a
     full dose per STEP instead, which is what this used to do, pays a stalled
     agent the same as a streaming one: an agent crawling on bare agar at
     VOID_SPEED sits in one cell for twenty steps and pumps twenty full doses
     into it, manufacturing a tube out of an agent that has gone nowhere.
     Multiplied across a few thousand wanderers that is a grey wash over the
     whole dish — measured at 96% of cells carrying trail, with no edge to the
     organism anywhere — and a lattice cannot be seen through it.

     This also subsumes the old hand-trimmed deposit under the anticipation
     slow-down. That trim existed because a slower agent revisits the same cell
     more often and the tubes bloomed; per-distance deposit makes revisiting
     cost-free by construction, so what is left here is the thickening the
     Saigusa result actually calls for, stated as itself rather than as a
     correction. */
  var stepSpeed = SPEED * slow;
  var stepDeposit = DEPOSIT * (1 + 0.55 * (1 - slow));

  var shockOn = S.shockActive;
  var shockDmg = e.shock ? e.shock.dmg : 0;
  /* Halved for the same reason as ENGULF_SOFT: an agent wedged in the strip
     used to be immune because it had not moved, and it was those stalled
     agents that racked up the contact time habituation is built from. Now
     they take the damage, so at the old rate the front was culled at the
     bitter edge before it could learn anything — which is the one outcome
     this dish must not have. */
  var quinDmg = 0.011 / PACE * (1 - S.hab);
  var heatDmg = (e.heatDmg == null) ? 0.010 / PACE : e.heatDmg;   /* a dish's own is paced in paceDish */
  var inQuin = 0;

  /* The stranger's culture, hoisted to three numbers so the test in the loop
     is two multiplies and a compare. Everything about fusion is off unless a
     dish has put another organism on the plate. */
  var donor = e.donor;
  var donX = 0, donY = 0, donR2 = 0, donHits = 0;
  if (donor) { donX = donor.x; donY = donor.y; donR2 = donor.r * donor.r; }
  var slimeOn = SLIME_W > 0;

  /* restamp the occupancy counts for this step from where the agents actually
     are — the one line that guarantees the counts cannot drift across frames */
  occ.fill(0);
  for (k = 0; k < nAgents; k++) occ[(ay[k] | 0) * GW + (ax[k] | 0)]++;

  k = 0;
  while (k < nAgents) {
    var x = ax[k], y = ay[k], h = ah[k];

    /* Tip or cytoplasm? Read once, and let it pick the whole sensing regime.
       A tip reaches further, holds its line, and wanders less; an agent inside
       a tube keeps the short-range Jones rule that resolves the mesh. */
    var here = (y | 0) * GW + (x | 0);
    var cf = Math.cos(h), sf = Math.sin(h);
    /* A wall is not open agar, and the trail field cannot say so: diffuseTrail
       zeroes every wall cell, so a bare "is there little trail ahead" test
       reads a baffle as the most inviting frontier in the dish. In EXP-02's
       maze that handed the whole tip regime — the long sensors, the apical
       bias, the heavy tube deposit — to agents pressed against a wall, and
       left them eligible as fork parents, so the growth budget went on
       branches launched into masonry. The dish edge was already excluded; the
       walls inside it need the same test. */
    var lx = x + cf * TIP_LOOK, ly = y + sf * TIP_LOOK;
    var tip = false;
    if (lx >= 0 && ly >= 0 && lx < GW && ly < GH) {
      var li = (ly | 0) * GW + (lx | 0);
      tip = !wallM[li] && trail[li] < TIP_TRAIL;
    }
    /* how well fed: the tube this tip is being supplied through */
    var feed = 0;
    if (tip) {
      /* Read the supply well BEHIND the tube's own leading end. At the
         frontier distance it reads the deposit the tip laid moments ago, so
         supply is whatever the tip most recently did — a loop with itself.
         Deadlocked, it never starts: a slow tip lays a thin tube, a thin tube
         supplies a slow tip, and the front does not move at all (measured: no
         flake reached, at any tip speed). Read further back and it is the
         network's tube being asked about, which is the question. The loop is
         still there at this distance and is now the right one: a filament that
         carries traffic keeps its tube up and stays fed, and a lone runaway's
         tube decays behind it within a second or two and starves it. */
      var bx = x - cf * TIP_BACK, by = y - sf * TIP_BACK;
      if (bx >= 0 && by >= 0 && bx < GW && by < GH) {
        feed = trail[(by | 0) * GW + (bx | 0)] / TIP_FEED;
        if (feed > 1) feed = 1;
      }
      if (feed < TIP_MIN) tip = false;  /* come adrift: cytoplasm, not a front */
      /* a settling culture is not foraging: no new fronts, so the tubes it
         keeps stop sprouting along their edges */
      if (tip && S.refineT0 >= 0) tip = false;
    }
    /* On food, and there is still food there. A front that has arrived stops
       being a front: it has found what it was looking for, and what it does
       next is spread over it. Clearing the tip flag here rather than merely
       slowing the agent is what stops a filament walking out the far side of
       a flake with its long sensors and its heavy tube deposit still on — and
       it takes the agent out of the fork pool at the same time, so the growth
       budget is not spent launching new branches out of the middle of a meal.
       The moment the flake is spent the whole regime lapses and the agents
       standing on it are ordinary cytoplasm again. */
    var fi = feedAt[here];
    var feeding = fi >= 0 && !S.nodeDone[fi];
    if (feeding) tip = false;
    atip[k] = tip ? 1 : 0;
    /* Settling reads further ahead. In the Jones model the sensor offset sets
       the scale of the network a population of agents settles into — a longer
       reach, a coarser net — and that, not a faster decay or a cull, is what
       turns a fine mesh into a few tubes: measured, decay made a haze and a
       cull made the same mesh fainter. */
    var sd = tip ? TIP_SENS : ((S.refineT0 >= 0 && e.refine && e.refine.sense) ? SENS_D * e.refine.sense : SENS_D);
    /* A route home is not information a pioneer can use — see the scar term
       in sense(), which this switches off for the three calls below. */
    scarW = tip ? 0 : SCAR_W;

    var F = sense(x + cf * sd, y + sf * sd);
    var hl = h - SENS_A, hr = h + SENS_A;
    var L = sense(x + Math.cos(hl) * sd, y + Math.sin(hl) * sd);
    var R = sense(x + Math.cos(hr) * sd, y + Math.sin(hr) * sd);
    F += (rnd() - 0.5) * SENS_NOISE;
    L += (rnd() - 0.5) * SENS_NOISE;
    R += (rnd() - 0.5) * SENS_NOISE;
    if (tip) F += TIP_PERSIST;

    /* Jones' rule, exactly: hold the heading when the middle sensor is best,
       turn one rotation-angle toward the better flank otherwise, and turn a
       random way when the middle is worst. The old code randomised the
       straight-ahead case by +/- 27 degrees, which destroys the persistence a
       trail needs to be followed at all — no persistence, no veins. */
    if (F > L && F > R) {
      /* straight on */
    } else if (F < L && F < R) {
      h += (rnd() < 0.5 ? -TURN : TURN);
    } else if (L > R) {
      h -= TURN;
    } else if (R > L) {
      h += TURN;
    }
    h += (rnd() - 0.5) * (tip ? TIP_JIT : JITTER);

    /* Spread to the rim, then stay inside it — the two halves of what a pad
       does, and it needs both. Retention alone was tried first and builds the
       wrong shape: agents arrive along one tube, are turned back toward the
       centre as soon as they pass it, and the pad grows as a sausage lying
       along the direction the front came in from, covering a third of the
       flake with the meal already half eaten. A pad spreads ACROSS its food.
       So the inner half of the flake pushes outward, hardest at the centre,
       and only past the flake's own rim does anything pull back — arrivals
       are carried over the surface rather than piling up where they landed,
       and what they run into at the far side is the hold.

       The hold is scaled by the room left in the pad, which is the release
       valve: at the flake's own area of agents there is nothing holding
       anything and new arrivals pass straight through, so a covered flake
       stops taking cytoplasm the rest of the dish could be using. */
    /* streaming — see the settling block: bound for a flake, down its
       geodesic, along tube where there is tube to walk */
    if (agoal[k]) {
      var gn = agoal[k] - 1, gdm = tubeDist[gn];
      var ghere = gdm ? gdm[here] : -1;
      if (ghere < 0 || ghere === 0) agoal[k] = 0;   /* arrived, or the tube went from under it */
      else {
        var gbest = -1, gbv = ghere;
        for (var gd = 0; gd < 8; gd++) {
          var ga = gd * Math.PI / 4;
          var gx = (x + Math.cos(ga) * 1.5) | 0, gy = (y + Math.sin(ga) * 1.5) | 0;
          if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
          var gv = gdm[gy * GW + gx];
          if (gv >= 0 && gv < gbv) { gbv = gv; gbest = gd; }
        }
        if (gbest >= 0) h = gbest * Math.PI / 4;
        else agoal[k] = 0;   /* no downhill tube from here: let it go */
      }
    }
    if (feeding && !agoal[k]) {
      var fnd = e.nodes[fi];
      var fdx = x - fnd.x, fdy = y - fnd.y;
      var fdd = Math.sqrt(fdx * fdx + fdy * fdy);
      if (fdd > 0.001) {
        var fturn = 0, fwant = 0;
        if (fdd < fnd.r) {
          fturn = FEED_OUT * (1 - fdd / fnd.r);
          fwant = Math.atan2(fdy, fdx);            /* outward */
        } else {
          var frim = fnd.r * FEED_R;
          var fout = (fdd - fnd.r) / (frim - fnd.r);
          if (fout > 1) fout = 1;
          /* ...against a pad sized to the food LEFT, not to the flake: what
             remains of a three-quarters-eaten flake is covered by a quarter
             of the agents the whole took, so the valve opens at a quarter of
             the load, and the pad thins as the food goes instead of
             collapsing when it is gone. Sized, not scaled: scaling the hold
             itself by the food left loosened it on a pad that was nowhere
             near full, and on the fire drill, where the shocks leave a
             hundred agents to finish a flake, the survivors let go of one at
             nine tenths, the progress ran back down (ENGULF_DECAY) and the
             culture starved with nothing engulfed. A pad that is under the
             reduced capacity is held as hard as ever. */
          var fcap = FEED_FILL * Math.PI * fnd.r * fnd.r * (SPENT_FOOD + (1 - SPENT_FOOD) * foodLeft(fi));
          var froom = 1 - nodeLoad[fi] / fcap;
          if (froom > 0) fturn = FEED_HOLD * fout * froom;
          fwant = Math.atan2(-fdy, -fdx);          /* back toward the middle */
        }
        if (fturn > 0) {
          var fda = fwant - h;
          while (fda > Math.PI) fda -= Math.PI * 2;
          while (fda < -Math.PI) fda += Math.PI * 2;
          h += fda * fturn;
        }
      }
    }

    var oldIdx = here;
    /* Speed is how much cytoplasm is behind the tip: established trail, or the
       player shoving it there. A cue does not merely aim the front, it makes it
       flow — which is the difference between leading the culture and watching
       it explore. */
    var lt = trail[oldIdx] / SPEED_REF;
    var lc = cueF[oldIdx] * CUE_FLOW;
    if (lc > lt) lt = lc;
    var spd;
    if (tip) {
      /* A tip's speed is its SUPPLY, and nothing else. Letting the ordinary
         trail term win where it is larger — which is what "give the tip a
         speed floor" quietly does — hands the tip its own tube to stand on:
         it deposits two-odd units into the cell under it every step, reaches
         the full-speed trail level within a dozen steps, and from then on
         runs at full speed no matter what its supply is. That is not a subtle
         effect. Measured over a three-and-a-half-fold change in TIP_SPEED, the
         time for a dish to be solved moved by two seconds, because the
         constant was doing nothing at all.
         The player's cue still overrides it, because pushing the front is what
         the cue is for. */
      /* Supplied, so it advances at the front's own speed. The test above is
         what makes this safe, and it is a threshold rather than a multiplier
         on purpose: scaling speed by supply reads as the careful choice and is
         the deadlock again in slow motion, since a tip slowed by thin supply
         lays a thinner tube still. Connected or not connected; and if it is,
         it moves. */
      var sup = TIP_SPEED;
      if (lc > sup) sup = lc > 1 ? 1 : lc;
      spd = stepSpeed * sup;
    } else {
      spd = stepSpeed * (lt >= 1 ? 1 : VOID_SPEED + (1 - VOID_SPEED) * lt);
      /* A pad has to be able to fill before there is any trail under it to
         buy speed with. Without the floor the first arrivals on a fresh flake
         are on bare agar at VOID_SPEED, creep a twentieth of a cell a step,
         and the fan takes longer to spread across a flake than the flake
         takes to be eaten. */
      if (feeding) { var fs2 = stepSpeed * FEED_SPEED; if (spd < fs2) spd = fs2; }
    }
    /* round to Float32 before anything reads a cell from it: ax/ay are
       Float32Arrays, so an unrounded double a hair under an integer can test
       one cell and then store into the next, leaving the occupancy grid
       reserving a cell the agent is not standing in */
    var nx = Math.fround(x + Math.cos(h) * spd);
    var ny = Math.fround(y + Math.sin(h) * spd);
    var idx = -1, offTube = false;
    var blocked = (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1);
    if (!blocked) {
      idx = (ny | 0) * GW + (nx | 0);
      if (wallM[idx] || (idx !== oldIdx && occ[idx])) blocked = true;
      /* and a follower does not step off the tube onto bare agar — TUBE_LEAVE.
         Read at TUBE_LEAVE on both sides, so a vein's own diffusion ring
         (about 15 beside a 34 core, about 6 one cell further) is still tube
         to leave from and the rule is not two steps deep. Fresh food is open,
         spent food is not — a pad spreads across a flake before it has
         trail; a spent flake's fan is bare agar again. Not during the
         settling, which has its own rules and no tips at all. */
      else if (!tip && idx !== oldIdx && !feeding && S.refineT0 < 0 &&
               trail[oldIdx] >= TUBE_LEAVE && trail[idx] < TUBE_LEAVE &&
               !(feedAt[idx] >= 0 && !S.nodeDone[feedAt[idx]])) { blocked = true; offTube = true; }
    }

    /* Where this agent ends the step, moved or not. A blocked agent used to
       skip everything below — it did not count toward engulfing the flake it
       was standing on, did not taste the quinine it was sitting in, and was
       immune to the dry shock. In a saturated tube most agents are blocked
       most frames, so an agent's fate turned on whether it happened to move
       rather than on where it was. It stays put with a fresh heading, and
       everything the cell does to it still happens; only the trail deposit is
       movement-only, since a stalled agent pumping trail into one cell piles
       up against walls and inside junctions and fattens them into blobs. */
    var cell;
    if (blocked) {
      /* turned by the tube's edge, it turns ALONG the tube, toward the better
         flank: a random heading on a one-cell vein points off it three
         times in four, and a follower re-blocked most steps lays nothing
         and lets the vein it is confined to lapse */
      ah[k] = offTube ? h + (L >= R ? -SENS_A : SENS_A) : rnd() * Math.PI * 2;
      cell = oldIdx;
    } else {
      ax[k] = nx; ay[k] = ny; ah[k] = h;
      if (idx !== oldIdx) { occ[oldIdx]--; occ[idx]++; }
      cell = idx;
    }
    /* Deposit. Movement-only for ordinary cytoplasm, for the reason set out
       above; per-step for a tip, because a tip is a bulge being filled rather
       than a particle being dragged; and per-step for a feeding agent, for
       exactly that reason again. A pad on a flake is dense enough that most
       of its agents are blocked by their neighbours on any given step, and
       charging only the ones that found a free cell builds the pad at a
       fraction of the rate the front is actually delivering cytoplasm at.
       Safe against the grey wash that per-step deposit otherwise causes,
       because it is confined to the footprint of a flake that still has food
       in it — an area the dish itself defines and that stops existing the
       moment the flake is engulfed. */
    var kn = knotF[cell];
    var dep = 0;
    if (feeding) {
      dep = stepDeposit * FEED_LAY;
      /* and the return signal is sourced here: the pad says there is food,
         and the rest of the plate hears it, labelled with the body signal
         standing at this cell so that the connection normalises to this
         flake. Set to a constant and copied from a field neither agent
         writes, so the order the pad's agents are visited in cannot matter. */
      if (fedF[cell] < 1) { fedF[cell] = 1; padF[cell] = bodyF[cell]; }
    }
    else if (!blocked) dep = stepDeposit * ((tip || agoal[k]) ? TIP_LAY : spd / SPEED);
    /* The connection to a flake thickens under the traffic it carries, and
       a cell in its shade thins under its own. Both read the last slow
       sweep's answer, which is the only one there is. */
    if (dep > 0) {
      var lkc = linkF[cell];
      if (lkc > 0) dep *= 1 + FED_LAY_GAIN * lkc;
      if (shadeF[cell]) dep *= 1 - FED_SHADE_DEP;
    }
    /* Traffic through a marked junction leaves more of itself there than
       traffic through a tube does, and leaves it whether or not the agent
       found a free cell to step into: an agent stalled in a crossroads is
       precisely the cytoplasm a crossroads accumulates. Halved when it is
       stalled all the same, so a jam is worth less than a flow. */
    if (kn > 0) dep += stepDeposit * KNOT_GAIN * kn * (blocked ? 0.5 : 1);
    if (dep > 0) {
      var tv = trail[cell];
      if (tv < TRAIL_MAX) trail[cell] = tv + dep > TRAIL_MAX ? TRAIL_MAX : tv + dep;
      if (tip) { var sk0 = stalkF[cell] + dep; stalkF[cell] = sk0 > TRAIL_MAX ? TRAIL_MAX : sk0; }
      /* The same number is the flux. What a cell's traffic delivers IS its
         deposit — that is what the constant is defined as — so the flow
         accumulator is one add here rather than a second measurement of the
         same thing somewhere else. Charged before the ceiling, deliberately:
         a saturated trunk is still carrying the culture's traffic, and
         reading the clamped increment would tell the conductivity rule that
         the busiest tube in the dish had gone quiet. */
      flowF[cell] += dep;
    }

    /* And the lobes: an interior agent, now and then, asks whether it is
       standing at a junction. Only the interior — a tip has no network behind
       it to be a junction of, and a feeding agent is inside a pad, which is
       already the thing a lobe is trying to be. */
    if (!tip && !feeding && rnd() < KNOT_P) markKnot(cell);

    var ni = nodeAt[cell];
    if (ni >= 0) nodeHits[ni]++;

    /* The mat is laid wherever the organism IS, not only where it moved: a
       front jammed against a wall has still been there, and the ground still
       remembers it. */
    if (slimeOn) {
      var sm2 = slimeF[cell] + SLIME_DEP;
      slimeF[cell] = sm2 > 1 ? 1 : sm2;
    }
    /* The trace is laid only by an agent that is a tip RIGHT NOW — supplied,
       at the front, not feeding — and like the mat it is laid whether or not
       the step found a free cell, since a jammed tip is still the front. The
       cross footprint is what makes it findable (see the trace block in
       section 1); the bounds test is for the flood-filled inoculation drop,
       the one placer that can put an agent on the dish's outermost ring. */
    if (tip) {
      var tcx = cell % GW, tcy = (cell / GW) | 0;
      var tv2 = traceF[cell] + TRACE_DEP;
      traceF[cell] = tv2 > 1 ? 1 : tv2;
      if (tcx > 0 && tcy > 0 && tcx < GW - 1 && tcy < GH - 1) {
        var tside = TRACE_DEP * TRACE_SIDE;
        tv2 = traceF[cell - 1] + tside;  traceF[cell - 1]  = tv2 > 1 ? 1 : tv2;
        tv2 = traceF[cell + 1] + tside;  traceF[cell + 1]  = tv2 > 1 ? 1 : tv2;
        tv2 = traceF[cell - GW] + tside; traceF[cell - GW] = tv2 > 1 ? 1 : tv2;
        tv2 = traceF[cell + GW] + tside; traceF[cell + GW] = tv2 > 1 ? 1 : tv2;
      }
    }
    if (donor) {
      var ddx = (cell % GW) - donX, ddy = ((cell / GW) | 0) - donY;
      if (ddx * ddx + ddy * ddy <= donR2) donHits++;
    }

    var dead = false;
    var hz = hazM[cell];
    if (hz === 2) {
      inQuin++;
      if (quinDmg > 0 && rnd() < quinDmg) dead = true;
    } else if (hz === 1 || hz === 3) {
      if (rnd() < heatDmg) dead = true;
    }
    if (!dead && shockOn) {
      var safe = (ni >= 0 && S.nodeDone[ni]);
      if (!safe && rnd() < shockDmg) dead = true;
    }

    if (dead) {
      if (occ[cell]) occ[cell]--;
      nAgents--;
      ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents];
      atip[k] = atip[nAgents]; astv[k] = astv[nAgents]; aoff[k] = aoff[nAgents]; aidle[k] = aidle[nAgents]; agoal[k] = agoal[nAgents];
      continue;
    }

    /* Adrift, and for how long. Last in the body on purpose: it can MOVE the
       agent, and everything above is accounting for the cell it actually
       spent this step in — the flake it touched, the mat it laid, the
       quinine it was standing in. Running it here means nothing downstream
       has to know whether the agent is still where it was.

       A tip is by definition supplied — the feed test at the top has already
       thrown out the ones that are not — and a feeding agent is inside a pad,
       so neither can be a scrap. The trace counts as tube even though it is
       not one: it means a supplied filament came through here in the last
       couple of seconds, so what the agent is standing on is a tube being
       BUILT, which has not reached ADRIFT_T yet and must not be reabsorbed
       for it. Without that the rule has a cascade in it — the followers a
       young filament recruits are killed for arriving before the tube
       thickened, which thins it, which starves the next ones.

       The clock resets on any step that finds any of those, so this only
       fires on cytoplasm that has been attached to nothing for seconds
       together, which is the one thing a single-celled organism cannot have.
       See the adrift block in section 1. */
    if (tip || feeding || trail[cell] >= ADRIFT_T || traceF[cell] > 0) {
      astv[k] = 0;
    } else {
      astv[k] += DT;
      if (astv[k] >= ADRIFT_TIME && !drawHome(k, cell)) {
        /* nowhere to put it — there is no body left to put it in */
        if (occ[cell]) occ[cell]--;
        nAgents--;
        ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents];
        atip[k] = atip[nAgents]; astv[k] = astv[nAgents]; aoff[k] = aoff[nAgents]; aidle[k] = aidle[nAgents]; agoal[k] = agoal[nAgents];
        continue;
      }
    }
    k++;
  }

  /* --- habituation --- */
  if (e.hab) {
    /* habRate scales first-hand learning only. A dish that wants the lesson to
       arrive from somewhere else can turn this down to nearly nothing without
       touching what a donor culture is worth. */
    var hrate = (e.habRate == null) ? 1 : e.habRate;
    if (nAgents > 0 && inQuin > 0) {
      S.quinTime += DT;
      var frac = inQuin / nAgents;
      S.hab = clamp(S.hab + (frac * 1.5 * DT * hrate + 0.020 * DT * hrate) / PACE, 0, 1);
    } else {
      S.hab = clamp(S.hab - 0.012 * DT / PACE, 0, 1);
    }
    if (S.hab > S.habPeak) S.habPeak = S.hab;
    if (Math.abs(S.hab - S.habBuilt) > 0.03) rebuildStatic();
  }

  /* --- fusion with the donor culture ---
     Two plasmodia that touch do not compete; they anastomose, and after that
     there is one organism holding both memories. Eight agents in contact is a
     tube rather than a stray tip, and what crosses is the stranger's
     habituation, ramped rather than granted. */
  if (donor && donHits >= 8) {
    if (!S.fused) {
      S.fused = true;
      logLine('the two fronts meet and do not stop at each other. one tube now, and it remembers things you never did.', true);
    }
    if (S.hab < donor.hab) {
      S.hab = Math.min(donor.hab, S.hab + 0.10 * DT / PACE);
      if (S.hab > S.habPeak) S.habPeak = S.hab;
      if (Math.abs(S.hab - S.habBuilt) > 0.03) rebuildStatic();
    }
  }

  /* --- node engulfment --- */
  var resealT = e.reseal || 0;
  for (i = 0; i < e.nodes.length; i++) {
    if (S.nodeDone[i]) {
      /* A taken node is not taken for good: leave it and the flake skins over.
         The dish that asks for this is asking the culture to HOLD ground, which
         is a different problem from reaching it. */
      if (resealT > 0) {
        if (nodeHits[i] > 0) {
          S.nodeIdle[i] = 0;
        } else {
          S.nodeIdle[i] += DT;
          if (S.nodeIdle[i] >= resealT) {
            S.nodeIdle[i] = 0;
            S.nodeDone[i] = false;
            S.nodeProg[i] = 0.35;
            S.engulfed--;
            buildFood();
            onReseal(i);
          }
        }
      }
      continue;
    }
    S.nodeIdle[i] = 0;
    var hits = nodeHits[i];
    if (hits === 0) {
      /* abandoned ground is lost again: commit to a flake or leave it alone */
      if (S.nodeProg[i] > 0) S.nodeProg[i] = clamp(S.nodeProg[i] - ENGULF_DECAY, 0, 1);
      continue;
    }
    var nd = e.nodes[i];
    /* One saturating curve, scaled to the flake's own area: a front covering
       most of it engulfs at the cap, a thin one crawls, a stray handful barely
       registers. The old form divided by r-squared as well, which made a
       corridor-width front on a big flake take a minute and a half — an
       exploring lattice delivers fewer agents per cell than the old single
       blob did, and the maze became unwinnable on that alone. */
    var soft = ENGULF_SOFT * Math.PI * nd.r * nd.r * (e.engulf || 1);
    /* What is left of a flake is covered by fewer agents than the whole was,
       and the hold thins the pad on it by the same measure (see FOOD_Q): the
       curve's knee follows the food down, so a flake three quarters gone is
       eaten at the rate the pad standing on it can manage, not at the rate
       the full pad would have. Without this the taper fed back on itself —
       a thinner pad ate slower, so the flake stayed longer, so the pad
       thinned further — and the corner dish went unsolved. */
    soft *= SPENT_FOOD + (1 - SPENT_FOOD) * foodLeft(i);
    var gain = MAX_ENGULF_RATE * (hits / (hits + soft));
    S.nodeProg[i] = clamp(S.nodeProg[i] + gain, 0, 1);
    if (S.nodeProg[i] >= 1) {
      S.nodeDone[i] = true;
      S.engulfed++;
      buildFood();
      onEngulf(i);
    }
  }
  /* The field follows progress in FOOD_Q steps, up as a flake is eaten and
     back down as an abandoned one re-forms. Done flakes were rebuilt above. */
  for (i = 0; i < e.nodes.length; i++) {
    if (!S.nodeDone[i] && Math.floor(S.nodeProg[i] * FOOD_Q) !== foodBuiltQ[i]) { buildFood(); break; }
  }

  /* --- one body: what is off it is drawn back in — see CONN_T --- */
  recN = -1;   /* the tip list, if a draw below wants it, is this step's */
  if (stepsRun % CONN_EVERY === 0) labelMain();
  /* not while settling: a network drawn thin between its flakes is many
     pieces by the trail test for a moment at a time, and each is the body */
  if (mainOK && S.refineT0 < 0) {
    var nOff = 0;
    for (i = 0; i < nAgents; i++) if (aoff[i] >= CONN_GRACE) nOff++;
    if (nOff) {
      var quota = REAB_BASE + (nOff >> 8);
      /* the cull, a shock or heat may have shrunk the population since the
         cursor last moved; past the live prefix it would read a dead slot */
      if (reabCursor >= nAgents) reabCursor = 0;
      for (var scanned = 0; scanned < nAgents && quota > 0; scanned++) {
        k = reabCursor;
        reabCursor = (reabCursor + 1 >= nAgents) ? 0 : reabCursor + 1;
        if (aoff[k] < CONN_GRACE || atip[k]) continue;   /* a runner is not a scrap */
        var from = (ay[k] | 0) * GW + (ax[k] | 0);
        if (drawFront(k) || drawHome(k, from)) { aoff[k] = 0; quota--; }
        else break;   /* nowhere on the body would take it this step */
      }
    }
    /* --- withdrawal from idle tube — see IDLE_C --- */
    var nIdle = 0;
    for (i = 0; i < nAgents; i++) if (aidle[i] >= IDLE_GRACE) nIdle++;
    if (nIdle) {
      var iq = IDLE_BASE + (nIdle >> 8);
      if (idleCursor >= nAgents) idleCursor = 0;
      for (var isc = 0; isc < nAgents && iq > 0; isc++) {
        k = idleCursor;
        idleCursor = (idleCursor + 1 >= nAgents) ? 0 : idleCursor + 1;
        if (aidle[k] < IDLE_GRACE || atip[k] || agoal[k]) continue;
        /* the clock is from the last labelling, up to ten steps old: an agent
           that has since walked onto a working tube or a flake is not idle */
        var ic = (ay[k] | 0) * GW + (ax[k] | 0);
        if (trail[ic] < ADRIFT_T || condF[ic] >= IDLE_C || feedAt[ic] >= 0) { aidle[k] = 0; continue; }
        if (drawFront(k)) { aidle[k] = 0; iq--; }
        else break;   /* no tip to feed: the branch stays until there is one */
      }
    }
  }

  /* --- biomass: fed by engulfed nodes, drained otherwise --- */
  var target = Math.min(S.engulfed * e.sustain, e.cap);
  var starveRate = e.starve;
  if (S.refineT0 >= 0 && e.refine) {
    /* settling: the flakes are eaten, the target comes down from the cap to
       `keep` of it over `dur`, and the cull runs fast enough to follow it */
    var rf = Math.min(1, (S.simT - S.refineT0) / e.refine.dur);
    var settle = Math.round(e.cap * (1 - (1 - e.refine.keep) * rf));
    if (settle < target) target = settle;
    var need = e.cap * (1 - e.refine.keep) / e.refine.dur;
    if (need > starveRate) starveRate = need;
    /* and the cytoplasm that is kept streams out of wherever it is idle into
       the strongest tube that has room for it, `flow` agents a second: the
       lapse and the keeping are the same movement — see drawTube */
    if (e.refine.flow) {
      S.flowAcc += e.refine.flow * DT;
      while (S.flowAcc >= 1 && nAgents > 1) {
        var idl = pickIdle();
        if (idl < 0 || !drawTube(idl)) break;
        S.flowAcc -= 1;
      }
      if (S.flowAcc > 4) S.flowAcc = 4;
    }
    /* Shuttle streaming. The organism in the dish moves cytoplasm between
       its flakes through the tubes, and Tero's whole result is that the tubes
       carrying that traffic thicken and the rest lapse. So `stream` agents a
       second, standing on a flake, are sent to another flake: each walks the
       tube network down that flake's geodesic, laying trail as it goes, and
       the shortest tube between any two flakes is the one that gets walked.
       Without it the settling kept pads and the short bridges between close
       pairs and let every tube across the plate go. */
    if (e.refine.stream && e.nodes.length > 1) {
      if (stepsRun % TUBE_EVERY === 0 || !tubeDist.length) rebuildTubeGeo(e);
      S.streamAcc += e.refine.stream * DT;
      while (S.streamAcc >= 1 && nAgents > 0) {
        S.streamAcc -= 1;
        var sk = (rnd() * nAgents) | 0;
        if (agoal[sk]) continue;
        var sc = (ay[sk] | 0) * GW + (ax[sk] | 0);
        var onN = feedAt[sc];
        if (onN < 0) continue;
        var to = (rnd() * (e.nodes.length - 1)) | 0;
        if (to >= onN) to++;
        if (tubeDist[to][sc] < 0) continue;   /* no tube reaches it: nothing to walk */
        agoal[sk] = to + 1;
      }
      if (S.streamAcc > 4) S.streamAcc = 4;
    }
  }
  if (nAgents < target) {
    S.growAcc += (e.grow * DT);
    while (S.growAcc >= 1 && nAgents < target && nAgents < MAXA) { spawnAgent(); S.growAcc -= 1; }
  } else if ((S.simT > e.grace || S.refineT0 >= 0) && nAgents > target) {
    S.starveAcc += (starveRate * DT);
    while (S.starveAcc >= 1 && nAgents > 0) {
      killWeakest();
      S.starveAcc -= 1;
    }
  } else {
    S.growAcc = 0; S.starveAcc = 0;
  }

  if (nAgents > S.peak) S.peak = nAgents;

  /* --- shock cycle (EXP-05) --- */
  if (e.shocks) updateShocks(e);

  /* --- narration --- */
  updateNarration(e);

  /* --- end conditions --- */
  if (nAgents <= 0) { finish(false, 'starved'); return; }
  if (S.refineT0 >= 0) {
    /* settling: the run ends when the settling does, whatever the win test
       says on the way — the ninth depot has been taken, the verdict is the
       network */
    if (S.simT - S.refineT0 >= e.refine.dur) { finish(true, ''); return; }
  } else if (winMet(e)) {
    if (e.refine) {
      S.refineT0 = S.simT;
      if (e.refine.text) logLine(e.refine.text, true);
    } else { finish(true, ''); return; }
  }
  /* the beat is narrative, not mechanical: the outcome was decided the
     moment the flake went in */
  if (S.dietDoomedT && S.simT >= S.dietDoomedT + 4) { finish(false, 'ratio'); return; }
  /* a clock that runs out during the beat does not change what happened:
     the ratio verdict stands once the plate is past saving */
  /* not during settling: the plate is spoken for, the clock has done its job */
  if (e.timeLimit && S.refineT0 < 0 && S.simT >= e.timeLimit) { finish(false, S.dietDoomedT ? 'ratio' : 'timeout'); return; }
}

/* What the dish actually asks for. Every dish asks for the food gate and, if
   it runs a schedule, for cycles; the rest are opt-in and absent by default,
   so a plate that names none of them is gated exactly as it always was. */
function engulfGate(e) {
  if (e.required) {
    for (var i = 0; i < e.required.length; i++) if (!S.nodeDone[e.required[i]]) return false;
    return true;
  }
  if (e.holdWin) return S.engulfed >= e.holdWin;
  return S.engulfed >= e.nodes.length;
}

/* Protein against carbohydrate. A plasmodium offered a choice of foods does
   not maximise either one; it holds a ratio, and holding it is the result. */
function dietMet(e) {
  var d = e.diet;
  if (!d) return true;
  if (S.engulfed < (d.min | 0)) return false;
  if (S.dietC <= 0) return false;
  var ratio = S.dietP / S.dietC;
  return ratio >= d.target - d.tol && ratio <= d.target + d.tol;
}

/* Whether the ratio is past saving. An eaten flake cannot be uneaten and the
   diet totals only ever accumulate, so what this dish can still become is
   exactly the subsets of what is left on the plate — brute-forced here, at
   most 2^8 sums on the dish that asks, and only when a flake goes in. The
   lose text has promised this ending ('the ratio drifted past saving') since
   the dish was written; without this check the only implemented loss was the
   clock, and a run that ate itself unwinnable sat in limbo until timeout.
   A resealing dish is exempt: its flakes return and can be eaten again, so
   the ratio can still be pulled — no subset argument holds there. */
function dietDoomed(e) {
  var d = e.diet;
  if (!d || e.reseal) return false;
  var remP = [], remC = [], reqM = 0, i;
  for (i = 0; i < e.nodes.length; i++) if (!S.nodeDone[i]) {
    var nut = e.nodes[i].nut;
    if (e.required && e.required.indexOf(i) >= 0) reqM |= 1 << remP.length;
    remP.push(nut ? nut[0] : 0); remC.push(nut ? nut[1] : 0);
  }
  var n = remP.length;
  if (n > 16) return false; // too much left to enumerate; call it winnable
  var lo = d.target - d.tol, hi = d.target + d.tol;
  var needK = Math.max(d.min | 0, e.required ? 0 : ((e.holdWin | 0) || e.nodes.length));
  for (var m = (1 << n) - 1; m >= 0; m--) {
    if ((m & reqM) !== reqM) continue;
    var p = S.dietP, c = S.dietC, k = S.engulfed;
    for (var b = 0; b < n; b++) if (m & (1 << b)) { p += remP[b]; c += remC[b]; k++; }
    if (k < needK || c <= 0) continue;
    var r = p / c;
    if (r >= lo && r <= hi) return false;
  }
  return true;
}

function winMet(e) {
  /* The graft dish is ABOUT the fusion: its win text credits the donor, so a
     culture that brute-forced the strips alone has not run the experiment,
     however much far agar it holds. The same honesty for a dish whose win
     text claims its revisions were survived: they have to have happened. */
  if (e.donor && !S.fused) return false;
  if (e.requireEvents && e.events && S.eventIdx < e.events.length) return false;
  return engulfGate(e) && cyclesMet(e) && dietMet(e) && !S.shockActive;
}

/* A dish that runs on a schedule is not won by food alone: the win text claims
   every cycle was survived, so the run has to have actually survived some. */
function cyclesMet(e) {
  var need = e.minShocks | 0;
  return !need || S.shocksSurvived >= need;
}
function cyclesLeft(e) {
  return Math.max(0, (e.minShocks | 0) - S.shocksSurvived);
}

/* One cycle is over — fired or withheld, both count. The live period lives in
   S rather than on the experiment, which is shared across every run of the
   dish and would otherwise carry one run's acceleration into the next. */
function advanceShock(sh) {
  S.shocksSurvived++;
  S.shockCycle++;
  if (sh.accel) S.shockPeriod = Math.max(sh.minPeriod || 1, S.shockPeriod * sh.accel);
  S.shockNext += S.shockPeriod;
}

function updateShocks(e) {
  var sh = e.shock;
  if (S.shockNext === 0) S.shockNext = sh.first;
  if (S.shockPeriod === 0) S.shockPeriod = sh.period;

  /* A withheld shock is the cruellest version of the experiment and the one
     that proves the point: the warning runs in full, the culture thickens for
     it, and then nothing arrives. The anticipation was real either way. */
  var skip = false;
  if (sh.skip) {
    var cyc = S.shockCycle + 1;
    for (var si = 0; si < sh.skip.length; si++) if (sh.skip[si] === cyc) { skip = true; break; }
  }

  var was = S.shockActive;
  var reached = S.simT >= S.shockNext;
  var active = !skip && reached && S.simT < S.shockNext + sh.dur;
  var warn = !active && S.simT >= S.shockNext - sh.warn && S.simT < S.shockNext;

  if (warn && S.shockWarned !== S.shockNext) {
    S.shockWarned = S.shockNext;
    if (S.shocksSurvived >= 2) {
      logLine('you have begun to thicken and slow, and the air has not changed yet.', true);
    } else {
      logLine('the humidity is dropping. dry shock incoming.', true);
    }
  }
  if (active && !was) {
    logLine('DRY SHOCK — everything not on engulfed agar is losing water.', true);
  }
  if (!active && was) {
    advanceShock(sh);
    logLine('the air comes back. shock ' + S.shocksSurvived + ' survived.');
  } else if (skip && reached) {
    advanceShock(sh);
    logLine('the observer holds the switch. the dry air never comes.', true);
  }
  S.shockActive = active;
  S.shockWarn = warn;
}

/* ------------------------------------------------------------
   9. rendering
   ------------------------------------------------------------ */
var cv = null, ctx = null, off = null, octx = null, img = null, imgData = null;

/* Does the picture need rebuilding, or can the last one be shown again?
   Everything expensive in the renderer — eight separable blurs over 109,200
   cells, then two more full-grid passes to find and chain the ridges — is a
   pure function of the trail field and where the agents are. Neither moves
   except in step(), so on a paused dish, on the result screen, or on any frame
   the step budget did not advance, rebuilding it computes the same answer
   again. Measured under 6x CPU throttling, standing in for a phone, a PAUSED
   frame cost 974ms against 1065ms running: almost the entire frame was the
   rebuild, and the dish was not even moving. That also feeds back into the
   simulation, because the frame loop drops accumulated steps when it falls
   behind, so a dish that cannot draw runs slower in real time as well.

   The flag is set wherever the field or the agents actually change, and the
   built geometry is kept in Path2D objects so a clean frame re-strokes them
   without walking the grid or re-issuing the path. */
var fieldDirty = true;

/* Dirty frames between rebuilds while the dish is running. Caching alone only
   helps frames where nothing moved — a paused dish, the result screen — and
   during actual play every frame advances a step, so every frame is dirty and
   pays in full. Measured unthrottled on a 2356px canvas, that full price is
   9ms of a 16.7ms budget, over half the frame gone to redrawing a network that
   changes by a fraction of a per cent per step.

   Rebuilding every other dirty frame halves it. Counting FRAMES rather than
   capping by elapsed time is deliberate and is the opposite of the obvious
   choice: a 30Hz time cap never triggers on the device that needs it, since a
   struggling phone is already below 30Hz, and so does nothing for exactly the
   case this is here for. A frame count always halves the work, whatever the
   device is managing. The cost is one frame of latency on a body that visibly
   moves at about the speed of a slime mould. */
var REBUILD_EVERY = 2;
var dirtyFrames = 0;

/* ---- the sheet, off ----
   The body used to be drawn twice: once as a field, painted per subpixel
   into an offscreen image and scaled onto the plate, and once as lines, the
   veins and lobes traced from the same field and stroked as paths over it.
   The field was the frame's biggest single cost after the canvas copies —
   SUP squared subpixels a rebuild, a quarter of the CPU at SUP 3 — and the
   fat under every filament. With it off, what is drawn is what the organism
   is: tubes and the swellings at their junctions, on a ground that is agar,
   walls and hazards as the shapes the dish declares them to be. Pads on
   flakes show only as the veins that cross them, and a corridor a single
   cell wide, which the bridge pass drew as coverage, is not drawn at all.
   Off "for now": the painter is kept whole behind this flag, so the sheet
   can come back as contours later without being written again. */
var SHEET = false;
/* What the sheet also carried, and the shapes cannot: the three fields the
   player and the dish write into the agar itself — the cue and retract
   haze under the brush, and on a dish that runs on its own mat, the mat.
   They are what the organism is feeling, so they are drawn from the field
   and not from a list of where the brush was: one image at the grid's own
   resolution, no supersampling, painted on a rebuild only while any of
   them is live (ovlLive — set by the brush and by a mat dish, cleared by
   a pass that finds nothing) and added onto the plate with 'lighter', which
   is the painter's own r += … per cell. A haze has no edge to see cells on;
   the cost is one pass over the cells while a cue is fading and a small
   drawImage. */
var ovl = null, ovlCtx = null, ovlImg = null, ovlData = null;
var ovlLive = false, ovlAny = false;

function paintOverlay() {
  var d = ovlData, any = false, mat = SLIME_W > 0;
  for (var i = 0, p = 0; i < NCELL; i++, p += 4) {
    var r = 0, g = 0, b = 0;
    if (mat) {
      var sv = slimeF[i];
      if (sv > 0.05 && !wallM[i]) {
        var thin = 1 - (trail[i] > 8 ? 1 : trail[i] * 0.125);
        if (thin > 0) { r += sv * MAT_ADD[0] * thin; g += sv * MAT_ADD[1] * thin; b += sv * MAT_ADD[2] * thin; }
      }
    }
    var c = cueF[i];
    if (c > 0.02) { r += c * CUE_ADD[0]; g += c * CUE_ADD[1]; b += c * CUE_ADD[2]; }
    var q = retF[i];
    if (q > 0.02) { r += q * RET_ADD[0]; g += q * RET_ADD[1]; b += q * RET_ADD[2]; }
    if (r > 0 || g > 0 || b > 0) {
      any = true;
      d[p] = r > 255 ? 255 : r; d[p + 1] = g > 255 ? 255 : g; d[p + 2] = b > 255 ? 255 : b; d[p + 3] = 255;
    } else {
      d[p + 3] = 0;
    }
  }
  ovlAny = any;
  if (any) ovlCtx.putImageData(ovlImg, 0, 0);
  /* a mat dish is live for as long as it runs; a cue is live until it has
     faded to nothing, and the brush relights it */
  if (!any && !mat) ovlLive = false;
}

/* ---- the frame clock, on request ----
   Where a frame goes, on the device it is going on. A headless profile on a
   build box says which half of the work is which THERE — the simulation, the
   field painter, or the canvas copies — and says nothing about a phone or a
   laptop with a GPU, where the copies are cheap and the painter is not, or
   the other way about. Opened with ?prof on the URL and otherwise not built,
   so the page carries no clock reads it was not asked for. Three numbers a
   second, in milliseconds of the frame: steps, the field rebuild (painter and
   vein trace, per rebuild), and the composite (everything else render does,
   per frame). */
var PROF = /(^\?|&)prof(=|&|$)/.test(window.location.search);
var profStep = 0, profBuild = 0, profComp = 0, profFrames = 0, profSteps = 0, profBuilds = 0, profT0 = 0, profEl = null;

function profTick(now) {
  if (!profT0) {
    /* the window opens here, so what the first frame already counted is
       dropped with it: kept, it would be work with no elapsed time to set
       it against, and a one-second first frame would read as two */
    profT0 = now;
    profStep = profBuild = profComp = 0; profFrames = profSteps = profBuilds = 0;
    return;
  }
  var dt = now - profT0;
  if (dt < 1000) return;
  if (!profEl) {
    profEl = document.createElement('div');
    profEl.id = 'prof';
    profEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px/1.4 ui-monospace,Menlo,monospace;' +
      'color:#dfe6d8;background:rgba(0,0,0,.72);padding:6px 8px;border-radius:4px;white-space:pre;pointer-events:none';
    document.body.appendChild(profEl);
  }
  var fps = profFrames / dt * 1000, sps = profSteps / dt * 1000;
  profEl.textContent =
    fps.toFixed(1) + ' fps · ' + sps.toFixed(0) + ' steps/s · ' + (cv ? cv.width + 'x' + cv.height : '') + ' · SUP ' + SUP + '\n' +
    'steps     ' + (profFrames ? profStep / profFrames : 0).toFixed(1).padStart(5) + ' ms/frame  (' + (profSteps ? profStep / profSteps : 0).toFixed(2) + ' ms/step)\n' +
    'rebuild   ' + (profBuilds ? profBuild / profBuilds : 0).toFixed(1).padStart(5) + ' ms/rebuild (' + (profBuilds / dt * 1000).toFixed(1) + '/s)\n' +
    'composite ' + (profFrames ? profComp / profFrames : 0).toFixed(1).padStart(5) + ' ms/frame';
  profStep = profBuild = profComp = 0; profFrames = profSteps = profBuilds = 0; profT0 = now;
}

function initCanvas() {
  cv = $('cv');
  ctx = cv.getContext('2d', { alpha: false });
  veil = document.createElement('canvas');
  vlctx = veil.getContext('2d');
  veilAcc = document.createElement('canvas');
  vactx = veilAcc.getContext('2d');
  veilTmp = document.createElement('canvas');
  vtctx = veilTmp.getContext('2d');
  veilMask = document.createElement('canvas');
  vmctx = veilMask.getContext('2d');
  ink = document.createElement('canvas');
  ictx = ink.getContext('2d');
  off = document.createElement('canvas');
  octx = off.getContext('2d', { alpha: false });
  allocField();
  if (!SHEET) {
    ovl = document.createElement('canvas');
    ovl.width = GW; ovl.height = GH;
    ovlCtx = ovl.getContext('2d');
    ovlImg = ovlCtx.createImageData(GW, GH);
    ovlData = ovlImg.data;
  }
  resizeCanvas();
}

/* the field image at the current SUP — see SUP */
function allocField() {
  if (!SHEET) return;
  off.width = GW * SUP; off.height = GH * SUP;
  img = octx.createImageData(GW * SUP, GH * SUP);
  imgData = img.data;
  for (var p = 3; p < imgData.length; p += 4) imgData[p] = 255;
}

function resizeCanvas() {
  var stage = $('stage');
  var wCss = stage.clientWidth || 900;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.max(320, Math.round(wCss * dpr));
  var h = Math.round(w * GH / GW);
  var ppc = w / GW;   /* device pixels per cell */
  var want = ppc >= 4 ? 3 : (ppc >= 2 ? 2 : 1);
  if (want !== SUP) {
    SUP = want;
    allocField();
    fieldDirty = true; dirtyFrames = REBUILD_EVERY;
  }
  if (cv.width !== w || cv.height !== h) {
    cv.width = w; cv.height = h;
    /* Sizing clears them, which is right: an accumulator holding strokes at
       the old scale has nothing true to say at the new one. But a PAUSED dish
       will not rebuild — its frames re-composite the accumulator that was
       just wiped, and the veins would sit blank until the clock resumed. The
       Path2Ds survive a resize (they are grid-space, the transform does the
       scaling), so re-arm the composite to re-stroke them, with nothing to
       decay in. */
    if (veil) { veil.width = w; veil.height = h; }
    if (veilAcc) { veilAcc.width = w; veilAcc.height = h; }
    if (veilTmp) { veilTmp.width = w; veilTmp.height = h; }
    if (veilMask) { veilMask.width = w; veilMask.height = h; }
    if (veil) { veinFresh = true; veilDn = 0; }
    /* the ink is the one canvas here that must NOT be wiped by a resize: it
       is the record, and a record that a window drag empties is not one.
       Rescaled through a copy, since sizing clears */
    if (BODY && ink) {
      /* the body's record is an outline: refilled at the new size */
      ink.width = w; ink.height = h;
      recordBody(ictx, w / GW, h / GH);
    } else if (ink && ink.width && ink.height) {
      var keep = document.createElement('canvas');
      keep.width = ink.width; keep.height = ink.height;
      keep.getContext('2d').drawImage(ink, 0, 0);
      ink.width = w; ink.height = h;
      ictx.drawImage(keep, 0, 0, w, h);
    } else if (ink) { ink.width = w; ink.height = h; }
  }
}

/* Ridge lift — the difference between a photograph of glowing goo and a
   drawing of a network.

   The trail field is blurred once a step, which is what lets an agent nine
   cells away sense a tube at all; the cost is that every vein renders with a
   soft skirt several cells wide, and two veins running near each other render
   as one fat smear. An unsharp mask undoes exactly that at paint time and
   nowhere else: subtract a WIDE local mean from a NARROW one, and what is left
   is bright along the centre line of a tube and negative on its flanks. Veins
   come out as lines with dark gaps between them, and junctions as junctions.

   Both radii matter, and a bare Laplacian on the raw field — which is the
   obvious way to write this — gets the narrow one wrong. Agents deposit into
   single cells, so the field carries a lot of one-cell noise; differencing it
   against its immediate neighbours amplifies precisely that noise, and the
   body renders as glitter rather than as a sheet. Smoothing first (RN) throws
   the per-cell grain away and keeps the vein, which is several cells across.

   It is a pure function of the field, the simulation never reads it back, and
   no draw from the RNG is involved — so nothing about determinism or balance
   depends on these numbers. They are the pen the network is drawn with. */
/* With the veins drawn as lines over it, the field's job changes: it is no
   longer trying to BE the network, it is the sheet the network is embedded in
   — where the plasmodium has been, as a stain in the agar. So it is held well
   below the line layer's brightness. Painted at full strength it competes with
   the strokes and the picture goes back to being a glow. */
/* The body is now the body, at its own colour, so there is nothing left to
   dim it against — the vein lines below draw over it rather than competing
   with it for brightness. The faint diffusion tail that used to need a black
   point subtracted from it now falls below BODY_T and is simply agar. */
var FIELD_GAIN = 1.0;
var SHARP  = 2.40;   // strength of the ridge lift
var SHARP_RN = 3;    // narrow blur passes: kills per-cell grain, keeps the vein
var SHARP_RW = 5;    // wide blur passes: the local mean a vein stands out from
var shpA = new Float32Array(NCELL);   // narrow
var shpB = new Float32Array(NCELL);   // wide
var shpT = new Float32Array(NCELL);   // scratch for the separable pass

/* The narrow field again, low-passed over TIME — the surface the highlights
   are read from, and the first of the three things that stop them twitching.

   Agents deposit into single cells, so `trail` carries a per-cell shot noise
   that a step's diffusion moves around rather than removes; the blurs take it
   down to a few per cent of a vein's height and no further. A few per cent is
   nothing to look at as a field, and it is everything to a DECISION: every
   number the vein pass computes is fed to a threshold — is this cell a maximum
   across d, does its curvature clear the floor, which band is this chain's
   mean in — and a threshold on a wobbling number is a coin flipped twice a
   frame. That is the twitch. It is not the organism moving; the organism moves
   about a cell a second.

   So the ridge pass reads this instead: an exponential average of shpA whose
   coefficient comes from SIM time elapsed since the last rebuild, not from the
   wall clock. Sim time is the right clock for it twice over. The noise being
   averaged out arrives per STEP, so a fixed number of steps of memory removes
   a fixed amount of it whatever the frame rate; and a time-lapse run at x16
   genuinely moves sixteen times as far per frame, so a wall-clock constant
   would smear real motion into a comet tail at speed while barely touching the
   jitter at x1 — and would fail the new bottom of the dial from the other
   side, since a quarter-second of wall clock at x1/16 is not quite one step
   of sim time, so the jitter it is there to remove would come straight back.
   In sim time the lag is the same ~15 steps at every speed on the dial.

   This is render-only, like everything else in this section — the simulation
   never reads it back — so no part of a run's outcome depends on it. What it
   does cost is that the drawn network is now a function of the rebuild history
   and not of the field alone: pause and unpause and the veins settle over a
   few frames rather than being identical instantly. That is the trade, and it
   is the whole point of it. */
/* The field layer is painted at SUP times the grid. The grid is 420 cells
   across and the canvas five to eight times that, and the body's edge is a
   threshold on the eased field: thresholded per cell and then scaled up by
   the browser, every cell on the rim was a soft square, which read as a
   picture blown up from a smaller one — because it was. So the per-cell pass
   below now computes the ground colour, the sharpened field value and the
   inner-shade factor per cell, and a second pass samples those bilinearly at
   each subpixel and applies the coverage ramp THERE: the threshold is taken
   on the interpolated field, so the rim follows the field's contour between
   cells instead of the cells. A bridge corridor's coverage is interpolated
   as coverage rather than re-thresholded, so a one-cell corridor stays
   closed and loses its corners. Costs SUP squared subpixels a cell every
   rebuild — 3 took the x1 step rate from 57 to 47 a second in headless
   Chromium — so it follows the canvas: 3 where a cell is four or more
   device pixels (a tablet or a retina laptop), 2 from two, 1 below that,
   where the cells are near the pixels already and the cost buys nothing.
   Set in resizeCanvas(), which reallocates the field image when it
   changes. */
var SUP = 1;
var gndR = new Float32Array(NCELL), gndG = new Float32Array(NCELL), gndB = new Float32Array(NCELL);
var tF = new Float32Array(NCELL);      // sharpened eased field, per cell
var fF = new Float32Array(NCELL);      // inner-shade factor, per cell
var vB = new Uint8Array(NCELL);        // a bridge cell's own coverage, else 0
var shpV = new Float32Array(NCELL);   // narrow, low-passed over sim time
/* The wide field under the same low-pass, so the unsharp difference the
   painter takes (narrow minus wide) compares two fields on the same clock.
   Without it a temporally eased narrow field against an instantaneous wide
   one would put a transient halo around anything that moved. */
var shpVB = new Float32Array(NCELL);
/* 0.40, up from 0.25 — the measured combo-mid setting: each anti-jitter
   mechanism was swept OFF/baseline/strong separately and together, and this
   combination cut decision churn ~25% while keeping ~90% of drawn motion.
   Since the sheet now paints from this field too, the extra memory quiets
   the body edge as well; the lag it buys is 0.4 sim-seconds on an organism
   that moves about a cell per second. */
var VEIN_TAU = 0.40;                  // sim seconds of memory (~24 steps)
var veinPrimed = false;               // has shpV been seeded at all?
var veinT = 0;                        // S.simT at the last rebuild

/* Called where the field TELEPORTS rather than evolving, and there is nothing
   on the far side of the cut to be continuous with: a new dish. Averaging
   across it would draw one rebuild of the old dish's veins dissolving into the
   new one's, and the hysteresis below would hold the old dish's ridges up
   while it happened. */
function resetVeinTemporal() {
  veinPrimed = false;
  veinT = S.simT;
  rdir.fill(255);
  rband.fill(255);
  rbandP.fill(255);
  lmark.fill(0);
  /* a new dish starts from silence, and its first network fades in over the
     envelope's own rise — which reads as the culture arriving, not a glitch */
  venv.fill(0);
  lenv.fill(0);
  vseen.fill(-1e9);
  lseen.fill(-1e9);
  brenv.fill(0);
  bridgeP.fill(0);
  brT = S.simT;
  envT = S.simT;
  if (vactx && veilAcc.width) vactx.clearRect(0, 0, veilAcc.width, veilAcc.height);
  if (ictx && ink.width) ictx.clearRect(0, 0, ink.width, ink.height);   /* a new dish has no record */
  inked.fill(0);
  recV.fill(0); recPath = null;
  resetVeinGraph();
}

/* The other kind of cut: abandoning a replay, which puts a dish back that this
   layer HAS seen. Everything here is history — an average of the last fifteen
   steps, and three maps of what was drawn last time — so a dish restored
   without it redraws from a standing start and comes back a little thinner
   than the verdict screen was showing before the replay began, in exactly the
   faintest hairlines, which are the ones the hysteresis was holding up. The
   snapshot exists to put the finished dish back; this is part of the finished
   dish. Restored after S, because the average is clocked off S.simT. */
/* The other half of that, and the reason it is a function rather than four
   lines inside the FINAL_STATE literal: it has to run AFTER the verdict
   screen's own render, because that render is what performs the run's last
   rebuild. Captured with the rest of the snapshot, which is assembled before
   it, these four are one rebuild behind the picture the player is looking at —
   and since the restore leaves dt at zero, a replay exit would then put the
   PENULTIMATE dish back under the verdict rather than the one it replaced.

   `rdir`/`rband` and not `rprev`/`rbandP`: the pairs swap at the top of every
   rebuild, so the maps the next one will consult as its memory are the ones
   this one wrote. */
function snapshotVeinTemporal(fs) {
  fs.shpV = new Float32Array(shpV);
  fs.shpVB = new Float32Array(shpVB);
  /* the body's own ease, and its record: the restore leaves dt at zero,
     so a replay exit that did not put these back would trace the
     abandoned replay's body over the verdict */
  fs.bodyV = new Float32Array(bodyV);
  fs.recV = new Float32Array(recV);
  fs.rdir = new Uint8Array(rdir);
  fs.rband = new Uint8Array(rband);
  fs.lmark = new Uint8Array(lmark);
  /* the envelope is part of the finished picture: without it a replay exit
     would put the dish back with every stroke snapped to full presence */
  fs.venv = new Float32Array(venv);
  fs.lenv = new Float32Array(lenv);
  fs.vseen = new Float32Array(vseen);
  fs.lseen = new Float32Array(lseen);
  /* the corridor hold memory: routing consults it, so a restored dish
     re-routed under a REPLAY's holds could bridge a different layout than
     the verdict it is putting back */
  fs.bridgeP = new Uint8Array(bridgeP);
  /* the vein graph is the picture's lines, and the ridge ages are what
     the next rebuild pins from: a replay exit that lost either would put
     the dish back with its veins gone and a second's wait before any
     came back */
  fs.rage = new Float32Array(rage);
  fs.vpN = vpN; fs.veinN = veinN;
  fs.vpx = vpx.slice(0, vpN); fs.vpy = vpy.slice(0, vpN);
  fs.vStart = vStart.slice(0, veinN); fs.vCount = vCount.slice(0, veinN);
  fs.vBand = vBand.slice(0, veinN); fs.vFlow = vFlow.slice(0, veinN); fs.vRoot = vRoot.slice(0, veinN);
  fs.vBorn = vBorn.slice(0, veinN); fs.vState = vState.slice(0, veinN);
  fs.vAtt = vAtt.slice(0, veinN * 4);
  fs.vNext = vNext.slice(0, veinN); fs.vPrev = vPrev.slice(0, veinN);
  if (VEIN_TREE) snapshotTree(fs);
}

/* The graph out of a snapshot; a snapshot without one (taken before the
   graph existed) leaves the dish with no veins, and the next rebuilds
   pin them afresh. The coverage and point map are rebuilt from the
   points rather than carried, since the points are the truth of both. */
function restoreVeinGraph(fs) {
  resetVeinGraph();
  if (!fs.vpx) return;
  vpN = fs.vpN; veinN = fs.veinN;
  vpx.set(fs.vpx); vpy.set(fs.vpy);
  vStart.set(fs.vStart); vCount.set(fs.vCount);
  vBand.set(fs.vBand); vFlow.set(fs.vFlow);
  if (fs.vRoot) vRoot.set(fs.vRoot); else vRoot.fill(0, 0, veinN);
  /* the widths under the points are re-read from the body on the next
     rebuild; seeded here so the first paint is not a hairline */
  for (var wp = 0; wp < vpN; wp++) vpW[wp] = bodyD[(vpy[wp] | 0) * GW + (vpx[wp] | 0)];
  vBorn.set(fs.vBorn); vState.set(fs.vState);
  vAtt.set(fs.vAtt);
  if (fs.vNext) { vNext.set(fs.vNext); vPrev.set(fs.vPrev); }
  else { vNext.fill(-1, 0, veinN); vPrev.fill(-1, 0, veinN); }
  /* every point live until the next width pass reads the body under it */
  vpLive.fill(1, 0, vpN);
  for (var p = 0; p < vpN; p++) coverPoint(p);
  if (fs.rage) rage.set(fs.rage);
}

function restoreVeinTemporal(fs) {
  if (!fs || !fs.shpV) { resetVeinTemporal(); return; }
  restoreVeinGraph(fs);
  if (VEIN_TREE) restoreTree(fs);
  shpV.set(fs.shpV);
  if (fs.shpVB) shpVB.set(fs.shpVB);
  if (fs.bodyV) bodyV.set(fs.bodyV); else bodyV.set(fs.shpV);
  bodyRim();
  if (fs.recV) recV.set(fs.recV); else recV.set(bodyV);
  rdir.set(fs.rdir);
  rband.set(fs.rband);
  lmark.set(fs.lmark);
  if (fs.venv) { venv.set(fs.venv); lenv.set(fs.lenv); }
  if (fs.vseen) { vseen.set(fs.vseen); lseen.set(fs.lseen); }
  if (fs.bridgeP) { bridgeP.set(fs.bridgeP); brenv.fill(0); brT = S.simT; }
  veinPrimed = true;
  veinT = S.simT;
  envT = S.simT;
  /* the accumulator holds the REPLAY's last strokes at this point, and the
     next rebuild has dt 0 and so takes veilDn 0 — but clear it anyway, so no
     path that skips that rebuild can composite another dish's ghosts */
  if (vactx && veilAcc.width) vactx.clearRect(0, 0, veilAcc.width, veilAcc.height);
  /* the ink holds the replay's lines over the original's, and there is no
     way to take one out of the other: the line record restarts from the
     restored network, which the next rebuild inks whole. The body's record
     is a field, put back above, and the next rebuild refills the ink from
     it. */
  if (ictx && ink.width) ictx.clearRect(0, 0, ink.width, ink.height);
  inked.fill(0);
}

function smoothRidgeField() {
  var dt = S.simT - veinT;
  veinT = S.simT;
  if (!veinPrimed) { shpV.set(shpA); shpVB.set(shpB); bodyV.set(shpA); bodyRim(); veinPrimed = true; return; }
  /* A dish that did not advance has nothing to average: holding shpV is both
     cheaper and more correct than folding the same field into itself, which
     would only walk the average toward a value it is already at. Backwards is
     a teleport that got past resetVeinTemporal, and takes the field as given. */
  if (dt <= 0) { if (dt < 0) { shpV.set(shpA); shpVB.set(shpB); bodyV.set(shpA); bodyRim(); } return; }
  var k = 1 - Math.exp(-dt / VEIN_TAU);
  /* the body's slower ease; zero under a wall, where the average would
     otherwise remember the tube a wall has just come down on */
  var kb = 1 - Math.exp(-dt / BODY_TAU);
  for (var ib = 0; ib < NCELL; ib++) {
    var bv = wallM[ib] ? 0 : bodyV[ib] + (shpA[ib] - bodyV[ib]) * kb;
    bodyV[ib] = bv;
    if (bv > recV[ib]) recV[ib] = bv;
  }
  bodyRim();
  if (k >= 0.999) { shpV.set(shpA); shpVB.set(shpB); return; }
  /* Swept whole. Skipping the cells where shpA and shpV already agree is exact
     — the update is a no-op there — and measured as worth nothing, because
     trail DIFFUSES: after eight blurs there is a tail of some tiny nonzero
     value across nearly every cell of a running dish, and the cells that agree
     exactly are too few to pay for the test. */
  for (var i = 0; i < NCELL; i++) {
    shpV[i] += (shpA[i] - shpV[i]) * k;
    shpVB[i] += (shpB[i] - shpVB[i]) * k;
  }
}

/* The body field is zero on the outermost ring of cells, so every outline
   the tracer follows closes inside the grid: a level that ran off the edge
   of the plate was an open chain, and an open chain closed by its chord
   filled a wedge of the plate. The ring is a cell wide and under the
   plate's rim. */
function bodyRim() {
  var x, y;
  for (x = 0; x < GW; x++) { bodyV[x] = 0; bodyV[(GH - 1) * GW + x] = 0; }
  for (y = 0; y < GH; y++) { bodyV[y * GW] = 0; bodyV[y * GW + GW - 1] = 0; }
}

/* one separable 1-2-1 pass, src -> dst, via shpT */
function blurPass(src, dst) {
  var x, y, i, row;
  for (y = 0; y < GH; y++) {
    row = y * GW;
    for (x = 0; x < GW; x++) {
      i = row + x;
      shpT[i] = 0.25 * (x > 0 ? src[i - 1] : src[i])
              + 0.50 * src[i]
              + 0.25 * (x < GW - 1 ? src[i + 1] : src[i]);
    }
  }
  for (y = 0; y < GH; y++) {
    row = y * GW;
    var up = y > 0 ? row - GW : row, dn = y < GH - 1 ? row + GW : row;
    for (x = 0; x < GW; x++) {
      i = row + x;
      dst[i] = 0.25 * shpT[up + x] + 0.50 * shpT[i] + 0.25 * shpT[dn + x];
    }
  }
}

function buildRidge() {
  var n;
  blurPass(trail, shpA);
  for (n = 1; n < SHARP_RN; n++) blurPass(shpA, shpA);
  blurPass(shpA, shpB);
  for (n = 1; n < SHARP_RW; n++) blurPass(shpB, shpB);
}

/* ---- bridges: drawing the tube that is already there ----

   The organism is one cell. It has no way to put cytoplasm somewhere it is not
   connected to, so a scrap of body floating clear of the network is the one
   thing the picture must never show — and, measured, the picture was full of
   them. Four seeds at 600, 1200 and 2000 steps: 13 to 63 drawn pieces adrift
   from the main mass, 5% to 20% of every cell of drawn body. Labelling the
   drawn components and walking the trail field back from each island to the
   mass says why, and it is not the physics. Sweeping every cell in descending
   trail and recording the level at which an island first joins the mass, no
   island in any sample was actually isolated: 69% to 89% of them hang off a
   path carrying 4 to 8 trail — well above TIP_FEED * TIP_MIN, the level the
   supply rule at the top of this file calls a fed tube — and the painter drew
   the gap as agar for the single reason that BODY_T is 9. The renderer's floor
   for tissue was three times the simulation's floor for a tube.

   The obvious repair is to lower the threshold for anything touching drawn
   body, and it does heal the picture: at a floor of 3 the islands fall from 45
   to 6. It also inflates the drawn body by 51% to 61%, because a threshold
   dropped is dropped in every direction — it walks the soft skirt outward all
   the way round the organism, which is exactly the fattening BODY_T was tuned
   at 9 to avoid. Healing bought that way costs the silhouette.

   What is wanted is narrower than a threshold: not every dim cell, only the
   dim cells that lie on a path BETWEEN two drawn pieces. A skirt cell borders
   one component; a bridge cell has a different component on its far side. So
   the drawn pieces are labelled, a breadth-first flood runs out of all of them
   at once over cells the supply rule would call a tube, and every low cell
   learns which piece owns it and which cell it was reached from. Where two
   territories meet, both sides are walked home along those parent links and
   the path is marked. Nothing else is. Same seeds at 2000 steps: islands
   54 -> 6, 63 -> 16, 42 -> 7, 57 -> 9, for 10% to 18% more drawn cells — and
   that increase is corridor LENGTH, not silhouette. The outline of the
   organism is the one it already had.

   The islands that remain are the point of keeping the floor where it is. A
   scrap whose best path home carries less trail than the supply rule needs is
   a scrap the simulation is already starving — one of the branches that comes
   adrift, slows to VOID_SPEED and is reabsorbed — and it should read as cut
   off, because it is. Tracked from step 900, one such branch went 12.06 trail
   at its neck, to 3.44 by step 1100, to 0.05 by 1700. This pass draws the
   organism that is connected and lets the dying ends die visibly.

   Render-only, like the rest of section 9: it reads trail and the ridge
   fields, writes nothing either of them or the simulation reads back, and
   draws nothing from the RNG. A run's outcome does not depend on it. It costs
   2.6ms against the field rebuild's 7.5, on the every-other-frame cadence
   REBUILD_EVERY already puts that rebuild on.

   That cadence is the only one it gets, and giving it a slower one of its own
   was tried and reverted. The mask survives being stale in principle — it says
   which cells MAY be drawn against BODY_LO and the live field still says how
   much of one is drawn — but the count that would pace it is frames, and a
   frame at x12 is twelve times the sim time it is at x1. Rebuilding every
   third field rebuild left corridors trailing the dish exactly when the dish
   was moving: 42 -> 32 islands where rebuilding every time gives 42 -> 7. The
   same trap the vein average is written in sim time to avoid. */
var BRIDGE_MIN = TIP_FEED * TIP_MIN;   // trail a bridge may be routed through
var bStrong = new Uint8Array(NCELL);   // cells the painter draws unaided
var bLab    = new Int32Array(NCELL);   // component id, then flood ownership
var bPar    = new Int32Array(NCELL);   // ...and the cell each was reached from
var bQ      = new Int32Array(NCELL);   // seeds, then the cells the flood reached
/* Two uses, never at once: the union-find parents while the drawn pieces are
   being labelled, then the corridor as a list of its own cells. Sharing one
   array rather than carrying two is worth 437KB on a phone, and the second use
   cannot start until the first is finished — the labels are flattened before
   the flood runs, and the flood before anything is marked. */
var bAux    = new Int32Array(NCELL);
var bridge  = new Uint8Array(NCELL);   // the cells this pass adds to the body
var bN = 0;                            // how many of them, as a list in bAux

/* Bridges were the last un-eased layer, and measurement made them the flashes
   of large regions the rest of the calming left audible: a corridor is
   qualified WHOLE, per rebuild, by a flood over the raw trail field — a
   median of ~340 bridge cells flipped per rebuild at x1, in connected pieces
   of 60-270 cells, drawn at up to 71% coverage with no ramp. Two mechanisms,
   both the file's own patterns:

   A qualification HOLD (RIDGE_HOLD's shape): a cell bridged last rebuild
   re-qualifies at 72% of the threshold, so a corridor stops rerouting off a
   one-unit dip. 0.72 x BRIDGE_MIN is 2.16, still above BODY_LO's 2.0 — the
   held cell remains drawable, so the flood invariant (routed implies drawn)
   survives, at the fading coverage a barely-held cell deserves.

   A per-cell presence ENVELOPE on the drawn coverage (the lobes' shape),
   read through a GROWTH GATE: a corridor does not fade in at its full
   footprint, it grows out of the body it hangs from. The walk that marks a
   corridor already traces the flood's parent chain home, so it records each
   cell's normalized distance from its attachment for free, and the painter
   draws a cell only once the shared envelope has risen past that distance —
   the corridor sweeps in from both attachment ends and meets in the middle,
   and on the way out it retreats tip-first back into the body. The gate
   spends BR_FRONT of the envelope sweeping and the rest fading each cell at
   the front, and it VANISHES at steady state: presence is exactly 1 for
   every distance once the envelope saturates, so the meeting point wobbling
   between rebuilds cannot show. The envelope is clocked on sim time but
   CLAMPED per rebuild: a corridor does not translate, so easing it cannot
   smear motion, and without the clamp a time-lapse rebuild would snap it —
   which is the flash again, at the speed the dish is mostly watched at. On a
   halted dish the envelope snaps to the truth, per the verdict rule. */
var bridgeP = new Uint8Array(NCELL);   // last rebuild's corridors — the hold
var BRIDGE_MIN_LO = BRIDGE_MIN * 0.72;
/* ---- the route hold ----
   bridgeP is no longer a 0/1 record of last rebuild's corridors but an AGE:
   set to BR_HOLD_N when a cell is routed, counted down each rebuild it is
   not, and the cell stays a corridor until it reaches zero — provided it is
   still supplied, still reached by the flood, and still not body of its
   own. The flood's threshold test (bridgeP ? BRIDGE_MIN_LO : BRIDGE_MIN)
   reads it exactly as before, since any nonzero age is truthy.

   Why: the corridors were not living long enough to be seen. Measured on
   EXP-01 at time-lapse speed, a corridor cell survived a median of TWO
   rebuilds, 31% only one, and the routed set turned over by a third every
   rebuild — while the growth gate needs several to sweep a corridor in.
   So most corridor cells sat mid-sweep or past the front at any instant,
   painting little or nothing, and the plate showed pieces the router had
   in fact joined. Painting them brighter could not fix that: a cell the
   gate has not reached draws nothing at any floor.

   The churn is not the trail's doing, which is what the LO threshold was
   built to hold against. Rerun with both inputs frozen the routing is
   deterministic — zero drops — and with the trail frozen but the drawn
   pieces allowed to move it reproduces 92–95% of the real churn. A piece's
   rim gains and loses cells at BODY_DRAW every rebuild, that changes the
   order in which the multi-source flood discovers cells, and a one-cell
   shift in discovery moves the parent chain behind every meeting sideways
   by a cell: 70% of dropped corridor cells were still supplied and still
   reached, just no longer on the chain the walk happened to take. The
   hysteresis held which cells QUALIFY and never which PATH is chosen.

   Holding membership for a few rebuilds is the smallest change that
   answers that: a chain that shifts a cell and shifts back never leaves
   state 1. Four covers 78% of the lifetimes measured at time-lapse speed
   (two thirds of a sim-second there, an eighth at ×1, where churn was a
   third as bad to begin with). The cost is that a corridor can stand up to
   four rebuilds after it stops being the chosen route — bounded, and only
   over ground the flood still reaches. */
var BR_HOLD_N = 4;
var brenv = new Float32Array(NCELL);   // drawn-coverage presence per cell
var bFrac = new Uint8Array(NCELL);     // distance from attachment, 0..255
var brT = 0;                           // S.simT at the last bridge rebuild
var BR_TAU_UP = 0.22;                  // sim-seconds of growth
var BR_TAU_DN = 0.15;                  // sim-seconds of retreat
var BR_FRONT = 0.75;                   // envelope fraction spent sweeping
var BR_FR = BR_FRONT / 255;            // bFrac -> envelope threshold
var BR_WIN = 1 / (1 - BR_FRONT);       // per-cell fade width at the front
/* The clamp is what set how fast a corridor could sweep in at time-lapse,
   and it was set where the joint never painted. At ×24 a rebuild arrives
   every ~0.167 sim-seconds; clamped to 0.08 the envelope gained 0.305 a
   rebuild, and a corridor's MEETING cells — bFrac 255, the place two pieces
   actually join — draw nothing until the envelope passes 0.75 and reach ink
   at 0.83: five rebuilds, for a corridor that lives two. Classified over 86
   detached pieces on the canvas, 39% of the cells that invisibly joined
   them to the body were live corridor with the gate still shut, and a
   further 11% mid-sweep; body in the crossing band was 1%. So the joint was
   the one part of a corridor guaranteed not to be drawn, and no coverage
   floor could touch it (measured: a floor drew a blocky sleeve on the
   dilated band and left the count where it was).

   At 0.25 the envelope tracks the rebuild interval time-lapse actually
   runs at, meeting cells reach ink in two rebuilds, and the same
   checkpoints re-captured showed visible pieces 42 → 18 and their share
   of ink 4.65% → 3.23%. The clamp does not bind at ×1 — a rebuild there
   is ~0.03 sim-s, under either value — so nothing about the speed the
   dish is mostly watched at changes. What it was guarding against, a
   corridor snapping on in one rebuild at time-lapse, is not what 0.25
   does: brUp is 0.68 a rebuild, a sweep of two, at a speed where the
   whole plate moves between frames anyway. */
var BR_DT_CAP = 0.25;                  // per-rebuild clock clamp
var brUp = 1, brDn = 0;                // folded per rebuild in buildBridges
var brLive = false;                    // ...and whether the route hold applies
/* The envelope's bookkeeping lives in ONE dedicated sweep in buildBridges,
   not in the paint loop: interleaving brenv updates with the painter's
   innermost branches measured a sixth of the throttled frame budget, where a
   tight sequential sweep costs bandwidth and nothing else. bridge[] is
   tri-state after it — 0 none, 1 routed, 2 fading — so the paint loop learns
   everything from the byte it already loads and reads brenv only inside the
   corridor branches. */

/* The cells whose eight neighbours are all on the grid, and the offsets to
   them. Both floods below are the same loop twice — by offset where the mask
   says it is safe, with the bounds tests and the divisions to recover x and y
   where it does not — because at this grid size the border is 1.3% of the
   cells and the interior is the hot loop. */
var bInner = new Uint8Array(NCELL);
var BOFF = new Int32Array([-GW - 1, -GW, -GW + 1, -1, 1, GW - 1, GW, GW + 1]);
(function markInner() {
  for (var y = 1; y < GH - 1; y++)
    for (var x = 1; x < GW - 1; x++) bInner[y * GW + x] = 1;
})();

function ufFind(a) {
  while (bAux[a] !== a) { bAux[a] = bAux[bAux[a]]; a = bAux[a]; }
  return a;
}

/* Walk home from a meeting cell, marking as it goes. It stops on drawn body
   (arrived) and on already-marked corridor (this stretch is someone else's
   already), which is what keeps a mass with many islands from re-walking the
   same trunk once per island. Every cell it steps through was reached by the
   flood, so bPar under it is always a cell the flood wrote.

   Two passes over the same chain: the first measures it, the second marks
   each cell with its distance from home as a fraction of the whole — the
   growth gate's coordinate. Home is wherever the count stopped, and when
   that is an already-marked trunk rather than the body, the spur's range
   starts at the TRUNK CELL'S OWN fraction rather than at zero: the front
   has to reach the junction before it turns up the spur, or a spur off a
   not-yet-grown stretch would draw first as a floating segment. The re-walk
   costs one pointer chase over the ~hundreds of corridor cells a rebuild
   marks. */
function bridgeWalk(c) {
  var L = 0, p = c;
  while (p >= 0 && !bStrong[p] && !bridge[p]) { L++; p = bPar[p]; }
  if (!L) return;
  var b0 = (p >= 0 && bridge[p]) ? bFrac[p] : 0;
  var j = L, s = (255 - b0) / L;
  while (c >= 0 && !bStrong[c] && !bridge[c]) {
    bridge[c] = 1; bFrac[c] = (b0 + j-- * s) | 0; bAux[bN++] = c; c = bPar[c];
  }
}

function buildBridges() {
  var i, c, q, k, x, y, l, m, o, dx, dy, nx, ny, row, head, tail;
  var dtB = S.simT - brT;
  brT = S.simT;
  if (dtB > 0 && S.running) {
    if (dtB > BR_DT_CAP) dtB = BR_DT_CAP;
    brUp = 1 - Math.exp(-dtB / BR_TAU_UP);
    brDn = Math.exp(-dtB / BR_TAU_DN);
    brLive = true;
  } else {
    /* a halted or restored dish shows what it is: corridors at full
       presence, everything else at none — and "corridors" means the ones
       routed THIS rebuild, so the route hold is off here (brLive). This
       branch runs on a finished, restored or title plate, not under Hold:
       fieldDirty is set only by step(), and step() does not run while
       paused, so a held plate is the last running rebuild frozen and
       nothing here fires for it. What the switch guards is the snapped
       envelope — with the hold on, a restored plate would put up to four
       rebuilds of stale routes at full presence in one frame. */
    brUp = 1;
    brDn = 0;
    brLive = false;
  }
  /* The age a cell must carry for the flood and the dilation below to admit
     it at BRIDGE_MIN_LO rather than BRIDGE_MIN. Running: any age, which is
     the hold doing its work upstream of the walk as well as after it. Halted:
     only a cell routed on the rebuild just gone, which is exactly the 0/1
     bridgeP the routing read before ages existed — so a finished or restored
     plate routes what it always routed. Without this the switch above guarded
     only the settle step, and the flood had already let a route three
     rebuilds stale qualify at the low bar and hand it to a snapped envelope. */
  var pAge = brLive ? 1 : BR_HOLD_N;
  bridge.fill(0);
  bN = 0;

  /* 1. decide what the painter would draw unaided and label the pieces of it,
     in one raster pass. Union-find rather than a flood fill per piece: four
     already-seen neighbours each, no queue, no cell visited twice — and the
     seeds for the flood below fall out of the same sweep.

     The threshold is BODY_DRAW and not BODY_T, which is the same question
     asked of the ramp's nominal foot rather than of the first place the
     painter puts ink. They disagree over a hairline and everything this pass
     does is built on the answer: a cell in that band is body by the constant
     and blank on the plate, so a corridor can terminate there and paint into
     nothing, or a piece made only of such cells can anchor one to a component
     that is not visibly present. Measured over six seeds at 1000 and 2200
     steps, GAM's own rounding alone put 18 to 81 such cells a frame on the
     plate, 3 to 17 of them touching a corridor; LUT's rounding, which
     BODY_DRAW also now accounts for, another 26 to 52 a frame with 4 to 20
     touching. Testing against the composed floor costs nothing over testing
     against BODY_T, and the question stops having two answers. */
  var np = 0;
  tail = 0;
  for (y = 0; y < GH; y++) {
    row = y * GW;
    for (x = 0; x < GW; x++) {
      i = row + x;
      /* the same eased fields the painter reads, or the question of what is
         body gets two answers again — smoothRidgeField has already run this
         rebuild, so these are current */
      var a = shpV[i];
      if (a + SHARP * (a - shpVB[i]) < BODY_DRAW) { bStrong[i] = 0; bLab[i] = -1; continue; }
      bStrong[i] = 1;
      bQ[tail++] = i;
      l = -1;
      if (x > 0 && bStrong[i - 1]) l = ufFind(bLab[i - 1]);
      if (y > 0) {
        if (bStrong[i - GW]) {
          m = ufFind(bLab[i - GW]);
          if (l < 0) l = m; else if (m !== l) bAux[m] = l;
        }
        if (x > 0 && bStrong[i - GW - 1]) {
          m = ufFind(bLab[i - GW - 1]);
          if (l < 0) l = m; else if (m !== l) bAux[m] = l;
        }
        if (x < GW - 1 && bStrong[i - GW + 1]) {
          m = ufFind(bLab[i - GW + 1]);
          if (l < 0) l = m; else if (m !== l) bAux[m] = l;
        }
      }
      if (l < 0) { l = np; bAux[np] = np; np++; }
      bLab[i] = l;
    }
  }
  var seedEnd = tail, nl = 0;
  for (i = 0; i < np; i++) if (ufFind(i) === i) nl++;
  /* One piece — or none — is nothing to bridge, which is the case a healthy
     young dish is in and the case the title screen is in. Nothing to ROUTE is
     not nothing to BOOK, though: the memory and the envelope still advance,
     or a dish that just healed into one piece cuts its corridors to agar in a
     single rebuild — the flash again — while bridgeP and brenv keep last
     rebuild's corridors to corrupt the thresholds of the next split. */
  if (nl < 2) { bridgeSettle(); return; }
  for (k = 0; k < seedEnd; k++) bLab[bQ[k]] = ufFind(bLab[bQ[k]]);

  /* 2. flood out of every piece at once, over supplied cells only, so each low
     cell learns which piece owns it and which cell it was reached from */
  head = 0;
  while (head < tail) {
    c = bQ[head++];
    o = bLab[c];
    if (bInner[c]) {
      for (k = 0; k < 8; k++) {
        q = c + BOFF[k];
        if (bLab[q] >= 0 || trail[q] < (bridgeP[q] >= pAge ? BRIDGE_MIN_LO : BRIDGE_MIN)) continue;
        bLab[q] = o; bPar[q] = c; bQ[tail++] = q;
      }
    } else {
      x = c % GW; y = (c / GW) | 0;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        nx = x + dx; ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        q = ny * GW + nx;
        if (bLab[q] >= 0 || trail[q] < (bridgeP[q] >= pAge ? BRIDGE_MIN_LO : BRIDGE_MIN)) continue;
        bLab[q] = o; bPar[q] = c; bQ[tail++] = q;
      }
    }
  }

  /* 3. where two territories touch, walk both sides home. Every meeting is an
     adjacency between two cells the flood reached, so the scan runs over what
     it reached — bQ past its seeds — and not over the grid.

     Taking the meetings inside the flood instead, off the labelled-neighbour
     test it already makes, is the tempting version and was measurably worse:
     2.79ms against 2.62 for the pass, repeatably. The flood's inner loop is
     the hottest thing here and it is cheaper to leave it saying one simple
     thing than to hang a second decision off it. */
  for (k = seedEnd; k < tail; k++) {
    c = bQ[k];
    l = bLab[c];
    if (bInner[c]) {
      for (i = 0; i < 8; i++) {
        q = c + BOFF[i];
        if (bLab[q] >= 0 && bLab[q] !== l) { bridgeWalk(c); bridgeWalk(q); }
      }
    } else {
      x = c % GW; y = (c / GW) | 0;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        nx = x + dx; ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        q = ny * GW + nx;
        if (bLab[q] >= 0 && bLab[q] !== l) { bridgeWalk(c); bridgeWalk(q); }
      }
    }
  }

  /* 4. one ring of thickening, from the hairline as it stood before this loop
     — bAux holds it as a list precisely so the dilation cannot feed on its own
     output and creep outward a ring per cell. A corridor is a tube, and a tube
     one cell wide reads as a scratch on the plate; it also lets a single dim
     cell along an otherwise sound path punch a hole in the connection. */
  var end = bN;
  for (k = 0; k < end; k++) {
    c = bAux[k];
    if (bInner[c]) {
      for (i = 0; i < 8; i++) {
        q = c + BOFF[i];
        if (!bridge[q] && !bStrong[q] &&
            trail[q] >= (bridgeP[q] >= pAge ? BRIDGE_MIN_LO : BRIDGE_MIN)) {
          bridge[q] = 1; bFrac[q] = bFrac[c];
        }
      }
    } else {
      x = c % GW; y = (c / GW) | 0;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        nx = x + dx; ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        q = ny * GW + nx;
        if (!bridge[q] && !bStrong[q] &&
            trail[q] >= (bridgeP[q] >= pAge ? BRIDGE_MIN_LO : BRIDGE_MIN)) {
          bridge[q] = 1; bFrac[q] = bFrac[c];
        }
      }
    }
  }
  bridgeSettle();
}

/* The bookkeeping tail of buildBridges, shared with its early return: commit
   this rebuild's corridors as the next one's hold memory, then advance the
   envelope in one fused sweep — routed cells rise; any other cell still
   carrying presence decays and is marked fading (2) so the painter draws its
   exit, or is cleared at the floor. Walls clear outright: the mold is not on
   the wall. */
function bridgeSettle() {
  for (var i = 0; i < NCELL; i++) {
    if (bridge[i] === 1) {
      /* routed this rebuild: the hold is refreshed */
      bridgeP[i] = BR_HOLD_N;
      var bev = brenv[i];
      if (bev < 1) brenv[i] = bev + (1 - bev) * brUp;
    } else if (brLive && bridgeP[i] > 0 && !bStrong[i] && !wallM[i] &&
               bLab[i] >= 0 && trail[i] >= BRIDGE_MIN_LO) {
      /* Not chosen this rebuild, but held: still supplied, still reached
         by this rebuild's flood from a piece, and still not body of its
         own — so "routed means connected and drawable" holds for it as
         firmly as for a cell the walk marked, and it stays a corridor with
         its envelope rising. bFrac is left alone, so the growth gate keeps
         the coordinate it had. See BR_HOLD_N for why this exists. */
      bridgeP[i]--;
      bridge[i] = 1;
      var bev2 = brenv[i];
      if (bev2 < 1) brenv[i] = bev2 + (1 - bev2) * brUp;
    } else {
      bridgeP[i] = 0;
      var bef = brenv[i];
      if (bef > 0.02) {
        bef *= brDn;
        if (bef > 0.02 && !wallM[i]) {
          brenv[i] = bef;
          bridge[i] = 2;
        } else {
          brenv[i] = 0;
        }
      } else if (bef !== 0) {
        brenv[i] = 0;
      }
    }
  }
}

function paintField() {
  var d = imgData;
  buildRidge();
  /* Fold this rebuild's fields into the temporal average BEFORE painting, so
     the body is drawn from the same eased surface the ridge pass reads. This
     is where the sheet's own popping went: the body edge is a threshold, and
     a threshold on the raw field flips whole stub branches in and out per
     rebuild — the same coin-flip the veins had, at the sheet's scale. Painting
     from shpV gives the edge the ridge pass's ~15 steps of memory, and since
     the average is clocked in sim time it costs the same nothing at x12 that
     shpV always has. buildVeins' own call right after finds dt 0 and holds. */
  smoothRidgeField();
  buildBridges();
  for (var i = 0; i < NCELL; i++) {
    var r, g, b;
    tF[i] = 0; fF[i] = 1; vB[i] = 0;
    if (wallM[i]) {
      r = 46; g = 50; b = 40;
    } else {
      r = AGAR[0]; g = AGAR[1]; b = AGAR[2];
      var hz = hazM[i];
      if (hz) {
        var hl = HAZ_ADD[hz];
        r += hl[0]; g += hl[1]; b += hl[2];
      }
      /* The mat, where a dish is running on it. Cool, grey and much fainter
         than any hazard — it is the record of where the organism has been,
         not a thing on the plate — and it fades out under live tube, because
         under live tube it is not something the player needs to see. */
      if (SLIME_W > 0) {
        var sv = slimeF[i];
        if (sv > 0.05) {
          var thin = 1 - (trail[i] > 8 ? 1 : trail[i] * 0.125);
          if (thin > 0) {
            r += sv * MAT_ADD[0] * thin;
            g += sv * MAT_ADD[1] * thin;
            b += sv * MAT_ADD[2] * thin;
          }
        }
      }
      var a = shpV[i];
      /* 0 none, 1 routed, 2 fading — see buildBridges; presence is read only
         inside the branches that need it */
      var br = bridge[i];
      var t = a + SHARP * (a - shpVB[i]);
      tF[i] = t;
      if (a > 0.004 || br) {
        if (t > BODY_T * 0.5 || br) {
          var gi = (t * GAM_SCALE) | 0;
          if (gi < 0) gi = 0; else if (gi >= GAMN) gi = GAMN - 1;
          /* A bridged cell is under BODY_T by construction, so GAM would hand
             back nothing; it is drawn through the ramp anchored at BODY_LO
             instead, which is the whole of what the bridge pass changes about
             this loop.

             And it is measured against TRAIL — the field that qualified the
             route — rather than against anything the ridge pass built out of
             it. Both blurred candidates leak the same way, in proportion to
             how thin the tube is, which is the one property every cell here
             has. Three 1-2-1 passes put 20/64 of a one-cell line back at its
             own centre, so a corridor at BRIDGE_MIN renders from shpA at
             0.9375 and from t lower still: routing accepts it, the painter
             draws a hole, and the two pieces stay visibly apart. Reading trail
             closes that by construction rather than by luck. Every cell the
             flood marked cleared BRIDGE_MIN against the same array this lookup
             reads, in the same pass, so the floor is not a hope about dish
             conditions: BRIDGE_MIN is 3.0, BODY_LO is 2.0 and BODY_SOFT 1.4,
             which puts the worst a qualified cell can draw at 79% coverage and
             saturates it by 3.4.

             That gap is also what answers the objection to reading a raw field
             — that trail carries per-cell shot noise the painter blurs out on
             purpose. It does, and none of it lands here: the ramp is already
             flat 0.4 above the floor every corridor cell stands on, so the
             noise has nowhere to show. Measured across five experiments and
             42,649 corridor cells, no cell drew under that floor. */
          var vcov;
          if (br === 1) {
            /* the growth gate: the envelope against this cell's distance
               from its attachment, so the corridor grows in from both ends
               over ~0.4s instead of stamping on — or fading on — whole. At
               a saturated envelope this is 1 for every distance, so it
               costs a stable corridor nothing. */
            var gp = (brenv[i] - bFrac[i] * BR_FR) * BR_WIN;
            if (gp <= 0) {
              vcov = 0;
            } else {
              if (gp > 1) gp = 1;
              var gt = (trail[i] * GAM_SCALE) | 0;
              if (gt < 0) gt = 0; else if (gt >= GAMN) gt = GAMN - 1;
              vcov = (GAM_LO[gt] * gp) | 0;
            }
          } else {
            vcov = GAM[gi];
            /* A corridor the flood just dropped retreats tip-first from
               wherever it was — the trail that carried it is usually still
               there, which is exactly why its cut used to read as a flash.
               Only where the body draws (nearly) nothing of its own: a
               bridge cell that thickened into real tissue keeps its GAM
               coverage untouched. */
            if (br === 2 && vcov < 24) {
              var gp2 = (brenv[i] - bFrac[i] * BR_FR) * BR_WIN;
              if (gp2 > 0) {
                if (gp2 > 1) gp2 = 1;
                var gt2 = (trail[i] * GAM_SCALE) | 0;
                if (gt2 < 0) gt2 = 0; else if (gt2 >= GAMN) gt2 = GAMN - 1;
                var fv = (GAM_LO[gt2] * gp2) | 0;
                if (fv > vcov) vcov = fv;
              }
            }
          }
          /* the inner shadow (see ISH_D above): how much of the body is
             missing one and two throws down-light of this cell. The last
             few rows and columns skip it rather than clamp it — they are
             against the dish wall, where the shade would be guesswork. */
          var f = 1;
          var sx2 = i % GW, sy2 = (i / GW) | 0;
          /* and it is not shaded: the inner shadow is the body's own thickness
             read off its neighbours, and a corridor two cells wide has no
             interior to be inside of — shading it only dirties the one thing
             this pass exists to make legible */
          if (vcov > 8 && !br && sx2 < GW - 2 * ISH_D - 1 && sy2 < GH - 2 * ISH_D - 1) {
            /* the eased fields, like the coverage above them — one pixel
               must not combine two temporal snapshots, and neighbour noise
               in the raw field was still twitching the shade after the body
               itself went quiet */
            var j1 = i + ISH_D * GW + ISH_D;
            var a1 = shpV[j1];
            var t1 = a1 + SHARP * (a1 - shpVB[j1]);
            var g1 = (t1 * GAM_SCALE) | 0;
            if (g1 < 0) g1 = 0; else if (g1 >= GAMN) g1 = GAMN - 1;
            var j2 = i + 2 * ISH_D * GW + 2 * ISH_D;
            var a2 = shpV[j2];
            var t2 = a2 + SHARP * (a2 - shpVB[j2]);
            var g2 = (t2 * GAM_SCALE) | 0;
            if (g2 < 0) g2 = 0; else if (g2 >= GAMN) g2 = GAMN - 1;
            var sh = vcov * (255 - 0.55 * GAM[g1] - 0.45 * GAM[g2]);
            if (sh > 0) f = 1 - ishDepth * sh / 65025;
          }
          /* The shade scales the ORGANISM'S contribution and nothing under
             it. The ground keeps its own light — agar, and the hazard glow
             that bleeds through the body — which is what holds the shaded
             rim's contrast against every ground the dish can show: shading
             the whole pixel put the rim under 3:1 against a lit hazard
             field for a quarter of seed-and-ground pairs, while shading the
             contribution alone clears the floor on all of them, because
             rim and ground then ride on the same base. */
          /* not added here: the subpixel pass below adds the organism's
             contribution from the interpolated field; what this cell hands
             it is its shade and, for a bridge cell, its own coverage */
          fF[i] = f;
          if (br) vB[i] = vcov;
        }
      }
      /* the player's cue reads as a faint warm haze in the agar */
      var c = cueF[i];
      if (c > 0.02) {
        r += c * CUE_ADD[0]; g += c * CUE_ADD[1]; b += c * CUE_ADD[2];
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      }
      var q = retF[i];
      if (q > 0.02) {
        r += q * RET_ADD[0]; g += q * RET_ADD[1]; b += q * RET_ADD[2];
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      }
    }
    gndR[i] = r; gndG[i] = g; gndB[i] = b;
  }
  /* --- the subpixel pass — see SUP --- */
  var W2 = GW * SUP, H2 = GH * SUP, inv = 1 / SUP, half = 0.5 * inv - 0.5;
  var lutGain = FIELD_GAIN;
  for (var sy = 0, pp = 0; sy < H2; sy++) {
    var cy = sy * inv + half;
    var y0 = cy | 0; if (cy < 0) { y0 = 0; cy = 0; }
    if (y0 >= GH - 1) y0 = GH - 2;
    var fy = cy - y0; if (fy < 0) fy = 0; else if (fy > 1) fy = 1;
    var row0 = y0 * GW, row1 = row0 + GW;
    var nrow = ((sy * inv) | 0) * GW;
    for (var sx = 0; sx < W2; sx++, pp += 4) {
      /* a wall is a wall to the subpixel: the field is not sampled across
         it, or tissue against a wall bled onto the wall through the
         interpolation and the coverage ramp — and a wall that has just
         closed beside tissue would have drawn as tissue */
      var nci = nrow + ((sx * inv) | 0);
      if (wallM[nci]) { d[pp] = 46; d[pp + 1] = 50; d[pp + 2] = 40; continue; }
      var cx = sx * inv + half;
      var x0 = cx | 0; if (cx < 0) { x0 = 0; cx = 0; }
      if (x0 >= GW - 1) x0 = GW - 2;
      var fx = cx - x0; if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
      var i00 = row0 + x0, i01 = i00 + 1, i10 = row1 + x0, i11 = i10 + 1;
      var w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      var rr = gndR[i00] * w00 + gndR[i01] * w01 + gndR[i10] * w10 + gndR[i11] * w11;
      var gg = gndG[i00] * w00 + gndG[i01] * w01 + gndG[i10] * w10 + gndG[i11] * w11;
      var bb = gndB[i00] * w00 + gndB[i01] * w01 + gndB[i10] * w10 + gndB[i11] * w11;
      var tt = tF[i00] * w00 + tF[i01] * w01 + tF[i10] * w10 + tF[i11] * w11;
      var vc = 0;
      if (tt > BODY_T * 0.5) {
        var gi2 = (tt * GAM_SCALE) | 0;
        if (gi2 >= GAMN) gi2 = GAMN - 1;
        vc = GAM[gi2];
      }
      /* a bridge's coverage is interpolated too — coverage, not a
         threshold, so a one-cell corridor stays closed and loses its
         corners */
      var nb = vB[i00] * w00 + vB[i01] * w01 + vB[i10] * w10 + vB[i11] * w11;
      if (nb > vc) vc = nb | 0;
      if (vc > 0) {
        var ff = fF[i00] * w00 + fF[i01] * w01 + fF[i10] * w10 + fF[i11] * w11;
        var o2 = vc * 3;
        rr += LUT[o2] * lutGain * ff;
        gg += LUT[o2 + 1] * lutGain * ff;
        bb += LUT[o2 + 2] * lutGain * ff;
      }
      d[pp] = rr > 255 ? 255 : rr; d[pp + 1] = gg > 255 ? 255 : gg; d[pp + 2] = bb > 255 ? 255 : bb;
    }
  }
  octx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------
   9b. the vein layer — the network drawn as lines
   ------------------------------------------------------------
   The field above is 420x260 and is shown across a canvas five or six times
   that wide, so one cell is five or six display pixels and a one-cell vein
   can never be anything but a soft five-pixel smudge however the field is
   filtered. That is why the dish used to read as glowing goo: not the
   simulation, the raster. Physarum is not a glow. It is a drawing — filaments,
   forks, a lattice of lines — and a drawing has to be drawn at the resolution
   it is looked at.

   So the veins are STROKED, in display space. Two passes, because the
   organism has two halves and they want different pens:

   THE LATTICE is traced out of the trail field. Every cell is tested for
   being on a ridge — a local maximum ACROSS some direction, with real
   curvature there rather than a plateau — and each ridge cell contributes one
   short segment along the ridge. Neighbouring ridge cells overlap, so what
   comes out is a continuous line down the centre of every tube, at canvas
   resolution, with the width and colour taken from how much trail the tube
   carries. Trunks draw broad and pale, minor veins draw as hairlines, and the
   holes between them are holes.

   Tracing the FIELD rather than the agents is the part worth keeping. The
   obvious alternative — stroke the path each agent walks — was tried and is
   wrong: the agents are spread through the whole body at any instant, most of
   them between the veins rather than on them, so what it draws is a stipple
   of the plasmodium's area and the lattice does not appear at all. The veins
   are a property of the accumulated field, so the field is what to read.

   Where the body is a saturated sheet the curvature test finds no ridge and
   draws nothing, which is right: a sheet is not a line, and the field layer
   underneath already renders it as a sheet.

   THE FRONT is drawn from the agents, because that half genuinely is the
   agents: a whisker along each tip's heading, so the growing edge reads as a
   fan of spikes probing the agar, which is what it is. A tip has no tube yet
   for the ridge trace to find, so without this the newest growth — the part
   worth watching — would be the one thing not drawn.

   Both are recomputed from scratch every frame. Nothing accumulates, nothing
   is stateful, nothing needs resetting between runs, and the picture is the
   same at x1 and x12 rather than depending on how many steps a frame
   happened to fit in. Nothing here feeds back into the simulation and nothing
   draws from the RNG, so the determinism contract in section 0b is untouched:
   this is a second way of looking at the same dish, not a change to it. */
var RIDGE_MIN = 5.0;   // trail below which a ridge is noise, not a vein
/* Curvature floor. It is doing more than rejecting flat ground: on a nearly
   flat patch the four directions score almost the same, so which one wins is
   decided by noise, and neighbouring cells pick different winners. Their
   segments then cross instead of joining and the vein grows a fringe of barbs
   down both sides. Demanding real curvature keeps the direction stable along a
   tube, which is what makes the segments line up into a line. */
var RIDGE_K   = 0.55;  // minimum across-vein curvature to count as a ridge
/* And the same floor again, relative to how much trail the cell carries. The
   absolute one alone cannot tell a faint vein from the middle of a saturated
   sheet: curvature scales with height, so a plateau at trail 60 still clears a
   fixed floor on noise alone, and the packed body of the culture came out
   cross-hatched with a rectilinear grid that is an artefact of quantising
   those directions to four. A vein has curvature in proportion to its own
   height whatever that height is; a plateau has none at any height. */
var RIDGE_REL = 0.14;  // ...as a fraction of the cell's own trail

/* Bands: trail ceiling, line width in cells, colour, alpha. A minor vein is a
   bright hairline; a trunk is broad, and brightest because it is carrying
   everything. */
/* Five generations of vein, because the organism has about that many and the
   hierarchy is most of what the picture is. Widths span roughly eight to one,
   the ratio the real thing shows between its finest branches and its trunk.

   `hot` is how far each band walks from the tissue tone toward LAMP — the
   bench light on the crest of a tube. `dim` pulls the finest band back UNDER
   the tissue so it reads as a groove in the sheet rather than a tube on top
   of it. Built once, by tintVeins, off the same palette the field is painted
   in, so a band can never disagree with the body it sits on.

   Where the highlight walks TO is the whole argument, and the honest version
   of it is narrower than it first looks. White is the one tone on this plate
   that never means tissue, and a walk toward it holds hue and holds HSL
   saturation but cannot hold CHROMA, because there is less and less room for
   any at the top of the cube. So the old ramp was capped at 0.24 to stop the
   trunks arriving there as pale streaks, and the cap was doing real work.

   Walking toward LAMP does not repeal that — every walk to a lighter tone
   gives up chroma, this one included, and the ramp below still falls from 180
   at the sheet to 141 at the trunk. What it changes is the exchange rate.
   LAMP is a cream at the tissue's own hue rather than a neutral, so at the
   SAME trunk lightness the crest keeps 141 of chroma where a white walk on
   this same body keeps 135, and HSL saturation 0.887 against 0.860. A few
   percent, not a transformation. It compounds with the body change, though,
   and that one is not a few percent: the old trunk, white-walked off the old
   yellow, held 117.

   The larger `hot` numbers are not a loosened cap. LAMP sits far closer to
   the tissue than white does, so a longer walk buys the same distance: 0.44
   here lands the trunk at lightness 0.688, which is exactly where the old
   0.24 landed it. The hierarchy below spans 0.49 to 0.69 and every step of it
   is plainly yellow. What the cap protected against is simply gone — walk
   this ramp as far as it goes and it arrives at #fff0b0, a warm cream, rather
   than at white.

   The 7:1 floor still binds, and still binds HERE: applyPalette reads the
   widest band's `hot` through hotBandK, so raising or lowering this number
   tightens or loosens the same solve rather than escaping it. The shipped
   trunk clears the dish at 12.8.

   These lines are the HIGHLIGHTS and nothing else. The bands used to carry
   shadows too — a dark stroke offset beside each crest, tried at several
   depths and geometries — and every version misattributed itself: the veins
   trace the body's whole skeleton, so their offset dark copies summed to a
   drop shadow under the body, the one thing this dish must never wear. The
   shading that makes the organism read as a raised mass is the field's own
   inner shadow now (section 9, ISH_D), computed from the SHAPE of the mold
   rather than drawn along its veins; the crests stay where light belongs,
   on top of it. */
/* The sixth band is the vein graph's, for the tubes of the packed core.
   With the body drawn under the lines, a line is a highlight only where
   it is lighter than the tissue it lies on, and the body's own levels
   walk to 0.50 at the core (BODY_HOT): the 0.44 that was the brightest
   thing on a dark plate vanishes on a trunk at trail 52, and at 40 the
   core's tubes carried lines the eye could not find. So the trunk band
   stops at trail 40 — the seventh body level, where the tissue is at
   0.34 — and above it the core's tubes take 0.64, a step of the same
   size over their tissue as every band below takes over its own. The
   walk ends at cream, not white (see above), so this is still yellow;
   and since hotBandK reads the widest band, the palette solve's 7:1 is
   asked of this tone now, which it clears further than the old trunk
   did. */
var VEIN_BANDS = [
  { max: 6,        w: 0.34, hot: 0.00, dim: 0.86, alpha: 0.90, style: '' },
  { max: 10,       w: 0.62, hot: 0.08, dim: 1.00, alpha: 0.97, style: '' },
  { max: 16,       w: 1.05, hot: 0.18, dim: 1.00, alpha: 1 },
  { max: 26,       w: 1.75, hot: 0.30, dim: 1.00, alpha: 1 },
  { max: 40,       w: 2.70, hot: 0.44, dim: 1.00, alpha: 1 },
  { max: Infinity, w: 3.20, hot: 0.64, dim: 1.00, alpha: 1 }
];
/* The lobe layer: the swellings, drawn as swellings.

   The line layer above draws the network where the network is a LINE, and
   correctly draws nothing where it is not: the ridge test finds no ridge on a
   plateau, so a pad of cytoplasm sitting on a flake and a lobe parked at a
   junction both came through as bare field — flat tissue colour, no crest, no
   hierarchy, indistinguishable from a wide smear of body. The organism's two
   most characteristic masses were the two things the renderer had no pen for.

   This is that pen, and it asks the simulation where the masses are rather
   than trying to infer them from the field. The first attempt did infer them
   — any cell whose blurred trail was high and had stayed high under a wider
   blur — and it drew the wrong picture for a reason worth keeping: the
   densest tissue in a dish is not a lobe at all, it is the inoculation drop
   and the packed sheet around it, so the layer painted a single pale mass
   across the middle of the plate and lost the lobes it was written for inside
   it. The simulation knows exactly which cells are junction and which are
   meal. Asking it is both cheaper and right.

   Like the bands above it, this is a HIGHLIGHT and nothing else. A first
   version filled an offset dark copy under each mass, which is the same
   mistake the vein shadows were: a swelling drawn with its own cast shadow
   is a sticker on the plate, and the shading that makes it read as raised is
   the field's inner shadow (section 9, ISH_D), which already covers it —
   a lobe is body, so the shape's own shadow shades it along with everything
   else the mold is made of.

   Drawn as the OUTLINE of the marked cells rather than as a disc on each:
   the marked cells are a mask on the two-cell lattice, the mask's boundary
   is traced (marching squares, two Chaikin passes to take the corners off),
   pushed outward by LOBE_OUT so a single row of cells is as wide as the
   discs it replaces, and filled once. A union of discs took whatever shape
   the field had, which was the point of it, but its edge was the discs' —
   scalloped by a quarter of a cell everywhere and beaded wherever the
   lattice thinned — and with the sheet gone from under it that edge was the
   picture. A traced outline has the same shape and one edge. */
/* Junction mark at which a lobe is drawn. A fork lays 0.70 or more at its
   centre and a corner up to 1, both falling to nothing over KNOT_SPREAD, so
   the mark is above 0.30 across most of a dense mesh: measured on First
   Contact at 40 s, 713 of 7,721 body cells on the lattice were over 0.30
   and 190 over 0.50, and with the sheet gone the 0.30 layer drew the whole
   core as a chain of masses four cells wide. At 0.50 a mass is the centre
   of a fork or a tight corner, and the tube between is the vein's. */
var LOBE_MARK = 0.50;
var LOBE_PAD  = 24;    // ...and the blurred trail a pad needs to be drawn at all
/* ...and the sheet. A flat plateau of tissue — the inoculation drop, a pad
   that has spread past its flake, the packed body between trunks — has no
   ridge for the line layer and, unless it sits on food, had no mass
   either, so the drop drew as a ring around nothing while the centre was
   as full as anywhere. A cell above LOBE_PAD with no ridge within
   SHEET_R cells is sheet, and is a mass. The radius is what keeps a
   trunk's flanks out of it: a trunk has a ridge down its middle. */
var SHEET_R   = 3;     // cells from the nearest ridge for tissue to count as sheet
var rnear = new Uint8Array(NCELL), rnearH = new Uint8Array(NCELL);
var LOBE_OUT  = 0.5;   // how far past the mask's boundary a mass is drawn, cells
/* the mask itself, one slot per lattice cell: the presence tier the cell is
   drawn at, or -1. Filled from lseg/lbuck at bake, read by the tracer. */
var LW = GW >> 1, LH = GH >> 1;
var ltier = new Int8Array(LW * LH);
/* ...and which of those cells the tracer will actually draw: a lone cell,
   or two touching only at a corner, trace as four-point loops that the
   tracer drops, so a cell is drawn iff a four-neighbour on the lattice is
   marked too. The joins reach for drawn masses, not for marks. */
var ldrawn = new Uint8Array(LW * LH);
var lnext = new Int32Array(LW * LH * 2);  // marching-squares edge links, per trace
var lseen2 = new Uint8Array(LW * LH * 2);
/* One slot per cell of the two-cell lattice, so the list cannot overflow and
   there is no cap to test against inside the loop that fills it. */
var LOBE_CAP  = ((GW >> 1) + 1) * ((GH >> 1) + 1);
/* Which lattice cells were drawn as mass last rebuild, and how far past its
   threshold one of them is held for having been. Same reluctance as the vein
   layer's, for the same reason and against the same noise — see RIDGE_HOLD. */
var lmark = new Uint8Array(NCELL);
var LOBE_HOLD = 0.65;    // combo-mid: marked masses hold their mark harder
var lseg = new Float32Array(LOBE_CAP * 2);
/* the presence tier each emitted mass is drawn at — filled beside lseg, read
   at bake; the envelope block further down holds the rest of the machinery */
var lbuck = new Uint8Array(LOBE_CAP);
var lsegN = 0;
var lobePath = null;
/* every mass at FULL radius, tier-independent — the veil composite's punch.
   A lobe that returns in a smaller tier must still clear the whole footprint
   of its former self from the accumulator, or the outer ring of the old disc
   survives as a fading halo around the smaller new one. */
var lobeMaskPath = null;
var LOBE_STYLE = '';
/* ---- the body: the tissue itself, as filled bands ----
   The line layer draws crests and the mass layer draws junctions, and
   between them the picture was a web of hairlines on dark: the organism's
   tubes are wide, soft-edged and continuous, and a crest is a line a cell
   wide that the trace re-finds every rebuild. Measured a second apart on
   First Contact, less than half the drawn crest cells were still crest and
   a fifth were more than a cell from any — the network drawn as lines
   re-routes on the second, and at thirty rebuilds a second that reads as
   lightning. The eased trail, drawn as a picture, does not: it is the same
   mesh of wide bands the plate shows through a microscope, and its ISO
   masks a second apart keep four fifths of their cells raw and nineteen
   twentieths under a 1.5-second ease, against the crests' half.

   So the body is drawn as what it is: the iso-bands of the eased trail,
   each level traced as a closed outline (marching squares with the crossing
   interpolated along the edge, so the edge slides with the field rather
   than stepping a cell at a time) and filled, outer to inner, from a
   translucent film at the edge of tissue to the lamp-lit core. Vector, like
   the lines were — a handful of Path2D fills a rebuild, nothing rasterised.

   The line layer is not drawn while this is, and not built: a crest is a
   line re-found every rebuild, and it cannot be kept where it is, because
   the ridge it marks moves. Pinning was tried — a settled run laid down at
   its coordinates for good, later traces within two cells of it treated as
   the same vein and not drawn — and the record it left was a scatter of
   dashes: a tube several cells wide collects two or three parallel
   fragments pinned at different moments, and the crests end at every
   junction, so there is no one line per vein to pin. The bands are the
   vectors that hold still, and the tubes they draw are the veins. The
   masses are not drawn either: a junction is body, and the body is drawn.
   The line machinery stays under the flag, for the day it is wanted. */
var BODY = true;
/* ...and whether the bands are FILLED. They are not: the picture is the
   veins alone, each stroked at the width of the tube it runs down, and
   the filled bands under them read as pills in a tube — a contour map of
   the tissue, stepped at every level, which is not what a tube looks
   like. The body is still traced for the graph (its mask, its distance
   transform, the ridge of that) and still eased and recorded; only the
   fills and the footprint are not drawn. */
var BODY_FILL = false;
/* A vein's stroke is the tube: twice the eased half-width the distance
   transform read under its points (the medial axis IS the half-width),
   scaled by VEIN_TUBE, never thinner than its band's hairline and never
   wider than VEIN_TUBE_MAX cells. Widths are quantised to VEIN_TUBE_Q
   steps a cell so the painter can batch strokes of a width into one
   path; a quarter-cell step is under a screen pixel at every size the
   plate is drawn at. */
var VEIN_TUBE     = 1.0;
var VEIN_TUBE_MAX = 48;
var VEIN_TUBE_Q   = 4;
/* ---- the tubes ----
   The picture. Each rebuild the skeleton of the tissue mask — the ridge
   of its distance transform, walked into chains as the crests were — is
   stroked at twice the half-width the transform read under each point.
   A skeleton stroked at its own width reconstructs the shape it is the
   skeleton of (that is what a medial axis is), so the tubes come out as
   the mask's tubes: continuous, tapering, one tone per width rather than
   a contour map, and as steady as the eased mask itself. Chains shorter
   than RIDGE_MINPTS are not walked, which drops the mask's speckle for
   free. Widths are quantised so a run of one width is one stroke, and
   every stroke is coloured by its width: a hairline is the tissue tone,
   a trunk walks toward the lamp, so the hierarchy reads without bands.

   The pinned graph (VEIN_GRAPH) was the attempt to draw the veins as
   frozen centrelines; stroked at width over a field that drifts a cell a
   second it beaded and gapped, and as hairlines it went stale. It is
   kept, off, for the record it can make and for a day the picture wants
   a fixed skeleton again. */
var VEIN_GRAPH = true;                  // pin and paint the frozen graph
/* ...or grow the veins as a tree into the tissue instead of pinning
   the trail's skeleton — see the backbone section before resetVeinGraph. */
var VEIN_TREE = true;
/* ...and whether the tubes are stroked at all. They are not: the user
   wants LINES — the veins as a drawing, the pinned graph's strokes at
   the band widths on the bare plate — not the tissue as a shape. The
   tube stroke stays in the file, off. */
var TUBES = false;
var TUBE_KEYS = VEIN_TUBE_MAX * VEIN_TUBE_Q + 2;
var TUBE_TIP = 0.35, TUBE_TIP2 = 0.7;   // a chain's end widths, as shares of the transform's
var tubePaths = new Array(TUBE_KEYS);
var TUBE_STYLE = new Array(TUBE_KEYS);
var tubeD = new Float32Array(4096);     // a chain's half-widths, smoothed
/* a key from a half-width: the stroke's width in quantised steps */
function tubeKey(d) {
  var w = 2 * d * VEIN_TUBE;
  if (w < 0.5) w = 0.5;
  if (w > VEIN_TUBE_MAX) w = VEIN_TUBE_MAX;
  return Math.round(w * VEIN_TUBE_Q);
}
/* The outlines of the pieces no vein stands in: the pinned points are
   mapped to the lattice and their pieces marked, then the mask level of
   the eased body is traced and only the loops inside an unmarked piece
   are kept. Read before this rebuild's pinning, so a piece is outlined
   for one rebuild after its first vein — a blink no one sees. */
function bodyOutlines() {
  /* the tree draws the drop's veins from the first second, so there is
     no vein-less piece to outline */
  if (VEIN_TREE) { outlinePath = null; return; }
  var p, i;
  for (i = 0; i <= compN; i++) { compVein[i] = 0; compPts[i] = 0; }
  for (p = 0; p < vpN; p++) {
    var lc = ((vpy[p] | 0) >> 1) * LW + ((vpx[p] | 0) >> 1);
    if (lc >= 0 && lc < LW * LH && compL[lc]) { compVein[compL[lc]] = 1; compPts[compL[lc]]++; }
  }
  rootLab = 0;
  if (S.exp && S.exp.inoc) {
    var rl = ((S.exp.inoc.y | 0) >> 1) * LW + ((S.exp.inoc.x | 0) >> 1);
    if (rl >= 0 && rl < LW * LH) rootLab = compL[rl];
  }
  rootLoopN = 0;
  outlinePath = compN ? traceIso(bodyV, BODY_LEVELS[VEIN_MASK], false, outlineKeep) : null;
  if (rootLoopN && rootLab && !compVein[rootLab] && S.simT - rootT0 >= ROOT_DELAY) { pinRootLoop(); outlinePath = null; }
}
/* ...and only a loop long enough to be the piece's edge: the holes the
   drop opens as it empties in the middle traced as bright rings inside
   the outline, and a hole is not an edge anyone needs drawn */
var OUTLINE_MINPTS = 60;
function outlineKeep(cell, m) {
  if (m < OUTLINE_MINPTS) return false;
  var lc = (((cell / GW) | 0) >> 1) * LW + ((cell % GW) >> 1);
  var lab = compL[lc];
  var ok = lab > 0 && !compVein[lab] && compSize[lab] >= OUTLINE_MIN_L;
  /* the root piece's longest loop is kept aside: it may become the first
     vein (the loop's points stand in isoPX/isoPY while keep is called) */
  if (ok && lab === rootLab && m > rootLoopN && m <= 4096) {
    for (var q = 0; q < m; q++) { rootLoopX[q] = isoPX[q]; rootLoopY[q] = isoPY[q]; }
    rootLoopN = m;
  }
  return ok;
}
/* the drop's edge as a vein: every second crossing (they are a cell
   apart), closed by its first point, attached to itself */
function pinRootLoop() {
  var n = rootLoopN >> 1;
  if (n < 8 || veinN >= VEIN_MAX || vpN + n + 1 > VEIN_PTS_CAP) return;
  var v = veinN++, sum = 0, k;
  vStart[v] = vpN;
  for (k = 0; k < rootLoopN; k += 2) {
    var c = (rootLoopY[k] | 0) * GW + (rootLoopX[k] | 0);
    vpx[vpN] = rootLoopX[k]; vpy[vpN] = rootLoopY[k]; vpW[vpN] = bodyD[c]; vpLive[vpN] = 1; vpN++;
    sum += bodyV[c];
  }
  vpx[vpN] = vpx[vStart[v]]; vpy[vpN] = vpy[vStart[v]]; vpW[vpN] = vpW[vStart[v]]; vpLive[vpN] = 1; vpN++;
  vCount[v] = vpN - vStart[v];
  vFlow[v] = sum / n;
  vBand[v] = veinBand(vFlow[v], 255);
  vBorn[v] = S.simT;
  vState[v] = 1;
  vRoot[v] = 1;
  vAtt[v * 4] = v; vAtt[v * 4 + 1] = 0; vAtt[v * 4 + 2] = v; vAtt[v * 4 + 3] = 0;
  vNext[v] = -1; vPrev[v] = -1;
  for (k = vStart[v]; k < vpN; k++) coverPoint(k);
  vRepaint = true;
}

/* one chain of n points into the tube paths: the half-widths under its
   cells, one 1-2-1 pass along the chain so the transform's integer steps
   do not bead, then runs of one key, each a subpath of quadratics
   through the midpoints; consecutive runs share their boundary point */
function emitTube(n) {
  var k, a, key;
  for (k = 0; k < n; k++) tubeD[k] = bodyD[chi[k]];
  if (n >= 3) {
    var dp = tubeD[0];
    for (k = 1; k < n - 1; k++) { var dc = tubeD[k]; tubeD[k] = (dp + 2 * dc + tubeD[k + 1]) * 0.25; dp = dc; }
  }
  /* A chain's ends taper. A tube's tip is thin, and a chain that ends at
     a junction is inside the other chain's width there, so the taper
     costs nothing; what it stops is the knob — a short spur off a
     boundary bump ended in a round cap of the bump's own radius, and
     every tube wore a row of beads. */
  tubeD[0] *= TUBE_TIP; tubeD[n - 1] *= TUBE_TIP;
  if (n >= 4) { tubeD[1] *= TUBE_TIP2; tubeD[n - 2] *= TUBE_TIP2; }
  k = 0;
  while (k < n - 1) {
    a = k;
    key = tubeKey(tubeD[k + 1] > tubeD[k] ? tubeD[k + 1] : tubeD[k]);
    while (k < n - 1 && tubeKey(tubeD[k + 1] > tubeD[k] ? tubeD[k + 1] : tubeD[k]) === key) k++;
    var path = tubePaths[key] || (tubePaths[key] = new Path2D());
    path.moveTo(chx[a], chy[a]);
    if (k - a === 1) { path.lineTo(chx[k], chy[k]); continue; }
    for (var q = a + 1; q < k; q++) path.quadraticCurveTo(chx[q], chy[q], (chx[q] + chx[q + 1]) * 0.5, (chy[q] + chy[q + 1]) * 0.5);
    path.lineTo(chx[k], chy[k]);
  }
}
/* Its own ease, longer than the crests' VEIN_TAU: an outline that lags the
   tissue by a second is a tube swelling and thinning, where a crest that
   lagged by a second would be drawn a cell off the tube it marks. */
var BODY_TAU = 1.5;                     // sim-seconds of memory
var bodyV = new Float32Array(NCELL);
/* The levels, in trail: the film below BODY_T where tissue begins, the tube
   at TIP_FEED where a filament counts as supplied, and three above it up to
   the packed core. hot walks each toward the lamp as the vein bands do. */
/* Ten of them, graded closely, so a tube shades from its edge to its crest
   rather than stepping through a contour map: five levels read as
   posterised. The film — the first level — is milky, the front's tone
   (mixWhite, as TIP_STYLE), because tissue that thin lets the plate
   through and is pale, not the tissue tone at a third alpha, which drew a
   dark olive halo round every tube. */
var BODY_LEVELS = [6, 9, 12, 16, 20, 26, 32, 40, 52, 66];
var BODY_HOT    = [0.00, 0.00, 0.04, 0.10, 0.16, 0.22, 0.28, 0.34, 0.42, 0.50];
var BODY_ALPHA  = [0.30, 0.60, 0.90, 1, 1, 1, 1, 1, 1, 1];
var BODY_STYLE  = [];
var bodyPath = [];
(function () { for (var i = 0; i < BODY_LEVELS.length; i++) bodyPath.push(null); })();
/* a loop shorter than this is speckle or a pinhole: at 16 crossings it is
   a blob under four cells across, which drawn was a droplet beside the
   tube it fell off */
var ISO_MINPTS = 16;
/* the tracer's working set: per cell, the least and greatest of its four
   corners, so a level tests two numbers per cell rather than four loads;
   per edge, where the level crosses it and which edge the outline continues
   to, stamped per level rather than cleared */
var isoMin = new Float32Array(NCELL), isoMax = new Float32Array(NCELL);
var isoX = new Float32Array(NCELL * 2), isoY = new Float32Array(NCELL * 2);
var isoNext = new Int32Array(NCELL * 2);
var isoMark = new Int32Array(NCELL * 2), isoSeen = new Int32Array(NCELL * 2), isoStamp = 0;
var isoList = new Int32Array(NCELL * 2), isoListN = 0;
/* a loop can be at most every edge once, so the point buffers cannot overflow */
var ISO_LOOP_CAP = NCELL * 2;
var isoPX = new Float32Array(ISO_LOOP_CAP), isoPY = new Float32Array(ISO_LOOP_CAP);

/* ---- the veins: a graph that is drawn once and kept ----
   The body above is the tissue; these are the lines on it — the crest
   highlight along each tube, which the old line layer drew by re-finding
   the ridges of the trail every rebuild. A ridge of a moving field moves,
   and the lines flickered like lightning: measured a second apart on
   First Contact, under half the drawn crest cells were still crest. The
   requirement is the opposite of that, and it is stated once here because
   every constant below serves it: keep a vector where it is.

   So a vein is created once, from a ridge that has held still long enough
   to be trusted, and its coordinates are then frozen for good — never
   moved, never erased, never re-traced. What stays live is its WIDTH,
   read off the tissue under it each rebuild: a vein thickens with use and
   thins when starved, and a vein the tissue has left is kept as a dim
   record, the track a withdrawn tube leaves on the agar. The picture is
   then a drawing that only ever gains lines, which is what a time-lapse
   of a plate shows, and nothing on it ever twitches.

   The graph is CONNECTED BY CONSTRUCTION rather than by any later join
   pass. A candidate stretch is pinned only if one of its ends attaches:
   either to an existing vein, in which case that vein's nearest point —
   its exact coordinates — is added as the end, so the two are one line
   with no gap and no overlap to knot; or to the body itself, where the
   end stands on supplied tube (VEIN_ATTACH). A stretch with nothing to
   hang from waits; the tube it marks is still growing toward something,
   and next second it will have arrived.

   The first attempt at this pinned a settled run as soon as it appeared,
   two cells of proximity and no linking, and left a scatter of parallel
   dashes: a tube several cells wide collects two or three crest
   fragments at different moments, and the crests end at every junction.
   The three things below that the attempt lacked are the settle time
   (a crest is trusted only after it has stood in the same cells for a
   while), the coverage radius (a pinned vein owns the tube around it, and
   nothing is pinned inside that), and the snap (so a fragment cannot be
   pinned beside a vein — it can only be pinned onto its end). */
/* Sim-seconds a cell must have been ridge, CONTINUOUSLY, before a chain
   through it can be pinned. The ridge pass has hysteresis of its own, so
   a cell that qualifies is already one the trace has agreed on for a few
   rebuilds; this is the longer wait for the crest to stop wandering as
   the tube behind the front settles. A growing tube's newest cells are
   always unsettled, which is right: the front is drawn by the whiskers,
   and the vein arrives a second behind it, where the tube is. */
var VEIN_SETTLE = 0.5;   /* was 1.0: with nothing drawn under the lines, a tube half a second old with no line is a gap */
/* Cells from a pinned point that count as that vein's: a ridge cell
   inside the disc is the same tube and is never pinned again. Euclidean,
   not a square, so a diagonal tube's coverage ends at the same distance
   as a straight one's — the snap radius has to clear this in every
   direction or a stretch on a diagonal would begin just out of reach of
   the vein it continues and wait forever. Wider than the two cells the
   first attempt used, since a trunk at full flow is five or six cells
   across and its crest can lie anywhere in the middle of that. */
var VEIN_R = 3;
/* Cells within which a stretch's end snaps onto an existing vein point.
   Greater than VEIN_R plus a diagonal step, for the reason above: the
   first uncovered cell of a continuing stretch lies just past the disc,
   and must be within reach of the point at its centre. */
var VEIN_SNAP = 5;
/* Points an uncovered stretch needs to be pinned when it stands on its
   own, attached to the organism only through the tissue. Below this it
   is the last few cells of a tube that a longer stretch will claim next
   second. A stretch that snaps onto a vein is held to what it is
   instead — see pinChain — and one that continues a vein may be as
   short as two points: two veins along one tube whose ends stand a few
   cells apart leave a gap the coverage discs nearly close, and the cells
   between them are never six; under a flat rule that gap was permanent,
   and a tube drawn as collinear dashes is the scatter this layer must
   not make. One cell is speckle whatever it stands between. */
var VEIN_MINLEN = 6;
var VEIN_BRIDGE_MIN = 2;
/* A branch shorter than this many times the distance field at its root
   (plus a cell) is a spur of the medial axis — see the test in
   pinChain. One and a half: a bump's spur is about the half-width long,
   and a tube that has cleared the trunk's edge by half again the
   trunk's half-width is a tube. */
var VEIN_SPUR = 1.5;
/* The body level the lines live on: the index into BODY_LEVELS of the
   mask whose medial axis is traced (see bodyD), and the level at which
   a stretch's end counts as attached to the organism without a vein to
   snap to. The first design attached only to the packed core, on the
   picture of a graph growing outward from the inoculation drop by
   successive snaps, and measured at 40 seconds on First Contact it had
   pinned 260 veins while 2,100 settled ridge cells waited uncovered:
   the outer mesh is not grown from the drop, it CONDENSES out of the
   sheet everywhere at once, and a graph that can only reach it by
   adjacency never does. A tube is body, and the simulation keeps the
   body one piece by its own rule, so a vein standing on body is
   connected to every other through the tissue whether or not a line
   yet joins them; the lines then close the gaps between themselves as
   bridges.

   The first level, trail 6, where tissue begins to be drawn — not the
   tube level, 12, which was the first choice: the outer network on
   First Contact at 40 seconds is thin, and its left quarter held 4,600
   cells of drawn tissue of which 640 reached 12, so the mask had no
   tube there to take an axis of and the long tubes out to the food,
   the ones the eye follows, carried no line at all. The old line layer
   read crests from trail 5. A vein's measure falling under this same
   level is what makes it a record, so the lines live exactly where the
   body is drawn and are ghosts exactly where it is not. */
var VEIN_ATTACH = 0;
/* The level the distance field is taken of, index into BODY_LEVELS: one
   above the attachment level. The medial axis of the film at trail 6
   is the middle of the FILM, and where a tube's film skirt is wider on
   one side than the other — every tube at the edge of a sheet — that
   ran a cell or two off the tube's crest, along the skirt. The mask at
   9, where the sim counts tissue as begun, hugs the tubes. Attachment
   stays at 6: a line may end on film. */
var VEIN_MASK = 1;
/* ...for the GRAPH. The tubes are stroked from the mask at the film,
   BODY_LEVELS[TUBE_MASK]: a tube stroked at the width of its mask draws
   the film as its own thin skirt, which is where the front's fans are,
   and a corridor's sheet as one piece rather than the patches it is at
   trail 9. The skirt's off-centre axis does not matter to a stroke that
   is the tube's whole width. That was the first try, and it drew a slab:
   the skirt inflated every tube to the width of its neighbour's and the
   hierarchy went with it. The mask at 9 hugs the tubes; the fans at the
   front are the whiskers' to draw. */
var TUBE_MASK = 1;
/* A branch — a stretch that meets a vein anywhere but straight into its
   end — has to be longer than a bump's spur could be, and a spur's
   length is the trunk's half-width and a little more; and it has to END
   somewhere: at the mask's edge, a tip, or on another vein. A branch
   that stops inside the body having reached nothing is the medial axis
   of a bump, whatever its length. Measured on First Contact at 40
   seconds with the spur test alone, 2 to 6 cell barbs stood off every
   trunk. */
var VEIN_BRANCH_MIN = 6;                     /* points, whatever the trunk */
var VEIN_BRANCH_K = 2.5;                     /* times the half-width at the root... */
var VEIN_BRANCH_PAD = 4;                     /* ...plus this */
/* the box the mask occupies, for pass one and two to sweep instead of the
   plate — set by bodyMask, inclusive, with a two-cell margin inside the
   rim */
var bmX0 = 2, bmY0 = 2, bmX1 = GW - 3, bmY1 = GH - 3;
/* ---- the field the ridges are read from ----
   Not the body itself. The ridge test asks for a strict maximum across
   the vein with a drop of RIDGE_REL per cell either side, which is what
   a crest of the trail looks like on a filament two or three cells
   wide, and is nothing like the top of a trunk: a trunk at full flow is
   nine cells across with a flat top, so it has no maximum at its axis
   and the only crests found on it were the noise bumps on its shoulders
   — exactly the ridges that wander, and the first build of this layer
   drew them as bright dashes down both flanks of every trunk with
   nothing along the middle. What has a ridge along a tube's axis at
   every width is the DISTANCE from its edge: the Euclidean distance
   transform of the tube-level mask rises one cell per cell from either
   side to the middle and turns over there, with across-curvature two
   whether the tube is three cells wide or twelve. Its ridge is the
   medial axis — one line per tube, through every junction — and the
   whole of pass one and pass two run on it unchanged: the hysteresis,
   the direction stickiness, the parabolic fit and the walk were built
   for a field with crests, and this is a field of nothing but crests.

   The mask is the body at the level VEIN_ATTACH names — where tissue
   is drawn at all; see there for why not the tube level. The transform is
   a two-sweep chamfer with weights one and root two — the exact
   transform (Felzenszwalb and Huttenlocher's separable envelope) was
   written first and measured at 4.2 ms against the chamfer's 1.7 on a
   grown dish, for a mean difference of a quarter of a cell and none of
   it where it matters: the ridge needs the fold to be symmetric about
   the tube's axis, which any metric gives it, and the chamfer's
   octagonal error is largest far from every edge, inside the core,
   where nothing is read. */
var bodyD = new Float32Array(NCELL);        /* distance to the mask's edge, cells; 0 outside */
var DT_INF = 1e9;                           /* a distance no sweep leaves in place */
var DT_R2 = 1.4142135;
/* Floors for the ridge test on the distance field, in cells, standing in
   for RIDGE_MIN's trail units: a crest under a cell from the edge is a
   tube two cells wide, which is film with a line through it. And a
   ceiling: a cell further than this from any edge is inside the packed
   core, whose medial axis is a spray of spokes toward every bump on its
   outline and not a vein — the old layer drew nothing on a plateau, and
   neither does this. Twelve, because the trunks that leave the core on
   First Contact at 40 seconds are fourteen to eighteen cells across and
   a ceiling of seven left every one of them without a line, which is
   the opposite of the hierarchy the lines are for; the drop itself is
   thirty and more across for its first seconds and is inside this. */
var VEIN_DT_MIN = 1.0;
var VEIN_DT_MAX = 30.0;  /* was 12 while the body was drawn under the lines; with nothing under them a corridor forty cells wide had no line at all */
/* ...and no ceiling at all for the tubes: a sheet is drawn by the stroke
   down its middle, and a stroke that stopped at twelve left a forty-cell
   corridor as a few sausages and a scatter of blobs. */
var TUBE_DT_MAX = 1e9;
/* A hole in the sheet smaller than this, in cells, is a pinhole and is
   filled before the transform: the medial axis of the tissue round a
   hole is a ring at the hole's radius, and a ring pinned round a pinhole
   stays a ring inside the tube that later grows over it. A hole this
   size or larger is a mesh cell opening, and the ring round it IS the
   tubes that will bound it. Forty cells is about seven across. */
var VEIN_HOLE = 40;
var bodyM = new Uint8Array(NCELL);          /* the mask: 1 inside, holes filled */
/* the fill runs on the two-cell lattice, a quarter of the cells: a
   lattice cell is open where any of its four is, so a channel a cell
   wide stays a channel and no opening is walled off into a hole that
   is not one; holes are then measured in lattice cells */
var holeL = new Uint8Array(LW * LH);
var holeQ = new Int32Array(LW * LH);        /* the flood's queue; a cell enters once */
var VEIN_HOLE_L = VEIN_HOLE >> 2;
/* ---- the outline of tissue with no vein ----
   A compact piece of tissue — the inoculation drop above all, a disc of
   four thousand cells — has a medial axis that is a point, and a point
   is no chain: for its first seconds the drop drew as nothing, a ring
   of whiskers round the dark. With lines and nothing else, the one line
   such a piece has is its edge. So each connected piece of the mask is
   labelled on the lattice, and a piece no pinned vein stands in is
   drawn as its outline, a line at the mask's level in the third band
   (a hairline, honestly composited, was too faint to find the drop by),
   until a vein forms inside it and the outline goes. A tube that has veins is never
   outlined: the outline round a tube would be the pill again. */
var compL = new Int16Array(LW * LH);         /* piece label per lattice cell, 0 none */
var COMP_MAX = 4096;
var compVein = new Uint8Array(COMP_MAX);     /* a pinned vein stands in this piece */
var compSize = new Int32Array(COMP_MAX);     /* lattice cells in the piece */
var compPts = new Int32Array(COMP_MAX);      /* pinned points standing in the piece */
var compN = 0;
var rootLab = 0;                             /* the piece the inoculation point stands in, 0 none */
/* The root is the drop. A line may begin on the drop's own piece — a
   settled ridge standing on it, attached to nothing — until the piece
   carries ROOT_PTS pinned points; from then on every line grows from
   the end of another. A disc round the inoculation point was tried as
   the root and seeded nothing for the first ten seconds: the drop
   empties in the middle before its ridges settle, so the ridges stood
   outside the disc. */
var ROOT_PTS = 80;
/* ...and the drop's edge is the FIRST vein. Seeds on the drop were each
   a line of their own, and with the drop's middle empty and undrawn
   they grew into separate trees — several organisms, to the eye. So
   the first thing pinned is the drop's outline itself, as a closed vein
   a ROOT_DELAY after inoculation, and every seed attaches to it: one
   drawing from the first second, everything descending from the edge
   of the drop. A root vein may be attached to at any point, not only
   its ends — a ring has none. */
var ROOT_DELAY = 0.5;                        /* sim-seconds after the dish starts */
var rootT0 = 0;                              /* S.simT at the dish's start */
var rootLoopX = new Float32Array(4096), rootLoopY = new Float32Array(4096), rootLoopN = 0;
/* Only a piece the size of a drop is outlined. The lattice counts a cell
   only when its whole block is tissue, so a network of thin tubes breaks
   into hundreds of pieces a few cells each, and every one that happened
   to have no pinned point on it flashed its outline for a rebuild — the
   perimeter of the tubes, blinking. The drop is over a thousand lattice
   cells; a fragment is a handful. */
var OUTLINE_MIN_L = 150;
var outlinePath = null;

/* The mask at the tube level, with its pinholes filled. Outside is what a
   four-connected flood from the rim reaches — the rim is always outside,
   since the body is zero there — and any open lattice cell the flood did
   not reach is in a hole; a hole under VEIN_HOLE_L lattice cells is
   filled, which puts every fine cell inside its lattice cells into the
   mask. Values in holeL while it runs: 0 open and unknown, 1 tissue, 2
   outside, 3 a hole being measured. */
function bodyMask() {
  var lv = BODY_LEVELS[VEIN_GRAPH ? VEIN_MASK : TUBE_MASK], i, x, y, lx, ly, qh, qt, c, n;
  var x0 = GW, y0 = GH, x1 = -1, y1 = -1;
  for (y = 0; y < GH; y++) {
    i = y * GW;
    for (x = 0; x < GW; x++) {
      if (bodyV[i + x] >= lv) {
        bodyM[i + x] = 1;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      } else bodyM[i + x] = 0;
    }
  }
  /* the box, a cell either side of the mask so the ridge test can read
     its neighbours; an empty mask gives an empty box */
  bmX0 = x0 - 1 < 2 ? 2 : x0 - 1; bmY0 = y0 - 1 < 2 ? 2 : y0 - 1;
  bmX1 = x1 + 1 > GW - 3 ? GW - 3 : x1 + 1; bmY1 = y1 + 1 > GH - 3 ? GH - 3 : y1 + 1;
  for (ly = 0; ly < LH; ly++) {
    for (lx = 0; lx < LW; lx++) {
      i = (ly << 1) * GW + (lx << 1);
      holeL[ly * LW + lx] = (bodyM[i] & bodyM[i + 1] & bodyM[i + GW] & bodyM[i + GW + 1]) ? 1 : 0;
    }
  }
  qh = qt = 0;
  for (lx = 0; lx < LW; lx++) { holeL[lx] = 2; holeQ[qt++] = lx; holeL[(LH - 1) * LW + lx] = 2; holeQ[qt++] = (LH - 1) * LW + lx; }
  for (ly = 1; ly < LH - 1; ly++) { holeL[ly * LW] = 2; holeQ[qt++] = ly * LW; holeL[ly * LW + LW - 1] = 2; holeQ[qt++] = ly * LW + LW - 1; }
  while (qh < qt) {
    c = holeQ[qh++];
    lx = c % LW; ly = (c / LW) | 0;
    if (lx > 0 && holeL[c - 1] === 0) { holeL[c - 1] = 2; holeQ[qt++] = c - 1; }
    if (lx < LW - 1 && holeL[c + 1] === 0) { holeL[c + 1] = 2; holeQ[qt++] = c + 1; }
    if (ly > 0 && holeL[c - LW] === 0) { holeL[c - LW] = 2; holeQ[qt++] = c - LW; }
    if (ly < LH - 1 && holeL[c + LW] === 0) { holeL[c + LW] = 2; holeQ[qt++] = c + LW; }
  }
  /* the pieces: a flood over the lattice's tissue cells, four-connected,
     each labelled from 1; more pieces than COMP_MAX share the last label */
  compL.fill(0); compN = 0;
  for (n = 0; n < LW * LH; n++) {
    if (holeL[n] !== 1 || compL[n]) continue;
    var lab = compN < COMP_MAX - 1 ? ++compN : compN;
    qh = qt = 0;
    compL[n] = lab; holeQ[qt++] = n;
    if (lab === compN && qh === 0) compSize[lab] = 0;
    while (qh < qt) {
      c = holeQ[qh++];
      compSize[lab]++;
      lx = c % LW; ly = (c / LW) | 0;
      if (lx > 0 && holeL[c - 1] === 1 && !compL[c - 1]) { compL[c - 1] = lab; holeQ[qt++] = c - 1; }
      if (lx < LW - 1 && holeL[c + 1] === 1 && !compL[c + 1]) { compL[c + 1] = lab; holeQ[qt++] = c + 1; }
      if (ly > 0 && holeL[c - LW] === 1 && !compL[c - LW]) { compL[c - LW] = lab; holeQ[qt++] = c - LW; }
      if (ly < LH - 1 && holeL[c + LW] === 1 && !compL[c + LW]) { compL[c + LW] = lab; holeQ[qt++] = c + LW; }
    }
  }
  /* what is left at 0 is in a hole: measure each, fill the small ones */
  for (n = 0; n < LW * LH; n++) {
    if (holeL[n] !== 0) continue;
    qh = qt = 0;
    holeL[n] = 3; holeQ[qt++] = n;
    while (qh < qt) {
      c = holeQ[qh++];
      lx = c % LW; ly = (c / LW) | 0;
      if (lx > 0 && holeL[c - 1] === 0) { holeL[c - 1] = 3; holeQ[qt++] = c - 1; }
      if (lx < LW - 1 && holeL[c + 1] === 0) { holeL[c + 1] = 3; holeQ[qt++] = c + 1; }
      if (ly > 0 && holeL[c - LW] === 0) { holeL[c - LW] = 3; holeQ[qt++] = c - LW; }
      if (ly < LH - 1 && holeL[c + LW] === 0) { holeL[c + LW] = 3; holeQ[qt++] = c + LW; }
    }
    if (qt < VEIN_HOLE_L) {
      for (c = 0; c < qt; c++) {
        i = ((holeQ[c] / LW) | 0) * 2 * GW + (holeQ[c] % LW) * 2;
        bodyM[i] = 1; bodyM[i + 1] = 1; bodyM[i + GW] = 1; bodyM[i + GW + 1] = 1;
      }
    }
  }
  /* the rim is outside whatever the fill did: the body is zero there,
     and the sweeps below read one cell past every cell they visit */
  for (x = 0; x < GW; x++) { bodyM[x] = 0; bodyM[(GH - 1) * GW + x] = 0; }
  for (y = 0; y < GH; y++) { bodyM[y * GW] = 0; bodyM[y * GW + GW - 1] = 0; }
}

/* The distance field: a forward sweep carrying the least of each cell's
   four already-visited neighbours plus their step, then a backward one
   over the other four. Inside cells start unreachable and the rim, which
   is outside, bounds both sweeps. */
function bodyDist() {
  var x, y, i, c, d, a;
  bodyMask();
  for (i = 0; i < NCELL; i++) bodyD[i] = bodyM[i] ? DT_INF : 0;
  for (y = 1; y < GH - 1; y++) {
    i = y * GW;
    for (x = 1; x < GW - 1; x++) {
      c = i + x; d = bodyD[c];
      if (d === 0) continue;
      a = bodyD[c - 1] + 1; if (a < d) d = a;
      a = bodyD[c - GW] + 1; if (a < d) d = a;
      a = bodyD[c - GW - 1] + DT_R2; if (a < d) d = a;
      a = bodyD[c - GW + 1] + DT_R2; if (a < d) d = a;
      bodyD[c] = d;
    }
  }
  for (y = GH - 2; y >= 1; y--) {
    i = y * GW;
    for (x = GW - 2; x >= 1; x--) {
      c = i + x; d = bodyD[c];
      if (d === 0) continue;
      a = bodyD[c + 1] + 1; if (a < d) d = a;
      a = bodyD[c + GW] + 1; if (a < d) d = a;
      a = bodyD[c + GW - 1] + DT_R2; if (a < d) d = a;
      a = bodyD[c + GW + 1] + DT_R2; if (a < d) d = a;
      bodyD[c] = d;
    }
  }
}

/* Sim-seconds of memory in a vein's measure, the eased mean of the body
   under its points, from which its width is read. The body itself is
   eased at BODY_TAU already; this is the second ease that turns a band
   crossing into a swell rather than a click. */
var VEIN_W_TAU = 1.0;
/* The graph, in flat arrays: a vein is a run of vCount[v] points from
   vStart[v] in vpx/vpy. Capped hard, and full means no more veins rather
   than eviction — an evicted vein is a vein that moved. 300,000 points is
   about three times the cells a fully grown dish's ridges occupy. */
var VEIN_PTS_CAP = 300000;
var VEIN_MAX = 40000;
var vpx = new Float32Array(VEIN_PTS_CAP), vpy = new Float32Array(VEIN_PTS_CAP);
var vpN = 0;
var vStart = new Int32Array(VEIN_MAX), vCount = new Int32Array(VEIN_MAX);
var vBand = new Uint8Array(VEIN_MAX);      // the band it is drawn in now
var vFlow = new Float32Array(VEIN_MAX);    // the eased measure the band is read from
/* per POINT, not per vein: a tube tapers along its length and a vein
   stroked at one width was a sausage. Eased like the measure, so a tube
   swells and thins rather than clicking between widths. */
var vpW = new Float32Array(VEIN_PTS_CAP);   // the eased half-width under each point, cells
var vBorn = new Float32Array(VEIN_MAX);    // S.simT at pinning
var vState = new Uint8Array(VEIN_MAX);     // 1 live, 0 record
/* what each end attached to when the vein was pinned, four slots per vein:
   [vein, point, vein, point], with vein -1 for an unattached end and -2
   for the core (point -1). Kept for the harness, which checks that no
   vein was ever pinned adrift. */
var vAtt = new Int32Array(VEIN_MAX * 4);
/* the continuation chain: the vein whose first point continues this
   one's last, and the reverse, -1 for none; the painter draws a chain
   as one smoothed line */
var vNext = new Int32Array(VEIN_MAX), vPrev = new Int32Array(VEIN_MAX);
/* per point, whether the body under it is there: a vein's state is one
   thing (its width band is read from the mean), but a vein that crosses
   a hole must not draw bright across the hole, so each SEGMENT is drawn
   live only when both its points are, and into the record otherwise.
   Held with the band margin so a point on the film's edge does not
   flicker the picture. */
var vpLive = new Uint8Array(VEIN_PTS_CAP);
/* a root vein: attach anywhere on it. Allocated here, after VEIN_MAX,
   and not beside the root's other constants above it: declared there it
   was sized by a VEIN_MAX not yet assigned, which is a zero-length
   array, and every write to it was discarded — the ring could be joined
   only at its duplicated end point. */
var vRoot = new Uint8Array(VEIN_MAX);
var veinN = 0;
/* the coverage: 1 within VEIN_R of any pinned point; and the index of a
   pinned point standing in each cell, -1 for none, which is what the snap
   searches. Both maintained as veins are added, and rebuilt from the
   points on a restore. */
var vcov = new Uint8Array(NCELL);
var vpAt = new Int32Array(NCELL);
vpAt.fill(-1);
/* sim time at which each cell last BECAME ridge — the start of its current
   unbroken run as one. Written in pass one where a cell qualifies that
   did not last rebuild; a cell held by the hysteresis keeps its start. */
var rage = new Float32Array(NCELL);
/* ---- the graph's picture ----
   Stroking the graph is the one expensive thing about it: measured on
   First Contact at 40 seconds, 1,600 veins of 7,000 points cost 15 to
   18 milliseconds a pass however the paths were built — round caps or
   butt, curves or chords, one subpath per vein or merged — because the
   cost is the area the strokes cover, and a full-canvas drawImage of
   the same picture costs 2.3. So the live graph is stroked once into a
   canvas of its own and the veil takes the canvas. What changes in the
   picture is of two kinds and they are paid for differently: a vein
   added is stroked onto the canvas as it comes, on top of whatever is
   there, which is where a thinner line belongs anyway and where a wider
   one is wrong for at most a second; a vein changing band or state
   needs the whole picture again, in band order, and the whole picture
   is painted at most once per VEIN_REPAINT, so a flurry of crossings as
   the tissue swells costs one pass a second and not one a rebuild.
   The records are not here: they are the ink's, drawn into it beside
   the body's own record and composited with it at INK_A, under the
   walls and under the live body. */
var vgc = null, vgctx = null;
var vDrawn = 0;                            // veins already in the canvas
var vRepaint = true;                       // a band or state changed since it was painted whole
var vPaintT = -1e9;                        // S.simT at the last whole repaint
var VEIN_REPAINT = 1.0;                    // sim-seconds between whole repaints
var vRecPath = null, vRecDirty = true;     // the records, for the ink
var veinWT = 0;                            // S.simT at the last width pass
/* PROF only: milliseconds per phase of the graph's rebuild, summed until
   the harness reads them — the body trace, the mask and transform, pass
   one, pass two with the pins, the widths, the bake */
var profVein = new Float64Array(8), profVeinN = 0, pvT = 0;
function pvMark(k) { var t = performance.now(); profVein[k] += t - pvT; pvT = t; }

/* Forget the graph: a new dish. */
/* ---- the backbone: an explicit vein tree grown from the drop ----

   The reference (a Physarum dish photographed from above, and the
   ten-hour time-lapse) shows one thing the trail field's skeleton never
   gave: HIERARCHY. Two to four trunks leave the inoculum, each tapering
   as it branches, the branches tapering again, down to a lace of
   hairlines behind the front. Trunk to lace is ten to one in width. The
   lace between trunks thins away over the hours, leaving pale ghosts;
   the trunks to food stay.

   So the veins are not read off the tissue any more. They are GROWN
   into it, as a tree, by space colonisation (Runions et al. 2005, the
   leaf-venation algorithm): the tissue supplies attractors, every
   attractor pulls the nearest vein node within reach, and a node that is
   pulled extends one step toward the mean of its pulls. A node never
   moves once placed, growth happens only at existing nodes, and nothing
   appears on its own — the three rules the picture has to keep.

   Width is the pipe model: a node is as wide as the leaves it carries,
   to the power one over PIPE_N, so a trunk carrying a thousand tips is
   fifteen times a hairline, and a twig carrying two is barely more than
   one. The return signal shows up in what is kept: a tip that has
   nothing left to pull it, and stands neither on food nor on the fed
   corridor to food, retracts — its node turns ghost, then its parent a
   moment later — and the lace coarsens the way the time-lapse's does. A
   ghost is still drawn, pale: a vein is never erased.

   Everything here is in grid cells and sim-seconds and reads sim.js's
   globals (bodyV, wallM, feedAt, linkF, S, BODY_LEVELS, VEIN_BANDS, the
   mask box bmX0..bmY1); buildVeins calls treeGrow, the composite's
   painter paintTree, and the snapshot carries the arrays. */

var TREE_MAX  = 60000;        /* nodes */
var TREE_STEP = 2.0;          /* cells a node extends per growth */
var TREE_INF  = 12;           /* cells: how far an attractor reaches for a node */
var TREE_KILL = 2.5;          /* cells: an attractor this close to a node is spent */
var TREE_SP   = 3;            /* cells: attractor lattice spacing (the lace spacing) */
var TREE_LV   = 1;            /* index into BODY_LEVELS: trail at which a cell is tissue the tree grows into */
var TREE_EVERY = 4;           /* sim steps between growth passes: the tree is on the sim's clock, not the frame's */
var TREE_MIN_COS = 0.77;      /* ~40 degrees: a node does not grow a second child this close to one it has */
var TREE_BINS = 8;            /* angular bins the pulls on a node are sorted into */
var TREE_INERTIA = 0.6;       /* share of the parent segment's heading kept by a continuing tip: a vein bends, it does not zigzag */
var PIPE_N    = 2.4;          /* pipe-model exponent: w = W0 * leaves^(1/PIPE_N) */
var TREE_W0   = 0.32;         /* cells: a hairline */
var TREE_WMAX = 4.4;          /* cells: the widest trunk */
var TREE_W_TAU = 0.8;         /* seconds the width eases over */
var RET_IDLE  = 5.0;          /* seconds a tip stands unpulled before it retracts */
var RET_DT    = 0.25;         /* seconds between one node's retraction and its parent's */
var TREE_GHOST_A = 0.34;      /* a ghost's alpha */
var TREE_GHOST_W = 0.5;       /* cells: a ghost's width, at most */
var TREE_REPAINT = 0.2;       /* seconds between repaints while running */
var TREE_WQ   = 4;            /* width quantisation, steps a cell */
/* ---- anastomosis and flow ----
   A tip that reaches another vein FUSES with it: in the dish the fans
   meet and join, and that is how two flakes come to be connected to
   each other and not only each through the centre. A join is an edge
   from the tip to the node it met, and the tip stops there. Which
   joins are kept is the return signal's business: every growth
   TREE_FLOW_EVERY passes the shortest path through the network between
   every pair of flakes that the network stands on is walked, and each
   node counts the pairs whose path runs through it. A node carrying a
   pair never retracts and is at least TREE_WLINK wide, more with more
   pairs; a join carrying none is lace, and retracts like lace. That is
   Tero's rule — the tube on the path between food sources thickens,
   the rest thins — on the graph the tree has become. */
var TREE_JOIN_R = 3.0;        /* cells: a tip this close to another vein fuses with it */
var TREE_FLOW_EVERY = 8;      /* growth passes between flow walks */
var TREE_WLINK = 1.6;         /* cells: a vein carrying one flake pair */
var TREE_SRC_MAX = 16;        /* flakes the flow walk can take */
/* ---- the puddle ----
   In the time-lapse an oat the network has reached disappears under a
   mass of plasmodium: the flake becomes a puddle as the lines take it.
   The sim already has that mass — the fan feeding on a flake is the
   thickest tissue on the plate — so the puddle is drawn from it: the
   eased body's contour at PUDDLE_LV, filled in the trunk's tone under
   the veins so the trunks run into it, but only within PUDDLE_R flake
   radii of a flake being eaten or eaten, and fading to nothing at that
   distance. The fade, not a loop test, is what keeps the puddle at the
   flake: at any level the fan on a flake is one piece with the trunk
   that feeds it, and the trunk with the drop, so the contour's loop
   around a pad is the loop around the whole network, and a first try
   that kept whole loops filled the plate. The flake's own dot fades as
   it is eaten; the ring and dial stay, since they are the instrument
   and not the food. */
var PUDDLE_LV = 5;            /* index into BODY_LEVELS: trail 26, the fan and the trunk that feeds it */
var PUDDLE_R  = 2.4;          /* flake radii: where the puddle has faded to nothing */
var PUDDLE_A  = 0.92;         /* the fill's alpha at the flake */

var tx = new Float32Array(TREE_MAX), ty = new Float32Array(TREE_MAX);
var tpar = new Int32Array(TREE_MAX);
var tw = new Float32Array(TREE_MAX);          /* eased width */
var tleaf = new Int32Array(TREE_MAX);         /* live tips under this node, itself included if a tip */
var tkids = new Int16Array(TREE_MAX);         /* live children */
var tstate = new Uint8Array(TREE_MAX);        /* 1 live, 0 ghost */
var tidle = new Float32Array(TREE_MAX);       /* seconds since last pulled */
var tborn = new Float32Array(TREE_MAX);
var tjoin = new Int32Array(TREE_MAX);        /* the node this tip fused with, or -1 */
var tcarry = new Int16Array(TREE_MAX);       /* flake pairs whose shortest path runs through this node */
var tN = 0, treePassN = 0;
/* the flow walk's scratch: adjacency in CSR form, a queue, distances and
   the step back toward the source */
var fAdjStart = new Int32Array(TREE_MAX + 1), fAdj = new Int32Array(TREE_MAX * 4), fDeg = new Int32Array(TREE_MAX);
var fQueue = new Int32Array(TREE_MAX), fDist = new Int32Array(TREE_MAX), fPrev = new Int32Array(TREE_MAX);
var fSrcN = new Int32Array(TREE_SRC_MAX);    /* per source: live nodes standing on its pad... */
var fSrcAt = new Int32Array(TREE_SRC_MAX * 64); /* ...up to 64 of them, so a pad's old detached
                                                    nodes do not stand for a pad the network has reached */
/* growth accumulators, per node and angular bin, for one pass: a node
   with tissue all round it (the root in the drop) has pulls that cancel
   as one sum, so they are sorted by direction and the fullest bin wins,
   one child per pass; the next pass the rest still pull and the next
   sector gets its child. That is how the drop sprouts its spokes. */
var tgx = new Float32Array(TREE_MAX * TREE_BINS), tgy = new Float32Array(TREE_MAX * TREE_BINS);
var tgn = new Int32Array(TREE_MAX * TREE_BINS);
var tgAny = new Uint8Array(TREE_MAX);
var tPulled = new Int32Array(TREE_MAX), tPulledN = 0;
/* the last-placed live node in each cell, -1 for none; and the cells
   already spent by a node's kill disc */
var tAt = new Int32Array(GW * GH);
var tcov = new Uint8Array(GW * GH);
var treeT = 0, treePaintT = -1e9, treeDirty = true;

function treeReset() {
  tN = 0; treePassN = 0; treeT = S.simT; treePaintT = -1e9; treeDirty = true;
  tAt.fill(-1); tcov.fill(0);
  if (S.exp) {
    var ix = (S.exp.inoc.x | 0) + 0.5, iy = (S.exp.inoc.y | 0) + 0.5;
    treeAdd(ix, iy, -1);
  }
}

function treeAdd(x, y, parent) {
  if (tN >= TREE_MAX) return -1;
  var i = tN++;
  tx[i] = x; ty[i] = y; tpar[i] = parent;
  tw[i] = TREE_W0; tleaf[i] = 1; tkids[i] = 0;
  tstate[i] = 1; tidle[i] = 0; tborn[i] = S.simT;
  tjoin[i] = -1; tcarry[i] = 0;
  if (parent >= 0) { tkids[parent]++; tidle[parent] = 0; }
  treeCover(i);
  return i;
}

/* the kill disc: attractors inside it are spent; the cell map keeps the
   node for the nearest-node search */
function treeCover(i) {
  var cx = tx[i] | 0, cy = ty[i] | 0;
  if (cx >= 0 && cy >= 0 && cx < GW && cy < GH) tAt[cy * GW + cx] = i;
  treeCoverR(i, TREE_KILL);
}
function treeCoverR(i, R) {
  var cx = tx[i] | 0, cy = ty[i] | 0, r = Math.ceil(R), r2 = R * R;
  for (var dy = -r; dy <= r; dy++) {
    var y = cy + dy; if (y < 0 || y >= GH) continue;
    for (var dx = -r; dx <= r; dx++) {
      var x = cx + dx; if (x < 0 || x >= GW) continue;
      var ox = x + 0.5 - tx[i], oy = y + 0.5 - ty[i];
      if (ox * ox + oy * oy <= r2) tcov[y * GW + x] = 1;
    }
  }
}

/* the nearest live node to a cell within TREE_INF, by expanding square
   rings on the cell map: the first ring with a node is within a cell of
   the nearest, which is all the pull needs */
function treeNearest(cx, cy) {
  var c0 = cy * GW + cx, n0 = tAt[c0];
  if (n0 >= 0 && tstate[n0]) return n0;
  var best = -1, bd = 1e9, R = TREE_INF;
  for (var r = 1; r <= R; r++) {
    var y0 = cy - r, y1 = cy + r, x0 = cx - r, x1 = cx + r, x, y, n;
    for (x = x0; x <= x1; x++) {
      if (x < 0 || x >= GW) continue;
      if (y0 >= 0) { n = tAt[y0 * GW + x]; if (n >= 0 && tstate[n]) { var d = (tx[n] - cx - 0.5) * (tx[n] - cx - 0.5) + (ty[n] - cy - 0.5) * (ty[n] - cy - 0.5); if (d < bd) { bd = d; best = n; } } }
      if (y1 < GH) { n = tAt[y1 * GW + x]; if (n >= 0 && tstate[n]) { var d2 = (tx[n] - cx - 0.5) * (tx[n] - cx - 0.5) + (ty[n] - cy - 0.5) * (ty[n] - cy - 0.5); if (d2 < bd) { bd = d2; best = n; } } }
    }
    for (y = y0 + 1; y <= y1 - 1; y++) {
      if (y < 0 || y >= GH) continue;
      if (x0 >= 0) { n = tAt[y * GW + x0]; if (n >= 0 && tstate[n]) { var d3 = (tx[n] - cx - 0.5) * (tx[n] - cx - 0.5) + (ty[n] - cy - 0.5) * (ty[n] - cy - 0.5); if (d3 < bd) { bd = d3; best = n; } } }
      if (x1 < GW) { n = tAt[y * GW + x1]; if (n >= 0 && tstate[n]) { var d4 = (tx[n] - cx - 0.5) * (tx[n] - cx - 0.5) + (ty[n] - cy - 0.5) * (ty[n] - cy - 0.5); if (d4 < bd) { bd = d4; best = n; } } }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/* One growth pass, every TREE_EVERY sim steps, from step(). On the sim's
   clock and reading the sim's own trail rather than the painter's eased
   body, so the tree a run grows is a function of the run alone: the
   same seed and step count grow the same tree at x1 and at x16, and a
   replay puts back the tree the original had. Read at render cadence it
   was not — a frame at x16 runs sixteen steps and grew one. */
var treeMs = 0, treePasses = 0;
function treeGrow() {
  if (!S.exp) return;
  if (tN === 0) treeReset();
  var dt = S.simT - treeT;
  treeT = S.simT;
  if (dt <= 0) return;
  var t0 = PROF ? performance.now() : 0;
  var lv = BODY_LEVELS[TREE_LV], i, x, y, c, n;

  /* --- the pulls: every unspent attractor cell on the plate --- */
  tPulledN = 0;
  var sp = TREE_SP;
  for (y = 0; y < GH; y += sp) {
    for (x = 0; x < GW; x += sp) {
      /* the lattice, jittered by a hash so it is not a grid the tree can see */
      var h = mix32(x, y, 7);
      var jx = x + (h % sp), jy = y + ((h >>> 8) % sp);
      if (jx < 2 || jy < 2 || jx >= GW - 2 || jy >= GH - 2) continue;
      c = jy * GW + jx;
      if (tcov[c] || wallM[c] || trail[c] < lv) continue;
      n = treeNearest(jx, jy);
      if (n < 0) continue;
      var dx = jx + 0.5 - tx[n], dy = jy + 0.5 - ty[n];
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-3) continue;
      if (!tgAny[n]) { tgAny[n] = 1; tPulled[tPulledN++] = n; }
      var bin = ((Math.atan2(dy, dx) / (2 * Math.PI) * TREE_BINS + TREE_BINS + 0.5) | 0) % TREE_BINS;
      var bi = n * TREE_BINS + bin;
      tgx[bi] += dx / d; tgy[bi] += dy / d; tgn[bi]++;
    }
  }

  /* --- the growth: a pulled node extends one step toward its pulls --- */
  for (i = 0; i < tN; i++) tidle[i] += dt;
  var grown = 0;
  for (var k = 0; k < tPulledN; k++) {
    n = tPulled[k];
    var gx = 0, gy = 0, cnt = 0, b0 = n * TREE_BINS;
    for (var bb = 0; bb < TREE_BINS; bb++) {
      if (tgn[b0 + bb] > cnt) { cnt = tgn[b0 + bb]; gx = tgx[b0 + bb]; gy = tgy[b0 + bb]; }
      tgn[b0 + bb] = 0; tgx[b0 + bb] = 0; tgy[b0 + bb] = 0;
    }
    tgAny[n] = 0;
    /* a fused tip has stopped: the vein it met carries on from there.
       Its pulls do not keep it awake, so it idles out like any tip
       unless the flow walk finds it carrying */
    if (tjoin[n] >= 0) continue;
    tidle[n] = 0;
    var gl = Math.sqrt(gx * gx + gy * gy);
    if (gl < 1e-3) continue;
    gx /= gl; gy /= gl;
    /* a tip continues its own heading, bent toward the pull: the
       reference's trunks curve, and a step that turns to whatever
       attractor happens to be nearest zigzags at every cell */
    if (tkids[n] === 0 && tpar[n] >= 0) {
      var pp = tpar[n], hx = tx[n] - tx[pp], hy = ty[n] - ty[pp], hl = Math.sqrt(hx * hx + hy * hy);
      if (hl > 1e-3) {
        gx = gx * (1 - TREE_INERTIA) + hx / hl * TREE_INERTIA;
        gy = gy * (1 - TREE_INERTIA) + hy / hl * TREE_INERTIA;
        gl = Math.sqrt(gx * gx + gy * gy);
        if (gl < 1e-3) continue;
        gx /= gl; gy /= gl;
      }
    }
    /* not a second child within TREE_MIN_COS of one it already has: two
       twigs a few degrees apart are one twig drawn twice */
    var dup = false;
    for (var j = n + 1; j < tN; j++) {
      if (tpar[j] !== n || !tstate[j]) continue;
      var kx = tx[j] - tx[n], ky = ty[j] - ty[n], kl = Math.sqrt(kx * kx + ky * ky);
      if (kl > 1e-3 && (kx * gx + ky * gy) / kl > TREE_MIN_COS) { dup = true; break; }
    }
    if (dup) continue;
    var nx = tx[n] + gx * TREE_STEP, ny = ty[n] + gy * TREE_STEP;
    var cx = nx | 0, cy = ny | 0;
    if (cx < 1 || cy < 1 || cx >= GW - 1 || cy >= GH - 1) continue;
    c = cy * GW + cx;
    if (wallM[c] || trail[c] < lv) continue;
    /* a TIP with another vein within reach of its step fuses with it
       instead of stepping — not this vein's own last few nodes, which
       are always within reach. An inner node growing a new branch does
       not fuse: a join would end its growing for good, and the branch
       point's job is to branch. It steps, and the child is the tip that
       may fuse next pass. */
    if (tkids[n] === 0) {
      var occ = treeForeign(cx, cy, n);
      if (occ >= 0) {
        tjoin[n] = occ; grown++;
        /* the attractors between the two are spent by the fusion, or they
           would pull this tip forever */
        treeCoverR(n, TREE_JOIN_R + TREE_KILL);
        continue;
      }
    }
    /* not into another vein's cell */
    var occ2 = tAt[c];
    if (occ2 >= 0 && occ2 !== n && tstate[occ2]) continue;
    if (treeAdd(nx, ny, n) < 0) break;
    grown++;
  }
  /* --- a wall poured across a join's middle severs it, BEFORE the flow
     walk, which would otherwise route through it and leave the carry it
     gave on nodes the wall has cut off until the next walk --- */
  var severed = 0;
  for (i = 1; i < tN; i++) {
    if (!tstate[i] || tjoin[i] < 0) continue;
    if (!treeClear(tx[i], ty[i], tx[tjoin[i]], ty[tjoin[i]])) { tjoin[i] = -1; severed++; }
  }
  if (severed) treeDirty = true;
  /* --- the flow: which nodes carry a flake pair --- */
  if (++treePassN % TREE_FLOW_EVERY === 0 || severed) treeFlow();

  /* --- the widths: leaves under each node, children before parents --- */
  for (i = 0; i < tN; i++) tleaf[i] = (tstate[i] && tkids[i] === 0) ? 1 : 0;
  for (i = tN - 1; i > 0; i--) if (tstate[i]) tleaf[tpar[i]] += tleaf[i];
  var kw = 1 - Math.exp(-dt / TREE_W_TAU);
  for (i = 0; i < tN; i++) {
    if (!tstate[i]) continue;
    var target = TREE_W0 * Math.pow(tleaf[i] > 0 ? tleaf[i] : 1, 1 / PIPE_N);
    if (tcarry[i] > 0) { var wl = TREE_WLINK * Math.sqrt(tcarry[i]); if (wl > target) target = wl; }
    if (target > TREE_WMAX) target = TREE_WMAX;
    tw[i] += (target - tw[i]) * kw;
  }

  /* --- the retraction: an idle tip not on food or the fed corridor;
     and any node a wall has come down on, tip or not, at once. A tip
     whose join was severed above is a plain tip again and idles out
     like one --- */
  var retracted = 0;
  for (i = tN - 1; i > 0; i--) {
    if (!tstate[i]) continue;
    c = (ty[i] | 0) * GW + (tx[i] | 0);
    if (!wallM[c]) {
      if (tkids[i] !== 0 || tidle[i] < RET_IDLE) continue;
      if (tcarry[i] > 0) continue;
      if (feedAt[c] >= 0) continue;
      if (linkF[c] >= FED_LOW) continue;
    }
    tstate[i] = 0;
    var p = tpar[i];
    tkids[p]--;
    /* the parent is a tip now, and retracts RET_DT after this one unless
       something pulls it first */
    if (tkids[p] === 0 && tidle[p] < RET_IDLE - RET_DT) tidle[p] = RET_IDLE - RET_DT;
    retracted++;
  }
  if (grown || retracted) treeDirty = true;
  /* widths ease every pass, so the paint is due on its own clock */
  if (PROF) { treeMs += performance.now() - t0; treePasses++; }
}

/* whether the segment between two points crosses no wall cell, sampled
   every half cell */
function treeClear(x0, y0, x1, y1) {
  var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy), n = Math.ceil(len * 2), k;
  for (k = 0; k <= n; k++) {
    var t = n > 0 ? k / n : 0, x = (x0 + dx * t) | 0, y = (y0 + dy * t) | 0;
    if (x < 0 || y < 0 || x >= GW || y >= GH || wallM[y * GW + x]) return false;
  }
  return true;
}

/* A live node of another vein within TREE_JOIN_R of a cell, or -1: not
   the tip itself, its parent, or its grandparent, which stand within
   reach of every step it takes; and not a node already fused to it. */
function treeForeign(cx, cy, n) {
  var r = Math.ceil(TREE_JOIN_R), r2 = TREE_JOIN_R * TREE_JOIN_R, best = -1, bd = 1e9;
  var p1 = tpar[n], p2 = p1 >= 0 ? tpar[p1] : -1;
  for (var dy = -r; dy <= r; dy++) {
    var y = cy + dy; if (y < 0 || y >= GH) continue;
    for (var dx = -r; dx <= r; dx++) {
      var x = cx + dx; if (x < 0 || x >= GW) continue;
      var m = tAt[y * GW + x];
      if (m < 0 || !tstate[m] || m === n || m === p1 || m === p2 || tpar[m] === n || tjoin[m] === n) continue;
      var ox = tx[m] - cx - 0.5, oy = ty[m] - cy - 0.5, d = ox * ox + oy * oy;
      if (d > r2 || d >= bd) continue;
      /* not through a wall: a vein on the far side of a maze wall is
         within reach of a tip on this side, and a join across it would
         be an edge the flow walk routes through and the painter draws */
      if (!treeClear(tx[n], ty[n], tx[m], ty[m])) continue;
      bd = d; best = m;
    }
  }
  return best;
}

/* The flow walk. Sources are the flakes with a live node on their pad,
   every such node standing for the flake. From each source a
   breadth-first search over the live network — parent links and joins,
   both ways — gives the hop distance and the step back; for every other
   source the nearest of its pad nodes is found and the path back is
   walked, each node on it counting one pair. A pad's nodes need not
   all be one network — a wall can cut a branch off and leave its tip on
   the pad alive — so the pair is carried by whichever of them the walk
   reaches. Undirected
   and unweighted: the hop count of a chain of two-cell steps is its
   length near enough, and what this decides is which veins carry, not
   by how much. */
function treeFlow() {
  var i, k, e = S.exp, nsrc = e.nodes.length < TREE_SRC_MAX ? e.nodes.length : TREE_SRC_MAX;
  for (i = 0; i < tN; i++) { tcarry[i] = 0; fDeg[i] = 0; }
  for (k = 0; k < nsrc; k++) fSrcN[k] = 0;
  var nfound = 0;
  for (i = 0; i < tN; i++) {
    if (!tstate[i]) continue;
    var fi = feedAt[(ty[i] | 0) * GW + (tx[i] | 0)];
    if (fi >= 0 && fi < nsrc && fSrcN[fi] < 64) { if (fSrcN[fi] === 0) nfound++; fSrcAt[fi * 64 + fSrcN[fi]++] = i; }
    if (i > 0 && tstate[tpar[i]]) { fDeg[i]++; fDeg[tpar[i]]++; }
    if (tjoin[i] >= 0 && tstate[tjoin[i]]) { fDeg[i]++; fDeg[tjoin[i]]++; }
  }
  if (nfound < 2) return;
  fAdjStart[0] = 0;
  for (i = 0; i < tN; i++) fAdjStart[i + 1] = fAdjStart[i] + fDeg[i];
  for (i = 0; i < tN; i++) fDeg[i] = 0;
  for (i = 0; i < tN; i++) {
    if (!tstate[i]) continue;
    var q = i > 0 && tstate[tpar[i]] ? tpar[i] : -1;
    if (q >= 0) { fAdj[fAdjStart[i] + fDeg[i]++] = q; fAdj[fAdjStart[q] + fDeg[q]++] = i; }
    var j = tjoin[i];
    if (j >= 0 && tstate[j]) { fAdj[fAdjStart[i] + fDeg[i]++] = j; fAdj[fAdjStart[j] + fDeg[j]++] = i; }
  }
  for (var a = 0; a < nsrc; a++) {
    if (fSrcN[a] === 0) continue;
    for (i = 0; i < tN; i++) fDist[i] = -1;
    var qh = 0, qt = 0;
    for (k = 0; k < fSrcN[a]; k++) { var sa = fSrcAt[a * 64 + k]; fQueue[qt++] = sa; fDist[sa] = 0; fPrev[sa] = -1; }
    while (qh < qt) {
      var u = fQueue[qh++], s0 = fAdjStart[u], s1 = s0 + fDeg[u];
      for (k = s0; k < s1; k++) {
        var v = fAdj[k];
        if (fDist[v] >= 0) continue;
        fDist[v] = fDist[u] + 1; fPrev[v] = u; fQueue[qt++] = v;
      }
    }
    /* each pair once: walk back from the nearest reached node of the
       later source's pad */
    for (var b = a + 1; b < nsrc; b++) {
      var sb = -1, bd = 1e9;
      for (k = 0; k < fSrcN[b]; k++) { var cb = fSrcAt[b * 64 + k]; if (fDist[cb] >= 0 && fDist[cb] < bd) { bd = fDist[cb]; sb = cb; } }
      if (sb < 0) continue;
      for (var w = sb; w >= 0; w = fPrev[w]) tcarry[w]++;
    }
  }
}

/* the puddles: the body's contour, filled within a fading disc around
   each flake that is being eaten or is eaten */
function paintPuddles(c) {
  var e = S.exp, path = null, i;
  for (i = 0; i < e.nodes.length; i++) {
    if (!S.nodeDone[i] && !(S.nodeProg[i] > 0.01)) continue;
    if (!path) { path = traceIso(bodyV, BODY_LEVELS[PUDDLE_LV], false, null); if (!path) return; }
    var nd = e.nodes[i], r = nd.r * PUDDLE_R;
    var g = c.createRadialGradient(nd.x, nd.y, 0, nd.x, nd.y, r);
    var col = PLASMODIUM;
    g.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + PUDDLE_A + ')');
    g.addColorStop(0.55, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + PUDDLE_A + ')');
    g.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
    c.save();
    c.beginPath(); c.arc(nd.x, nd.y, r, 0, Math.PI * 2); c.clip();
    c.fillStyle = g;
    c.fill(path, 'evenodd');
    c.restore();
  }
}

/* the band whose hairline is nearest below this width, for its colour */
function treeBand(w) {
  var b = 0;
  for (var k = 1; k < VEIN_BANDS.length; k++) if (VEIN_BANDS[k].w <= w) b = k;
  return b;
}

/* The picture: every node's segment to its parent, batched by quantised
   width, widest first so hairlines land on the trunks they leave.
   Ghosts under everything, pale. Into vgc, which the composite lays
   over the veil once a frame. */
function paintTree() {
  if (!veil || !veil.width) return;
  if (!vgc) { vgc = document.createElement('canvas'); vgctx = vgc.getContext('2d'); }
  var due = !S.running || S.simT - treePaintT >= TREE_REPAINT;
  if (vgc.width !== veil.width || vgc.height !== veil.height) { vgc.width = veil.width; vgc.height = veil.height; due = true; }
  if (!due && !treeDirty) return;
  treePaintT = S.simT; treeDirty = false;
  var sx = vgc.width / GW, sy = vgc.height / GH, i, p;
  var keys = (TREE_WMAX * TREE_WQ | 0) + 2, paths = new Array(keys), ghost = null, k;
  for (k = 0; k < keys; k++) paths[k] = null;
  for (i = 1; i < tN; i++) {
    p = tpar[i];
    /* drawn from the midpoint of the parent's segment to the midpoint of
       this one, curving through the parent: the nodes are the control
       polygon and the line is its quadratic spline, so a chain of
       two-cell steps reads as one bending vein. The root and a branch
       point's first segment start at the node itself. */
    /* nothing is drawn under a wall, live or ghost: the graph is laid
       over the walls, and a wall poured across a branch would otherwise
       show the branch through it */
    if (wallM[(ty[i] | 0) * GW + (tx[i] | 0)] || wallM[(ty[p] | 0) * GW + (tx[p] | 0)]) continue;
    var g = tpar[p], x0, y0;
    if (g >= 0) { x0 = (tx[g] + tx[p]) * 0.5; y0 = (ty[g] + ty[p]) * 0.5; } else { x0 = tx[p]; y0 = ty[p]; }
    var x1 = (tx[p] + tx[i]) * 0.5, y1 = (ty[p] + ty[i]) * 0.5;
    var tip = tkids[i] === 0 || !tstate[i];
    var path;
    if (!tstate[i]) {
      if (!ghost) ghost = new Path2D();
      path = ghost;
    } else {
      /* a segment is as wide as its child end: the width steps down at
         every branch point rather than the trunk carrying its twig's width */
      var w = tw[i];
      k = Math.round(w * TREE_WQ); if (k < 1) k = 1; if (k >= keys) k = keys - 1;
      if (!paths[k]) paths[k] = new Path2D();
      path = paths[k];
    }
    path.moveTo(x0, y0);
    path.quadraticCurveTo(tx[p], ty[p], x1, y1);
    if (tip) path.lineTo(tx[i], ty[i]);
    /* the fusion: straight on to the vein this tip met */
    var jn = tjoin[i];
    if (jn >= 0 && !wallM[(ty[jn] | 0) * GW + (tx[jn] | 0)] && treeClear(tx[i], ty[i], tx[jn], ty[jn])) {
      var jp = tstate[i] && tstate[jn] ? path : (ghost || (ghost = new Path2D()));
      jp.moveTo(tx[i], ty[i]); jp.lineTo(tx[jn], ty[jn]);
    }
  }
  vgctx.save();
  vgctx.setTransform(1, 0, 0, 1, 0, 0);
  vgctx.clearRect(0, 0, vgc.width, vgc.height);
  vgctx.setTransform(sx, 0, 0, sy, 0, 0);
  vgctx.lineCap = 'round';
  vgctx.lineJoin = 'round';
  /* the puddles first, under everything */
  paintPuddles(vgctx);
  if (ghost) {
    vgctx.globalAlpha = TREE_GHOST_A;
    vgctx.lineWidth = TREE_GHOST_W;
    vgctx.strokeStyle = VEIN_BANDS[0].style;
    vgctx.stroke(ghost);
    vgctx.globalAlpha = 1;
  }
  for (k = keys - 1; k >= 1; k--) {
    if (!paths[k]) continue;
    var w2 = k / TREE_WQ;
    vgctx.lineWidth = w2;
    vgctx.strokeStyle = VEIN_BANDS[treeBand(w2)].style;
    vgctx.stroke(paths[k]);
  }
  vgctx.restore();
}

function snapshotTree(fs) {
  fs.tN = tN;
  fs.tx = tx.slice(0, tN); fs.ty = ty.slice(0, tN); fs.tpar = tpar.slice(0, tN);
  fs.tw = tw.slice(0, tN); fs.tstate = tstate.slice(0, tN); fs.tidle = tidle.slice(0, tN);
  fs.tborn = tborn.slice(0, tN); fs.tkids = tkids.slice(0, tN);
  fs.tjoin = tjoin.slice(0, tN); fs.tcarry = tcarry.slice(0, tN);
}

function restoreTree(fs) {
  treeReset();
  if (!fs.tx) return;
  tN = fs.tN;
  tx.set(fs.tx); ty.set(fs.ty); tpar.set(fs.tpar); tw.set(fs.tw);
  tstate.set(fs.tstate); tidle.set(fs.tidle); tborn.set(fs.tborn); tkids.set(fs.tkids);
  if (fs.tjoin) { tjoin.set(fs.tjoin); tcarry.set(fs.tcarry); } else { tjoin.fill(-1, 0, tN); tcarry.fill(0, 0, tN); }
  tAt.fill(-1); tcov.fill(0);
  for (var i = 0; i < tN; i++) treeCover(i);
  treeDirty = true;
}

function resetVeinGraph() {
  vpN = 0; veinN = 0;
  rootT0 = S.simT; rootLoopN = 0;
  vcov.fill(0); vpAt.fill(-1);
  rage.fill(0);
  vDrawn = 0; vRepaint = true; vPaintT = -1e9;
  if (vgc && vgc.width) vgctx.clearRect(0, 0, vgc.width, vgc.height);
  vRecPath = null; vRecDirty = true;
  veinWT = S.simT;
  if (VEIN_TREE) treeReset();
}

/* The coverage disc around one pinned point, and its entry in the point
   map — unless the cell already holds one: a snapped end stands in the
   cell of the point it took, and the map keeps the OLDER point there so a
   later snap lands on the same vertex rather than on this vein's copy. */
function coverPoint(p) {
  var cx = vpx[p] | 0, cy = vpy[p] | 0;
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return;
  if (vpAt[cy * GW + cx] < 0) vpAt[cy * GW + cx] = p;
  for (var dy = -VEIN_R; dy <= VEIN_R; dy++) {
    var yy = cy + dy;
    if (yy < 0 || yy >= GH) continue;
    for (var dx = -VEIN_R; dx <= VEIN_R; dx++) {
      var xx = cx + dx;
      if (xx < 0 || xx >= GW || dx * dx + dy * dy > VEIN_R * VEIN_R) continue;
      vcov[yy * GW + xx] = 1;
    }
  }
}

/* The nearest pinned point within VEIN_SNAP of (x, y) that lies AHEAD
   of a stretch leaving it in direction (tx, ty), or -1. Ahead means the
   hop from the end to the point is within VEIN_SNAP_COS of the stretch's
   own heading: a side tube meets its trunk along its own axis, and a
   vein continuing a vein does so straight, so a junction's hop is
   always within that; the hops this refuses are the square ones, from
   a stretch to a vein it runs BESIDE, which drew a hook the width of a
   trunk at the end of every line that happened to be pinned four cells
   from another. Such an end attaches through the tissue instead, if it
   is on tube. Searches the cells the point map could hold one in; the
   map keeps one point per cell, which is every point of a chain since
   the walk stands on each cell once. */
var VEIN_SNAP_COS = 0.34;                    /* 70 degrees */
function nearestVeinPoint(x, y, tx, ty) {
  var cx = x | 0, cy = y | 0, best = -1, bd = VEIN_SNAP * VEIN_SNAP + 1e-6;
  var tl = Math.sqrt(tx * tx + ty * ty);
  if (tl > 0) { tx /= tl; ty /= tl; }
  for (var dy = -VEIN_SNAP; dy <= VEIN_SNAP; dy++) {
    var yy = cy + dy;
    if (yy < 0 || yy >= GH) continue;
    for (var dx = -VEIN_SNAP; dx <= VEIN_SNAP; dx++) {
      var xx = cx + dx;
      if (xx < 0 || xx >= GW) continue;
      var p = vpAt[yy * GW + xx];
      if (p < 0) continue;
      var ddx = vpx[p] - x, ddy = vpy[p] - y, d2 = ddx * ddx + ddy * ddy;
      if (d2 >= bd) continue;
      if (tl > 0 && d2 > 0.25 && (ddx * tx + ddy * ty) < VEIN_SNAP_COS * Math.sqrt(d2)) continue;
      bd = d2; best = p;
    }
  }
  return best;
}

/* Whether a stretch heading outward along (hx, hy) into point i of vein u
   continues that vein: the point is one of u's two ends, and the
   stretch arrives along u's own line there — within VEIN_CONT_COS of
   straight on. A stretch meeting u anywhere along its length is a
   branch whatever its angle, and one meeting an end at a corner is a
   branch too. Generous, at fifty degrees: what separates a spur from a
   continuation is mostly WHERE it lands — a spur leaves the side of a
   line, an interior point — and a gap in a tube's line at a bend has
   to close too. */
var VEIN_CONT_COS = 0.64;                    /* about 50 degrees */
function continuesVein(p, u, i, hx, hy) {
  var n = vCount[u], st = vStart[u], ux, uy;
  if (n < 2) return false;
  if (i <= 0) { ux = vpx[st] - vpx[st + 1]; uy = vpy[st] - vpy[st + 1]; }
  else if (i >= n - 1) { ux = vpx[st + n - 1] - vpx[st + n - 2]; uy = vpy[st + n - 1] - vpy[st + n - 2]; }
  else return false;
  /* u's outward direction at that end, against the stretch's outward
     heading: straight on is a dot of -1 */
  var d = hx * ux + hy * uy, l2 = (hx * hx + hy * hy) * (ux * ux + uy * uy);
  return l2 > 0 && d < 0 && d * d >= VEIN_CONT_COS * VEIN_CONT_COS * l2;
}

/* Whether a stretch's free end at (x, y), heading outward along (hx, hy),
   is a tip: the mask ends within two cells past it. A stretch cut short
   by coverage or by unsettled cells stops inside the body, and so does
   the spur of a bump. */
function tipEnd(x, y, hx, hy) {
  var l = Math.sqrt(hx * hx + hy * hy);
  if (l === 0) return false;
  var nx = Math.round(x + hx / l * 2), ny = Math.round(y + hy / l * 2);
  if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) return true;
  return bodyM[ny * GW + nx] === 0;
}

/* Fold the first three points of a continuation onto the line of the end
   it continues: point i of vein u is the end, k the stretch's first
   point (chx/chy) and dir which way the stretch runs from it. */
function foldOnto(p, u, i, k, dir) {
  var n = vCount[u], st = vStart[u], tx, ty;
  if (n < 2) return;
  if (i <= 0) { tx = vpx[st] - vpx[st + 1]; ty = vpy[st] - vpy[st + 1]; }
  else { tx = vpx[st + n - 1] - vpx[st + n - 2]; ty = vpy[st + n - 1] - vpy[st + n - 2]; }
  var tl = Math.sqrt(tx * tx + ty * ty);
  if (tl === 0) return;
  tx /= tl; ty /= tl;
  for (var j = 0; j < 2; j++) {
    var q = k + dir * j;
    var dx = chx[q] - vpx[p], dy = chy[q] - vpy[p];
    var along = dx * tx + dy * ty;
    var ox = dx - along * tx, oy = dy - along * ty;   /* the lateral offset */
    var keep = (j + 1) / 3;
    chx[q] -= ox * (1 - keep); chy[q] -= oy * (1 - keep);
  }
}

/* Which vein a point index belongs to. Veins are laid down in order, so
   their starts are sorted and this is a binary search. */
/* ---- the free ends reach ----
   A stretch snaps onto what is near it WHEN it is pinned, and never
   again: an end that found nothing then stayed a free end though a vein
   was pinned a cell from it a second later, and the picture was a
   network of pieces with gaps between them — the breaks, every one
   ending a cell or three short of the line it belonged to. So every
   rebuild each vein's free ends look again: the nearest pinned point of
   another vein within VEIN_SNAP, and if there is one a connector of two
   frozen points is pinned from the end to it and the end is attached
   for good. An end on the body (-2) reaches too — standing on tissue is
   not being joined to a line. The cost is the free ends times the snap
   disc, a few hundred cells a rebuild. */
var REACH_MAX = 64;                          /* connectors pinned per rebuild, so a flurry is spread */
function reachFreeEnds() {
  var made = 0;
  for (var v = 0; v < veinN && made < REACH_MAX; v++) {
    for (var side = 0; side < 2 && made < REACH_MAX; side++) {
      var a = vAtt[v * 4 + side * 2];
      if (a >= 0) continue;
      var p = side ? vStart[v] + vCount[v] - 1 : vStart[v];
      var px = vpx[p], py = vpy[p], cx = px | 0, cy = py | 0;
      var best = -1, bd = VEIN_SNAP * VEIN_SNAP + 0.001;
      for (var dy = -VEIN_SNAP; dy <= VEIN_SNAP; dy++) {
        var yy = cy + dy; if (yy < 0 || yy >= GH) continue;
        for (var dx = -VEIN_SNAP; dx <= VEIN_SNAP; dx++) {
          var xx = cx + dx; if (xx < 0 || xx >= GW) continue;
          var q = vpAt[yy * GW + xx];
          if (q < 0) continue;
          var qv = veinOfPoint(q);
          if (qv === v) continue;
          /* only a point that is drawn live: the map keeps record points
             too, and a connector to one of those is a record at birth,
             with the end marked attached and never looking again — the
             live line stays cut. A free end near nothing live stays
             free, and looks again next rebuild. */
          if (!vState[qv] || !vpLive[q]) continue;
          var ddx = vpx[q] - px, ddy = vpy[q] - py, d2 = ddx * ddx + ddy * ddy;
          if (d2 < bd && d2 > 0.04) { bd = d2; best = q; }
        }
      }
      if (best < 0) continue;
      if (veinN >= VEIN_MAX || vpN + 2 > VEIN_PTS_CAP) return;
      var bv = veinOfPoint(best), c = veinN++;
      vStart[c] = vpN;
      vpx[vpN] = px; vpy[vpN] = py; vpW[vpN] = vpW[p]; vpLive[vpN] = 1; vpN++;
      vpx[vpN] = vpx[best]; vpy[vpN] = vpy[best]; vpW[vpN] = vpW[best]; vpLive[vpN] = 1; vpN++;
      vCount[c] = 2;
      vFlow[c] = vFlow[v] < vFlow[bv] ? vFlow[v] : vFlow[bv];
      vBand[c] = vBand[v] < vBand[bv] ? vBand[v] : vBand[bv];
      vBorn[c] = S.simT;
      vState[c] = 1;
      vRoot[c] = 0;
      vAtt[c * 4] = v; vAtt[c * 4 + 1] = p - vStart[v];
      vAtt[c * 4 + 2] = bv; vAtt[c * 4 + 3] = best - vStart[bv];
      vNext[c] = -1; vPrev[c] = -1;
      vAtt[v * 4 + side * 2] = c; vAtt[v * 4 + side * 2 + 1] = 0;
      coverPoint(vStart[c]); coverPoint(vStart[c] + 1);
      made++;
    }
  }
}

/* ---- growth reaches through tissue ----
   A stretch snapped only onto a vein within VEIN_SNAP of it, five cells,
   and a settled ridge stands further than that from the last vein's end
   within seconds of it being pinned: the tissue outruns the lines, and
   a line that must start within five cells of another can never catch
   up. In one run a few spokes attached to the root ring before the
   annulus widened past the snap; in another none did, and the plate
   showed the ring alone for a minute. So a stretch that snaps onto
   nothing looks further: the nearest END point of a vein (or any point
   of a root vein) within GROW_REACH whose straight line to the
   stretch's start runs through tissue the whole way, and the hop is
   pinned as the new vein's first segment. Growth still begins only at
   a vein's end; it may begin some way from it, through the body. */
var GROW_REACH = 12;
function tissueBetween(x0, y0, x1, y1) {
  var dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.sqrt(dx * dx + dy * dy)) | 0, lv = BODY_LEVELS[0];
  for (var k = 1; k < n; k++) {
    var t = k / n, c = ((y0 + dy * t) | 0) * GW + ((x0 + dx * t) | 0);
    if (c < 0 || c >= NCELL || bodyV[c] < lv) return false;
  }
  return true;
}
function nearestGrowPoint(x, y) {
  var cx = x | 0, cy = y | 0, best = -1, bd = GROW_REACH * GROW_REACH + 0.001;
  for (var dy = -GROW_REACH; dy <= GROW_REACH; dy++) {
    var yy = cy + dy; if (yy < 0 || yy >= GH) continue;
    for (var dx = -GROW_REACH; dx <= GROW_REACH; dx++) {
      var xx = cx + dx; if (xx < 0 || xx >= GW) continue;
      var q = vpAt[yy * GW + xx];
      if (q < 0) continue;
      var qv = veinOfPoint(q);
      if (!vState[qv] || !vpLive[q]) continue;
      if (!vRoot[qv] && q !== vStart[qv] && q !== vStart[qv] + vCount[qv] - 1) continue;
      var ddx = vpx[q] - x, ddy = vpy[q] - y, d2 = ddx * ddx + ddy * ddy;
      if (d2 >= bd) continue;
      if (!tissueBetween(x, y, vpx[q], vpy[q])) continue;
      bd = d2; best = q;
    }
  }
  return best;
}

/* on the drop's piece, while it is still the root: where the first
   lines may begin */
function onRoot(c) {
  if (!rootLab) return false;
  var lc = (((c / GW) | 0) >> 1) * LW + ((c % GW) >> 1);
  return compL[lc] === rootLab && compPts[rootLab] < ROOT_PTS;
}

function veinOfPoint(p) {
  var lo = 0, hi = veinN - 1;
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1;
    if (vStart[mid] <= p) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* A pinned vein's band from its measure, with the same reluctance to
   cross a boundary that pickBand gives a chain: climbing waits for the
   boundary to be cleared by BAND_HYST, falling likewise. A measure eased
   over a second still hovers at a boundary for many rebuilds, and a vein
   that flicked between two widths there would be the twitch this whole
   layer exists to remove. */
function veinBand(flow, prev) {
  var last = VEIN_BANDS.length - 1, b = 0;
  while (b < last && flow > VEIN_BANDS[b].max) b++;
  if (prev > last || b === prev) return b;
  if (b > prev) { if (flow < VEIN_BANDS[prev].max * (1 + BAND_HYST)) return prev; }
  else if (flow > VEIN_BANDS[prev - 1].max * (1 - BAND_HYST)) return prev;
  return b;
}

/* One chain of pass two, as candidate veins. The chain's points are in
   chx/chy on cells chi; the parts of it that are settled and not already
   a vein's are its uncovered stretches, and each long enough is pinned if
   an end attaches. The snap appends the existing point to the stretch,
   so the graph gains a vertex of degree three there and no seam. Pinned
   veins are targets for the stretches after them in the
   same rebuild, which is what lets a chain that continues past a junction
   become two veins meeting at it. */
function pinChain(n) {
  var settleT = S.simT - VEIN_SETTLE;
  var s = 0, e, k, c;
  while (s < n) {
    while (s < n) { c = chi[s]; if (!vcov[c] && rage[c] <= settleT) break; s++; }
    e = s;
    while (e < n) { c = chi[e]; if (vcov[c] || rage[c] > settleT) break; e++; }
    if (e - s >= VEIN_BRIDGE_MIN && veinN < VEIN_MAX && vpN + (e - s) + 2 <= VEIN_PTS_CAP) {
      var ax0 = -1, ap0 = -1, ax1 = -1, ap1 = -1;
      /* each end's heading is taken over two points, outward, so a
         single cell's wobble does not set it */
      var s2 = s + 2 < e ? s + 2 : e - 1, e2 = e - 3 >= s ? e - 3 : s;
      var p0 = nearestVeinPoint(chx[s], chy[s], chx[s] - chx[s2], chy[s] - chy[s2]);
      if (p0 < 0) p0 = nearestGrowPoint(chx[s], chy[s]);
      if (p0 >= 0) { ax0 = veinOfPoint(p0); ap0 = p0 - vStart[ax0]; }
      else if (bodyV[chi[s]] >= BODY_LEVELS[VEIN_ATTACH]) ax0 = -2;
      var p1 = nearestVeinPoint(chx[e - 1], chy[e - 1], chx[e - 1] - chx[e2], chy[e - 1] - chy[e2]);
      if (p1 < 0) p1 = nearestGrowPoint(chx[e - 1], chy[e - 1]);
      if (p1 >= 0) { ax1 = veinOfPoint(p1); ap1 = p1 - vStart[ax1]; }
      else if (bodyV[chi[e - 1]] >= BODY_LEVELS[VEIN_ATTACH]) ax1 = -2;
      /* The spur length. The medial axis of a tube runs a branch out to
         every bump on the tube's outline, and a branch that only reaches
         from the axis to the edge is the bump, not a tube: it is about
         as long as the axis is far from the edge. A tube leaving a trunk
         runs on past the trunk's edge, so it is longer than that by the
         time it is worth a line. */
      var dA = bodyD[chi[s]], dB = bodyD[chi[e - 1]];
      var dHi = dA > dB ? dA : dB, dLo = dA > dB ? dB : dA;
      var spurLen = e - s <= dHi * VEIN_SPUR + 1;
      /* What a snapped stretch IS decides what is asked of it. One that
         enters a vein's end point along that vein's own line CONTINUES
         it, and may be as short as it likes: a short continuation is
         the few cells between a vein and a covered zone that a longer
         stretch would never claim, and left unpinned those were the
         gaps in every line; the stretch that closes the gap between two
         veins facing each other along one tube is a continuation of
         either. One that meets a vein anywhere else, or at an angle, is
         a BRANCH — a side tube or a spur, and at the length of a spur
         the two cannot be told apart, so a branch is pinned only once
         it is longer than a spur could be: the bumps on a tube's film
         outline drew as ticks down both sides of every tube while only
         a distance-drop test was asked of them, because at the film
         level the bumps are soft and the field along a spur barely
         falls. Snapped at both ends and continuing neither, a stretch
         is a RUNG — a spur to a side bump that found an older vein near
         the bump — and a rung is a branch: exempted, as a bridge, they
         drew as ladders down every tube whose axis had moved. A stretch
         standing on its own, attached only through the tissue, needs
         the full length and must not be a spur by the distance test.
         And a stretch that leaves a vein and comes back to it within the
         snap's reach is a loop beside it, and is nothing. */
      var loopy = p0 >= 0 && p1 >= 0 && ax0 === ax1 && Math.abs(ap0 - ap1) <= VEIN_SNAP * 2;
      var cont0 = p0 >= 0 && continuesVein(p0, ax0, ap0, chx[s] - chx[s2], chy[s] - chy[s2]);
      var cont1 = p1 >= 0 && continuesVein(p1, ax1, ap1, chx[e - 1] - chx[e2], chy[e - 1] - chy[e2]);
      /* Since a stretch may only be pinned where it starts at a vein's
         END (or on the root), the barb question — a spur off a trunk's
         side, or a rung between two — no longer arises: a stretch
         leaving a tip is growth. A continuation may be as short as it
         likes; anything else needs VEIN_MINLEN points and must not be a
         spur by the distance test. The old branch rule, which asked a
         branch to end at the mask's edge or on another vein, kept every
         spoke off the root ring unpinned: a tube's axis ends a
         half-width short of its edge, so a growing tip never passed. */
      var ok;
      if (loopy) ok = false;
      else if (cont0 || cont1) ok = true;
      else ok = e - s >= VEIN_MINLEN && !(spurLen && dLo < dHi - 0.5);
      /* Veins grow one way: from the end of a vein. A stretch is pinned
         only where one of its ends stands on the END point of a pinned
         vein — the tip it continues, or a tip it branches from — or,
         while nothing has been pinned near it, on the inoculation drop
         itself (onRoot), whose edge is the first vein and the root every
         line descends from. Nothing appears on its own in the middle of
         the tissue, however good a ridge it is; the ridge waits for a
         line to reach it. The far end may land anywhere on any vein,
         which is how a growing tip closes a loop. An end that merely
         stands on tissue is not attached: it stays free, and the free
         ends' reach joins it to whatever comes within its snap. */
      var end0 = p0 >= 0 && (vRoot[ax0] || ap0 === 0 || ap0 === vCount[ax0] - 1);
      var end1 = p1 >= 0 && (vRoot[ax1] || ap1 === 0 || ap1 === vCount[ax1] - 1);
      var root0 = ax0 === -2 && onRoot(chi[s]);
      var root1 = ax1 === -2 && onRoot(chi[e - 1]);
      if (ax0 === -2 && !root0) ax0 = -1;
      if (ax1 === -2 && !root1) ax1 = -1;
      if (ok && (end0 || end1 || root0 || root1)) {
        var v = veinN++, sum = 0;
        vStart[v] = vpN;
        /* A continuation's first points are folded onto the line of the
           end it continues: the axis of a thin tube stands a cell or two
           to one side of where it stood when the last piece was pinned,
           and pieces that each began with that offset drew the tube as a
           sawtooth. The lateral offset from the end's tangent is taken
           off by two thirds at the first point and a third at the
           second, so it is gone over three points; done here, before
           the points are frozen, so nothing ever moves afterwards. */
        if (cont0) foldOnto(p0, ax0, ap0, s, 1);
        if (cont1) foldOnto(p1, ax1, ap1, e - 1, -1);
        /* the snapped point goes on the end, so the stretch keeps every
           crest it found and the hop to the vein it joins is one short
           segment; both hops are inside VEIN_SNAP by construction */
        if (p0 >= 0) { vpx[vpN] = vpx[p0]; vpy[vpN] = vpy[p0]; vpW[vpN] = vpW[p0]; vpN++; }
        for (k = s; k < e; k++) {
          vpx[vpN] = chx[k]; vpy[vpN] = chy[k]; vpW[vpN] = bodyD[chi[k]]; vpN++;
          sum += bodyV[chi[k]];
        }
        if (p1 >= 0) { vpx[vpN] = vpx[p1]; vpy[vpN] = vpy[p1]; vpW[vpN] = vpW[p1]; vpN++; }
        vCount[v] = vpN - vStart[v];
        vFlow[v] = sum / (e - s);
        vBand[v] = veinBand(vFlow[v], 255);
        vBorn[v] = S.simT;
        vState[v] = 1;
        vRoot[v] = 0;
        vAtt[v * 4] = ax0; vAtt[v * 4 + 1] = ap0; vAtt[v * 4 + 2] = ax1; vAtt[v * 4 + 3] = ap1;
        /* the continuation links, for the painter's chains: at most one
           successor and one predecessor each, first come */
        vNext[v] = -1; vPrev[v] = -1;
        if (cont0 && ap0 === vCount[ax0] - 1 && vNext[ax0] < 0) { vNext[ax0] = v; vPrev[v] = ax0; vRepaint = true; }
        if (cont1 && ap1 === 0 && vPrev[ax1] < 0) { vPrev[ax1] = v; vNext[v] = ax1; vRepaint = true; }
        for (k = vStart[v]; k < vpN; k++) { coverPoint(k); vpLive[k] = 1; }
      }
    }
    s = e;
  }
}

/* The live half: every vein's measure, band and state, each rebuild. The
   measure is the mean of the eased body under the vein's points; below
   the film level there is no tissue under it and it becomes a record,
   and above the level by the band margin it comes back. The cost is one
   read per point, which for a grown dish is under a hundred thousand. */
function veinWidths() {
  var dt = S.simT - veinWT;
  veinWT = S.simT;
  if (dt < 0) dt = 0;
  var kw = dt > 0 ? 1 - Math.exp(-dt / VEIN_W_TAU) : 0;
  var lvOn = BODY_LEVELS[0] * (1 + BAND_HYST), lvOff = BODY_LEVELS[0];
  for (var v = 0; v < veinN; v++) {
    var st = vStart[v], en = st + vCount[v], sum = 0, bw0 = VEIN_BANDS[vBand[v]].w;
    for (var p = st; p < en; p++) {
      var pc = (vpy[p] | 0) * GW + (vpx[p] | 0);
      var bp = bodyV[pc];
      sum += bp;
      var pl = vpLive[p] ? (bp >= lvOff ? 1 : 0) : (bp >= lvOn ? 1 : 0);
      if (pl !== vpLive[p]) { vpLive[p] = pl; vRepaint = true; }
      /* the stroke follows the tube under the point: a repaint when its
         quantised width steps */
      var wq0 = strokeQ(vpW[p], bw0);
      vpW[p] += (bodyD[pc] - vpW[p]) * kw;
      if (strokeQ(vpW[p], bw0) !== wq0) vRepaint = true;
    }
    var f = vFlow[v] + (sum / (en - st) - vFlow[v]) * kw;
    vFlow[v] = f;
    var live = vState[v] ? (f >= BODY_LEVELS[0] ? 1 : 0) : (f >= BODY_LEVELS[0] * (1 + BAND_HYST) ? 1 : 0);
    var b = live ? veinBand(f, vBand[v]) : 0;
    if (live !== vState[v]) { vRecDirty = true; vRepaint = true; vState[v] = live; }
    if (b !== vBand[v]) { vRepaint = true; vBand[v] = b; }
  }
}

/* ---- drawing a chain ----
   A chain is a vein and the continuations hung on its end, walked
   through vNext; it is drawn as one line. The stored points are never
   touched: the chain's points are copied out, the copy is smoothed with
   two passes of a 1-2-1 average with the chain's two ends held (they
   are attachment points, and a join has to stay exact), and the smooth
   copy is what the quadratics are laid through. Each point still knows
   its vein, for the band, and whether the body is under it, for the
   record: a segment goes into its vein's band path when both its
   points are live and the vein is, and into the record path otherwise,
   so a vein that crosses a hole is bright to the hole's edge and a
   ghost across it. */
var VEIN_CHAIN_CAP = 65536;
var vcx = new Float32Array(VEIN_CHAIN_CAP), vcy = new Float32Array(VEIN_CHAIN_CAP);
var vcx2 = new Float32Array(VEIN_CHAIN_CAP), vcy2 = new Float32Array(VEIN_CHAIN_CAP);
var vcOwn = new Int32Array(VEIN_CHAIN_CAP), vcLive = new Uint8Array(VEIN_CHAIN_CAP);
var vcW = new Float32Array(VEIN_CHAIN_CAP);
var vcN = 0;
var vChainSeen = new Uint8Array(VEIN_MAX);   /* veins already drawn this pass */

/* gather the chain from vein v0 onward; single: this vein alone */
function gatherChain(v0, single) {
  var v = v0, n = 0, first = true;
  while (v >= 0 && !vChainSeen[v]) {
    var st = vStart[v], cnt = vCount[v];
    if (n + cnt > VEIN_CHAIN_CAP) break;
    vChainSeen[v] = 1;
    /* the joint point is the last of the vein before and the first of
       this one; keep the one copy, owned by the vein before */
    for (var q = first ? 0 : 1; q < cnt; q++) {
      vcx[n] = vpx[st + q]; vcy[n] = vpy[st + q]; vcW[n] = vpW[st + q];
      vcOwn[n] = v; vcLive[n] = vpLive[st + q]; n++;
    }
    first = false;
    if (single) break;
    v = vNext[v];
  }
  vcN = n;
}

/* two 1-2-1 passes over the chain's copy, the ends held */
function smoothChain() {
  var n = vcN, k, pass;
  if (n < 3) return;
  for (pass = 0; pass < 2; pass++) {
    vcx2[0] = vcx[0]; vcy2[0] = vcy[0]; vcx2[n - 1] = vcx[n - 1]; vcy2[n - 1] = vcy[n - 1];
    for (k = 1; k < n - 1; k++) {
      vcx2[k] = (vcx[k - 1] + 2 * vcx[k] + vcx[k + 1]) * 0.25;
      vcy2[k] = (vcy[k - 1] + 2 * vcy[k] + vcy[k + 1]) * 0.25;
    }
    for (k = 0; k < n; k++) { vcx[k] = vcx2[k]; vcy[k] = vcy2[k]; }
  }
}

/* one run of the chain, points a..b inclusive, as a subpath: quadratics
   through the midpoints, so the walk's 45-degree steps are not a
   staircase; the ends are hit exactly */
function runSubpath(path, a, b) {
  path.moveTo(vcx[a], vcy[a]);
  if (b - a === 1) { path.lineTo(vcx[b], vcy[b]); return; }
  for (var q = a + 1; q < b; q++) {
    path.quadraticCurveTo(vcx[q], vcy[q], (vcx[q] + vcx[q + 1]) * 0.5, (vcy[q] + vcy[q + 1]) * 0.5);
  }
  path.lineTo(vcx[b], vcy[b]);
}

/* a stroke width, in quantised steps of a cell, from a half-width under
   a point: the tube when it is wider than the band's hairline bw, else
   the hairline */
function strokeQ(d, bw) {
  var w = 2 * d * VEIN_TUBE;
  if (w < bw) w = bw;
  if (w > VEIN_TUBE_MAX) w = VEIN_TUBE_MAX;
  return Math.round(w * VEIN_TUBE_Q);
}
var VEIN_KEYS = (VEIN_TUBE_MAX * VEIN_TUBE_Q + 2) * VEIN_BANDS.length;

/* the chain's runs into the stroke paths and the record path: a segment
   k..k+1 belongs to the vein of point k+1 (the joint point is the
   earlier vein's, so the segment after it is the later's), and is live
   when both points are and that vein is. The paths are keyed by width
   step and band, so every run of one width and colour is one stroke. */
/* the graph is LINES: a vein's stroke is its band's width. (The tube
   width under the points, vcW, is used only when TUBES is on.) */
function segKey(k) {
  var own = vcOwn[k + 1], d = TUBES ? (vcW[k] > vcW[k + 1] ? vcW[k] : vcW[k + 1]) : 0;
  return strokeQ(d, VEIN_BANDS[vBand[own]].w) * VEIN_BANDS.length + vBand[own];
}
function emitChain(bandPaths, rec) {
  var n = vcN, k = 0;
  while (k < n - 1) {
    var own = vcOwn[k + 1];
    var live = vState[own] && vcLive[k] && vcLive[k + 1];
    var key = segKey(k), a = k;
    while (k < n - 1 && vcOwn[k + 1] === own && (vState[own] && vcLive[k] && vcLive[k + 1]) === live && segKey(k) === key) k++;
    /* the run is a..k; if the next segment continues in another vein
       with the same fate, the join point is shared anyway */
    if (live) { if (!bandPaths[key]) bandPaths[key] = new Path2D(); runSubpath(bandPaths[key], a, k); }
    else { if (!rec.path) rec.path = new Path2D(); runSubpath(rec.path, a, k); }
  }
}

/* The live graph's canvas, brought up to date: sized to the veil (a
   resize repaints), painted whole if anything in the picture changed —
   a band, a state, a point's body, a continuation pinned — and the last
   whole painting is VEIN_REPAINT behind, else appended with the veins
   pinned since, each drawn on its own until the next whole painting
   folds it into its chain. The record path is remade with the whole
   painting. Called from the veil's colour pass, so the canvas it hands
   over is always the size of the one it goes into. */
function paintVeinGraph() {
  if (!veil || !veil.width) return;
  if (!vgc) { vgc = document.createElement('canvas'); vgctx = vgc.getContext('2d'); }
  /* A halted dish gets no later rebuild, so its last one must not be
     the one the interval withholds: the verdict would show a picture a
     band change behind, and a replay exit, restoring the newer arrays,
     would repaint to a different plate. */
  var full = vRepaint && (!S.running || S.simT - vPaintT >= VEIN_REPAINT);
  if (vgc.width !== veil.width || vgc.height !== veil.height) { vgc.width = veil.width; vgc.height = veil.height; full = true; }
  if (!full && vDrawn === veinN) return;
  var sx = vgc.width / GW, sy = vgc.height / GH, from = vDrawn, b, v;
  var bandPaths = new Array(VEIN_KEYS), rec = { path: null };
  for (b = 0; b < VEIN_KEYS; b++) bandPaths[b] = null;
  if (full) {
    vChainSeen.fill(0);
    /* chains from their heads first, so a whole chain is one smooth
       line; whatever is left is a loop or a stray and is drawn alone */
    for (v = 0; v < veinN; v++) { if (vPrev[v] < 0 && !vChainSeen[v]) { gatherChain(v, false); smoothChain(); emitChain(bandPaths, rec); } }
    for (v = 0; v < veinN; v++) { if (!vChainSeen[v]) { gatherChain(v, true); smoothChain(); emitChain(bandPaths, rec); } }
    vRecPath = rec.path;
  } else {
    for (v = from; v < veinN; v++) { vChainSeen[v] = 0; gatherChain(v, true); smoothChain(); emitChain(bandPaths, rec); }
  }
  vgctx.save();
  vgctx.setTransform(1, 0, 0, 1, 0, 0);
  if (full) { vgctx.clearRect(0, 0, vgc.width, vgc.height); vRepaint = false; vPaintT = S.simT; }
  vgctx.setTransform(sx, 0, 0, sy, 0, 0);
  vgctx.lineCap = 'round';
  vgctx.lineJoin = 'round';
  /* widest first, so the narrower tubes land on top of the trunks they
     join; the key runs up in width, then band */
  var nb = VEIN_BANDS.length;
  for (b = VEIN_KEYS - 1; b >= 0; b--) {
    if (!bandPaths[b]) continue;
    vgctx.lineWidth = ((b / nb) | 0) / VEIN_TUBE_Q;
    vgctx.strokeStyle = VEIN_BANDS[b % nb].style;
    vgctx.stroke(bandPaths[b]);
  }
  vgctx.restore();
  vDrawn = veinN;
}

function tintVeins(vein) {
  for (var i = 0; i < VEIN_BANDS.length; i++) {
    var band = VEIN_BANDS[i];
    var c = mixLamp(vein, band.hot);
    band.style = 'rgba(' + Math.round(c[0] * band.dim) + ','
                         + Math.round(c[1] * band.dim) + ','
                         + Math.round(c[2] * band.dim) + ',' + band.alpha + ')';
    band.ink = 'rgb(' + Math.round(c[0] * band.dim) + ','
                      + Math.round(c[1] * band.dim) + ','
                      + Math.round(c[2] * band.dim) + ')';
  }
  /* The advancing front, and the one place mixWhite is still right. A tip is
     a filament with no tube behind it yet — film thin enough that the plate
     shows through, which is what a fan of new growth looks like on agar:
     pale, milky, barely coloured, nothing like the trunks it will thicken
     into. So it walks toward white and LOSES chroma, where a crest walks
     toward the lamp and gains it. The two walks disagreeing is the point. */
  TIP_STYLE = rgba(mixWhite(vein, 0.42), '0.34');
  /* A mass catches the lamp about as hard as the second-widest band does: it
     is the same tissue standing at about the same height, and taking it any
     brighter walks a pad the size of a flake toward white, which is the one
     tone on this plate that never means tissue.

     Read off that band rather than written here as a number, for the reason
     hotBandK reads the widest one: as a constant it was 0.24 against a band
     of 0.28, which is the sentence above; the moment the bands came down it
     would have been 0.24 against 0.17, and the pads would have become the
     BRIGHTEST thing on the plate while the comment went on claiming they
     matched. Derived, it cannot drift from what it says it is. */
  LOBE_STYLE = rgba(mixLamp(vein, VEIN_BANDS[3].hot), '1');
  for (var kb = 0; kb < BODY_LEVELS.length; kb++) {
    BODY_STYLE[kb] = rgba(kb === 0 ? mixWhite(vein, 0.42) : mixLamp(vein, BODY_HOT[kb]), '' + BODY_ALPHA[kb]);
  }
  /* a tube's tone by its width: the tissue tone at two cells and under,
     the widest band's lamp at sixteen and beyond — a trunk off the core
     is fourteen to eighteen across, a mesh edge four to eight */
  for (var kt = 0; kt < TUBE_KEYS; kt++) {
    var tw = (kt / VEIN_TUBE_Q - 2) / 14;
    if (tw < 0) tw = 0; else if (tw > 1) tw = 1;
    TUBE_STYLE[kt] = rgba(mixLamp(vein, 0.04 + 0.46 * tw), '1');
  }
  REC_STYLE = rgba(vein, '1');
  /* the graph's canvas holds the old styles until it is painted whole */
  vRepaint = true; vPaintT = -1e9;
}
var VEIN_CAP = 200000;                 /* floats held per band per rebuild */
/* Each band's array holds RUNS now, not whole chains: [bucket, count, x0,y0,
   ...] repeating, where bucket is the presence tier the run is drawn at. A
   chain whose cells sit in different tiers is split at the boundaries, with
   the boundary point in both runs so the line stays connected. veinPath[b] is
   correspondingly [Path2D|null x3], one per tier. */
var vseg = [], vsegN = [], veinPath = [];
(function () {
  for (var i = 0; i < VEIN_BANDS.length; i++) {
    vseg.push(new Float32Array(VEIN_CAP));
    vsegN.push(0);
    veinPath.push(null);
  }
})();

/* ---- the presence envelope: pop becomes fade ----
   The hysteresis above reduces how often a cell's drawn/not-drawn decision
   FLIPS; this reduces how loud each flip is. Every drawn cell carries a
   presence that rises while the rebuild keeps choosing it and decays when it
   stops, and the strokes are drawn at an alpha tier picked from it — so a
   branch that blinks for one rebuild never reaches full contrast, and one
   that vanishes leaves at a third strength rather than from full.

   It is an envelope on the OUTPUT, not a low-pass on the input: geometry is
   never delayed — a new branch is stroked in the right place on the rebuild
   that finds it, merely starting quiet. That is the difference between this
   and VEIN_TAU, whose smoothing genuinely lags the organism.

   Clocked in SIM time, for the reason VEIN_TAU is: at x12 a rebuild advances
   ~0.4 sim-seconds, the rise saturates and the decay empties in one step, and
   the envelope self-disables — a time-lapse retract cannot leave comet tails,
   because the fade is twelve times faster in wall terms exactly when the
   organism is twelve times faster. At x1 a blink reaches ~0.3 presence and a
   real branch is at full strength in ~0.2s of wall clock.

   Presence is per CELL (the cell index is the identity), which is what lets
   this work without tracking which chain this rebuild corresponds to which
   chain last rebuild — the rebuild derives everything from scratch and has no
   such correspondence to offer. */
var venv = new Float32Array(NCELL);   // vein-crest presence
var lenv = new Float32Array(NCELL);   // lobe-mass presence
/* When each cell was last drawn, in sim time. Presence used to be decayed
   across the whole grid every rebuild and then partially re-raised, and that
   recurrence never converges: at the usual 0.033s rebuild interval it fixes at
   0.56, below the full-strength tier, so established veins sat in the middle
   tier forever. With a timestamp the rise is undamped while a cell is held —
   full strength in ~5 rebuilds as intended — and the decay charged at the next
   arrival is exactly the time the cell was actually absent: gap minus the one
   interval a continuously-held cell always has. */
var vseen = new Float32Array(NCELL);
var lseen = new Float32Array(NCELL);
var envT = 0;                         // S.simT at the last envelope step
/* Slower than the first cut (0.10/0.09), which softened each flip over
   ~0.2s — fast enough that the eye still parsed it as a blink, just a quieter
   one. At these clocks an arrival grows over ~0.3s and an exit glides out
   over ~0.4s, which reads as an animation rather than a glitch. Still sim
   time: at x12 the rise is near-instant and the fall is one rebuild. */
var ENV_UP_TAU = 0.22;                // sim-seconds to rise
var ENV_DN_TAU = 0.18;                // sim-seconds to fall
/* Three tiers rather than a continuous alpha, because a continuous alpha is a
   Path2D per distinct value: the whole layer stays a handful of draw calls. */
var BUCK_A  = [0.35, 0.68, 1];        // stroke alpha per tier
function envBucket(p) { return p < 0.35 ? 0 : (p < 0.75 ? 1 : 2); }

/* The other half of the envelope, and the half the tiers cannot do: FADE-OUT.
   A cell the rebuild keeps can be drawn quiet, but a cell the rebuild drops is
   in no chain at all — there is no geometry left to draw its exit with. So the
   exit is done in pixels instead of paths: the vein layer is stroked into its
   own canvas, and an accumulator keeps, per pixel, the brighter of the fresh
   layer and its own decayed self —

       acc = max(acc x veilDn, fresh)

   A pixel both frames draw is unchanged (max picks the undecayed new value); a
   pixel only the OLD frame drew fades exponentially instead of vanishing. No
   identity, no correspondence, no extra geometry — 'lighten' is per-channel
   max and three drawImage calls per rebuild buy the whole thing.

   veilDn comes from the same sim-time dt as the tiers, so at x12 it is ~0.01
   and the accumulator degenerates to a plain copy: a time-lapse retract
   cannot smear, because the fade runs twelve times faster exactly when the
   organism does. On a rebuild with no time behind it (a restore, the verdict
   render) it is 0 outright, which makes the accumulator exactly the fresh
   layer — a dish being put back must not inherit the fading ghosts of the
   dish it replaces. */
var veil = null, vlctx = null;        // this rebuild's strokes
var veilMask = null, vmctx = null;    // the same strokes, opaque — the punch
var veilAcc = null, vactx = null;     // the running max
/* ---- the ink ----
   A vein line, once drawn, is never erased. The veil above fades a line the
   trace no longer finds, over about half a second, to nothing — which is
   right for the live picture and wrong for the record: a tube the organism
   has withdrawn from leaves its track on the agar, the faint vector of the
   filament that was there, and that is what a lab plate shows at the end.
   So every fresh stroke of the vein layer is laid a second time, opaque, in
   its band's own colour, into a canvas that is never decayed and never
   punched, and that canvas is composited under the live veins at INK_A. A
   line drawn a thousand times is no brighter than one drawn once, since the
   strokes are opaque; a line drawn once stays. Cleared only when a dish is
   built or a replay abandoned, and carried across a resize. Masses and the
   front's whiskers are not inked: the record is of the lines. Settled tier
   only, because the trace wobbles by a cell or so from rebuild to rebuild
   and inking every rebuild's line filled the space between them. The
   walls are painted OVER the record: a door that closes across a recorded
   vein, or a wall poured over one, covers it, as it covers the agar. */
var ink = null, ictx = null;
var INK_A = 0.30;                     // how much of the live vein's brightness the record keeps
/* ...for the line record of the crests. The GRAPH's record — veins the
   tissue has drifted off — is drawn as a line in its own right, at
   REC_A: with nothing under the lines it is half the network, and at a
   third alpha the network read broken. It never moves and is never
   erased; it is only the veins the flow has left. */
var REC_A = 0.62;
/* With the body drawn, the record is the TUBE FOOTPRINT rather than the
   lines: recV is the most the eased body has ever stood at, per cell, and
   its outline at the tube level, traced like the body's, is every place a
   tube has stood. It is filled into the ink, opaque and in the tissue
   tone, and composited under the live body at INK_A — the ghost of routes
   the organism has withdrawn from, as an agar plate shows them.

   A field and an outline rather than an accumulating canvas, because a
   canvas cannot be made idempotent: an opaque fill of the same path
   repeated compounds its antialiased edge toward full coverage, and a
   stationary tube's recorded edge darkened and widened for standing still
   (the failure the old recorder's per-cell-once rule guarded against).
   The ink is cleared and refilled from the outline each rebuild, so it is
   a cache of the outline and nothing more, and a resize refills it. */
var REC_LEVEL = 2;                    // index into BODY_LEVELS: the tube, trail 12
var REC_STYLE = '';
var recV = new Float32Array(NCELL);
var recPath = null;
function recordBody(tc, sx, sy) {
  tc.save();
  tc.setTransform(1, 0, 0, 1, 0, 0);
  tc.clearRect(0, 0, tc.canvas.width, tc.canvas.height);
  tc.setTransform(sx, 0, 0, sy, 0, 0);
  if (recPath) {
    tc.fillStyle = REC_STYLE;
    tc.fill(recPath, 'evenodd');
  }
  /* the graph's record veins, over the footprint: the lines of tubes
     the tissue has left, opaque here in the hairline's ink and
     composited with the rest of the record at INK_A */
  if (vRecPath) {
    tc.lineCap = 'round';
    tc.lineJoin = 'round';
    tc.lineWidth = VEIN_BANDS[1].w;
    tc.strokeStyle = VEIN_BANDS[1].ink;
    tc.stroke(vRecPath);
  }
  tc.restore();
}
/* Which cells the record already holds. A settled run is inked only where it
   passes through a cell not yet inked, and each such piece is stroked into
   the ink exactly once: that is what makes the record idempotent. Stroking
   the whole settled path again every rebuild was not, even opaque — the
   antialiased edge pixels take fractional coverage each time and creep
   toward full, so a line that merely sat still grew darker and wider by a
   pixel for having been rebuilt longer. */
var inked = new Uint8Array(NCELL);

/* Lay this rebuild's settled runs into the record, new cells only. Walks the
   runs of every band as the bake does; a run's piece through a cell not yet
   inked is the segment into that point and the segment out of it. */
function inkFresh(tc, sx, sy) {
  tc.save();
  tc.setTransform(sx, 0, 0, sy, 0, 0);
  tc.lineCap = 'round';
  tc.lineJoin = 'round';
  for (var b = VEIN_BANDS.length - 1; b >= 0; b--) {
    var end = vsegN[b];
    if (!end) continue;
    var a3 = vseg[b], r = 0, path = null;
    while (r < end) {
      var tk = a3[r++] | 0;
      var cnt = a3[r++] | 0;
      if (tk === 2) {
        for (var q = 0; q < cnt; q++) {
          var x = a3[r + q * 2], y = a3[r + q * 2 + 1];
          var ci = (y | 0) * GW + (x | 0);
          if (ci < 0 || ci >= NCELL || inked[ci]) continue;
          inked[ci] = 1;
          if (!path) path = new Path2D();
          if (q > 0) { path.moveTo(a3[r + q * 2 - 2], a3[r + q * 2 - 1]); path.lineTo(x, y); }
          if (q + 1 < cnt) { path.moveTo(x, y); path.lineTo(a3[r + q * 2 + 2], a3[r + q * 2 + 3]); }
          if (cnt === 1) { path.moveTo(x, y); path.lineTo(x + 0.01, y); }
        }
      }
      r += cnt * 2;
    }
    if (path) {
      tc.lineWidth = VEIN_BANDS[b].w;
      tc.strokeStyle = VEIN_BANDS[b].ink;
      tc.stroke(path);
    }
  }
  tc.restore();
}
var veilTmp = null, vtctx = null;     // scratch for the in-place decay
var veilDn = 0;                       // decay folded in at the next composite
var veinFresh = false;                // buildVeins ran since the last composite
var whiskPath = null;

/* The four directions a vein can run ACROSS: the across unit vector, the
   tangent it runs along, and the two cell offsets that step along that
   tangent. */
/* Ordered so the LINE each tangent describes rotates by a steady -45 degrees
   per index: south, south-east, east, north-east. The middle entry used to be
   written north-west, which is the same line but the opposite ray, so it
   pointed backwards from both of its neighbours and a walk crossing it turned
   round into the part of the vein it had just claimed. */
/* Two fields exist for the sub-cell fit below, which is the first thing here
   to care which WAY across a vein it is looking rather than only about the
   line. `sp` is how far apart the two across-samples are — one cell on the
   axis-aligned pair, root two on the diagonals — because the fit measures a
   distance. And the third entry's `ax`/`ay` used to be written (0, 1) while
   its `o` of -GW samples the row ABOVE, the two disagreeing by a sign that
   nothing could see while the only use of the across-vector was ridgeStep,
   which adds it and subtracts it in the same breath. The fit reads a signed
   offset along it, so it is written pointing at `i + o` now, as the other
   three already were. */
var RIDGE_DIR = [
  { o:  1,      sp: 1,      ax:  1,      ay:  0,      tx:  0,      ty:  1,      t1:  GW,     t2: -GW     },
  { o:  1 - GW, sp: 1.4142, ax:  0.7071, ay: -0.7071, tx:  0.7071, ty:  0.7071, t1:  1 + GW, t2: -1 - GW },
  { o: -GW,     sp: 1,      ax:  0,      ay: -1,      tx:  1,      ty:  0,      t1:  1,      t2: -1      },
  { o: -1 - GW, sp: 1.4142, ax: -0.7071, ay: -0.7071, tx:  0.7071, ty: -0.7071, t1:  1 - GW, t2: -1 + GW }
];
/* Which way the vein runs at each cell, 255 for "not on a ridge", and which
   cells a walk has already claimed. Deciding the whole field before drawing
   any of it is what lets the walk below follow a vein from end to end. */
var rdir = new Uint8Array(NCELL);
var rvis = new Uint8Array(NCELL);
/* Last rebuild's answers, kept so this rebuild can be reluctant to disagree
   with them. `rprev` is the ridge map: a cell that was a crest is held as one
   against a lower floor, because a vein that dips a per cent below the
   threshold for one rebuild has not stopped being a vein, and dropping it
   there does not shorten the line by one cell — it cuts the chain in two, and
   either half that falls under RIDGE_MINPTS is discarded whole. That is why
   the twitch reads as whole veins blinking rather than as edges shimmering.
   `rbandP` is which band each crest cell was drawn in, the raw material for
   the same reluctance applied to width and brightness.

   Both are halves of a pair that swaps every rebuild, and the band map has to
   be as much as the ridge map does. A single map, only ever written where a
   chain was accepted, is not a record of the LAST rebuild — it is a record of
   the last rebuild in which each cell happened to carry a vein, which for
   ground a vein has left is arbitrarily old. Fresh growth over it would then
   be told it had a band to be loyal to, and hysteresis anchored to an obsolete
   observation holds a regrown vein at an obsolete width indefinitely, because
   each rebuild rewrites the stale answer as the new one. Clearing the current
   map each rebuild is what makes "no memory" mean no memory. */
var rprev = new Uint8Array(NCELL);
var rband = new Uint8Array(NCELL);    // this rebuild's bands
var rbandP = new Uint8Array(NCELL);   // last rebuild's, what pickBand consults
/* Where along the across-vector the crest actually lies, in cells, relative to
   the cell centre; see the parabolic fit in pass one. */
var roff = new Float32Array(NCELL);
/* How far a crest cell is held past the threshold it entered on, and how much
   a direction is favoured for being the one this cell ran last time. The
   direction stickiness matters more than its size suggests: a cell whose four
   scores are nearly tied picks a different winner each rebuild, its chain
   reroutes through a different neighbour, and the vein wags. */
var RIDGE_HOLD = 0.60;   // combo-mid: crests held harder once found
var DIR_STICK  = 1.25;   // combo-mid: directions stickier against re-rolls
/* the relaxed floors, folded once rather than per cell — pass one is 106,000
   cells with a four-way loop inside it, and this is its innermost arithmetic */
var RIDGE_MIN_LO = RIDGE_MIN * RIDGE_HOLD;
var RIDGE_K_LO   = RIDGE_K   * RIDGE_HOLD;
var RIDGE_REL_LO = RIDGE_REL * RIDGE_HOLD;
var RIDGE_MINPTS = 5;        // a chain shorter than this is speckle
/* ---- the joins ----
   A chain ends where the walk finds no next cell: a cell that failed the
   curvature floor, a flat that ridgeStep's two-cell reach cannot cross, a
   side branch that stops a few cells short of the trunk it was heading
   for. The vein under it does not end there; the sheet used to draw the
   rest, and with the sheet gone every such gap is a break in the line.
   So each chain end reaches for what it was walking toward: it marches
   up to JOIN_R cells along its own tangent, one cell either side, and the
   first cell that belongs to another chain gets a segment from the end to
   that cell's crest, in the end's own band and tier. rchain says which
   chain a cell is on (0 for none, or for a chain dropped as speckle), and
   the endpoint lists are filled as chains are emitted. */
var JOIN_R = 8;              // cells a chain end reaches, along its tangent, over bare agar
/* ...and further through TISSUE. A line that starts detached — a hairline
   hanging in the dark a few cells off the body — is a chain whose inner
   end sits on the body's plateau: the ridge test finds no ridge on flat
   tissue, so the walk stopped there, and the tissue itself is no longer
   drawn. The vein is attached; the picture was not. So through tissue the
   reach is longer, and a mass counts as something to join to: the end
   marches on while the cells under it are body, and stops at the first
   chain or mass it meets, or where the body ends. Bare agar still gives
   the short reach, and a wall still ends it. */
var JOIN_T = 12;             // cells a chain end reaches through tissue (a straight chord: kept short)
/* And when the tangent finds nothing, the end CLIMBS: from its cell, step
   by step onto the highest neighbouring trail that is not its own chain,
   as long as the trail keeps rising, until it lands on another chain or a
   mass. The trail between a thread's root and the body rises toward the
   body, whatever direction the thread happens to leave at, so this is the
   walk that finds the root the tangent misses. The climb is drawn as it
   was walked, not straightened. Off a free tip it goes nowhere: the only
   higher ground there is the chain's own cells, which are excluded. */
var JOIN_CLIMB = 24;         // cells a chain end climbs the trail
var JOIN_FLOOR = RIDGE_MIN;  // trail below which there is nothing to climb
var jcx = new Float32Array(JOIN_CLIMB + 2), jcy = new Float32Array(JOIN_CLIMB + 2);
var jvis = new Int32Array(NCELL), jstamp = 0;   // cells a climb has stood on, by endpoint
/* ---- one drawing ----
   Everything above reaches for a gap it can see from a chain end. This is
   the guarantee behind it: after the reaches, the drawn pieces — chains,
   masses, the joins between them — are one graph, and any piece not
   connected to the main piece is connected to it by the shortest path
   through the organism's own tissue, found by a breadth-first search from
   the main piece over the cells the body test counts as body (trail at
   CONN_T or more, no walls), and drawn as walked, in the piece's band. The
   simulation keeps the organism one body by that same test, so the path
   exists for every piece that is body; a piece with no path is an island
   the simulation is a few steps from reabsorbing, and is counted
   (veinIslands) rather than drawn to. Chains are entities 1..chainN, drawn
   lattice cells chainN+1 onward; union-find joins what touches. */
var OUF_CAP = 16384 + LW * LH;
var ouf = new Int32Array(OUF_CAP), esz = new Int32Array(OUF_CAP);
var opar = new Int32Array(NCELL), odist = new Float32Array(NCELL);
var olab = new Int32Array(NCELL);   // the piece each searched cell belongs to (its seed's, before any union)
var oset = new Uint8Array(NCELL);   // cells the search has settled: their distance and label are final
var opath = new Int32Array(4096);
/* The search is weighted: a step costs its length times a factor that is 1
   on trail at PATH_T or more and PATH_K + 1 on none, so the shortest path
   is the one that stays on tube, and a piece is joined along the thread
   that actually connects it rather than across the sheet by the shortest
   diagonal — which cut straight lines through the body and, being found
   afresh each rebuild, flashed. A binary heap with lazy deletion; the heap
   is bounded, and a search that fills it stops rather than overruns. */
var PATH_T = 30, PATH_K = 6;
var HEAP_CAP = NCELL * 4;
var hk = new Float32Array(HEAP_CAP), hv = new Int32Array(HEAP_CAP), hn = 0;
function heapPush(k, v) {
  if (hn >= HEAP_CAP) return;
  var i = hn++;
  hk[i] = k; hv[i] = v;
  while (i > 0) {
    var pi = (i - 1) >> 1;
    if (hk[pi] <= hk[i]) break;
    var tk = hk[pi]; hk[pi] = hk[i]; hk[i] = tk;
    var tv = hv[pi]; hv[pi] = hv[i]; hv[i] = tv;
    i = pi;
  }
}
function heapPop() {
  var top = hv[0];
  hn--;
  if (hn > 0) {
    hk[0] = hk[hn]; hv[0] = hv[hn];
    var i = 0;
    for (;;) {
      var l = i * 2 + 1, r = l + 1, m = i;
      if (l < hn && hk[l] < hk[m]) m = l;
      if (r < hn && hk[r] < hk[m]) m = r;
      if (m === i) break;
      var tk = hk[m]; hk[m] = hk[i]; hk[i] = tk;
      var tv = hv[m]; hv[m] = hv[i]; hv[i] = tv;
      i = m;
    }
  }
  return top;
}
var JP_CAP = 16384;
var jpA = new Int32Array(JP_CAP), jpB = new Int32Array(JP_CAP), jpN = 0;
var veinIslands = 0;
function ufind(a) {
  while (ouf[a] !== a) { ouf[a] = ouf[ouf[a]]; a = ouf[a]; }
  return a;
}
function uunion(a, b) {
  var ra = ufind(a), rb = ufind(b);
  if (ra === rb) return;
  ouf[ra] = rb; esz[rb] += esz[ra];
}
var EP_CAP = 16384;
var rchain = new Int32Array(NCELL);
var epX = new Float32Array(EP_CAP), epY = new Float32Array(EP_CAP);
var epDX = new Float32Array(EP_CAP), epDY = new Float32Array(EP_CAP);
var epB = new Uint8Array(EP_CAP), epK = new Uint8Array(EP_CAP), epC = new Int32Array(EP_CAP);
var epN = 0, chainN = 0;
function noteEnd(x, y, tx, ty, b, k, c) {
  if (epN >= EP_CAP) return;
  var len = Math.sqrt(tx * tx + ty * ty);
  if (len < 1e-6) return;
  epX[epN] = x; epY[epN] = y; epDX[epN] = tx / len; epDY[epN] = ty / len;
  epB[epN] = b; epK[epN] = k; epC[epN] = c; epN++;
}
var chx = new Float32Array(4096);
var chy = new Float32Array(4096);
var chi = new Int32Array(4096);      // the cell each chain point stands on

/* Which band a chain is drawn in — the last of the three fixes, and the one
   that matters even when the geometry is perfectly still. The bands are five
   buckets of a chain's mean height, and the step between two of them is large
   on purpose: a trunk is nearly three times a hairline's width and a good deal
   paler. A chain whose mean sits on a boundary therefore does not shimmer when
   it crosses, it FLASHES, and it crosses whenever the noise says so.

   So the boundary is asked for a margin, and only in the direction of travel:
   a chain drawn as a trunk last rebuild stays a trunk until its mean falls
   BAND_HYST below the boundary it came up through, and vice versa. Which band
   it was drawn in is remembered per cell rather than per chain, because chains
   have no identity between rebuilds — they are re-seeded in raster order and a
   single flipped cell re-cuts a vein into different pieces. Cells do have
   identity, so the vote below asks the ground rather than the chain: of the
   cells this chain covers, which band were they drawn in last time.

   A chain landing on ground with no memory (new growth, or a vein that moved)
   gets the plain answer, which is the right one — there is nothing to be
   loyal to. */
var BAND_HYST = 0.20;    // combo-mid: the band-flash margin, measured cheap
var bandVote = new Int32Array(8);

function pickBand(mean, cells, n) {
  var last = VEIN_BANDS.length - 1, b = 0, j;
  while (b < last && mean > VEIN_BANDS[b].max) b++;

  for (j = 0; j <= last; j++) bandVote[j] = 0;
  var voted = 0;
  for (j = 0; j < n; j++) {
    var pb0 = rbandP[cells[j]];
    if (pb0 <= last) { bandVote[pb0]++; voted++; }
  }
  /* A chain mostly on fresh ground is fresh: a handful of remembered cells
     under a long new vein should not name it. */
  if (voted * 2 < n) return b;
  var pb = 0;
  for (j = 1; j <= last; j++) if (bandVote[j] > bandVote[pb]) pb = j;
  if (pb === b) return b;

  if (b > pb) {
    /* climbing: hold the old band until the boundary it sits under is cleared
       by the margin. VEIN_BANDS[last].max is Infinity, and pb cannot be last
       here because b would have nowhere above it to be. */
    if (mean < VEIN_BANDS[pb].max * (1 + BAND_HYST)) return pb;
  } else {
    /* falling: likewise for the boundary below it, which exists because pb > b
       puts pb at least one band up */
    if (mean > VEIN_BANDS[pb - 1].max * (1 - BAND_HYST)) return pb;
  }
  return b;
}

/* One step along a ridge. From cell (cx, cy) running in direction d, the next
   cell is the one a step along the tangent — or, if the vein bends, one of its
   two neighbours across. A bend of one direction index (45 degrees) is allowed
   and anything sharper ends the chain, which is what stops a walk cutting the
   corner at a junction and welding two veins into one. Returns the cell index
   or -1. */
function ridgeStep(cx, cy, d, sign) {
  var dir = RIDGE_DIR[d];
  for (var t = 0; t < 6; t++) {
    /* one step along the tangent, then its two neighbours across; failing all
       three, the same three at two steps out. The longer reach is what carries
       a chain over a single cell that missed the curvature floor — without it
       a vein is cut into three or four pieces by the few cells along it that
       happen to sit on a local flat, and the network draws as dashes. */
    var reach = t < 3 ? 1 : 2;
    var px = cx + sign * dir.tx * reach, py = cy + sign * dir.ty * reach;
    var side = t % 3;
    if (side === 1) { px += dir.ax; py += dir.ay; }
    else if (side === 2) { px -= dir.ax; py -= dir.ay; }
    var ix = Math.round(px), iy = Math.round(py);
    if (ix < 1 || iy < 1 || ix >= GW - 1 || iy >= GH - 1) continue;
    var ci = iy * GW + ix;
    if (rvis[ci] || rdir[ci] === 255) continue;
    var dd = rdir[ci];
    var diff = dd - d;
    if (diff < 0) diff = -diff;
    if (diff > 2) diff = 4 - diff;          /* directions wrap at 4 */
    if (diff > 1) continue;
    return ci;
  }
  return -1;
}

/* The tip whisker: a short line back along the heading, so the front reads as
   a fan of spikes rather than as a scatter of dots. A tip has no tube yet for
   the ridge walk to find, so without this the newest growth — the part worth
   watching — would be the one thing not drawn. */
var TIP_WHISK = 2.6;   // cells
var TIP_STYLE = rgba(mixWhite(PLASMODIUM, 0.42), '0.34');  /* tintVeins owns it */
var TIP_W = 0.17;

/* The outline of the lattice cells at or above a presence tier, as a Path2D
   in grid space, pushed outward by `out` cells; null if there is none.

   Marching squares over the lattice: each square of four cells is one of
   sixteen cases, and each case cuts the square with zero, one or two
   segments between edge midpoints. The segments are oriented so the mass
   is always on the same side, which makes every edge midpoint the start of
   exactly one segment, and the loops are then a walk along those links
   with no search. The two saddle cases are cut apart rather than joined,
   so two masses touching at a corner stay two.

   A loop of four points is a lone cell — the one-rebuild blink that used
   to be a dot beside the network — and is not drawn. The rest are pushed
   outward along the vertex normal and rounded with two passes of Chaikin's
   corner cutting, which is what turns a staircase of one-cell cuts into an
   edge. */
var MS_FROM  = [-1, 0, 1, 1, 2, 0, 2, 2, 3, 0, 1, 1, 3, 0, 3, -1];
var MS_TO    = [-1, 3, 0, 3, 1, 3, 0, 3, 2, 2, 0, 2, 1, 1, 0, -1];
var MS_FROM2 = [-1, -1, -1, -1, -1, 2, -1, -1, -1, -1, 3, -1, -1, -1, -1, -1];
var MS_TO2   = [-1, -1, -1, -1, -1, 1, -1, -1, -1, -1, 2, -1, -1, -1, -1, -1];
var msEid = [0, 0, 0, 0];
function traceMass(minTier, out) {
  var NE = LW * LH, lx, ly, e;
  lnext.fill(-1);
  for (ly = 0; ly < LH - 1; ly++) {
    for (lx = 0; lx < LW - 1; lx++) {
      var n = ly * LW + lx;
      var c = (ltier[n] >= minTier ? 1 : 0) | (ltier[n + 1] >= minTier ? 2 : 0) |
              (ltier[n + LW + 1] >= minTier ? 4 : 0) | (ltier[n + LW] >= minTier ? 8 : 0);
      if (c === 0 || c === 15) continue;
      /* edges: 0 top (H lx,ly), 1 right (V lx+1,ly), 2 bottom (H lx,ly+1), 3 left (V lx,ly) */
      msEid[0] = n; msEid[1] = NE + n + 1; msEid[2] = n + LW; msEid[3] = NE + n;
      lnext[msEid[MS_FROM[c]]] = msEid[MS_TO[c]];
      if (MS_FROM2[c] >= 0) lnext[msEid[MS_FROM2[c]]] = msEid[MS_TO2[c]];
    }
  }
  lseen2.fill(0);
  var path = null, px = [], py = [];
  for (e = 0; e < NE * 2; e++) {
    if (lnext[e] < 0 || lseen2[e]) continue;
    px.length = 0; py.length = 0;
    var cur = e, guard = 0;
    do {
      lseen2[cur] = 1;
      if (cur < NE) { px.push(((cur % LW) << 1) + 1.5); py.push((((cur / LW) | 0) << 1) + 0.5); }
      else { var v = cur - NE; px.push(((v % LW) << 1) + 0.5); py.push((((v / LW) | 0) << 1) + 1.5); }
      cur = lnext[cur];
    } while (cur >= 0 && cur !== e && !lseen2[cur] && ++guard < NE * 2);
    var m = px.length;
    if (m < 6) continue;
    if (!path) path = new Path2D();
    /* push out along the vertex normal — outward is to the right of travel
       in screen space, by the orientation the table fixes — then cut corners */
    var ox = new Array(m), oy = new Array(m), k;
    for (k = 0; k < m; k++) {
      var kp = k ? k - 1 : m - 1, kn = k + 1 < m ? k + 1 : 0;
      var dx = px[kn] - px[kp], dy = py[kn] - py[kp];
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      ox[k] = px[k] + dy / len * out; oy[k] = py[k] - dx / len * out;
    }
    /* two passes of corner cutting: one rounds the corners of the one-cell
       cuts, the second takes the lattice's own four-cell bulge off the edge */
    var cx1 = ox, cy1 = oy, pass;
    for (pass = 0; pass < 2; pass++) {
      var m1 = cx1.length, cx2 = new Array(m1 * 2), cy2 = new Array(m1 * 2);
      for (k = 0; k < m1; k++) {
        var kn2 = k + 1 < m1 ? k + 1 : 0;
        cx2[k * 2] = cx1[k] * 0.75 + cx1[kn2] * 0.25; cy2[k * 2] = cy1[k] * 0.75 + cy1[kn2] * 0.25;
        cx2[k * 2 + 1] = cx1[k] * 0.25 + cx1[kn2] * 0.75; cy2[k * 2 + 1] = cy1[k] * 0.25 + cy1[kn2] * 0.75;
      }
      cx1 = cx2; cy1 = cy2;
    }
    path.moveTo(cx1[0], cy1[0]);
    for (k = 1; k < cx1.length; k++) path.lineTo(cx1[k], cy1[k]);
    path.closePath();
  }
  return path;
}

/* The body's outline at one level, as a Path2D of closed loops, or null.
   Marching squares over the full grid with the crossing point interpolated
   along each edge; the corner-bit tables are traceMass's, on the same edge
   numbering. Only cells the level actually crosses are visited — those
   whose corners straddle it, which isoMin/isoMax answer in two compares —
   and only the edges the crossing entered are walked, from the list the
   sweep collected, so the cost is the outline's length, not the plate's. */
function traceIso(f, lv, mm, keep) {
  var NE = NCELL, x, y, n, e;
  /* stamps rather than clears, one per level per rebuild; wrapped long
     before the integer runs out, with the one clear that then costs */
  if (isoStamp >= 2000000000) { isoStamp = 0; isoMark.fill(0); isoSeen.fill(0); }
  var stamp = ++isoStamp;
  isoListN = 0;
  for (y = 0; y < GH - 1; y++) {
    var row = y * GW;
    for (x = 0; x < GW - 1; x++) {
      n = row + x;
      if (mm && (isoMin[n] >= lv || isoMax[n] < lv)) continue;
      var a = f[n], b = f[n + 1], c = f[n + GW + 1], d = f[n + GW];
      var ai = a >= lv, bi = b >= lv, ci = c >= lv, di = d >= lv;
      var cs = (ai ? 1 : 0) | (bi ? 2 : 0) | (ci ? 4 : 0) | (di ? 8 : 0);
      if (cs === 0 || cs === 15) continue;
      /* edges: 0 top (H n), 1 right (V n+1), 2 bottom (H n+GW), 3 left (V n) */
      msEid[0] = n; msEid[1] = NE + n + 1; msEid[2] = n + GW; msEid[3] = NE + n;
      if (ai !== bi) { isoX[n] = x + 0.5 + (lv - a) / (b - a); isoY[n] = y + 0.5; }
      if (bi !== ci) { isoX[NE + n + 1] = x + 1.5; isoY[NE + n + 1] = y + 0.5 + (lv - b) / (c - b); }
      if (di !== ci) { isoX[n + GW] = x + 0.5 + (lv - d) / (c - d); isoY[n + GW] = y + 1.5; }
      if (ai !== di) { isoX[NE + n] = x + 0.5; isoY[NE + n] = y + 0.5 + (lv - a) / (d - a); }
      e = msEid[MS_FROM[cs]];
      isoNext[e] = msEid[MS_TO[cs]]; isoMark[e] = stamp; isoList[isoListN++] = e;
      if (MS_FROM2[cs] >= 0) {
        e = msEid[MS_FROM2[cs]];
        isoNext[e] = msEid[MS_TO2[cs]]; isoMark[e] = stamp; isoList[isoListN++] = e;
      }
    }
  }
  var path = null, li;
  for (li = 0; li < isoListN; li++) {
    e = isoList[li];
    if (isoSeen[e] === stamp) continue;
    var m = 0, cur = e;
    do {
      isoSeen[cur] = stamp;
      isoPX[m] = isoX[cur]; isoPY[m] = isoY[cur]; m++;
      cur = isoNext[cur];
    } while (cur >= 0 && cur !== e && isoMark[cur] === stamp && isoSeen[cur] !== stamp && m < ISO_LOOP_CAP);
    if (m < ISO_MINPTS) continue;
    /* the loop's inside cell: of the two cells its first edge lies
       between, the one at or above the level; a caller's keep says
       whether this loop is wanted */
    if (keep) {
      var ce = e < NE ? e : e - NE, cn = e < NE ? ce + 1 : ce + GW;
      if (!keep(f[ce] >= lv ? ce : cn, m)) continue;
    }
    if (!path) path = new Path2D();
    /* quadratics through the midpoints, every second crossing point as the
       control: the outline passes between them, the cell-scale zigzag of a
       diagonal edge is not drawn, and half the curve calls are not made —
       the crossings are a cell apart and the body has no feature that
       fine. An odd loop takes its last point as a control on its own. */
    var m2 = m & ~1, mp = m2 < m ? m - 1 : m - 2;   /* the control before point 0 */
    path.moveTo((isoPX[mp] + isoPX[0]) * 0.5, (isoPY[mp] + isoPY[0]) * 0.5);
    for (var k = 0; k < m2; k += 2) {
      var kn = k + 2 < m ? k + 2 : 0;
      path.quadraticCurveTo(isoPX[k], isoPY[k], (isoPX[k] + isoPX[kn]) * 0.5, (isoPY[k] + isoPY[kn]) * 0.5);
    }
    if (m2 < m) path.quadraticCurveTo(isoPX[m - 1], isoPY[m - 1], (isoPX[m - 1] + isoPX[0]) * 0.5, (isoPY[m - 1] + isoPY[0]) * 0.5);
    path.closePath();
  }
  return path;
}

function buildVeins() {
  var b, i, x, y, bestLo = 0, bestHi = 0;
  for (b = 0; b < VEIN_BANDS.length; b++) vsegN[b] = 0;
  lsegN = 0;

  /* --- pass one: which cells are on a ridge, and which way it runs --- */
  smoothRidgeField();
  /* Step the presence envelope. Decay everything now; the cells this rebuild
     draws are bumped as their chains and masses are emitted below, so a cell
     the rebuild keeps recovers what the decay just took and a cell it dropped
     starts fading. dt <= 0 is a rebuild with no time behind it — the verdict
     screen's by-hand render, a restore — and holds the envelope still rather
     than decaying tissue on a dish that did not move. */
  var dtE = S.simT - envT;
  envT = S.simT;
  var envUp = dtE > 0 ? 1 - Math.exp(-dtE / ENV_UP_TAU) : 0;
  var envNow = S.simT;
  /* A HALTED dish drops its ghosts. The verdict's final rebuild, and any
     rebuild with no time behind it, folds with zero carry-over — so the
     finished picture is exactly the drawn geometry, which is what the
     snapshot captures and what a replay exit can therefore reproduce
     pixel-for-pixel. Mid-fade pixels that lived only in the accumulator
     vanish at the halt; they are at most 0.2 seconds and a third of an alpha
     from gone, and a verdict that cannot be put back is the worse artifact. */
  veilDn = (dtE > 0 && S.running) ? Math.exp(-dtE / ENV_DN_TAU) : 0;
  veinFresh = true;
  /* --- the body ---
     With the body drawn, the rebuild is this, then the ridge and chain
     passes below run on the body's own field and feed the vein graph
     rather than the line layer: the joins, masses and connecting paths
     are the line layer's, which is not drawn while the body is (see
     BODY), and the graph's snap replaces the joins. The front's whiskers
     are built either way. */
  if (PROF) pvT = performance.now();
  if (BODY) {
    for (y = 0; y < (BODY_FILL ? GH - 1 : 0); y++) {
      var rowB = y * GW;
      for (x = 0; x < GW - 1; x++) {
        i = rowB + x;
        var ba = bodyV[i], bb = bodyV[i + 1], bc = bodyV[i + GW + 1], bd = bodyV[i + GW];
        var bmin = ba, bmax = ba;
        if (bb < bmin) bmin = bb; else if (bb > bmax) bmax = bb;
        if (bc < bmin) bmin = bc; else if (bc > bmax) bmax = bc;
        if (bd < bmin) bmin = bd; else if (bd > bmax) bmax = bd;
        isoMin[i] = bmin; isoMax[i] = bmax;
      }
    }
    if (BODY_FILL) {
      for (b = 0; b < BODY_LEVELS.length; b++) bodyPath[b] = traceIso(bodyV, BODY_LEVELS[b], true);
      recPath = traceIso(recV, BODY_LEVELS[REC_LEVEL], false);
    } else {
      for (b = 0; b < BODY_LEVELS.length; b++) bodyPath[b] = null;
      recPath = null;
    }
    for (b = 0; b < VEIN_BANDS.length; b++) veinPath[b] = null;
    for (b = 0; b < TUBE_KEYS; b++) tubePaths[b] = null;
    lobePath = null; lobeMaskPath = null;
    veinIslands = 0;
  }
  /* The field the ridges are read from. Under the body it is the distance
     field of the body's tube-level mask — see bodyD — whose ridge is the
     medial axis of every tube; the mask is of the 1.5-second ease, so
     the axis is the tube's line rather than where the flow peaked this
     half-second. Zero under walls and on the rim, since the body is. The
     floors are in that field's units, cells, rather than trail. */
  if (PROF) pvMark(0);
  if (BODY) { bodyDist(); bodyOutlines(); }
  if (PROF) pvMark(1);
  var rf = BODY ? bodyD : shpV;
  var rMin = BODY ? VEIN_DT_MIN : RIDGE_MIN, rMinLo = rMin * RIDGE_HOLD;
  var rMax = BODY ? (VEIN_GRAPH ? VEIN_DT_MAX : TUBE_DT_MAX) : Infinity;
  /* How the four directions' curvatures are compared. On the trail a
     crest is a parabola, and the raw across-curvature already favours
     the direction that crosses it squarest. The distance field is a
     FOLD — linear in distance from the axis on both sides — and under a
     fold every direction that is not the tangent sees the same drop per
     cell of distance, so on an axis-aligned tube the two diagonals tie
     with the true across (each samples a row above and a row below), and
     the first of them in table order won the direction map. Divided by
     the sample spacing the score is the drop per cell of the direction's
     own step, which is greatest square across the fold and distinct on
     tubes at every angle: 2 against 1.41 for an axis-aligned tube, 2
     against 1.41 for a diagonal one. The floors still test the raw
     curvature. */
  var dsc1 = BODY ? 1 / 1.4142 : 1;
  var rageNow = S.simT;

  /* last rebuild's maps become this one's memory by swapping the pairs, which
     costs a pointer where copying 106,000 bytes costs 106,000 bytes */
  var rswap = rprev; rprev = rdir; rdir = rswap;
  rswap = rbandP; rbandP = rband; rband = rswap;
  rdir.fill(255);
  rband.fill(255);
  /* under the body, the sweep is the mask's box and not the plate: the
     field is zero outside it by construction */
  var swX0 = BODY ? bmX0 : 2, swY0 = BODY ? bmY0 : 2, swX1 = BODY ? bmX1 : GW - 3, swY1 = BODY ? bmY1 : GH - 3;
  for (y = swY0; y <= swY1; y++) {
    var row = y * GW;
    for (x = swX0; x <= swX1; x++) {
      i = row + x;
      var v = rf[i];
      /* Every floor here is two floors: the one a cell must clear to BECOME a
         crest, and the lower one it must fall through to stop being one. In
         between, last rebuild's answer stands.

         Tested lowest bar first, so the great majority of the plate — bare
         agar, nowhere near either floor — still leaves on one comparison and
         never reads the memory at all. */
      if (v < rMinLo || v > rMax) continue;
      /* Never on a wall. Agar that has just been poured over carries no
         tissue by definition — diffuseTrail zeroes the trail inside wallM
         every step — but the surface this pass reads is an AVERAGE, and an
         average remembers: for the fifteen steps it takes to forget, a wall
         that has just come down in EXP-17, 18 or 20 would wear the crests of
         the tube it landed on, held up all the while by the hysteresis above.
         Tested after the value, so only a cell that was going to be a
         candidate anyway pays for the read.

         Written as a flat rule rather than as a clear-on-event, because the
         rule is the true statement — the mold is not on the wall — and a
         clear would have to be hooked onto every path that can move one. */
      if (wallM[i]) continue;
      var pd = rprev[i], held = pd !== 255;
      if (!held && v < rMin) continue;
      var floorK = held ? RIDGE_K_LO : RIDGE_K;
      var floorR = (held ? RIDGE_REL_LO : RIDGE_REL) * v;
      var bestS = 0, bestD = -1, bestK = 0;
      for (var d = 0; d < 4; d++) {
        var o = RIDGE_DIR[d].o;
        var lo = rf[i - o], hi = rf[i + o];
        if (v < lo || v < hi) continue;         /* not a maximum across d */
        var kk = 2 * v - lo - hi;               /* curvature across d */
        if (kk <= floorK || kk <= floorR) continue;
        /* scored, not thresholded, so the tie-break can lean on last
           rebuild's direction without letting it lower the bar */
        var sc = d === pd ? kk * DIR_STICK : kk;
        if (d & 1) sc *= dsc1;          /* the diagonals, whose samples are root two apart */
        if (sc > bestS) { bestS = sc; bestD = d; bestK = kk; bestLo = lo; bestHi = hi; }
      }
      if (bestD < 0) continue;
      rdir[i] = bestD;
      /* the start of this cell's run as a crest: now, unless it was one
         last rebuild too — the graph pins nothing that has not held */
      if (!held) rage[i] = rageNow;
      /* Where the crest really is. The four directions quantise a vein's
         position to the cell it happens to fall in, so a crest drifting half a
         cell holds still and then jumps a whole one — the third source of
         twitch, and the one that survives any amount of temporal averaging
         because it is a rounding, not a noise. Fitting a parabola through the
         three across-samples puts the maximum back where the field says it is,
         to a fraction of a cell, and the line then SLIDES as the body moves.
         Sample spacing is `sp` because the diagonal pair is root two apart;
         half a spacing is the most the vertex of a fit through a maximum can
         honestly be, and beyond that the fit is reading noise, not a crest. */
      var vx = (bestHi - bestLo) / (2 * bestK);
      if (vx > 0.5) vx = 0.5; else if (vx < -0.5) vx = -0.5;
      roff[i] = vx * RIDGE_DIR[bestD].sp;
    }
  }

  if (PROF) pvMark(2);
  /* --- pass 1b: where the masses are --- */
  /* The line layer's, and not built under the body: a junction is body,
     and the body is drawn. */
  var ldrawnN = 0;
  if (!BODY) {
  /* Every other cell in each direction, so a pad the size of a flake costs a
     few hundred discs rather than a few thousand; the discs are wider than
     the lattice they sit on, so the union is still solid.

     A mass is drawn only where there is tissue to draw it out of: a junction
     mark outlives by a few seconds the tubes that made it, and a flake
     nothing has reached yet is not a pad. The trail is the whole gate on a
     pad, and deliberately — whether the flake has been ENGULFED says nothing
     about whether the cytoplasm is still sitting on it. Gating on that was
     the first version, and it took the pads off the plate at exactly the
     wrong moments: the instant a flake went down, and, because every flake is
     down by then, across the whole verdict screen. Feeding stops at
     engulfment and the pad thins over the next couple of seconds; the drawing
     follows it down instead of switching it off. */
  /* The same two-floor test the ridge pass uses, and here it matters more per
     cell than it does there: a disc is nearly two cells across and opaque, so
     one at the rim of a pad switching off and on again is a blob blinking,
     where a crest cell dropping out only shortens a line. `lmark` is read and
     written in the same sweep, which is safe because the lattice visits each
     of its cells exactly once. */
  /* which cells have a ridge within SHEET_R: two separable passes of a
     running window over the ridge map, for the sheet test below */
  for (y = 0; y < GH; y++) {
    var rrow = y * GW, rc = 0;
    for (x = 0; x < SHEET_R && x < GW; x++) if (rdir[rrow + x] !== 255) rc++;
    for (x = 0; x < GW; x++) {
      if (x + SHEET_R < GW && rdir[rrow + x + SHEET_R] !== 255) rc++;
      if (x - SHEET_R - 1 >= 0 && rdir[rrow + x - SHEET_R - 1] !== 255) rc--;
      rnearH[rrow + x] = rc > 0 ? 1 : 0;
    }
  }
  for (x = 0; x < GW; x++) {
    var vc = 0;
    for (y = 0; y < SHEET_R && y < GH; y++) if (rnearH[y * GW + x]) vc++;
    for (y = 0; y < GH; y++) {
      if (y + SHEET_R < GH && rnearH[(y + SHEET_R) * GW + x]) vc++;
      if (y - SHEET_R - 1 >= 0 && rnearH[(y - SHEET_R - 1) * GW + x]) vc--;
      rnear[y * GW + x] = vc > 0 ? 1 : 0;
    }
  }

  for (y = 2; y < GH - 2; y += 2) {
    var rowL = y * GW;
    for (x = 2; x < GW - 2; x += 2) {
      i = rowL + x;
      var lv = shpV[i];
      if (wallM[i]) { lmark[i] = 0; continue; }   /* as in pass one */
      var hold = lmark[i] ? LOBE_HOLD : 1;
      /* The junction mark is read as the peak over the lattice cell's own
         two-by-two block, not at the cell alone. A mark is laid where an
         agent happened to test, and a fork centred on an odd/odd cell puts
         its 0.70 there and about 0.44 on the four even/even cells around
         it, which a bar of 0.50 read at the cell alone would miss: a lone
         fork would be a mass or not by which cell it landed on. */
      var kf = knotF[i], k2 = knotF[i + 1], k3 = knotF[i + GW], k4 = knotF[i + GW + 1];
      if (k2 > kf) kf = k2; if (k3 > kf) kf = k3; if (k4 > kf) kf = k4;
      var mass = lv >= BODY_T * hold &&
                 (kf > LOBE_MARK * hold ||
                  (lv > LOBE_PAD * hold && (feedAt[i] >= 0 || !rnear[i])));
      lmark[i] = mass ? 1 : 0;
      if (!mass) {
        /* A mass the test just dropped still has its presence, and unlike a
           vein cell it needs no chain to be drawn — the cell is the disc. So
           it keeps being emitted at its DECAYING presence, display-only
           (lenv and lseen untouched: it was not seen, it is being forgotten),
           and the disc shrinks and fades out through the tiers instead of
           vanishing at full size. This is the exit half of the scaling
           animation; the veil only ever carried the alpha half.

           Running dishes only, for the reason the veil's decay is zero on a
           halted one: the verdict's rebuild is the last there will be, and a
           mass mid-exit would freeze there as a translucent half-scaled disc
           instead of finishing. A finished dish shows what it is. */
        if (S.running && lseen[i] > -1e8) {
          var abG = envNow - lseen[i] - dtE;
          var pd = abG > 0.001 ? lenv[i] * Math.exp(-abG / ENV_DN_TAU) : lenv[i];
          if (pd > 0.12) {
            lbuck[lsegN] = envBucket(pd);
            lseg[lsegN * 2] = x + 0.5; lseg[lsegN * 2 + 1] = y + 0.5; lsegN++;
          }
        }
        continue;
      }
      var abL = envNow - lseen[i] - dtE;
      if (abL > 0.001) lenv[i] *= Math.exp(-abL / ENV_DN_TAU);
      lseen[i] = envNow;
      lenv[i] += (1 - lenv[i]) * envUp;
      lbuck[lsegN] = envBucket(lenv[i]);
      lseg[lsegN * 2] = x + 0.5; lseg[lsegN * 2 + 1] = y + 0.5; lsegN++;
    }
  }

  /* the mass mask, from pass one's emission, so the joins below can reach a
     mass; the bake reads the same mask */
  ltier.fill(-1);
  for (i = 0; i < lsegN; i++) {
    ltier[(((lseg[i * 2 + 1] - 0.5) | 0) >> 1) * LW + (((lseg[i * 2] - 0.5) | 0) >> 1)] = lbuck[i];
  }
  ldrawn.fill(0);
  for (i = 0; i < lsegN; i++) {
    var ln = (((lseg[i * 2 + 1] - 0.5) | 0) >> 1) * LW + (((lseg[i * 2] - 0.5) | 0) >> 1);
    var lx0 = ln % LW, ly0 = (ln / LW) | 0;
    if (!ldrawn[ln] && ((lx0 > 0 && ltier[ln - 1] >= 0) || (lx0 < LW - 1 && ltier[ln + 1] >= 0) ||
        (ly0 > 0 && ltier[ln - LW] >= 0) || (ly0 < LH - 1 && ltier[ln + LW] >= 0))) { ldrawn[ln] = 1; ldrawnN++; }
  }
  }   /* !BODY: the masses */

  /* --- pass two: walk each ridge from end to end into a polyline ---
     Emitting one short segment per ridge cell instead — which is the obvious
     way to do this and was the first way it was done — draws a dashed
     staircase: a vein running at an angle puts its cells two or three apart,
     the segments do not meet, and every stray cell that scraped past the
     curvature floor is drawn as a barb. Chaining fixes both at once. The
     chain is a real curve, so it can be stroked as one smooth path; and a
     chain that never reaches RIDGE_MINPTS is speckle by construction and is
     dropped, which is a far better filter for noise than any threshold on a
     single cell. */
  rvis.fill(0);
  if (!BODY) rchain.fill(0);   /* the joins' map; the graph has no joins */
  epN = 0; chainN = 0; jpN = 0;
  for (y = swY0; y <= swY1; y++) {
    var row2 = y * GW;
    for (x = swX0; x <= swX1; x++) {
      i = row2 + x;
      if (rdir[i] === 255 || rvis[i]) continue;

      /* Walk forward from the seed, then backward, then join.
         `sgn` carries which way along the tangent this walk is travelling, and
         is re-derived at every cell from the step actually taken rather than
         inherited. It has to be: the tangent of a bin is a LINE, and four bins
         span 180 degrees, so going once round the table turns the ray over.
         However the table is signed, at least one bend must therefore reverse
         it, and a walk that assumed a fixed sign there would turn round into
         the cells it had just claimed, stop dead, and leave a curved vein
         chopped into fragments — several of them below RIDGE_MINPTS and thrown
         away entirely. Deriving the sign from the movement makes the walk
         independent of the table's sign convention altogether. */
      /* The walk steps on CELLS and records POINTS, and after the sub-cell fit
         those are no longer the same thing: chi carries the cell the chain is
         standing on, chx/chy the crest position inside it. Stepping from the
         offset point instead would feed a fractional coordinate back into
         ridgeStep's rounding and let the fit nudge the walk onto a different
         neighbour — the offset is where the line is DRAWN, not where the vein
         is. */
      var n = 0, c = i, cd = rdir[i], sum = 0, sgn = 1;
      rvis[c] = 1;
      chi[n] = c;
      chx[n] = (c % GW) + 0.5 + roff[c] * RIDGE_DIR[cd].ax;
      chy[n] = ((c / GW) | 0) + 0.5 + roff[c] * RIDGE_DIR[cd].ay;
      sum += rf[c]; n++;
      var nx2 = c, pc = c;
      while (n < 2000) {
        pc = chi[n - 1];
        var px3 = pc % GW, py3 = (pc / GW) | 0;
        nx2 = ridgeStep(px3, py3, cd, sgn);
        if (nx2 < 0) break;
        rvis[nx2] = 1;
        var qx = nx2 % GW, qy = (nx2 / GW) | 0;
        cd = rdir[nx2];
        sgn = (RIDGE_DIR[cd].tx * (qx - px3) +
               RIDGE_DIR[cd].ty * (qy - py3)) >= 0 ? 1 : -1;
        chi[n] = nx2;
        chx[n] = qx + 0.5 + roff[nx2] * RIDGE_DIR[cd].ax;
        chy[n] = qy + 0.5 + roff[nx2] * RIDGE_DIR[cd].ay;
        sum += rf[nx2]; n++;
      }
      /* reverse in place so the backward walk can append */
      for (var a2 = 0, b2 = n - 1; a2 < b2; a2++, b2--) {
        var tx2 = chx[a2]; chx[a2] = chx[b2]; chx[b2] = tx2;
        var ty2 = chy[a2]; chy[a2] = chy[b2]; chy[b2] = ty2;
        var ti2 = chi[a2]; chi[a2] = chi[b2]; chi[b2] = ti2;
      }
      cd = rdir[i]; sgn = -1;
      while (n < 2000) {
        pc = chi[n - 1];
        var px4 = pc % GW, py4 = (pc / GW) | 0;
        nx2 = ridgeStep(px4, py4, cd, sgn);
        if (nx2 < 0) break;
        rvis[nx2] = 1;
        var rx = nx2 % GW, ry = (nx2 / GW) | 0;
        cd = rdir[nx2];
        sgn = (RIDGE_DIR[cd].tx * (rx - px4) +
               RIDGE_DIR[cd].ty * (ry - py4)) >= 0 ? 1 : -1;
        chi[n] = nx2;
        chx[n] = rx + 0.5 + roff[nx2] * RIDGE_DIR[cd].ax;
        chy[n] = ry + 0.5 + roff[nx2] * RIDGE_DIR[cd].ay;
        sum += rf[nx2]; n++;
      }
      if (n < RIDGE_MINPTS) continue;
      /* under the body the chain is a candidate for the graph and nothing
         else: no runs, no envelope, no ends for the joins to reach from */
      if (BODY) { if (VEIN_GRAPH && !VEIN_TREE) pinChain(n); if (TUBES) emitTube(n); continue; }

      var mean = sum / n;
      b = pickBand(mean, chi, n);
      var arr = vseg[b], w = vsegN[b];
      /* Emitted as runs of constant presence tier, the boundary point in both
         runs so the stroke stays continuous. Worst case every point changes
         tier and each costs 6 floats — the closing copy, a fresh header, and
         itself — so the cap is checked for that case, and a pathological
         chain drops whole rather than half-writes. */
      if (w + n * 6 + 2 > VEIN_CAP) continue;
      var rq = 0, rk = -1, rstart = 0;
      for (var bw = 0; bw < n; bw++) {
        var ci2 = chi[bw];
        rband[ci2] = b;
        /* absent time is the gap minus the one interval a held cell always
           has; a held cell pays zero decay and rises undamped */
        var ab2 = envNow - vseen[ci2] - dtE;
        if (ab2 > 0.001) venv[ci2] *= Math.exp(-ab2 / ENV_DN_TAU);
        vseen[ci2] = envNow;
        venv[ci2] += (1 - venv[ci2]) * envUp;
        var kk2 = envBucket(venv[ci2]);
        if (bw === 0) { rk = kk2; rstart = w; arr[w++] = kk2; arr[w++] = 0; }
        else if (kk2 !== rk) {
          /* close the run on this point, then open the next one on it too */
          arr[w++] = chx[bw]; arr[w++] = chy[bw];
          arr[rstart + 1] = bw - rq + 1;
          rq = bw; rk = kk2; rstart = w; arr[w++] = kk2; arr[w++] = 0;
        }
        arr[w++] = chx[bw]; arr[w++] = chy[bw];
      }
      arr[rstart + 1] = n - rq;
      vsegN[b] = w;
      /* for the joins: the cells this chain owns, and its two ends with the
         tangent pointing out of the chain, taken over two points so a single
         cell's wobble does not set it */
      chainN++;
      for (var bc = 0; bc < n; bc++) rchain[chi[bc]] = chainN;
      noteEnd(chx[0], chy[0], chx[0] - chx[2], chy[0] - chy[2], b, envBucket(venv[chi[0]]), chainN);
      noteEnd(chx[n - 1], chy[n - 1], chx[n - 1] - chx[n - 3], chy[n - 1] - chy[n - 3], b, envBucket(venv[chi[n - 1]]), chainN);
    }
  }

  /* --- the graph: widths, and the paths --- */
  if (BODY) {
    if (PROF) pvMark(3);
    if (VEIN_GRAPH && !VEIN_TREE) reachFreeEnds();
    veinWidths();
    if (PROF) { pvMark(4); profVeinN++; }
    buildWhiskers();
    return;
  }

  /* --- the joins: a chain end reaches for the chain it was walking toward --- */
  for (var je = 0; je < epN; je++) {
    var ex = epX[je], ey = epY[je], jdx = epDX[je], jdy = epDY[je];
    var own = epC[je], hit = -1, blocked = false, mass = -1;
    for (var js = 1; js <= JOIN_T && hit < 0 && mass < 0; js++) {
      var sx0 = ex + jdx * js, sy0 = ey + jdy * js;
      var tissue = false;
      for (var jside = 0; jside < 3 && hit < 0 && mass < 0; jside++) {
        var joff = jside === 0 ? 0 : (jside === 1 ? 1 : -1);
        var jix = Math.round(sx0 - jdy * joff), jiy = Math.round(sy0 + jdx * joff);
        if (jix < 1 || jiy < 1 || jix >= GW - 1 || jiy >= GH - 1) continue;
        var cj = jiy * GW + jix;
        /* a wall ends the reach: a chain on the far side of a closed door
           is not the chain this end was walking toward, and a join drawn
           across the door would show the gate as open */
        if (wallM[cj]) { blocked = true; break; }
        var rc = rchain[cj];
        if (rc && rc !== own) { hit = cj; break; }
        if (shpV[cj] >= BODY_T) {
          tissue = true;
          /* a drawn mass under this cell is the body, reached */
          if (ldrawn[(jiy >> 1) * LW + (jix >> 1)]) { mass = cj; break; }
        }
      }
      if (blocked) break;
      /* past the short reach, only tissue carries the end further */
      if (js >= JOIN_R && !tissue) break;
    }
    if (hit < 0 && mass < 0) {
      /* the climb */
      /* the endpoint's own cell: a crest point is its cell's centre plus a
         sub-cell offset, so the containing cell is the floor, not the
         nearest integer, which for a centred crest is the cell beyond */
      var cx0 = ex | 0, cy0 = ey | 0;
      if (cx0 < 1 || cy0 < 1 || cx0 >= GW - 1 || cy0 >= GH - 1) continue;
      var cc = cy0 * GW + cx0, cv = shpV[cc], nc = 0;
      if (wallM[cc]) continue;
      /* cells this climb has stood on, stamped per endpoint so nothing is
         cleared between them: with the level tolerance the cell just left
         is often the highest neighbour, and a walk allowed back onto it
         would rock between two cells until its steps ran out */
      /* the stamp lives in an Int32Array: wrapped well short of the sign
         bit, clearing the array with it, so a tab left running for years
         does not turn the visited test off */
      if (++jstamp > 2000000000) { jvis.fill(0); jstamp = 1; }
      jvis[cc] = jstamp;
      for (var st = 0; st < JOIN_CLIMB && hit < 0 && mass < 0; st++) {
        var best = -1, bv = cv * 0.90;   /* rising, or near enough level: a thread's root is a shallow climb */
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          var nx3 = (cc % GW) + ox, ny3 = ((cc / GW) | 0) + oy;
          if (nx3 < 1 || ny3 < 1 || nx3 >= GW - 1 || ny3 >= GH - 1) continue;
          var nn = ny3 * GW + nx3;
          if (wallM[nn] || rchain[nn] === own || jvis[nn] === jstamp) continue;
          var v3 = shpV[nn];
          if (v3 > bv) { bv = v3; best = nn; }
        }
        if (best < 0 || bv < JOIN_FLOOR) break;
        cc = best; cv = bv; jvis[cc] = jstamp;
        jcx[nc] = (cc % GW) + 0.5; jcy[nc] = ((cc / GW) | 0) + 0.5; nc++;
        if (rchain[cc]) hit = cc;
        else if (ldrawn[(((cc / GW) | 0) >> 1) * LW + ((cc % GW) >> 1)]) mass = cc;
      }
      if (hit < 0 && mass < 0) continue;
      var jb2 = epB[je], ja2 = vseg[jb2], jw2 = vsegN[jb2];
      if (jw2 + (nc + 1) * 2 + 2 > VEIN_CAP) continue;
      if (jpN < JP_CAP) { jpA[jpN] = own; jpB[jpN] = hit >= 0 ? rchain[hit] : chainN + 1 + (((mass / GW) | 0) >> 1) * LW + ((mass % GW) >> 1); jpN++; }
      ja2[jw2++] = epK[je]; ja2[jw2++] = nc + 1; ja2[jw2++] = ex; ja2[jw2++] = ey;
      for (var jq = 0; jq < nc; jq++) { ja2[jw2++] = jcx[jq]; ja2[jw2++] = jcy[jq]; }
      vsegN[jb2] = jw2;
      continue;
    }
    var jb = epB[je], ja = vseg[jb], jw = vsegN[jb];
    if (jw + 6 > VEIN_CAP) continue;
    var jx, jy;
    if (hit >= 0) {
      var jd = rdir[hit];
      jx = (hit % GW) + 0.5 + roff[hit] * RIDGE_DIR[jd].ax;
      jy = ((hit / GW) | 0) + 0.5 + roff[hit] * RIDGE_DIR[jd].ay;
    } else {
      /* to the mass cell's own lattice centre, which its outline covers */
      jx = (((mass % GW) >> 1) << 1) + 0.5; jy = ((((mass / GW) | 0) >> 1) << 1) + 0.5;
    }
    if (jpN < JP_CAP) { jpA[jpN] = own; jpB[jpN] = hit >= 0 ? rchain[hit] : chainN + 1 + (((mass / GW) | 0) >> 1) * LW + ((mass % GW) >> 1); jpN++; }
    ja[jw++] = epK[je]; ja[jw++] = 2; ja[jw++] = ex; ja[jw++] = ey; ja[jw++] = jx; ja[jw++] = jy;
    vsegN[jb] = jw;
  }

  /* --- one drawing: every drawn piece is joined to the main piece --- */
  veinIslands = 0;
  var NENT = chainN + 1 + LW * LH;
  /* run whenever anything is drawn: a rebuild can hold masses and no chain
     at all, and two such masses are two pieces like any other */
  if (NENT <= OUF_CAP && (chainN > 0 || ldrawnN > 0)) {
    var e1, e2, lx1, ly1, ln1;
    for (i = 0; i < NENT; i++) { ouf[i] = i; esz[i] = 0; }
    /* sizes: a chain's cells, four per drawn lattice cell */
    for (ln1 = 0; ln1 < LW * LH; ln1++) if (ldrawn[ln1]) esz[chainN + 1 + ln1] = 4;
    for (i = 0; i < NCELL; i++) if (rchain[i]) esz[rchain[i]]++;
    /* what touches: lattice cell to lattice cell, chain to the lattice cell
       under it, chain to chain across any of the eight neighbours */
    for (ly1 = 0; ly1 < LH; ly1++) {
      for (lx1 = 0; lx1 < LW; lx1++) {
        ln1 = ly1 * LW + lx1;
        if (!ldrawn[ln1]) continue;
        e1 = chainN + 1 + ln1;
        if (lx1 + 1 < LW && ldrawn[ln1 + 1]) uunion(e1, e1 + 1);
        if (ly1 + 1 < LH && ldrawn[ln1 + LW]) uunion(e1, e1 + LW);
      }
    }
    for (y = 1; y < GH - 1; y++) {
      for (x = 1; x < GW - 1; x++) {
        i = y * GW + x;
        e1 = rchain[i];
        if (!e1) continue;
        ln1 = (y >> 1) * LW + (x >> 1);
        if (ldrawn[ln1]) uunion(e1, chainN + 1 + ln1);
        e2 = rchain[i + 1]; if (e2 && e2 !== e1) uunion(e1, e2);
        e2 = rchain[i + GW]; if (e2 && e2 !== e1) uunion(e1, e2);
        e2 = rchain[i + GW + 1]; if (e2 && e2 !== e1) uunion(e1, e2);
        e2 = rchain[i + GW - 1]; if (e2 && e2 !== e1) uunion(e1, e2);
      }
    }
    for (i = 0; i < jpN; i++) uunion(jpA[i], jpB[i]);
    /* the main piece is the largest */
    var mainE = -1, mainSz = 0;
    for (i = 1; i < NENT; i++) if (ouf[i] === i && esz[i] > mainSz) { mainSz = esz[i]; mainE = i; }
    if (mainE >= 0) {
      /* The search runs FROM the detached pieces, not from the main one.
         Every cell of every piece is a seed, labelled with its piece; the
         main piece's cells are seeds that never expand. Fronts grow out
         through body in weighted order, and the first time a front meets
         a cell another piece has claimed — a drawn cell, or tissue its
         front reached first — the two are joined: the path is this cell's
         chain of parents back to its seed, then the met cell's back to
         its own, and the pieces are united. What it met may itself be
         detached: the two go on as one cluster, every cell of it still
         expanding, until the cluster meets the main piece, or, if it
         never does, is counted as an island at the end. A piece does NOT
         stop at its first contact: its later cells, settled but never
         expanded, walled the rest of the cluster in, and a cluster whose
         only open front lay behind that wall never reached the main piece
         though tissue joined them. Only cells of the main cluster stop. The
         work is the tissue AROUND the detached pieces, not the whole
         body: searching outward from the main piece had to cover the
         body to reach a piece at the far edge, every rebuild. */
      opar.fill(-1);
      oset.fill(0);
      hn = 0;
      var seeds = 0;
      for (i = 0; i < NCELL; i++) {
        var tE = rchain[i];
        if (!tE) {
          var tln = (((i / GW) | 0) >> 1) * LW + ((i % GW) >> 1);
          if (ldrawn[tln]) tE = chainN + 1 + tln;
        }
        if (!tE) continue;
        var tR = ufind(tE);
        opar[i] = i; odist[i] = 0; olab[i] = tR;
        if (tR !== mainE) { heapPush(0, i); seeds++; }
        else oset[i] = 1;   /* the main piece never expands; its cells are settled from the start */
      }
      while (hn > 0 && seeds > 0) {
        var qk = hk[0], qc = heapPop();
        if (qk > odist[qc] || oset[qc]) continue;   /* a stale entry, or settled already */
        oset[qc] = 1;
        var qO = olab[qc];
        var qL = ufind(qO);
        if (qL === ufind(mainE)) continue;
        var qx = qc % GW, qy = (qc / GW) | 0, met = -1;
        for (var oy1 = -1; oy1 <= 1 && met < 0; oy1++) {
          var ny1 = qy + oy1;
          if (ny1 < 1 || ny1 >= GH - 1) continue;
          for (var ox1 = -1; ox1 <= 1; ox1++) {
            if (!ox1 && !oy1) continue;
            var nx1 = qx + ox1;
            if (nx1 < 1 || nx1 >= GW - 1) continue;
            var nq = ny1 * GW + nx1;
            if (wallM[nq]) continue;
            /* contact is with a SETTLED cell of another piece: its distance
               and label are final. A tentative cell is relaxed instead,
               whoever found it first, since the first discovery is not the
               cheapest when a diagonal costs more than a side */
            if (oset[nq]) {
              if (ufind(olab[nq]) !== qL) { met = nq; break; }
              continue;
            }
            var tq = trail[nq];
            if (tq < CONN_T) continue;
            var wq = tq >= PATH_T ? 1 : 1 + PATH_K * (1 - tq / PATH_T);
            var nd = qk + (ox1 && oy1 ? 1.4142135 : 1) * wq;
            if (opar[nq] >= 0 && nd >= odist[nq]) continue;
            opar[nq] = qc; odist[nq] = nd; olab[nq] = qO; heapPush(nd, nq);
          }
        }
        if (met < 0) continue;
        /* contact: the path is this cell's parents back to its seed, then
           the met cell's back to its own */
        var pn = 0, pcur = qc;
        while (pn < 2048 && opar[pcur] !== pcur) { opath[pn++] = pcur; pcur = opar[pcur]; }
        opath[pn++] = pcur;
        /* reverse, so the run starts at this piece's seed */
        for (var pa1 = 0, pb1 = pn - 1; pa1 < pb1; pa1++, pb1--) { var pt = opath[pa1]; opath[pa1] = opath[pb1]; opath[pb1] = pt; }
        pcur = met;
        while (pn < 4094 && opar[pcur] !== pcur) { opath[pn++] = pcur; pcur = opar[pcur]; }
        opath[pn++] = pcur;
        var qR = ufind(olab[met]);
        uunion(qL, qR);
        var pb = rchain[opath[0]] ? rband[opath[0]] : 0;
        if (pb > 4) pb = 0;
        var pa = vseg[pb], pw = vsegN[pb];
        if (pn >= 2 && pw + pn * 2 + 2 <= VEIN_CAP) {
          /* drawn at the mid tier: live, but not inked — the path is the
             one through tissue THIS rebuild, and it wanders as the tissue
             does, so recording it hatched the record with every rebuild's
             route */
          pa[pw++] = 1; pa[pw++] = pn;
          for (var pk = 0; pk < pn; pk++) { pa[pw++] = (opath[pk] % GW) + 0.5; pa[pw++] = ((opath[pk] / GW) | 0) + 0.5; }
          vsegN[pb] = pw;
        }
      }
      /* the count of pieces that never met the main one */
      var mainR = ufind(mainE);
      for (e1 = 1; e1 < NENT; e1++) {
        if (ouf[e1] === e1 && esz[e1] > 0 && e1 !== mainR) veinIslands++;
      }
    }
  }

  /* Bake each band into Path2Ds, in grid coordinates — one per presence tier,
     so the whole layer is still a handful of draw calls. Held rather than
     re-issued, so a frame that changed nothing re-strokes the same geometry
     without walking 109,200 cells or replaying the moveTo/lineTo calls. The
     canvas transform does the scaling, so these survive a resize too. */
  for (b = 0; b < VEIN_BANDS.length; b++) {
    var end = vsegN[b];
    if (!end) { veinPath[b] = null; continue; }
    var a3 = vseg[b], tier = [null, null, null], r = 0;
    while (r < end) {
      var tk = a3[r++] | 0;
      var cnt = a3[r++] | 0;
      var pth = tier[tk] || (tier[tk] = new Path2D());
      pth.moveTo(a3[r], a3[r + 1]);
      if (cnt === 2) {
        pth.lineTo(a3[r + 2], a3[r + 3]);
      } else {
        /* quadratics through the midpoints: the control points are the cell
           centres, so the curve passes between them and the 45-degree
           quantisation of the walk stops being visible as a staircase */
        for (var q2 = 1; q2 < cnt - 1; q2++) {
          var px2 = a3[r + q2 * 2], py2 = a3[r + q2 * 2 + 1];
          var nx3 = a3[r + q2 * 2 + 2], ny3 = a3[r + q2 * 2 + 3];
          pth.quadraticCurveTo(px2, py2, (px2 + nx3) * 0.5, (py2 + ny3) * 0.5);
        }
        pth.lineTo(a3[r + (cnt - 1) * 2], a3[r + (cnt - 1) * 2 + 1]);
      }
      r += cnt * 2;
    }
    veinPath[b] = tier;
  }

  /* --- the masses: the outline of the marked cells, per presence tier ---
     Three nested outlines, of the cells at tier 0 and above, 1 and above,
     and 2: each is filled over the last at its own alpha (with the punch
     that keeps the alphas from stacking), so a cell shows its own tier and
     the edge between tiers is a step inside one shape rather than a seam
     between two. The mask path for the veil's punch is the widest outline a
     quarter-cell wider still, as the discs' was. */
  if (lsegN) {
    var lps = [traceMass(0, LOBE_OUT), traceMass(1, LOBE_OUT), traceMass(2, LOBE_OUT)];
    lobePath = lps[0] ? lps : null;
    lobeMaskPath = lps[0] ? traceMass(0, LOBE_OUT + 0.25) : null;
  } else {
    lobePath = null;
    lobeMaskPath = null;
  }

  buildWhiskers();
}

/* --- the front: one whisker per tip --- */
function buildWhiskers() {
  var wp = new Path2D(), any = false;
  for (var k = 0; k < nAgents; k++) {
    if (!atip[k]) continue;
    var ax0 = ax[k], ay0 = ay[k], h = ah[k];
    /* A tip standing inside a piece that is drawn as its outline — the
       drop, before it has a vein — has no front to show: its whisker was
       a speck on the outline, and the drop began as a ring of specks. A
       tip that has left the outline, or stands in a piece with veins, is
       the front. */
    if (BODY && VEIN_GRAPH && !VEIN_TREE) {
      var wl = compL[((ay0 | 0) >> 1) * LW + ((ax0 | 0) >> 1)];
      if (wl > 0 && !compVein[wl]) continue;
    }
    wp.moveTo(ax0 - Math.cos(h) * TIP_WHISK, ay0 - Math.sin(h) * TIP_WHISK);
    wp.lineTo(ax0, ay0);
    any = true;
  }
  whiskPath = any ? wp : null;
}

function strokeVeins(tc, sx, sy, mono) {
  var ctx = tc;   /* shadow the module-level ctx: everything below targets tc */
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  /* The masses first, so the crests of the veins running into one land on
     top of it rather than under it. One fill, no offset copy: what makes a
     lobe read as raised is the field's inner shadow, which has already
     shaded it as part of the shape. */
  /* mono strokes everything opaque white: the same geometry as a MASK, for
     the veil composite's punch — where this rebuild drew ANYTHING, at any
     tier, the accumulator's old ink is removed outright before the fresh ink
     lands. Widths padded by half a cell so the punch swallows the old
     stroke's antialiased skirt too. Tier interactions do not matter in a
     mask, so the mono pass stays a single flat sweep. */
  var k, b;
  if (mono) {
    ctx.fillStyle = '#fff';
    /* The graph is not in the mask. The punch exists to clear the
       accumulator where the fresh drawing has MOVED from the old, and a
       vein never moves: under every stroke this rebuild lays is the same
       stroke, decayed by one interval, and an opaque line over its own
       ghost is the line. What does change — a band narrowing, a live
       vein becoming a record — leaves the old width fading under the
       new for a fifth of a second, which is a tube thinning, and the
       only thing the punch would buy is that stroke pass twice over.
       The records, which are translucent and would accumulate, are not
       in the veil at all: they are the ink's. */
    /* the tubes are not punched: they are opaque, each rebuild's cover
       the last's almost everywhere, and where a tube has thinned the old
       width fades under the new over the accumulator's fifth of a
       second, which is a tube thinning. The punch was a second stroke of
       every path, and it doubled the composite. */
    if (BODY) {
      if (BODY_FILL) for (k = 0; k < BODY_LEVELS.length; k++) if (bodyPath[k]) ctx.fill(bodyPath[k], 'evenodd');
      /* the outline moves with the tissue, so it lives in the veil and
         is punched like any moving stroke */
      if (outlinePath) { ctx.lineWidth = VEIN_BANDS[2].w + 0.5; ctx.strokeStyle = '#fff'; ctx.stroke(outlinePath); }
    }
    else if (lobeMaskPath) ctx.fill(lobeMaskPath);
    for (b = VEIN_BANDS.length - 1; b >= 0; b--) {
      if (!veinPath[b]) continue;
      ctx.lineWidth = VEIN_BANDS[b].w + 0.5;
      ctx.strokeStyle = '#fff';
      for (k = 0; k < 3; k++) if (veinPath[b][k]) ctx.stroke(veinPath[b][k]);
    }
    ctx.restore();
    return;
  }

  /* The colored pass. A chain that crosses a tier boundary carries the
     boundary point in both runs, and two source-over strokes on the shared
     cap STACK — 0.68 over 0.35 lands at 0.79, a bright knot at every fade
     boundary, and overlapping lobe discs of different tiers do the same.

     Only the faint-over-faint pair can actually knot: anything landing on
     the settled tier saturates near the settled alpha (0.35 over 0.90 is
     0.935), a colour lean the eye cannot pick out. So tier 1 alone carries a
     punch — one destination-out stroke of its own footprint before its ink,
     which clears the tier-0 cap it would have stacked on. The punch cuts
     whatever else lies under a transitional run too, another band's ink
     included; that ink is redrawn where the run is, the runs live ~0.2s, and
     the alternative — routing every mid-fade band through a scratch canvas —
     measured a fifth of the frame budget on a throttled phone, which is the
     wrong price for a one-cap artifact. Unpadded on purpose: padding would
     erase a ring wider than the redraw and notch the line at each boundary. */
  var punchThen = function (path, isFill, style, a) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    if (isFill) { ctx.fillStyle = '#fff'; ctx.fill(path); }
    else { ctx.strokeStyle = '#fff'; ctx.stroke(path); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    if (isFill) { ctx.fillStyle = style; ctx.fill(path); }
    else { ctx.strokeStyle = style; ctx.stroke(path); }
    ctx.globalAlpha = 1;
  };
  /* the body first, outer level to inner, each covering the last; the
     lines land on it as the crests of its tubes */
  if (BODY) {
    for (k = 0; k < (BODY_FILL ? BODY_LEVELS.length : 0); k++) {
      if (!bodyPath[k]) continue;
      ctx.fillStyle = BODY_STYLE[k];
      ctx.fill(bodyPath[k], 'evenodd');
    }
    /* the graph over the body, as its canvas — see paintVeinGraph. Not
       clipped to the body: a vein is where it was pinned, and the tube
       swelling and thinning under it is the picture. The records are
       under all of this, in the ink. */
    /* the tubes, widest first so a narrow one landing on a trunk keeps
       its own edge */
    for (k = TUBES ? TUBE_KEYS - 1 : -1; k >= 0; k--) {
      if (!tubePaths[k]) continue;
      ctx.lineWidth = k / VEIN_TUBE_Q;
      ctx.strokeStyle = TUBE_STYLE[k];
      ctx.stroke(tubePaths[k]);
    }
    if (outlinePath) {
      ctx.lineWidth = VEIN_BANDS[2].w;
      ctx.strokeStyle = VEIN_BANDS[2].style;
      ctx.stroke(outlinePath);
    }
    /* the graph is NOT in the veil: it never moves, so it needs no fade,
       and a canvas laid source-over into the accumulator every rebuild
       with no punch crept toward opaque — the two translucent bands and
       every antialiased edge a little more solid each time. It is
       composited straight onto the frame, after the veil; see the
       composite. */
    if (VEIN_TREE) paintTree(); else if (VEIN_GRAPH) paintVeinGraph();
  }
  if (lobePath && !BODY) {
    ctx.fillStyle = LOBE_STYLE;
    if (lobePath[0]) { ctx.globalAlpha = BUCK_A[0]; ctx.fill(lobePath[0]); ctx.globalAlpha = 1; }
    if (lobePath[1]) punchThen(lobePath[1], true, LOBE_STYLE, BUCK_A[1]);
    if (lobePath[2]) ctx.fill(lobePath[2]);
  }
  /* widest first, so the hairlines land on top of the trunks they join */
  for (b = VEIN_BANDS.length - 1; b >= 0; b--) {
    if (!veinPath[b]) continue;
    ctx.lineWidth = VEIN_BANDS[b].w;
    ctx.strokeStyle = VEIN_BANDS[b].style;
    if (veinPath[b][0]) { ctx.globalAlpha = BUCK_A[0]; ctx.stroke(veinPath[b][0]); ctx.globalAlpha = 1; }
    if (veinPath[b][1]) punchThen(veinPath[b][1], false, VEIN_BANDS[b].style, BUCK_A[1]);
    if (veinPath[b][2]) ctx.stroke(veinPath[b][2]);
  }
  ctx.restore();
}

/* The whiskers are the moving front and are drawn straight onto the frame,
   OUTSIDE the veil: a tip can turn 0.79 radians in a step, which swings the
   far end of a 2.6-cell whisker well clear of its own mask footprint, and
   through the accumulator every turn left a translucent fan of the whisker's
   old headings decaying behind it. The front updates immediately or it is
   not the front. */
function strokeWhiskers(tc, sx, sy) {
  if (!whiskPath) return;
  tc.save();
  tc.setTransform(sx, 0, 0, sy, 0, 0);
  tc.lineCap = 'round';
  tc.lineWidth = TIP_W;
  tc.strokeStyle = TIP_STYLE;
  tc.stroke(whiskPath);
  tc.restore();
}

/* ---------- the instrument marks, and the casing they need ----------

   The objective rings, the progress arc and the cue ring are the only ink the
   game draws ON the specimen, and they are the ink with the hardest ground.
   The console solved its version of this by leaving the plate (see .console in
   index.html); these cannot follow it, because a mark that says WHERE is not a
   mark you can move.

   The ground under them is not two colours, it is a ramp: the same pixel is
   the stage at a relative luminance of 0.002 when the dish is empty and a lit
   crest at 0.689 when the mold is standing on it, and it passes through every
   value between the two as the specimen arrives. No single colour clears
   1.4.11's 3:1 against a range that wide, and this is arithmetic rather than
   taste. A mark at luminance m clears the floor only against grounds at or
   below (m + .05) / 3 - .05, or at or above 3(m + .05) - .05; between those
   two it fails, and the band is always non-empty. Wherever a mark is put, the
   ramp sweeps through the band it cannot cover.

   The old marks were all solved against bare agar and nothing else, so they
   read at 8:1 and up on an empty dish and collapsed the moment the organism
   arrived under them — which is exactly when a progress arc is worth reading.
   Yellow arc on yellow slime, measured: 1.00.

   Two marks cover what one cannot. Each is drawn as an opaque casing in the
   stage's own ground with the mark itself inside it, and the pair covers the
   ramp from both ends: over bare agar the mark carries it at 10:1 and up while
   the casing disappears into the plate it is made of, and over lit tissue the
   mark disappears and the casing carries it. What has to be checked is the
   MIDDLE — a thin film of slime, too light for the casing and too dark for the
   mark — because that is where the two coverages meet and where a gap would
   be. They overlap instead. The worst pair anywhere on the ramp, both hazard
   washes included, is 3.35:1 at about 40% coverage; the tightest mark is the
   cytoplasm green, and the arc that started this is 3.43.

   Two things follow from that and are not decoration:

   - The marks are OPAQUE. The old alphas (.30 to .92) were a hierarchy painted
     in transparency, and transparency over a variable ground is a colour you
     cannot solve. Weight and tone carry the hierarchy now; the pulses that
     used to breathe in alpha breathe in width instead, so the quiet end of a
     pulse is still a mark and not a rumour.
   - The casing is measured in DEVICE pixels, not in grid units. It is an
     outline — a rendering device that says "this edge is a mark, not tissue" —
     and an outline is a constant on the screen, not a quantity in the dish. As
     a grid width it multiplied by the plate's scale, which is 0.76 on the
     smallest canvas and 5.6 on a laptop's: 1.2 device pixels of casing at one
     end and 9 at the other, which turned a 6.7px ring into a 15.7px slab and
     made every objective look like a bullseye. Held at 2.4px it is the same
     hairline everywhere, always visible and never a border.

     What the ratios need is that the casing EXIST beside the mark, not that it
     have any particular width — 1.4.11 sets no minimum size — so pinning it to
     the screen costs the contrast argument nothing. */
var MARK_CASE    = 'rgba(7,9,6,1)';  // the stage's ground, opaque
var MARK_CASE_PX = 2.4;              // casing width, total, DEVICE pixels
/* ...but never wider than this in grid units. The cap binds only below about
   an sx of 1.5 — a 320px canvas, the floor resizeCanvas clamps to — and it is
   the width the casing had when it was a grid quantity, so the tightest plate
   keeps exactly the geometry that was checked for it and every larger one
   gets the hairline instead. */
var MARK_CASE_MAX = 1.6;
/* Set once per frame from the plate's scale, and read by the cased helpers
   below — they draw inside the grid transform, so a screen width has to be
   divided back out of it. */
var markCase = MARK_CASE_PX;

/* The retract cue cannot be the pink the panel uses for a spent reserve:
   #df6f8b is dark enough that the casing construction above never lifts it to
   3:1 anywhere on the ramp — it peaks at 2.6. This is that hue at the
   lightness where it does hold (3.39:1 at the crossover), which is a paler
   rose than the panel's and reads as the same warning. */
var MARK_RETRACT = '#eeb4c2';
/* The objective's own colour, and it is one colour: the ring and the core disc
   are orange whether the objective is met or not, and the met state is told by
   the dial below rather than by a change of hue here.

   Orange is the tightest mark on this plate to place, because it is the
   slime's own neighbourhood, and the tone has to be picked to stand APART from
   the specimen rather than merely to clear a number. The sheet's --warn
   (#e0763c) cannot be used at all: it is dark enough that the casing never
   lifts it past 2.56 anywhere on the ramp. Above that floor everything is a
   trade — the marks want luminance, orange wants chroma, and past a point
   buying one spends the other.

   This is the most chromatic orange between hue 23° and 29° that holds a 3.10
   floor. Chroma 191 is the specimen's own 189, so the ring is as saturated as
   the thing it is drawn on, and 16° of hue separation is what makes it read as
   orange against gold. The first attempt held 3.38 instead and came out at
   chroma 140: a peach, which cleared the arithmetic and lost the argument. A
   mark that passes a contrast check by going pale has blended into the
   specimen in every way except the one that was measured.

   Ring and dial are near-identical in luminance (1.04 between them), and no
   orange avoids that: both are light marks, and 3:1 between two light marks
   would need one of them dark enough to fail the ground. They are told apart
   by radius and by the casing gap between them — which is the same thing that
   tells them apart over tissue, where neither colour survives at all, so the
   reading does not change with the ground or with the reader's colour
   vision. */
var MARK_OBJ = '#ff9c40';
/* The dial as it fills.

   It used to be painted in ACC_ARC, the specimen's own tint: a progress ring
   the exact colour of the thing whose progress it reports, drawn on top of
   that thing. Casing it made it legible and moving it to its own radius made
   it unambiguous, and it was still yellow on yellow, which is what the
   complaint was about in the first place. Neither of those changes was the fix
   for it; they were the two things that had to be true before a colour change
   could be more than a repaint.

   Bone is the plate's neutral. It is near-achromatic, so it takes nothing from
   the orange beside it and cannot be mistaken for tissue at any occupancy, and
   it is the most comfortable mark on the plate at a 3.63 floor. ACC_ARC is
   gone with it. The tint is still the CUE ring, which is the one mark that is
   MEANT to be the specimen's colour: that ring is your own reach. */
var MARK_DIAL = '#ced4b4';
/* Cytoplasm, for the two marks that mean cytoplasm: the dial once it closes,
   and the stranger's ring, which is a ring of the stuff that is not yours yet.
   The dial fills in bone and turns green at the moment it completes, which is
   the one hue change left on an objective and is what says "met" — that, the
   complete circle itself, and a ring drawn heavier. */
var MARK_CYTO = '#7fd1b9';

/* The dial's radius, as a fraction of the objective's own.

   The casing above makes each mark VISIBLE on any ground. It does not make two
   marks TELL APART on any ground, and those are different problems. Over lit
   tissue every core vanishes and what survives of a mark is its casing, so two
   marks that differ only in the colour inside the casing are, there, the same
   mark. The progress arc used to be drawn on the objective ring itself and
   differ from it by hue: yellow swept, bone unswept, same circle. Over agar
   that is legible at a glance; over tissue it is two dark bands at one radius
   differing by 36% of their width, which is not a reading, and the thing being
   read — how far round the arc has gone — is the whole point of drawing it.

   So the dial moves off the ring and onto a circle of its own, inside it. Now
   the ring says WHERE the objective is and is always a complete circle, and
   the dial says HOW FAR and is a separate arc at a radius nothing else uses.
   Over tissue that reads as a full dark circle with a partial dark arc inside
   it, which is the same sentence the colours were saying and is one no ground
   can take away. Colour still carries it on agar, where colour works.

   The same reasoning finishes the met state. A met objective used to drop its
   arc and go cyan, which over tissue left a ring 21% heavier than a pending
   one and nothing else. It draws a COMPLETE dial instead: the dial fills as
   the objective is met and stays filled, so pending-at-zero, part-met and met
   are three different pictures rather than two colours and an absence. A dish
   that reseals runs it backwards, which is what the number does too.

   0.66 sits the dial clear of both its neighbours — the core disc plus casing
   ends at 0.34r + markCase/2 and the ring's casing starts at
   r - (1.2 + markCase)/2. The gaps are narrowest where the casing is widest
   relative to the objective, which is the smallest plate: about a pixel each
   there, opening to nine and thirteen on a laptop's. The three bands read as
   three at every size the canvas will take, which is what MARK_CASE_MAX is
   for. */
var MARK_DIAL_R = 0.66;

function casedArc(c, x, y, r, a0, a1, w, style) {
  c.beginPath();
  c.arc(x, y, r, a0, a1);
  c.lineWidth = w + markCase;
  c.strokeStyle = MARK_CASE;
  c.stroke();
  c.lineWidth = w;
  c.strokeStyle = style;
  c.stroke();
}

function casedRing(c, x, y, r, w, style) {
  casedArc(c, x, y, r, 0, Math.PI * 2, w, style);
}

/* A filled mark gets the same casing as a ring: the disc is laid once at the
   casing's radius and once at its own, so the dark edge is outside the mark
   rather than eating into it. */
function casedDisc(c, x, y, r, style) {
  c.beginPath();
  c.arc(x, y, r + markCase / 2, 0, Math.PI * 2);
  c.fillStyle = MARK_CASE;
  c.fill();
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = style;
  c.fill();
}

/* mode 1 = cue, 2 = retract. On touch a one-finger drag is a cue and a second
   finger makes it a retract for the duration of that gesture; there is no
   stored verb any more, because the on-screen switch that set one is gone. */
var ptr = { down: false, mode: 0, gx: 0, gy: 0 };
var downIds = [];      /* pointerIds currently on the stage */
var primaryId = null;  /* the one the brush follows */

/* The ground as shapes: agar, then each hazard as the rectangle the dish
   declared, in the colours the field painter mixed per cell — the same
   picture at any size, with no cell to see. Drawn in grid space under the
   plate's transform, at the masks' own rounding, so a wall (paintWalls, laid
   after the record) sits exactly where the agents find it. */
function paintGround(tc, sx, sy) {
  tc.save();
  tc.setTransform(sx, 0, 0, sy, 0, 0);
  tc.fillStyle = 'rgb(' + AGAR[0] + ',' + AGAR[1] + ',' + AGAR[2] + ')';
  tc.fillRect(0, 0, GW, GH);
  var i, k;
  for (i = 0; i < S.hazards.length; i++) {
    var hz = S.hazards[i];
    k = hz.type === 'q' ? 2 : (hz.type === 'l' ? 3 : 1);
    var hl = HAZ_ADD[k];
    tc.fillStyle = 'rgb(' + (AGAR[0] + hl[0]) + ',' + (AGAR[1] + hl[1]) + ',' + (AGAR[2] + hl[2]) + ')';
    tc.fillRect(Math.round(hz.x), Math.round(hz.y), Math.round(hz.x + hz.w) - Math.round(hz.x), Math.round(hz.y + hz.h) - Math.round(hz.y));
  }
  tc.restore();
}

/* The walls, painted last of the ground so they cover the record too */
function paintWalls(tc, sx, sy) {
  if (!S.walls.length) return;
  tc.save();
  tc.setTransform(sx, 0, 0, sy, 0, 0);
  tc.fillStyle = 'rgb(46,50,40)';
  for (var i = 0; i < S.walls.length; i++) {
    var w = S.walls[i];
    tc.fillRect(Math.round(w[0]), Math.round(w[1]), Math.round(w[0] + w[2]) - Math.round(w[0]), Math.round(w[1] + w[3]) - Math.round(w[1]));
  }
  tc.restore();
}

function render() {
  if (!cv || !S.exp) return;
  /* A run that has stopped is not going to get another frame from the loop —
     the result screen and exitReplay call render() once, by hand — so those
     rebuild immediately rather than waiting for a second frame that never
     arrives and leaving the verdict over a stale dish. */
  if (fieldDirty && (!S.running || ++dirtyFrames >= REBUILD_EVERY)) {
    var pb0 = PROF ? performance.now() : 0;
    if (SHEET) paintField();
    else {
      /* the two passes of the painter the vein trace reads: the ridge, and
         the eased field it is followed on. The bridge pass is skipped with
         the painter, since only the painter drew what it found. */
      buildRidge();
      smoothRidgeField();
      if (ovlLive) paintOverlay();
    }
    buildVeins();
    if (PROF) { profBuild += performance.now() - pb0; profBuilds++; }
    dirtyFrames = 0;
    fieldDirty = false;
  }

  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  if (SHEET) ctx.drawImage(off, 0, 0, cv.width, cv.height);
  else {
    paintGround(ctx, cv.width / GW, cv.height / GH);
    if (ovlAny) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(ovl, 0, 0, cv.width, cv.height);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* The sheet is the field; the veins are lines drawn over it — through the
     veil accumulator, so what leaves the picture fades instead of vanishing.
     The fold runs once per rebuild: clean frames between rebuilds re-composite
     the same accumulator, exactly as they re-stroked the same paths before. */
  var sx = cv.width / GW, sy = cv.height / GH;
  /* the casing is a screen width, so divide the plate's scale back out of it —
     capped, because on the smallest canvas the plate can size to, 2.4 device
     pixels is 3.2 grid units, which is wider than the gaps between an
     objective's three bands and would close them into one blob */
  markCase = Math.min(MARK_CASE_PX / sx, MARK_CASE_MAX);
  if (veinFresh) {
    /* Fresh wins wherever fresh drew; the decayed old survives only where it
       did not. Stated that way rather than as a per-pixel max because canvas
       has no max that includes alpha — 'lighten' blends colour but composes
       alpha source-over, so a semi-transparent stroke repeated across
       rebuilds ACCUMULATES opacity (a steady 0.35 stroke converges to 0.63),
       which quietly defeats the tiers. The punch makes the recurrence exact:
       decay the accumulator, remove it outright under this rebuild's opaque
       mask, then lay the fresh ink down. A re-arriving cell shows its own
       rising tier rather than the brighter ghost of its old self, which is
       the more truthful picture anyway — presence governs, not history. */
    vlctx.setTransform(1, 0, 0, 1, 0, 0);
    vlctx.clearRect(0, 0, veil.width, veil.height);
    strokeVeins(vlctx, sx, sy, false);
    if (BODY) recordBody(ictx, sx, sy); else inkFresh(ictx, sx, sy);
    vmctx.setTransform(1, 0, 0, 1, 0, 0);
    vmctx.clearRect(0, 0, veilMask.width, veilMask.height);
    strokeVeins(vmctx, sx, sy, true);
    vtctx.setTransform(1, 0, 0, 1, 0, 0);
    vtctx.clearRect(0, 0, veilTmp.width, veilTmp.height);
    if (veilDn > 0.004) {
      vtctx.globalAlpha = veilDn;
      vtctx.drawImage(veilAcc, 0, 0);
      vtctx.globalAlpha = 1;
      vtctx.globalCompositeOperation = 'destination-out';
      vtctx.drawImage(veilMask, 0, 0);
      vtctx.globalCompositeOperation = 'source-over';
    }
    vactx.setTransform(1, 0, 0, 1, 0, 0);
    vactx.clearRect(0, 0, veilAcc.width, veilAcc.height);
    vactx.drawImage(veilTmp, 0, 0);
    vactx.drawImage(veil, 0, 0);
    veinFresh = false;
  }
  ctx.globalAlpha = BODY && VEIN_GRAPH ? REC_A : INK_A;
  ctx.drawImage(ink, 0, 0);
  ctx.globalAlpha = 1;
  if (!SHEET) paintWalls(ctx, cv.width / GW, cv.height / GH);
  ctx.drawImage(veilAcc, 0, 0);
  /* the pinned graph, whole, over the veil: opaque where it is drawn and
     laid once per frame onto a frame that is cleared, so nothing
     accumulates */
  if (BODY && VEIN_GRAPH && vgc) ctx.drawImage(vgc, 0, 0);
  strokeWhiskers(ctx, sx, sy);
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);

  var e = S.exp;

  /* The hazard wash is the dish's own light, so it goes on the dish and not on
     the instruments: laid here, under the marks, rather than over the finished
     frame. Over them it was a 13% orange sitting on both the mark and the
     ground beneath it, and equal addition always compresses a ratio — it cost
     the crossover pair about a third of a point and took the tightest mark to
     3.00, which is a floor met by rounding. Under them, the marks composite
     onto the washed ground and the same pair holds 3.35. It still covers the
     whole plate, which is all the effect ever claimed. */
  if (S.shockActive) {
    ctx.fillStyle = 'rgba(214,148,72,.13)';
    ctx.fillRect(0, 0, GW, GH);
  } else if (S.shockWarn) {
    ctx.fillStyle = 'rgba(120,96,60,.06)';
    ctx.fillRect(0, 0, GW, GH);
  }

  /* The stranger. Drawn under the nodes so a flake sitting on it still reads,
     and pulsed off sim time rather than the wall clock so a time-lapse run and
     a real-time one show the same frame at the same step.

     The pulse is in the ring's WIDTH now. It used to be in its alpha, from .30
     to .64, and the quiet end of that was 2.0:1 on bare agar and 1.0 on
     tissue — a mark that spent half of every cycle being nothing. The interior
     wash still breathes in alpha because it is a wash and not the mark: the
     ring is the edge that has to be found. */
  if (e.donor) {
    var dn = e.donor;
    var puls = 0.5 + 0.5 * Math.sin(S.simT * 1.7);
    ctx.beginPath();
    ctx.arc(dn.x, dn.y, dn.r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(127,209,185,' + (0.05 + 0.05 * puls).toFixed(3) + ')';
    ctx.fill();
    casedRing(ctx, dn.x, dn.y, dn.r, 1.1 + 0.7 * puls, MARK_CYTO);
  }

  for (var i = 0; i < e.nodes.length; i++) {
    var nd = e.nodes[i];
    var done = S.nodeDone[i];
    var prog = done ? 1 : S.nodeProg[i];
    casedRing(ctx, nd.x, nd.y, nd.r, done ? 1.8 : 1.2, MARK_OBJ);

    if (prog >= 1) {
      casedRing(ctx, nd.x, nd.y, nd.r * MARK_DIAL_R, 2.2, MARK_CYTO);
    } else if (prog > 0.01) {
      casedArc(ctx, nd.x, nd.y, nd.r * MARK_DIAL_R, -Math.PI / 2,
               -Math.PI / 2 + Math.PI * 2 * prog, 2.2, MARK_DIAL);
    }

    /* the flake itself fades as it is eaten: under the puddle it is
       becoming, the dot is the food and the food is going */
    if (prog > 0.01) ctx.globalAlpha = 1 - prog;
    casedDisc(ctx, nd.x, nd.y, nd.r * 0.34, MARK_OBJ);
    ctx.globalAlpha = 1;
  }

  if (ptr.down) {
    casedRing(ctx, ptr.gx, ptr.gy, CUE_R, 1.3,
              ptr.mode === 2 ? MARK_RETRACT : ACC_CUE);
  }

  ctx.restore();
}

/* ------------------------------------------------------------
   10. player fields (brush)
   ------------------------------------------------------------ */
function paintBrush(gx, gy, mode) {
  fieldDirty = true;
  ovlLive = true;
  var R = CUE_R, R2 = R * R;
  var x0 = clamp(Math.round(gx - R), 0, GW - 1), x1 = clamp(Math.round(gx + R), 0, GW - 1);
  var y0 = clamp(Math.round(gy - R), 0, GH - 1), y1 = clamp(Math.round(gy + R), 0, GH - 1);
  for (var y = y0; y <= y1; y++) {
    var dy = y - gy, row = y * GW;
    for (var x = x0; x <= x1; x++) {
      var dx = x - gx;
      var d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      var i = row + x;
      if (wallM[i]) continue;
      var fall = 1 - Math.sqrt(d2) / R;
      /* Write the cone directly rather than accumulating toward a cap —
         accumulation saturates the middle flat and leaves a gradient only at
         the rim, which is the part the organism needs to feel. */
      var want = fall * BRUSH_PEAK;
      if (mode === 2) {
        if (retF[i] < want) retF[i] = want;
        trail[i] *= (1 - 0.16 * fall);
        stalkF[i] *= (1 - 0.16 * fall);   /* or the floor puts it straight back */
      } else {
        if (cueF[i] < want) cueF[i] = want;
      }
    }
  }
}

/* One step's worth of cue accounting, run once per sim step from the frame
   loop whether or not the brush is down — the release refill is as much a part
   of the reserve as the drain is. Returns whether the brush lands this step.

   It sits in the stepping loop rather than in an input handler for the reason
   everything else in the sim path does: the loop advances at a fixed DT, so
   the reserve is a function of (seed, recorded brush, steps executed) and a
   replay rebuilds the identical curve. Deciding it from pointer events instead
   would make it a function of the frame rate, and a recorded run would replay
   with a different reserve than the one it was played under.

   Note what is NOT here: the reserve does not refill while the brush is held.
   A run that holds through exhaustion stays exhausted until it lets go, which
   is the whole instruction, and hysteresis at zero is unnecessary because
   there is no boundary to chatter across. */
function cueTick(down, mode) {
  var cap = cueCapOf(S.exp);
  /* Held time is counted on every dish, including the one that runs no
     reserve. It is what the autonomy axis divides, and scoring it only where
     a reserve exists would hand EXP-01 a free hundred per cent on an axis
     measuring how much the player steered — on the dish that is nothing but
     steering. Counted for the ASK, not the grant: a run that keeps holding
     after the reserve is gone is still a run being steered at, and the axis
     is about the player's hand, not about what the dish let it do. */
  if (down) S.cueHeld += DT;
  if (!cap) return down;                       /* dish opted out of the limit */
  if (down) {
    if (S.cueRes <= 0) return false;
    S.cueRes -= DT * (mode === 2 ? CUE_RET : 1);
    if (S.cueRes < 0) S.cueRes = 0;
    return true;
  }
  S.cueRes = Math.min(cap, S.cueRes + DT * CUE_REGEN);
  return false;
}

/* A dish may set its own reserve — `cue: 0` opts out of the limit entirely,
   which EXP-01 does, because the dish that teaches you what a cue IS must not
   also be the dish that takes them away. */
function cueCapOf(e) {
  return (e && e.cue != null) ? e.cue : CUE_CAP;
}

function cueFrac() {
  var cap = cueCapOf(S.exp);
  return cap ? clamp(S.cueRes / cap, 0, 1) : 1;
}

/* ------------------------------------------------------------
   11. narration
   ------------------------------------------------------------ */
function logLine(text, hi) {
  var box = $('log');
  if (!box) return;
  var d = document.createElement('div');
  if (hi) d.className = 'hi';
  d.textContent = text;
  box.insertBefore(d, box.firstChild);
  /* The cap is the SCROLLBACK, not the visible depth — the well shows the
     newest eight or so and scrolls for the rest. It was 6, which meant the
     log destroyed its own history faster than the well could show it: the
     lines below the fold that scrolling promised were already gone. Sixty
     covers the narration of a long dish end to end; it exists at all only so
     a run left at x12 overnight cannot grow the DOM without bound. */
  while (box.children.length > 60) box.removeChild(box.lastChild);
}

function dirWord(fx, fy, tx, ty) {
  var a = Math.atan2(ty - fy, tx - fx);
  var deg = (a * 180 / Math.PI + 360) % 360;
  var names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return names[Math.round(deg / 45) % 8];
}

function onEngulf(i) {
  var e = S.exp, nd = e.nodes[i];
  var dir = dirWord(e.inoc.x, e.inoc.y, nd.x, nd.y);
  var left = e.nodes.length - S.engulfed;
  /* What the flake actually was, in the two numbers the organism balances */
  if (nd.nut) { S.dietP += nd.nut[0]; S.dietC += nd.nut[1]; }
  /* Reachability only changes when a flake goes in, so this is the one place
     the question needs asking. The timestamp, not a finish() here: the end
     runs from the tick's own end-condition block, a few seconds on, so the
     engulf line and this one get read before the verdict covers them. */
  if (e.diet && !S.dietDoomedT && dietDoomed(e)) {
    S.dietDoomedT = S.simT;
    logLine('the ratio is past saving. nothing left on the plate can pull it back.', true);
  }
  var lines = [
    'something rich to the ' + dir + '. folded in.',
    nd.label + ' engulfed — the tube to the ' + dir + ' thickens.',
    'contact ' + dir + '. that one is inside you now.'
  ];
  logLine(pick(lines), true);
  /* A decoy costs what reaching it cost. It still counts as engulfed, because
     the organism did engulf it; it simply was not worth engulfing. */
  if (nd.trap) {
    var toll = Math.floor(nAgents * (e.trapCost || 0.22));
    for (var t = 0; t < toll; t++) killWeakest();
    logLine('mostly cellulose. the tube that reached ' + nd.label + ' is being reabsorbed, and a good deal of you with it.', true);
  }
  if (left === 0) logLine('all of it. every last flake.', true);
  else if (left === 1) logLine('one left.');
  flashNodeRow(i);
  refreshNodeRows();
}

function onReseal(i) {
  var nd = S.exp.nodes[i];
  var lines = [
    nd.label + ' skins over. you stopped holding it and the agar closed.',
    'the flake at ' + nd.label + ' re-forms. ground is only yours while you are standing on it.',
    nd.label + ' seals again — not lost, but to be taken a second time.'
  ];
  logLine(pick(lines), true);
  refreshNodeRows();
}

function updateNarration(e) {
  /* scripted beats */
  while (S.scriptIdx < e.script.length && S.simT >= e.script[S.scriptIdx].t) {
    var s = e.script[S.scriptIdx];
    logLine((TOUCH && s.textTouch) ? s.textTouch : s.text, !!s.hi);
    S.scriptIdx++;
  }
  /* ambient mutterings */
  if (S.simT >= S.ambientAt) {
    S.ambientAt = S.simT + (17 + rnd() * 12) * PACE;
    if (S.simT > 8) logLine(pick(e.ambient));
  }
}

/* ------------------------------------------------------------
   12. HUD
   ------------------------------------------------------------ */
var nodeEls = [];

function buildNodeRows() {
  var box = $('h-nodes');
  box.innerHTML = '';
  nodeEls = [];
  for (var i = 0; i < S.exp.nodes.length; i++) {
    var d = document.createElement('div');
    d.className = 'n';
    d.textContent = S.exp.nodes[i].label;
    box.appendChild(d);
    nodeEls.push(d);
  }
  refreshNodeRows();
}

function refreshNodeRows() {
  for (var i = 0; i < nodeEls.length; i++) {
    var el = nodeEls[i];
    var lbl = S.exp.nodes[i].label;
    if (S.nodeDone[i]) {
      if (el.className.indexOf('hit') < 0) el.className = 'n hit';
      el.textContent = lbl + ' ●';
    } else {
      /* a node can go back the other way where a dish reseals, so the row has
         to be able to un-light rather than only ever lighting up once */
      if (el.className.indexOf('hit') >= 0) el.className = 'n';
      el.textContent = lbl + ' ' + Math.floor(S.nodeProg[i] * 100) + '%';
    }
  }
}

function flashNodeRow(i) {
  var el = nodeEls[i];
  if (!el) return;
  el.style.color = 'var(--slime-hot)';
  setTimeout(function () { el.style.color = ''; }, 420);
}

var hudTick = 0;

/* force: skip the every-4th-frame throttle below. The throttle is invisible
   while the dish is running — the numbers catch up 60ms later — but the LAST
   frame of a run has no next frame, so a run that ended on a skipped tick
   froze the objective and the biomass one update short. That used to vanish
   with the sim screen; now the plate stays on the bench under a verdict
   quoting the true final figures, and a stale HUD sits next to it disagreeing. */
function updateHUD(force) {
  if (!S.exp) return;
  if (force) hudTick = 0;
  /* The time-lapse slot doubles as the replay badge: a run being replayed is
     always at some rate, so the rate is stated whether or not it is 1. Outside
     a replay the slot is empty only AT the reference — a run being watched at
     ×1/4 has to say so as plainly as one at ×4, or a dish crawling because the
     dial is down reads as a dish crawling because it is dying. */
  $('h-time').textContent = fmtTime(S.simT) +
    (REPLAY.on ? ' · REPLAY ×' + fmtSpeed(TURBO)
               : (TURBO !== 1 ? ' ×' + fmtSpeed(TURBO) : ''));

  if ((hudTick++ % 4) !== 0) return;

  var e = S.exp;
  $('h-mass').textContent = fmtNum(nAgents);
  var pct = clamp(nAgents / e.cap * 100, 0, 100);
  var bar = $('h-massbar');
  bar.style.width = pct.toFixed(1) + '%';
  var mwrap = bar.parentNode.parentNode;
  /* scaled to the dish's own ceiling: biomass now runs in the thousands,
     so a fixed few-hundred tripwire never fired before the culture was dead */
  if (nAgents < e.cap * 0.09) {
    if (mwrap.className.indexOf('crit') < 0) mwrap.className = 'meter mass crit';
  } else if (mwrap.className.indexOf('crit') >= 0) {
    mwrap.className = 'meter mass';
  }

  /* The reserve, whenever the dish is running one. Its critical band is the
     same visual language the biomass meter already uses for the same reason:
     the thing you steer with is about to stop answering. */
  var cwrap = $('h-cuewrap');
  if (cueCapOf(e)) {
    var cf = cueFrac();
    $('h-cue').textContent = Math.round(cf * 100) + '%';
    $('h-cuebar').style.width = (cf * 100).toFixed(1) + '%';
    var want = cf < CUE_LOW ? 'meter cue crit' : 'meter cue';
    if (cwrap.className !== want) cwrap.className = want;
  }

  if (e.hab) {
    $('h-hab').textContent = Math.round(S.hab * 100) + '%';
    $('h-habbar').style.width = (S.hab * 100).toFixed(1) + '%';
  } else if (e.diet) {
    /* The meter is a position, not a quantity: the band the dish wants sits in
       the middle, and either side of centre is a different way of being wrong. */
    $('h-hab').textContent = 'p ' + Math.round(S.dietP) + ' · c ' + Math.round(S.dietC);
    $('h-habbar').style.width = dietPos(e).toFixed(1) + '%';
  }

  $('h-obj').textContent = objText(e);
  refreshNodeRows();
  $('h-note').textContent = noteText(e);
}

/* Band centre at 50%, band edges at 25 and 75 — so the meter is read the way
   the gate is written, and sitting in the middle is the whole instruction. */
function dietPos(e) {
  if (S.dietC <= 0) return 0;
  var d = e.diet;
  return clamp(50 + 25 * (S.dietP / S.dietC - d.target) / (d.tol || 1), 0, 100);
}
function dietRatio() {
  return S.dietC > 0 ? (S.dietP / S.dietC).toFixed(1) : '—';
}

/* The objective line counts what the win actually counts. A dish where only
   four of nine flakes matter must not report nine, and one that asks for
   simultaneous holding must not report a running total. */
function objText(e) {
  var s, i, d;
  if (e.required) {
    d = 0;
    for (i = 0; i < e.required.length; i++) if (S.nodeDone[e.required[i]]) d++;
    s = e.objShort + ' ' + d + ' / ' + e.required.length;
  } else if (e.holdWin) {
    s = e.objShort + ' ' + S.engulfed + ' / ' + e.holdWin;
  } else {
    s = e.objShort + ' ' + S.engulfed + ' / ' + e.nodes.length;
  }
  if (e.minShocks) s += ' · CYCLES ' + Math.min(S.shocksSurvived, e.minShocks) + ' / ' + e.minShocks;
  return s;
}

function noteText(e) {
  /* Above the shock warning on purpose. A player who cannot steer needs to be
     told that before being told what to steer away from — and the fix (let go)
     is one word, so it costs the warning almost nothing to wait a beat. */
  if (S.refineT0 >= 0 && e.refine) return 'settling — ' + Math.max(0, Math.ceil(e.refine.dur - (S.simT - S.refineT0))) + 's · the idle tubes lapse';
  if (cueCapOf(e) && S.cueRes <= 0) return 'reserve spent — release to recover it';
  if (S.shockActive) return 'DRY SHOCK — hold the refuges';
  if (S.shockWarn && S.slow < 0.98) return 'thickening early — the interval has a shape';
  if (S.shockWarn) return 'humidity falling — ' + Math.max(0, Math.ceil(S.shockNext - S.simT)) + 's';
  /* Only when the ratio is the one thing left in the way — otherwise it is a
     number on screen that the player cannot yet act on. */
  if (e.donor && !S.fused && engulfGate(e)) return 'the far agar is not the assignment. the fusion is';
  if (e.requireEvents && e.events && S.eventIdx < e.events.length && engulfGate(e)) return 'the dish is not done being revised';
  if (e.diet && engulfGate(e) && !dietMet(e)) {
    if (S.engulfed < (e.diet.min | 0)) return 'fed, but not on enough — ' + S.engulfed + ' / ' + (e.diet.min | 0) + ' sources';
    return 'p:c ' + dietRatio() + ' — wanted ' + e.diet.target.toFixed(1) + ' ±' + e.diet.tol;
  }
  if (e.minShocks && engulfGate(e)) {
    var c = cyclesLeft(e);
    return c > 0 ? 'every flake taken — ' + c + ' more dry cycle' + (c === 1 ? '' : 's') + ' to outlast'
                 : 'every flake taken — hold through this cycle';
  }
  if (e.shocks && S.shockNext > 0) {
    var togo = Math.ceil(S.shockNext - S.simT);
    if (togo > 0 && togo < 90) return 'next dry shock in ' + togo + 's';
  }
  if (e.timeLimit) {
    var left = e.timeLimit - S.simT;
    if (left < 60) return 'plate scheduled for disposal in ' + Math.max(0, Math.ceil(left)) + 's';
  }
  if (e.hab && S.hab > 0.02 && S.hab < 0.99) return 'the bitterness is mattering less';
  if (e.hab && S.hab >= 0.99) return 'quinine: noted, ignored';
  if (S.engulfed === 0 && S.simT > e.grace) return 'starving — nothing engulfed';
  if (S.engulfed === 0) return 'grace period — ' + Math.max(0, Math.ceil(e.grace - S.simT)) + 's of reserves';
  if (nAgents < e.cap * 0.12) return 'cytoplasm critically low';
  return S.engulfed + ' of ' + e.nodes.length + ' engulfed · biomass holding';
}

/* ------------------------------------------------------------
   12b. the observer's mark
   ------------------------------------------------------------
   The result screen has always reported a column of figures — peak biomass,
   cues emitted, time in contact — and none of them decided anything. The only
   thing a finished run wrote down was its elapsed time, which is the least
   interesting measure this organism has: a plasmodium is not fast, and racing
   one is not what any of the twenty papers were about.

   Two axes, each a ratio of the run against itself or against the clock the
   dish set, so neither needs a hand-tuned par per dish:

     AUTONOMY  how little of the run the brush was held for. The dish is meant
               to be solved by chemotaxis, with the player saying only which
               way is interesting; a run steered end to end has answered the
               question with a cursor.
     DISPATCH  the clock the dish gave you, against what you spent. Only on the
               sixteen dishes that set one — on the other four autonomy is the
               whole mark, rather than a time limit being invented here to have
               something to divide by.

   There were four. Two were cut after being measured rather than argued
   about, and what they were is worth keeping written down, because both
   failures are easy to design again.

   ECONOMY, at the heaviest weight of the four, was meant to be Tero 2010's
   comparison: the finished network against the minimum spanning tree over the
   same points. What it actually divided was the summed trail field, and trail
   is deposited per agent per step and decays geometrically, so the total
   tracks BIOMASS and not geometry — measured, mass per nucleus stayed between
   122 and 169 across every dish, seed and play style sampled, a 1.39x spread,
   against a span that ranges 3.9x across the twenty dishes. So it read "how
   little biomass did you finish with", inverted. On EXP-01 seed #555555, all
   three runs won: never touching the pointer scored 0.752, sweeping the cue
   over the whole plate scored 0.829, and parking the brush on the inoculation
   point until the culture starved scored a perfect 1.000. Counting network
   AREA instead of mass ordered them the same way, so it was not a matter of
   summarising the field differently: under-growing wins any such axis, because
   the win gate fires on engulfment and does not care how much organism is left
   behind it. Measuring this properly means normalising by biomass and routing
   the span through the walls — geodesicFrom is right there — and it is a real
   piece of design rather than a constant to retune.

   VIGOUR was final biomass over peak, meant to catch a run that arrived
   starved. S.peak is updated ten lines before winMet is tested, in the same
   step, and the win fires on the step the last node completes — which is the
   step that sets a new all-time peak. So nAgents === S.peak at almost every
   verdict: twelve of thirteen measured wins scored 0.999 or better. It was
   0.15 of the weight handed over for nothing. */
var W_AUTO = 0.60, W_DISP = 0.40;

/* The bands the observer writes in the margin. Five, because a scale with more
   than that is a number pretending to be a word. */
var MARKS = [
  [88, 'exemplary'], [74, 'clean'], [58, 'sound'], [40, 'workable'], [0, 'crude']
];

function markFor(score) {
  for (var i = 0; i < MARKS.length; i++) if (score >= MARKS[i][0]) return MARKS[i][1];
  return MARKS[MARKS.length - 1][1];
}

/* Both axes as fractions of one, and the weighted mark. A dish that sets no
   clock is scored on autonomy alone rather than on a borrowed one.

   A run that never touches the brush takes full autonomy, and on a dish the
   simulation wins unaided it can therefore take the top band having done
   nothing. That is left standing on purpose: an organism solving the dish
   without being steered is the thing this whole game is about, and a mark that
   punished it would be scoring the wrong party. Where a dish cannot be won
   without a hand the question does not arise — a hands-off run loses there and
   is not scored at all — and where it can, the axis rewards the run that
   needed less steering, which is the same instruction either way.

   Measured on EXP-01 and EXP-02, four play styles each, all eight winning:
   hands-off 100 and 88, brief nudges 84 and 78, steering toward the next
   target for three steps in five 40 and 54, and the brush parked down for the
   whole run 0 and 28. Monotone, and in the direction the axis is named for —
   which the axis this replaced was not: the parked run scored a PERFECT
   economy for starving its way to the same win. */
/* The run's clock for the mark and the best time: the settling is a fixed
   interval the dish imposes after the last node, not time the player spent,
   so the clock stops where the settling starts. Scoring the settling would
   have cut EXP-03's best possible mark below marks already saved from runs
   that ended at the ninth depot. */
function runClock() { return S.refineT0 >= 0 ? S.refineT0 : S.simT; }

function runScore(e) {
  var rt = runClock();
  var auto = rt > 0 ? clamp(1 - S.cueHeld / rt, 0, 1) : 1;
  var sum = W_AUTO * auto;
  var wt  = W_AUTO;
  var disp = -1;
  if (e.timeLimit) {
    disp = clamp(1 - rt / e.timeLimit, 0, 1);
    sum += W_DISP * disp;
    wt  += W_DISP;
  }
  var score = Math.round(100 * sum / wt);
  return { score: score, mark: markFor(score), auto: auto, disp: disp };
}

function pct(f) { return Math.round(f * 100) + '%'; }

/* ------------------------------------------------------------
   13. saved progress
   ------------------------------------------------------------ */
/* The key is deliberately still v1. Everything v2 adds — marks, ghosts, the
   daily record — is a new field beside the two v1 wrote, and a v1 payload
   loads into it unchanged with those fields simply absent. Bumping the key
   would have thrown away every logged run on the site to gain nothing. */
var SAVE_KEY = 'slime980.v1';
var save = { v: 2, done: {}, best: {}, score: {}, ghost: {}, daily: null, bestV: 0 };

function savedMap(o) { return (o && typeof o === 'object') ? o : {}; }

function loadSave() {
  /* Best times are clocks, and the clock a run is measured on is SIM_V's: a
     time set by the organism of another SIM_V is not a time this one can be
     asked to beat, so the marks come across only when the version matches.
     Done, score and daily stay — progress is progress, and the score is a
     ratio a run of either organism can be held to. The ghosts have their
     own signature and reject themselves. */
  save.bestV = SIM_V;
  try {
    var raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    var o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      save.done  = savedMap(o.done);
      save.best  = (o.bestV === SIM_V) ? savedMap(o.best) : {};
      save.score = savedMap(o.score);
      save.ghost = savedMap(o.ghost);
      save.daily = (o.daily && typeof o.daily === 'object') ? o.daily : null;
    }
  } catch (err) { /* private mode, file:// restrictions, corrupt JSON — play anyway */ }
}

/* Ghosts are the only thing in the save with no ceiling on its size, so they
   are the only thing that can push it past a browser's storage quota. When
   that happens the ghosts give way, never the progress: a player losing twenty
   logged runs and their marks to keep a recording of one of them is the wrong
   trade in every possible case.

   The biggest one goes first, and the write is retried, rather than all of
   them going at once — the usual cause is a single marathon run on a single
   dish, and clearing the other nineteen to make room for it is exactly
   backwards. */
function writeSave() {
  var codes, i;
  for (var attempt = 0; attempt < 24; attempt++) {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      return true;
    } catch (err) {
      /* Shed only for the failure shedding can actually fix. A browser that
         refuses EVERY write — storage disabled by policy throws SecurityError,
         and private modes have historically thrown from setItem outright —
         would otherwise walk this loop to the end and delete every recording
         the player had, in memory, to make room that was never the problem;
         and if a later write then succeeded, the deletions became permanent.
         The name check is deliberately loose because browsers disagree on it:
         anything that does not look like a space complaint is not one. */
      var nm = (err && err.name) ? String(err.name) : '';
      if (nm && nm.indexOf('Quota') < 0 && nm.indexOf('QUOTA') < 0 &&
          nm !== 'NS_ERROR_DOM_QUOTA_REACHED') return false;
      codes = [];
      for (i in save.ghost) if (save.ghost[i]) codes.push(i);
      if (!codes.length) return false;   /* nothing left to shed — give up */
      var big = codes[0];
      for (i = 1; i < codes.length; i++) {
        if (save.ghost[codes[i]].length > save.ghost[big].length) big = codes[i];
      }
      delete save.ghost[big];
    }
  }
  return false;
}

function isDone(i) { return !!save.done[EXPERIMENTS[i].code]; }
/* The stored mark for a dish, or -1 where there is none. Not `|| 0`, for the
   reason the save path is not either: 0 is a real mark a real win can earn, so
   a falsy test hides it — the dish showed "logged" with no mark beside it,
   which reads as a run that was never scored rather than one that scored
   badly. -1 because the callers want to ask "is there one", and every genuine
   mark is at least 0. */
function bestScore(i) {
  var c = EXPERIMENTS[i].code;
  return save.score.hasOwnProperty(c) ? (save.score[c] | 0) : -1;
}

/* Unlocking used to be a chain: dish i opened when dish i-1 was logged, and
   one dish a player could not beat therefore hid the twelve behind it for
   good. EXP-08's ratio band is a plausible place for that to happen, and a
   schedule that ends at whichever dish someone got stuck on is not a schedule.

   So the gate counts instead of pointing. SLACK dishes past your logged total
   stay open, which lets a wall be walked around without letting the whole
   schedule be skipped — and the daily dish (below) ignores the gate outright,
   because a challenge everyone is running on the same day cannot be one that
   half of them are locked out of. */
var UNLOCK_SLACK = 2;
function isUnlocked(i) { return i <= doneCount() + UNLOCK_SLACK; }
function unlockNeed(i) { return Math.max(0, i - UNLOCK_SLACK - doneCount()); }
function doneCount() {
  var c = 0;
  for (var i = 0; i < EXPERIMENTS.length; i++) if (isDone(i)) c++;
  return c;
}

/* ------------------------------------------------------------
   14. screens
   ------------------------------------------------------------ */
/* Three screens, not four: the result is no longer one. It is a panel below
   the dish on the sim screen, so finishing a run never takes the organism off
   the bench. */
var SCREENS = ['scr-title', 'scr-brief', 'scr-sim'];

function show(id) {
  var changed = false;
  for (var i = 0; i < SCREENS.length; i++) {
    var el = $(SCREENS[i]);
    var want = SCREENS[i] === id;
    if (el.classList.contains('on') !== want) changed = true;
    if (want) el.classList.add('on');
    else el.classList.remove('on');
  }
  /* A screen swap replaces the whole page, so it starts at the top of the new
     one. Without this, leaving a verdict you had scrolled down to read drops
     you into the next dish already scrolled past the top of the plate — the
     other half of arriving at part of the map. Only on an actual swap: calling
     show for the screen already up must not yank the page. */
  if (changed && window.scrollTo) window.scrollTo(0, 0);
}

/* ---------- title ---------- */
function renderTitle() {
  var box = $('dishes');
  box.innerHTML = '';
  for (var i = 0; i < EXPERIMENTS.length; i++) {
    (function (i) {
      var e = EXPERIMENTS[i];
      var unlocked = isUnlocked(i), done = isDone(i);
      var b = document.createElement('button');
      b.className = 'dish' + (done ? ' done' : '') + (unlocked ? '' : ' locked');
      if (!unlocked) b.disabled = true;

      var c = document.createElement('div'); c.className = 'code'; c.textContent = e.code;
      var n = document.createElement('div'); n.className = 'nm'; n.textContent = e.name;
      var l = document.createElement('div'); l.className = 'bl'; l.textContent = e.blurb;
      var s = document.createElement('div'); s.className = 'st';
      if (!unlocked) {
        /* A locked card says what would open it, not merely that it is shut.
           With the gate counting rather than pointing, "locked" alone no
           longer implies the answer — the dish in front of it is not
           necessarily the one in the way. */
        var need = unlockNeed(i);
        s.textContent = 'locked · log ' + need + ' more';
      } else if (done) {
        s.textContent = 'logged · ' + fmtTime(save.best[e.code] || 0);
      } else {
        s.textContent = 'available';
      }

      b.appendChild(c); b.appendChild(n); b.appendChild(l); b.appendChild(s);
      if (done && bestScore(i) >= 0) {
        var m = document.createElement('div'); m.className = 'mk';
        m.innerHTML = 'mark <b></b>';
        m.querySelector('b').textContent = bestScore(i) + ' · ' + markFor(bestScore(i));
        b.appendChild(m);
      }
      if (unlocked) b.addEventListener('click', function () { openBrief(i); });
      box.appendChild(b);
    })(i);
  }
  $('progress').textContent = doneCount() + ' / ' + EXPERIMENTS.length + ' logged';
  refreshDaily();
  renderDaily();
}

/* The day's plate, as a card. It names the dish and the specimen line, because
   those two together ARE the challenge — someone comparing marks needs to be
   able to see they ran the same one. */
function renderDaily() {
  var b = $('daily-go');
  if (!b || !DAILY) return;
  var e = EXPERIMENTS[DAILY.idx];
  b.innerHTML = '';
  var c = document.createElement('div'); c.className = 'code';
  c.textContent = e.code + ' · ' + seedLabel(DAILY.seed);
  var n = document.createElement('div'); n.className = 'nm'; n.textContent = e.name;
  var st = document.createElement('div'); st.className = 'st';
  st.textContent = dailyDone() ? 'logged · mark ' + dailyScore() : 'the same plate for everyone today';
  b.appendChild(c); b.appendChild(n); b.appendChild(st);
  $('daily-st').textContent = dailyDone() ? 'logged' : 'open';
}

/* Put down whatever is on the bench. Every route away from a live dish has to
   do this: without it the abandoned run keeps stepping behind the screen you
   moved to, reaches finish() unwatched, and writes progress, a mark and a
   ghost for a plate nobody is looking at — and if it was a replay, its
   showResult overwrites the verdict the replay was launched from. */
function leaveRun() {
  stopRun();
  REPLAY.on = false; REPLAY.trace = null;
  setReplayUI(false);
  closeResult();
}

function goTitle() {
  leaveRun();
  renderTitle();
  show('scr-title');
}

/* ---------- brief ---------- */
var briefIdx = 0;

function openBrief(i) {
  briefIdx = i;
  var e = EXPERIMENTS[i];
  $('b-code').textContent = e.code + ' · dish ' + (i + 1) + ' of ' + EXPERIMENTS.length;
  $('b-name').textContent = e.name;
  $('b-obj').textContent = e.obj;
  var hz = $('b-hz');
  hz.innerHTML = '';
  for (var c = 0; c < e.chips.length; c++) {
    var sp = document.createElement('span');
    sp.className = 'hz' + (e.chips[c][0] ? ' ' + e.chips[c][0] : '');
    sp.textContent = e.chips[c][1];
    hz.appendChild(sp);
  }
  show('scr-brief');
}

/* ------------------------------------------------------------
   15. run lifecycle
   ------------------------------------------------------------ */
var raf = 0, lastTs = 0, acc = 0;
/* Sim-time multiplier: sim seconds per real second. It scales the step budget
   with it, so the clock, the shock schedule and every rate stay in sim time —
   the dish is not "sped up", it is watched with the shutter open longer. The
   player cycles it through SPEEDS; the harness can set any rate in range.

   ×1 is the DISH clock, and the dish clock was never real time. A Physarum
   network that takes the better part of a day in a real plate is built here in
   a couple of sim minutes, so the reference this ladder hangs off already runs
   at something like a hundred times life — REAL_X below, an estimate, and
   labelled as one wherever it is shown.

   That is what the bottom half of the ladder is for. Stops below ×1 are not
   slow motion of an organism; they are slow motion of the MODEL, and at ×1/16
   the dish is still moving at roughly six times life. Nothing this control can
   reach runs slower than the mould does, which is the honest thing to say
   about a dial whose lowest stop is still a time-lapse.

   Powers of two either side of the reference: every stop is exactly
   representable, indexOf on the array is therefore exact, and a stop and its
   inverse are the same distance from ×1 in the direction that matters. */
var TURBO = 1;
var SPEEDS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16];
var TURBO_MIN = SPEEDS[0];
var TURBO_MAX = 24;

/* Estimated real-time factor of the dish clock: ×1 is about REAL_X times life.
   It is stated in the controls so a multiplier means something outside the
   dish, and it is read NOWHERE in the simulation — no step, rate, schedule or
   score has ever heard of it. Changing it changes captions and nothing else. */
var REAL_X = 100 / PACE;
function realX(t) { return fmtNum(t * REAL_X); }

/* The verdict screen offers three stops rather than all nine. It is a row of
   one button each, not a cycle, and a recap has no use for the slow half of
   the ladder: you are choosing how long to spend watching a run you have
   already played, and the fastest useful answer to that is a stop the dial
   also has. ×4 stays the suggested one. */
var REPLAY_SPEEDS = [1, 4, 16];

/* Ceiling on the stepping work ONE frame may do, in milliseconds of wall
   clock. The step budget below it is a COUNT, and a count is the wrong unit
   to bound a frame with: at x12 it permits 48 steps back to back — around
   90ms on the machine these numbers were measured on — with a single paint at
   the end of them. The dish advances the whole time and almost none of it is
   drawn. Measured at x12 on EXP-01: 10fps, and 456 steps a second against the
   720 the multiplier asks for, since a machine that cannot make the rate
   drops the backlog either way.

   Bounding the same loop by TIME paints in the middle of that second instead.
   Same run, same machine: 30fps and 299 steps a second. Three times the frame
   rate for two thirds of the step rate, and worth it, because the frame rate
   is what a time-lapse IS. A run that advances half again as fast while
   showing ten frames a second is a slideshow of a dish, and the reason to
   watch a network form at twelve times real time is to watch it form.

   Most of what that costs is not the extra paints, which are 3ms each against
   a step's 2ms. It is vsync idle: 20ms of stepping plus a paint lands near
   25ms and the frame then waits out the rest of its 33.3ms. Filling that gap
   means running at the deadline, and a frame that overruns it by a
   millisecond does not gain a millisecond — it waits a further 16.7ms.
   Measured across boxes from 10 to 24ms, 24 tips the median frame to 50ms and
   gives back the step rate it reached for, and everything below 20 clips x4,
   which is a speed this machine otherwise holds exactly. 20 is the value that
   leaves x4 alone and still lands x12 inside two vsyncs.

   It is a ceiling, not a policy. Where a frame's steps already fit inside it
   nothing here does anything at all, and that is most hardware at most
   speeds: x12 wants twelve steps in a 60Hz frame, which is 20ms only if a
   step costs 1.7ms. Below that the box never closes and x12 runs at x12.

   The ladder's top stop is x16 now, which is the same statement with a
   shorter budget: sixteen steps inside 20ms wants a step under 1.25ms, and a
   machine slower than that runs x16 at whatever the box affords — around x12
   where a step is 1.7ms — rather than at sixteen. That is the ceiling doing
   its job and not a stop that does not work; the alternative at the top of the
   dial is a frame rate that collapses to make a number true. The box was left
   at 20 rather than widened for the new stop, because widening it spends the
   frame rate of every OTHER speed to buy the top one its figure. The stops
   below x1 never come near it: at x1/16 a frame is due a step every sixteenth
   frame, so the box closes on nothing, and the budget floor in the loop is
   what keeps that from rounding to no steps at all.

   None of it touches what a step does. Steps run in order at a fixed DT, and
   a seed run to the same step count holds a bit-identical dish at any speed,
   with the box at any value or none — verified on EXP-04 at step 1500 across
   x1/x4/x12 and boxes of 6ms, 24ms and off, which agree to the last bit of
   the trail field. Re-verified when the ladder grew its slow half, all of it
   on EXP-04 on one seed: step 120 across all nine stops, step 600 across
   x1/16, x1/8 and x1 — the two stops the budget floor binds at, against the
   reference — and step 1500 across x1/4, x1, x4 and x16. One trail hash and
   one front position in each of the three. A stop below x1 spends most frames
   running no steps at all, and a frame that runs none is not a frame the dish
   can tell apart from one that was never scheduled. */
var STEP_MS = 20;

/* Steps executed this run, and an optional harness stop. stepsRun is the
   x-axis determinism is defined over: two runs of the same seed that have
   executed the same number of steps hold identical state, whatever speed or
   frame rate got them there. stepTarget lets a test stop both runs on the
   same step rather than on whichever step a frame happened to end at. */
var stepsRun = 0;
var stepTarget = 0;

/* ------------------------------------------------------------
   15b. input trace + replay
   ------------------------------------------------------------
   The dish is a pure function of (seed, the brush painted at each step), so
   recording the second of those makes the whole run replayable. The trace is
   written in the SAME place the brush is painted — inside the frame loop's
   step budget, immediately before step() — so it is by construction exactly
   what the simulation consumed, not an approximation of the pointer events
   that produced it. A held brush spans many steps and is recorded once per
   step; an idle run records nothing at all.

   Positions are stored as the Int16 quantum count toGrid already snapped them
   to (see CUE_Q). That is exact, not a rounding: ptr.gx is by construction a
   multiple of 1/CUE_Q, so the trace holds the same number the sim consumed and
   hands back the same number on the way out. Same bits in, same dish out —
   that is the whole contract, and it is now a contract a trace can also be
   written to storage and read back under. */
var TRACE = null;
var REPLAY = { on: false, i: 0, trace: null };

function newTrace(idx, seed) {
  var cap = 2048;
  return {
    idx: idx, seed: seed, n: 0, cap: cap, cues: 0,
    step: new Int32Array(cap),
    mode: new Uint8Array(cap),
    gx: new Int16Array(cap),
    gy: new Int16Array(cap)
  };
}

function growTrace(t) {
  var c = t.cap * 2;
  var s = new Int32Array(c);   s.set(t.step); t.step = s;
  var m = new Uint8Array(c);   m.set(t.mode); t.mode = m;
  var x = new Int16Array(c);   x.set(t.gx);   t.gx = x;
  var y = new Int16Array(c);   y.set(t.gy);   t.gy = y;
  t.cap = c;
}

function recordBrush(s, mode, gx, gy) {
  var t = TRACE;
  if (!t) return;
  if (t.n >= t.cap) growTrace(t);
  t.step[t.n] = s; t.mode[t.n] = mode;
  t.gx[t.n] = Math.round(gx * CUE_Q); t.gy[t.n] = Math.round(gy * CUE_Q);
  t.n++;
}

/* Drive ptr from the trace for the step about to run. It writes the live ptr
   rather than a shadow copy on purpose: the frame loop's paint line and the
   renderer's brush ring then need no replay-specific branch, so the replay
   path and the played path are the same code. Live input is gated off while
   REPLAY.on, so nothing else can touch ptr from under it. */
function feedTrace(s) {
  var t = REPLAY.trace;
  if (!t) { ptr.down = false; return; }
  while (REPLAY.i < t.n && t.step[REPLAY.i] < s) REPLAY.i++;
  if (REPLAY.i < t.n && t.step[REPLAY.i] === s) {
    ptr.down = true;
    ptr.mode = t.mode[REPLAY.i];
    ptr.gx = t.gx[REPLAY.i] / CUE_Q;
    ptr.gy = t.gy[REPLAY.i] / CUE_Q;
    REPLAY.i++;
  } else {
    ptr.down = false;
  }
}

/* ------------------------------------------------------------
   15c. ghosts — a trace written down
   ------------------------------------------------------------
   A trace already replays a run; it just never survived the tab. Storing the
   best run's trace per dish turns the replay control into a ghost: the line
   you are trying to beat, played back on the plate you are about to run.

   The wire format is one byte string, base64'd, carrying a fixed 12-byte
   header and then 9 bytes an entry. The header is the version, a signature
   over the simulation the tape was recorded under (below), the dish index, a
   reserved byte, the 24-bit seed, and the cue tally — that last one because
   cues are counted from pointer events rather than from steps, so it is the
   one figure a replay of the tape cannot rederive. Each entry is the absolute
   step (Uint32), the mode, and the two Int16 quantum counts.

   The step was briefly a Uint16 delta from the previous entry, on the reasoning
   that a delta could not overflow because the longest dish is 900 sim-seconds.
   Four dishes set no time limit at all, so a run has no step ceiling and the
   reasoning was simply false — and the likeliest dish to break it was EXP-01,
   which has no reserve either, so "touch once, let it run, touch again" is
   ordinary play there and a 1092-second gap is 45 seconds of wall clock at
   ×24. Absolute Uint32 costs two bytes an entry and needs no argument about
   how long a dish can be, which is the better trade in a format that has
   already been wrong once about exactly that.

   Both ends are total: a ghost that fails to decode for any reason — a
   truncated string, a version this build does not know, a length that is not a
   whole number of entries — returns null and the dish simply has no ghost. It
   is a recording of a run, and there is nothing here worth throwing an error
   over. */
var GHOST_V = 2;
var GHOST_HEAD = 12;
var GHOST_ENT = 9;

/* A ghost is a seed and a tape of brush-steps, so replaying it faithfully
   depends on the whole simulation that consumes them. Change anything a step
   does and a stored tape still decodes perfectly and replays into a DIFFERENT
   run, which is the worst shape a bug can take here: nothing looks broken. So
   the header carries a byte, and a tape that disagrees with it is refused the
   way a truncated one is.

   SIM_V is the actual contract and the only part that can be right. No hash of
   constants can cover a change to what step() DOES — a reordered sense, a
   different turn rule, an edit to a dish's walls — and a signature that hashed
   only constants would sail straight through exactly the releases most likely
   to break a tape. So: bump SIM_V whenever a change alters the dish a given
   seed and tape produce. The constants below are folded in underneath it as a
   backstop for the case the bump is forgotten, which is not the same as a
   guarantee and is not written here as one. */
/* 2: conductivity, the vein scar, adrift reabsorption, and starvation drawing
   from the weakest rather than at random. Each of those changes what a step
   does to the dish, and the last two change how many draws a step takes from
   the generator as well, so every tape recorded under 1 replays into a
   different run. */
/* 3: the tip-supply gate (TIP_FEED 24 at TIP_BACK), retraction feeding the
   front each step, and PACE. The first two change what a step does and how
   many draws it takes; PACE changes every dish's clock. */
/* 4: the tip bar back at 3.0, the body test and reabsorption, recruitment
   gone, PACE 1. Each changes what a step does and how many draws it takes. */
/* 5: the stalk. It changes the trail under every runner's thread.
   6: settling — a dish with `refine` runs on past its last node.
   7: the stalk floors at STALK_W, and idle tube is withdrawn from.
   8: followers stay in the tube, and new cytoplasm arrives on it.
   9: the hold on a flake and its pull run down with the food left.
   10: the return signal — a find travels back through the cytoplasm, holds
       the route it came by and shades the tubes beside it. */
var SIM_V = 11;   /* the drop is a disc, not a diamond: every run starts differently */

function ghostSig() {
  var h = mix32(SIM_V, Math.round(CUE_CAP * 1000), Math.round(CUE_REGEN * 1000));
  h = mix32(h, Math.round(CUE_RET * 1000), CUE_Q);
  h = mix32(h, Math.round(BRUSH_PEAK * 1000) ^ CUE_R, Math.round(DECAY * 10000));
  h = mix32(h, Math.round(DIFF * 10000), Math.round(DEPOSIT * 1000));
  h = mix32(h, Math.round(FOODW * 1000) ^ Math.round(CUEW * 1000),
               Math.round(RETW * 1000) ^ Math.round(TURN * 1000));
  h = mix32(h, Math.round(SPEED * 1000) ^ Math.round(TRAIL_MAX * 10),
               Math.round(SPEED_REF * 100) ^ EXPERIMENTS.length);
  /* the return signal's constants, all of them: each one changes the dish */
  h = mix32(h, Math.round(FED_STEP * 10000) ^ (FED_PASSES << 16) ^ (FED_R << 20),
               Math.round(FED_GAIN * 1000) ^ (Math.round(FED_LAY_GAIN * 1000) << 12));
  h = mix32(h, (FED_SHARP << 12) ^ (FED_CORE_R << 20) ^ Math.round(FED_LOW * 1000),
               Math.round(FED_HI * 1000) ^ (Math.round(FED_SHADE * 10000) << 12) ^
               (Math.round(FED_SHADE_DEP * 1000) << 20));
  h = mix32(h, Math.round(FED_BODY * 1000) ^ (Math.round(FED_FADE * 1000) << 12),
               Math.round(FED_OFF * 1000) ^ (Math.round(FED_THIN * 10000) << 12) ^
               (Math.round(FED_THICK * 10) << 20));
  return h & 0xFF;
}

/* The size of the ghost a single run may leave behind. A ceiling on one
   recording, not on the store: writeSave sheds ghosts when the browser
   actually refuses the write, and this only stops one pathological run from
   being the reason it has to.

   The figure used to be 200k, justified as "more than the reserve permits in
   any dish". That was wrong twice over. recordBrush stores what the player
   ASKED for, not what the reserve granted, so the reserve bounds nothing about
   how long a tape gets — a hand held down for a whole run records every step
   of it, denied or not. And even counting only granted steps, retract drains
   at half rate, so a 900-second dish grants around 496 seconds of it: near
   30,000 entries where 200k of base64 held 21,000.

   The replacement figure was 400k, said to cover a run that holds the brush
   down for every step of the longest clocked dish. It did not, and the
   arithmetic is not close: an entry is 9 bytes and the header 12, so a tape is
   4*ceil((12 + 9n)/3) characters, and 900 sim-seconds at 60 steps a second is
   54,000 entries — 486,012 bytes, 648,016 characters. 400k held 33,332
   entries, or 556 seconds. Twice now this constant has been justified by a
   sentence rather than by the formula sitting directly above it.

   700k covers that worst case with room to spare. The four dishes with no
   clock can still exceed it, and that is what the no-longer-destructive path
   below is for — and the aggregate across twenty dishes is not this
   constant's problem, because writeSave sheds the largest recording first
   when a browser actually refuses the write, which is precisely the
   pathological tape this cap would otherwise have to guess at. */
/* Times PACE: the longest clocked dish is 900 dish-seconds at PACE 1, and the
   tape is per step, so it grows with the clock — 1,296,016 characters at
   PACE 2 by the formula above. */
var GHOST_MAX = 700000 * PACE;

function encodeGhost(t) {
  /* A zero-entry trace is encoded, not refused. A dish CAN be won without the
     brush ever going down — that is the best possible autonomy score, so it is
     exactly the run most likely to hold the best mark — and its recording is a
     valid one: the header carries the seed, the body is empty, and replaying
     it drives ptr.down false at every step, which is precisely the run that
     happened. Refusing it also had a second edge: the caller deletes the
     stored ghost when encoding returns null, so a hands-off best run threw
     away the recording of the previous one and left the mark with no run. */
  if (!t) return null;
  var bytes = new Uint8Array(GHOST_HEAD + t.n * GHOST_ENT);
  var dv = new DataView(bytes.buffer);
  dv.setUint8(0, GHOST_V);
  dv.setUint8(1, ghostSig());
  dv.setUint8(2, t.idx & 0xFF);
  dv.setUint8(3, 0);
  dv.setUint32(4, t.seed >>> 0);
  dv.setUint32(8, t.cues >>> 0);
  for (var i = 0; i < t.n; i++) {
    var o = GHOST_HEAD + i * GHOST_ENT;
    dv.setUint32(o, t.step[i] >>> 0);
    dv.setUint8(o + 4, t.mode[i]);
    dv.setInt16(o + 5, t.gx[i]);
    dv.setInt16(o + 7, t.gy[i]);
  }
  return b64enc(bytes);
}

function decodeGhost(str) {
  var bytes = b64dec(str);
  if (!bytes || bytes.length < GHOST_HEAD) return null;
  var body = bytes.length - GHOST_HEAD;
  if (body % GHOST_ENT !== 0) return null;
  var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (dv.getUint8(0) !== GHOST_V) return null;
  /* recorded under a differently-tuned simulation — it would replay into
     another run, so it is not this build's ghost to play */
  if (dv.getUint8(1) !== ghostSig()) return null;
  var idx = dv.getUint8(2);
  if (idx >= EXPERIMENTS.length) return null;
  var n = body / GHOST_ENT;
  var t = newTrace(idx, dv.getUint32(4) & SEED_MASK);
  t.cues = dv.getUint32(8);
  while (t.cap < n) growTrace(t);
  for (var i = 0; i < n; i++) {
    var o = GHOST_HEAD + i * GHOST_ENT;
    t.step[i] = dv.getUint32(o);
    t.mode[i] = dv.getUint8(o + 4);
    t.gx[i] = dv.getInt16(o + 5);
    t.gy[i] = dv.getInt16(o + 7);
  }
  t.n = n;
  return t;
}

/* btoa/atob take and return binary strings, so the bytes go through in chunks
   — String.fromCharCode.apply on a 130,000-element array is an argument list
   that long, and engines refuse it well before that. */
function b64enc(bytes) {
  try {
    var out = '', CH = 8192;
    for (var i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
    }
    return window.btoa(out);
  } catch (err) { return null; }
}

function b64dec(str) {
  if (typeof str !== 'string' || !str) return null;
  try {
    var bin = window.atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch (err) { return null; }
}

/* The stored ghost for a dish, decoded, or null. Decoded on demand rather than
   at load: twenty ghosts is a few hundred kilobytes of base64 that the title
   screen has no use for, and the one being replayed is the only one anybody
   ever looks at. */
function ghostFor(i) {
  var raw = save.ghost[EXPERIMENTS[i].code];
  if (!raw) return null;
  var t = decodeGhost(raw);
  /* a ghost that decodes to a different dish than the one it is filed under is
     a corrupt save, not a ghost — drop it rather than replaying the wrong dish */
  return (t && t.idx === i) ? t : null;
}

function hasGhost(i) { return !!save.ghost[EXPERIMENTS[i].code]; }

/* Where the three dish-ending controls live. On a bench with room they are on
   the control row, as they always were; on a phone they move inside the
   Controls disclosure, because five controls at phone width wrap to two rows. Same buttons, same handlers,
   same ids either way — all that changes is the parent, so nothing else in the
   file has to know which of the two places they are in.

   DOCK is the sheet's ROW_NARROW query, character for character — the sheet
   compacts the row on it and this moves the actions on it, and the two have to
   agree or the row is compacted while still carrying six controls.

   TOUCH_W is the hole ROW_NARROW's pointer-gated terms cannot see. Those two
   terms exist because a coarse pointer spends more width on the same controls;
   but body.touch is also set by markTouch() on a real touch event, on a device
   whose PRIMARY pointer is fine and which therefore never matches
   (pointer:coarse). A touchscreen laptop in a 700px window is that device, and
   it spends that width too. So TOUCH_W is the same two bounds with the pointer
   gate dropped, consulted only once TOUCH is known. Docking alone keeps that
   row off a second line — with the three actions in the panel it needs ~387px
   — so the script covers the case even though the sheet's compaction does not.
   markTouch() re-runs this for the same reason: learning the device is touch
   changes what the row needs.

   Both bounds are now wider than the row strictly needs. They were set when a
   coarse row also carried the Grow/Retract switch, which was ~111px; with the
   switch gone the coarse row wants about what the fine one does. They are left
   where they are rather than retuned, because the only effect of the extra
   margin is that a coarse device docks its two dish-ending actions into the
   disclosure a little sooner than it has to, and the sweep that placed them
   was more careful than a re-derivation would be. */
var DOCK = window.matchMedia
  ? window.matchMedia('(max-width:640px),(max-height:707px),' +
      '(pointer:coarse) and (max-width:739px),(pointer:coarse) and (max-height:775px)')
  : null;
/* the coarse pair with the pointer gate dropped — see TOUCH_W's note below */
var TOUCH_W = window.matchMedia
  ? window.matchMedia('(max-width:739px),(max-height:775px)')
  : null;
var DOCKED = ['s-reset', 's-abort', 's-exitrp'];

function dockActions() {
  var bar = $('controls'), pop = $('kact'), keys = $('keypop');
  if (!bar || !pop || !keys) return;
  var inPanel = !!(DOCK && DOCK.matches) || !!(TOUCH && TOUCH_W && TOUCH_W.matches);
  var home = inPanel ? pop : bar, i, el;
  for (i = 0; i < DOCKED.length; i++) {
    el = $(DOCKED[i]);
    if (!el || el.parentNode === home) continue;
    /* on the bar they go before the disclosure, which is always last */
    if (inPanel) home.appendChild(el); else bar.insertBefore(el, keys);
  }
  /* an empty action row would still draw its rule under the panel's top edge */
  pop.hidden = !inPanel;
}

/* true if there was an open key list to close, so Escape can stop there. */
function closeKeys() {
  var k = $('keypop');
  if (!k || !k.open) return false;
  k.open = false;
  return true;
}

function setReplayUI(on) {
  document.body.classList.toggle('replay', !!on);
  var x = $('s-exitrp');
  if (x) x.hidden = !on;
  var r = $('s-reset');
  if (r) r.textContent = on ? 'Restart fresh' : 'Reset';
}

function startReplay(sp) {
  if (!TRACE || TRACE.idx < 0) return false;
  var t = TRACE;
  /* The replay inherits the provenance of the run it is replaying, because it
     IS that run — same dish, same seed. Without this the replay started as a
     schedule run, and Reset or R pressed before it finished then read that
     back out of S and minted a random plate: the daily you were watching
     yourself play, swapped for something else on the way out of a viewing.
     Same failure as the restart controls had, reached through the one door
     that did not go through restartRun. */
  pendingVia = S.via; pendingViaDay = S.viaDay;
  startRun(t.idx, t.seed, t);
  setSpeed(sp || 4);
  return true;
}

/* Leaving a replay early puts the ORIGINAL run's verdict back — the replay is
   a viewing of a run that already happened, so aborting it cannot invent a new
   result and must not disturb the trace it was reading. */
function exitReplay() {
  if (!REPLAY.on) return;
  stopRun();
  REPLAY.on = false;
  REPLAY.trace = null;
  ptr.down = false;
  S.over = true;
  /* a replay abandoned while held would otherwise leave the veil up over the
     dish the verdict is inviting you to look at */
  S.paused = false;
  $('pauseveil').classList.remove('on');
  setPausedLabel(false);
  setReplayUI(false);
  /* put the original completed dish back so the lattice, biomass, nodes and
     clock agree with the verdict below them */
  if (FINAL_STATE) {
    trail.set(FINAL_STATE.trail);
    cueF.set(FINAL_STATE.cueF); retF.set(FINAL_STATE.retF);
    ovlLive = true;   /* whatever haze the run ended under is drawn with it */
    if (FINAL_STATE.slimeF) slimeF.set(FINAL_STATE.slimeF);
    if (FINAL_STATE.knotF) knotF.set(FINAL_STATE.knotF);
    if (FINAL_STATE.traceF) traceF.set(FINAL_STATE.traceF);
    if (FINAL_STATE.condF) condF.set(FINAL_STATE.condF);
    if (FINAL_STATE.scarF) scarF.set(FINAL_STATE.scarF);
    if (FINAL_STATE.fedF) fedF.set(FINAL_STATE.fedF);
    if (FINAL_STATE.padF) padF.set(FINAL_STATE.padF);
    if (FINAL_STATE.bodyF) bodyF.set(FINAL_STATE.bodyF);
    if (FINAL_STATE.linkF) linkF.set(FINAL_STATE.linkF);
    if (FINAL_STATE.shadeF) shadeF.set(FINAL_STATE.shadeF);
    nAgents = FINAL_STATE.n;
    fieldDirty = true;
    ax.set(FINAL_STATE.ax); ay.set(FINAL_STATE.ay);
    ah.set(FINAL_STATE.ah); atip.set(FINAL_STATE.atip);
    var fs = FINAL_STATE.S;
    for (var rk in fs) S[rk] = fs[rk];
    if (fs.nodeProg) S.nodeProg = fs.nodeProg.slice();
    if (fs.nodeDone) S.nodeDone = fs.nodeDone.slice();
    /* the run is a finished exhibit, whatever the snapshot said mid-frame */
    S.running = false; S.paused = false; S.over = true;
    restoreVeinTemporal(FINAL_STATE);
    /* the restored S carries the original run's wall and hazard lists, but
       the painted masks still hold the replay's — on a dish whose apparatus
       moved, an early abort would otherwise display the verdict over the
       wrong maze */
    stampMasks();
    rebuildGeo(S.exp);
    $('log').innerHTML = FINAL_STATE.logHTML;
    setSpeed(FINAL_STATE.turbo);
  }
  if (LAST_RESULT) { paintResult(LAST_RESULT); openResult(); }
  render();
  updateHUD(true);
}

/* No rounding to whole numbers any more — half the ladder is below 1 and
   Math.round would have flattened all of it onto ×1. A rate that is not a
   number at all still lands on the reference rather than on NaN, which would
   otherwise stop the accumulator dead. */
function setSpeed(n) {
  n = +n;
  if (!isFinite(n) || n <= 0) n = 1;
  TURBO = clamp(n, TURBO_MIN, TURBO_MAX);
  var b = $('s-speed'), fig = $('s-speedn');
  /* Only the figure is rewritten: the word in front of it is markup the sheet
     drops where the row has to be narrow, and the aria-label — which wins over
     the button's text outright — states the whole thing at every width. */
  if (fig) fig.textContent = '×' + fmtSpeed(TURBO);
  if (b) {
    /* Lit at every stop but the reference. It used to mean "faster than this
       dish normally runs"; it means "not the dish's own clock" now, and a run
       being watched at ×1/8 is exactly as much not-the-clock as one at ×8. */
    b.classList.toggle('lapse-on', TURBO !== 1);
    b.setAttribute('aria-label', 'Time-lapse, currently ' + fmtSpeed(TURBO) +
      ' times the dish clock — about ' + realX(TURBO) + ' times real time');
  }
  return TURBO;
}

/* The stop nearest a rate, measured in RATIO rather than in difference: the
   ladder is geometric, so ×3 is nearer ×4 than it is ×2 even though the
   arithmetic gap says otherwise. Only reachable with a rate a harness set —
   every rate the buttons produce is already a stop. */
function nearestSpeed(t) {
  var best = 0, bd = Infinity;
  for (var i = 0; i < SPEEDS.length; i++) {
    var d = Math.abs(Math.log(SPEEDS[i] / t));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* Nine stops through one button, so the cycle wraps. A touch player has no
   modifier to hold and reaches the whole ladder through this control alone,
   which means ×1/16 has to be reachable from ×16 the same way ×2 is from ×1;
   on a keyboard F walks up and Shift+F walks down, which is the shorter way
   round for anyone who has the keys.

   An off-ladder rate snaps ONTO the ladder before it steps, rather than
   stepping past the stop it is nearest — otherwise the first press after a
   harness set ×3 is a jump of two stops for no reason the player can see. */
function cycleSpeed(back) {
  var n = SPEEDS.length, k = nearestSpeed(TURBO);
  if (Math.abs(SPEEDS[k] - TURBO) > 1e-9) setSpeed(SPEEDS[k]);
  else setSpeed(SPEEDS[((k + (back ? -1 : 1)) % n + n) % n]);
}

/* Seed derivation. A run's seed is 24 bits and is the ONLY thing (besides
   player input) that decides how the dish turns out. Fresh runs get
   mix32(dish, attempt, bootSalt): the dish and the attempt counter so two
   dishes and two retries never collide, the boot salt so reloading the page
   is not the same five dishes every time. bootSalt is the one clock read in
   the file and it is not sim state — it chooses WHICH seed you play, and the
   seed is then printed where you can write it down and play it again. */
var bootSalt = (Date.now() >>> 0);
var attempts = 0;
function freshSeed(i) { return mix32(i + 1, ++attempts, bootSalt) & SEED_MASK; }

/* ---------- the daily dish ----------
   The second clock read in the file, and the only other one. bootSalt asks
   what time it is to avoid repeating itself; this asks to guarantee the
   opposite — every copy of the page, everywhere, derives the same dish and the
   same 24-bit seed from the same UTC day number, so "today's plate" is one
   plate and two people comparing marks on it are comparing the same run.

   UTC rather than local: a daily that rolls over at midnight in each player's
   own zone is a different dish depending on where you opened it, which is the
   one property it must not have.

   It ignores the unlock gate. A challenge the whole site is running on the
   same day cannot be one most of the site is locked out of, and a dish reached
   this way is a single plate rather than a place in the schedule — logging it
   marks the day, and the schedule is still walked in order. */
var DAY_MS = 86400000;
function dayNumber() { return Math.floor(Date.now() / DAY_MS); }

function makeDaily(day) {
  var h = mix32(day, 0x5DA11, 0x9E3779B9);
  return {
    day: day,
    idx: h % EXPERIMENTS.length,
    seed: mix32(day, h, 0x85EBCA6B) & SEED_MASK
  };
}

var DAILY = null;

/* How the run about to start was reached. A dish opened from the schedule is a
   place in the schedule; the daily plate and a pasted plate link are not, and
   both of them deliberately ignore the unlock gate — so a win reached through
   either must not be able to write the progress that gate is counting, or the
   gate is bypassable by anyone who can edit a URL.

   Set immediately before startRun and consumed by it, rather than passed as a
   fourth argument: startRun already takes (i, seed, trace) and is called from
   seven places, six of which have nothing to say about provenance and would
   have to pass a placeholder. Consuming it on read means a caller that forgets
   to set it gets SCHEDULE, which is the safe default — the worst it can do is
   decline to advance a schedule position that was legitimately earned, and a
   retry logs it. */
var VIA_SCHEDULE = 0, VIA_DAILY = 1, VIA_LINK = 2;
var pendingVia = VIA_SCHEDULE, pendingViaDay = 0;

/* The day's plate, recomputed if the day has turned over since it was last
   asked for. `init` derives it once, and a page left open across 00:00 UTC
   would otherwise keep serving yesterday's dish and seed from its card, its
   `#daily` route and its completion record, while a copy opened a minute later
   served today's — which breaks the one property the daily exists to have.
   Called wherever the plate is about to be shown or launched; a day that has
   not turned costs one integer compare. */
function refreshDaily() {
  var d = dayNumber();
  if (!DAILY || DAILY.day !== d) DAILY = makeDaily(d);
  return DAILY;
}

/* the mark logged against TODAY's plate, 0 if the record is for another day */
function dailyScore() {
  return (save.daily && DAILY && save.daily.day === DAILY.day) ? (save.daily.score | 0) : 0;
}
function dailyDone() { return !!(save.daily && DAILY && save.daily.day === DAILY.day); }

/* ---------- plates as addresses ----------
   A run is already reproducible from (dish, seed) — the result screen has
   printed the seed since the beginning and SLIME.start() has always taken it
   back. What was missing was a way to hand that pair to somebody without
   asking them to open a console: the same two values in the URL fragment,
   which the page reads on load and on every change to it.

   `#EXP-03/a3f2c1` is the dish and the specimen line, spelled the way the
   notebook spells them. `#daily` is today's plate. Both bypass the unlock
   gate, for the reason the daily does: a link is a plate, not a place in the
   schedule, and the schedule is still walked in order. */
function runLink(i, seed) {
  var base = String(window.location.href).split('#')[0];
  return base + '#' + EXPERIMENTS[i].code + '/' + seedLabel(seed).slice(1);
}

function parseHash(h) {
  h = String(h == null ? '' : h).replace(/^#/, '');
  if (!h) return null;
  if (h.toLowerCase() === 'daily') {
    /* refreshed here too: a link opened after midnight on a page that has been
       sitting since yesterday must land on today's plate, not the stale one */
    refreshDaily();
    return DAILY ? { idx: DAILY.idx, seed: DAILY.seed, via: VIA_DAILY } : null;
  }
  var parts = h.split('/');
  var code = parts[0].toUpperCase();
  for (var i = 0; i < EXPERIMENTS.length; i++) {
    if (EXPERIMENTS[i].code !== code) continue;
    /* a code with no seed opens the brief rather than a plate: it names a dish
       and nothing about which run of it, so it is a link to the experiment */
    /* The seed has to LOOK like a seed. normSeed falls back to 0 for anything
       it cannot parse, and 0 is a perfectly good plate — so a link mangled in
       transit ("%20a3f2c1" is what a chat client makes of one stray space, and
       a truncated paste is commoner still) would have started a different dish
       from the one it named, silently, and two people comparing marks on "the
       same plate" would not have been on it. Anything that is not six hex
       digits or fewer opens the brief instead, which names the dish and asks
       for nothing the link could have got wrong. */
    var raw = parts.length > 1 ? parts[1] : '';
    var ok = /^[0-9a-fA-F]{1,6}$/.test(raw);
    return { idx: i, seed: ok ? normSeed(raw) : null, via: VIA_LINK };
  }
  return null;
}

/* Act on the fragment. Returns whether it went anywhere, so boot can fall
   back to the title screen when it did not. */
function routeHash() {
  var r = parseHash(window.location.hash);
  if (!r) return false;
  /* A fragment naming only a dish opens its brief — which means leaving the
     bench, so the dish on it has to be put down first. startRun does its own
     teardown, so only this path needs saying. */
  if (r.seed == null) { leaveRun(); openBrief(r.idx); return true; }
  pendingVia = r.via;
  if (r.via === VIA_DAILY && DAILY) pendingViaDay = DAILY.day;
  startRun(r.idx, r.seed);
  return true;
}

/* Run this dish again. For a dish opened from the schedule that means a NEW
   plate — a fresh seed, which is the whole point of Reset there and has been
   since the beginning. For a dish reached as a specific plate it means THAT
   plate: the daily is "the same plate for everyone today", and a Reset that
   silently swapped it for a random one broke the only property it has, without
   saying so. A plate link is the same argument — somebody handed you a
   particular dish, not a particular experiment.

   The three restart controls (Retry, Reset, R) all route through here, so they
   cannot disagree about it. */
function restartRun() {
  if (S.idx < 0) return;
  if (S.via === VIA_SCHEDULE) { startRun(S.idx); return; }
  pendingVia = S.via; pendingViaDay = S.viaDay;
  startRun(S.idx, S.seed);
}

/* trace: a recorded run to play back instead of taking live input. Passing one
   makes this a REPLAY — no fresh seed is minted, nothing is recorded, and the
   stored trace is left exactly as it was so it can be replayed again. */
function startRun(i, seed, trace) {
  var e = EXPERIMENTS[i];
  S.exp = e; S.idx = i;
  /* Seed first: inoculate() draws from the stream, so the generator has to be
     standing before anything in the dish is placed. */
  S.seed = (seed == null || seed === '') ? freshSeed(i) : normSeed(seed);
  rndSeed(mix32(S.seed, 0x9E3779B9, 0x85EBCA6B));

  /* consumed, not merely read: the next run is a schedule run unless its
     caller says otherwise, so provenance cannot leak from one run to the next */
  S.via = pendingVia; pendingVia = VIA_SCHEDULE;
  /* which day's plate this is, handed in by the launch site rather than read
     from DAILY here. Reading it here was right for a first launch and wrong
     for a restart: restarting yesterday's daily after midnight would have
     stamped it with today's day and filed the result against a plate it was
     not a run of. */
  S.viaDay = pendingViaDay; pendingViaDay = 0;
  S.logged = false;

  REPLAY.on = !!trace;
  REPLAY.i = 0;
  REPLAY.trace = trace || null;
  if (!trace) TRACE = newTrace(i, S.seed);
  setReplayUI(REPLAY.on);
  closeResult();

  stepsRun = 0;
  stepTarget = 0;
  setSpeed(1);
  S.running = true; S.paused = false; S.over = false;
  S.simT = 0; S.peak = 0; S.cues = 0;
  /* a fresh plate arrives with a full reserve — the scarcity is meant to shape
     a run, not to open one already short */
  S.cueRes = cueCapOf(e); S.cueHeld = 0;
  S.nodeProg = new Float32Array(e.nodes.length);
  S.nodeIdle = new Float32Array(e.nodes.length);
  S.nodeDone = new Array(e.nodes.length);
  for (var q = 0; q < e.nodes.length; q++) S.nodeDone[q] = false;
  if (nodeHits.length < e.nodes.length) nodeHits = new Int32Array(e.nodes.length);
  if (nodeLoad.length < e.nodes.length) nodeLoad = new Int32Array(e.nodes.length);
  nodeHits.fill(0); nodeLoad.fill(0);
  S.engulfed = 0;
  S.hab = 0; S.habPeak = 0; S.habBuilt = -1; S.fused = false;
  S.dietP = 0; S.dietC = 0; S.dietDoomedT = 0;
  S.growAcc = 0; S.starveAcc = 0; reabCursor = 0; idleCursor = 0; mainOK = false; S.refineT0 = -1; S.flowAcc = 0; S.streamAcc = 0; tubeDist = [];
  S.shockNext = e.shock ? e.shock.first : 0;
  S.shockPeriod = e.shock ? e.shock.period : 0;
  S.shockActive = false; S.shockWarn = false; S.shocksSurvived = 0;
  S.shockWarned = -1; S.shockCycle = 0;
  S.quinTime = 0; S.slow = 1; S.anticipated = false;
  S.ambientAt = 14 * PACE; S.scriptIdx = 0; S.failReason = '';
  /* The active plate, before anything reads it: buildDish stamps from these. */
  S.walls = e.walls; S.hazards = e.hazards; S.eventIdx = 0;
  SLIME_W = e.slimeAvoid || 0;
  ovlLive = SLIME_W > 0; ovlAny = false;   /* a mat dish draws its mat from the first rebuild; a new dish shows none of the old one's haze */
  /* the cue count is bookkeeping, not sim state — a replay inherits the
     recorded run's tally so its observations match the run it is replaying */
  if (trace) S.cues = trace.cues;

  buildDish(e);
  inoculate(e);

  endGesture(); ptr.mode = 0;
  setPausedLabel(false);

  $('log').innerHTML = '';
  $('h-code').textContent = e.code + ' · ' + e.name;
  $('h-obj').textContent = objText(e);
  $('h-time').textContent = '00:00';
  $('h-note').textContent = '';
  /* One second meter, whichever of the two the dish is about. The console is
     told as well: with two meters their labels take a fixed column so the
     tracks line up, and with one there is nothing to line up with and the
     label takes only the room the word needs. */
  var two = !!(e.hab || e.diet);
  $('h-habwrap').style.display = two ? '' : 'none';
  $('console').classList.toggle('twometer', two);
  /* EXP-01 runs no reserve, so it shows no meter for one: a dish teaching what
     a cue is must not also be the dish that rations them. */
  var cap = cueCapOf(e);
  $('h-cuewrap').style.display = cap ? '' : 'none';
  $('h-cuewrap').className = 'meter cue';
  $('h-cue').textContent = '100%';
  $('h-cuebar').style.width = '100%';
  $('h-meterlab').textContent = e.diet && !e.hab ? 'P : C' : 'Habituation';
  $('h-hab').textContent = e.diet && !e.hab ? 'p 0 · c 0' : '0%';
  $('h-habbar').style.width = '0%';
  $('pauseveil').classList.remove('on');

  show('scr-sim');
  /* the dish is sized to fit the window, so arriving at one zoomed in is
     arriving at part of it */
  resetZoom();
  resizeCanvas();
  buildNodeRows();
  updateHUD();

  logLine('inoculated. ' + fmtNum(nAgents) + ' nuclei, one cell, no plan.', true);
  logLine('specimen line ' + seedLabel(S.seed) + ' — plate stamped.');
  if (REPLAY.on) {
    logLine('replay — same line, same cues, the tape run again.', true);
  }

  lastTs = 0; acc = 0;
  if (!raf) raf = window.requestAnimationFrame(frame);
}

function stopRun() {
  S.running = false;
  if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
}

function setPausedLabel(p) {
  var b = $('s-pause');
  if (b) b.textContent = p ? 'Resume' : 'Hold';
}

function setPaused(p) {
  if (!S.running || S.over) return;
  S.paused = !!p;
  $('pauseveil').classList.toggle('on', S.paused);
  setPausedLabel(S.paused);
}

function finish(won, reason) {
  if (S.over) return;
  S.over = true;
  S.running = false;
  S.failReason = reason;
  stopRun();
  ptr.down = false;

  /* A replay that runs all the way to its end is still only a viewing, and
     ends the way abandoning one does: the original plate and verdict come
     back. That distinction did not exist while every replay was the SAME run
     — it reached an identical result, so letting it overwrite the verdict
     changed nothing. A ghost is a different seed, and letting THAT overwrite
     put the ghost's stats, its final lattice and its share link under a
     heading the player had earned on another plate, with no way back:
     showResult had already replaced LAST_RESULT and FINAL_STATE, and
     REPLAY.on was cleared before it, so exitReplay could no longer undo it.
     Handled here rather than inside showResult so that the two ways out of a
     replay — running it out, and leaving early — are one path.

     Both halves of the condition are load-bearing. A ghost can be started on a
     page that has no original run behind it at all, and exitReplay restores
     nothing and paints nothing when the snapshot and the verdict it reads are
     absent — which left a finished dish on the bench under no panel, with
     Abandon the only way off it. With nothing to go back to, the replay's own
     verdict is the honest thing to show; it still writes nothing, because the
     save block below is gated on not being a replay. */
  if (REPLAY.on && LAST_RESULT && FINAL_STATE) { exitReplay(); return; }

  var e = S.exp;
  if (!REPLAY.on) {
    if (TRACE) TRACE.cues = S.cues;
    if (won) {
      var sc = runScore(e);
      if (S.via === VIA_DAILY) {
        /* The daily marks the day and nothing else. It is documented as
           advancing nothing, and it has to be: the daily ignores the unlock
           gate, so a daily win that also logged the dish would let anybody
           walk the whole schedule by playing one plate a day — or by opening
           #daily on a dish twelve places past where they had got to.

           Against the day the plate was LAUNCHED on, not the day it finished.
           A run started at 23:58 and won at 00:01 is a run of yesterday's
           dish on yesterday's seed; refreshing here and filing it under today
           would have credited today's entirely different plate with a score
           earned on another one, and the schedule would then have reported
           today's dish as already logged by somebody who had not seen it. */
        var dd = S.viaDay;
        var pd = (save.daily && save.daily.day === dd) ? (save.daily.score | 0) : 0;
        save.daily = { day: dd, score: Math.max(sc.score, pd) };
        S.logged = true;
      } else if (isUnlocked(S.idx)) {
        /* And a plate link is the same argument in the other direction: it
           bypasses the gate too, so it logs progress only for a dish the gate
           would have opened anyway. A link to a dish you have reached is just
           a run of it; a link past the gate is a look ahead, not a pass. */
        var prev = save.best[e.code];
        var rt2 = runClock();
        if (!prev || rt2 < prev) save.best[e.code] = rt2;
        save.done[e.code] = true;
        S.logged = true;
        /* The mark, and with it the ghost. They move together on purpose: the
           stored recording is meant to be the run the stored mark refers to,
           so a player replaying their best run watches the run that earned the
           number beside it rather than whichever one happened to be last. */
        /* hasOwnProperty, not `|| 0`: zero became a REACHABLE mark the moment
           the axes were cut to two. A run that holds the brush down for its
           whole length on a dish with no clock scores autonomy 0 and nothing
           else, which is exactly 0 — and `0 > 0` is false, so that win logged
           the dish while silently storing neither its mark nor its ghost, for
           good. It was unreachable under the four-axis version, which is why
           the idiom looked safe. */
        var had = save.score.hasOwnProperty(e.code) ? (save.score[e.code] | 0) : -1;
        if (sc.score > had) {
          save.score[e.code] = sc.score;
          /* A new best whose tape will not fit leaves the OLD recording where
             it is. Deleting it kept the mark and the ghost describing the same
             run, which was the tidier invariant and the wrong trade: it threw
             away a recording the player still had, to avoid a Best-run button
             that plays their second-best run instead of their best. A button
             that plays the wrong good run is a small lie; deleting the only
             copy of a run is data loss, and it fell hardest on the longest
             dishes, which are the ones worth watching again. */
          var g = TRACE ? encodeGhost(TRACE) : null;
          if (g && g.length <= GHOST_MAX) save.ghost[e.code] = g;
        }
      }
      writeSave();
    }
  }
  REPLAY.on = false;
  REPLAY.trace = null;
  setReplayUI(false);
  showResult(won);
}

/* ---------- result ----------
   Built into a plain object first, then painted. The split is what lets a
   replay be abandoned halfway: the ORIGINAL verdict is still sitting in
   LAST_RESULT and can be put back without re-deriving it from a run state
   that has since been overwritten. */
var LAST_RESULT = null;
var FINAL_STATE = null;

/* What a win is called. Three outcomes, because there are three: a schedule
   dish that was written to the log, the day's plate which is recorded against
   the day rather than the schedule, and a run that was deliberately not
   persisted at all. */
function wonHead() {
  if (S.via === VIA_DAILY) return 'Daily plate logged';
  return S.logged ? 'Result logged' : 'Result not logged';
}

function buildResult(won) {
  var e = S.exp;
  var body = won ? e.win : e.lose;
  if (!won && S.failReason === 'timeout') {
    body = 'The plate reached its scheduled end with the network incomplete. ' + e.lose;
  } else if (!won && S.failReason === 'starved') {
    body = 'The culture has starved. ' + e.lose;
  } else if (!won && S.failReason === 'ratio') {
    body = 'Nothing left on the plate could bring the ratio back into the band. ' + e.lose;
  } else if (!won) {
    body = e.lose;
  }

  var rows = [
    ['Elapsed', fmtTime(runClock())],
    ['Peak biomass', fmtNum(S.peak) + ' nuclei'],
    ['Final biomass', fmtNum(nAgents) + ' nuclei'],
    ['Nodes engulfed', S.engulfed + ' / ' + e.nodes.length],
    ['Cues emitted', fmtNum(S.cues)]
  ];
  if (e.hab) {
    rows.push(['Habituation reached', Math.round(S.habPeak * 100) + '%']);
    rows.push(['Time in contact', fmtTime(S.quinTime)]);
  }
  if (e.donor) rows.push(['Fusion', S.fused ? 'achieved' : 'never made contact']);
  if (e.diet) rows.push(['Diet', 'P ' + Math.round(S.dietP) + ' · C ' + Math.round(S.dietC) + ' · ratio ' + dietRatio()]);
  if (e.shocks) rows.push(['Dry shocks survived', String(S.shocksSurvived)]);
  /* The mark and what it was made of. Only on a win: the four axes are a
     reading of how a result was reached, and a culture that died on the agar
     did not reach one — scoring the pruning of a network that starved rather
     than withdrew would be flattering the wrong thing. */
  var sc = null;
  if (won) {
    sc = runScore(e);
    rows.push(['Mark', sc.score + ' / 100 · ' + sc.mark]);
    rows.push(['— autonomy', pct(sc.auto) + ' (run unsteered)']);
    if (sc.disp >= 0) rows.push(['— dispatch', pct(sc.disp) + ' (of the plate\'s clock)']);
  }
  if (won && save.best[e.code] != null) rows.push(['Best run', fmtTime(save.best[e.code])]);
  if (won && save.score.hasOwnProperty(e.code)) {
    rows.push(['Best mark', (save.score[e.code] | 0) + ' / 100']);
  }
    /* A link that reaches past the unlock gate wins a real run and writes
     nothing, by design — so it must not be told its result was logged. Going
     back to the schedule and finding no mark and no completion against a
     verdict that said "Result logged" is the kind of small lie that makes a
     player distrust every other number on the panel. */
  if (won && !S.logged) {
    rows.push(['Not logged', 'this plate is ahead of the schedule — log the dishes before it and it counts']);
  }

/* The plate's provenance, last, the way a notebook records it: this dish is
     reproducible from that number alone — SLIME.start(idx, '#a3f2c1') runs it
     again, cell for cell, at any time-lapse setting. It used to carry a swatch
     of itself, from when the seed set the colour the culture was grown in; it
     no longer sets it, and a swatch that no longer answers to the number
     beside it is worse than none. Every culture is the colour Physarum is. */
  rows.push(['Specimen line', seedLabel(S.seed)]);

  /* "Next experiment" is a schedule move, so it is offered only when there is
     a schedule position to move to. A daily plate has none — it is not in the
     schedule — and a run reached by either gate-bypassing route can sit twelve
     dishes past the gate, where the next dish is locked and the brief would
     open on something the player has not reached. Both fall back to Schedule. */
  var hasNext = won && S.idx < EXPERIMENTS.length - 1 &&
                S.via !== VIA_DAILY && isUnlocked(S.idx + 1);
  return {
    code: e.code + ' · ' + e.name,
    head: won ? wonHead() : 'Culture lost',
    body: body,
    rows: rows,
    idx: S.idx,
    /* the plate, addressable: the same dish and seed anyone else can open */
    link: runLink(S.idx, S.seed),
    nextText: hasNext ? 'Next experiment' : 'Schedule',
    nextMode: hasNext ? 'next' : 'menu'
  };
}

function paintResult(R) {
  $('r-code').textContent = R.code;
  $('r-head').textContent = R.head;
  $('r-body').textContent = R.body;

  var stats = $('r-stats');
  stats.innerHTML = '';
  for (var i = 0; i < R.rows.length; i++) {
    var d = document.createElement('div');
    var k = document.createElement('span');
    k.className = 'mono-dim';
    k.textContent = R.rows[i][0] + ' — ';
    d.appendChild(k);
    if (R.rows[i][2]) {
      var sw = document.createElement('span');
      sw.style.cssText = 'display:inline-block;width:10px;height:10px;margin-right:7px;' +
        'vertical-align:-1px;border:1px solid var(--line);background:' + R.rows[i][2];
      d.appendChild(sw);
    }
    d.appendChild(document.createTextNode(R.rows[i][1]));
    stats.appendChild(d);
  }

  var next = $('r-next');
  next.textContent = R.nextText;
  next.dataset.mode = R.nextMode;

  var note = $('r-tracenote');
  if (note) {
    note.textContent = (TRACE && TRACE.n)
      ? fmtNum(TRACE.n) + ' cue-steps recorded'
      : 'no cues recorded — the dish ran itself';
  }

  buildReplayRow(R.idx);

  SHARE_LINK = R.link || '';
  var sn = $('r-sharenote');
  if (sn) sn.textContent = SHARE_LINK.replace(/^[a-z]+:\/\//, '');
  var cp = $('r-copy');
  if (cp) cp.textContent = 'Copy link';
}

/* The link the copy button is currently offering. Held here rather than read
   back off the note element, so what gets copied is the URL and not whatever
   the note had to do to it to fit on one line. */
var SHARE_LINK = '';

/* Clipboard access is permission-gated, rejects asynchronously, and is absent
   outright on file:// in several browsers — which is not an exotic case here,
   because opening index.html directly IS the documented way to run this thing.
   So there are three rungs, and the button says which one it got to.

   The last rung matters more than it looks. The share note shows the link with
   its scheme trimmed off, because the full one is unreadable on a local file
   path; selecting THAT would hand over a URL missing its first seven
   characters. So the fallback writes the whole link back into the note before
   selecting it, and what the player copies is the thing that works. */
function copyShareLink() {
  var b = $('r-copy');
  if (!SHARE_LINK || !b) return;
  var ok = function () { b.textContent = 'Copied'; };
  var no = function () { b.textContent = selectShareLink() ? 'Selected — copy it' : 'Copy failed'; };
  try {
    if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(SHARE_LINK).then(ok, function () {
        /* the async rejection lands here: try the legacy path before giving up */
        if (legacyCopy()) ok(); else no();
      });
      return;
    }
  } catch (err) { /* fall through to the rungs below */ }
  if (legacyCopy()) ok(); else no();
}

/* Put the whole link in the note and select it. Returns whether a selection
   was actually made, so the caller knows which message to show. */
function selectShareLink() {
  var el = $('r-sharenote');
  if (!el || !window.getSelection || !document.createRange) return false;
  try {
    el.textContent = SHARE_LINK;
    var r = document.createRange();
    r.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  } catch (err) { return false; }
}

/* execCommand('copy') is deprecated and still the only thing that works on a
   file:// page in some browsers. It copies the current selection, so the
   selection above is the setup for it rather than merely a consolation. */
function legacyCopy() {
  if (!selectShareLink()) return false;
  try { return !!(document.execCommand && document.execCommand('copy')); }
  catch (err) { return false; }
}

/* The panel lives under the dish and shows without switching screens: the
   plate stays on the bench, halted on its last frame, and the verdict is
   pinned below it. */
function openResult() {
  var sim = $('scr-sim');
  if (sim) sim.classList.add('resulting');
  var el = $('result');
  if (el) el.classList.add('on');
  /* the dish is letterboxed while the panel is up, so the backing store has to
     follow the new CSS width or the final lattice renders at the wrong scale */
  resizeCanvas();
  render();
  updateHUD(true);
}

function closeResult() {
  var sim = $('scr-sim');
  if (sim) sim.classList.remove('resulting');
  var el = $('result');
  if (el) el.classList.remove('on');
}

function resultOpen() {
  var el = $('result');
  return !!el && el.classList.contains('on');
}

function showResult(won) {
  /* Snapshot what the finished dish looks like, so aborting a replay can put
     the ORIGINAL final lattice and HUD figures back under the verdict instead
     of leaving the replay's partial state on display. */
  /* copy EVERY field of S, not a hand-picked list — noteText/objText read a
     wide, growing set of them and each omission has been its own bug */
  var snap = {};
  for (var sk in S) snap[sk] = S[sk];
  snap.nodeProg = S.nodeProg ? S.nodeProg.slice() : null;
  snap.nodeDone = S.nodeDone ? S.nodeDone.slice() : null;
  /* The agents themselves, not just how many of them there were. The renderer
     draws the growing front from ax/ay/ah/atip, so restoring nAgents alone
     leaves that pass walking the ABANDONED REPLAY's agents — or, past the
     replay's own count, whatever was left in the arrays earlier in the run,
     since nothing clears them. The verdict would then sit under the right
     lattice with a scatter of whiskers belonging to a dish that no longer
     exists. Only the live prefix is worth copying; everything past nAgents is
     already dead. */
  FINAL_STATE = {
    trail: new Float32Array(trail),
    cueF: new Float32Array(cueF), retF: new Float32Array(retF),
    slimeF: new Float32Array(slimeF),
    /* the junction marks too: the lobe layer draws from them, so restoring
       the trail without them puts the finished network back under swellings
       belonging to the abandoned replay */
    knotF: new Float32Array(knotF),
    traceF: new Float32Array(traceF),
    /* and the two slow fields, which are part of what the plate IS rather
       than merely of how it looks: the conductivity is a floor under the
       trail on every step of diffuseTrail, and the scar is sensed. Restoring
       the finished dish's trail on top of an abandoned replay's conductivity
       leaves the exhibit's own field disagreeing with the field that would
       maintain it — harmless while the verdict is up, since a finished run
       does not step, and wrong the moment anything reads the plate, which
       the harness accessors do.
       flowF is deliberately not here. It is scratch the slow sweep zeroes
       every eight steps and nothing outside that sweep reads, so it has no
       more state worth restoring than tmpF does. */
    condF: new Float32Array(condF),
    scarF: new Float32Array(scarF),
    /* and the return signal with its shade, for the same reason as the
       conductivity: the harness reads them, and the finished plate's should
       be the finished plate's */
    fedF: new Float32Array(fedF), padF: new Float32Array(padF),
    bodyF: new Float32Array(bodyF), linkF: new Float32Array(linkF),
    shadeF: new Uint8Array(shadeF),
    n: nAgents,
    ax: ax.slice(0, nAgents), ay: ay.slice(0, nAgents),
    ah: ah.slice(0, nAgents), atip: atip.slice(0, nAgents),
    logHTML: $('log').innerHTML,
    turbo: TURBO,
    S: snap
  };
  LAST_RESULT = buildResult(won);
  paintResult(LAST_RESULT);
  openResult();
  /* the highlight layer's memory, added to the snapshot once openResult's own
     render has drawn the frame it belongs to — see snapshotVeinTemporal */
  snapshotVeinTemporal(FINAL_STATE);
}

/* ------------------------------------------------------------
   16. main loop
   ------------------------------------------------------------ */
function frame(ts) {
  raf = window.requestAnimationFrame(frame);
  if (!lastTs) lastTs = ts;
  var dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.25) dt = 0.25;

  if (S.running && !S.paused) {
    acc += dt * TURBO;
    /* Four frames' worth of headroom at whatever the multiplier is, so a
       dropped frame is caught up rather than lost. A held brush is painted
       once per STEP, not once per frame — that is what keeps a cued run
       identical between speeds.

       Never less than one step, because below ×1/4 four frames' worth is a
       FRACTION of a step: at ×1/16 the count comes out at 0.25, the loop's
       `steps < budget` is false before it has run anything, and the dish never
       advances at all. The floor binds at exactly two stops — ×1/8 and ×1/16 —
       and costs nothing at either, since down there a step falls due every
       eighth or sixteenth frame and a frame has at most one to spend. */
    var steps = 0, budget = Math.max(1, Math.ceil(4 * TURBO));
    var boxT0 = performance.now(), boxed = false;
    while (acc >= DT && steps < budget && S.running &&
           (!stepTarget || stepsRun < stepTarget)) {
      /* Replay drives the brush from the tape; a played run records what the
         brush actually was. Either way the paint call below is the same one,
         so what is recorded is precisely what the sim consumed. */
      if (REPLAY.on) feedTrace(stepsRun);
      /* The reserve is stepped from what the player ASKED for, and the brush
         is painted only if it could be afforded. What goes into the trace is
         the ask, not the outcome: a replay re-runs this same accounting over
         the same steps and denies the same ones, so recording the outcome
         would store a decision the replay is about to make for itself — and
         store it in a form that could not survive a change to the rates. */
      var want = ptr.down;
      if (cueTick(want, ptr.mode)) paintBrush(ptr.gx, ptr.gy, ptr.mode);
      if (want && !REPLAY.on) recordBrush(stepsRun, ptr.mode, ptr.gx, ptr.gy);
      step(); stepsRun++; acc -= DT; steps++;
      /* Checked after the step rather than before it, so a frame always makes
         progress: a box smaller than a single step still runs one, and the
         loop cannot livelock stepping nothing on a slow enough machine. The
         clock read is tens of nanoseconds against a step's two milliseconds. */
      if (performance.now() - boxT0 >= STEP_MS) { boxed = true; break; }
    }
    /* Backlog past what this frame could actually run is dropped: a device
       that cannot keep up runs fewer steps per real second rather than
       spiralling. It changes how far a run gets in a given wall-clock second,
       never what any step does — steps still execute in order at a fixed DT,
       and two runs of a seed that have run the same number of them still hold
       the same dish.

       The box has to drop it too, and for the same reason the count does. Left
       to accumulate, a backlog the box refuses to spend this frame is still
       there next frame, so the dish stutters forward in bursts whose size is
       set by how far behind it has fallen — which is the spiral the drop is
       here to prevent, wearing the box as a disguise.

       Only when there IS a backlog, though, and `boxed` alone does not say
       there is one. The box is tested after the step and after acc -= DT, so
       a frame that ran its last due step and only then crossed the deadline
       sets it with acc already below DT. What is left there is not a backlog:
       it is the sub-step remainder a fixed timestep runs on, the fraction of a
       DT that carries into the next frame and becomes a whole step a few
       frames later. Zeroing that discards sim time the frame fully intended to
       spend, and discards it again every frame the deadline lands in the same
       place — a slow drift, not a dropped burst, and one that only ever runs
       the dish slower than the multiplier asks.

       It is a small number at the box this ships with and not a small one in
       general. Counted over six seconds at x12 and STEP_MS 20, the box closed
       on 162 frames and not one of them had an empty accumulator; at x4 it
       closed on five, four of them empty, worth 11ms of sim time a second
       against the 4000 that speed is asking for. Wind the box down to 16ms and
       it closes on 51 frames at x4 with 39 empty, worth 82ms a second — half a
       per cent of the rate, then two per cent. The guard is here because a
       fixed-timestep accumulator must not throw its remainder away, not
       because two per cent was visible. */
    if ((boxed && acc >= DT) || acc > DT * budget) acc = 0;
    if (PROF) { profStep += performance.now() - boxT0; profSteps += steps; }
    if (stepTarget && stepsRun >= stepTarget && S.running && !S.over) {
      /* one-shot: consume the target so Resume resumes and later runs run */
      stepTarget = 0;
      setPaused(true);
    }
  } else {
    acc = 0;
  }

  if (PROF) {
    var pr0 = performance.now(), pb1 = profBuild;
    render();
    /* the rebuild inside it is counted on its own line, so it is taken back
       out of the composite's */
    profComp += performance.now() - pr0 - (profBuild - pb1);
    profFrames++;
    profTick(performance.now());
  } else {
    render();
  }
  updateHUD();

  if (!S.running && raf) { window.cancelAnimationFrame(raf); raf = 0; }
}

/* ------------------------------------------------------------
   17. input
   ------------------------------------------------------------ */
/* Pointer position, in grid cells, snapped to CUE_Q steps of a cell.

   The snap is what makes a run STORABLE. A trace is the whole recording of a
   run, and an arbitrary double per axis per step is 16 bytes that compress to
   nothing; snapped, the same position is two Int16s and a ghost fits in a
   browser's storage instead of overflowing it. The quantum is a sixteenth of
   a cell — on the widest plate the sheet allows, about a tenth of a screen
   pixel, which is below the resolution of the pointer that produced it.

   It is applied HERE, at the one place a position enters the program, rather
   than on the way into storage. Snapping on the way to disk would mean a
   stored ghost replayed from slightly different numbers than the run it was
   recorded from, and the dish is chaotic enough that "slightly different" is
   a different dish by the end of it. Snapped at the source, the live run, the
   in-memory trace and the stored ghost all carry the same numbers, and the
   contract the replay rests on — same bits in, same dish out — holds across
   all three. */
function snapQ(v) { return Math.round(v * CUE_Q) / CUE_Q; }

function toGrid(ev) {
  var r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  var gx = (ev.clientX - r.left) / r.width * GW;
  var gy = (ev.clientY - r.top) / r.height * GH;
  return { x: snapQ(clamp(gx, 0, GW - 1)), y: snapQ(clamp(gy, 0, GH - 1)) };
}

function endGesture() {
  downIds.length = 0;
  primaryId = null;
  ptr.down = false;
}

function bindInput() {
  var stage = $('stage');

  stage.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  /* Pinch-zoom is not covered by touch-action on iOS: Safari runs the page
     zoom off its own gesture events, and zooms a surface that has opted out of
     every touch behaviour there is. On a normal page that is a minor nuisance.
     Here two fingers on the dish is a game verb — retract — so every retract
     was also a pinch, and the player came out of it looking at a quarter of
     the plate with no way back except pinching out again by hand.

     Blocked on the dish and on what lies directly under it — the dish log,
     and the control row under that — which is where a second finger lands when
     it falls short of the plate; NOT on the page,
     because a player who wants to zoom the schedule or read the brief closer
     is doing something reasonable and 1.4.4 says they get to. gesture* are WebKit-only — nothing else fires
     them, so the listeners cost those browsers nothing. */
  var GESTURES = ['gesturestart', 'gesturechange', 'gestureend'];
  var noZoom = function (ev) { ev.preventDefault(); };
  /* The log is on this list because it is what a finger short of the plate
     now meets: it sits between the bench and the row. Two fingers there is a
     pinch to block, and blocking it costs the log nothing — the handler below
     only preempts a multi-touch move, so a one-finger scroll through the older
     lines still works. */
  var surfaces = [stage, $('feed'), $('controls')], si, gi;
  for (si = 0; si < surfaces.length; si++) {
    if (!surfaces[si]) continue;
    for (gi = 0; gi < GESTURES.length; gi++) {
      surfaces[si].addEventListener(GESTURES[gi], noZoom, { passive: false });
    }
    /* and for the engines that route a two-finger drag through touch events
       instead: touch-action already asks for this, the listener is what makes
       it true where the ask is ignored */
    surfaces[si].addEventListener('touchmove', function (ev) {
      if (ev.touches && ev.touches.length > 1) ev.preventDefault();
    }, { passive: false });
  }

  stage.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'touch') markTouch();
    if (!S.running) return;
    /* a replay is a recording being played: the tape owns the brush, and a
       finger on the dish must not write over what it is showing */
    if (REPLAY.on) return;
    /* the veil owns its own taps; nothing else inside the stage is clickable */
    if (ev.target && ev.target.id === 'pauseveil') return;

    if (downIds.indexOf(ev.pointerId) < 0) downIds.push(ev.pointerId);

    /* second finger down while a drag is live: that drag becomes a retract,
       and the brush stays with the first finger. */
    if (ptr.down && ev.pointerId !== primaryId) {
      if (ev.pointerType === 'touch') ptr.mode = 2;
      ev.preventDefault();
      return;
    }

    var g = toGrid(ev);
    if (!g) return;
    ev.preventDefault();
    if (ev.pointerType === 'touch') {
      ptr.mode = (downIds.length > 1) ? 2 : 1;
    } else {
      ptr.mode = (ev.button === 2 || ev.shiftKey || ev.ctrlKey) ? 2 : 1;
    }
    ptr.down = true;
    primaryId = ev.pointerId;
    ptr.gx = g.x; ptr.gy = g.y;
    if (ptr.mode === 1) S.cues++;
    try { stage.setPointerCapture(ev.pointerId); } catch (err) { /* not fatal */ }
  });

  window.addEventListener('pointermove', function (ev) {
    if (!ptr.down || REPLAY.on) return;
    if (primaryId !== null && ev.pointerId !== primaryId) return;
    var g = toGrid(ev);
    if (!g) return;
    ev.preventDefault();
    ptr.gx = g.x; ptr.gy = g.y;
  }, { passive: false });

  function release(ev) {
    /* the tape owns ptr.down during a replay — a stray pointerup must not
       lift a brush the recording says is held */
    if (REPLAY.on) { downIds.length = 0; primaryId = null; return; }
    if (ev && ev.pointerId != null) {
      var k = downIds.indexOf(ev.pointerId);
      if (k >= 0) downIds.splice(k, 1);
      try { stage.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
      /* the gesture ends when the last finger leaves, so a two-finger retract
         does not snap back to grow when the second finger lifts first */
      if (downIds.length === 0) { ptr.down = false; primaryId = null; }
      else if (ev.pointerId === primaryId) primaryId = downIds[0];
      return;
    }
    endGesture();
  }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', endGesture);

  document.addEventListener('keydown', function (ev) {
    if (!$('scr-sim').classList.contains('on')) return;
    /* A focused button already answers Space and Enter itself; handling them
       here as well would fire the control twice. A <summary> — the key list's
       disclosure — answers both the same way, so it counts as one. */
    var t = ev.target, tag = t && t.tagName;
    var onBtn = tag === 'BUTTON' || tag === 'SUMMARY';

    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
      /* the primary action of the verdict panel: on with the schedule */
      if (resultOpen() && !onBtn) { ev.preventDefault(); $('r-next').click(); }
    } else if (ev.code === 'Space') {
      if (onBtn) return;
      ev.preventDefault();
      setPaused(!S.paused);
    } else if (ev.code === 'KeyF') {
      ev.preventDefault();
      /* Shift walks the ladder back down. It is the retract modifier on the
         plate and nothing here, so the two never meet. */
      cycleSpeed(ev.shiftKey);
    } else if (ev.code === 'KeyR') {
      /* R is always a fresh dish — a new seed, a new recording — whether it is
         pressed mid-run, mid-replay, or over the verdict */
      ev.preventDefault();
      restartRun();
    } else if (ev.code === 'Escape') {
      ev.preventDefault();
      /* Escape reads as "close the thing that is open", innermost first: the
         key list, then the replay, and only then the dish itself. */
      if (closeKeys()) return;
      if (REPLAY.on) exitReplay();
      else goTitle();
    }
  });

  /* The key list is a panel floating over the bench, so anything else the
     hand does — including the first cue laid on the dish — puts it away. */
  document.addEventListener('pointerdown', function (ev) {
    var k = $('keypop');
    if (k && k.open && !k.contains(ev.target)) k.open = false;
  }, true);

  window.addEventListener('resize', function () {
    if (!$('scr-sim').classList.contains('on')) return;
    resizeCanvas();
    /* Resizing reallocates the backing store, which clears it. A running dish
       redraws on the next frame; a finished one has no next frame, so the
       final lattice has to be repainted here or the plate goes black under
       the verdict. */
    if (!S.running) render();
  });
}

/* ------------------------------------------------------------
   18. wiring + boot
   ------------------------------------------------------------ */
function bindButtons() {
  $('b-go').addEventListener('click', function () { startRun(briefIdx); });
  $('b-back').addEventListener('click', goTitle);
  /* Reset, Abandon and Exit replay sit inside the Controls disclosure, so each
     of them has to put it away on the way out — the outside-click handler that
     normally closes it deliberately ignores clicks the panel contains, which
     would otherwise leave it hanging open over a dish it just restarted. */
  $('s-abort').addEventListener('click', function () { closeKeys(); goTitle(); });
  $('s-pause').addEventListener('click', function () { setPaused(!S.paused); });
  $('s-reset').addEventListener('click', function () { closeKeys(); restartRun(); });
  /* Wrapped rather than passed straight through: cycleSpeed takes a
     direction, and a click handler called with the event would hand it a
     truthy object and walk the ladder backwards. */
  $('s-speed').addEventListener('click', function () { cycleSpeed(false); });
  $('s-exitrp').addEventListener('click', function () { closeKeys(); exitReplay(); });
  /* addListener is the pre-2021 Safari spelling; the modern one is preferred
     where it exists, and neither is worth a failed boot if the browser has
     matchMedia but neither hook. */
  var mq = [DOCK, TOUCH_W], mi;
  for (mi = 0; mi < mq.length; mi++) {
    if (!mq[mi]) continue;
    if (mq[mi].addEventListener) mq[mi].addEventListener('change', dockActions);
    else if (mq[mi].addListener) mq[mi].addListener(dockActions);
  }
  /* Retry is a new plate on a schedule dish and the SAME plate on a daily or
     a link — restartRun decides which, so all three restart controls agree. */
  $('r-retry').addEventListener('click', restartRun);
  $('r-menu').addEventListener('click', goTitle);
  $('r-next').addEventListener('click', function () {
    /* isUnlocked is re-tested rather than trusted from the dataset: the button
       was labelled when the verdict was painted, and a replay leaving through
       exitReplay repaints it from a result built earlier in the run's life. */
    if (this.dataset.mode === 'next' && S.idx < EXPERIMENTS.length - 1 &&
        isUnlocked(S.idx + 1)) {
      stopRun();
      closeResult();
      openBrief(S.idx + 1);
    } else {
      goTitle();
    }
  });
  $('btn-wipe').addEventListener('click', function () {
    if (!window.confirm('Wipe the specimen log? All logged runs, marks and recorded best runs are lost.')) return;
    save.done = {}; save.best = {}; save.score = {}; save.ghost = {}; save.daily = null;
    try { window.localStorage.removeItem(SAVE_KEY); } catch (err) { /* nothing to remove */ }
    renderTitle();
  });
  $('r-copy').addEventListener('click', copyShareLink);
  /* The daily bypasses the gate, so it starts a run rather than opening a
     brief: there is no schedule position to arrive at. */
  $('daily-go').addEventListener('click', function () {
    if (!refreshDaily()) return;
    pendingVia = VIA_DAILY; pendingViaDay = DAILY.day;
    startRun(DAILY.idx, DAILY.seed);
  });
  /* A link pasted into the bar of a page that is already open changes the
     fragment without reloading, so the fragment has to be watched and not only
     read at boot. Unconditionally: nothing in the file ever writes the
     fragment itself — runLink only builds the string the copy button hands
     over — so every change to it is somebody asking to go there, including
     while a dish is running. A fragment that names no dish routes nowhere and
     leaves the screen alone, which is what makes an edited or truncated link
     harmless rather than a way to lose a live plate. */
  window.addEventListener('hashchange', routeHash);
  buildReplayRow(null);
}

/* The replay control: three of the rates the time-lapse button cycles (see
   REPLAY_SPEEDS), offered as one button each because from the verdict you are
   choosing how long to spend watching, not stepping through a cycle. ×4 is the
   suggested rate — fast enough to be a recap, slow enough to see the front
   move. The dial's slow stops are still there once the replay is running; they
   are just not what the question "how long is this recap" is asking.

   Rebuilt per verdict rather than once at boot, because the row now ends in a
   button that only some dishes have: the best run on record, where one is
   stored. It is offered even when the run just finished IS that best run —
   the ghost is written before the verdict is painted — because the alternative
   is a button that appears and disappears depending on whether you have just
   beaten yourself, and pressing it then simply replays the run under it. */
function buildReplayRow(idx) {
  var box = $('r-replay');
  if (!box) return;
  box.innerHTML = '';
  for (var i = 0; i < REPLAY_SPEEDS.length; i++) {
    (function (sp) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost rsp' + (sp === 4 ? ' def' : '');
      b.textContent = '×' + fmtSpeed(sp);
      b.setAttribute('aria-label', 'Replay this run at ' + fmtSpeed(sp) +
        ' times the dish clock — about ' + realX(sp) + ' times real time');
      b.addEventListener('click', function () { startReplay(sp); });
      box.appendChild(b);
    })(REPLAY_SPEEDS[i]);
  }
  if (idx == null || !hasGhost(idx)) return;
  var g = document.createElement('button');
  g.type = 'button';
  g.className = 'btn ghost rsp';
  g.textContent = 'Best run';
  g.setAttribute('aria-label', 'Replay the best run on record for this dish');
  g.addEventListener('click', function () { startGhost(idx, 4); });
  box.appendChild(g);
}

/* Play back the stored best run for a dish. It is the ordinary replay path
   with a trace that came off disk instead of out of this session — the plate
   it builds is the ghost's own seed, which is a different dish from the one
   under the verdict and is meant to be: the point of watching it is that it is
   the run that scored. Leaving it early restores the verdict's own plate the
   way leaving any other replay does. */
function startGhost(i, sp) {
  /* No provenance staged, deliberately: a stored ghost is a recording of some
     earlier run on its own seed, not the plate the player is currently on, so
     restarting out of one gives a fresh plate of that dish rather than
     pretending the ghost's seed was today's assignment. */
  var t = ghostFor(i);
  if (!t) {
    /* Filed but unreadable — a save edited by hand, or written by a build that
       spelled the format differently. hasGhost only knows that a string is on
       file, so the button was offered on the strength of that; rather than
       leave a control that does nothing when pressed, drop the entry and take
       the button away with it. */
    if (save.ghost[EXPERIMENTS[i].code]) {
      delete save.ghost[EXPERIMENTS[i].code];
      writeSave();
      if (LAST_RESULT) buildReplayRow(LAST_RESULT.idx);
    }
    return false;
  }
  startRun(t.idx, t.seed, t);
  setSpeed(sp || 4);
  return true;
}

function init() {
  loadSave();
  refreshDaily();
  if (detectCoarse()) markTouch();
  initCanvas();
  bindInput();
  bindButtons();
  dockActions();
  setSpeed(1);
  renderTitle();
  show('scr-title');
  /* A fragment naming a dish opens it; anything else — including nothing —
     leaves the schedule up. The title screen is rendered either way so that
     leaving a linked plate arrives somewhere already built. */
  routeHash();

  /* read-only handle for the harness; nothing in the game reads it back */
  window.SLIME = {
    S: S, ptr: ptr,
    isTouch: function () { return TOUCH; },
    agents: function () { return nAgents; },
    /* how many of them are at the front — the population forkTip draws from */
    tips: function () { var c = 0; for (var k = 0; k < nAgents; k++) if (atip[k]) c++; return c; },
    /* the bridge layer as drawn: 1 where this rebuild routed a corridor.
       Differenced across rebuilds it answers whether the flashes of large
       regions are bridges — corridors qualify whole per rebuild, so they are
       the one layer that can flip a big connected area at once. */
    bridgeMap: function () { return new Uint8Array(bridge); },
    /* how the emitted runs distribute over the presence tiers — the number
       that says whether steady tissue is reaching full strength (it must sit
       overwhelmingly in the last tier at x1) and whether blinks are being
       caught quiet (the churn arrives in the first) */
    tierHist: function () {
      var veins = [0, 0, 0], lobes = [0, 0, 0], b2, r2, e2, c2;
      for (b2 = 0; b2 < vsegN.length; b2++) {
        var a2 = vseg[b2]; e2 = vsegN[b2]; r2 = 0;
        while (r2 < e2) {
          var t2 = a2[r2++] | 0;
          c2 = a2[r2++] | 0;
          veins[t2] += c2;
          r2 += c2 * 2;
        }
      }
      for (r2 = 0; r2 < lsegN; r2++) lobes[lbuck[r2]]++;
      return { veins: veins, lobes: lobes };
    },
    /* runs and points in the vein trace of the last painted frame — how far
       the ridge walk gets before it loses the vein. These are presence-tier
       RUNS since the envelope split chains at tier boundaries, so the count is
       an upper bound on chains rather than the thing itself. */
    veinIslands: function () { return veinIslands; },
    /* the backbone, as copies, for the harness */
    tree: function () {
      var live = 0, wmax = 0, tips = 0;
      for (var i = 0; i < tN; i++) { if (tstate[i]) { live++; if (tw[i] > wmax) wmax = tw[i]; if (tkids[i] === 0) tips++; } }
      var joins = 0, carry = 0; for (var q = 0; q < tN; q++) { if (tjoin[q] >= 0 && tstate[q]) joins++; if (tcarry[q] > 0 && tstate[q]) carry++; }
      return { n: tN, live: live, tips: tips, wmax: wmax, ms: treeMs, passes: treePasses, joins: joins, carry: carry,
               x: tx.slice(0, tN), y: ty.slice(0, tN), par: tpar.slice(0, tN), w: tw.slice(0, tN), state: tstate.slice(0, tN) };
    },
    /* the pinned graph, as copies: the harness differences two samples to
       check that no point ever moves, and reads the attachments to check
       that no vein was pinned adrift. att is four per vein — [vein,
       point, vein, point] for the two ends, vein -1 unattached, -2 the
       core. flow is the eased measure the band is read from. */
    veinGraph: function () {
      return { n: veinN, start: vStart.slice(0, veinN), count: vCount.slice(0, veinN),
               px: vpx.slice(0, vpN), py: vpy.slice(0, vpN),
               band: vBand.slice(0, veinN), state: vState.slice(0, veinN),
               flow: vFlow.slice(0, veinN), born: vBorn.slice(0, veinN), att: vAtt.slice(0, veinN * 4),
               settle: VEIN_SETTLE, r: VEIN_R, snap: VEIN_SNAP, minlen: VEIN_MINLEN };
    },
    /* the pass-one maps the graph pins from, as copies, with the clock
       they are read against: where the ridges are, when each cell became
       one, and what the graph already covers */
    /* the phase timings above, as ms per rebuild since last read; zeros
       without ?prof */
    veinProf: function () {
      var n = profVeinN || 1, o = { rebuilds: profVeinN, trace: profVein[0] / n, dist: profVein[1] / n,
        pass1: profVein[2] / n, pass2: profVein[3] / n, widths: profVein[4] / n, bake: profVein[5] / n };
      profVein.fill(0); profVeinN = 0;
      return o;
    },
    ridgeMaps: function () {
      return { rdir: new Uint8Array(rdir), rage: new Float32Array(rage), vcov: new Uint8Array(vcov),
               bodyV: new Float32Array(bodyV), bodyD: new Float32Array(bodyD), simT: S.simT };
    },
    veins: function () {
      var ch = 0, pt = 0;
      /* under the body the lines are the graph, and these are its veins */
      if (BODY) return { chains: veinN, points: vpN, mean: veinN ? +(vpN / veinN).toFixed(2) : 0 };
      for (var b = 0; b < vsegN.length; b++) {
        var r = 0, end = vsegN[b];
        while (r < end) { r++; var c = vseg[b][r++]; ch++; pt += c; r += c * 2; }
      }
      return { chains: ch, points: pt, mean: ch ? +(pt / ch).toFixed(2) : 0 };
    },
    /* the drawn vein layer as a band index per cell, 255 for unlit — read back
       out of the same arrays strokeVeins strokes, so it is what is on the
       plate and not a parallel accounting of it. Two consecutive samples
       differenced give the churn of the highlight layer, which is the thing
       "twitchy" names. */
    veinMap: function () {
      var m = new Uint8Array(NCELL);
      m.fill(255);
      /* under the body the drawn lines are the graph, not the runs: each
         point's cell takes its vein's band while live, 200 while record */
      if (BODY) {
        for (var gv = 0; gv < veinN; gv++) {
          var gs = vStart[gv], ge = gs + vCount[gv];
          for (var gp = gs; gp < ge; gp++) {
            var gc = (vpy[gp] | 0) * GW + (vpx[gp] | 0);
            if (gc >= 0 && gc < NCELL) m[gc] = (vState[gv] && vpLive[gp]) ? vBand[gv] : 200;
          }
        }
        return m;
      }
      /* masses first and crests over them, the order strokeVeins draws in, so
         the difference of two samples is the churn of the composite the eye
         is actually looking at */
      for (var l = 0; l < lsegN; l++) {
        var lx = lseg[l * 2] | 0, ly = lseg[l * 2 + 1] | 0;
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var mx = lx + ox, my = ly + oy;
            if (mx >= 0 && my >= 0 && mx < GW && my < GH) m[my * GW + mx] = 100;
          }
        }
      }
      for (var b = 0; b < vsegN.length; b++) {
        var a = vseg[b], end = vsegN[b], r = 0;
        while (r < end) {
          r++;                       /* the run's presence tier — not a cell */
          var c = a[r++];
          for (var q = 0; q < c; q++) {
            var cx = a[r + q * 2] | 0, cy = a[r + q * 2 + 1] | 0;
            if (cx >= 0 && cy >= 0 && cx < GW && cy < GH) m[cy * GW + cx] = b;
          }
          r += c * 2;
        }
      }
      return m;
    },
    prog: function () { return S.nodeProg ? Array.prototype.slice.call(S.nodeProg) : []; },
    front: function () {
      if (!nAgents) return null;
      var sx = 0, sy = 0, c = 0;
      for (var k = 0; k < nAgents; k += 5) { sx += ax[k]; sy += ay[k]; c++; }
      return { x: sx / c, y: sy / c };
    },
    grid: function () { return { w: GW, h: GH }; },
    /* harness only: the body test as it last stood — agents off the body,
       and how many islands of five or more agents are standing off it */
    body: function () {
      var off = 0, i, n = 0, cnt = {};
      for (i = 0; i < nAgents; i++) {
        var c = (ay[i] | 0) * GW + (ax[i] | 0);
        if (mainC[c]) continue;
        off++;
        var l = connLab[c];
        if (l) cnt[l] = (cnt[l] || 0) + 1;
      }
      for (var key in cnt) if (cnt[key] >= 5) n++;
      var st = 0; for (i = 0; i < nAgents; i++) if (agoal[i]) st++;
      return { ok: mainOK, off: off, islands: n, streaming: st };
    },
    /* a copy of the trail field, for measuring the network from outside */
    trail: function () { return Float32Array.prototype.slice.call(trail); },
    trailMax: function () { return TRAIL_MAX; },
    /* The two slow fields, for a harness measuring whether the network has a
       skeleton: conductivity is which tubes are being maintained right now,
       the scar is where tubes have been. Copies, like trail() — nothing in
       the game reads either of them back. */
    cond: function () { return Float32Array.prototype.slice.call(condF); },
    scar: function () { return Float32Array.prototype.slice.call(scarF); },
    /* the return signal, the body signal, the connection they make and its
       shade — see the return-signal block */
    fed: function () { return Float32Array.prototype.slice.call(fedF); },
    bodySig: function () { return Float32Array.prototype.slice.call(bodyF); },
    linkSig: function () { return Float32Array.prototype.slice.call(linkF); },
    shade: function () { return new Uint8Array(shadeF); },
    /* sim seconds per real second — the DISH clock, which is itself about
       REAL_X times life. Same path the on-screen control uses, so the button
       label and HUD follow a harness that sets it directly, and fractional
       rates are taken as given rather than rounded onto a whole number. */
    turbo: function (n) { if (n != null) setSpeed(n); return TURBO; },
    speeds: function () { return SPEEDS.slice(); },
    /* the estimated real-time factor of ×1, for a caption that has to agree
       with the one the buttons print */
    realX: function () { return REAL_X; },
    /* the seed of the current run, raw and as the notebook prints it */
    seed: function () { return S.seed; },
    seedLabel: function () { return seedLabel(S.seed); },
    /* the tissue tone the plate is painted in, after the contrast guard */
    tint: function () { return hexOf(TINT); },
    hab: function () { return S.hab; },
    diet: function () { return { p: S.dietP, c: S.dietC }; },
    engulfed: function () { return S.engulfed; },
    shocks: function () { return S.shocksSurvived; },
    /* sim steps executed this run — the axis determinism is defined over */
    steps: function () { return stepsRun; },
    /* harness only: pause once exactly n steps have run (0 clears it), so two
       runs at different speeds can be compared on the same step rather than
       on whichever step their frames happened to land on */
    runTo: function (n) { stepTarget = Math.max(0, n | 0); return stepTarget; },
    start: function (i, seed) {
      startRun(clamp(i | 0, 0, EXPERIMENTS.length - 1), seed);
      return S.seed;
    },
    /* the cue reserve as the meter reads it, plus the raw seconds either side
       of it — held is what the autonomy axis divides, res is what the brush
       spends, and a test that cannot see both cannot tell a drain from a
       refusal to paint */
    cue: function () {
      return { res: S.cueRes, held: S.cueHeld,
               cap: cueCapOf(S.exp), frac: cueFrac() };
    },
    /* the four axes and the mark, for the run as it stands. Live, not only at
       the verdict: a harness watching it move is how the axes were calibrated. */
    score: function () { return S.exp ? runScore(S.exp) : null; },
    /* today's plate, and the link that addresses any plate */
    daily: function () {
      return DAILY ? { day: DAILY.day, idx: DAILY.idx, seed: DAILY.seed,
                       label: seedLabel(DAILY.seed), done: dailyDone(),
                       score: dailyScore() } : null;
    },
    link: function () { return S.idx >= 0 ? runLink(S.idx, S.seed) : ''; },
    /* the ghost store, addressable: encode round-trips the live trace, play
       replays what is filed for a dish, and has says whether anything is */
    ghost: {
      encode: function () { return TRACE ? encodeGhost(TRACE) : null; },
      decode: function (str) {
        var t = decodeGhost(str);
        return t ? { idx: t.idx, seed: t.seed, n: t.n, cues: t.cues } : null;
      },
      has: function (i) { return hasGhost(i); },
      play: function (i, sp) { return startGhost(i, sp); }
    },
    /* recorded brush-steps of the last played run (0 for an idle run) */
    trace: function () { return TRACE ? TRACE.n : 0; },
    /* replay that run at the given rate; false if there is nothing to replay */
    replay: function (sp) { return startReplay(sp); },
    replaying: function () { return REPLAY.on; },
    exitReplay: exitReplay,
    resultOpen: resultOpen,
    experiments: function () {
      var out = [];
      for (var i = 0; i < EXPERIMENTS.length; i++) {
        out.push({ code: EXPERIMENTS[i].code, name: EXPERIMENTS[i].name,
                   nodes: EXPERIMENTS[i].nodes.length });
      }
      return out;
    }
  };
}

/* The palette, once, for the life of the page: the field's transfer, the vein
   bands, the brush strokes and the CSS accent all come out of this one call.
   It used to run per run, because the seed picked the colour; nothing about
   it varies now, so it runs here — after VEIN_BANDS exists for hotBandK to
   read, and before init paints anything. */
applyPalette();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
