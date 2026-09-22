/** Sweep with smart RAM allocation.
 *   node offline/sweep.mjs --smart-allocate-within-ram 24 [--seeds 3] [--deadline 1200] [--exclude 14] [--tasks 03,04]
 *
 * --smart-allocate-within-ram GB is the only capacity knob. Every (task,seed) run is admitted when its
 * estimated footprint fits the remaining budget; biggest workbooks go first so slow
 * ones start early and smaller ones backfill the gaps. One OS process per run, spawned
 * on admission and reaped on exit (freeing its budget) — no persistent worker pool.
 * The RAM cap is honored except a single run larger than the whole budget, which runs
 * alone. */
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync, readdirSync, readFileSync, openSync, closeSync, mkdirSync } from 'node:fs';
import { MOGBIN } from './mogc.mjs';
import path from 'node:path';
import { ensureBaseline } from './baseline.mjs';

const TIMEOUT_BIN = process.platform === 'darwin' ? '/opt/homebrew/bin/gtimeout' : 'timeout';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (!args["smart-allocate-within-ram"]) { console.error('usage: sweep.mjs --smart-allocate-within-ram <GB> [--seeds N] [--deadline S] [--exclude t,t] [--tasks t,t]'); process.exit(2); }

const BUDGET_MB = +args["smart-allocate-within-ram"] * 1024;
const SEEDS = +(args.seeds || 3), DEADLINE = +(args.deadline || 1200);
const EXCLUDE = args.exclude ? String(args.exclude).split(',') : [];
const ONLY = args.tasks ? String(args.tasks).split(',') : null;

// RAM estimate per run, derived instantly from the workbook's declared dimensions.
// Calibrated against measurement: task_03 = 362k cells ≈ 917MB mog + ~80MB node.
const BASE_MB = 300, PER_CELL_MB = 0.002;
function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function cellsOf(xlsx) {
  let xml;
  try { xml = execFileSync('unzip', ['-p', xlsx, 'xl/worksheets/*'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); }
  catch (e) { return 5000; }
  let cells = 0, m;
  const re = /<dimension ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"/g;
  while ((m = re.exec(xml))) {
    const c1 = colNum(m[1]), r1 = +m[2], c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
    cells += (c2 - c1 + 1) * (r2 - r1 + 1);
  }
  return cells || 5000;
}
const ramMB = cells => Math.round(BASE_MB + cells * PER_CELL_MB);

function taskList() {
  const dir = path.join(root, 'benchmarks/tasks');
  return readdirSync(dir).filter(d => /^task_\d\d$/.test(d)).map(d => d.slice(5))
    .filter(t => !EXCLUDE.includes(t) && (!ONLY || ONLY.includes(t)));
}

const sizes = {};
for (const t of taskList()) sizes[t] = ramMB(cellsOf(path.join(root, 'benchmarks/tasks', 'task_' + t, 'init.xlsx')));
// runs sorted biggest-first
const runs = [];
for (let s = 1; s <= SEEDS; s++) for (const t of Object.keys(sizes)) runs.push({ t, s, mb: sizes[t], started: false });
runs.sort((a, b) => b.mb - a.mb);
const TOTAL = runs.length;

const LOG = '/tmp/polar-sweep.log', STATUS = '/tmp/polar-sweep-status.json';
const results = [];
let ramUsed = 0, active = 0;
const log = m => appendFileSync(LOG, `[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const status = () => writeFileSync(STATUS, JSON.stringify({ done: results.length, total: TOTAL, active, ramUsedMB: ramUsed, budgetMB: BUDGET_MB, last: results.slice(-3) }, null, 1));

function runOne(job) {
  job.started = true; active++; ramUsed += job.mb;
  status(); // otherwise the status file only updates on completion and reads 0 mid-sweep
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, 'offline-runs', 's' + job.s + '-task_' + job.t + '-' + stamp);
  mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'run.out');
  const out = openSync(outPath, 'w');
  // Redirect the child's output to a FILE, not a pipe: a SIGKILLed runner can orphan its mog
  // daemon which would keep a pipe open and hang execFile forever. With a file, 'exit' fires
  // on runner death regardless of the orphan, and we then reap the run's own mog session.
  const argv = ['-s', 'KILL', String(DEADLINE + 180), 'node', path.join(root, 'offline/runner.mjs'),
    '--task', job.t, '--tag', 's' + job.s, '--deadline', String(DEADLINE), '--outdir', dir];
  const child = spawn(TIMEOUT_BIN, argv, { cwd: root, stdio: ['ignore', out, out] });
  const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, (DEADLINE + 300) * 1000);
  let done = false;
  function finalize(code, signal, spawnErr) {
    if (done) return; done = true;
    clearTimeout(killTimer);
    try { closeSync(out); } catch (e) {}
    active--; ramUsed -= job.mb;
    const wall = Math.round((Date.now() - t0) / 1000);
    let so = ''; try { so = readFileSync(outPath, 'utf8'); } catch (e) {}
    const g = re => (re.exec(so) || [])[1];
    const killed = signal === 'SIGKILL' || code === 137;
    const rec = {
      task: job.t, seed: job.s, mb: job.mb,
      score: g(/grade: score ([\d.]+)/) != null ? +g(/grade: score ([\d.]+)/) : null,
      gate: /gate: PASS/.test(so) ? 'PASS' : /gate: FAIL/.test(so) ? 'FAIL' : null,
      gate_detail: g(/gate: (?:PASS|FAIL) (.*)/) || null,
      status: g(/status: (\w+)/) || (killed ? 'killed_SIGKILL' : spawnErr ? 'spawn_error' : code ? 'exit_' + code : '?'),
      turns: g(/turns: (\d+)/) != null ? +g(/turns: (\d+)/) : null,
      wall, dir,
      grade_error: g(/grade failed: (.*)/) || null,
      err: spawnErr ? String(spawnErr).slice(0, 150) : signal ? 'signal ' + signal : null,
    };
    results.push(rec);
    log(`t${job.t} s${job.s} \u2192 ${rec.status} score=${rec.score} turns=${rec.turns} wall=${wall}s`);
    try { writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(rec, null, 1)); } catch (e) {}
    // reap THIS run's mog session (orphaned on SIGKILL) via the real mog binary, scoped to its dir
    try { execFileSync(MOGBIN, ['--close-all', '--discard'], { env: Object.assign({}, process.env, { MOG_SESSION_DIR: path.join(dir, '.mogsess') }), timeout: 20000 }); } catch (e) {}
    status(); pump();
  }
  child.on('exit', (code, signal) => finalize(code, signal, null));
  child.on('error', (e) => finalize(null, null, e));
}
function pump() {
  for (const job of runs) {
    if (job.started) continue;
    if (active === 0 || ramUsed + job.mb <= BUDGET_MB) { runOne(job); }  // fits, or must run alone
  }
  if (active === 0 && runs.every(j => j.started)) finish();
}
function finish() {
  const agg = {};
  for (const r of results) (agg[r.task] = agg[r.task] || []).push(r);
  const lines = [`\n=== SWEEP RESULTS (${Object.keys(agg).length}×${SEEDS}) ===`];
  let total = 0;
  for (const t of Object.keys(agg).sort()) {
    const rs = agg[t].sort((a, b) => a.seed - b.seed);
    const marks = rs.map(r => r.gate === 'PASS' ? 'P' : r.gate === 'FAIL' ? 'F' : 'E');
    const passes = marks.filter(x => x === 'P').length; total += passes;
    lines.push(`task_${t}: ${marks.join('')} (${passes}/${SEEDS})  scores=[${rs.map(r => r.score == null ? '-' : r.score.toFixed(2)).join(',')}] walls=[${rs.map(r => r.wall + 's').join(',')}]`);
  }
  lines.push(`TOTAL passes: ${total}/${TOTAL}   (real gate: all cells + zero preservation + requirements + no new errors; offline estimate)`);
  const perfect = results.filter(r => r.score === 1).length;
  lines.push(`for reference, score==1.0 only: ${perfect}/${TOTAL} -- NOT the pass criterion`);
  log(lines.join('\n'));
  writeFileSync('/tmp/polar-sweep-final.txt', lines.join('\n'));
  log('SWEEP-COMPLETE');
}

const peak = Math.max(...runs.map(r => r.mb));
if (peak > BUDGET_MB) log(`NOTE: largest run ~${peak}MB exceeds budget ${BUDGET_MB}MB — it will run alone.`);
// Build every preservation baseline serially BEFORE any run starts: concurrent workers
// must not race on the same file, and a broken baseline should fail before we spend money.
let baselineFails = 0;
for (const t of Object.keys(sizes)) {
  try { ensureBaseline('task_' + t); }
  catch (e) { baselineFails++; log(`baseline FAILED task_${t}: ${String(e).slice(0, 160)}`); }
}
log(`baselines ready: ${Object.keys(sizes).length - baselineFails}/${Object.keys(sizes).length}`);
log(`sweep start: ${TOTAL} runs, budget ${BUDGET_MB}MB, deadline ${DEADLINE}s; sizes=${JSON.stringify(sizes)}`);
status(); pump();
