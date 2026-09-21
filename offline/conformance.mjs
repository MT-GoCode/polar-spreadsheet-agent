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

// ---------- D. map-builder unit tests (synthetic sheets, no task coupling) ----------
console.log('D. map builder units');
import { readFileSync as _rf } from 'node:fs';
const gnames = ['SpreadsheetApp','UrlFetchApp','CacheService','PropertiesService','Utilities','ContentService'];
const codeSrc = _rf(path.join(root,'Prompts.gs'),'utf8') + '\n' + _rf(path.join(root,'Code.gs'),'utf8') +
  '\nreturn { T: { labelIndexLines_, blankBlockLines_, headerLines_, hardcodeCellLines_, groupSourceSuffix_, refSets_, cellRefStatus_, coverageFrac_, setG: function(g){G=g;} } };';
const T = new Function(...gnames, codeSrc)(...gnames.map(() => ({}))).T;

function makeSn(rows) {
  // rows: array of arrays; a string starting '=' is a formula, else a value ('' or undefined = blank)
  const R = rows.length, C = Math.max(...rows.map(r => r.length));
  const v = [], f = [], r = [];
  for (let i = 0; i < R; i++) {
    v.push([]); f.push([]); r.push([]);
    for (let j = 0; j < C; j++) {
      const cell = rows[i][j];
      const isF = typeof cell === 'string' && cell.startsWith('=');
      f[i][j] = isF ? cell : '';
      v[i][j] = isF || cell === undefined ? '' : cell;
      r[i][j] = isF ? toR1C1(cell, i + 1, j + 1) : '';
    }
  }
  return { v, f, r, R, C };
}
function compOf(sn) {
  let hdr = -1;
  for (let i = 0; i < Math.min(10, sn.R); i++) { let n = 0; for (let j = 0; j < Math.min(sn.C, 60); j++) if (sn.v[i][j] !== '') n++; if (n >= 3) { hdr = i; break; } }
  const comp = [];
  for (let j = 0; j < sn.C; j++) { let ne = 0, ff = 0; for (let i = 0; i < sn.R; i++) { if (i === hdr) continue; const has = sn.f[i][j] !== '' || sn.v[i][j] !== ''; if (has) { ne++; if (sn.f[i][j]) ff++; } } comp.push(ne === 0 ? 'blank' : ff / ne > 0.6 ? 'formula' : ff / ne < 0.4 ? 'value' : 'mixed'); }
  return comp;
}
const lastUsedOf = comp => { let l = 0; for (let j = 0; j < comp.length; j++) if (comp[j] !== 'blank') l = j; return l; };

// labelIndexLines_: non-consecutive duplicate label with differing sibling value
{
  const sn = makeSn([['Cost', 10], ['Rev', 5], ['Cost', 20]]);
  const out = T.labelIndexLines_(sn, lastUsedOf(compOf(sn))).join('\n');
  ok(/duplicate labels:/.test(out) && /"Cost" ×2/.test(out) && /values differ/.test(out), 'labelIndex: duplicate + values-differ', out);
}
// labelIndexLines_: lone text row → section
{
  const sn = makeSn([['Assumptions'], ['Rate', 0.05], ['Term', 5], ['Fee', 3]]);
  const out = T.labelIndexLines_(sn, lastUsedOf(compOf(sn))).join('\n');
  ok(/sections:.*Assumptions/.test(out), 'labelIndex: section header', out);
}
// labelIndexLines_: high cardinality → distinct-count
{
  const rows = []; for (let i = 1; i <= 40; i++) rows.push(['Item ' + i, i]);
  const sn = makeSn(rows);
  const out = T.labelIndexLines_(sn, lastUsedOf(compOf(sn))).join('\n');
  ok(/40 distinct/.test(out), 'labelIndex: high-cardinality distinct-count', out);
}
// headerRowLine_: numeric arithmetic series compresses
{
  const sn = makeSn([['Year', 2021, 2022, 2023, 2024, 2025]]);
  const out = T.headerLines_(sn).join('\n');
  ok(/= 2021\.\.2025/.test(out), 'header: numeric series compressed', out);
}
// headerRowLine_: text headers listed with columns
{
  const sn = makeSn([['Name', 'Amount', 'Date']]);
  const out = T.headerLines_(sn).join('\n');
  ok(/A="Name"/.test(out) && /B="Amount"/.test(out), 'header: text columns', out);
}
// headerLines_: arithmetic series living in a FORMULA row is caught, alongside text header (gap 2)
{
  const sn = makeSn([
    ['Month', 'Jan', 'Feb', 'Mar', 'Apr'],
    ['Period', '=B1', '=B2+1', '=C2+1', '=D2+1'],  // computed 1..? — need values
  ]);
  // formula row values are computed by mog at runtime; here simulate computed series in v
  sn.v[1] = ['Period', 1, 2, 3, 4]; sn.C = 5;
  const out = T.headerLines_(sn).join('\n');
  ok(/hdr r2:.*= 1\.\.4/.test(out), 'header: series in formula row detected (gap 2)', out);
}
// hardcodeCellLines_: numeric constant inside a formula column
{
  const sn = makeSn([['x', '=A1'], ['y', 42], ['z', '=A3']]);
  const out = T.hardcodeCellLines_(sn, compOf(sn)).join('\n');
  ok(/constants in formula regions:.*B2=42/.test(out), 'hardcode: constant in formula col', out);
}
// hardcodeCellLines_: constant embedded in a formula-DOMINANT row (gap 1)
{
  // row 2: 4 formulas + one numeric constant in col C (an all-'value' column by composition)
  const sn = makeSn([
    ['Scenario', 'A', 'B', 'C', 'D', 'E'],
    ['S1', '=A2', 42, '=C2', '=D2', '=E2'],
  ]);
  const out = T.hardcodeCellLines_(sn, compOf(sn)).join('\n');
  ok(/constants in formula regions:.*C2=42/.test(out), 'hardcode: constant in formula-dominant row (gap 1)', out);
}
// blankBlockLines_: header-only blank column is flagged as output area
{
  const rows = [['Cust', 'Year', 'Amount']];
  for (let i = 1; i <= 10; i++) rows.push(['C' + i, 2020 + i]);   // Amount col blank
  const sn = makeSn(rows);
  T.setG({ snap: { TestSheet: sn } });
  const comp = compOf(sn);
  const out = T.blankBlockLines_(sn, comp, lastUsedOf(comp), 'TestSheet').join('\n');
  ok(/blank blocks .*C2:C11.*under "Amount"/.test(out), 'blankBlock: header-only blank column', out);
  T.setG(null);
}
// groupSourceSuffix_: cross-sheet source shown, near ref suppressed
{
  const cross = T.groupSourceSuffix_({ rf: "=SUM('Data'!R5C3:R9C3)", c1: 1, c2: 1, i1: 1, i2: 1 }, 'Model');
  ok(/'Data'!C/.test(cross), 'groupSource: cross-sheet ref shown', cross);
  const near = T.groupSourceSuffix_({ rf: '=R[-1]C[0]', c1: 3, c2: 3, i1: 5, i2: 5 }, 'Model');
  ok(near === '', 'groupSource: near ref suppressed', JSON.stringify(near));
}

// H5: refSets_ live/stale from formula graph
{
  // Sheet1 has a formula in B2 that references A5 (single cell); A9 is unreferenced.
  const mk = (rows) => { const R=rows.length,C=Math.max(...rows.map(r=>r.length)),v=[],f=[],r=[];
    for(let i=0;i<R;i++){v.push([]);f.push([]);r.push([]);for(let j=0;j<C;j++){const c=rows[i][j];const isF=typeof c==='string'&&c.startsWith('=');f[i][j]=isF?c:'';v[i][j]=isF||c===undefined?'':c;r[i][j]='';}}return{v,f,r,R,C};};
  const sn = mk([['x',0],['y','=A5'],['z',0],['w',0],['lbl',7],['q',0],['e',0],['t',0],['orphan',3]]);
  T.setG({ snap: { S1: sn } });
  const rs = T.refSets_();
  ok(T.cellRefStatus_(rs,'S1',5,1,2)==='live', 'refSets: referenced row = live', T.cellRefStatus_(rs,'S1',5,1,2));
  ok(T.cellRefStatus_(rs,'S1',9,1,2)==='stale', 'refSets: unreferenced row = stale', T.cellRefStatus_(rs,'S1',9,1,2));
  T.setG(null);
}
// H5: whole-column ref → ambiguous, not live
{
  const mk = (rows) => { const R=rows.length,C=Math.max(...rows.map(r=>r.length)),v=[],f=[],r=[];
    for(let i=0;i<R;i++){v.push([]);f.push([]);r.push([]);for(let j=0;j<C;j++){const c=rows[i][j];const isF=typeof c==='string'&&c.startsWith('=');f[i][j]=isF?c:'';v[i][j]=isF||c===undefined?'':c;r[i][j]='';}}return{v,f,r,R,C};};
  const sn = mk([['=SUM(B1:B9)',1],['a',2],['b',3]]);
  T.setG({ snap: { S1: sn } });
  const rs = T.refSets_();
  ok(T.cellRefStatus_(rs,'S1',2,2,2)==='ambiguous', 'refSets: whole-range member = ambiguous (not live)', T.cellRefStatus_(rs,'S1',2,2,2));
  T.setG(null);
}
// H9: coverageFrac_
{
  const tgt=[{kind:'formula',sheetName:'S1',bounds:{r1:1,r2:10,c1:1,c2:1}}]; // 10 cells
  const as=[{check:'equals',sheetName:'S1',bounds:{r1:1,r2:5,c1:1,c2:1}}];   // 5 covered
  ok(Math.abs(T.coverageFrac_(tgt,as)-0.5)<1e-9, 'coverageFrac: half covered', T.coverageFrac_(tgt,as));
  ok(T.coverageFrac_(tgt,[])===0, 'coverageFrac: none covered = 0', T.coverageFrac_(tgt,[]));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
