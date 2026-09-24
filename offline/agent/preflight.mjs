/* No API calls. Refuse an unusable sweep before paying for any model turns. */
import { accessSync, constants, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mog = join(root, '.mog/bin/mog');
const sha = b => createHash('sha256').update(b).digest('hex');
export function preflight({requireKey = true} = {}) {
  if (requireKey && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  accessSync(mog, constants.X_OK);
  const binary = sha(readFileSync(mog));
  const controls = JSON.parse(readFileSync(join(root, 'out/controls.json'), 'utf8'));
  for (let n = 1; n <= 15; n++) {
    const task = `task_${String(n).padStart(2, '0')}`;
    const control = controls[task];
    if (!control || control.mog_sha !== binary.slice(0,16))
      throw new Error(`${task}: missing/mismatched binary control (${control?.mog_sha || 'none'} vs ${binary.slice(0,16)})`);
    for (const f of ['init.xlsx', 'golden.xlsx', 'prompt.txt'])
      accessSync(join(root, '../benchmarks/tasks', task, f));
  }
  execFileSync(join(root, '.venv/bin/python'), ['-c', 'import openpyxl; import grader.google_grade'],
    {cwd: join(root, '..'), stdio: 'pipe'});
  execFileSync('curl', ['--version'], {stdio: 'pipe'});
  const body = readdirSync(join(root, 'shim')).filter(f=>f.endsWith('.js')).sort()
    .map(f=>`/* ---- ${f} ---- */\n`+readFileSync(join(root,'shim',f),'utf8')).join('\n');
  if (body !== readFileSync(join(root,'dist/appsscript.js'),'utf8'))
    throw new Error('dist/appsscript.js is stale; run npm run build');
  console.log(`PREFLIGHT OK: 15 tasks, controls, dependencies, shim; mog ${binary.slice(0,16)}`);
  return binary;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { preflight({requireKey: !process.argv.includes('--no-api-key')}); }
  catch(e) { console.error('PREFLIGHT FAILED: '+e.message); process.exitCode=2; }
}
