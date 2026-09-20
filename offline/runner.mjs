/** Offline runner: byte-identical Code.gs + Prompts.gs over the mog shim.
 * node offline/runner.mjs --task 06 [--probe] [--deadline 300] */
import { makeShim } from './shim.mjs';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
const tid = 'task_' + args.task;
const root = path.resolve(new URL('..', import.meta.url).pathname);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(root, 'offline-runs', (args.tag ? args.tag + '-' : '') + tid + '-' + stamp);
mkdirSync(dir, { recursive: true });
const work = path.join(dir, 'work.xlsx');
copyFileSync(path.join(root, 'benchmarks/tasks', tid, 'init.xlsx'), work);
const prompt = readFileSync(path.join(root, 'benchmarks/tasks', tid, 'prompt.txt'), 'utf8');

process.env.MOG_SESSION_DIR = path.join(dir, '.mogsess');
mkdirSync(process.env.MOG_SESSION_DIR, { recursive: true, mode: 0o700 });
const shim = makeShim(work);
let code = readFileSync(path.join(root, 'Prompts.gs'), 'utf8') + '\n' + readFileSync(path.join(root, 'Code.gs'), 'utf8');
if (args.deadline) code = code.replace(/const DEADLINE_MS = [^;]+;/, `const DEADLINE_MS = ${Number(args.deadline) * 1000};`);
if (Number(args.deadline) > 300) code = code.replace(/const MAX_TURNS = [^;]+;/, `const MAX_TURNS = 100;`);
code += '\nreturn { runAgent: runAgent };';
if (args.probe) {
  shim.globals.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'probe-key', setProperty: () => {}, deleteProperty: () => {} }) };
  let n = 0;
  shim.globals.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: 'probe' + (++n), status: 'completed', usage: { input_tokens: 0, output_tokens: 0 }, output: [] }) }) };
}
const names = Object.keys(shim.globals);
const factory = new Function(...names, code);
const api = factory(...names.map(k => shim.globals[k]));
const t0 = Date.now();
let result;
try { result = api.runAgent({ prompt, spreadsheetId: 'offline' }); }
catch (e) { result = { status: 'runner_error', error: String(e && e.stack || e) }; }
finally { try { shim.close(path.join(dir, 'submission.xlsx')); } catch (e) {}
  try { execFileSync(shim.mogbin || 'true', ['--close-all', '--discard'], { env: process.env, timeout: 30000 }); } catch (e) {} }
writeFileSync(path.join(dir, 'response.json'), JSON.stringify({ taskId: tid, backend: 'mog', response: result }, null, 1));
console.log('status:', result.status, '| turns:', result.turns, '| cost:', result.cost_usd, '| wall:', Math.round((Date.now() - t0) / 1000) + 's');
try {
  const md = execFileSync('python3', [path.join(root, 'tools/render_transcript.py'), path.join(dir, 'response.json')], { encoding: 'utf8' }).trim();
  console.log('transcript:', md);
} catch (e) { console.log('render failed:', String(e).slice(0, 200)); }
if (!args.probe) {
  try {
    execFileSync(path.join(root, '.venv/bin/python'), ['-m', 'grader.google_grade', '--task', tid,
      '--initial', path.join(root, 'benchmarks/tasks', tid, 'init.xlsx'),
      '--golden', path.join(root, 'benchmarks/tasks', tid, 'golden.xlsx'),
      '--submission', path.join(dir, 'submission.xlsx'),
      '--out', path.join(dir, 'grade.json')], { cwd: root, encoding: 'utf8' });
    const g = JSON.parse(readFileSync(path.join(dir, 'grade.json'), 'utf8'));
    console.log('grade: score', g.score, '| provisional:', g.provisional, '| violations:', g.preservation.violations.length);
  } catch (e) { console.log('grade failed:', String(e).slice(0, 300)); }
}
console.log('dir:', dir);
