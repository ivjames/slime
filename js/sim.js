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
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

/* ------------------------------------------------------------
   1. simulation constants
   ------------------------------------------------------------ */
var GW = 420, GH = 260, NCELL = GW * GH;   // internal grid resolution
var MAXA = 14000;                          // hard agent ceiling (typed array size)
var DT = 1 / 60;                           // fixed sim timestep

var SENS_D = 7.0;      // sensor distance, cells
var SENS_A = 0.44;     // sensor half-angle, rad (~25 deg)
var TURN   = 0.42;     // max turn per step, rad
var SPEED  = 0.62;     // cells per step

var DEPOSIT   = 0.34;  // trail laid per agent per step
var TRAIL_MAX = 6.0;
var DECAY     = 0.962; // per-frame trail decay

var FOODW = 15.0;      // weight of the static food attractant
var CUEW  = 9.0;       // weight of the player's growth cue
var RETW  = 10.0;      // weight of the player's retract field
var WALL_PEN = -900;   // sensed cost of a wall cell

var CUE_DECAY = 0.905; // player fields dissipate after release
/* Brush radius. This has to be MUCH larger than the 7-cell sensor reach: a cue
   is only sensed inside its own footprint, so a small brush laid even 25 cells
   off the slime edge is invisible to it and the front never moves. The radius
   is the range at which the player can lead the organism. */
var CUE_R = 52;

var HAZ_HEAT = 1.15;   // repulsion of a heat zone
var HAZ_QUIN = 0.72;   // repulsion of a quinine zone (scaled by 1 - habituation)

var SPENT_FOOD = 0.30; // an engulfed node's remaining pull (a refuge, not a beacon)
var SPENT_FALL = 60;   // and only over this reach, so spent food cannot outbid fresh
var MAX_ENGULF_RATE = 1 / 120; // a node takes >= 2s to consume however big the front
var ENGULF_SOFT = 45;  // density gate: a trickle of agents barely counts
var ENGULF_DECAY = 0.0045; // an abandoned node re-forms: commit, or lose the ground
var LUT_SCALE = 52;    // trail value -> gradient index multiplier

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
    start: 900, cap: 5200, sustain: 1500, grow: 150, starve: 28, grace: 26,
    timeLimit: 0, hab: false, shocks: false,
    script: [
      { t: 1.5, hi: true, text: 'hold the pointer on the agar — the front flows toward the cue.' },
      { t: 6, hi: true, text: 'right-click or shift pulls cytoplasm back out of a region.' },
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
    start: 950, cap: 5200, sustain: 2000, grow: 150, starve: 22, grace: 58,
    timeLimit: 280, hab: false, shocks: false,
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
    start: 1000, cap: 6400, sustain: 900, grow: 170, starve: 26, grace: 30,
    timeLimit: 320, hab: false, shocks: false,
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
    start: 1200, cap: 5400, sustain: 1700, grow: 155, starve: 20, grace: 42,
    timeLimit: 330, hab: true, shocks: false,
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
    obj: 'Engulf every flake and outlast the dry cycles.',
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
    start: 1100, cap: 5800, sustain: 1300, grow: 160, starve: 26, grace: 28,
    timeLimit: 0, hab: false, shocks: true,
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

var ax = new Float32Array(MAXA);
var ay = new Float32Array(MAXA);
var ah = new Float32Array(MAXA);
var nAgents = 0;

/* colour lookup for the slime body: faint olive -> yellow -> white hot */
var LUT = new Uint8Array(256 * 3);
(function buildLUT() {
  var stops = [
    [0.00,   0,   0,   0],
    [0.10,  20,  24,   9],
    [0.28,  72,  70,  20],
    [0.52, 148, 134,  36],
    [0.76, 218, 202,  72],
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
  exp: null, idx: -1,
  running: false, paused: false, over: false,
  simT: 0, peak: 0, cues: 0,
  nodeProg: null, nodeDone: null, engulfed: 0,
  hab: 0, habPeak: 0, habBuilt: -1,
  growAcc: 0, starveAcc: 0,
  shockNext: 0, shockActive: false, shockWarn: false, shocksSurvived: 0,
  shockWarned: -1, quinTime: 0,
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
     nearest flake is smellable and everything beyond has to be led there. */
  var e = S.exp, FALL = 95;
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
  var R = 9;
  var guard = 0;
  while (nAgents < n && guard < n * 40) {
    guard++;
    var a = Math.random() * Math.PI * 2;
    var d = Math.sqrt(Math.random()) * R;
    var x = e.inoc.x + Math.cos(a) * d;
    var y = e.inoc.y + Math.sin(a) * d;
    if (x < 1 || y < 1 || x >= GW - 1 || y >= GH - 1) continue;
    if (wallM[(y | 0) * GW + (x | 0)]) continue;
    ax[nAgents] = x; ay[nAgents] = y;
    ah[nAgents] = Math.random() * Math.PI * 2;
    nAgents++;
  }
}

function spawnAgent() {
  if (nAgents <= 0 || nAgents >= MAXA) return;
  /* bias toward the richest of three random parents */
  var best = -1, bestV = -1e9;
  for (var t = 0; t < 3; t++) {
    var k = (Math.random() * nAgents) | 0;
    var ci = ((ay[k] | 0) * GW + (ax[k] | 0));
    var v = foodF[ci];
    if (v > bestV) { bestV = v; best = k; }
  }
  if (best < 0) return;
  for (var tries = 0; tries < 6; tries++) {
    var nx = ax[best] + (Math.random() - 0.5) * 8;
    var ny = ay[best] + (Math.random() - 0.5) * 8;
    if (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1) continue;
    if (wallM[(ny | 0) * GW + (nx | 0)]) continue;
    ax[nAgents] = nx; ay[nAgents] = ny;
    ah[nAgents] = Math.random() * Math.PI * 2;
    nAgents++;
    return;
  }
}

function killRandom() {
  if (nAgents <= 0) return;
  var k = (Math.random() * nAgents) | 0;
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
  /* horizontal 1-2-1 into tmpF */
  for (y = 0; y < GH; y++) {
    row = y * GW;
    for (x = 0; x < GW; x++) {
      i = row + x;
      var l = x > 0 ? trail[i - 1] : trail[i];
      var r = x < GW - 1 ? trail[i + 1] : trail[i];
      tmpF[i] = 0.25 * l + 0.5 * trail[i] + 0.25 * r;
    }
  }
  /* vertical 1-2-1 back into trail, with decay, and player fields decayed too */
  for (y = 0; y < GH; y++) {
    row = y * GW;
    var up = y > 0 ? row - GW : row;
    var dn = y < GH - 1 ? row + GW : row;
    for (x = 0; x < GW; x++) {
      i = row + x;
      var v = (0.25 * tmpF[up + x] + 0.5 * tmpF[i] + 0.25 * tmpF[dn + x]) * DECAY;
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

  var shockOn = S.shockActive;
  var shockDmg = e.shock ? e.shock.dmg : 0;
  var quinDmg = 0.050 * (1 - S.hab);
  var heatDmg = 0.010;
  var inQuin = 0;

  k = 0;
  while (k < nAgents) {
    var x = ax[k], y = ay[k], h = ah[k];

    var cf = Math.cos(h), sf = Math.sin(h);
    var F = sense(x + cf * SENS_D, y + sf * SENS_D);
    var hl = h - SENS_A, hr = h + SENS_A;
    var L = sense(x + Math.cos(hl) * SENS_D, y + Math.sin(hl) * SENS_D);
    var R = sense(x + Math.cos(hr) * SENS_D, y + Math.sin(hr) * SENS_D);

    if (F >= L && F >= R) {
      h += (Math.random() - 0.5) * 0.95;
    } else if (L > R) {
      h -= TURN * (0.55 + Math.random() * 0.75);
    } else if (R > L) {
      h += TURN * (0.55 + Math.random() * 0.75);
    } else {
      h += (Math.random() - 0.5) * TURN * 2;
    }

    var nx = x + Math.cos(h) * SPEED;
    var ny = y + Math.sin(h) * SPEED;

    if (nx < 1 || ny < 1 || nx >= GW - 1 || ny >= GH - 1 ||
        wallM[(ny | 0) * GW + (nx | 0)]) {
      /* blocked: stay put, pick a fresh heading */
      h = Math.random() * Math.PI * 2;
      ah[k] = h;
      k++;
      continue;
    }

    ax[k] = nx; ay[k] = ny; ah[k] = h;

    var idx = (ny | 0) * GW + (nx | 0);
    var tv = trail[idx];
    if (tv < TRAIL_MAX) trail[idx] = tv + DEPOSIT;

    var ni = nodeAt[idx];
    if (ni >= 0) nodeHits[ni]++;

    var dead = false;
    var hz = hazM[idx];
    if (hz === 2) {
      inQuin++;
      if (quinDmg > 0 && Math.random() < quinDmg) dead = true;
    } else if (hz === 1) {
      if (Math.random() < heatDmg) dead = true;
    }
    if (!dead && shockOn) {
      var safe = (ni >= 0 && S.nodeDone[ni]);
      if (!safe && Math.random() < shockDmg) dead = true;
    }

    if (dead) {
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
    var req = 40 * nd.r * nd.r;
    var gain = hits / req;
    if (gain > MAX_ENGULF_RATE) gain = MAX_ENGULF_RATE;
    /* Density gate. Engulfing needs the front actually delivered onto the
       flake, so a stray handful crawls while a real front is quick — a smooth
       curve rather than a threshold, which a thin corridor front cannot clear. */
    S.nodeProg[i] = clamp(S.nodeProg[i] + gain * (hits / (hits + ENGULF_SOFT)), 0, 1);
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
  if (S.engulfed >= e.nodes.length) { finish(true, ''); return; }
  if (e.timeLimit && S.simT >= e.timeLimit) { finish(false, 'timeout'); return; }
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
      if (t > 0.02) {
        var li = (t * LUT_SCALE) | 0;
        if (li > 255) li = 255;
        var o = li * 3;
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

var ptr = { down: false, mode: 0, gx: 0, gy: 0 }; /* mode 1 = cue, 2 = retract */

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
    logLine(s.text, !!s.hi);
    S.scriptIdx++;
  }
  /* ambient mutterings */
  if (S.simT >= S.ambientAt) {
    S.ambientAt = S.simT + 17 + Math.random() * 12;
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

function updateHUD() {
  if (!S.exp) return;
  $('h-time').textContent = fmtTime(S.simT);

  if ((hudTick++ % 4) !== 0) return;

  var e = S.exp;
  $('h-mass').textContent = fmtNum(nAgents);
  var pct = clamp(nAgents / e.cap * 100, 0, 100);
  var bar = $('h-massbar');
  bar.style.width = pct.toFixed(1) + '%';
  var mwrap = bar.parentNode.parentNode;
  if (nAgents < 380) {
    if (mwrap.className.indexOf('crit') < 0) mwrap.className = 'meter mass crit';
  } else if (mwrap.className.indexOf('crit') >= 0) {
    mwrap.className = 'meter mass';
  }

  if (e.hab) {
    $('h-hab').textContent = Math.round(S.hab * 100) + '%';
    $('h-habbar').style.width = (S.hab * 100).toFixed(1) + '%';
  }

  $('h-obj').textContent = e.objShort + ' ' + S.engulfed + ' / ' + e.nodes.length;
  refreshNodeRows();
  $('h-note').textContent = noteText(e);
}

function noteText(e) {
  if (S.shockActive) return 'DRY SHOCK — hold the refuges';
  if (S.shockWarn) return 'humidity falling — ' + Math.max(0, Math.ceil(S.shockNext - S.simT)) + 's';
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
  if (nAgents < 500) return 'cytoplasm critically low';
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
var SCREENS = ['scr-title', 'scr-brief', 'scr-sim', 'scr-result'];

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

function startRun(i) {
  var e = EXPERIMENTS[i];
  S.exp = e; S.idx = i;
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
  S.shockWarned = -1; S.quinTime = 0;
  S.ambientAt = 14; S.scriptIdx = 0; S.failReason = '';

  buildDish(e);
  inoculate(e);

  ptr.down = false; ptr.mode = 0;

  $('log').innerHTML = '';
  $('h-code').textContent = e.code + ' · ' + e.name;
  $('h-obj').textContent = e.objShort + ' 0 / ' + e.nodes.length;
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

  lastTs = 0; acc = 0;
  if (!raf) raf = window.requestAnimationFrame(frame);
}

function stopRun() {
  S.running = false;
  if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
}

function setPaused(p) {
  if (!S.running || S.over) return;
  S.paused = !!p;
  $('pauseveil').classList.toggle('on', S.paused);
}

function finish(won, reason) {
  if (S.over) return;
  S.over = true;
  S.running = false;
  S.failReason = reason;
  stopRun();

  var e = S.exp;
  if (won) {
    var prev = save.best[e.code];
    if (!prev || S.simT < prev) save.best[e.code] = S.simT;
    save.done[e.code] = true;
    writeSave();
  }
  showResult(won);
}

/* ---------- result ---------- */
function showResult(won) {
  var e = S.exp;
  $('r-code').textContent = e.code + ' · ' + e.name;
  $('r-head').textContent = won ? 'Result logged' : 'Culture lost';

  var body = won ? e.win : e.lose;
  if (!won && S.failReason === 'timeout') {
    body = 'The plate reached its scheduled end with the network incomplete. ' + e.lose;
  } else if (!won && S.failReason === 'starved') {
    body = 'The culture has starved. ' + e.lose;
  } else if (!won) {
    body = e.lose;
  }
  $('r-body').textContent = body;

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

  var stats = $('r-stats');
  stats.innerHTML = '';
  for (var i = 0; i < rows.length; i++) {
    var d = document.createElement('div');
    var k = document.createElement('span');
    k.className = 'mono-dim';
    k.textContent = rows[i][0] + ' — ';
    d.appendChild(k);
    d.appendChild(document.createTextNode(rows[i][1]));
    stats.appendChild(d);
  }

  var next = $('r-next');
  var hasNext = won && S.idx < EXPERIMENTS.length - 1;
  next.textContent = hasNext ? 'Next experiment' : 'Schedule';
  next.dataset.mode = hasNext ? 'next' : 'menu';

  show('scr-result');
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
    if (ptr.down) paintBrush(ptr.gx, ptr.gy, ptr.mode);
    acc += dt;
    var steps = 0;
    while (acc >= DT && steps < 4 && S.running) { step(); acc -= DT; steps++; }
    if (acc > DT * 4) acc = 0;
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

function bindInput() {
  var stage = $('stage');

  stage.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  stage.addEventListener('pointerdown', function (ev) {
    if (!S.running) return;
    var g = toGrid(ev);
    if (!g) return;
    ev.preventDefault();
    ptr.mode = (ev.button === 2 || ev.shiftKey || ev.ctrlKey) ? 2 : 1;
    ptr.down = true;
    ptr.gx = g.x; ptr.gy = g.y;
    if (ptr.mode === 1) S.cues++;
    try { stage.setPointerCapture(ev.pointerId); } catch (err) { /* not fatal */ }
  });

  window.addEventListener('pointermove', function (ev) {
    if (!ptr.down) return;
    var g = toGrid(ev);
    if (!g) return;
    ev.preventDefault();
    ptr.gx = g.x; ptr.gy = g.y;
  }, { passive: false });

  function release(ev) {
    if (!ptr.down) return;
    ptr.down = false;
    if (ev && ev.pointerId != null) {
      try { stage.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
    }
  }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', function () { ptr.down = false; });

  document.addEventListener('keydown', function (ev) {
    if (!$('scr-sim').classList.contains('on')) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      setPaused(!S.paused);
    } else if (ev.code === 'KeyR') {
      ev.preventDefault();
      if (S.idx >= 0) startRun(S.idx);
    } else if (ev.code === 'Escape') {
      ev.preventDefault();
      goTitle();
    }
  });

  window.addEventListener('resize', function () {
    if ($('scr-sim').classList.contains('on')) resizeCanvas();
  });
}

/* ------------------------------------------------------------
   18. wiring + boot
   ------------------------------------------------------------ */
function bindButtons() {
  $('b-go').addEventListener('click', function () { startRun(briefIdx); });
  $('b-back').addEventListener('click', goTitle);
  $('s-abort').addEventListener('click', goTitle);
  $('r-retry').addEventListener('click', function () { startRun(S.idx); });
  $('r-menu').addEventListener('click', goTitle);
  $('r-next').addEventListener('click', function () {
    if (this.dataset.mode === 'next' && S.idx < EXPERIMENTS.length - 1) {
      stopRun();
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
}

function init() {
  loadSave();
  initCanvas();
  bindInput();
  bindButtons();
  renderTitle();
  show('scr-title');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
