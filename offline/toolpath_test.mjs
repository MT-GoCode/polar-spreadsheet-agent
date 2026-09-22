/** Tool-path tests: exercise the real Code.gs write/plan/verify tools over the mog shim,
 * with the model stubbed (H6 adversary returns NO CONCERNS — no real API). Validates
 * H2 (overlap refusal + force), H7 (equals_old), H8 (no-holes), and that the H6 adversary
 * call-path runs without crashing. Run from repo root: node offline/toolpath_test.mjs */
import { makeShim } from './shim.mjs';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dir = mkdtempSync(path.join(tmpdir(), 'tp-'));
execSync('chmod 700 ' + dir);
process.env.MOG_SESSION_DIR = dir;
const wk = path.join(dir, 'wk.xlsx');
execSync('cp ' + path.join(root, 'benchmarks/tasks/task_08/init.xlsx') + ' ' + wk);

const shim = makeShim(wk);
// stub the model so the H6 adversary call (at first set_new_plan) returns NO CONCERNS
shim.globals.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: 'adv', status: 'completed', usage: { input_tokens: 0, output_tokens: 0 }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'NO CONCERNS' }] }] }) }) };
shim.globals.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'k', setProperty: () => {}, deleteProperty: () => {} }) };

const code = readFileSync(path.join(root, 'Prompts.gs'), 'utf8') + '\n' + readFileSync(path.join(root, 'Code.gs'), 'utf8') +
  '\nreturn { tPlan_, tFill_, tNumFmt_, tHatch_, verify_, snapshotAll_, describe_, setG: function (g) { G = g; }, getG: function () { return G; } };';
const names = Object.keys(shim.globals);
const T = new Function(...names, code)(...names.map((k) => shim.globals[k]));

function freshG() {
  const ss = shim.globals.SpreadsheetApp.openById('x');
  T.setG({ ss, id: 'x', t0: Date.now(), prompt: 'test', map: null, writes: {}, oldmap: {}, fmtBase: {}, fmtWrites: [], dvWrites: [], cfBase: {}, plan: null, failedOpen: false, failedAsserts: [], planHistory: [], droppedAck: false, attempt: 0, trace: [], turn: 0, prevId: null, cost: 0, ckptFrom: 0 });
  T.snapshotAll_();
  T.getG().map = T.describe_();
  return T.getG();
}
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n + (d ? ' — ' + d : ''))); };

let G = freshG();
const sheet = G.ss.getSheets()[0].getName();
const sn = G.snap[sheet];
const A1 = (i, j) => String.fromCharCode(65 + j) + (i + 1);
let nb = null, bl = null, numc = null, numOld = null, txtc = null, txtOld = null;
for (let i = 0; i < sn.R; i++) for (let j = 0; j < sn.C; j++) {
  const has = sn.f[i][j] !== '' || (sn.v[i][j] !== '' && sn.v[i][j] != null);
  if (has && !nb) nb = A1(i, j);
  if (!has && !bl) bl = A1(i, j);
  if (typeof sn.v[i][j] === 'number' && sn.f[i][j] === '' && !numc) { numc = A1(i, j); numOld = sn.v[i][j]; }
  if (typeof sn.v[i][j] === 'string' && sn.v[i][j].trim() && sn.f[i][j] === '' && !txtc && A1(i, j) !== nb) { txtc = A1(i, j); txtOld = sn.v[i][j]; }
}
console.log('sheet', sheet, '| nonblank', nb, '| blank', bl, '| numeric', numc, '=', numOld);

// H2 + adversary call-path
let p = T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'test' }]), assertions_json: '[]', rationale: 't' });
ok(/PLAN ACCEPTED/.test(p), 'plan accepted (H6 adversary call-path ran, no crash)', p.slice(0, 70));
ok(/REFUSED/.test(T.tFill_({ sheet, range: nb, formula_r1c1: '=1+1', force: false })), 'H2: overwrite non-blank refused without force');
ok(/FILLED/.test(T.tFill_({ sheet, range: nb, formula_r1c1: '=1+1', force: true })), 'H2: overwrite allowed with force:true');

// H8: blank hole in a declared formula target fails verify
freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'test' }]), assertions_json: '[]', rationale: 't' });
ok(/V2b HOLE FAIL/.test(T.verify_().text), 'H8: blank hole in declared target fails');

// H7: equals_old
if (numc) {
  freshG();
  T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + numc, kind: 'formula', intent: 't' }]), assertions_json: JSON.stringify([{ range: sheet + '!' + numc, check: 'equals_old' }]), rationale: 't' });
  T.tFill_({ sheet, range: numc, formula_r1c1: '=' + numOld, force: true });
  ok(/V7 assert ok: equals_old/.test(T.verify_().text), 'H7: equals_old passes when new formula reproduces old value');
  freshG();
  T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + numc, kind: 'formula', intent: 't' }]), assertions_json: JSON.stringify([{ range: sheet + '!' + numc, check: 'equals_old' }]), rationale: 't' });
  T.tFill_({ sheet, range: numc, formula_r1c1: '=' + (numOld + 12345), force: true });
  ok(/V7 ASSERT FAIL equals_old/.test(T.verify_().text), 'H7: equals_old fails when value differs');
} else console.log('  (no numeric cell for H7 — skipped)');

// H7: equals_old on a TEXT run-start value (regression guard for the string branch)
if (txtc) {
  freshG();
  T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + txtc, kind: 'formula', intent: 't' }]), assertions_json: JSON.stringify([{ range: sheet + '!' + txtc, check: 'equals_old' }]), rationale: 't' });
  T.tFill_({ sheet, range: txtc, formula_r1c1: '="' + String(txtOld).replace(/"/g, '""') + '"', force: true });
  ok(/V7 assert ok: equals_old/.test(T.verify_().text), 'H7: equals_old passes on reproduced TEXT value (not just numeric)');
} else console.log('  (no text cell for text equals_old — skipped)');

// ---- Phase 1: format gate, V3 preservation axis, hatch closure ----
// A format-kind target must win even when a formula target also contains the range.
// Before the fix, inTargets_ returned the first CONTAINING target of any kind, so an
// overlapping formula target shadowed every format target and set_number_format
// refused unconditionally -- which is why the model routed around it via the hatch.
G = freshG();
T.tPlan_({
  targets_json: JSON.stringify([
    { range: sheet + '!' + nb, kind: 'formula', intent: 'write the value' },
    { range: sheet + '!' + nb, kind: 'format', intent: 'task asked for one decimal place' },
  ]),
  assertions_json: '[]', rationale: 't',
});
const fmtRes = T.tNumFmt_({ sheet, range: nb, format: '0.0' });
ok(/FORMAT SET/.test(fmtRes), 'P1: set_number_format works with a format target overlapping a formula target', fmtRes.slice(0, 90));

// ...and is still refused when only a non-format target covers the range.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'x' }]), assertions_json: '[]', rationale: 't' });
const fmtRef = T.tNumFmt_({ sheet, range: nb, format: '0.0' });
ok(/REFUSED/.test(fmtRef) && /format target covering/.test(fmtRef), 'P1: format write without a format target refused, with the fix named', fmtRef.slice(0, 90));

// V3 fires when a format changes outside any format target (this is t07's failure mode:
// outputs 25/25 on every seed, killed only by unrequested reformatting).
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x' }]), assertions_json: '[]', rationale: 't' });
T.tNumFmt_({ sheet, range: nb, format: '0.000%' });
G.plan.targets[0].kind = 'formula';      // revoke the licence, keep the edit
const v3 = T.verify_();
ok(/V3 FORMAT FAIL/.test(v3), 'P1: V3 fails a number-format change outside a format target', v3.split('\n').find((l) => /^V[0-9]/.test(l)) || v3.slice(0, 90));

// ...and passes when the change is licensed.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x' }]), assertions_json: '[]', rationale: 't' });
T.tNumFmt_({ sheet, range: nb, format: '0.000%' });
const v3ok = T.verify_();
ok(/V3 number formats ok/.test(v3ok), 'P1: V3 passes a licensed number-format change', v3ok.slice(0, 120));

// The hatch must no longer be a way around the typed format tool.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x' }]), assertions_json: '[]', rationale: 't' });
const hatch = T.tHatch_({ code: "ss.getSheetByName('" + sheet + "').getRange('" + nb + "').setNumberFormat('0.0');", touches_json: JSON.stringify([sheet + '!' + nb]) });
ok(/REFUSED/.test(hatch) && /banned/.test(hatch), 'P1: hatch refuses setNumberFormat', hatch.slice(0, 90));

shim.close(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
