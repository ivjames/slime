#!/usr/bin/env node
/* Glow versus ink, as numbers.
 *
 * The plate draws two things out of the same tissue: the vein LINES, stroked
 * from VEIN_BANDS, and the MASS heaped on the food, filled from BODY_STYLE
 * under the weight PAD_BUDGET builds. The complaint this answers is that they
 * do not read as one drawing system — the lines look like ink and the masses
 * look like light. That is an adjective, and this turns it into four figures
 * per layer so a change to either can be said to have worked.
 *
 * The two layers are the same yellow on the composite, so they are separated
 * by DIFFERENCE: the plate is rendered three times through SLIME.layers() —
 * whole, without the mass, without the lines — and a pixel belongs to a layer
 * if holding that layer out moved it. Everything else on the plate (the agar,
 * the haze, the food's own rings, the walls) is identical in all three and is
 * in neither mask, which is why the food marker sitting on top of a pad does
 * not have to be special-cased anywhere below.
 *
 * Lightness is CIE L*, 0..100, off the sRGB the canvas actually holds. A step
 * in L* is a step the eye can weigh; a step in alpha is not, because the same
 * alpha over the agar and over a trunk are different pictures.
 *
 *   edge   — the 10-90 distance across the layer's own boundary, in cells.
 *            For a line, measured across the stroke; for the mass, along rays
 *            out of each station. This is "hard edge" against "no edge at
 *            all", as one number each.
 *   rim    — the largest L* step the layer takes against what lies outside
 *            it, P99 and max over every boundary pixel pair. An edge in a
 *            picture is a step in a line.
 *   tones  — distinct RGB values holding at least 1% of the layer's area, and
 *            the share of the layer in its commonest six. A drawing made of
 *            flat strokes lives in a handful of tones; a bloom lives in
 *            hundreds.
 *   L*     — where the layer sits in lightness: its floor, median and ceiling,
 *            and the ceiling against the widest line's own tone. "The core is
 *            brighter than the trunks running into it" is that comparison.
 *
 *   node tools/ink.js                          # EXP-01/efe8ba at 137 s
 *   SEEDS=11f9a2 TIMES=45,120 node tools/ink.js
 *   SHOTS=/tmp/ink node tools/ink.js           # plate and per-station crops
 *   MASS=10/0/0/0,5/1/1/4 node tools/ink.js    # sweep how the mass is drawn
 *
 * MASS is `levels/ramp/rule/steps` — MASS_LEVELS, MASS_RAMP, MASS_RULE and
 * PAD_STEPS in sim.js, measured one page rather than one build each. The
 * first three are how the mass is PAINTED and change no weight; the fourth is
 * the weight itself, and `step` below is what it costs.
 *
 * Needs playwright and a chromium. Neither is committed — see tools/README.md.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CASE = process.env.CASE || 'EXP-01';
const SEEDS = (process.env.SEEDS || 'efe8ba').split(',');
const TIMES = (process.env.TIMES || '137').split(',').map(Number);
const SHOTS = process.env.SHOTS || '';
const CAP = +(process.env.CAP || 60000);
/* `levels/ramp/rule` per option — MASS_LEVELS, MASS_RAMP and MASS_RULE in
   sim.js. `as built` is whatever the checkout ships and is the default. */
const MASS = (process.env.MASS || '').split(',').filter(Boolean).map(v => {
  const m = /^(\d+)\/([01])\/([01])\/(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`MASS wants levels/ramp/rule/steps, got ${v}`);
  return { levels: +m[1], ramp: +m[2], rule: +m[3], steps: +m[4], label: m[0] };
});

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
               '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); res.end('no'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const pad = (v, n) => String(v).padStart(n);
const f2 = v => (v == null ? '  -  ' : v.toFixed(2));

/* the L* of a painted style, as the tone itself — the alpha is printed beside
   it rather than folded in, because what a level composites to depends on the
   level under it and the weight over it, and this is the ramp, not the result */
function labOf(style) {
  const m = /rgba?\(([^)]+)\)/.exec(style || '');
  if (!m) return { L: NaN, C: NaN };
  const p = m[1].split(',').map(Number);
  const lin = c => (c / 255 <= 0.04045 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
  const f = t => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116);
  const r = lin(p[0]), g = lin(p[1]), b = lin(p[2]);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  const A = 500 * (fx - fy), B = 200 * (fy - fz);
  return { L: 116 * fy - 16, C: Math.sqrt(A * A + B * B) };
}

/* Everything below runs IN the page: the plate is 2800x2000 at the harness's
   device scale and three copies of it is 67 MB of pixels, which is not a
   thing to hand across the bridge. Only the figures come back. */
function probeInPage() {
  const cv = document.getElementById('cv');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height, N = W * H;

  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  /* sRGB byte -> linear, once per byte; then CIE Lab under D65. Lightness is
     L*, and CHROMA is sqrt(a*^2 + b*^2) — the second one is here because a
     lamp is whiter at its core and ink is not, so "does this read as light"
     is partly a question about colour and not only about brightness. */
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const fLab = t => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116);

  function grab() {
    const d = g.getImageData(0, 0, W, H).data;
    const L = new Float32Array(N), C = new Float32Array(N);
    const rgb = new Uint32Array(N);
    for (let i = 0, o = 0; i < N; i++, o += 4) {
      const r = lin[d[o]], gg = lin[d[o + 1]], b = lin[d[o + 2]];
      const fx = fLab((0.4124 * r + 0.3576 * gg + 0.1805 * b) / 0.95047);
      const fy = fLab(0.2126 * r + 0.7152 * gg + 0.0722 * b);
      const fz = fLab((0.0193 * r + 0.1192 * gg + 0.9505 * b) / 1.08883);
      L[i] = 116 * fy - 16;
      const A = 500 * (fx - fy), B = 200 * (fy - fz);
      C[i] = Math.sqrt(A * A + B * B);
      rgb[i] = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
    }
    return { L, C, rgb };
  }

  return (async () => {
    const S = window.SLIME;
    S.layers({ mass: true, lines: true }); await frame();
    const all = grab();
    S.layers({ mass: false, lines: true }); await frame();
    const noMass = grab().L;
    S.layers({ mass: true, lines: false }); await frame();
    const noLines = grab().L;
    S.layers({ mass: true, lines: true }); await frame();

    /* A pixel is a layer's if holding that layer out moved it. One L* unit is
       about the smallest difference worth calling a difference; below it the
       pixel is the agar either way. */
    const MOVED = 1.0;
    const isMass = new Uint8Array(N), isLine = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (Math.abs(all.L[i] - noMass[i]) >= MOVED) isMass[i] = 1;
      if (Math.abs(all.L[i] - noLines[i]) >= MOVED) isLine[i] = 1;
    }
    /* the lines are drawn OVER the mass, so where both moved the pixel is the
       line's — that is what the eye is looking at there */
    const mass = new Uint8Array(N);
    for (let i = 0; i < N; i++) mass[i] = isMass[i] && !isLine[i] ? 1 : 0;

    /* the plate's own floor: everything neither layer touched */
    const plate = [];
    for (let i = 0; i < N; i += 7) if (!isMass[i] && !isLine[i]) plate.push(all.L[i]);
    plate.sort((a, b) => a - b);
    const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
    const floor = q(plate, 0.5);

    /* The AGAR: a pixel neither layer touched and which is as dark as the bare
       plate. A layer's edge is the step it takes against THIS — not against
       the other layer, which is a step by construction wherever an opaque
       line lies on a pad, and not against the food's own rings or the haze's
       hairlines, both of which are bright or dark marks the layers merely
       happen to lie beside. */
    const agar = new Uint8Array(N);
    for (let i = 0; i < N; i++) agar[i] = (!isMass[i] && !isLine[i] && all.L[i] <= floor + 4) ? 1 : 0;
    /* ...and not within reach of a station's marker. The marker is a cased
       disc — a DARK ring under bright bands — laid over whatever is there, so
       a pad running under one abuts agar-dark pixels that are the marker's
       casing and not the plate. Those are the marker's edge, not the layer's,
       and left in they are the whole of the mass's p99. */
    const gridW = S.grid().w, pxc = W / gridW;
    const marks = S.S.exp.nodes.map(n => [n.x * pxc, n.y * pxc])
                   .concat([[S.S.exp.inoc.x * pxc, S.S.exp.inoc.y * pxc]]);
    const MARK_R = 16 * pxc;
    for (const [mx, my] of marks) {
      const x0 = Math.max(0, Math.floor(mx - MARK_R)), x1 = Math.min(W - 1, Math.ceil(mx + MARK_R));
      const y0 = Math.max(0, Math.floor(my - MARK_R)), y1 = Math.min(H - 1, Math.ceil(my + MARK_R));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - mx, dy = y - my;
        if (dx * dx + dy * dy <= MARK_R * MARK_R) agar[y * W + x] = 0;
      }
    }

    function stats(m) {
      const vals = [], chr = [], rim = [];
      const hist = new Map();
      let area = 0, max = -1, maxAt = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (m[i]) {
            area++;
            if (i % 3 === 0) {
              vals.push(all.L[i]);
              /* chroma is only comparable between the layers at the same
                 LIGHTNESS: both fade out over the agar, and anything's chroma
                 collapses as it does. 55..75 L* is a band both of them hold a
                 lot of area in. */
              if (all.L[i] >= 55 && all.L[i] <= 75) chr.push(all.C[i]);
            }
            if (all.L[i] > max) { max = all.L[i]; maxAt = i; }
            hist.set(all.rgb[i], (hist.get(all.rgb[i]) || 0) + 1);
          }
          if (x + 1 < W) { const n = i + 1; if ((m[i] && agar[n]) || (m[n] && agar[i])) rim.push(Math.abs(all.L[i] - all.L[n])); }
          if (y + 1 < H) { const n = i + W; if ((m[i] && agar[n]) || (m[n] && agar[i])) rim.push(Math.abs(all.L[i] - all.L[n])); }
        }
      }
      vals.sort((a, b) => a - b); rim.sort((a, b) => a - b); chr.sort((a, b) => a - b);
      const counts = Array.from(hist.values()).sort((a, b) => b - a);
      const top6 = counts.slice(0, 6).reduce((s, v) => s + v, 0);
      return {
        area,
        maxAt: [maxAt % W, (maxAt / W) | 0],
        L: { lo: q(vals, 0.02), mid: q(vals, 0.5), hi: q(vals, 0.98), max },
        C: { n: chr.length, lo: q(chr, 0.1), mid: q(chr, 0.5), hi: q(chr, 0.9) },
        rim: { n: rim.length, mid: q(rim, 0.5), p99: q(rim, 0.99), max: rim[rim.length - 1] },
        tones: { distinct: hist.size, over1pct: counts.filter(c => c >= area * 0.01).length,
                 top6: +(100 * top6 / area).toFixed(1) },
      };
    }

    const grid = S.grid();
    const px = W / grid.w;          /* device pixels a cell */

    /* The mass's falloff: rays out of every station, over the pixels the mass
       actually owns. Scanning INWARD from the far end for each threshold, so
       a trunk crossing the ray or the food's own marker sitting on it cannot
       move the answer — both are simply not the mass's pixels. */
    function massEdge() {
      const e = S.S.exp, out = [];
      const stations = e.nodes.map(n => [n.x, n.y]).concat([[e.inoc.x, e.inoc.y]]);
      const RMAX = 60, NR = 360;
      for (const [cx, cy] of stations) {
        const widths = [];
        for (let k = 0; k < NR; k++) {
          const a = k * 2 * Math.PI / NR, ca = Math.cos(a), sa = Math.sin(a);
          const rs = [], ls = [];
          for (let r = 0; r <= RMAX; r += 0.25) {
            const x = Math.round((cx + ca * r) * px), y = Math.round((cy + sa * r) * px);
            if (x < 0 || y < 0 || x >= W || y >= H) break;
            const i = y * W + x;
            if (!mass[i]) continue;
            rs.push(r); ls.push(all.L[i]);
          }
          if (rs.length < 8) continue;
          const sorted = ls.slice().sort((a, b) => a - b);
          const peak = sorted[Math.floor(0.95 * sorted.length)];
          if (peak - floor < 4) continue;      /* nothing to fall off from */
          const t90 = floor + 0.9 * (peak - floor), t10 = floor + 0.1 * (peak - floor);
          let r90 = null, r10 = null;
          for (let j = rs.length - 1; j >= 0; j--) {
            if (r10 === null && ls[j] >= t10) r10 = rs[j];
            if (ls[j] >= t90) { r90 = rs[j]; break; }
          }
          if (r90 === null || r10 === null || r10 < r90) continue;
          widths.push(r10 - r90);
        }
        widths.sort((a, b) => a - b);
        out.push(widths.length ? { n: widths.length, mid: q(widths, 0.5), p90: q(widths, 0.9) }
                               : { n: 0, mid: null, p90: null });
      }
      return out;
    }

    /* A line's own edge, the same 10-90 and in the same units: every
       horizontal run of line pixels four or more wide, profiled across its
       left boundary against whatever the line is lying on there. */
    function lineEdge() {
      const widths = [];
      for (let y = 0; y < H; y += 3) {
        let x = 0;
        while (x < W) {
          if (!isLine[y * W + x]) { x++; continue; }
          let x1 = x;
          while (x1 + 1 < W && isLine[y * W + x1 + 1]) x1++;
          const run = x1 - x + 1;
          if (run >= 4 && x - 6 >= 0) {
            const mid = [];
            for (let k = x + 1; k <= x1 - 1; k++) mid.push(all.L[y * W + k]);
            mid.sort((a, b) => a - b);
            const plateau = mid[Math.floor(0.5 * mid.length)];
            const out = all.L[y * W + x - 5];
            if (plateau - out >= 4) {
              const t90 = out + 0.9 * (plateau - out), t10 = out + 0.1 * (plateau - out);
              let d90 = null, d10 = null;
              for (let d = 0; d <= 5; d++) {
                const L = all.L[y * W + x - d];
                if (d10 === null && L <= t10) d10 = d;
                if (d90 === null && L <= t90) d90 = d;
              }
              if (d90 !== null && d10 !== null && d10 >= d90) widths.push((d10 - d90) / px);
            }
          }
          x = x1 + 1;
        }
      }
      widths.sort((a, b) => a - b);
      return widths.length ? { n: widths.length, mid: q(widths, 0.5), p90: q(widths, 0.9) } : { n: 0 };
    }

    const m = stats(mass), v = stats(isLine);
    m.edge = massEdge();
    v.edge = lineEdge();
    /* the mass's falloff is measured in cells already; the rim steps are per
       device pixel, and a cell is more than one of those */
    return { px: +px.toFixed(3), grid, canvas: [W, H], floor,
             mass: m, lines: v, ink: S.ink(),
             stations: S.S.exp.nodes.map(n => ({ label: n.label, x: n.x, y: n.y }))
                        .concat([{ label: 'crumb', x: S.S.exp.inoc.x, y: S.S.exp.inoc.y }]) };
  })();
}

(async () => {
  const { chromium } = require('playwright');
  const srv = await serve(ROOT);
  const port = srv.address().port;
  const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(exe) ? exe : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  for (const seed of SEEDS) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.SLIME && window.SLIME.experiments, { timeout: 30000 });
    const idx = await page.evaluate(c => window.SLIME.experiments().findIndex(e => e.code === c), CASE);
    if (idx < 0) throw new Error(`no dish ${CASE}`);
    await page.evaluate(a => {
      window.SLIME.start(a.idx, a.seed);
      window.SLIME.turbo(8);
      window.SLIME.runTo(a.cap);
    }, { idx, seed, cap: CAP });
    for (const t of TIMES) {
      /* the same three ways to stop waiting mass.js needs, and for the same
         reason: runTo parks the dish with S.paused set and S.running TRUE */
      const reached = await page.waitForFunction(a => {
        const S = window.SLIME.S;
        if (window.SLIME.steps() >= a.cap && S.paused) return true;
        if (S.simT > 2 && !S.running) return true;
        return S.simT >= a.t;
      }, { t, cap: CAP }, { timeout: 900000, polling: 300 }).then(() => true).catch(() => false);
      await page.evaluate(() => { window.SLIME.S.paused = true; });
      const now = await page.evaluate(() => +window.SLIME.S.simT.toFixed(1));
      const ok = reached && now >= t - 0.5;
      console.log(`\n${CASE}/${seed}  t=${now}${ok ? '' : '  NOT MEASURABLE'}`);

      for (const opt of (MASS.length ? MASS : [null])) {
      const plan = await page.evaluate(o => window.SLIME.massTune(o), opt);
      const label = opt ? opt.label : 'as built';
      const w = await page.evaluate(() => window.SLIME.mass());
      console.log(`  --- ${label}  ${plan.levels} levels at trail ${plan.trail.join(',')}` +
                  `  ramp ${plan.ramp ? 'band' : 'body'}  rule ${plan.rule}  steps ${plan.steps}`);
      console.log(`  weight    step ${w.step.any}/${w.step.wide}   plate ${w.plate.pct}%` +
                  `   quads ${w.plate.quads} (${w.plate.ofPlate}%)` +
                  `   reach ${w.stations.map(st => st.crad).join(' ')}`);
      const r = await page.evaluate(probeInPage);
      const mm = r.mass, ll = r.lines;
      const cellPx = r.px;
      console.log(`  canvas ${r.canvas[0]}x${r.canvas[1]}  grid ${r.grid.w}x${r.grid.h}  ${cellPx.toFixed(2)} px a cell` +
                  `  agar L* ${f2(r.floor)}`);
      console.log(`  area      mass ${pad(mm.area, 8)} px      lines ${pad(ll.area, 8)} px`);
      console.log(`  edge 10-90 (cells)   lines ${f2(ll.edge.mid)} (p90 ${f2(ll.edge.p90)}, n=${ll.edge.n})`);
      for (let i = 0; i < mm.edge.length; i++) {
        const e = mm.edge[i];
        console.log(`                       mass ${r.stations[i].label.padEnd(8)} ` +
                    `${f2(e.mid)} (p90 ${f2(e.p90)}, n=${e.n})`);
      }
      console.log(`  rim step  (L* a device pixel, where the layer meets bare agar)`);
      console.log(`            lines p50 ${f2(ll.rim.mid)} p99 ${f2(ll.rim.p99)} max ${f2(ll.rim.max)}  (n=${ll.rim.n})`);
      console.log(`            mass  p50 ${f2(mm.rim.mid)} p99 ${f2(mm.rim.p99)} max ${f2(mm.rim.max)}  (n=${mm.rim.n})`);
      console.log(`  tones     lines ${pad(ll.tones.distinct, 6)} distinct, ${pad(ll.tones.over1pct, 3)} over 1%, top6 ${f2(ll.tones.top6)}%`);
      console.log(`            mass  ${pad(mm.tones.distinct, 6)} distinct, ${pad(mm.tones.over1pct, 3)} over 1%, top6 ${f2(mm.tones.top6)}%`);
      console.log(`  L*        lines lo ${f2(ll.L.lo)} mid ${f2(ll.L.mid)} hi ${f2(ll.L.hi)} max ${f2(ll.L.max)}`);
      console.log(`            mass  lo ${f2(mm.L.lo)} mid ${f2(mm.L.mid)} hi ${f2(mm.L.hi)} max ${f2(mm.L.max)}`);
      console.log(`  chroma    at 55-75 L*, where both layers hold area`);
      console.log(`            lines p10 ${f2(ll.C.lo)} mid ${f2(ll.C.mid)} p90 ${f2(ll.C.hi)}  (n=${ll.C.n})`);
      console.log(`            mass  p10 ${f2(mm.C.lo)} mid ${f2(mm.C.mid)} p90 ${f2(mm.C.hi)}  (n=${mm.C.n})`);
      const ladder = (styles, alphas) =>
        styles.map((st, k) => `${labOf(st).L.toFixed(0)}/${labOf(st).C.toFixed(0)}@${alphas[k]}`).join('  ');
      const rungs = styles => {
        const L = styles.map(st => labOf(st).L);
        return `${(L[L.length - 1] - L[1]).toFixed(1)} L* over ${L.length - 2} steps, ` +
               `${((L[L.length - 1] - L[1]) / (L.length - 2)).toFixed(2)} a step`;
      };
      console.log(`  ladders   (L*/chroma of the tone each level is painted in, and the alpha it is laid at)`);
      console.log(`            body  ${ladder(r.ink.body, r.ink.alpha)}`);
      console.log(`                  ${rungs(r.ink.body)}`);
      console.log(`            band  ${ladder(r.ink.bands.map(b => b.style), r.ink.bands.map(b => b.alpha))}`);
      console.log(`                  ${rungs(r.ink.bands.map(b => b.style))}`);

      if (SHOTS) {
        const base = `${CASE}-${seed}-t${pad(t, 3).replace(/ /g, '0')}-${label.replace(/\//g, '')}`;
        const f = path.join(SHOTS, `${base}-plate.png`);
        await page.locator('#cv').screenshot({ path: f });
        console.log(`  ${f}`);
        /* one station, close: the two layers' disagreement is most legible
           where a trunk runs into a pad */
        const box = await page.locator('#cv').boundingBox();
        for (const s of r.stations) {
          const sx = box.width / r.grid.w, sy = box.height / r.grid.h;
          const R = 46;
          const clip = {
            x: Math.max(box.x, box.x + (s.x - R) * sx),
            y: Math.max(box.y, box.y + (s.y - R) * sy),
            width: Math.min(box.width, 2 * R * sx),
            height: Math.min(box.height, 2 * R * sy),
          };
          const cf = path.join(SHOTS, `${base}-${s.label.replace(/\s+/g, '')}.png`);
          await page.screenshot({ path: cf, clip });
        }
        console.log(`  ${path.join(SHOTS, base)}-<station>.png`);
      }
      }
      await page.evaluate(o => window.SLIME.massTune(o), { levels: 10, ramp: 0, rule: 0, steps: 0 });
      await page.evaluate(a => { window.SLIME.S.paused = false; window.SLIME.runTo(a); }, CAP);
    }
    if (errs.length) console.log('  page errors:', errs.slice(0, 2));
    await page.close();
  }
  console.log('\n  edge: the 10-90 distance across the layer\'s own boundary, in cells (0.551 mm each)');
  console.log('  rim:  the L* step the layer takes against what lies outside it, per cell');
  console.log('  tones: distinct RGB values in the layer, and the share of it in its commonest six');
  await browser.close();
  srv.close();
})();
