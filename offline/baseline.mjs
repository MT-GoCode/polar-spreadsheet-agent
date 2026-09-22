/** Shim round-trip baseline: open init.xlsx through the offline engine and save it
 * unchanged. Grading a submission against THIS file (instead of init.xlsx) cancels
 * whole-file re-serialization drift the engine introduces with zero agent activity
 * (measured: task_03 2 phantom sheet_layout, task_09/11 309 phantom cell_style/font
 * each, task_14 7, task_15 6 cell_content/sheet_objects).
 * Idempotent and cached; atomic rename so concurrent sweep workers cannot race.
 *   node offline/baseline.mjs task_07 [--force]   -> offline/.baseline/task_07.xlsx */
import { makeShim } from './shim.mjs';
import { copyFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
export const baselineDir = path.join(root, 'offline', '.baseline');
export function baselinePath(tid) { return path.join(baselineDir, tid + '.xlsx'); }

export function ensureBaseline(tid, force) {
  const out = baselinePath(tid);
  if (existsSync(out) && !force) return out;
  const init = path.join(root, 'benchmarks/tasks', tid, 'init.xlsx');
  if (!existsSync(init)) throw new Error('no init.xlsx for ' + tid);
  mkdirSync(baselineDir, { recursive: true });
  const tmp = path.join(baselineDir, `.tmp-${tid}-${process.pid}`);
  const prevSess = process.env.MOG_SESSION_DIR;
  try {
    mkdirSync(tmp, { recursive: true });
    const work = path.join(tmp, 'work.xlsx');
    copyFileSync(init, work);
    process.env.MOG_SESSION_DIR = path.join(tmp, '.mogsess');
    mkdirSync(process.env.MOG_SESSION_DIR, { recursive: true, mode: 0o700 });
    const shim = makeShim(work);
    shim.close(path.join(tmp, 'out.xlsx'));      // no edits between open and close
    renameSync(path.join(tmp, 'out.xlsx'), out); // atomic within the same filesystem
  } finally {
    if (prevSess === undefined) delete process.env.MOG_SESSION_DIR;
    else process.env.MOG_SESSION_DIR = prevSess;
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tid = process.argv[2];
  if (!tid) { console.error('usage: node offline/baseline.mjs task_NN [--force]'); process.exit(2); }
  console.log(ensureBaseline(tid, process.argv.includes('--force')));
}
