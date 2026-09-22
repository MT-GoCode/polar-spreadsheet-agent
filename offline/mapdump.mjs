/** Print describe_()'s map for a task, with no model call and no cost.
 *   node offline/mapdump.mjs 13            # one task
 *   node offline/mapdump.mjs --all --stat  # byte sizes for every task
 * The map is the model's primary context, so it needs to be inspectable directly. */
import { makeShim } from './shim.mjs';
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const statOnly = args.includes('--stat');
const tasks = args.includes('--all')
  ? ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15']
  : args.filter((a) => /^\d\d$/.test(a));
if (!tasks.length) { console.error('usage: node offline/mapdump.mjs <NN|--all> [--stat]'); process.exit(2); }

const src = readFileSync(path.join(root, 'Prompts.gs'), 'utf8') + '\n' +
  readFileSync(path.join(root, 'Code.gs'), 'utf8') +
  '\nreturn { describe_, snapshotAll_, setG: function (g) { G = g; } };';

for (const t of tasks) {
  const tid = 'task_' + t;
  const dir = mkdtempSync(path.join(tmpdir(), 'md-'));
  execSync('chmod 700 ' + dir);
  process.env.MOG_SESSION_DIR = dir;
  const wk = path.join(dir, 'wk.xlsx');
  try { copyFileSync(path.join(root, 'benchmarks/tasks', tid, 'init.xlsx'), wk); }
  catch (e) { console.log(`${tid}: no init.xlsx`); continue; }
  const shim = makeShim(wk);
  shim.globals.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'k', setProperty: () => {}, deleteProperty: () => {} }) };
  shim.globals.UrlFetchApp = { fetch: () => { throw new Error('mapdump makes no model calls'); } };
  const names = Object.keys(shim.globals);
  const T = new Function(...names, src)(...names.map((k) => shim.globals[k]));
  T.setG({ ss: shim.globals.SpreadsheetApp.openById('x'), id: 'x', t0: Date.now(), prompt: '', map: null,
    writes: {}, oldmap: {}, fmtBase: {}, fmtWrites: [], dvWrites: [], cfBase: {}, plan: null,
    failedOpen: false, failedAsserts: [], planHistory: [], droppedAck: false, attempt: 0,
    trace: [], turn: 0, prevId: null, cost: 0, ckptFrom: 0 });
  const t0 = Date.now();
  T.snapshotAll_();
  const snapMs = Date.now() - t0;
  const t1 = Date.now();
  const map = T.describe_();
  const descMs = Date.now() - t1;
  try { shim.close(null); } catch (e) {}
  if (statOnly) {
    const trimmed = (map.match(/\[trimmed to budget\]/g) || []).length;
    const empty = (map.match(/(formula groups|row structure[^\n]*):\n(?=(  [a-z]|===|$))/g) || []).length;
    console.log(`${tid}  ${String(map.length).padStart(6)}B  snap ${String(snapMs).padStart(5)}ms  describe ${String(descMs).padStart(5)}ms  trimmed:${trimmed}  empty-sections:${empty}`);
  } else {
    console.log(`########## ${tid}  (${map.length} bytes)\n${map}\n`);
  }
}
