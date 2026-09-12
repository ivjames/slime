#!/usr/bin/env node
/* The dish is a pure function of (seed, brush), and SIM_V is the version of
   that promise. This is how a change is held to it: run fixed dishes for a
   fixed number of STEPS — the axis determinism is defined over, not seconds
   and not frames — and hash what the simulation holds, per field.
 *
 * Two builds that hold the same dish agree on every digest. Two that do not
 * disagree on the field that moved first, which names the pass that moved it.
 *
 *   node tools/determinism.js --out /tmp/a.json          # this checkout
 *   node tools/determinism.js --self                     # same build twice
 *   node tools/determinism.js --compare /tmp/a.json /tmp/b.json
 *
 * --self is the one to run FIRST on a checkout you have not measured before.
 * It answers whether the harness is stable at all: the same build run twice,
 * at two different speeds, must agree. If it does not, the sim has picked up
 * a dependency on frame timing and no comparison against it means anything.
 *
 * Needs playwright and a chromium. Neither is committed — see tools/README.md.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STEPS = +(process.env.STEPS || 2000);
/* Three dishes, one seed each: an open plate, a maze (walls, so the wall tests
   the sweeps carry are actually exercised), and a dish with timed events. Not
   twenty — the point is to catch a refactor that moved the dish, and a
   refactor that moves EXP-01 moves all of them. */
const CASES = (process.env.CASES || 'EXP-01/3039,EXP-02/a1b2,EXP-05/7f31')
  .split(',').map(s => { const [code, seed] = s.split('/'); return { code, seed }; });

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

async function runBuild(root, label, speed) {
  const { chromium } = require('playwright');
  const srv = await serve(root);
  const port = srv.address().port;
  const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(exe) ? exe : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const out = { label, root, steps: STEPS, speed, cases: {} };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.SLIME && window.SLIME.experiments, { timeout: 30000 });
    const codes = await page.evaluate(() => window.SLIME.experiments().map(e => e.code));

    for (const c of CASES) {
      const idx = codes.indexOf(c.code);
      if (idx < 0) throw new Error(`no dish ${c.code}`);
      await page.evaluate(a => {
        window.SLIME.turbo(a.speed);
        window.SLIME.start(a.idx, a.seed);
        window.SLIME.turbo(a.speed);
        window.SLIME.runTo(a.steps);
      }, { idx, seed: c.seed, steps: STEPS, speed });
      /* Wait on the STEP COUNT, never on a clock: a slow machine runs fewer
         steps per second and the same number of them all the same.
         S.over is in the condition because a dish can END before the target —
         starved, or won on a short seed — and then runTo's pause never comes.
         Without it the wait sat on a finished dish until the timeout, which
         reads as a hang rather than as the answer it is. */
      await page.waitForFunction(
        n => window.SLIME.S.over || (window.SLIME.steps() >= n && window.SLIME.S.paused),
        STEPS, { timeout: 600000, polling: 250 });
      const h = await page.evaluate(() => window.SLIME.stateHash());
      /* A dish that ended early is still comparable — two builds holding the
         same dish end on the same step — so this is recorded, not fatal. It is
         only fatal if the two builds disagree about WHICH step, and compare
         reports that as a divergence in `steps`. */
      if (h.steps !== STEPS) {
        h.endedEarly = true;
        process.stderr.write(`  ${label} ${c.code}/${c.seed}  ended at step ${h.steps} before the ${STEPS} target\n`);
      }
      out.cases[`${c.code}/${c.seed}`] = h;
      process.stderr.write(`  ${label} ${c.code}/${c.seed}  steps=${h.steps} agents=${h.agents} all=${h.all}\n`);
    }
    if (errs.length) { out.pageErrors = errs; process.stderr.write(`  ${label}: PAGE ERRORS ${errs.slice(0, 3).join(' | ')}\n`); }
  } finally {
    await browser.close();
    srv.close();
  }
  return out;
}

function compare(a, b) {
  const keys = [...new Set([...Object.keys(a.cases), ...Object.keys(b.cases)])].sort();
  let bad = 0;
  for (const k of keys) {
    const x = a.cases[k], y = b.cases[k];
    if (!x || !y) { console.log(`MISSING  ${k} (${!x ? a.label : b.label} has no result)`); bad++; continue; }
    if (x.all === y.all) { console.log(`ok       ${k}  all=${x.all}  steps=${x.steps}  agents=${x.agents}`); continue; }
    bad++;
    console.log(`DIVERGED ${k}  ${a.label}=${x.all}  ${b.label}=${y.all}`);
    if (x.steps !== y.steps) console.log(`           steps ${x.steps} vs ${y.steps}`);
    if (x.agents !== y.agents) console.log(`           agents ${x.agents} vs ${y.agents}`);
    /* Name the fields, in the order stateHash fixes: the first one listed is
       the earliest pass that moved, which is where to look. */
    const fields = Object.keys(x.per);
    const moved = fields.filter(f => x.per[f] !== y.per[f]);
    const same = fields.filter(f => x.per[f] === y.per[f]);
    console.log(`           moved (${moved.length}/${fields.length}): ${moved.join(' ') || '(none)'}`);
    if (moved.length && same.length) console.log(`           held: ${same.join(' ')}`);
  }
  console.log(bad ? `\n${bad} of ${keys.length} case(s) diverged` : `\nall ${keys.length} case(s) identical`);
  return bad === 0;
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

  if (argv.includes('--self')) {
    /* Two speeds on purpose. Same steps, same seed, different number of frames
       and different steps per frame — which is the strongest statement of the
       determinism claim this harness can make against a single build. */
    const root = arg('--root') ? path.resolve(arg('--root')) : ROOT;
    process.stderr.write(`self-check: ${root}, ${STEPS} steps\n`);
    const a = await runBuild(root, 'x1', 1);
    const b = await runBuild(root, 'x4', 4);
    process.exit(compare(a, b) ? 0 : 1);
  }

  const root = arg('--root') ? path.resolve(arg('--root')) : ROOT;
  const label = arg('--label') || path.basename(root);
  const speed = +(arg('--speed') || 4);
  process.stderr.write(`${label}: ${root}, ${STEPS} steps at x${speed}\n`);
  const r = await runBuild(root, label, speed);
  const out = arg('--out');
  if (out) { fs.writeFileSync(out, JSON.stringify(r, null, 2)); process.stderr.write(`wrote ${out}\n`); }
  else console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
