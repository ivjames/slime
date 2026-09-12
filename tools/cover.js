#!/usr/bin/env node
/* How much of its food the culture is standing ON.
 *
 * The mass layer draws pads and the drop at the origin by tracing a contour of
 * the body's field, so what it can draw is bounded by what is above the level
 * it traces at. This answers the question that follows: at that level, how much
 * of each flake — and of the little disc the food itself is drawn as — is
 * covered. A flake whose dot is uncovered is a flake the plate will draw the
 * culture sitting BESIDE, whatever the simulation has on it.
 *
 * The measurement 67e4a7a got wrong, and f50f3f8 reverted it for: that one
 * compared a band-weighted figure at one instant against a whole-disc fraction
 * and called the difference an improvement. There is one figure here, it is a
 * plain fraction of a disc, and the moment it is taken at is stated.
 *
 *   node tools/cover.js                        # win + 15 s, four seeds
 *   AT=59 node tools/cover.js                  # at a sim time instead
 *   LEVELS=1 node tools/cover.js               # sweep the traced level
 *   CASE=EXP-03 SEEDS=3039 node tools/cover.js
 *
 * A dish that does not reach its win inside CAP steps is reported as such and
 * left out of the summary: an unwon dish has no "after the last one goes down"
 * to measure at, and averaging it in would quietly answer a different question.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CASE = process.env.CASE || 'EXP-01';
const SEEDS = (process.env.SEEDS || '85b797,3039,a1b2,7f31').split(',');
const AT = process.env.AT ? +process.env.AT : 0;   /* 0 = at the win, + AFTER */
const AFTER = process.env.AFTER ? +process.env.AFTER : 15;
const LEVELS = !!process.env.LEVELS;
const CAP = +(process.env.CAP || 60000);

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

function stat(a) {
  const n = a.length;
  if (!n) return { n: 0 };
  const m = a.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (n > 1 ? n - 1 : 1));
  return { n, mean: +m.toFixed(3), sd: +sd.toFixed(3), min: +Math.min.apply(null, a).toFixed(3),
           max: +Math.max.apply(null, a).toFixed(3) };
}

(async () => {
  const { chromium } = require('playwright');
  const srv = await serve(ROOT);
  const port = srv.address().port;
  const browser = await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const rows = [];
  for (const seed of SEEDS) {
    const page = await browser.newPage({ viewport: { width: 960, height: 1200 } });
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
    /* the plate keeps moving for WIN_HOLD after the win, which is what makes
       "the win plus fifteen" a moment that exists to be sampled */
    const reached = await page.waitForFunction(a => {
      const S = window.SLIME.S;
      if (a.at) return S.simT >= a.at || (S.simT > 2 && !S.running);
      return (S.holdT0 >= 0 && S.simT - S.holdT0 >= a.after) || (S.simT > 2 && !S.running);
    }, { at: AT, after: AFTER }, { timeout: 900000 }).then(() => true).catch(() => false);
    const r = await page.evaluate(n => {
      const S = window.SLIME.S;
      const o = { t: +S.simT.toFixed(1), won: S.holdT0 >= 0, cover: window.SLIME.cover() };
      if (n) { o.levels = []; for (let i = 0; i < n; i++) o.levels.push(window.SLIME.cover(i)); }
      return o;
    }, LEVELS ? 7 : 0);
    r.seed = seed;
    r.ok = reached && (AT ? true : r.won);
    rows.push(r);
    console.log(`${seed} ${r.ok ? 'ok ' : 'NOT MEASURABLE'} t=${r.t}  ` +
      r.cover.map(c => `${c.label} ${c.disc.toFixed(3)}/${c.dot.toFixed(3)}`).join('  '));
    if (r.levels) {
      for (let i = 0; i < r.levels.length; i++) {
        console.log(`   level ${i}  dot ` + r.levels[i].map(c => c.dot.toFixed(2)).join(' '));
      }
    }
    if (errs.length) console.log('   page errors:', errs.slice(0, 2));
    await page.close();
  }
  const use = rows.filter(r => r.ok);
  const flakes = [], crumbs = [];
  for (const r of use) for (const c of r.cover) (c.label === 'crumb' ? crumbs : flakes).push(c);
  console.log(`\n${CASE} · ${use.length}/${rows.length} runs measured · ` +
    (AT ? `at ${AT}s` : `win + ${AFTER}s`) + '  (disc / dot, fraction covered)');
  console.log('  flake disc', JSON.stringify(stat(flakes.map(c => c.disc))));
  console.log('  flake dot ', JSON.stringify(stat(flakes.map(c => c.dot))));
  console.log('  crumb disc', JSON.stringify(stat(crumbs.map(c => c.disc))));
  console.log('  crumb dot ', JSON.stringify(stat(crumbs.map(c => c.dot))));
  if (process.env.OUT) { fs.writeFileSync(process.env.OUT, JSON.stringify(rows, null, 1)); console.log('wrote', process.env.OUT); }
  await browser.close();
  srv.close();
})();
