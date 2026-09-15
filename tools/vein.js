#!/usr/bin/env node
/* Does a station wearing a mass have a vein drawn into it?
 *
 * The complaint: a pad two-thirds covered by a puddle that no bright line
 * reaches — tissue plainly on the food, and nothing on the plate saying how
 * the organism got there. The mass layer and the line layer are drawn from
 * different state (PAD_BUDGET walks the body's film from the food; the tree
 * grows into the sim's own trail), so a station can carry one and not the
 * other. This counts how often, across seeds and moments.
 *
 * SLIME.tree() reports both halves off one walk. Per station:
 *
 *   core/crad  the mass, as mass() reports it
 *   nearL      cells to the nearest LIVE tree node, -1 if none within 60
 *   inC        live nodes inside the drawn mass; ghC ghosts there
 *   wmax/band  the widest live node inside it, and the VEIN_BANDS index it
 *              strokes in — band 0 is a 0.34-cell hairline
 *   spine      the chain home: segments, the thinnest LIVE width on it, how
 *              many are drawn as ghost, how many are drawn not at all
 *
 * The verdict per station, printed in the last column:
 *
 *   ISLAND   a mass is drawn and no live node stands in it
 *   FAINT    a live node stands in it but the widest is a band-0 hairline
 *   GHOST    the widest one's chain home crosses a ghosted segment
 *   CUT      the chain home crosses a segment the painter drops (a wall)
 *   ok       a live node in the mass, band 1 or better, chain home solid
 *
 * Sampling every DT seconds turns the verdicts into the figure a fix has to
 * move: per station, the moment the MASS first appears, the moment a live
 * tree node first stands inside it, and the gap between them. That gap is
 * the defect's duration and does not depend on where the samples fell.
 *
 *   node tools/vein.js
 *   T0=10 T1=150 DT=5 node tools/vein.js     # the scan, by default
 *   TIMES=20,45,120 node tools/vein.js       # or just these moments
 *   SEEDS=efe8ba,11f9a2 node tools/vein.js
 *   ROWS=1 node tools/vein.js                # every station at every moment
 *   SHOTS=/tmp/shots node tools/vein.js      # write the plate as a png too
 *   CASE=EXP-02 node tools/vein.js
 *   LV=0 node tools/vein.js                  # and what the tree does if it
 *                                            # grows into the level the mass
 *                                            # walks over instead of its own
 *
 * Needs playwright and a chromium. Neither is committed — see tools/README.md.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CASE = process.env.CASE || 'EXP-01';
const SEEDS = (process.env.SEEDS || 'efe8ba,11f9a2,3039,a3f2c1').split(',');
const T0 = +(process.env.T0 || 10), T1 = +(process.env.T1 || 150), DT = +(process.env.DT || 5);
const TIMES = process.env.TIMES ? process.env.TIMES.split(',').map(Number)
  : Array.from({ length: Math.floor((T1 - T0) / DT) + 1 }, (_, i) => T0 + i * DT);
const SHOTS = process.env.SHOTS || '';
const ROWS = !!process.env.ROWS;
/* Grid cells of mass, at a weight of half or better, below which a station is
   not yet wearing a puddle anyone would ask about. 100 cells is a disc about
   5.6 cells across the radius — 3.1 mm on the README's 0.551 mm a cell. The
   station the complaint came from was carrying 480 when it was photographed.
   Every count and every onset below is against this; set MASSMIN=0 to count
   the first speck instead. */
const MASSMIN = +(process.env.MASSMIN === undefined ? 100 : process.env.MASSMIN);
/* the tree's growth level, as an index into BODY_LEVELS. Set before start,
   because the tree records what the trail was as it grew. Empty is as built. */
const LV = process.env.LV === undefined ? null : +process.env.LV;
const CAP = +(process.env.CAP || 60000);
const MM = 0.551;   /* mm a grid cell is, per the README */

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

function verdict(s) {
  if (!(s.core >= MASSMIN)) return '';
  if (s.inC === 0) return 'ISLAND';
  if (!s.spine) return 'ISLAND';
  if (s.spine.cut > 0) return 'CUT';
  if (s.spine.ghost > 0) return 'GHOST';
  if (s.band < 1) return 'FAINT';
  return 'ok';
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
  const tally = {};
  const gaps = [];      /* one row per station that ever wore a mass */
  let massed = 0;
  for (const seed of SEEDS) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.SLIME && window.SLIME.experiments, { timeout: 30000 });
    const idx = await page.evaluate(c => window.SLIME.experiments().findIndex(e => e.code === c), CASE);
    if (idx < 0) throw new Error(`no dish ${CASE}`);
    await page.evaluate(a => {
      if (a.lv !== null) window.SLIME.treeTune({ LV: a.lv });
      window.SLIME.start(a.idx, a.seed);
      window.SLIME.turbo(8);
      window.SLIME.runTo(a.cap);
    }, { idx, seed, cap: CAP, lv: LV });
    for (const t of TIMES) {
      /* runTo parks the dish on its step cap with S.paused set and S.running
         still TRUE, so a predicate that only knows !S.running waits its whole
         timeout out on a seed that never reaches the moment — see mass.js */
      const reached = await page.waitForFunction(a => {
        const S = window.SLIME.S;
        if (window.SLIME.steps() >= a.cap && S.paused) return true;
        if (S.simT > 2 && !S.running) return true;
        return S.simT >= a.t;
      }, { t, cap: CAP }, { timeout: 900000, polling: 300 }).then(() => true).catch(() => false);
      await page.evaluate(() => { window.SLIME.S.paused = true; });
      const now = await page.evaluate(() => +window.SLIME.S.simT.toFixed(1));
      const ok = reached && now >= t - 0.5;
      const r = await page.evaluate(async () => {
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        return window.SLIME.tree();
      });
      if (ROWS) console.log(`\n${CASE}/${seed}  t=${now}${ok ? '' : '  NOT MEASURABLE'}` +
        `   nodes ${r.nodes.n} (${r.nodes.live} live, ${r.nodes.ghost} ghost)` +
        `   tissue joined to the drop: ${r.levels.treeCells} cells at the tree's ${r.levels.tree},` +
        ` ${r.levels.massCells} at the mass's ${r.levels.mass}`);
      for (const s of r.stations) {
        const v = verdict(s);
        const key = `${seed}/${s.label}`;
        let g = gaps.find(q => q.key === key);
        if (!g) gaps.push(g = { key, mass: -1, vein: -1, worst: 0, worstAt: 0, seen: [] });
        if (s.core >= MASSMIN) {
          massed++; tally[v] = (tally[v] || 0) + 1;
          if (g.mass < 0) g.mass = now;
          if (g.vein < 0 && s.inC > 0) g.vein = now;
          if (v !== 'ok') g.seen.push(v);
          if (s.inC === 0 && s.nearL > g.worst) { g.worst = s.nearL; g.worstAt = now; }
        }
        if (!ROWS) continue;
        const sp = s.spine
          ? `spine ${pad(s.spine.n, 3)} minw ${s.spine.minw.toFixed(2)}/b${s.spine.minband}` +
            ` gh ${pad(s.spine.ghost, 2)} cut ${pad(s.spine.cut, 2)}${s.spine.root ? '' : ' NOROOT'}`
          : 'spine   -';
        console.log(`  ${s.label.replace('flake ', 'f').padEnd(7)} prog ${s.prog.toFixed(2)}` +
          `  core ${pad(s.core, 5)} crad ${pad(s.crad, 5)}` +
          `  nearL ${pad(s.nearL, 5)} (${pad((s.nearL * MM).toFixed(1), 5)} mm)` +
          `  in ${pad(s.inC, 3)}/gh ${pad(s.ghC, 3)}  wmax ${s.wmax.toFixed(2)}/b${s.band}` +
          `  carry ${pad(s.carry, 2)}  ${sp}` +
          `  joined tree ${s.tLv.disc.toFixed(2)} mass ${s.mLv.disc.toFixed(2)}  ${v}`);
      }
      if (SHOTS) {
        const f = path.join(SHOTS, `${CASE}-${seed}-t${pad(t, 3).replace(/ /g, '0')}.png`);
        await page.locator('#cv').screenshot({ path: f });
        console.log(`  ${f}`);
      }
      await page.evaluate(a => { window.SLIME.S.paused = false; window.SLIME.runTo(a); }, CAP);
    }
    if (errs.length) console.log('  page errors:', errs.slice(0, 2));
    await page.close();
  }
  console.log(`\n${CASE}: ${massed} station-moments carrying a mass of ${MASSMIN}+ cells, sampled every ${DT}s:`);
  for (const k of ['ok', 'FAINT', 'GHOST', 'CUT', 'ISLAND']) {
    if (!tally[k]) continue;
    console.log(`    ${k.padEnd(7)} ${pad(tally[k], 4)}  ${pad((100 * tally[k] / massed).toFixed(1), 5)}%`);
  }
  console.log('\n  per station: when the mass arrives, when a vein arrives, and the gap');
  let worstGap = 0, nGap = 0, sumGap = 0;
  for (const g of gaps) {
    if (g.mass < 0) continue;
    const gap = g.vein < 0 ? Infinity : g.vein - g.mass;
    if (gap > 0) { nGap++; sumGap += (gap === Infinity ? T1 - g.mass : gap); }
    if (gap > worstGap) worstGap = gap;
    console.log(`    ${g.key.padEnd(22)} mass t=${pad(g.mass, 5)}  vein t=${pad(g.vein < 0 ? 'never' : g.vein, 5)}` +
      `  gap ${pad(gap === Infinity ? '>' + (T1 - g.mass) : gap.toFixed(1), 6)} s` +
      `  worst reach ${pad(g.worst.toFixed(1), 5)} cells (${pad((g.worst * MM).toFixed(1), 5)} mm) at t=${g.worstAt}`);
  }
  console.log(`\n  ${nGap} of ${gaps.filter(g => g.mass >= 0).length} stations wore a mass before any vein reached it;` +
    ` mean gap ${(nGap ? sumGap / nGap : 0).toFixed(1)}s, worst ${worstGap === Infinity ? 'never closed' : worstGap.toFixed(1) + 's'}.`);
  console.log('  ISLAND: a mass is drawn and no live tree node stands inside it.');
  console.log('  FAINT:  a live node stands in it, and the widest is a band-0 hairline (0.34 cells = 0.19 mm).');
  await browser.close();
  srv.close();
})();
