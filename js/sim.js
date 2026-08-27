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
   The run seed is printed as a hex colour, so the organism is grown in that
   colour. Which means a seed can name any colour at all, including ones that
   vanish against a nearly black dish or turn the dark-on-accent buttons into
   mud. Everything below exists so the specimen line can own the palette
   without the palette becoming unreadable: contrast is COMPUTED against the
   real backgrounds and the lightness is walked until it clears the bar.
   Pure arithmetic, no draws — the tint must not perturb the sim stream. */
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
function mixWhite(c, k) {
  return [Math.round(c[0] + (255 - c[0]) * k),
          Math.round(c[1] + (255 - c[1]) * k),
          Math.round(c[2] + (255 - c[2]) * k)];
}
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
function markTouch() {
  if (TOUCH) return;
  TOUCH = true;
  document.body.classList.add('touch');
}

/* ------------------------------------------------------------
   1. simulation constants
   ------------------------------------------------------------ */
var GW = 420, GH = 260, NCELL = GW * GH;   // internal grid resolution
var MAXA = 14000;                          // hard agent ceiling (typed array size)
var DT = 1 / 60;                           // fixed sim timestep

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

var HAZ_HEAT = 9.0;    // repulsion of a heat zone
var HAZ_QUIN = 5.2;    // repulsion of a quinine zone (scaled by 1 - habituation)

/* Extracellular slime. A plasmodium leaves a non-living mat behind it and will
   not re-search ground that carries one — memory held outside the organism
   rather than inside it, which is the only kind it has. It never decays: that
   is the point. Deposit is small because every agent lays it every step,
   moved or blocked, so a front crossing once is enough to mark the ground. */
var SLIME_DEP = 0.015;

var SPENT_FOOD = 0.30; // an engulfed node's remaining pull (a refuge, not a beacon)
var SPENT_FALL = 34;   // and only over this reach, so spent food cannot outbid fresh
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
var ENGULF_SOFT = 0.13;
var ENGULF_DECAY = 0.0022; // an abandoned node re-forms: commit, or lose the ground

/* ------------------------------------------------------------
   2. the five experiments
   ------------------------------------------------------------ */
var BORDER = [[0, 0, GW, 8], [0, GH - 8, GW, 8], [0, 0, 8, GH], [GW - 8, 0, 8, GH]];

var EXPERIMENTS = [
  {
    code: 'EXP-01', name: 'FIRST CONTACT',
    blurb: 'Open agar, four oat flakes, no complications. Find out which way is out.',
    brief: 'The dish is fresh, the agar is clean, and someone has arranged four oat flakes around you with the care of a person laying a table. You have no mouth and no plan — only a growing front that moves toward whatever smells like sugar. Spread until you have all four.',
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
    timeLimit: 0, hab: false, shocks: false,
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
    brief: 'Nakagaki, 2000. They cut a maze into the agar, put food at two ends, and waited to see whether a thing with no nervous system would find the shortest path between them. You did. They published. Do it again — the dish drains faster this time, so wandering has a price.',
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
    brief: 'Tero, 2010. Oat flakes placed where Tokyo keeps its stations, one inoculation dropped where the city keeps its centre. Within a day the network you grew was, by the paper’s own measure, about as efficient as the rail system it was compared against. Nobody has told the trains.',
    obj: 'Engulf all nine depots before the dish times out.',
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
    brief: 'Boisseau, 2016. Between you and the food they have poured two strips of quinine — bitter, deeply unpleasant, and entirely harmless. You do not know that yet, and the first crossings will cost you cytoplasm. The meter tracks how long it takes you to stop caring.',
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
    brief: 'Saigusa, 2008. Every twenty-five seconds the air is pulled dry and you shrink. Do it enough times and something in you begins to slow down just before the next one arrives, which is either anticipation or an extremely good coincidence. Engulfed agar holds moisture — sit on it.',
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
    brief: 'Reid, 2012. Behind a U-shaped wall, the food is close enough to smell and impossible to reach in a straight line — the only way out is backward, through the mouth you came in by. A plasmodium that avoids its own abandoned ground escapes efficiently; one bathed first in its own slime, with nothing left to tell searched from unsearched, wanders the trap until it starves. You are the first culture. Push at the back wall once, then leave it alone and go the long way.',
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
    brief: 'Nakagaki, 2007. A maze under uneven light: physarum is photophobic, and the network that survives balances path length against light exposure rather than minimising either alone. This dish offers two ways to the far blocks — a short corridor washed in light, and a long one left dark. The light does not stop you; it only costs you, steadily, for as long as you sit in it. Decide what a shortest path is actually worth.',
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
    brief: 'Dussutour, 2010. Offered many protein:carbohydrate blends across a dish, the plasmodium in the paper composed its own diet — straddling several imperfect foods to land close to a two-to-one protein-to-carbohydrate intake, no matter which blends were on offer. Eight blends ring this dish, from nearly pure protein to nearly pure sugar. Eating all eight misses the target by a wide margin. Choose a handful in the right proportions, and retract from whatever the ratio does not want.',
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
    brief: 'Latty & Beekman, 2011. Give the plasmodium two good meals and it splits its attention evenly. Add a third, worse option nearby and the preference between the first two flips, a small violation of independence of irrelevant alternatives that human economists were not expecting from an organism with no brain. Today\'s dish repeats the trick from the inside: two real meals sit far apart on opposite ends of the agar, and one small, close, mostly-cellulose scrap waits between you and neither of them. It is nearer. It is not the assignment.',
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
    brief: 'Vogel & Dussutour, 2016. A plasmodium trained to ignore quinine was fused to a naive one, and the naive half crossed bitter agar as if it had learned the lesson itself — transferred down the shared vein, with no nervous system anywhere to carry it. There is a habituated culture sitting unconnected in the corner of this dish. Learning the strips first-hand, alone, will not finish inside the clock. Find the donor, fuse with it, and let the vein carry what your own crossings cannot.',
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
    brief: 'No citation on this one; the lab has started running its own. Somebody wanted to know what happens when the walls are made of heat instead of agar: five rooms, no partition you cannot cross, only bands of warm agar joining them at odd offsets. You can shove straight through a strip and pay for it in biomass, or find the cool seam between two rooms and cross for nothing. Both work. Only one of them works twice.',
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
    brief: 'Still nothing to cite. A full-height bar of heat crosses the dish left to right on a fixed clock, and when it reaches the far wall it resets to the near one and starts again. Food sits on both flanks, and no ground stays cool for long. You cannot out-argue the schedule, only leave ground before the bar arrives and take it back once it has passed. The dish rewards timing. It does not reward loyalty to a patch of agar.',
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
    brief: 'The lab is checking its own work now. It already knows a dry shock on a fixed period teaches you to slow down before it lands — you did that yourself, once. This dish keeps the beat, then breaks it: the fourth scheduled shock is announced by the same warning window, the same held breath, and then nothing crosses the agar at all. Hold ground on what you have already taken, and wait to find out whether you can tell the difference.',
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
    brief: 'Another of the lab\'s own, with the interval itself as the variable this time. The dry cycles start slow, practically generous, and each one arrives sooner than the last. Anticipation still gets its warning window; only the gap it has to work with keeps shrinking. Get your engulfed flakes doing double duty as refuges now, while there is still room between beats — the schedule you can out-think early is the one that outpaces you late.',
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
    brief: 'Nobody has run this one before; the lab wrote it for you. Six agar stations ring the dish, and an engulfed flake left untended for sixteen seconds is not spoils — it is agar, and agar reverts. There is no route that lets you finish and leave. The whole ring has to stand fed at once, tube touching all six stations simultaneously, or the tide takes back whatever you turned away from.',
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
    brief: 'Eight patches of agar, and only six of you to go around once idle ground starts sealing over. The lab is curious what a plasmodium does when holding everything is flatly impossible. Spread wide if you like, and watch what happens to the far corners while you are elsewhere. Then choose your six, and stop pretending the other two were ever coming with you.',
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
    brief: 'The lab\'s own follow-up to the labyrinth dish, run because someone wondered what your network remembers when the maze itself starts lying to it. Two agar blocks, cut corridors, the usual crawl. Then, twice, the walls change: a route you thickened into dissolves and a route you never tried opens somewhere else. The notebook\'s real question is whether the shortest path lives in your tubes or gets rebuilt from nothing each time the agar is repoured. Regrow. Do not sulk about it.',
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
    brief: 'No paper, no precedent. The lab poured a wall down the centre of the dish and left two doors in it, and rigged the doors to trade places — north open while south seals, then south open while north seals, on a half-minute switch nobody consulted you about. Food waits on both sides of that wall, plus a little kept close so you are not starving while you learn the rhythm. Crossing is not a question of route. It is a question of timing, and the door does not check who is still standing in the frame when it shuts.',
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
    brief: 'The lab\'s own again, and this time it runs two drills on one clock: the dry-air shock you have met before, and underneath it, on the same beat, the floor across the centre of the plate floods with heat. Five flakes sit in the corners, outside the flood line. The rhythm asks two things at once — pull in before the warning ends, and push back out the instant it lifts. The crossing does not stay open, and it does not stay cool either.',
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
    brief: 'No paper for this one — this is the lab\'s own, run after everything else on the schedule. Five stations, and holding one is not the same as holding it at four in the morning: unattended ground skins over and has to be retaken. The air will still turn dry and dry faster each time. One wall you have leaned on since the start will be poured shut without notice, and something colder waits behind it. Nobody expects you to keep all five. Do.',
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

/* ------------------------------------------------------------
   3. field + agent storage (all typed, allocated once)
   ------------------------------------------------------------ */
var trail = new Float32Array(NCELL);
var gdist = new Float32Array(NCELL);   // scratch for the geodesic sweep
var bfsQ  = new Int32Array(NCELL + 1); // ring buffer, one slot per cell + 1
var inQ   = new Uint8Array(NCELL);
var nodeDist = [];                     // per node: geodesic distance, built once
var tmpF  = new Float32Array(NCELL);
var foodF = new Float32Array(NCELL);
var statF = new Float32Array(NCELL);   // food*FOODW - hazard repel + wall penalty
var cueF  = new Float32Array(NCELL);
var retF  = new Float32Array(NCELL);
var wallM = new Uint8Array(NCELL);
var hazM  = new Uint8Array(NCELL);     // 0 none, 1 heat, 2 quinine, 3 light
var slimeF = new Float32Array(NCELL);  // extracellular slime, laid and never lifted
var nodeAt = new Int16Array(NCELL);    // cell -> node index, -1 for none
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
   spawnAgent/killRandom (which run after the agent loop) cannot leave it
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
   read as luminous goo.

   So the transfer is a soft-edged THRESHOLD rather than a ramp. Below BODY_T
   there is no organism and the cell is agar; across the next BODY_SOFT of
   trail it becomes tissue; above that it is tissue, at one flat colour,
   however much trail it carries. The narrow crossing band draws the edge —
   wide enough to antialias at this grid resolution, narrow enough that a
   boundary reads as a boundary. How much trail a tube carries is then
   expressed the way the organism expresses it, by how WIDE the tube is, which
   the field renders directly and the vein lines in 9b render as line weight.

   WHICH flat colour is the RUN'S, not the photograph's. The tint derived from
   the seed in applyTint feeds this ramp and the vein bands below it, so the
   threshold keeps the hard edge and the seed keeps the specimen its colour;
   the reference plate is then simply the run whose seed happens to be that
   yellow. */
var AGAR = [20, 22, 17];        // the dish, unoccupied
var BODY_T    = 9.0;            // trail at which tissue begins
var BODY_SOFT = 3.0;            // trail over which the edge resolves

var LUT = new Uint8Array(256 * 3);
var GAMN = 2048;
var GAM = new Uint8Array(GAMN);
var GAM_SCALE = (GAMN - 1) / TRAIL_MAX;
(function buildGamma() {
  for (var j = 0; j < GAMN; j++) {
    var u = ((j / GAM_SCALE) - BODY_T) / BODY_SOFT;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    var v = u * u * (3 - 2 * u);          /* smoothstep: the edge */
    GAM[j] = (v * 255) | 0;
  }
})();
function buildLUT(tr, tg, tb) {
  for (var i = 0; i < 256; i++) {
    var t = i / 255;
    LUT[i * 3]     = ((tr - AGAR[0]) * t) | 0;
    LUT[i * 3 + 1] = ((tg - AGAR[1]) * t) | 0;
    LUT[i * 3 + 2] = ((tb - AGAR[2]) * t) | 0;
  }
}

/* The default plate colour, and the tone every derived string starts at, so
   the first paint before any run is the one the stylesheet declares. */
var TINT = [227, 210, 74];
var ACC_CUE = rgba(TINT, '.75');
var ACC_ARC = rgba(TINT, '.85');
buildLUT(TINT[0], TINT[1], TINT[2]);
/* The vein bands want the same default. tintVeins is a hoisted declaration so
   it is callable here, but VEIN_BANDS is a var initialised further down and is
   still undefined at this point — so this is deferred to the bottom of the
   file rather than called inline. Nothing renders before a run starts (render
   returns early without S.exp, and startRun calls applyTint first), so this is
   belt and braces against a future caller that paints earlier. */

/* The two backgrounds the accent has to survive: the page ground, and the dark
   ink the primary button paints ITSELF onto the accent. Both are floors rather
   than a window, but they are different floors, so both get measured. */
/* The agar as it is actually painted. This used to be the old near-black
   ground; the threshold transfer lightened it, and a contrast solve measured
   against a floor the dish no longer has is solving the wrong problem. */
var DISH_L = relLum(AGAR[0], AGAR[1], AGAR[2]);
var PAGE_L = relLum(11, 13, 12);
var INK_L  = relLum(20, 23, 13);

/* Derive the run's palette from its 24-bit seed. Hue is preserved exactly —
   that is the player's specimen line and the number they can write down.
   Saturation is clamped to a range a lab would tolerate near a microscope,
   and lightness is walked upward until the vein tone clears WCAG 1.4.11
   against the agar and the hot tone clears 7:1. With a floor this dark almost
   any lightness passes; it is measured anyway, because the seed is allowed to
   be any colour and "almost any" is not a guarantee. */
function applyTint(seed) {
  var hsl = rgbToHsl((seed >>> 16) & 255, (seed >>> 8) & 255, seed & 255);
  var hue = hsl[0], sat = clamp(hsl[1], 0.35, 0.80);
  var l = clamp(hsl[2], 0.45, 0.72);
  var vein = hslToRgb(hue, sat, l), hot = mixWhite(vein, 0.70), i;
  for (i = 0; i < 24; i++) {
    vein = hslToRgb(hue, sat, l);
    hot = mixWhite(vein, 0.70);
    if (contrast(relLum(vein[0], vein[1], vein[2]), DISH_L) >= 3.0 &&
        contrast(relLum(hot[0], hot[1], hot[2]), DISH_L) >= 7.0) break;
    if (l >= 0.72) break;
    l = Math.min(0.72, l + 0.02);
  }
  TINT = vein;
  buildLUT(vein[0], vein[1], vein[2]);
  tintVeins(vein);
  ACC_CUE = rgba(vein, '.75');
  ACC_ARC = rgba(vein, '.85');

  /* The UI accent is a separate solve: it is text on the page ground AND the
     background under dark button ink, so it has to clear both at 4.5:1. */
  var ul = l, ui = vein;
  for (i = 0; i < 30; i++) {
    ui = hslToRgb(hue, sat, ul);
    var uL = relLum(ui[0], ui[1], ui[2]);
    if (contrast(uL, PAGE_L) >= 4.5 && contrast(uL, INK_L) >= 4.5) break;
    if (ul >= 0.92) break;
    ul = Math.min(0.92, ul + 0.02);
  }
  setAccent(hexOf(ui), hexOf(mixWhite(ui, 0.75)));
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
  nodeProg: null, nodeDone: null, nodeIdle: null, engulfed: 0,
  hab: 0, habPeak: 0, habBuilt: -1, fused: false,
  dietP: 0, dietC: 0,
  growAcc: 0, starveAcc: 0,
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
  trail.fill(0); tmpF.fill(0); foodF.fill(0);
  cueF.fill(0); retF.fill(0); slimeF.fill(0);
  nodeAt.fill(-1);

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
    var y0 = clamp((nd.y - nd.r) | 0, 0, GH), y1 = clamp((nd.y + nd.r + 1) | 0, 0, GH);
    var x0 = clamp((nd.x - nd.r) | 0, 0, GW), x1 = clamp((nd.x + nd.r + 1) | 0, 0, GW);
    for (y = y0; y < y1; y++) {
      var dy = y - nd.y, row = y * GW;
      for (x = x0; x < x1; x++) {
        var dx = x - nd.x;
        if (dx * dx + dy * dy <= nd.r * nd.r) nodeAt[row + x] = ni;
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
        ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents];
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
    var done = S.nodeDone[ni];
    var fall = done ? SPENT_FALL : FALL;
    var amp = done ? SPENT_FOOD : 1;
    var core = done ? 0 : e.nodes[ni].r * 2.4;
    for (var i = 0; i < NCELL; i++) {
      var d = dm[i];
      if (d >= fall) continue;
      var v = amp * (1 - d / fall);
      if (d < core) v += 0.85 * (1 - d / core);
      if (v > foodF[i]) foodF[i] = v;
    }
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
     agar, one agent per cell in breadth-first order. A plain disk of the
     needed radius would cross maze walls and seed agents in corridors the
     culture has never reached (EXP-02's radius spans two baffles); a
     flood-fill cannot start anywhere it could not physically flow. In an
     open dish the fill IS the disk, so nothing changes there. */
  occ.fill(0);
  var seen = new Uint8Array(GW * GH);
  var q = new Int32Array(GW * GH);
  var qh = 0, qt = 0;
  var s = (e.inoc.y | 0) * GW + (e.inoc.x | 0);
  q[qt++] = s; seen[s] = 1;
  while (qh < qt && nAgents < n) {
    var ci = q[qh++];
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
      nAgents++;
    }
    var w = ci - 1, ee = ci + 1, nn = ci - GW, ss2 = ci + GW;
    if (!seen[w]) { seen[w] = 1; q[qt++] = w; }
    if (!seen[ee]) { seen[ee] = 1; q[qt++] = ee; }
    if (!seen[nn]) { seen[nn] = 1; q[qt++] = nn; }
    if (!seen[ss2]) { seen[ss2] = 1; q[qt++] = ss2; }
  }
}

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
function thicken() {
  var best = -1, bestV = -1e9;
  for (var t = 0; t < 3; t++) {
    var k = (rnd() * nAgents) | 0;
    var ci = ((ay[k] | 0) * GW + (ax[k] | 0));
    var v = foodF[ci] + cueF[ci] * 0.8;
    if (v > bestV) { bestV = v; best = k; }
  }
  if (best < 0) return false;
  for (var tries = 0; tries < 6; tries++) {
    if (emit(ax[best] + (rnd() - 0.5) * 8, ay[best] + (rnd() - 0.5) * 8, rnd() * Math.PI * 2, 0)) return true;
  }
  return false;
}

function spawnAgent() {
  if (nAgents <= 0 || nAgents >= MAXA) return;
  if (rnd() < BRANCH_P) { if (forkTip()) return; }
  thicken();
}

function killRandom() {
  if (nAgents <= 0) return;
  var k = (rnd() * nAgents) | 0;
  var ci = (ay[k] | 0) * GW + (ax[k] | 0);
  if (occ[ci]) occ[ci]--;          /* every removal path decrements */
  nAgents--;
  ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents]; atip[k] = atip[nAgents];
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
  /* vertical blur back into trail, with decay, and player fields decayed too */
  for (y = 0; y < GH; y++) {
    row = y * GW;
    var up = y > 0 ? row - GW : row;
    var dn = y < GH - 1 ? row + GW : row;
    for (x = 0; x < GW; x++) {
      i = row + x;
      var v = (sw * tmpF[up + x] + cw * tmpF[i] + sw * tmpF[dn + x]) * DECAY;
      trail[i] = wallM[i] ? 0 : (v < 0.0016 ? 0 : v);
      if (cueF[i] > 0) { var c = cueF[i] * CUE_DECAY; cueF[i] = c < 0.002 ? 0 : c; }
      if (retF[i] > 0) { var q = retF[i] * CUE_DECAY; retF[i] = q < 0.002 ? 0 : q; }
    }
  }
}

/* ------------------------------------------------------------
   8. one simulation step
   ------------------------------------------------------------ */
var nodeHits = new Int32Array(16);

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

  var i, k;
  for (i = 0; i < nodeHits.length; i++) nodeHits[i] = 0;

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
  var quinDmg = 0.011 * (1 - S.hab);
  var heatDmg = (e.heatDmg == null) ? 0.010 : e.heatDmg;
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
    }
    atip[k] = tip ? 1 : 0;
    var sd = tip ? TIP_SENS : SENS_D;

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
    }
    /* round to Float32 before anything reads a cell from it: ax/ay are
       Float32Arrays, so an unrounded double a hair under an integer can test
       one cell and then store into the next, leaving the occupancy grid
       reserving a cell the agent is not standing in */
    var nx = Math.fround(x + Math.cos(h) * spd);
    var ny = Math.fround(y + Math.sin(h) * spd);
    var idx = -1;
    var blocked = (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1);
    if (!blocked) {
      idx = (ny | 0) * GW + (nx | 0);
      if (wallM[idx] || (idx !== oldIdx && occ[idx])) blocked = true;
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
      ah[k] = rnd() * Math.PI * 2;
      cell = oldIdx;
    } else {
      ax[k] = nx; ay[k] = ny; ah[k] = h;
      if (idx !== oldIdx) { occ[oldIdx]--; occ[idx]++; }
      cell = idx;
      var tv = trail[cell];
      if (tv < TRAIL_MAX) {
        var dep = stepDeposit * (tip ? TIP_LAY : spd / SPEED);
        trail[cell] = tv + dep > TRAIL_MAX ? TRAIL_MAX : tv + dep;
      }
    }

    var ni = nodeAt[cell];
    if (ni >= 0) nodeHits[ni]++;

    /* The mat is laid wherever the organism IS, not only where it moved: a
       front jammed against a wall has still been there, and the ground still
       remembers it. */
    if (slimeOn) {
      var sm2 = slimeF[cell] + SLIME_DEP;
      slimeF[cell] = sm2 > 1 ? 1 : sm2;
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
      ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents]; atip[k] = atip[nAgents];
      continue;
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
      S.hab = clamp(S.hab + frac * 1.5 * DT * hrate + 0.020 * DT * hrate, 0, 1);
    } else {
      S.hab = clamp(S.hab - 0.012 * DT, 0, 1);
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
      S.hab = Math.min(donor.hab, S.hab + 0.10 * DT);
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
    var gain = MAX_ENGULF_RATE * (hits / (hits + soft));
    S.nodeProg[i] = clamp(S.nodeProg[i] + gain, 0, 1);
    if (S.nodeProg[i] >= 1) {
      S.nodeDone[i] = true;
      S.engulfed++;
      buildFood();
      onEngulf(i);
    }
  }

  /* --- biomass: fed by engulfed nodes, drained otherwise --- */
  var target = Math.min(S.engulfed * e.sustain, e.cap);
  if (nAgents < target) {
    S.growAcc += (e.grow * DT);
    while (S.growAcc >= 1 && nAgents < target && nAgents < MAXA) { spawnAgent(); S.growAcc -= 1; }
  } else if (S.simT > e.grace && nAgents > target) {
    S.starveAcc += (e.starve * DT);
    while (S.starveAcc >= 1 && nAgents > 0) { killRandom(); S.starveAcc -= 1; }
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
  if (winMet(e)) { finish(true, ''); return; }
  if (e.timeLimit && S.simT >= e.timeLimit) { finish(false, 'timeout'); return; }
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

function initCanvas() {
  cv = $('cv');
  ctx = cv.getContext('2d', { alpha: false });
  off = document.createElement('canvas');
  off.width = GW; off.height = GH;
  octx = off.getContext('2d', { alpha: false });
  img = octx.createImageData(GW, GH);
  imgData = img.data;
  for (var p = 3; p < imgData.length; p += 4) imgData[p] = 255;
  resizeCanvas();
}

function resizeCanvas() {
  var stage = $('stage');
  var wCss = stage.clientWidth || 900;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.max(320, Math.round(wCss * dpr));
  var h = Math.round(w * GH / GW);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w; cv.height = h;
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

function paintField() {
  var d = imgData;
  buildRidge();
  for (var i = 0, p = 0; i < NCELL; i++, p += 4) {
    var r, g, b;
    if (wallM[i]) {
      r = 46; g = 50; b = 40;
    } else {
      r = AGAR[0]; g = AGAR[1]; b = AGAR[2];
      var hz = hazM[i];
      if (hz === 1) { r += 38; g += 20; b += 9; }
      else if (hz === 2) { r += 27; g += 12; b += 40; }
      /* a lit field, not an ember: the same aversion, told cold */
      else if (hz === 3) { r += 30; g += 34; b += 40; }
      /* The mat, where a dish is running on it. Cool, grey and much fainter
         than any hazard — it is the record of where the organism has been,
         not a thing on the plate — and it fades out under live tube, because
         under live tube it is not something the player needs to see. */
      if (SLIME_W > 0) {
        var sv = slimeF[i];
        if (sv > 0.05) {
          var thin = 1 - (trail[i] > 8 ? 1 : trail[i] * 0.125);
          if (thin > 0) {
            r += sv * 7 * thin; g += sv * 8 * thin; b += sv * 11 * thin;
          }
        }
      }
      var a = shpA[i];
      if (a > 0.004) {
        var t = a + SHARP * (a - shpB[i]);
        if (t > BODY_T * 0.5) {
          var gi = (t * GAM_SCALE) | 0;
          if (gi < 0) gi = 0; else if (gi >= GAMN) gi = GAMN - 1;
          var o = GAM[gi] * 3;
          r += LUT[o] * FIELD_GAIN; g += LUT[o + 1] * FIELD_GAIN; b += LUT[o + 2] * FIELD_GAIN;
          if (r > 255) r = 255;
          if (g > 255) g = 255;
          if (b > 255) b = 255;
        }
      }
      /* the player's cue reads as a faint warm haze in the agar */
      var c = cueF[i];
      if (c > 0.02) {
        r += c * 26; g += c * 24; b += c * 8;
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      }
      var q = retF[i];
      if (q > 0.02) {
        r += q * 26; g += q * 6; b += q * 16;
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
      }
    }
    d[p] = r; d[p + 1] = g; d[p + 2] = b;
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
   bright hairline; a trunk is broad, and pale because it is carrying
   everything. */
/* Five generations of vein, because the organism has about that many and the
   hierarchy is most of what the picture is. Thin veins are drawn a shade
   duller: in the photograph a fine vein is thin enough to be translucent and
   sits closer to the agar in tone, while a trunk is opaque chrome yellow with
   a highlight along it. Widths span roughly seven to one, which is the ratio
   the real thing shows between its finest branches and its trunk. */
/* Five generations of vein, because the organism has about that many and the
   hierarchy is most of what the picture is. Widths span roughly eight to one,
   the ratio the real thing shows between its finest branches and its trunk.

   The COLOURS are the run's, and have to be: the body is tinted from the seed,
   so a fixed yellow set here would draw a blue specimen with yellow veins.
   Each band is the tint walked toward white by its own amount — a fine vein is
   thin enough to be translucent and sits near the tissue tone, a trunk is
   opaque and carries the highlight — and `dim` pulls the finest band back
   under the tissue so it reads as a vein in the sheet rather than on top of
   it. Rebuilt per run alongside the LUT. */
var VEIN_BANDS = [
  { max: 6,        w: 0.34, hot: 0.00, dim: 0.86, alpha: 0.90, style: '' },
  { max: 10,       w: 0.62, hot: 0.10, dim: 1.00, alpha: 0.97, style: '' },
  { max: 16,       w: 1.05, hot: 0.22, dim: 1.00, alpha: 1 },
  { max: 26,       w: 1.75, hot: 0.34, dim: 1.00, alpha: 1 },
  { max: Infinity, w: 2.70, hot: 0.48, dim: 1.00, alpha: 1 }
];
function tintVeins(vein) {
  for (var i = 0; i < VEIN_BANDS.length; i++) {
    var band = VEIN_BANDS[i];
    var c = mixWhite(vein, band.hot);
    band.style = 'rgba(' + Math.round(c[0] * band.dim) + ','
                         + Math.round(c[1] * band.dim) + ','
                         + Math.round(c[2] * band.dim) + ',' + band.alpha + ')';
  }
  TIP_STYLE = rgba(mixWhite(vein, 0.62), '0.34');
}
var VEIN_CAP = 200000;                 /* floats held per band per rebuild */
var vseg = [], vsegN = [], veinPath = [];
(function () {
  for (var i = 0; i < VEIN_BANDS.length; i++) {
    vseg.push(new Float32Array(VEIN_CAP));
    vsegN.push(0);
    veinPath.push(null);
  }
})();
var whiskPath = null;

/* The four directions a vein can run ACROSS: the across unit vector, the
   tangent it runs along, and the two cell offsets that step along that
   tangent. */
/* Ordered so the LINE each tangent describes rotates by a steady -45 degrees
   per index: south, south-east, east, north-east. The middle entry used to be
   written north-west, which is the same line but the opposite ray, so it
   pointed backwards from both of its neighbours and a walk crossing it turned
   round into the part of the vein it had just claimed. */
var RIDGE_DIR = [
  { o:  1,      ax:  1,      ay:  0,      tx:  0,      ty:  1,      t1:  GW,     t2: -GW     },
  { o:  1 - GW, ax:  0.7071, ay: -0.7071, tx:  0.7071, ty:  0.7071, t1:  1 + GW, t2: -1 - GW },
  { o: -GW,     ax:  0,      ay:  1,      tx:  1,      ty:  0,      t1:  1,      t2: -1      },
  { o: -1 - GW, ax: -0.7071, ay: -0.7071, tx:  0.7071, ty: -0.7071, t1:  1 - GW, t2: -1 + GW }
];
/* Which way the vein runs at each cell, 255 for "not on a ridge", and which
   cells a walk has already claimed. Deciding the whole field before drawing
   any of it is what lets the walk below follow a vein from end to end. */
var rdir = new Uint8Array(NCELL);
var rvis = new Uint8Array(NCELL);
var RIDGE_MINPTS = 5;        // a chain shorter than this is speckle
var chx = new Float32Array(4096);
var chy = new Float32Array(4096);

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
   the ridge walk to find, so without this the newest growth would be the one
   thing not drawn. */
var TIP_WHISK = 2.6;   // cells
var TIP_STYLE = 'rgba(255,248,206,0.34)';
var TIP_W = 0.17;

/* The tip whisker: a short line back along the heading, so the front reads as
   a fan of spikes rather than as a scatter of dots. A tip has no tube yet for
   the ridge walk to find, so without this the newest growth — the part worth
   watching — would be the one thing not drawn. */
var TIP_WHISK = 2.6;   // cells
var TIP_STYLE = 'rgba(244,238,120,0.30)';   /* replaced per run by tintVeins */
var TIP_W = 0.17;

function buildVeins() {
  var b, i, x, y;
  for (b = 0; b < VEIN_BANDS.length; b++) vsegN[b] = 0;

  /* --- pass one: which cells are on a ridge, and which way it runs --- */
  rdir.fill(255);
  for (y = 2; y < GH - 2; y++) {
    var row = y * GW;
    for (x = 2; x < GW - 2; x++) {
      i = row + x;
      var v = shpA[i];
      if (v < RIDGE_MIN) continue;
      var bestK = RIDGE_K, bestD = -1;
      for (var d = 0; d < 4; d++) {
        var o = RIDGE_DIR[d].o;
        var lo = shpA[i - o], hi = shpA[i + o];
        if (v < lo || v < hi) continue;         /* not a maximum across d */
        var kk = 2 * v - lo - hi;               /* curvature across d */
        if (kk > bestK && kk > RIDGE_REL * v) { bestK = kk; bestD = d; }
      }
      if (bestD >= 0) rdir[i] = bestD;
    }
  }

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
  for (y = 2; y < GH - 2; y++) {
    var row2 = y * GW;
    for (x = 2; x < GW - 2; x++) {
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
      var n = 0, c = i, cd = rdir[i], sum = 0, sgn = 1;
      rvis[c] = 1;
      chx[n] = (c % GW) + 0.5; chy[n] = ((c / GW) | 0) + 0.5; sum += shpA[c]; n++;
      var nx2 = c;
      while (n < 2000) {
        nx2 = ridgeStep(chx[n - 1] - 0.5, chy[n - 1] - 0.5, cd, sgn);
        if (nx2 < 0) break;
        rvis[nx2] = 1;
        var qx = (nx2 % GW) + 0.5, qy = ((nx2 / GW) | 0) + 0.5;
        cd = rdir[nx2];
        sgn = (RIDGE_DIR[cd].tx * (qx - chx[n - 1]) +
               RIDGE_DIR[cd].ty * (qy - chy[n - 1])) >= 0 ? 1 : -1;
        chx[n] = qx; chy[n] = qy; sum += shpA[nx2]; n++;
      }
      /* reverse in place so the backward walk can append */
      for (var a2 = 0, b2 = n - 1; a2 < b2; a2++, b2--) {
        var tx2 = chx[a2]; chx[a2] = chx[b2]; chx[b2] = tx2;
        var ty2 = chy[a2]; chy[a2] = chy[b2]; chy[b2] = ty2;
      }
      cd = rdir[i]; sgn = -1;
      while (n < 2000) {
        nx2 = ridgeStep(chx[n - 1] - 0.5, chy[n - 1] - 0.5, cd, sgn);
        if (nx2 < 0) break;
        rvis[nx2] = 1;
        var rx = (nx2 % GW) + 0.5, ry = ((nx2 / GW) | 0) + 0.5;
        cd = rdir[nx2];
        sgn = (RIDGE_DIR[cd].tx * (rx - chx[n - 1]) +
               RIDGE_DIR[cd].ty * (ry - chy[n - 1])) >= 0 ? 1 : -1;
        chx[n] = rx; chy[n] = ry; sum += shpA[nx2]; n++;
      }
      if (n < RIDGE_MINPTS) continue;

      var mean = sum / n;
      for (b = 0; b < VEIN_BANDS.length && mean > VEIN_BANDS[b].max; b++) { /* pick band */ }
      var arr = vseg[b], w = vsegN[b];
      if (w + 1 + n * 2 > VEIN_CAP) continue;
      arr[w++] = n;
      for (var q = 0; q < n; q++) { arr[w++] = chx[q]; arr[w++] = chy[q]; }
      vsegN[b] = w;
    }
  }

  /* Bake each band into a Path2D, in grid coordinates. Held rather than
     re-issued, so a frame that changed nothing re-strokes the same geometry
     without walking 109,200 cells or replaying the moveTo/lineTo calls. The
     canvas transform does the scaling, so these survive a resize too. */
  for (b = 0; b < VEIN_BANDS.length; b++) {
    var end = vsegN[b];
    if (!end) { veinPath[b] = null; continue; }
    var a3 = vseg[b], pth = new Path2D(), r = 0;
    while (r < end) {
      var cnt = a3[r++];
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
    veinPath[b] = pth;
  }

  /* --- the front: one whisker per tip --- */
  var wp = new Path2D(), any = false;
  for (var k = 0; k < nAgents; k++) {
    if (!atip[k]) continue;
    var ax0 = ax[k], ay0 = ay[k], h = ah[k];
    wp.moveTo(ax0 - Math.cos(h) * TIP_WHISK, ay0 - Math.sin(h) * TIP_WHISK);
    wp.lineTo(ax0, ay0);
    any = true;
  }
  whiskPath = any ? wp : null;
}

function strokeVeins(sx, sy) {
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  /* widest first, so the hairlines land on top of the trunks they join */
  for (var b = VEIN_BANDS.length - 1; b >= 0; b--) {
    if (!veinPath[b]) continue;
    ctx.lineWidth = VEIN_BANDS[b].w;
    ctx.strokeStyle = VEIN_BANDS[b].style;
    ctx.stroke(veinPath[b]);
  }
  if (whiskPath) {
    ctx.lineWidth = TIP_W;
    ctx.strokeStyle = TIP_STYLE;
    ctx.stroke(whiskPath);
  }
  ctx.restore();
}

/* mode 1 = cue, 2 = retract. touchMode is the verb the on-screen pads select;
   a second finger overrides it to retract for the duration of that gesture. */
var ptr = { down: false, mode: 0, gx: 0, gy: 0 };
var touchMode = 1;
var downIds = [];      /* pointerIds currently on the stage */
var primaryId = null;  /* the one the brush follows */

function render() {
  if (!cv || !S.exp) return;
  /* A run that has stopped is not going to get another frame from the loop —
     the result screen and exitReplay call render() once, by hand — so those
     rebuild immediately rather than waiting for a second frame that never
     arrives and leaving the verdict over a stale dish. */
  if (fieldDirty && (!S.running || ++dirtyFrames >= REBUILD_EVERY)) {
    paintField();
    buildVeins();
    dirtyFrames = 0;
    fieldDirty = false;
  }

  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, cv.width, cv.height);

  /* the sheet is the field; the veins are lines drawn over it */
  var sx = cv.width / GW, sy = cv.height / GH;
  strokeVeins(sx, sy);
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);

  var e = S.exp;

  /* The stranger. Drawn under the nodes so a flake sitting on it still reads,
     and pulsed off sim time rather than the wall clock so a time-lapse run and
     a real-time one show the same frame at the same step. */
  if (e.donor) {
    var dn = e.donor;
    var puls = 0.5 + 0.5 * Math.sin(S.simT * 1.7);
    ctx.beginPath();
    ctx.arc(dn.x, dn.y, dn.r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(127,209,185,' + (0.05 + 0.05 * puls).toFixed(3) + ')';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dn.x, dn.y, dn.r, 0, Math.PI * 2);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(127,209,185,' + (0.30 + 0.34 * puls).toFixed(3) + ')';
    ctx.stroke();
  }

  for (var i = 0; i < e.nodes.length; i++) {
    var nd = e.nodes[i];
    var done = S.nodeDone[i];
    ctx.beginPath();
    ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
    ctx.lineWidth = done ? 1.8 : 1.2;
    ctx.strokeStyle = done ? 'rgba(127,209,185,.92)' : 'rgba(206,212,180,.50)';
    ctx.stroke();

    if (!done && S.nodeProg[i] > 0.01) {
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, nd.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * S.nodeProg[i]);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = ACC_ARC;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(nd.x, nd.y, nd.r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = done ? 'rgba(127,209,185,.55)' : 'rgba(206,212,180,.42)';
    ctx.fill();
  }

  if (ptr.down) {
    ctx.beginPath();
    ctx.arc(ptr.gx, ptr.gy, CUE_R, 0, Math.PI * 2);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = ptr.mode === 2 ? 'rgba(199,75,106,.75)' : ACC_CUE;
    ctx.stroke();
  }

  ctx.restore();

  if (S.shockActive) {
    ctx.fillStyle = 'rgba(214,148,72,.13)';
    ctx.fillRect(0, 0, cv.width, cv.height);
  } else if (S.shockWarn) {
    ctx.fillStyle = 'rgba(120,96,60,.06)';
    ctx.fillRect(0, 0, cv.width, cv.height);
  }
}

/* ------------------------------------------------------------
   10. player fields (brush)
   ------------------------------------------------------------ */
function paintBrush(gx, gy, mode) {
  fieldDirty = true;
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
      var want = fall * 1.15;
      if (mode === 2) {
        if (retF[i] < want) retF[i] = want;
        trail[i] *= (1 - 0.16 * fall);
      } else {
        if (cueF[i] < want) cueF[i] = want;
      }
    }
  }
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
  while (box.children.length > 6) box.removeChild(box.lastChild);
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
    for (var t = 0; t < toll; t++) killRandom();
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
    S.ambientAt = S.simT + 17 + rnd() * 12;
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
  el.style.color = '#fff6b0';
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
     always at some rate, so the rate is stated whether or not it is 1. */
  $('h-time').textContent = fmtTime(S.simT) +
    (REPLAY.on ? ' · REPLAY ×' + TURBO : (TURBO > 1 ? ' ×' + TURBO : ''));

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
   13. saved progress
   ------------------------------------------------------------ */
var SAVE_KEY = 'slime980.v1';
var save = { v: 1, done: {}, best: {} };

function loadSave() {
  try {
    var raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    var o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      save.done = (o.done && typeof o.done === 'object') ? o.done : {};
      save.best = (o.best && typeof o.best === 'object') ? o.best : {};
    }
  } catch (err) { /* private mode, file:// restrictions, corrupt JSON — play anyway */ }
}

function writeSave() {
  try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
  catch (err) { /* nothing to do; progress is just not persisted */ }
}

function isDone(i) { return !!save.done[EXPERIMENTS[i].code]; }
function isUnlocked(i) { return i === 0 || isDone(i - 1); }
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
  for (var i = 0; i < SCREENS.length; i++) {
    var el = $(SCREENS[i]);
    if (SCREENS[i] === id) el.classList.add('on');
    else el.classList.remove('on');
  }
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
      if (!unlocked) s.textContent = 'locked';
      else if (done) s.textContent = 'logged · ' + fmtTime(save.best[e.code] || 0);
      else s.textContent = 'available';

      b.appendChild(c); b.appendChild(n); b.appendChild(l); b.appendChild(s);
      if (unlocked) b.addEventListener('click', function () { openBrief(i); });
      box.appendChild(b);
    })(i);
  }
  $('progress').textContent = doneCount() + ' / ' + EXPERIMENTS.length + ' logged';
}

function goTitle() {
  stopRun();
  REPLAY.on = false; REPLAY.trace = null;
  setReplayUI(false);
  closeResult();
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
  $('b-brief').textContent = e.brief;
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
   player cycles it through SPEEDS; the harness can set any value up to 24. */
var TURBO = 1;
var SPEEDS = [1, 4, 12];

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

   None of it touches what a step does. Steps run in order at a fixed DT, and
   a seed run to the same step count holds a bit-identical dish at any speed,
   with the box at any value or none — verified on EXP-04 at step 1500 across
   x1/x4/x12 and boxes of 6ms, 24ms and off, which agree to the last bit of
   the trail field. */
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

   Positions are Float64: ptr.gx/gy are doubles, paintBrush reads them as
   doubles, and rounding them to Float32 on the way into the trace would make
   a replay land on a very slightly different cone. Same bits in, same dish
   out — that is the whole contract. */
var TRACE = null;
var REPLAY = { on: false, i: 0, trace: null };

function newTrace(idx, seed) {
  var cap = 2048;
  return {
    idx: idx, seed: seed, n: 0, cap: cap, cues: 0,
    step: new Int32Array(cap),
    mode: new Uint8Array(cap),
    gx: new Float64Array(cap),
    gy: new Float64Array(cap)
  };
}

function growTrace(t) {
  var c = t.cap * 2;
  var s = new Int32Array(c);   s.set(t.step); t.step = s;
  var m = new Uint8Array(c);   m.set(t.mode); t.mode = m;
  var x = new Float64Array(c); x.set(t.gx);   t.gx = x;
  var y = new Float64Array(c); y.set(t.gy);   t.gy = y;
  t.cap = c;
}

function recordBrush(s, mode, gx, gy) {
  var t = TRACE;
  if (!t) return;
  if (t.n >= t.cap) growTrace(t);
  t.step[t.n] = s; t.mode[t.n] = mode; t.gx[t.n] = gx; t.gy[t.n] = gy;
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
    ptr.gx = t.gx[REPLAY.i];
    ptr.gy = t.gy[REPLAY.i];
    REPLAY.i++;
  } else {
    ptr.down = false;
  }
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
    if (FINAL_STATE.slimeF) slimeF.set(FINAL_STATE.slimeF);
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

function setSpeed(n) {
  TURBO = clamp(Math.round(n) || 1, 1, 24);
  var b = $('s-speed');
  if (b) {
    b.textContent = 'Time-lapse ×' + TURBO;
    b.classList.toggle('lapse-on', TURBO > 1);
    b.setAttribute('aria-label', 'Time-lapse, currently ' + TURBO + ' times real time');
  }
  return TURBO;
}

function cycleSpeed() {
  var k = SPEEDS.indexOf(TURBO);
  setSpeed(SPEEDS[(k + 1) % SPEEDS.length]);
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
  /* The plate number and the plate colour are the same number. Pure
     arithmetic on the seed, drawing nothing, so the stream is untouched —
     and a replay re-derives the identical palette from the same seed. */
  applyTint(S.seed);

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
  S.nodeProg = new Float32Array(e.nodes.length);
  S.nodeIdle = new Float32Array(e.nodes.length);
  S.nodeDone = new Array(e.nodes.length);
  for (var q = 0; q < e.nodes.length; q++) S.nodeDone[q] = false;
  if (nodeHits.length < e.nodes.length) nodeHits = new Int32Array(e.nodes.length);
  S.engulfed = 0;
  S.hab = 0; S.habPeak = 0; S.habBuilt = -1; S.fused = false;
  S.dietP = 0; S.dietC = 0;
  S.growAcc = 0; S.starveAcc = 0;
  S.shockNext = e.shock ? e.shock.first : 0;
  S.shockPeriod = e.shock ? e.shock.period : 0;
  S.shockActive = false; S.shockWarn = false; S.shocksSurvived = 0;
  S.shockWarned = -1; S.shockCycle = 0;
  S.quinTime = 0; S.slow = 1; S.anticipated = false;
  S.ambientAt = 14; S.scriptIdx = 0; S.failReason = '';
  /* The active plate, before anything reads it: buildDish stamps from these. */
  S.walls = e.walls; S.hazards = e.hazards; S.eventIdx = 0;
  SLIME_W = e.slimeAvoid || 0;
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
  /* One second meter, whichever of the two the dish is about. */
  $('h-habwrap').style.display = (e.hab || e.diet) ? '' : 'none';
  $('h-meterlab').textContent = e.diet && !e.hab ? 'P : C' : 'Habituation';
  $('h-hab').textContent = e.diet && !e.hab ? 'p 0 · c 0' : '0%';
  $('h-habbar').style.width = '0%';
  $('pauseveil').classList.remove('on');

  show('scr-sim');
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

  var e = S.exp;
  /* A replay reaches exactly the result it is replaying, which is already in
     the log — so it neither re-records the trace nor re-writes the save. */
  if (!REPLAY.on) {
    if (TRACE) TRACE.cues = S.cues;
    if (won) {
      var prev = save.best[e.code];
      if (!prev || S.simT < prev) save.best[e.code] = S.simT;
      save.done[e.code] = true;
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

function buildResult(won) {
  var e = S.exp;
  var body = won ? e.win : e.lose;
  if (!won && S.failReason === 'timeout') {
    body = 'The plate reached its scheduled end with the network incomplete. ' + e.lose;
  } else if (!won && S.failReason === 'starved') {
    body = 'The culture has starved. ' + e.lose;
  } else if (!won) {
    body = e.lose;
  }

  var rows = [
    ['Elapsed', fmtTime(S.simT)],
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
  if (won && save.best[e.code] != null) rows.push(['Best run', fmtTime(save.best[e.code])]);
  /* The plate's provenance, last, the way a notebook records it: this dish is
     reproducible from that number alone — SLIME.start(idx, '#a3f2c1') runs it
     again, cell for cell, at any time-lapse setting. The swatch is the same
     number again, as the colour the culture was actually grown in. */
  rows.push(['Specimen line', seedLabel(S.seed), hexOf(TINT)]);

  var hasNext = won && S.idx < EXPERIMENTS.length - 1;
  return {
    code: e.code + ' · ' + e.name,
    head: won ? 'Result logged' : 'Culture lost',
    body: body,
    rows: rows,
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
       identical between speeds. */
    var steps = 0, budget = 4 * TURBO;
    var boxT0 = performance.now(), boxed = false;
    while (acc >= DT && steps < budget && S.running &&
           (!stepTarget || stepsRun < stepTarget)) {
      /* Replay drives the brush from the tape; a played run records what the
         brush actually was. Either way the paint call below is the same one,
         so what is recorded is precisely what the sim consumed. */
      if (REPLAY.on) feedTrace(stepsRun);
      if (ptr.down) {
        paintBrush(ptr.gx, ptr.gy, ptr.mode);
        if (!REPLAY.on) recordBrush(stepsRun, ptr.mode, ptr.gx, ptr.gy);
      }
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
       here to prevent, wearing the box as a disguise. */
    if (boxed || acc > DT * budget) acc = 0;
    if (stepTarget && stepsRun >= stepTarget && S.running && !S.over) {
      /* one-shot: consume the target so Resume resumes and later runs run */
      stepTarget = 0;
      setPaused(true);
    }
  } else {
    acc = 0;
  }

  render();
  updateHUD();

  if (!S.running && raf) { window.cancelAnimationFrame(raf); raf = 0; }
}

/* ------------------------------------------------------------
   17. input
   ------------------------------------------------------------ */
function toGrid(ev) {
  var r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  var gx = (ev.clientX - r.left) / r.width * GW;
  var gy = (ev.clientY - r.top) / r.height * GH;
  return { x: clamp(gx, 0, GW - 1), y: clamp(gy, 0, GH - 1) };
}

function setTouchMode(m) {
  touchMode = (m === 2) ? 2 : 1;
  var g = $('t-grow'), r = $('t-ret');
  if (g) { g.classList.toggle('on', touchMode === 1); g.setAttribute('aria-pressed', touchMode === 1 ? 'true' : 'false'); }
  if (r) { r.classList.toggle('on', touchMode === 2); r.setAttribute('aria-pressed', touchMode === 2 ? 'true' : 'false'); }
}

function endGesture() {
  downIds.length = 0;
  primaryId = null;
  ptr.down = false;
}

function bindInput() {
  var stage = $('stage');

  stage.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

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
      ptr.mode = (downIds.length > 1) ? 2 : touchMode;
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
       here as well would fire the control twice. */
    var onBtn = !!(ev.target && ev.target.tagName === 'BUTTON');

    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
      /* the primary action of the verdict panel: on with the schedule */
      if (resultOpen() && !onBtn) { ev.preventDefault(); $('r-next').click(); }
    } else if (ev.code === 'Space') {
      if (onBtn) return;
      ev.preventDefault();
      setPaused(!S.paused);
    } else if (ev.code === 'KeyF') {
      ev.preventDefault();
      cycleSpeed();
    } else if (ev.code === 'KeyR') {
      /* R is always a fresh dish — a new seed, a new recording — whether it is
         pressed mid-run, mid-replay, or over the verdict */
      ev.preventDefault();
      if (S.idx >= 0) startRun(S.idx);
    } else if (ev.code === 'Escape') {
      ev.preventDefault();
      if (REPLAY.on) exitReplay();
      else goTitle();
    }
  });

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
  $('s-abort').addEventListener('click', goTitle);
  $('s-pause').addEventListener('click', function () { setPaused(!S.paused); });
  $('s-reset').addEventListener('click', function () { if (S.idx >= 0) startRun(S.idx); });
  $('s-speed').addEventListener('click', cycleSpeed);
  $('s-exitrp').addEventListener('click', exitReplay);
  $('t-grow').addEventListener('click', function () { setTouchMode(1); });
  $('t-ret').addEventListener('click', function () { setTouchMode(2); });
  /* Retry is a NEW dish: no seed passed, so freshSeed() mints one and
     startRun() opens a fresh recording over the replayed run's trace. */
  $('r-retry').addEventListener('click', function () { startRun(S.idx); });
  $('r-menu').addEventListener('click', goTitle);
  $('r-next').addEventListener('click', function () {
    if (this.dataset.mode === 'next' && S.idx < EXPERIMENTS.length - 1) {
      stopRun();
      closeResult();
      openBrief(S.idx + 1);
    } else {
      goTitle();
    }
  });
  $('btn-wipe').addEventListener('click', function () {
    if (!window.confirm('Wipe the specimen log? All logged runs and best times are lost.')) return;
    save.done = {}; save.best = {};
    try { window.localStorage.removeItem(SAVE_KEY); } catch (err) { /* nothing to remove */ }
    renderTitle();
  });
  buildReplayRow();
}

/* The replay control: the same rates the time-lapse button cycles, offered as
   one button each because from the verdict you are choosing how long to spend
   watching, not stepping through a cycle. ×4 is the suggested rate — fast
   enough to be a recap, slow enough to see the front move. */
function buildReplayRow() {
  var box = $('r-replay');
  if (!box) return;
  box.innerHTML = '';
  for (var i = 0; i < SPEEDS.length; i++) {
    (function (sp) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost rsp' + (sp === 4 ? ' def' : '');
      b.textContent = '×' + sp;
      b.setAttribute('aria-label', 'Replay this run at ' + sp + ' times real time');
      b.addEventListener('click', function () { startReplay(sp); });
      box.appendChild(b);
    })(SPEEDS[i]);
  }
}

function init() {
  loadSave();
  /* Declare the default palette on the element rather than leaving it to the
     stylesheet, so the first paint and every later run come from one place. */
  setAccent('#e3d24a', '#fff6b0');
  if (detectCoarse()) markTouch();
  initCanvas();
  bindInput();
  bindButtons();
  setTouchMode(1);
  setSpeed(1);
  renderTitle();
  show('scr-title');

  /* read-only handle for the harness; nothing in the game reads it back */
  window.SLIME = {
    S: S, ptr: ptr,
    touchMode: function () { return touchMode; },
    isTouch: function () { return TOUCH; },
    agents: function () { return nAgents; },
    /* how many of them are at the front — the population forkTip draws from */
    tips: function () { var c = 0; for (var k = 0; k < nAgents; k++) if (atip[k]) c++; return c; },
    /* chains and points in the vein trace of the last painted frame — how far
       the ridge walk gets before it loses the vein */
    veins: function () {
      var ch = 0, pt = 0;
      for (var b = 0; b < vsegN.length; b++) {
        var r = 0, end = vsegN[b];
        while (r < end) { var c = vseg[b][r++]; ch++; pt += c; r += c * 2; }
      }
      return { chains: ch, points: pt, mean: ch ? +(pt / ch).toFixed(2) : 0 };
    },
    prog: function () { return S.nodeProg ? Array.prototype.slice.call(S.nodeProg) : []; },
    front: function () {
      if (!nAgents) return null;
      var sx = 0, sy = 0, c = 0;
      for (var k = 0; k < nAgents; k += 5) { sx += ax[k]; sy += ay[k]; c++; }
      return { x: sx / c, y: sy / c };
    },
    grid: function () { return { w: GW, h: GH }; },
    /* a copy of the trail field, for measuring the network from outside */
    trail: function () { return Float32Array.prototype.slice.call(trail); },
    trailMax: function () { return TRAIL_MAX; },
    /* sim seconds per real second. Same path the on-screen control uses, so
       the button label and HUD follow a harness that sets it directly. */
    turbo: function (n) { if (n != null) setSpeed(n); return TURBO; },
    speeds: function () { return SPEEDS.slice(); },
    /* the seed of the current run, raw and as the notebook prints it */
    seed: function () { return S.seed; },
    seedLabel: function () { return seedLabel(S.seed); },
    /* the vein tone the seed resolved to, after the contrast solve */
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

tintVeins(TINT);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
