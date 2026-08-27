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
var SENS_D = 5.0;      // sensor distance, cells
var SENS_A = 0.40;     // sensor half-angle, rad (~23 deg)
var TURN   = 0.79;     // rotation per step toward the better sensor, rad (45 deg)
var SPEED  = 1.0;      // cells per step
var JITTER = 0.11;     // random heading jitter per step — the probing of the front
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

var DEPOSIT   = 5.0;   // trail laid per agent per step
var TRAIL_MAX = 90.0;
var DECAY     = 0.945; // per-frame trail decay
/* Side weight of the separable blur run once a frame. It sets how fat a vein
   can get: the classic 3x3 mean smears a one-cell tube out to six or seven,
   which on a 420x260 dish leaves room for about six tubes and no mesh at all. */
var DIFF      = 0.10;
var TRAIL_VIS = 46.0;  // trail value that renders as a fully lit tube

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
    blurb: 'Eight lopsided blends. Eat the right four, not all eight.',
    brief: 'Dussutour, 2010. Offered many protein:carbohydrate blends across a dish, the plasmodium in the paper composed its own diet — straddling several imperfect foods to land close to a two-to-one protein-to-carbohydrate intake, no matter which blends were on offer. Eight blends ring this dish, from nearly pure protein to nearly pure sugar. Eating all eight misses the target by a wide margin. Choose a handful in the right proportions, and retract from whatever the ratio does not want.',
    obj: 'Take four blends that land the mix near two parts protein to one, and leave the rest.',
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
    win: 'Four blends held, the protein:carbohydrate ratio settling near two to one — inside the band, and nowhere close to what all eight nodes together would have produced. The observer notes that the untouched flakes were the important decision, not the eaten ones.',
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
    win: 'Every flake taken, several of them twice — once ahead of the bar and once behind it. The observer notes a network that never stopped moving and so never lost much of anything. The bar kept its own schedule throughout and noticed none of this.',
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
    win: 'Six stations held at once, the far two abandoned early and without ceremony. The observer notes this was always the correct answer, not a shortfall met halfway. Eight was never on offer.',
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
var nAgents = 0;

/* Colour lookup for the slime body: near-black -> dimmed tint -> vein tone ->
   white hot. The tint is the run's own, derived from the seed in startRun, so
   the ramp is rebuilt per run rather than baked in. */
var LUT = new Uint8Array(256 * 3);
/* Trail -> LUT index, gamma 0.45. Linear mapping is what made the lattice
   invisible: a vein carrying a tenth of a trunk's traffic landed three steps
   above black, so the mesh was simulated and never seen. The gamma lifts the
   low decade into the olive range, which is where the fine veins live. */
var GAMN = 2048;
var GAM = new Uint8Array(GAMN);
var GAM_SCALE = (GAMN - 1) / TRAIL_MAX;
(function buildGamma() {
  for (var j = 0; j < GAMN; j++) {
    var t = (j / GAM_SCALE) / TRAIL_VIS;
    if (t > 1) t = 1;
    var v = Math.pow(t, 0.45) * 255;
    GAM[j] = v > 255 ? 255 : (v | 0);
  }
})();
/* The stop positions and the gamma above are what make the fine mesh visible;
   only the colours are the run's. Ratios of the tint keep the shape of the old
   olive ramp — dark low decade, saturated middle, near-white top — so the
   default tint reproduces roughly what the file shipped with. */
function buildLUT(tr, tg, tb) {
  var hot = mixWhite([tr, tg, tb], 0.70);
  var stops = [
    [0.00, 0, 0, 0],
    [0.05, tr * 0.07, tg * 0.07, tb * 0.07],
    [0.14, tr * 0.17, tg * 0.17, tb * 0.17],
    [0.30, tr * 0.37, tg * 0.37, tb * 0.37],
    [0.54, tr * 0.67, tg * 0.67, tb * 0.67],
    [0.78, tr * 0.97, tg * 0.97, tb * 0.97],
    [1.00, hot[0], hot[1], hot[2]]
  ];
  for (var i = 0; i < 256; i++) {
    var t = i / 255, a = stops[0], b = stops[stops.length - 1];
    for (var s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    }
    var span = (b[0] - a[0]) || 1;
    var k = (t - a[0]) / span;
    LUT[i * 3]     = (a[1] + (b[1] - a[1]) * k) | 0;
    LUT[i * 3 + 1] = (a[2] + (b[2] - a[2]) * k) | 0;
    LUT[i * 3 + 2] = (a[3] + (b[3] - a[3]) * k) | 0;
  }
}

/* The default plate colour, and the tone every derived string starts at, so
   the first paint before any run is the one the stylesheet declares. */
var TINT = [227, 210, 74];
var ACC_CUE = rgba(TINT, '.75');
var ACC_ARC = rgba(TINT, '.85');
buildLUT(TINT[0], TINT[1], TINT[2]);

/* The two backgrounds the accent has to survive: the page ground, and the dark
   ink the primary button paints ITSELF onto the accent. Both are floors rather
   than a window, but they are different floors, so both get measured. */
var DISH_L = relLum(7, 9, 6);
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
      nAgents++;
    }
    var w = ci - 1, ee = ci + 1, nn = ci - GW, ss2 = ci + GW;
    if (!seen[w]) { seen[w] = 1; q[qt++] = w; }
    if (!seen[ee]) { seen[ee] = 1; q[qt++] = ee; }
    if (!seen[nn]) { seen[nn] = 1; q[qt++] = nn; }
    if (!seen[ss2]) { seen[ss2] = 1; q[qt++] = ss2; }
  }
}

function spawnAgent() {
  if (nAgents <= 0 || nAgents >= MAXA) return;
  /* bias toward the richest of three random parents */
  var best = -1, bestV = -1e9;
  for (var t = 0; t < 3; t++) {
    var k = (rnd() * nAgents) | 0;
    var ci = ((ay[k] | 0) * GW + (ax[k] | 0));
    /* new cytoplasm appears where the food is and where the player is asking
       for it, so holding a cue thickens that part of the network rather than
       only steering the tips that happen to be inside the brush */
    var v = foodF[ci] + cueF[ci] * 0.8;
    if (v > bestV) { bestV = v; best = k; }
  }
  if (best < 0) return;
  for (var tries = 0; tries < 6; tries++) {
    var nx = ax[best] + (rnd() - 0.5) * 8;
    var ny = ay[best] + (rnd() - 0.5) * 8;
    if (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1) continue;
    ax[nAgents] = nx; ay[nAgents] = ny;
    var ni2 = (ay[nAgents] | 0) * GW + (ax[nAgents] | 0);
    /* respect the exclusion at birth too: a spawn landing on top of a sibling
       is a stack the movement rule then has to unpick, and near a flake (where
       growth is busiest) that is precisely where the mesh wants room */
    if (wallM[ni2] || occ[ni2]) continue;
    occ[ni2]++;
    ah[nAgents] = rnd() * Math.PI * 2;
    nAgents++;
    return;
  }
}

function killRandom() {
  if (nAgents <= 0) return;
  var k = (rnd() * nAgents) | 0;
  var ci = (ay[k] | 0) * GW + (ax[k] | 0);
  if (occ[ci]) occ[ci]--;          /* every removal path decrements */
  nAgents--;
  ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents];
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
  var stepSpeed = SPEED * slow;
  var stepDeposit = DEPOSIT * (0.78 + 0.22 * slow);

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

    var cf = Math.cos(h), sf = Math.sin(h);
    var F = sense(x + cf * SENS_D, y + sf * SENS_D);
    var hl = h - SENS_A, hr = h + SENS_A;
    var L = sense(x + Math.cos(hl) * SENS_D, y + Math.sin(hl) * SENS_D);
    var R = sense(x + Math.cos(hr) * SENS_D, y + Math.sin(hr) * SENS_D);
    F += (rnd() - 0.5) * SENS_NOISE;
    L += (rnd() - 0.5) * SENS_NOISE;
    R += (rnd() - 0.5) * SENS_NOISE;

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
    h += (rnd() - 0.5) * JITTER;

    var oldIdx = (y | 0) * GW + (x | 0);
    /* Speed is how much cytoplasm is behind the tip: established trail, or the
       player shoving it there. A cue does not merely aim the front, it makes it
       flow — which is the difference between leading the culture and watching
       it explore. */
    var lt = trail[oldIdx] / SPEED_REF;
    var lc = cueF[oldIdx] * CUE_FLOW;
    if (lc > lt) lt = lc;
    var spd = stepSpeed * (lt >= 1 ? 1 : VOID_SPEED + (1 - VOID_SPEED) * lt);
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
      if (tv < TRAIL_MAX) trail[cell] = tv + stepDeposit;
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
      ax[k] = ax[nAgents]; ay[k] = ay[nAgents]; ah[k] = ah[nAgents];
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
     however much far agar it holds. */
  if (e.donor && !S.fused) return false;
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

function paintField() {
  var d = imgData;
  for (var i = 0, p = 0; i < NCELL; i++, p += 4) {
    var r, g, b;
    if (wallM[i]) {
      r = 42; g = 47; b = 36;
    } else {
      r = 7; g = 9; b = 6;
      var hz = hazM[i];
      if (hz === 1) { r += 38; g += 20; b += 9; }
      else if (hz === 2) { r += 27; g += 12; b += 40; }
      /* a lit field, not an ember: the same aversion, told cold */
      else if (hz === 3) { r += 30; g += 34; b += 40; }
      var t = trail[i];
      /* The mat, where a dish is running on it. Cool, grey and much fainter
         than any hazard — it is the record of where the organism has been,
         not a thing on the plate — and it fades out under live tube, because
         under live tube it is not something the player needs to see. */
      if (SLIME_W > 0) {
        var sv = slimeF[i];
        if (sv > 0.05) {
          var thin = 1 - (t > 8 ? 1 : t * 0.125);
          if (thin > 0) {
            r += sv * 7 * thin; g += sv * 8 * thin; b += sv * 11 * thin;
          }
        }
      }
      if (t > 0.004) {
        var gi = (t * GAM_SCALE) | 0;
        if (gi >= GAMN) gi = GAMN - 1;
        var o = GAM[gi] * 3;
        r += LUT[o]; g += LUT[o + 1]; b += LUT[o + 2];
        if (r > 255) r = 255;
        if (g > 255) g = 255;
        if (b > 255) b = 255;
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

/* mode 1 = cue, 2 = retract. touchMode is the verb the on-screen pads select;
   a second finger overrides it to retract for the duration of that gesture. */
var ptr = { down: false, mode: 0, gx: 0, gy: 0 };
var touchMode = 1;
var downIds = [];      /* pointerIds currently on the stage */
var primaryId = null;  /* the one the brush follows */

function render() {
  if (!cv || !S.exp) return;
  paintField();

  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, cv.width, cv.height);

  var sx = cv.width / GW, sy = cv.height / GH;
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
    var fs = FINAL_STATE.S;
    for (var rk in fs) S[rk] = fs[rk];
    if (fs.nodeProg) S.nodeProg = fs.nodeProg.slice();
    if (fs.nodeDone) S.nodeDone = fs.nodeDone.slice();
    /* the run is a finished exhibit, whatever the snapshot said mid-frame */
    S.running = false; S.paused = false; S.over = true;
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
  FINAL_STATE = {
    trail: new Float32Array(trail),
    cueF: new Float32Array(cueF), retF: new Float32Array(retF),
    slimeF: new Float32Array(slimeF),
    n: nAgents,
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
    }
    /* Backlog past the budget is dropped: a device that cannot keep up runs
       fewer steps per real second rather than spiralling. It changes how far
       a run gets in a given wall-clock second, never what any step does. */
    if (acc > DT * budget) acc = 0;
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
