#!/usr/bin/env node
/* What a change did to the DISH, as opposed to what it did to the clock.
 *
 * determinism.js answers "is this the same plate". This answers the question
 * that matters once you have deliberately changed the plate: does it still get
 * won, and how fast. A sweep that halves a cost and leaves a dish unwinnable
 * is not an optimisation.
 *
 * Runs each case to its own end condition — win, starve, ratio, clock — and
 * reports the outcome, the run clock the verdict is scored on, and the mark.
 * Cases run in parallel pages: outcomes are deterministic, so nothing here
 * depends on how much CPU any one of them got.
 *
 *   node tools/outcome.js --label base --out /tmp/a.json
 *   node tools/outcome.js --compare /tmp/a.json /tmp/b.json
 *
 * CASES may name a dish with no seed (EXP-01) to take three fixed seeds of it.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* Above the longest dish clock, not a round number: the largest timeLimit in
   EXPERIMENTS is 900 sim-seconds, which at 60 steps a second is 54,000 steps.
   A cap under that cannot be reached by a LOSING run of such a dish — it would
   report CAPPED instead of the `timeout` verdict the dish actually reaches, and
   a verdict the harness cannot see is one a change can silently take away.
   (40000 was under EXP-02's own 700s = 42,000, which is how this was found.) */
const CAP = +(process.env.CAP || 60000);
const SEEDS = (process.env.SEEDS || '3039,a1b2,7f31').split(',');
const CASES = (process.env.CASES || 'EXP-01,EXP-02,EXP-05').split(',');
const PAR = +(process.env.PAR || 3);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
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

async function runOne(browser, port, code, seed) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  try {
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.SLIME && window.SLIME.experiments, { timeout: 30000 });
    const idx = await page.evaluate(c => window.SLIME.experiments().findIndex(e => e.code === c), code);
    if (idx < 0) throw new Error(`no dish ${code}`);
    /* runTo(CAP) so that a capped run STOPS at the cap. Without it the sim kept
       stepping between the poll that satisfied the wait and the evaluate that
       read the result, so a CAPPED case reported whatever step the poll
       happened to catch — measured at 550/552/565 steps across three identical
       runs of one seed. That made the one outcome nobody has verified the only
       nondeterministic row in the table, and compare()'s half-second threshold
       then read poll jitter as a dish finishing sooner or later. */
    await page.evaluate(a => {
      window.SLIME.start(a.idx, a.seed);
      /* x8, not x4: the dial's stops are worth half a dish second each since
         LAPSE_REF, and this harness wants steps rather than a watchable rate.
         x8 is what the old x4 asked for — 240 a second — and TURBO_MAX allows
         it precisely so the harness can keep asking. */
      window.SLIME.turbo(8);
      window.SLIME.runTo(a.cap);
    }, { idx, seed, cap: CAP });
    await page.waitForFunction(
      cap => window.SLIME.S.over || (window.SLIME.steps() >= cap && window.SLIME.S.paused),
      CAP, { timeout: 900000, polling: 500 });
    const r = await page.evaluate(() => ({
      over: window.SLIME.S.over,
      reason: window.SLIME.S.failReason || '',
      steps: window.SLIME.steps(),
      simT: window.SLIME.S.simT,
      engulfed: window.SLIME.engulfed(),
      agents: window.SLIME.agents(),
      score: window.SLIME.score(),
    }));
    r.won = !!r.over && !r.reason;
    r.outcome = !r.over ? 'CAPPED' : (r.won ? 'won' : r.reason || 'lost');
    if (errs.length) r.pageErrors = errs.slice(0, 3);
    return r;
  } finally { await page.close(); }
}

async function runBuild(root, label) {
  const { chromium } = require('playwright');
  const srv = await serve(root);
  const port = srv.address().port;
  const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(exe) ? exe : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const jobs = [];
  for (const c of CASES) {
    if (c.includes('/')) { const [code, seed] = c.split('/'); jobs.push({ code, seed }); }
    else for (const s of SEEDS) jobs.push({ code: c, seed: s });
  }
  const out = { label, root, cap: CAP, cases: {} };
  try {
    for (let i = 0; i < jobs.length; i += PAR) {
      const batch = jobs.slice(i, i + PAR);
      const rs = await Promise.all(batch.map(j => runOne(browser, port, j.code, j.seed)));
      batch.forEach((j, k) => {
        const key = `${j.code}/${j.seed}`;
        out.cases[key] = rs[k];
        const r = rs[k];
        process.stderr.write(`  ${label} ${key.padEnd(14)} ${r.outcome.padEnd(7)} ` +
          `clock=${r.simT.toFixed(1).padStart(7)}s steps=${String(r.steps).padStart(6)} ` +
          `score=${r.score ? r.score.score : '-'} mark=${r.score ? r.score.mark : '-'}\n`);
      });
    }
  } finally { await browser.close(); srv.close(); }
  return out;
}

function compare(a, b) {
  const keys = [...new Set([...Object.keys(a.cases), ...Object.keys(b.cases)])].sort();
  let broke = 0, faster = 0, slower = 0, threw = 0;
  console.log(`\n${'case'.padEnd(14)} ${a.label.padEnd(10)} ${b.label.padEnd(10)}  clock a -> b        delta`);
  for (const k of keys) {
    const x = a.cases[k], y = b.cases[k];
    if (!x || !y) { console.log(`${k.padEnd(14)} MISSING`); broke++; continue; }
    const d = y.simT - x.simT;
    const pc = x.simT > 0 ? (100 * d / x.simT) : 0;
    const flag = (x.won && !y.won) ? '  REGRESSION: was won, now ' + y.outcome
               : (!x.won && y.won) ? '  (now won)' : '';
    if (x.won && !y.won) broke++;
    else if (d < -0.5) faster++; else if (d > 0.5) slower++;
    /* A page that threw is not a result. Counted and surfaced rather than left
       in the JSON for nobody to read: a build erroring every frame could
       otherwise produce a table of plausible outcomes and a zero exit. */
    for (const [lbl, r] of [[a.label, x], [b.label, y]]) {
      if (r.pageErrors) { threw++; console.log(`           THREW (${lbl}): ${r.pageErrors[0]}`); }
    }
    console.log(`${k.padEnd(14)} ${x.outcome.padEnd(10)} ${y.outcome.padEnd(10)} ` +
      `${x.simT.toFixed(1).padStart(7)}s ->${y.simT.toFixed(1).padStart(7)}s  ` +
      `${(d >= 0 ? '+' : '') + d.toFixed(1)}s (${(pc >= 0 ? '+' : '') + pc.toFixed(1)}%)${flag}`);
  }
  console.log(`\n${keys.length} case(s): ${broke} broken, ${faster} finished sooner, ${slower} later` +
    (threw ? `, ${threw} threw` : ''));
  return broke === 0 && threw === 0;
}

(async () => {
  const argv = process.argv.slice(2);
  const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
  if (argv.includes('--compare')) {
    const i = argv.indexOf('--compare');
    const a = JSON.parse(fs.readFileSync(argv[i + 1], 'utf8'));
    const b = JSON.parse(fs.readFileSync(argv[i + 2], 'utf8'));
    process.exit(compare(a, b) ? 0 : 1);
  }
  const root = arg('--root') ? path.resolve(arg('--root')) : ROOT;
  const label = arg('--label') || path.basename(root);
  process.stderr.write(`${label}: ${root}, cap ${CAP} steps\n`);
  const r = await runBuild(root, label);
  const out = arg('--out');
  if (out) { fs.writeFileSync(out, JSON.stringify(r, null, 2)); process.stderr.write(`wrote ${out}\n`); }
  else console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
