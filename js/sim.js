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
var hazM  = new Uint8Array(NCELL);     // 0 none, 1 heat, 2 quinine
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

/* colour lookup for the slime body: faint olive -> yellow -> white hot */
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
(function buildLUT() {
  var stops = [
    [0.00,   0,   0,   0],
    [0.05,  16,  18,   8],
    [0.14,  38,  40,  14],
    [0.30,  84,  80,  22],
    [0.54, 152, 138,  38],
    [0.78, 220, 204,  74],
    [1.00, 255, 246, 190]
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
})();

/* ------------------------------------------------------------
   4. run state
   ------------------------------------------------------------ */
var S = {
  exp: null, idx: -1, seed: 0,
  running: false, paused: false, over: false,
  simT: 0, peak: 0, cues: 0,
  nodeProg: null, nodeDone: null, engulfed: 0,
  hab: 0, habPeak: 0, habBuilt: -1,
  growAcc: 0, starveAcc: 0,
  shockNext: 0, shockActive: false, shockWarn: false, shocksSurvived: 0,
  shockWarned: -1, quinTime: 0, slow: 1, anticipated: false,
  ambientAt: 0, scriptIdx: 0,
  note: '', failReason: ''
};

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

function buildDish(e) {
  trail.fill(0); tmpF.fill(0); foodF.fill(0);
  cueF.fill(0); retF.fill(0);
  wallM.fill(0); hazM.fill(0); nodeAt.fill(-1);

  var i, y, x;

  for (i = 0; i < e.walls.length; i++) {
    var w = e.walls[i];
    fillRect(wallM, 1, w[0], w[1], w[2], w[3]);
  }
  for (i = 0; i < e.hazards.length; i++) {
    var hz = e.hazards[i];
    fillRect(hazM, hz.type === 'q' ? 2 : 1, hz.x, hz.y, hz.w, hz.h);
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
  nodeDist = [];
  for (var nq = 0; nq < e.nodes.length; nq++) nodeDist.push(geodesicFrom(e.nodes[nq]));

  buildFood();
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
  for (var i = 0; i < NCELL; i++) {
    var v = foodF[i] * FOODW;
    var h = hazM[i];
    if (h === 1) v -= HAZ_HEAT;
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
  return trail[i] + statF[i] + cueF[i] * CUEW - retF[i] * RETW;
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
  var heatDmg = 0.010;
  var inQuin = 0;

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

    var dead = false;
    var hz = hazM[cell];
    if (hz === 2) {
      inQuin++;
      if (quinDmg > 0 && rnd() < quinDmg) dead = true;
    } else if (hz === 1) {
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
    if (nAgents > 0 && inQuin > 0) {
      S.quinTime += DT;
      var frac = inQuin / nAgents;
      S.hab = clamp(S.hab + frac * 1.5 * DT + 0.020 * DT, 0, 1);
    } else {
      S.hab = clamp(S.hab - 0.012 * DT, 0, 1);
    }
    if (S.hab > S.habPeak) S.habPeak = S.hab;
    if (Math.abs(S.hab - S.habBuilt) > 0.03) rebuildStatic();
  }

  /* --- node engulfment --- */
  for (i = 0; i < e.nodes.length; i++) {
    if (S.nodeDone[i]) continue;
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
  if (S.engulfed >= e.nodes.length && cyclesMet(e) && !S.shockActive) { finish(true, ''); return; }
  if (e.timeLimit && S.simT >= e.timeLimit) { finish(false, 'timeout'); return; }
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

function updateShocks(e) {
  var sh = e.shock;
  if (S.shockNext === 0) S.shockNext = sh.first;

  var was = S.shockActive;
  var active = S.simT >= S.shockNext && S.simT < S.shockNext + sh.dur;
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
    S.shocksSurvived++;
    S.shockNext += sh.period;
    logLine('the air comes back. shock ' + S.shocksSurvived + ' survived.');
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
      var t = trail[i];
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
      ctx.strokeStyle = 'rgba(227,210,74,.85)';
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
    ctx.strokeStyle = ptr.mode === 2 ? 'rgba(199,75,106,.75)' : 'rgba(227,210,74,.75)';
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
  var lines = [
    'something rich to the ' + dir + '. folded in.',
    nd.label + ' engulfed — the tube to the ' + dir + ' thickens.',
    'contact ' + dir + '. that one is inside you now.'
  ];
  logLine(pick(lines), true);
  if (left === 0) logLine('all of it. every last flake.', true);
  else if (left === 1) logLine('one left.');
  flashNodeRow(i);
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
  }

  $('h-obj').textContent = objText(e);
  refreshNodeRows();
  $('h-note').textContent = noteText(e);
}

function objText(e) {
  var s = e.objShort + ' ' + S.engulfed + ' / ' + e.nodes.length;
  if (e.minShocks) s += ' · CYCLES ' + Math.min(S.shocksSurvived, e.minShocks) + ' / ' + e.minShocks;
  return s;
}

function noteText(e) {
  if (S.shockActive) return 'DRY SHOCK — hold the refuges';
  if (S.shockWarn && S.slow < 0.98) return 'thickening early — the interval has a shape';
  if (S.shockWarn) return 'humidity falling — ' + Math.max(0, Math.ceil(S.shockNext - S.simT)) + 's';
  if (e.minShocks && S.engulfed >= e.nodes.length) {
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
    nAgents = FINAL_STATE.n;
    var fs = FINAL_STATE.S;
    for (var rk in fs) S[rk] = fs[rk];
    if (fs.nodeProg) S.nodeProg = fs.nodeProg.slice();
    if (fs.nodeDone) S.nodeDone = fs.nodeDone.slice();
    /* the run is a finished exhibit, whatever the snapshot said mid-frame */
    S.running = false; S.paused = false; S.over = true;
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
  S.nodeDone = new Array(e.nodes.length);
  for (var q = 0; q < e.nodes.length; q++) S.nodeDone[q] = false;
  S.engulfed = 0;
  S.hab = 0; S.habPeak = 0; S.habBuilt = -1;
  S.growAcc = 0; S.starveAcc = 0;
  S.shockNext = e.shock ? e.shock.first : 0;
  S.shockActive = false; S.shockWarn = false; S.shocksSurvived = 0;
  S.shockWarned = -1; S.quinTime = 0; S.slow = 1; S.anticipated = false;
  S.ambientAt = 14; S.scriptIdx = 0; S.failReason = '';
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
  $('h-habwrap').style.display = e.hab ? '' : 'none';
  $('h-hab').textContent = '0%';
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
  if (e.shocks) rows.push(['Dry shocks survived', String(S.shocksSurvived)]);
  if (won && save.best[e.code] != null) rows.push(['Best run', fmtTime(save.best[e.code])]);
  /* The plate's provenance, last, the way a notebook records it: this dish is
     reproducible from that number alone — SLIME.start(idx, '#a3f2c1') runs it
     again, cell for cell, at any time-lapse setting. */
  rows.push(['Specimen line', seedLabel(S.seed)]);

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
    n: nAgents,
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
