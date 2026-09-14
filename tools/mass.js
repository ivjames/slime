#!/usr/bin/env node
/* What the mass layer draws, and whether it has an EDGE.
 *
 * The layer paints the tissue heaped on the food. It used to do that by
 * filling the body's contour inside a circle around each station, and a fill
 * that is opaque where the circle lands draws an arc wherever tissue crosses
 * it — which is the complaint this replaces. It now paints under a weight
 * instead: a travel budget spent in thinness, walked out from the food, with
 * no outline anywhere in it. See PAD_BUDGET in sim.js.
 *
 * Two measurements, both at a stated moment, on the same run:
 *
 *   mass  — per station, the area and reach of what is painted, in cells.
 *           `core` is at a weight of half or better, `edge` at a twentieth.
 *   step  — the largest step the layer's opacity takes between neighbouring
 *           lattice cells that are both tissue: `any` anywhere, `wide` where
 *           both are at least six cells from the tissue's edge. This is the
 *           figure the clip cannot win, and clipProbe prints what it scores:
 *           a step of its whole alpha over `in` of each circle, of which
 *           `thru` cuts tissue that carries on outside.
 *
 *   node tools/mass.js                       # EXP-01, one seed, three times
 *   TIMES=45 SEEDS=11f9a2,3039 node tools/mass.js
 *   TUNE=13@0.6,18@0.43,26@0.3 node tools/mass.js    # sweep the budget
 *   CLIP=1 node tools/mass.js                # and what the clip does there
 *   SHOTS=/tmp/shots node tools/mass.js      # write the plate as a png too
 *
 * TUNE is `budget@hold` — the budget in PAD_D_REF units and the share of it
 * held at full weight before the fade begins. The two trade against each
 * other and that is the whole choice the layer offers: hold is how far the
 * mass reaches, budget minus hold is how long it takes to fade, and a longer
 * fade is a smaller step at the cost of a wider mass.
 *
 * Needs playwright and a chromium. Neither is committed — see tools/README.md.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CASE = process.env.CASE || 'EXP-01';
const SEEDS = (process.env.SEEDS || '11f9a2').split(',');
const TIMES = (process.env.TIMES || '20,45,120').split(',').map(Number);
const CLIP = !!process.env.CLIP;
const SHOTS = process.env.SHOTS || '';
const CAP = +(process.env.CAP || 60000);
const TUNE = (process.env.TUNE || '').split(',').filter(Boolean).map(v => {
  const m = /^([\d.]+)@([\d.]+)$/.exec(v.trim());
  if (!m) throw new Error(`TUNE wants budget@hold, got ${v}`);
  return { B: +m[1], HOLD: +m[2] };
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
      /* Three ways to stop waiting, and the third is not optional: runTo
         parks the dish on its step cap with S.paused set and S.running still
         TRUE, so a predicate that only knows !S.running waits its whole
         timeout out on any seed that does not reach the moment. */
      const reached = await page.waitForFunction(a => {
        const S = window.SLIME.S;
        if (window.SLIME.steps() >= a.cap && S.paused) return true;
        if (S.simT > 2 && !S.running) return true;
        return S.simT >= a.t;
      }, { t, cap: CAP }, { timeout: 900000, polling: 300 }).then(() => true).catch(() => false);
      /* hold the plate still: a paused dish still repaints, and a tune has to
         land on a frame before the shot is of it */
      await page.evaluate(() => { window.SLIME.S.paused = true; });
      const now = await page.evaluate(() => +window.SLIME.S.simT.toFixed(1));
      const ok = reached && now >= t - 0.5;
      console.log(`\n${CASE}/${seed}  t=${now}${ok ? '' : '  NOT MEASURABLE'}`);
      if (CLIP) {
        const clip = await page.evaluate(() => ({ mass: window.SLIME.clipProbe(), skirt: window.SLIME.clipProbe(2) }));
        for (const [name, rows] of [['clip mass ', clip.mass], ['clip skirt', clip.skirt]]) {
          for (const c of rows) {
            console.log(`  ${name} ${c.label.padEnd(8)} reach ${pad(c.reach, 5)} of cap ${pad(c.cap, 5)}` +
              `  on tissue ${c.in.toFixed(3)}  cutting it ${c.thru.toFixed(3)}`);
          }
        }
      }
      for (const tune of (TUNE.length ? TUNE : [null])) {
        const r = await page.evaluate(async o => {
          if (o) window.SLIME.padTune(o);
          await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
          return window.SLIME.mass();
        }, tune);
        const lbl = tune ? `${tune.B}@${tune.HOLD}` : 'as built';
        console.log(`  ${lbl.padEnd(9)} ` +
          r.stations.map(s => `${s.label.replace('flake ', '')}:${pad(s.core, 4)}/${pad(s.crad, 4)}`).join(' ') +
          `  plate ${r.plate.pct}%  step ${r.step.any}/${r.step.wide}`);
        if (SHOTS) {
          const slug = tune ? `${tune.B}h${tune.HOLD}` : 'built';
          const f = path.join(SHOTS, `${CASE}-${seed}-t${pad(t, 3).replace(/ /g, '0')}-${slug}.png`);
          await page.locator('#cv').screenshot({ path: f });
          console.log(`            ${f}`);
        }
      }
      await page.evaluate(a => { window.SLIME.S.paused = false; window.SLIME.runTo(a); }, CAP);
    }
    if (errs.length) console.log('  page errors:', errs.slice(0, 2));
    await page.close();
  }
  console.log('\n  core/crad: cells at a weight of half or better, and the furthest of them, from the station');
  console.log('  step: the largest opacity step between neighbouring lattice cells (any / where the tissue is wide)');
  await browser.close();
  srv.close();
})();
