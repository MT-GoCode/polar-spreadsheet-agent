/** Shim conformance suite: every Apps Script API surface Code.gs touches, asserted
 * against documented Apps Script behavior, running on the real mog engine.
 * Run from repo root:  node offline/conformance.mjs
 * Exits non-zero on any failure. Run before every sweep. */
import { makeShim } from './shim.mjs';
import { toA1, toR1C1 } from './a1r1c1.mjs';
import { openSession, execJSON, closeSession } from './mogc.mjs';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
}
function throws(fn, name) {
  try { fn(); ok(false, name, 'did not throw'); } catch (e) { ok(true, name); }
}

// ---------- A. a1r1c1 (pure) ----------
console.log('A. a1r1c1 conversion');
const A = [
  ['=RC4+R29C', 5, 5, '=$D5+E$29'],
  ['=RC', 5, 5, '=E5'],
  ['=R[1]C[-1]', 5, 5, '=D6'],
  ['=R2C3', 5, 5, '=$C$2'],
  ['=SUM(ARC)', 5, 5, '=SUM(ARC)'],
  ['=RC_TOTAL*2', 5, 5, '=RC_TOTAL*2'],
  ['=SUM(X!R5C3:R220C3)', 5, 5, '=SUM(X!$C$5:$C$220)'],
  ['="RC4 literal"&RC[1]', 5, 5, '="RC4 literal"&F5'],
  ['=PERCENTILE(R1C1:R9C1,0.5)', 5, 5, '=PERCENTILE($A$1:$A$9,0.5)'],
];
for (const [inp, r, c, want] of A) ok(toA1(inp, r, c) === want, 'toA1 ' + inp, toA1(inp, r, c));
throws(() => toA1('=R[-9]C', 5, 5), 'toA1 out-of-bounds throws');
for (const f of ['=SUM($B$2:B10)*Sheet2!C$3', '=IF(A1>0,"y","n")', '=VLOOKUP($A2,Data!$A:$C,3,0)']) {
  const rt = toA1(toR1C1(f, 7, 4), 7, 4);
  ok(rt === f, 'round-trip ' + f, rt);
}

// ---------- B. shim over mog ----------
const root = path.resolve(new URL('..', import.meta.url).pathname);
const tmp = mkdtempSync(path.join(tmpdir(), 'conform-'));
process.env.MOG_SESSION_DIR = tmp;
const wk = path.join(tmp, 'wk.xlsx');
copyFileSync(path.join(root, 'benchmarks/tasks/task_02/init.xlsx'), wk);
const shim = makeShim(wk);
const ss = shim.globals.SpreadsheetApp.openById('x');
const sh = ss.getSheets()[0];
const SN = sh.getName();
console.log('B. shim engine contract (sheet: ' + SN + ')');

// scratch area well outside used range
const S = (a1) => sh.getRange(a1);
S('AZ100').setValue(42.125);
ok(S('AZ100').getValue() === 42.125, 'setValue/getValue number round trip');
S('AZ101').setValue('hello world');
ok(S('AZ101').getValue() === 'hello world', 'setValue/getValue string round trip');
S('AZ102').setFormula('=AZ100*2');
ok(S('AZ102').getValue() === 84.25, 'setFormula computes');
ok(S('AZ102').getFormula() === '=AZ100*2', 'getFormula returns A1 formula');
ok(typeof S('AZ102').getFormulaR1C1 === 'function' && /R\[-2\]C/.test(S('AZ102').getFormulaR1C1()), 'getFormulaR1C1 (singular) exists and is R1C1', S('AZ102').getFormulaR1C1());

// setFormulaR1C1 relative expansion
sh.getRange(110, 52, 2, 1).setFormulaR1C1('=R[-10]C[0]+1'); // AZ110:AZ111
ok(S('AZ110').getFormula() === '=AZ100+1', 'setFormulaR1C1 row 1 anchors', S('AZ110').getFormula());
ok(S('AZ111').getFormula() === '=AZ101+1', 'setFormulaR1C1 relative shift per row', S('AZ111').getFormula());

// clearContent → truly empty in engine (the null no-op bug gate)
S('AZ100').clearContent();
ok(S('AZ100').getValue() === '', 'clearContent empties the live engine value');
// null via setValues (hatch path) also clears
S('AZ101').setValues([[null]]);
ok(S('AZ101').getValue() === '', 'setValues null clears (hatch path)');

// number formats
S('AZ103').setValue(0.5);
S('AZ103').setNumberFormat('0.0%');
ok(S('AZ103').getNumberFormats()[0][0] === '0.0%', 'setNumberFormat/getNumberFormats round trip', S('AZ103').getNumberFormats()[0][0]);

// large fill: E2BIG gate — 200 rows × 30 cols of formulas in ONE tool-level write
const big = sh.getRange(200, 60, 200, 30);
let bigErr = null;
try { big.setFormulaR1C1('=R[-100]C[-8]&""'); } catch (e) { bigErr = e; }
ok(!bigErr, 'large fill (6000 cells) does not E2BIG', String(bigErr).slice(0, 80));

// honest throws
throws(() => S('A1').getDataValidations(), 'getDataValidations throws (honest offline gap)');
throws(() => sh.getConditionalFormatRules(), 'getConditionalFormatRules throws (honest offline gap)');
throws(() => S('A1').copyTo(), 'copyTo throws');
throws(() => S('A1').setDataValidation({}), 'setDataValidation throws');

// export → reopen: cleared cells must be truly empty in the saved xlsx
const outX = path.join(tmp, 'out.xlsx');
shim.close(outX);
const s2 = openSession(outX);
const v2 = execJSON(s2, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${JSON.stringify(SN)}).getRange('AZ100:AZ101');r.load('values');await c.sync();console.log(JSON.stringify(r.values))})`);
ok((v2[0][0] === null || v2[0][0] === '') && (v2[1][0] === null || v2[1][0] === ''), 'cleared cells empty after export+reopen', JSON.stringify(v2));
closeSession(s2);

// ---------- C. font colors + named ranges on t11 (ground truth: openpyxl) ----------
console.log('C. static format reads (task_11)');
const wk11 = path.join(tmp, 'wk11.xlsx');
copyFileSync(path.join(root, 'benchmarks/tasks/task_11/init.xlsx'), wk11);
const shim11 = makeShim(wk11);
const ss11 = shim11.globals.SpreadsheetApp.openById('x');
const tc = ss11.getSheetByName('Trading Comps');
// openpyxl ground truth: 76 blue cells incl U8, D9:L9; D15 is black
const fc = tc.getRange(8, 4, 2, 18).getFontColors(); // D8:U9
ok(fc[1][0] === '#0000ff' && fc[1][8] === '#0000ff', 'known blue cells D9,L9 report #0000ff', JSON.stringify([fc[1][0], fc[1][8]]));
ok(fc[0][17] === '#0000ff', 'known blue cell U8 reports #0000ff', fc[0][17]);
ok(tc.getRange('D15').getFontColors()[0][0] === '#000000', 'black cell D15 reports default', tc.getRange('D15').getFontColors()[0][0]);
let blueCount = 0;
const all = tc.getDataRange().getFontColors();
for (const row of all) for (const x of row) if (x === '#0000ff') blueCount++;
ok(blueCount === 76, 'exactly 76 blue cells on Trading Comps (openpyxl ground truth)', String(blueCount));
const nrs = ss11.getNamedRanges();
ok(nrs.length >= 1 && typeof nrs[0].getName() === 'string' && typeof nrs[0].getRange().getA1Notation() === 'string', 'named ranges readable', String(nrs.length));
shim11.close(null);

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
