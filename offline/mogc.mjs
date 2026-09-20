// Thin mog session client: exec Office.js snippets, JSON I/O via console.log.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
const REPO_LOCAL = path.resolve(new URL('..', import.meta.url).pathname, '.mog/bin/mog');
const CANDIDATES = [process.env.MOG_BIN, REPO_LOCAL, `${homedir()}/code/mog/target-native/release/mog`,
  `${homedir()}/code/mog/target/release/mog`, `${homedir()}/bin/mog-linux`].filter(Boolean);
export const MOGBIN = CANDIDATES.find(existsSync) || CANDIDATES[1];
export function openSession(xlsxPath) {
  const id = execFileSync(MOGBIN, ['-s', '-i', xlsxPath], { encoding: 'utf8' }).trim().split('\n').pop().trim();
  return id;
}
export function exec(session, code) {
  // script goes via file, not argv: multi-MB formula grids exceed the ~2MB argv limit (E2BIG)
  const f = path.join(process.env.MOG_SESSION_DIR || '/tmp', 'snippet-' + session + '.js');
  writeFileSync(f, code);
  try { return execFileSync(MOGBIN, ['-s', session, '-f', f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  finally { try { unlinkSync(f); } catch (e) {} }
}
export function execJSON(session, code) {
  const marked = code.replace(/console\.log\(JSON\.stringify\(/g, "console.log('@@'+JSON.stringify(");
  const out = exec(session, marked);
  const line = out.split('\n').reverse().find(l => l.startsWith('@@'));
  const s = line ? line.slice(2) : out;
  try { return JSON.parse(s); } catch (e) { throw new Error('mog exec bad JSON: ' + s.slice(0, 300)); }
}
export function closeSession(session, outPath) {
  execFileSync(MOGBIN, ['-s', session, '--close', ...(outPath ? ['-o', outPath] : ['--discard'])], { encoding: 'utf8' });
}
