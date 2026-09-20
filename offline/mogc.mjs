// Thin mog session client: exec Office.js snippets, JSON I/O via console.log.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
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
  const out = execFileSync(MOGBIN, ['-s', session, '-e', code], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = out.trim().split('\n').filter(l => l.trim() !== '');
  return lines.length ? lines[lines.length - 1] : '';
}
export function execJSON(session, code) {
  const s = exec(session, code);
  try { return JSON.parse(s); } catch (e) { throw new Error('mog exec bad JSON: ' + s.slice(0, 300)); }
}
export function closeSession(session, outPath) {
  execFileSync(MOGBIN, ['-s', session, '--close', ...(outPath ? ['-o', outPath] : ['--discard'])], { encoding: 'utf8' });
}
