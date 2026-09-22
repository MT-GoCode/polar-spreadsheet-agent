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
  T.setG({ ss, id: 'x', t0: Date.now(), prompt: 'Unit test task. Format completed outputs to one decimal place. Preserve existing formatting elsewhere.', map: null, writes: {}, oldmap: {}, fmtBase: {}, fmtWrites: [], dvWrites: [], cfBase: {}, plan: null, failedOpen: false, failedAsserts: [], planHistory: [], droppedAck: false, attempt: 0, trace: [], turn: 0, prevId: null, cost: 0, ckptFrom: 0 });
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
let p = T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'test' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
ok(/PLAN ACCEPTED/.test(p), 'plan accepted', p.slice(0, 70));
ok(/REFUSED/.test(T.tFill_({ sheet, range: nb, formula_r1c1: '=1+1', force: false })), 'H2: overwrite non-blank refused without force');
ok(/FILLED/.test(T.tFill_({ sheet, range: nb, formula_r1c1: '=1+1', force: true })), 'H2: overwrite allowed with force:true');

// H8: blank hole in a declared formula target fails verify
freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'test' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
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
    { range: sheet + '!' + nb, kind: 'format', intent: 'task asked for one decimal place', prompt_quote: 'Format completed outputs to one decimal place' },
  ]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't',
});
const fmtRes = T.tNumFmt_({ sheet, range: nb, format: '0.0' });
ok(/FORMAT SET/.test(fmtRes), 'P1: set_number_format works with a format target overlapping a formula target', fmtRes.slice(0, 90));

// ...and is still refused when only a non-format target covers the range.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'x' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
const fmtRef = T.tNumFmt_({ sheet, range: nb, format: '0.0' });
ok(/REFUSED/.test(fmtRef) && /format target covering/.test(fmtRef), 'P1: format write without a format target refused, with the fix named', fmtRef.slice(0, 90));

// V3 fires when a format changes outside any format target (this is t07's failure mode:
// outputs 25/25 on every seed, killed only by unrequested reformatting).
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Format completed outputs to one decimal place' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
T.tNumFmt_({ sheet, range: nb, format: '0.000%' });
G.plan.targets[0].kind = 'formula';      // revoke the licence, keep the edit
const v3 = T.verify_().text;
ok(/V3 FORMAT FAIL/.test(v3), 'P1: V3 fails a number-format change outside a format target', v3.split('\n').find((l) => /^V[0-9]/.test(l)) || v3.slice(0, 90));

// ...and passes when the change is licensed.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Format completed outputs to one decimal place' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
T.tNumFmt_({ sheet, range: nb, format: '0.000%' });
const v3ok = T.verify_().text;
ok(/V3 number formats ok/.test(v3ok), 'P1: V3 passes a licensed number-format change', v3ok.slice(0, 120));

// The hatch must no longer be a way around the typed format tool.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Format completed outputs to one decimal place' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
const hatch = T.tHatch_({ code: "ss.getSheetByName('" + sheet + "').getRange('" + nb + "').setNumberFormat('0.0');", touches_json: JSON.stringify([sheet + '!' + nb]) });
ok(/REFUSED/.test(hatch) && /banned/.test(hatch), 'P1: hatch refuses setNumberFormat', hatch.slice(0, 90));

// ---- Phase 2: reviewer off by default, deterministic occupancy notice ----
// The LLM reviewer must not run unless explicitly enabled. The shim's model stub would
// answer NO CONCERNS, so the observable signal is the absence of any adversary trace
// event and of the PLAN REVIEW block.
G = freshG();
const p2 = T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'x' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
ok(!/PLAN REVIEW/.test(p2), 'P2: no PLAN REVIEW block when ADVERSARY is off');
ok(!T.getG().trace.some((e) => e.t === 'adversary' || e.t === 'adversary_error'), 'P2: no adversary trace event when off');
ok(T.getG().trace.some((e) => e.t === 'coverage'), 'P2: H9 coverage event still emitted');

// The occupancy notice must name run-start content inside a target (nb is non-blank)...
ok(/ALREADY OCCUPIED/.test(p2) && p2.indexOf(nb) >= 0, 'P2: occupancy notice names the occupied cell', p2.slice(-160));
// ...and must stay silent for a target that is genuinely empty (bl is blank).
G = freshG();
const p2b = T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'x' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
ok(!/ALREADY OCCUPIED/.test(p2b), 'P2: occupancy notice silent on an empty target');

// ---- Phase 5: the hardcode-intent lint is gone ----
// It fired 23 times across two sweeps with a 100% false-positive rate, because the
// system prompt orders verbatim quoting and three tasks use the word "hardcode" in
// their instructions. Target kind is enforced mechanically by V2 instead.
G = freshG();
const p5 = T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula',
    intent: 'replace the hardcoded values with live formulas',
    prompt_quote: 'currently hold hardcoded values — replace those with live formulas' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't',
});
ok(/PLAN ACCEPTED/.test(p5), 'P5: a formula target quoting "hardcoded" is accepted, not refused', p5.slice(0, 100));
ok(!/intent mentions/.test(p5), 'P5: no intent-wording lint in the response');

// ---- the premise tools/offline_gate.py relies on: no tool can write font or fill ----
// The gate forgives every offline cell_style font/fill violation as an engine artifact.
// That is only sound while the agent genuinely cannot produce one. Enforce it here.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Format completed outputs to one decimal place' }]), assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test: not exercising assertions here' }]), rationale: 't' });
for (const call of ['setFontColor(\'#ff0000\')', 'setFontWeight(\'bold\')', 'setBackground(\'#ff0000\')', 'setFontSize(20)']) {
  const r = T.tHatch_({ code: "ss.getSheetByName('" + sheet + "').getRange('" + nb + "')." + call + ";", touches_json: JSON.stringify([sheet + '!' + nb]) });
  ok(/REFUSED/.test(r) && /banned/.test(r), 'gate premise: hatch refuses ' + call.split('(')[0], r.slice(0, 80));
}

// ---- Phase 4a: validated assertions, equals_ref, harness-owned requirement ----
// A plan that writes formulas with no harness-owned check must be refused: this is the
// root of the verifier returning PASS on 40 of 40 runs while 19 genuinely failed.
G = freshG();
const r41 = T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'no_error', range: sheet + '!' + nb }]),
  rationale: 't',
});
ok(/PLAN ACCEPTED/.test(r41) && /no check in this plan is owned by the harness/.test(r41),
  'P4: plan with only model-authored checks warns (refusing it forced false anchors)', r41.slice(0, 120));

// equals_old satisfies it.
G = freshG();
ok(/PLAN ACCEPTED/.test(T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'equals_old', range: sheet + '!' + nb }]),
  rationale: 't',
})), 'P4: equals_old satisfies the harness-owned requirement');

// equals_ref rejects a ref the model itself wrote -- the tautology guard.
G = freshG();
T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'x' }, { range: sheet + '!' + numc, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'equals_ref', range: sheet + '!' + bl, ref: sheet + '!' + numc }]),
  rationale: 't',
});
T.tFill_({ sheet, range: bl, formula_r1c1: '=' + numOld, force: false });
T.tFill_({ sheet, range: numc, formula_r1c1: '=' + numOld, force: true });
const r42 = T.verify_().text;
ok(/is a cell YOU wrote/.test(r42), 'P4: equals_ref refuses a ref the model wrote', (r42.match(/V7[^\n]*/) || [''])[0].slice(0, 110));

// equals_ref passes against an untouched cell holding the same value.
G = freshG();
T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'equals_ref', range: sheet + '!' + bl, ref: sheet + '!' + numc }]),
  rationale: 't',
});
T.tFill_({ sheet, range: bl, formula_r1c1: '=' + numOld, force: false });
const r43 = T.verify_().text;
ok(/V7 assert ok: equals_ref/.test(r43), 'P4: equals_ref passes against an untouched reference cell', (r43.match(/V7[^\n]*/) || [''])[0].slice(0, 110));

// Malformed payloads are refused rather than silently passing.
G = freshG();
const r44 = T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'equals_old', range: sheet + '!' + nb }, { check: 'equals', range: sheet + '!' + nb }]),
  rationale: 't',
});
ok(/REFUSED/.test(r44) && /has no "value"/.test(r44), 'P4: equals with no value is refused (was a silent PASS)', r44.slice(0, 100));

G = freshG();
const r45 = T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Format completed outputs to one decimal place' }]),
  assertions_json: JSON.stringify([{ check: 'format', range: sheet + '!' + nb, percent: false }]),
  rationale: 't',
});
ok(/REFUSED/.test(r45) && /needs "decimals"/.test(r45), 'P4: format assertion without decimals is refused (was a false-fail)', r45.slice(0, 100));

// The UNVERIFIED line must always be present, so a clean report cannot read as "correct".
G = freshG();
T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + bl, reason: 'none available' }]),
  rationale: 't',
});
T.tFill_({ sheet, range: bl, formula_r1c1: '=1+1', force: false });
const r46 = T.verify_().text;
ok(/UNVERIFIED: 1 of 1 output cells/.test(r46) && /Nothing here can detect a wrong value/.test(r46),
  'P4: UNVERIFIED line reports zero harness-owned coverage', (r46.match(/UNVERIFIED[^\n]*/) || [''])[0].slice(0, 130));

// ---- the hatch ban must not be defeatable by building the method name at runtime ----
// HATCH_BAN matches source text, so "var m='setF'+'ontColor'; range[m](...)" contained no
// banned substring. offline_gate.py forgives every offline font/fill violation on the
// premise that no tool can write font or fill, so that bypass would have turned a real
// violation into ignored noise and reported a false pass.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Format completed outputs to one decimal place' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test' }]), rationale: 't' });
for (const [code, label] of [
  ["var m='setF'+'ontColor'; ss.getSheetByName('" + sheet + "').getRange('" + nb + "')[m]('#ff0000');", 'computed method call'],
  ["Reflect.get(ss.getSheetByName('" + sheet + "').getRange('" + nb + "'),'setFontColor')('#f00');", 'Reflect'],
  ["ss.getSheetByName('" + sheet + "').getRange('" + nb + "').setValue.call(null,1);", '.call'],
]) {
  const r = T.tHatch_({ code, touches_json: JSON.stringify([sheet + '!' + nb]) });
  ok(/REFUSED/.test(r) && /dynamic dispatch/.test(r), 'gate premise: hatch refuses ' + label, r.slice(0, 80));
}
// ...while ordinary array indexing on a read must still be allowed through the ban.
const okRead = T.tHatch_({
  code: "var v = ss.getSheetByName('" + sheet + "').getDataRange().getValues(); v[0][0];",
  touches_json: '[]',
});
ok(!/dynamic dispatch/.test(okRead), 'hatch ban does not false-positive on array indexing', okRead.slice(0, 80));

// A previously-failed equals_ref must be carryable by a revised equals_ref, which is what
// Prompts.gs promises; it was missing from the sticky-carry whitelist.
G = freshG();
T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'equals_ref', range: sheet + '!' + bl, ref: sheet + '!' + numc }]), rationale: 't' });
T.tFill_({ sheet, range: bl, formula_r1c1: '=' + (numOld + 12345), force: false });
T.verify_();                       // records the equals_ref failure as sticky
const carried = T.tPlan_({ targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'equals_ref', range: sheet + '!' + bl, ref: sheet + '!' + numc }]), rationale: 't' });
ok(/PLAN ACCEPTED/.test(carried), 'sticky: a revised equals_ref carries a failed equals_ref', carried.slice(0, 110));

// ---- a format target must be licensed by the TASK's own words ----
// task_07 scores 25/25 outputs on every seed and fails only because the model reformats
// Meta Drivers!G19:K21 while its style_editable permits nothing but a border on M20:M21.
// V3 could not stop it, because the model licensed itself with a self-declared format
// target. The harness holds the task prompt, so a quote can be made non-forgeable.
G = freshG();
const q1 = T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'tidy it up' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test' }]),
  rationale: 't',
});
ok(/REFUSED/.test(q1) && /VERBATIM/.test(q1), 'quote: format target with no prompt_quote is refused', q1.slice(0, 100));

G = freshG();
const q2 = T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'make it look like the neighbouring rows' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test' }]),
  rationale: 't',
});
ok(/REFUSED/.test(q2) && /does not appear in the task text/.test(q2), 'quote: an invented justification is refused', q2.slice(0, 110));

// A quote that IS in the task but tells you to leave formatting alone must not license a
// number-format write -- several tasks contain exactly such a sentence.
G = freshG();
T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Preserve existing formatting elsewhere' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test' }]),
  rationale: 't',
});
const q3 = T.tNumFmt_({ sheet, range: nb, format: '0.0%' });
ok(/REFUSED/.test(q3) && /leave formatting as it is/.test(q3), 'quote: a preservation sentence does not license a reformat', q3.slice(0, 120));

// ...and the real instruction does.
G = freshG();
T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'format', intent: 'x', prompt_quote: 'Format completed outputs to one decimal place' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + nb, reason: 'unit test' }]),
  rationale: 't',
});
ok(/FORMAT SET/.test(T.tNumFmt_({ sheet, range: nb, format: '0.0' })), 'quote: the task\'s own formatting instruction licenses the write');

// A non-verbatim quote on a non-format target warns but does not refuse: 5.1 showed that
// a hard lint on quote wording only teaches the model to mutilate its quotes.
G = freshG();
const qw = T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + nb, kind: 'formula', intent: 'x', prompt_quote: 'something the task never said at all' }]),
  assertions_json: JSON.stringify([{ check: 'equals_old', range: sheet + '!' + nb }]),
  rationale: 't',
});
ok(/PLAN ACCEPTED/.test(qw) && /not verbatim task text/.test(qw), 'quote: non-verbatim quote on a formula target warns, not refuses', qw.slice(0, 110));

// V3 must NOT fire when the cell's CONTENT changed: offline the engine rewrites a cell's
// number format to "@" when the formula contains a % literal, and reporting that made the
// state unfixable (the only tool that could undo it needs a task-licensed quote).
G = freshG();
T.tPlan_({
  targets_json: JSON.stringify([{ range: sheet + '!' + bl, kind: 'formula', intent: 'x' }]),
  assertions_json: JSON.stringify([{ check: 'waive', range: sheet + '!' + bl, reason: 'unit test' }]),
  rationale: 't',
});
T.tFill_({ sheet, range: bl, formula_r1c1: '=1.4%+0.01', force: false });
const v3c = T.verify_().text;
ok(/V3 number formats ok/.test(v3c), 'V3: a format change on a cell whose content was written is not reported', (v3c.match(/V3[^\n]*/) || [''])[0].slice(0, 110));

shim.close(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
