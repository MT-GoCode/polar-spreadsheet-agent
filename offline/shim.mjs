/** Apps Script API shim over a mog session. Code.gs runs byte-identical on top of this.
 * Honest gaps (throw → in-band tool ERROR): DV/CF builders, per-cell font colors. */
import { openSession, exec, execJSON, closeSession, MOGBIN } from './mogc.mjs';
import { toR1C1 } from './a1r1c1.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

function colStr(n) { let s = ''; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; }

export function makeShim(xlsxPath) {
  const session = openSession(xlsxPath);
  const cache = {};   // sheet -> {v,f,r,R,C, dirtyV}
  let sheetNames = execJSON(session, `await Excel.run(async c=>{const s=c.workbook.worksheets;s.load('items/name');await c.sync();console.log(JSON.stringify(s.items.map(x=>x.name)))})`);
  let iterative = false;
  try {
    const wbxml = execSync(`unzip -p ${JSON.stringify(xlsxPath)} xl/workbook.xml`, { encoding: 'utf8' });
    iterative = /iterate="(1|true)"/.test(wbxml);
  } catch (e) {}

  function q(s) { return JSON.stringify(s); }
  function loadSheet(name) {
    if (cache[name] && !cache[name].dirtyV) return cache[name];
    const dims = execJSON(session, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${q(name)}).getUsedRange(true);r.load('rowCount,columnCount,rowIndex,columnIndex');await c.sync();console.log(JSON.stringify([r.rowIndex+r.rowCount, r.columnIndex+r.columnCount]))})`);
    const R = dims[0], C = dims[1];
    if (R === 0 || C === 0) { cache[name] = { v: [], f: [], r: [], R: 0, C: 0 }; return cache[name]; }
    const v = execJSON(session, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${q(name)}).getRangeByIndexes(0,0,${R},${C});r.load('values');await c.sync();console.log(JSON.stringify(r.values))})`);
    let f = null;
    if (!cache[name] || !cache[name].f.length) {
      f = execJSON(session, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${q(name)}).getRangeByIndexes(0,0,${R},${C});r.load('formulas');await c.sync();console.log(JSON.stringify(r.formulas))})`);
    } else f = cache[name].f;
    // Office.js 'formulas' returns the VALUE for non-formula cells; normalize: formula iff string starting '='
    const fN = f.map(row => row.map(x => (typeof x === 'string' && x.startsWith('=')) ? x : ''));
    const rN = fN.map((row, i) => row.map((x, j) => x ? toR1C1(x, i + 1, j + 1) : ''));
    cache[name] = { v: v.map(row => row.map(x => x === null ? '' : x)), f: fN, r: rN, R, C, dirtyV: false };
    return cache[name];
  }
  function markDirty() { for (const k in cache) cache[k].dirtyV = true; }
  function writeCells(sheet, r0, c0, grid, asFormula) {
    const h = grid.length, w = grid[0].length;
    exec(session, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${q(sheet)}).getRangeByIndexes(${r0 - 1},${c0 - 1},${h},${w});r.${asFormula ? 'formulas' : 'values'}=${JSON.stringify(grid)};await c.sync();})`);
    const sh = cache[sheet];
    if (sh) {
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
        const rr = r0 - 1 + i, cc = c0 - 1 + j;
        while (sh.v.length <= rr) { sh.v.push([]); sh.f.push([]); sh.r.push([]); }
        for (const g of [sh.v[rr], sh.f[rr], sh.r[rr]]) while (g.length <= cc) g.push('');
        const val = grid[i][j];
        if (asFormula && typeof val === 'string' && val.startsWith('=')) {
          sh.f[rr][cc] = val; sh.r[rr][cc] = toR1C1(val, rr + 1, cc + 1);
        } else if (!asFormula) { sh.f[rr][cc] = ''; sh.r[rr][cc] = ''; sh.v[rr][cc] = val === null ? '' : val; }
        sh.R = Math.max(sh.R, rr + 1); sh.C = Math.max(sh.C, cc + 1);
      }
    }
    markDirty();
  }
  function readLive(sheet, r0, c0, h, w) {
    return execJSON(session, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${q(sheet)}).getRangeByIndexes(${r0 - 1},${c0 - 1},${h},${w});r.load('values');await c.sync();console.log(JSON.stringify(r.values))})`).map(row => row.map(x => x === null ? '' : x));
  }

  function Range(sheetName, r, c, h, w) {
    const self = {
      getRow: () => r, getColumn: () => c,
      getNumRows: () => h, getNumColumns: () => w,
      getA1Notation: () => colStr(c) + r + (h * w > 1 ? ':' + colStr(c + w - 1) + (r + h - 1) : ''),
      getValues: () => { const live = readLive(sheetName, r, c, h, w); return live; },
      getValue: () => self.getValues()[0][0],
      getDisplayValues: () => self.getValues().map(row => row.map(x => x === null || x === undefined ? '' : String(x))),
      getFormulas: () => { const sh = loadSheet(sheetName); const out = []; for (let i = 0; i < h; i++) { const row = []; for (let j = 0; j < w; j++) row.push((sh.f[r - 1 + i] || [])[c - 1 + j] || ''); out.push(row); } return out; },
      getFormula: () => self.getFormulas()[0][0],
      getFormulasR1C1: () => { const sh = loadSheet(sheetName); const out = []; for (let i = 0; i < h; i++) { const row = []; for (let j = 0; j < w; j++) row.push((sh.r[r - 1 + i] || [])[c - 1 + j] || ''); out.push(row); } return out; },
      setValue: (val) => { writeCells(sheetName, r, c, [[val]], typeof val === 'string' && val.startsWith('=')); return self; },
      setValues: (grid) => { writeCells(sheetName, r, c, grid, false); return self; },
      setFormula: (fml) => { writeCells(sheetName, r, c, [[fml]], true); return self; },
      setFormulaR1C1: (fml) => {
        const { toA1 } = shimConv;
        const grid = [];
        for (let i = 0; i < h; i++) { const row = []; for (let j = 0; j < w; j++) row.push(toA1(fml, r + i, c + j)); grid.push(row); }
        writeCells(sheetName, r, c, grid, true); return self;
      },
      clearContent: () => { writeCells(sheetName, r, c, Array.from({ length: h }, () => Array(w).fill(null)), false); const sh = cache[sheetName]; if (sh) for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { if (sh.v[r-1+i]) sh.v[r-1+i][c-1+j]=''; if (sh.f[r-1+i]) { sh.f[r-1+i][c-1+j]=''; sh.r[r-1+i][c-1+j]=''; } } return self; },
      getNumberFormats: () => execJSON(session, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${q(sheetName)}).getRangeByIndexes(${r - 1},${c - 1},${h},${w});r.load('numberFormat');await c.sync();console.log(JSON.stringify(r.numberFormat))})`).map(row => row.map(x => x === null ? 'General' : x)),
      setNumberFormat: (fmt) => { exec(session, `await Excel.run(async c=>{const r=c.workbook.worksheets.getItem(${q(sheetName)}).getRangeByIndexes(${r - 1},${c - 1},${h},${w});r.numberFormat=${JSON.stringify(Array.from({ length: h }, () => Array(w).fill(fmt)))};await c.sync();})`); return self; },
      getFontColors: () => Array.from({ length: h }, () => Array(w).fill('#000000')), // offline cap: per-cell colors unavailable
      getDataValidations: () => Array.from({ length: h }, () => Array(w).fill(null)),
      getDataValidation: () => null,
      setDataValidation: () => { throw new Error('offline backend: data-validation unsupported (run online for this task)'); },
      getCell: (ri, ci) => Range(sheetName, r + ri - 1, c + ci - 1, 1, 1),
      copyTo: () => { throw new Error('offline backend: copyTo unsupported; use setFormulaR1C1'); },
    };
    return self;
  }
  function parseA1(a1) {
    const m = a1.replace(/\$/g, '').match(/^([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$/);
    if (!m) throw new Error('Bad range: ' + a1);
    const cn = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
    const c1 = cn(m[1]), r1 = +m[2], c2 = m[3] ? cn(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
    return { r: Math.min(r1, r2), c: Math.min(c1, c2), h: Math.abs(r2 - r1) + 1, w: Math.abs(c2 - c1) + 1 };
  }
  function Sheet(name) {
    return {
      getName: () => name,
      getLastRow: () => loadSheet(name).R,
      getLastColumn: () => loadSheet(name).C,
      getFrozenRows: () => 0, getFrozenColumns: () => 0,
      getRange: (...args) => {
        if (args.length === 1) { const p = parseA1(args[0]); return Range(name, p.r, p.c, p.h, p.w); }
        const [r, c, h, w] = [args[0], args[1], args[2] || 1, args[3] || 1];
        return Range(name, r, c, h, w);
      },
      getDataRange: () => { const sh = loadSheet(name); return Range(name, 1, 1, Math.max(sh.R, 1), Math.max(sh.C, 1)); },
      getConditionalFormatRules: () => [],
      setConditionalFormatRules: () => { throw new Error('offline backend: conditional formats unsupported (run online)'); },
    };
  }
  const ss = {
    getSheets: () => sheetNames.map(Sheet),
    getSheetByName: (n) => sheetNames.includes(n) ? Sheet(n) : null,
    getNamedRanges: () => [],
    isIterativeCalculationEnabled: () => iterative,
  };
  const kv = new Map(), props = new Map();
  const globals = {
    SpreadsheetApp: {
      openById: () => ss,
      flush: () => {}, // every mog exec recalcs at script end
      newDataValidation: () => { throw new Error('offline backend: data-validation unsupported'); },
      newConditionalFormatRule: () => { throw new Error('offline backend: conditional formats unsupported'); },
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const args = ['-sS', '-X', (opts.method || 'get').toUpperCase(), url, '--max-time', '120', '-w', '\n%{http_code}'];
        for (const k in (opts.headers || {})) args.push('-H', k + ': ' + opts.headers[k]);
        if (opts.contentType) args.push('-H', 'Content-Type: ' + opts.contentType);
        if (opts.payload) args.push('--data-binary', opts.payload);
        const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const idx = out.lastIndexOf('\n');
        const code = parseInt(out.slice(idx + 1).trim(), 10);
        const body = out.slice(0, idx);
        return { getResponseCode: () => code, getContentText: () => body };
      },
    },
    CacheService: { getScriptCache: () => ({ put: (k, v) => kv.set(k, v), get: (k) => kv.has(k) ? kv.get(k) : null }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => props.has(k) ? props.get(k) : (k === 'OPENAI_KEY' ? (process.env.OPENAI_KEY || (function(){ try { return readFileSync(process.env.HOME + '/.config/polar-openai-key', 'utf8').trim(); } catch (e) { return null; } })()) : null),
      setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    Utilities: { sleep: (ms) => execFileSync('sleep', [String(ms / 1000)]),
      formatDate: (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
  };
  return { globals, close: (outPath) => closeSession(session, outPath), session, mogbin: MOGBIN };
}
import * as shimConv from './a1r1c1.mjs';
