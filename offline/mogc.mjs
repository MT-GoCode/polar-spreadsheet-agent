// Thin mog session client: exec Office.js snippets, JSON I/O via console.log.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
const MOG = `${homedir()}/code/mog/target-native/debug/mog`;
import { existsSync } from 'node:fs';
const MOGBIN = existsSync(MOG) ? MOG : `${homedir()}/code/mog/target/debug/mog`;
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
