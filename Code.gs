/**
 * Spreadsheet agent harness. See research/SPEC.md (repo: conversation-contexts/polar-takehome).
 * Attempt semantics: plan-as-contract, typed writes, mechanical verification, revert on re-plan.
 * runAgent NEVER throws: the transcript is part of the return contract on every path.
 */
const MODEL = 'gpt-5.4';
const EFFORT = 'medium';
const MAX_OUT = 16000;
const DEADLINE_MS = 1200 * 1000; // 20 min (offline/mog). Online Apps Script still hard-kills at 6 min regardless.
const MODEL_CALL_MIN_LEFT = 75 * 1000;
const HARD_RETURN_LEFT = 30 * 1000;
const PRICE = { inp: 2.5, cached: 0.25, out: 15 }; // $/M
const ERRS = [
  '#REF!',
  '#VALUE!',
  '#DIV/0!',
  '#NAME?',
  '#N/A',
  '#NULL!',
  '#NUM!',
  '#ERROR!',
];
const BIG_SHEET_CELLS = 20000;

// ---------- state (per execution) ----------
var G = null; // {ss,id,t0,snap,orig dims,baseErr,plan,writes,oldmap,fmtBase,dvBase,cfBase,written,attempt,failedOpen,trace,turn,prevId,cost}

function isErr_(v) {
  if (typeof v !== 'string') return false;
  for (var i = 0; i < ERRS.length; i++)
    if (v.indexOf(ERRS[i]) === 0) return true;
  return false;
}
function colNum_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64;
  return n;
}
function colStr_(n) {
  var s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function parseA1_(a1) {
  // "A1" or "A1:B2" -> {c1,r1,c2,r2}
  var m = a1
    .replace(/\$/g, '')
    .match(/^([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$/);
  if (!m) throw new Error('Bad range: ' + a1);
  var c1 = colNum_(m[1]),
    r1 = +m[2],
    c2 = m[3] ? colNum_(m[3]) : c1,
    r2 = m[4] ? +m[4] : r1;
  return {
    c1: Math.min(c1, c2),
    r1: Math.min(r1, r2),
    c2: Math.max(c1, c2),
    r2: Math.max(r1, r2),
  };
}
function splitRef_(ref) {
  // "Sheet!A1:B2" -> {sheet,a1}; quoted names ok
  var m = ref.match(/^'([^']+)'!(.+)$/) || ref.match(/^([^!]+)!(.+)$/);
  if (!m) throw new Error('Range needs Sheet! prefix: ' + ref);
  return { sheet: m[1], a1: m[2] };
}
function short_(v, n) {
  // Truncation is always visible ('…'); rounded numbers always marked ('~').
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  if (typeof v === 'number') {
    var r4 = Math.round(v * 10000) / 10000;
    return String(r4) + (r4 === v ? '' : '~');
  }
  var s = String(v);
  return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
}
function full_(v) {
  // Full-precision render for single-cell contexts (trace, write echoes).
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  if (typeof v === 'number') {
    var p = Number(v.toPrecision(10));
    return String(p) + (p === v ? '' : '~');
  }
  return String(v);
}

// ---------- transcript ----------
function ev_(type, data) {
  data = data || {};
  data.t = type;
  data.at = Date.now() - G.t0;
  G.trace.push(data);
}
function ckpt_() {
  try {
    if ((G.ckptFrom || 0) >= G.trace.length) return;
    var cache = CacheService.getScriptCache();
    var body = JSON.stringify(G.trace.slice(G.ckptFrom || 0));
    var key = 'tr:' + G.id + ':' + G.turn;
    if (body.length <= 90000) cache.put(key, body, 21600);
    else {
      var parts = Math.ceil(body.length / 85000);
      cache.put(key, 'CHUNKS:' + parts, 21600);
      for (var p = 0; p < parts; p++)
        cache.put(key + '.' + p, body.slice(p * 85000, (p + 1) * 85000), 21600);
    }
    cache.put('tr:' + G.id + ':n', String(G.turn), 21600);
    G.ckptFrom = G.trace.length;
  } catch (e) {}
}
function doGet(e) {
  var p = e.parameter || {};
  var out = '[]';
  if (p.trace) {
    var cache2 = CacheService.getScriptCache();
    var n = +(cache2.get('tr:' + p.trace + ':n') || -1);
    var parts2 = [];
    for (var i = 0; i <= n; i++) {
      var sh0 = cache2.get('tr:' + p.trace + ':' + i);
      if (sh0 && sh0.indexOf('CHUNKS:') === 0) {
        var k0 = +sh0.slice(7), buf = '';
        for (var c0 = 0; c0 < k0; c0++) buf += cache2.get('tr:' + p.trace + ':' + i + '.' + c0) || '';
        sh0 = buf;
      }
      if (sh0) parts2.push(sh0.replace(/^\[/, '').replace(/\]$/, ''));
    }
    out = '[' + parts2.filter(function (x) { return x; }).join(',') + ']';
  } else if (p.hb)
    out =
      PropertiesService.getScriptProperties().getProperty('hb:' + p.hb) || '[]';
  return ContentService.createTextOutput(out).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function hb_(phase) {
  try {
    var ps = PropertiesService.getScriptProperties();
    var l = JSON.parse(ps.getProperty('hb:' + G.id) || '[]');
    l.push([phase, Date.now() - G.t0]);
    ps.setProperty('hb:' + G.id, JSON.stringify(l.slice(-80)));
  } catch (e) {}
}

// ---------- snapshot / describe ----------
function snapshotAll_() {
  G.snap = {};
  G.baseErr = {};
  var sheets = G.ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s],
      name = sh.getName();
    var R = sh.getLastRow(),
      C = sh.getLastColumn();
    hb_('snap:' + name);
    if (R === 0 || C === 0) {
      G.snap[name] = { R: 0, C: 0, v: [], f: [], r: [] };
      continue;
    }
    var rng = sh.getRange(1, 1, R, C);
    G.snap[name] = {
      R: R,
      C: C,
      v: rng.getValues(),
      f: rng.getFormulas(),
      r: rng.getFormulasR1C1(),
    };
    // Number-format baseline for V3. Style-strict preservation is a pass gate and
    // nothing used to check it: 3103 style violations shipped with a green report.
    // Degrade per sheet rather than blinding the axis workbook-wide.
    try {
      G.snap[name].nf = rng.getNumberFormats();
    } catch (e) {
      G.snap[name].nf = null;
      G.snap[name].nfErr = String(e).slice(0, 80);
    }
    var errs = [];
    var v = G.snap[name].v;
    for (var i = 0; i < R; i++)
      for (var j = 0; j < C; j++)
        if (isErr_(v[i][j])) errs.push(colStr_(j + 1) + (i + 1));
    G.baseErr[name] = errs;
  }
}
function cellNow_(sheet, r, c) {
  // entered content incl. overlay: {f (A1 formula or ''), rf (r1c1), v}
  var w = G.writes[sheet] && G.writes[sheet][colStr_(c) + r];
  if (w) return w;
  var sn = G.snap[sheet];
  if (!sn || r > sn.R || c > sn.C) return { f: '', rf: '', v: '' };
  return {
    f: sn.f[r - 1][c - 1],
    rf: sn.r[r - 1][c - 1],
    v: sn.v[r - 1][c - 1],
  };
}
function snapBlank_(sheet, r, c) {
  var sn = G.snap[sheet];
  if (!sn || r > sn.R || c > sn.C) return true; // outside run-start used range = blank
  var f = sn.f[r - 1][c - 1], v = sn.v[r - 1][c - 1];
  return f === '' && (v === '' || v === null);
}
function labelOf_(sheet, r, cMax) {
  var sn = G.snap[sheet];
  if (!sn) return '';
  for (var c = Math.min(cMax - 1, sn.C); c >= 1; c--) {
    var v = sn.v[r - 1] && sn.v[r - 1][c - 1];
    if (typeof v === 'string' && v.trim() && sn.f[r - 1][c - 1] === '')
      return short_(v, 40);
  }
  return '';
}
function headerOf_(sheet, c, rMax) {
  var sn = G.snap[sheet];
  if (!sn) return '';
  for (var r = Math.min(rMax - 1, sn.R); r >= 1; r--) {
    var v = sn.v[r - 1] && sn.v[r - 1][c - 1];
    if (typeof v === 'string' && v.trim()) return short_(v, 40);
  }
  return '';
}

function rectGroups_(r1c1grid, R, C) {
  // -> [{rf,c1,c2,rows:[..]}] merged rects [{rf,c1,c2,i1,i2}]
  var runs = {};
  for (var i = 0; i < R; i++) {
    var j = 0;
    var row = r1c1grid[i];
    while (j < C) {
      var f = row[j];
      if (f) {
        var k = j;
        while (k + 1 < C && row[k + 1] === f) k++;
        var key = f + '|' + j + '|' + k;
        (runs[key] = runs[key] || { rf: f, j0: j, j1: k, rows: [] }).rows.push(
          i,
        );
        j = k + 1;
      } else j++;
    }
  }
  var rects = [];
  for (var key2 in runs) {
    var u = runs[key2];
    var rows = u.rows;
    var s = rows[0],
      p = rows[0];
    for (var x = 1; x <= rows.length; x++) {
      var r = rows[x];
      if (x === rows.length || r !== p + 1) {
        rects.push({
          rf: u.rf,
          c1: u.j0 + 1,
          c2: u.j1 + 1,
          i1: s + 1,
          i2: p + 1,
        });
        s = r;
      }
      p = r;
    }
  }
  rects.sort(function (a, b) {
    return (
      (b.c2 - b.c1 + 1) * (b.i2 - b.i1 + 1) -
      (a.c2 - a.c1 + 1) * (a.i2 - a.i1 + 1)
    );
  });
  return rects;
}


// ---------- describe v2 helpers (pure snapshot computation) ----------
function labelIndexLines_(sn, lastUsed, rs, sheetName) {
  // leftmost text-dominant column = the label column
  var best = -1, bestN = 0;
  for (var j = 0; j < Math.min(4, sn.C); j++) {
    var n = 0;
    for (var i = 0; i < sn.R; i++)
      if (typeof sn.v[i][j] === 'string' && sn.v[i][j] !== '' && !sn.f[i][j]) n++;
    if (n > bestN) { bestN = n; best = j; }
  }
  if (best < 0 || bestN < 3) return [];
  var out = [], runs = [], i = 0;
  while (i < sn.R) {
    var v = sn.v[i][best];
    if (typeof v !== 'string' || v === '' || sn.f[i][best]) { i++; continue; }
    var j2 = i;
    while (j2 + 1 < sn.R && sn.v[j2 + 1][best] === v && !sn.f[j2 + 1][best]) j2++;
    runs.push({ v: v, r1: i + 1, r2: j2 + 1 });
    i = j2 + 1;
  }
  // section headers: label text with rest of row blank
  var secs = [];
  for (var k = 0; k < runs.length; k++) {
    if (runs[k].r1 !== runs[k].r2) continue;
    var r0 = runs[k].r1 - 1, lone = true;
    for (var j3 = best + 1; j3 <= lastUsed; j3++)
      if (sn.v[r0][j3] !== '' || sn.f[r0][j3]) { lone = false; break; }
    if (lone) secs.push('r' + runs[k].r1 + ' "' + short_(runs[k].v, 40) + '"');
  }
  if (secs.length) out.push('  sections: ' + secs.slice(0, 12).join(' · ') + (secs.length > 12 ? ' +' + (secs.length - 12) + ' more' : ''));
  // duplicate labels with value-divergence flag
  var byLabel = {};
  runs.forEach(function (rn) { (byLabel[rn.v] = byLabel[rn.v] || []).push(rn); });
  var dups = [], dupN = 0;
  for (var lbl in byLabel)
    if (byLabel[lbl].length > 1 && dupN < 6) {
      var occ = byLabel[lbl], differ = false;
      for (var jc = best + 1; jc <= lastUsed && !differ; jc++) {
        var v0 = sn.v[occ[0].r1 - 1][jc], v1 = sn.v[occ[1].r1 - 1][jc];
        if (typeof v0 === 'number' && typeof v1 === 'number' && Math.abs(v0 - v1) > 1e-9) differ = true;
      }
      dups.push('"' + short_(lbl, 30) + '" ×' + occ.length + ': ' +
        occ.slice(0, 4).map(function (o) {
          var st = rs ? '[' + cellRefStatus_(rs, sheetName, o.r1, best + 2, lastUsed + 1) + ']' : '';
          return 'r' + o.r1 + st;
        }).join(',') +
        (differ ? ' (values differ)' : ''));
      dupN++;
    }
  if (dups.length) out.push('  duplicate labels: ' + dups.join(' · '));
  // label runs or distinct-count for high cardinality
  var distinct = Object.keys(byLabel).length;
  if (distinct > 30) {
    var ks = Object.keys(byLabel).sort();
    out.push('  labels col ' + colStr_(best + 1) + ': ' + distinct + ' distinct ("' + short_(ks[0], 24) + '" … "' + short_(ks[ks.length - 1], 24) + '")');
  } else {
    for (var m = 0; m < Math.min(runs.length, 25); m++) {
      var rn2 = runs[m];
      out.push('  · ' + colStr_(best + 1) + rn2.r1 + (rn2.r2 > rn2.r1 ? ':' + rn2.r2 + ' ×' + (rn2.r2 - rn2.r1 + 1) : '') + ' "' + short_(rn2.v, 40) + '"');
    }
    if (runs.length > 25) out.push('  · +' + (runs.length - 25) + ' more label runs');
  }
  return out;
}
function blankBlockLines_(sn, comp, lastUsed, name) {
  // header row index (first row with >=3 nonblanks) so header-only columns count as output areas
  var hdrRow = -1;
  for (var ih = 0; ih < Math.min(10, sn.R); ih++) {
    var nh = 0;
    for (var jh = 0; jh < Math.min(sn.C, 60); jh++) if (sn.v[ih][jh] !== '') nh++;
    if (nh >= 3) { hdrRow = ih; break; }
  }
  // extend column extent to any column carrying a header, even if otherwise blank (t03 output col)
  var maxCol = lastUsed;
  if (hdrRow >= 0)
    for (var jc = 0; jc < sn.C; jc++)
      if (sn.v[hdrRow][jc] !== '') maxCol = Math.max(maxCol, jc);
  var grid = [];
  for (var i = 0; i < sn.R; i++) {
    var row = [];
    for (var j = 0; j <= maxCol; j++) {
      var headed = hdrRow >= 0 && sn.v[hdrRow][j] !== '';
      var candidate = (comp[j] !== 'blank' || headed) && i !== hdrRow;
      row.push(sn.v[i][j] === '' && !sn.f[i][j] && candidate ? 'B' : '');
    }
    grid.push(row);
  }
  var rects = rectGroups_(grid, sn.R, maxCol + 1).filter(function (rc) {
    return rc.rf === 'B' && (rc.c2 - rc.c1 + 1) * (rc.i2 - rc.i1 + 1) >= 8;
  });
  rects.sort(function (a, b) {
    return (b.c2 - b.c1 + 1) * (b.i2 - b.i1 + 1) - (a.c2 - a.c1 + 1) * (a.i2 - a.i1 + 1);
  });
  if (!rects.length) return [];
  var parts = rects.slice(0, 6).map(function (rc) {
    var hdr = headerOf_(name, rc.c1, rc.i1);
    return colStr_(rc.c1) + rc.i1 + ':' + colStr_(rc.c2) + rc.i2 + (hdr ? ' (under "' + short_(hdr, 20) + '")' : '');
  });
  return ['  blank blocks (likely output areas): ' + parts.join(' · ')];
}
function seriesInRow_(vals, C) {
  // longest arithmetic numeric run in a row (values grid holds computed formula values too)
  var best = null;
  for (var s = 0; s < C; s++) {
    if (typeof vals[s] !== 'number') continue;
    var last = s, d = null, cnt = 1;
    for (var j = s + 1; j < C && typeof vals[j] === 'number'; j++) {
      var dd = vals[j] - vals[j - 1];
      if (d === null) d = dd;
      else if (Math.abs(dd - d) > 1e-9) break;
      last = j; cnt++;
    }
    if (cnt >= 4 && (!best || cnt > best.cnt)) best = { first: s, last: last, d: d, cnt: cnt };
    s = last;
  }
  return best;
}
function headerLines_(sn) {
  var out = [];
  // (a) first label/header row: >=3 nonblanks
  var textRow = -1;
  for (var i = 0; i < Math.min(10, sn.R); i++) {
    var n = 0;
    for (var j = 0; j <= Math.min(sn.C - 1, 60); j++) if (sn.v[i][j] !== '') n++;
    if (n >= 3) { textRow = i; break; }
  }
  // (b) best arithmetic series row (period axis) anywhere in the first 12 rows —
  //     reads sn.v so a formula-valued axis (=R[0]C[-1]+1) is caught too
  var seriesRow = -1, seriesBest = null;
  for (var i2 = 0; i2 < Math.min(12, sn.R); i2++) {
    var sb = seriesInRow_(sn.v[i2], sn.C);
    if (sb && (!seriesBest || sb.cnt > seriesBest.cnt)) { seriesBest = sb; seriesRow = i2; }
  }
  function seriesLine(r, sb) {
    return '  hdr r' + (r + 1) + ': ' + colStr_(sb.first + 1) + ':' + colStr_(sb.last + 1) +
      ' = ' + full_(sn.v[r][sb.first]) + '..' + full_(sn.v[r][sb.last]) + (sb.d !== 1 ? ' step ' + full_(sb.d) : '');
  }
  if (textRow >= 0 && textRow !== seriesRow) {
    var vals = sn.v[textRow], nn = 0, cells = [];
    for (var j4 = 0; j4 < sn.C; j4++) if (vals[j4] !== '') nn++;
    for (var j5 = 0; j5 < sn.C && cells.length < 15; j5++)
      if (vals[j5] !== '') cells.push(colStr_(j5 + 1) + '="' + short_(vals[j5], 24) + '"');
    out.push('  hdr r' + (textRow + 1) + ': ' + cells.join(' ') + (nn > 15 ? ' +' + (nn - 15) + ' more' : ''));
  }
  if (seriesRow >= 0) out.push(seriesLine(seriesRow, seriesBest));
  else if (textRow >= 0 && out.length === 0) {
    var vals2 = sn.v[textRow], nn2 = 0, cells2 = [];
    for (var j6 = 0; j6 < sn.C; j6++) if (vals2[j6] !== '') nn2++;
    for (var j7 = 0; j7 < sn.C && cells2.length < 15; j7++)
      if (vals2[j7] !== '') cells2.push(colStr_(j7 + 1) + '="' + short_(vals2[j7], 24) + '"');
    out.push('  hdr r' + (textRow + 1) + ': ' + cells2.join(' ') + (nn2 > 15 ? ' +' + (nn2 - 15) + ' more' : ''));
  }
  return out;
}
function hardcodeCellLines_(sn, comp) {
  var seen = {}, hits = [];
  function add(i, j) {
    var a1 = colStr_(j + 1) + (i + 1);
    if (seen[a1]) return;
    seen[a1] = 1;
    hits.push(a1 + '=' + full_(sn.v[i][j]));
  }
  // column-wise: constant sitting in a formula-dominant column
  for (var j = 0; j < sn.C; j++) {
    if (comp[j] !== 'formula') continue;
    for (var i = 0; i < sn.R; i++)
      if (!sn.f[i][j] && typeof sn.v[i][j] === 'number') add(i, j);
  }
  // row-wise: constant sitting in a formula-dominant row (catches all-constant metric
  // columns that read as 'value' but sit among formula siblings — general anomaly).
  for (var i2 = 0; i2 < sn.R; i2++) {
    var ff = 0, used = 0, consts = [];
    for (var j2 = 0; j2 < sn.C; j2++) {
      var has = sn.f[i2][j2] !== '' || sn.v[i2][j2] !== '';
      if (!has) continue;
      used++;
      if (sn.f[i2][j2]) ff++;
      else if (typeof sn.v[i2][j2] === 'number') consts.push(j2);
    }
    if (ff >= 3 && ff / used >= 0.6)
      for (var k = 0; k < consts.length; k++) add(i2, consts[k]);
  }
  if (!hits.length) return [];
  return ['  constants in formula regions: ' + hits.slice(0, 8).join(', ') + (hits.length > 8 ? ' +' + (hits.length - 8) + ' more' : '')];
}
function groupSourceSuffix_(rc, sheetName) {
  // dominant far/cross-sheet source bbox for a formula rect-group
  var re = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?(?<![A-Za-z0-9_.$])R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?(?![A-Za-z0-9_.([])/g;
  var body = String(rc.rf).replace(/"(?:[^"]|"")*"/g, ''), m, best = null;
  while ((m = re.exec(body))) {
    var sh = m[1] ? m[1].replace(/^'|'?!$/g, '') : sheetName;
    var rr = m[2] || '[0]', cc = m[3] || '[0]';
    var absR = rr.charAt(0) !== '[', absC = cc.charAt(0) !== '[';
    var r1 = absR ? +rr : rc.i1 + (+rr.slice(1, -1));
    var r2 = absR ? +rr : rc.i2 + (+rr.slice(1, -1));
    var c1 = absC ? +cc : rc.c1 + (+cc.slice(1, -1));
    var c2 = absC ? +cc : rc.c2 + (+cc.slice(1, -1));
    if (r1 < 1 || c1 < 1) continue;
    var far = sh !== sheetName || Math.abs(r1 - rc.i1) > 20 || Math.abs(c1 - rc.c1) > 20 || (absR && absC);
    if (!far) continue;
    var area = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (!best || area > best.area)
      best = { area: area, txt: (sh !== sheetName ? "'" + sh + "'!" : '') + colStr_(c1) + r1 + (r2 > r1 || c2 > c1 ? ':' + colStr_(c2) + r2 : '') };
  }
  return best ? '  ← ' + best.txt : '';
}
function describe_() {
  var L = [];
  var iter = G.ss.isIterativeCalculationEnabled();
  var named = [];
  var nrs = G.ss.getNamedRanges();
    for (var n = 0; n < Math.min(nrs.length, 8); n++)
      named.push(
        nrs[n].getName() +
          '=' +
          nrs[n].getRange().getSheet().getName() +
          '!' +
          nrs[n].getRange().getA1Notation(),
      );
  if (nrs.length > 8) named.push('+' + (nrs.length - 8) + ' more');
  L.push(
    'WORKBOOK ' +
      G.ss.getSheets().length +
      ' sheets · iterative_calc=' +
      (iter ? 'ON' : 'off') +
      (named.length ? ' · named: ' + named.join(', ') : ''),
  );
  var hotRefs = {};
  var sheets = G.ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s],
      name = sh.getName(),
      sn = G.snap[name];
    var R = sn.R,
      C = sn.C,
      cells = R * C;
    var Ls = [
      '',
      '=== ' +
        name +
        '  A1:' +
        colStr_(Math.max(C, 1)) +
        Math.max(R, 1) +
        (sh.getFrozenRows() || sh.getFrozenColumns()
          ? '  frozen=r' + sh.getFrozenRows() + 'c' + sh.getFrozenColumns()
          : ''),
    ];
    if (R === 0) {
      L = L.concat(Ls);
      continue;
    }
    var nform = 0;
    for (var i = 0; i < R; i++)
      for (var j = 0; j < C; j++) if (sn.f[i][j]) nform++;
    if (R > 5000 && nform === 0) {
      var hdr = null;
      for (var i2 = 0; i2 < Math.min(R, 20) && !hdr; i2++) {
        var cnt = 0;
        for (var j2 = 0; j2 < C; j2++) if (sn.v[i2][j2] !== '') cnt++;
        if (cnt >= 3) hdr = sn.v[i2];
      }
      Ls.push(
        '  DATA SHEET (' +
          R +
          ' rows). header: ' +
          (hdr || [])
            .slice(0, 20)
            .map(function (x) {
              return short_(x, 16);
            })
            .join(' | '),
      );
      L = L.concat(Ls);
      continue;
    }
    if (G.baseErr[name].length)
      Ls.push(
        '  errors (' +
          G.baseErr[name].length +
          '): ' +
          G.baseErr[name].slice(0, 6).join(', ') +
          (G.baseErr[name].length > 6 ? '…' : ''),
      );
    // column composition
    var hdrRow0 = -1;
    for (var ih = 0; ih < Math.min(10, R); ih++) {
      var nh = 0;
      for (var jh = 0; jh < Math.min(C, 60); jh++) if (sn.v[ih][jh] !== '') nh++;
      if (nh >= 3) { hdrRow0 = ih; break; }
    }
    var comp = [];
    for (var j3 = 0; j3 < C; j3++) {
      var ne = 0,
        ff = 0;
      for (var i3 = 0; i3 < R; i3++) {
        if (i3 === hdrRow0) continue;
        var has = sn.f[i3][j3] !== '' || sn.v[i3][j3] !== '';
        if (has) {
          ne++;
          if (sn.f[i3][j3]) ff++;
        }
      }
      comp.push(
        ne === 0
          ? 'blank'
          : ff / ne > 0.6
            ? 'formula'
            : ff / ne < 0.4
              ? 'value'
              : 'mixed',
      );
    }
    var lastUsed = 0;
    for (var j4 = 0; j4 < C; j4++) if (comp[j4] !== 'blank') lastUsed = j4;
    // formula groups
    var rects = rectGroups_(sn.r, R, C);
    // merge groups with identical formula+columns split only by blank rows
    var byKey = {}, merged = [];
    rects.forEach(function (rc) {
      var key = rc.rf + '|' + rc.c1 + '|' + rc.c2;
      if (byKey[key]) {
        byKey[key].i2 = Math.max(byKey[key].i2, rc.i2);
        byKey[key].segs++;
        byKey[key].n += (rc.c2 - rc.c1 + 1) * (rc.i2 - rc.i1 + 1);
      } else {
        byKey[key] = { rf: rc.rf, c1: rc.c1, c2: rc.c2, i1: rc.i1, i2: rc.i2, segs: 1, n: (rc.c2 - rc.c1 + 1) * (rc.i2 - rc.i1 + 1) };
        merged.push(byKey[key]);
      }
    });
    var ones = 0;
    merged = merged.filter(function (rc) {
      if (rc.n === 1 && typeof (sn.v[rc.i1 - 1] || [])[rc.c1 - 1] === 'string') { ones++; return false; }
      return true;
    });
    if (merged.length) {
      Ls.push('  formula groups:');
      for (var g = 0; g < Math.min(merged.length, 14); g++) {
        var rc = merged[g];
        Ls.push(
          '    ' + colStr_(rc.c1) + rc.i1 + ':' + colStr_(rc.c2) + rc.i2 +
            ' ×' + rc.n + (rc.segs > 1 ? ' (' + rc.segs + ' segs)' : '') +
            '  ' + rc.rf.slice(0, 105) + groupSourceSuffix_(rc, name),
        );
      }
      if (merged.length > 14)
        Ls.push('    [omitted: ' + (merged.length - 14) + ' more groups]');
      if (ones) Ls.push('    [+' + ones + ' single text-formula cells omitted]');
    }
    // row structure (holes + hardcodes), gated
    if (cells <= BIG_SHEET_CELLS * 6) {
      var sigs = [];
      for (var i5 = 0; i5 < R; i5++) {
        var kinds = '',
          any = false,
          hole = false,
          hard = false,
          dom = '';
        for (var j5 = 0; j5 <= lastUsed; j5++) {
          var f5 = sn.f[i5][j5],
            v5 = sn.v[i5][j5];
          var k = f5 ? 'F' : v5 === '' ? '.' : 'V';
          kinds += k;
          if (k !== '.') any = true;
          if (k === '.' && comp[j5] !== 'blank') hole = true;
          if (k === 'V' && comp[j5] === 'formula' && typeof v5 === 'number')
            hard = true;
          if (k === 'F' && !dom) dom = sn.r[i5][j5];
        }
        if (!any || (kinds.indexOf('F') < 0 && !hard) || (!hole && !hard)) {
          sigs.push(null);
          continue;
        }
        var compSig = kinds
          .replace(/(.)\1*/g, function (m0, ch) {
            return ch + m0.length + ' ';
          })
          .trim();
        sigs.push(compSig + '|' + dom.slice(0, 55) + '|' + (hard ? 1 : 0));
      }
      var mixed = [];
      var i6 = 0;
      while (i6 < sigs.length) {
        if (!sigs[i6]) {
          i6++;
          continue;
        }
        var j6 = i6;
        while (j6 + 1 < sigs.length && sigs[j6 + 1] === sigs[i6]) j6++;
        var pp = sigs[i6].split('|');
        var cnt6 = j6 - i6 + 1;
        mixed.push({
          hard: pp[2] === '1' ? 1 : 0,
          blanks: (pp[0].match(/\.(\d+)/g) || []).reduce(function (a, m2) {
            return a + +m2.slice(1);
          }, 0),
          line:
            '    r' +
            (i6 + 1) +
            (cnt6 > 1 ? '-r' + (j6 + 1) + ' ×' + cnt6 : '') +
            '  ' +
            pp[0] +
            (pp[1] ? '  [' + pp[1] + ']' : '') +
            (pp[2] === '1' ? '  HARDCODE-IN-FORMULA-COLS' : ''),
        });
        i6 = j6 + 1;
      }
      if (mixed.length) {
        mixed.sort(function (a, b) {
          return b.hard - a.hard || b.blanks - a.blanks;
        });
        Ls.push(
          '  row structure (F=formula V=value .=blank, width ' +
            colStr_(lastUsed + 1) +
            '; hardcodes first):',
        );
        for (var m6 = 0; m6 < Math.min(mixed.length, 8); m6++)
          Ls.push(mixed[m6].line);
        if (mixed.length > 8)
          Ls.push('    [omitted: ' + (mixed.length - 8) + ' more row groups]');
      }
    }
    var segs = [],
      s0 = 0;
    for (var j7 = 1; j7 <= C; j7++)
      if (j7 === C || comp[j7] !== comp[s0]) {
        if (comp[s0] !== 'blank')
          segs.push(colStr_(s0 + 1) + ':' + colStr_(j7) + ' ' + comp[s0]);
        s0 = j7;
      }
    if (segs.length)
      Ls.push('  column composition: ' + segs.slice(0, 12).join(' · '));
    if (cells <= BIG_SHEET_CELLS * 6) {
      Ls = Ls.concat(headerLines_(sn));
      Ls = Ls.concat(blankBlockLines_(sn, comp, lastUsed, name));
      Ls = Ls.concat(hardcodeCellLines_(sn, comp));
      Ls = Ls.concat(labelIndexLines_(sn, lastUsed, refSets_(), name));
    } else {
      Ls = Ls.concat(headerLines_(sn));
    }
    // colors/DV gated
    if (cells > BIG_SHEET_CELLS)
      Ls.push('  [font colors & data-validation not scanned: sheet >' + BIG_SHEET_CELLS + ' cells — use peek modes]');
    if (cells <= BIG_SHEET_CELLS) {
      try {
        var fc = sh.getRange(1, 1, R, C).getFontColors();
        var hist = {};
        for (var i7 = 0; i7 < R; i7++)
          for (var j8 = 0; j8 < C; j8++)
            if (sn.f[i7][j8] !== '' || sn.v[i7][j8] !== '') {
              var col = fc[i7][j8];
              if (col === '#000000') col = 'default';
              hist[col] = (hist[col] || 0) + 1;
            }
        var hk = Object.keys(hist);
        if (hk.length === 1) Ls.push('  font colors: uniform (' + hk[0] + ')');
        if (hk.length > 1) {
          hk.sort(function (a, b) {
            return hist[b] - hist[a];
          });
          Ls.push(
            '  font colors: ' +
              hk
                .slice(0, 5)
                .map(function (k2) {
                  return k2 + '×' + hist[k2];
                })
                .join(', '),
          );
        }
      } catch (e) {
        Ls.push('  font colors: UNAVAILABLE (' + e + ')');
      }
      try {
        var dvs = sh.getRange(1, 1, R, C).getDataValidations();
        var dvn = 0,
          dvex = '';
        for (var i8 = 0; i8 < R; i8++)
          for (var j9 = 0; j9 < C; j9++)
            if (dvs[i8][j9]) {
              dvn++;
              if (!dvex) {
                var crit = dvs[i8][j9].getCriteriaType();
                var args = dvs[i8][j9].getCriteriaValues();
                dvex =
                  colStr_(j9 + 1) +
                  (i8 + 1) +
                  ' type=' +
                  crit +
                  (args && args[0] && args[0].getA1Notation
                    ? ' source=' +
                      args[0].getSheet().getName() +
                      '!' +
                      args[0].getA1Notation()
                    : '');
              }
            }
        if (dvn) Ls.push('  data-validation ×' + dvn + ': ' + dvex);
      } catch (eDV) {
        Ls.push('  data-validation: UNAVAILABLE (' + eDV + ')');
      }
    }
    try {
      var cfr = sh.getConditionalFormatRules();
      if (cfr.length) {
        var cfl = [];
        for (var cf = 0; cf < Math.min(cfr.length, 4); cf++) {
          var rule = cfr[cf];
          var bc = rule.getBooleanCondition();
          var desc = bc
            ? bc.getCriteriaType() +
              ' ' +
              JSON.stringify(bc.getCriteriaValues()).slice(0, 40)
            : 'gradient';
          cfl.push(
            rule
              .getRanges()
              .map(function (r9) {
                return r9.getA1Notation();
              })
              .join(',') +
              ' ' +
              desc,
          );
        }
        Ls.push('  conditional-format ×' + cfr.length + ': ' + cfl.join(' | '));
      }
    } catch (eCF) {
      Ls.push('  conditional-format: UNAVAILABLE (' + eCF + ')');
    }
    // hot absolute refs (workbook-level tally, emitted after the sheet loop)
    for (var i9 = 0; i9 < R; i9++)
      for (var j10 = 0; j10 < C; j10++) {
        var f9 = sn.f[i9][j10];
        if (!f9) continue;
        var mm = f9.replace(/"(?:[^"]|"")*"/g, '').match(/((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?\$([A-Z]{1,3})\$([0-9]+)(?![A-Za-z0-9_(:])/g);
        if (mm)
          for (var q = 0; q < mm.length; q++) {
            var mq = mm[q].match(/((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?\$([A-Z]{1,3})\$([0-9]+)/);
            var tsh = mq[1] ? mq[1].replace(/^'|'?!$/g, '') : name;
            if (!G.snap[tsh]) continue;
            var hkey = tsh + '!' + mq[2] + mq[3];
            hotRefs[hkey] = (hotRefs[hkey] || 0) + 1;
          }
      }
    // budget
    // trim priority: row-structure detail first, then formula groups, then label runs.
    // Never trim: errors, blank blocks, hardcodes, duplicate labels, sections, hdr,
    // font/DV/CF lines, distinct-count.
    function trimClass_(ln) {
      if (/^    r\d/.test(ln)) return 0;
      if (/^    [A-Z]/.test(ln) || /^    \[/.test(ln)) return 1;
      if (/^  · /.test(ln)) return 2;
      return 9;
    }
    var bytes = Ls.join('\n').length;
    var pass = 0;
    while (bytes > 1800 && pass < 3) {
      var worst = -1, wl = 0;
      for (var z = 2; z < Ls.length; z++)
        if (trimClass_(Ls[z]) === pass && Ls[z].length > wl) {
          wl = Ls[z].length;
          worst = z;
        }
      if (worst < 0) { pass++; continue; }
      Ls.splice(worst, 1);
      if (Ls.indexOf('  [trimmed to budget]') < 0)
        Ls.push('  [trimmed to budget]');
      bytes = Ls.join('\n').length;
    }
    L = L.concat(Ls);
  }
  var hotK = Object.keys(hotRefs).filter(function (k) { return hotRefs[k] > 50; });
  if (hotK.length) {
    hotK.sort(function (a, b) { return hotRefs[b] - hotRefs[a]; });
    L.push('');
    hotK.slice(0, 4).forEach(function (k) {
      var mh = k.match(/^(.*)!([A-Z]+)([0-9]+)$/);
      var cch = cellNow_(mh[1], +mh[3], colNum_(mh[2]));
      var lbl = labelOf_(mh[1], +mh[3], colNum_(mh[2]));
      L.push('HOT REF ' + k + ' = ' + full_(cch.v) + (lbl ? ' ("' + lbl + '")' : '') + ': referenced by ' + hotRefs[k] + ' formulas');
    });
  }
  return L.join('\n');
}

// ---------- read tools (snapshot + overlay; never touch SpreadsheetApp) ----------
function refreshWrittenValues_(sheet, b) {
  var w = G.writes[sheet];
  if (!w) return;
  var need = [];
  for (var a1 in w)
    if (w[a1].v === null) {
      var wb = parseA1_(a1);
      if (wb.r1 >= b.r1 && wb.r1 <= b.r2 && wb.c1 >= b.c1 && wb.c1 <= b.c2) need.push(wb);
    }
  if (!need.length) return;
  var r1 = 1e9, r2 = 0, c1 = 1e9, c2 = 0;
  need.forEach(function (x) { r1 = Math.min(r1, x.r1); r2 = Math.max(r2, x.r1); c1 = Math.min(c1, x.c1); c2 = Math.max(c2, x.c1); });
  var vs = G.ss.getSheetByName(sheet).getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1).getValues();
  for (var a2 in w)
    if (w[a2].v === null) {
      var wb2 = parseA1_(a2);
      if (wb2.r1 >= r1 && wb2.r1 <= r2 && wb2.c1 >= c1 && wb2.c1 <= c2) w[a2].v = vs[wb2.r1 - r1][wb2.c1 - c1];
    }
}
function tPeek_(a) {
  var sn = G.snap[a.sheet];
  if (!sn) return 'ERROR: unknown sheet ' + a.sheet;
  var b = parseA1_(a.range);
  if (b.r2 > sn.R) b.r2 = Math.max(sn.R, b.r1);
  if (b.c2 > sn.C) b.c2 = Math.max(sn.C, b.c1);
  var note = '';
  if (b.c2 - b.c1 + 1 > 40) {
    note +=
      '  [truncated cols: showing ' +
      colStr_(b.c1) +
      '-' +
      colStr_(b.c1 + 39) +
      ' of ' +
      colStr_(b.c2) +
      ']';
    b.c2 = b.c1 + 39;
  }
  if ((b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1) > 400) {
    var mr = Math.max(1, Math.floor(400 / (b.c2 - b.c1 + 1)));
    note +=
      '  [truncated rows: showing ' +
      b.r1 +
      '-' +
      (b.r1 + mr - 1) +
      ' of ' +
      b.r2 +
      ']';
    b.r2 = b.r1 + mr - 1;
  }
  refreshWrittenValues_(a.sheet, b);
  var labCols = [],
    hdrRows = [];
  for (var c = Math.max(1, b.c1 - 3); c < b.c1; c++) {
    var has = false;
    for (var r = b.r1; r <= b.r2; r++) {
      var cc = cellNow_(a.sheet, r, c);
      if (typeof cc.v === 'string' && cc.v !== '' && !cc.f) {
        has = true;
        break;
      }
    }
    if (has) labCols.push(c);
  }
  labCols = labCols.slice(-2);
  for (var r2 = Math.max(1, b.r1 - 4); r2 < b.r1; r2++) {
    var has2 = false;
    for (var c2 = b.c1; c2 <= b.c2; c2++) {
      if (cellNow_(a.sheet, r2, c2).v !== '' || cellNow_(a.sheet, r2, c2).f) {
        has2 = true;
        break;
      }
    }
    if (has2) hdrRows.push(r2);
  }
  hdrRows = hdrRows.slice(-3);
  var blank = 0,
    tot = 0;
  for (var r3 = b.r1; r3 <= b.r2; r3++)
    for (var c3 = b.c1; c3 <= b.c2; c3++) {
      tot++;
      var cc3 = cellNow_(a.sheet, r3, c3);
      if (cc3.v === '' && !cc3.f) blank++;
    }
  var histCols = [];
  if (tot && blank / tot > 0.7) {
    var c4 = b.c1 - 1;
    while (c4 > 0 && histCols.length < 3) {
      if (labCols.indexOf(c4) < 0) {
        var filled = false;
        for (var r4 = b.r1; r4 <= b.r2; r4++) {
          var cc4 = cellNow_(a.sheet, r4, c4);
          if (cc4.v !== '' || cc4.f) {
            filled = true;
            break;
          }
        }
        if (filled) histCols.push(c4);
      }
      c4--;
    }
    histCols.sort(function (x, y) {
      return x - y;
    });
  }
  var showCols = labCols.concat(histCols);
  for (var c5 = b.c1; c5 <= b.c2; c5++) showCols.push(c5);
  showCols = showCols
    .filter(function (v, i, arr) {
      return arr.indexOf(v) === i;
    })
    .sort(function (x, y) {
      return x - y;
    });
  var legend = {},
    nId = 0,
    colorKey = {},
    fmtKey = {},
    lines = [];
  lines.push('PEEK ' + a.sheet + '!' + a.range + ' mode=' + a.mode + note);
  lines.push(
    '     ' +
      showCols
        .map(function (c6) {
          return (
            (labCols.indexOf(c6) >= 0 || histCols.indexOf(c6) >= 0 ? '*' : '') +
            colStr_(c6)
          );
        })
        .join('\t') +
      '   (*=context)',
  );
  var fcGrid = null;
  if (a.mode === 'fontColor') {
    try {
      fcGrid = G.ss
        .getSheetByName(a.sheet)
        .getRange(
          b.r1,
          showCols[0],
          b.r2 - b.r1 + 1,
          showCols[showCols.length - 1] - showCols[0] + 1,
        )
        .getFontColors();
    } catch (e) {
      return 'ERROR: ' + e;
    }
  }
  var nfGrid = null;
  if (a.mode === 'numberFormat') {
    try {
      nfGrid = G.ss
        .getSheetByName(a.sheet)
        .getRange(
          b.r1,
          showCols[0],
          b.r2 - b.r1 + 1,
          showCols[showCols.length - 1] - showCols[0] + 1,
        )
        .getNumberFormats();
    } catch (e) {
      return 'ERROR: ' + e;
    }
  }
  var allRows = hdrRows.concat([]);
  for (var r5 = b.r1; r5 <= b.r2; r5++) allRows.push(r5);
  for (var ri = 0; ri < allRows.length; ri++) {
    var r6 = allRows[ri];
    var isCtx = hdrRows.indexOf(r6) >= 0;
    var row = [];
    for (var ci = 0; ci < showCols.length; ci++) {
      var c7 = showCols[ci];
      var cc7 = cellNow_(a.sheet, r6, c7);
      if (a.mode === 'fontColor') {
        if (cc7.v === '' && !cc7.f) {
          row.push('.');
          continue;
        }
        var col7 =
          fcGrid && fcGrid[r6 - b.r1]
            ? fcGrid[r6 - b.r1][c7 - showCols[0]]
            : '#000000';
        if (!col7 || col7 === '#000000') {
          row.push('k');
          continue;
        }
        if (!colorKey[col7])
          colorKey[col7] = String.fromCharCode(
            97 + Object.keys(colorKey).length,
          );
        row.push(colorKey[col7]);
        continue;
      }
      if (a.mode === 'numberFormat') {
        var fmt7 = nfGrid && nfGrid[r6 - b.r1] ? String(nfGrid[r6 - b.r1][c7 - showCols[0]]) : '';
        if (!fmt7 || fmt7 === 'General') { row.push('.'); continue; }
        if (!fmtKey[fmt7]) fmtKey[fmt7] = String.fromCharCode(97 + Object.keys(fmtKey).length);
        row.push(fmtKey[fmt7]);
        continue;
      }
      if (a.mode === 'r1c1' && cc7.rf) {
        row.push(short_(cc7.rf, 28));
        continue;
      }
      if (cc7.rf) {
        if (!legend[cc7.rf]) legend[cc7.rf] = ++nId;
        row.push('[' + legend[cc7.rf] + ']' + short_(cc7.v, 12));
      } else row.push(short_(cc7.v, 28));
    }
    lines.push((isCtx ? '*' : ' ') + r6 + '\t' + row.join('\t'));
  }
  var lk = Object.keys(colorKey);
  if (lk.length)
    lines.push(
      '  colors: k=default ' +
        lk
          .map(function (k) {
            return colorKey[k] + '=' + k;
          })
          .join(' '),
    );
  var fmk = Object.keys(fmtKey);
  if (fmk.length)
    lines.push(
      '  formats: .=General ' +
        fmk.map(function (k) { return fmtKey[k] + '=' + k; }).join(' '),
    );
  var fk = Object.keys(legend);
  if (fk.length && a.mode === 'default') {
    lines.push('  formulas:');
    fk.sort(function (x, y) {
      return legend[x] - legend[y];
    });
    for (var fi = 0; fi < fk.length; fi++)
      lines.push('   [' + legend[fk[fi]] + '] ' + fk[fi].slice(0, 115));
  }
  return lines.join('\n');
}
function tFind_(a) {
  var q = String(a.text).toLowerCase();
  var hits = [];
  for (var ws in G.writes)
    for (var wa in G.writes[ws]) {
      var wv = G.writes[ws][wa];
      var wstr = wv.f && wv.f !== '(fill)' ? wv.f : wv.rf || (wv.v === null ? '' : String(wv.v));
      if (wstr && wstr.toLowerCase().indexOf(q) >= 0)
        hits.push(ws + '!' + wa + '  ' + short_(wstr, 80) + '  |written this attempt');
    }
  var names = Object.keys(G.snap);
  for (var s = 0; s < names.length; s++) {
    var name = names[s],
      sn = G.snap[name];
    for (var i = 0; i < sn.R; i++)
      for (var j = 0; j < sn.C; j++) {
        var f = sn.f[i][j],
          v = sn.v[i][j];
        var str = f !== '' ? f : v === '' ? '' : String(v);
        if (str && str.toLowerCase().indexOf(q) >= 0) {
          hits.push(
            name +
              '!' +
              colStr_(j + 1) +
              (i + 1) +
              '  ' +
              short_(str, 80) +
              '  |label: ' +
              labelOf_(name, i + 1, j + 1) +
              ' |hdr: ' +
              headerOf_(name, j + 1, i + 1),
          );
          if (hits.length >= 40) return hits.join('\n') + '\n[capped]';
        }
      }
  }
  return hits.length ? hits.join('\n') : 'no match';
}
function tTrace_(a) {
  var sn = G.snap[a.sheet];
  var tb = parseA1_(a.cell);
  refreshWrittenValues_(a.sheet, tb);
  if (!sn) return 'ERROR: unknown sheet ' + a.sheet;
  var b = parseA1_(a.cell);
  var cc = cellNow_(a.sheet, b.r1, b.c1);
  var out = [
    'TRACE ' +
      a.sheet +
      '!' +
      a.cell +
      ' = ' +
      ((cc.f === '(fill)' ? cc.rf : cc.f) || full_(cc.v)) +
      '  → ' +
      full_(cc.v),
  ];
  var cf9 = cc.f === '(fill)' ? cc.rf : cc.f;
  if (!cf9) return out[0];
  var body = cf9.replace(/"(?:[^"]|"")*"/g, '');
  var prec = [], m;
  if (cc.f === '(fill)') {
    // pattern-filled cell: the stored formula is R1C1 — resolve refs numerically
    var reR = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?(?<![A-Za-z0-9_.$])R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?(?![A-Za-z0-9_.([])/g;
    while ((m = reR.exec(body))) {
      var rrp = m[2] || '[0]', ccp = m[3] || '[0]';
      var rowP = rrp.charAt(0) === '[' ? b.r1 + Number(rrp.slice(1, -1)) : Number(rrp);
      var colP = ccp.charAt(0) === '[' ? b.c1 + Number(ccp.slice(1, -1)) : Number(ccp);
      prec.push({ sh: m[1] ? m[1].replace(/^'|'?!$/g, '') : a.sheet, row: rowP, col: colP });
    }
  } else {
    var reA = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?(\$?)([A-Z]{1,3})(\$?)([0-9]+)/g;
    while ((m = reA.exec(body)))
      prec.push({ sh: m[1] ? m[1].replace(/^'|'?!$/g, '') : a.sheet, row: +m[5], col: colNum_(m[3]) });
  }
  var seen = {}, shown = 0;
  for (var pi = 0; pi < prec.length; pi++) {
    var p9 = prec[pi];
    var key = p9.sh + '!' + p9.col + ':' + p9.row;
    if (seen[key] || !G.snap[p9.sh] || p9.row < 1 || p9.col < 1) continue;
    seen[key] = 1;
    if (shown >= 13) { out.push('  +' + (Object.keys(seen).length - shown) + ' more precedents (capped)'); break; }
    shown++;
    var pc = cellNow_(p9.sh, p9.row, p9.col);
    out.push(
      '  ← ' + p9.sh + '!' + colStr_(p9.col) + p9.row + ' = ' + full_(pc.v) +
        '  ' + (pc.f ? '[' + short_(pc.f, 40) + ']' : '(input)') +
        '  |' + labelOf_(p9.sh, p9.row, p9.col),
    );
  }
  if (body.indexOf(':') >= 0) out.push('  (range refs shown as endpoints)');
  return out.join('\n');
}
function diffEntries_() {
  // [{sheet,a1,oldf,oldv,newf,newv}]
  var out = [];
  for (var sheet in G.writes) {
    for (var a1 in G.writes[sheet]) {
      var w = G.writes[sheet][a1],
        o = G.oldmap[sheet][a1];
      if (
        (o.f || '') !== (w.f || '') ||
        (o.f === '' && w.f === '' && String(o.v) !== String(w.v))
      )
        out.push({ sheet: sheet, a1: a1, o: o, w: w });
    }
  }
  return out;
}
function tDiff_() {
  var es = diffEntries_();
  if (!es.length) return 'DIFF: no changes since run start.';
  var by = {};
  es.forEach(function (e) {
    var key =
      e.sheet +
      '|' +
      (e.w.rf || short_(e.w.v, 20)) +
      '|' +
      (e.o.f || short_(e.o.v, 12));
    (by[key] = by[key] || []).push(e);
  });
  var lines = ['DIFF vs original (' + es.length + ' cells):'];
  Object.keys(by)
    .slice(0, 25)
    .forEach(function (k) {
      var g = by[k];
      var e0 = g[0];
      var pos =
        g.length > 3
          ? g[0].sheet +
            '!' +
            g[0].a1 +
            '…' +
            g[g.length - 1].a1 +
            ' ×' +
            g.length
          : g
              .map(function (e) {
                return e.sheet + '!' + e.a1;
              })
              .join(', ');
      lines.push(
        '  ' +
          pos +
          '  ' +
          (e0.o.f || short_(e0.o.v, 14) || 'blank') +
          ' → ' +
          (e0.w.rf || e0.w.f || short_(e0.w.v, 18)) +
          '  |' +
          labelOf_(e0.sheet, parseA1_(e0.a1).r1, parseA1_(e0.a1).c1),
      );
    });
  var moreG = Object.keys(by).length - 25;
  if (moreG > 0) lines.push('  +' + moreG + ' more groups');
  for (var fw = 0; fw < G.fmtWrites.length; fw++)
    lines.push('  [format] ' + G.fmtWrites[fw].sheet + '!' + G.fmtWrites[fw].range + ' → ' + G.fmtWrites[fw].format);
  for (var dw = 0; dw < G.dvWrites.length; dw++)
    lines.push('  [data-validation] ' + G.dvWrites[dw].sheet + '!' + G.dvWrites[dw].a1);
  for (var cw in G.cfBase) lines.push('  [conditional-format] rules changed on ' + cw);
  return lines.join('\n');
}

// ---------- plan ----------
function inTargets_(sheet, b, wantKinds) {
  if (!G.plan) return false;
  var ts = [], first = null, containers = [];
  for (var i = 0; i < G.plan.targets.length; i++) {
    var t = G.plan.targets[i];
    if (t.sheetName !== sheet) continue;
    var tb = t.bounds;
    if (b.r1 >= tb.r1 && b.r2 <= tb.r2 && b.c1 >= tb.c1 && b.c2 <= tb.c2) {
      if (!wantKinds || wantKinds.indexOf(t.kind) >= 0) return t;
      containers.push(t);
      continue;
    }
    ts.push(t);
    if (!first && !(tb.r2 < b.r1 || tb.r1 > b.r2 || tb.c2 < b.c1 || tb.c1 > b.c2)) first = t;
  }
  if (containers.length) return containers[0]; // contained but kind-mismatched: caller explains
  // no single container: accept if the union of same-sheet targets covers every cell
  if (!first) return false;
  for (var r = b.r1; r <= b.r2; r++)
    for (var cc = b.c1; cc <= b.c2; cc++) {
      var ok = false;
      for (var k = 0; k < ts.length; k++) {
        var ub = ts[k].bounds;
        if (r >= ub.r1 && r <= ub.r2 && cc >= ub.c1 && cc <= ub.c2) { ok = true; break; }
      }
      if (!ok) return false;
    }
  return first;
}
// ---------- reference graph + plan-review helpers ----------
function refSets_() {
  if (G.refSets) return G.refSets;
  var direct = {}, ranges = [];
  var rangeRe = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?\$?[A-Z]{1,3}\$?[0-9]*:\$?[A-Z]{1,3}\$?[0-9]*/g;
  var cellRe = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?\$?([A-Z]{1,3})\$?([0-9]+)/g;
  for (var sheet in G.snap) {
    var sn = G.snap[sheet];
    for (var i = 0; i < sn.R; i++)
      for (var j = 0; j < sn.C; j++) {
        var f = sn.f[i][j];
        if (!f || f.charAt(0) !== '=') continue;
        var body = f.replace(/"(?:[^"]|"")*"/g, '');
        var masked = body.replace(rangeRe, function (full, sh) {
          var tgt = sh ? sh.replace(/^'|'?!$/g, '') : sheet;
          var rest = full.replace(/^(?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!/, '');
          var ep = rest.split(':');
          function pc(x) { var g = x.match(/([A-Z]{1,3})?([0-9]+)?/); return { c: g[1] ? colNum_(g[1]) : null, r: g[2] ? +g[2] : null }; }
          var a = pc(ep[0]), b = pc(ep[1] || '');
          if (ranges.length < 5000)
            ranges.push({ sheet: tgt, c1: a.c || 1, c2: b.c || a.c || 16384, r1: a.r || 1, r2: b.r || a.r || 1048576 });
          return full.replace(/./g, ' ');
        });
        var m;
        cellRe.lastIndex = 0;
        while ((m = cellRe.exec(masked))) {
          var tgt2 = m[1] ? m[1].replace(/^'|'?!$/g, '') : sheet;
          direct[tgt2 + '!' + colNum_(m[2]) + ':' + +m[3]] = 1;
        }
      }
  }
  G.refSets = { direct: direct, ranges: ranges };
  return G.refSets;
}
function cellRefStatus_(rs, sheet, row, c1, c2) {
  for (var c = c1; c <= c2; c++)
    if (rs.direct[sheet + '!' + c + ':' + row]) return 'live';
  for (var k = 0; k < rs.ranges.length; k++) {
    var rg = rs.ranges[k];
    if (rg.sheet === sheet && row >= rg.r1 && row <= rg.r2 && !(c2 < rg.c1 || c1 > rg.c2)) return 'ambiguous';
  }
  return 'stale';
}
function coverageFrac_(targets, asserts) {
  function area(b) { return (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1); }
  var tot = 0;
  targets.forEach(function (t) { if (t.kind === 'formula' || t.kind === 'value') tot += area(t.bounds); });
  if (!tot) return 1;
  var covered = 0;
  targets.forEach(function (t) {
    if (t.kind !== 'formula' && t.kind !== 'value') return;
    asserts.forEach(function (as) {
      if ((as.check !== 'equals' && as.check !== 'equals_old') || as.sheetName !== t.sheetName) return;
      var r1 = Math.max(t.bounds.r1, as.bounds.r1), r2 = Math.min(t.bounds.r2, as.bounds.r2);
      var c1 = Math.max(t.bounds.c1, as.bounds.c1), c2 = Math.min(t.bounds.c2, as.bounds.c2);
      if (r1 <= r2 && c1 <= c2) covered += (r2 - r1 + 1) * (c2 - c1 + 1);
    });
  });
  return Math.min(1, covered / tot);
}
function adversaryReview_(clean, asserts, coverage) {
  // Full union of the model's exploration READ calls (describe = G.map; peek/find/trace/diff),
  // compiled from the trace where each call's result was saved at call time. No caps.
  var reads = [];
  for (var i = 0; i < G.trace.length; i++) {
    var e = G.trace[i];
    if (e.t === 'call' && ['peek', 'find', 'trace', 'diff'].indexOf(e.tool) >= 0)
      reads.push(e.tool + '(' + (e.args || '') + ') \u2192\n' + String(e.out || ''));
  }
  var planStr = clean.map(function (t) { return t.range + ' [' + t.kind + '] ' + (t.intent || '') + (t.prompt_quote ? '  quote:"' + t.prompt_quote + '"' : ''); }).join('\n');
  var assertStr = asserts.map(function (a) { return a.check + ' ' + a.range + (a.value !== undefined ? ' == ' + a.value : '') + (a.reason ? '  (' + a.reason + ')' : ''); }).join('\n') || '(none)';
  var sys = 'You are an adversarial plan reviewer for a spreadsheet agent. You receive the TASK, the WORKBOOK MAP (describe), the FULL set of exploration read-calls and their results, and the PLAN (targets + assertions) BEFORE any cells are written. Be terse and concrete. Check, in priority order: '
    + '1) IMPLICIT ASSUMPTIONS / INSUFFICIENT EXPLORATION: does the plan assume a source cell, a column meaning, a sign, a unit, a period-1 column, or a duplicate-label choice that was never verified by a peek or trace? Name each unverified assumption and what to check. '
    + '2) CLAUSE COVERAGE: is every instruction and constraint in the task addressed by a target or intent? Name any missed clause. '
    + '3) CIRCULAR OR SELF-SERVING CHECKS: are the assertions independent, or do they merely restate the intended output? Assertion coverage is ' + Math.round(coverage * 100) + ' percent of output cells; if low, most of the output is unverified — say so. '
    + '4) SIGN / UNIT / CONVENTION: will the planned outputs match the sign and unit conventions of parallel existing cells and the task wording? '
    + '5) PLAN COMPLETENESS: do the targets cover the whole required output region with no gaps? '
    + 'Return concerns as a short bullet list (each: the problem + the specific check to run), or exactly NO CONCERNS if the plan is sound. Do not restate the plan.';
  var user = '=== TASK ===\n' + (G.prompt || '')
    + '\n\n=== WORKBOOK MAP (describe) ===\n' + (G.map || '')
    + '\n\n=== EXPLORATION (every read call and its result) ===\n' + (reads.length ? reads.join('\n\n') : '(no exploration done)')
    + '\n\n=== PLAN TARGETS ===\n' + planStr
    + '\n\n=== PLAN ASSERTIONS ===\n' + assertStr
    + '\n\nReview the plan against the checklist and list concerns, or reply NO CONCERNS.';
  var res = openai_({ model: MODEL, reasoning: { effort: EFFORT }, instructions: sys, input: [{ role: 'user', content: user }], store: false });
  var out = '';
  (res.output || []).forEach(function (o) { (o.content || []).forEach(function (cc) { if (cc.text) out += cc.text; }); });
  return out.trim();
}
function tPlan_(a) {
  var targets, asserts;
  try {
    targets = JSON.parse(a.targets_json);
    asserts = JSON.parse(a.assertions_json || '[]');
  } catch (e) {
    return (
      'REFUSED: plan JSON unparseable (' +
      e +
      '). targets_json must be an array of {range,kind,intent}.'
    );
  }
  if (!targets || !targets.length)
    return 'REFUSED: at least one target required.';
  var clean = [],
    warn = [];
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var kinds = ['formula', 'value', 'clear', 'format'];
    if (kinds.indexOf(t.kind) < 0)
      return (
        'REFUSED: target ' +
        (t.range || '?') +
        ' has kind "' +
        t.kind +
        '"; must be one of ' +
        kinds.join('/')
      );
    var sr;
    try {
      sr = splitRef_(t.range);
    } catch (e2) {
      return 'REFUSED: ' + e2.message;
    }
    if (!G.snap[sr.sheet])
      return 'REFUSED: unknown sheet in target: ' + t.range;
    var quote = ((t.intent || '') + ' ' + (t.prompt_quote || '')).toLowerCase();
    if (t.kind === 'formula' && /hardcode|hard-code/.test(quote))
      return (
        'REFUSED: target ' +
        t.range +
        ' intent mentions hardcoding but kind=formula. Use kind=value for literals.'
      );
    if (t.kind === 'formula' && /\btype\b|\bstore\b|\benter\b|\bpaste\b/.test(quote))
      warn.push(
        'WARN: target ' + t.range +
        ' intent mentions typing/storing but kind=formula — if the task wants a literal, use kind=value.',
      );
    t.sheetName = sr.sheet;
    t.bounds = parseA1_(sr.a1);
    clean.push(t);
  }
  var hasEq = false;
  for (var j = 0; j < asserts.length; j++) {
    var as = asserts[j];
    if (
      ['equals', 'equals_old', 'nonblank', 'blank', 'no_error', 'format', 'waive'].indexOf(
        as.check,
      ) < 0
    )
      return 'REFUSED: assertion check "' + as.check + '" unknown.';
    if (as.check === 'waive' && !(as.reason && String(as.reason).trim()))
      return (
        'REFUSED: waive assertion on ' +
        (as.range || '?') +
        ' needs a non-empty reason.'
      );
    try {
      var sr2 = splitRef_(as.range);
      as.sheetName = sr2.sheet;
      as.bounds = parseA1_(sr2.a1);
    } catch (e3) {
      return 'REFUSED: assertion ' + (as.range || '?') + ': ' + e3.message;
    }
    if (as.check === 'equals' || as.check === 'equals_old') hasEq = true;
  }
  // Sticky failed assertions: a new plan overlapping a previously-failed
  // assertion's range must revise (equals/blank) or explicitly waive it.
  for (var fa = 0; fa < (G.failedAsserts || []).length; fa++) {
    var old = G.failedAsserts[fa];
    var overlaps = false;
    for (var ti = 0; ti < clean.length; ti++) {
      var cb = clean[ti].bounds;
      if (
        clean[ti].sheetName === old.sheetName &&
        !(cb.r2 < old.bounds.r1 || cb.r1 > old.bounds.r2 || cb.c2 < old.bounds.c1 || cb.c1 > old.bounds.c2)
      ) { overlaps = true; break; }
    }
    if (!overlaps) continue;
    var carried = false;
    for (var ai = 0; ai < asserts.length; ai++) {
      var na = asserts[ai];
      if (
        na.sheetName === old.sheetName &&
        ['equals', 'equals_old', 'blank', 'waive'].indexOf(na.check) >= 0 &&
        !(na.bounds.r2 < old.bounds.r1 || na.bounds.r1 > old.bounds.r2 || na.bounds.c2 < old.bounds.c1 || na.bounds.c1 > old.bounds.c2)
      ) { carried = true; break; }
    }
    if (!carried)
      return (
        'REFUSED: assertion ' + old.check + ' ' + old.range +
        ' FAILED last verify and your new targets overlap it. Carry a revised equals/blank assertion there, or waive it explicitly ({check:"waive",range:"' +
        old.range + '",reason:"…"}). Silent deletion is not allowed.'
      );
  }
  var reverted = '';
  if (G.plan && (G.failedOpen || Object.keys(G.writes).length)) {
    revertAll_();
    reverted = ' Previous attempt reverted; workbook is pristine.';
    G.failedOpen = false;
  }
  G.plan = {
    targets: clean,
    asserts: asserts,
    weak: !hasEq,
    rationale: a.rationale,
  };
  (G.planHistory = G.planHistory || []).push(
    clean.map(function (t9) { return { sheetName: t9.sheetName, bounds: t9.bounds, range: t9.range }; }),
  );
  G.attempt++;
  ev_('plan', {
    attempt: G.attempt,
    targets: clean.map(function (t2) {
      return t2.range + ' (' + t2.kind + ')';
    }),
    asserts: asserts.length,
    weak: !hasEq,
  });
  // H4 independent-anchor WARN: is any assertion independent of the writes?
  var hasIndep = false;
  for (var ia = 0; ia < asserts.length; ia++) {
    var aa = asserts[ia];
    if (aa.check === 'equals_old') { hasIndep = true; break; } // vs run-start value = independent
    if (aa.check === 'equals' || aa.check === 'nonblank' || aa.check === 'no_error') {
      var outside = true;
      for (var ib = 0; ib < clean.length; ib++) {
        var tb2 = clean[ib].bounds;
        if (clean[ib].sheetName === aa.sheetName &&
            !(aa.bounds.r2 < tb2.r1 || aa.bounds.r1 > tb2.r2 || aa.bounds.c2 < tb2.c1 || aa.bounds.c1 > tb2.c2)) { outside = false; break; }
      }
      if (outside) { hasIndep = true; break; }
    }
  }
  var anchorWarn = (!hasIndep && clean.length)
    ? '\nWARN: no assertion is independent of your writes (all checks sit on cells you will write). Add an equals_old, or an equals/nonblank on a cell you are NOT writing, so a check can actually catch a wrong value.'
    : '';
  // H9 coverage + H6 adversary review — once, at the first plan, before writes
  var advNote = '';
  if (G.attempt === 1) {
    var cov = coverageFrac_(clean, asserts);
    ev_('coverage', { frac: cov });
    try {
      var concerns = adversaryReview_(clean, asserts, cov);
      ev_('adversary', { concerns: concerns });
      if (concerns && !/^NO CONCERNS/i.test(concerns))
        advNote = '\n\nPLAN REVIEW (independent reviewer; address before writing):\n' + concerns;
    } catch (e) {
      ev_('adversary_error', { err: String(e).slice(0, 200) });
    }
  }
  return (
    'PLAN ACCEPTED (attempt ' +
    G.attempt +
    '): ' +
    clean.length +
    ' targets, ' +
    asserts.length +
    ' assertions.' +
    (hasEq ? '' : ' WEAK — no equals-assertion: values will be unverified.') +
    reverted +
    (warn.length ? '\n' + warn.join('\n') : '') +
    anchorWarn +
    advNote
  );
}

// ---------- write path ----------
function recordCell_(sheet, r, c, newF, newRf, newV) {
  var a1 = colStr_(c) + r;
  G.oldmap[sheet] = G.oldmap[sheet] || {};
  if (!(a1 in G.oldmap[sheet])) {
    var sn = G.snap[sheet];
    G.oldmap[sheet][a1] =
      r <= sn.R && c <= sn.C
        ? { f: sn.f[r - 1][c - 1], v: sn.v[r - 1][c - 1] }
        : { f: '', v: '' };
  }
  G.writes[sheet] = G.writes[sheet] || {};
  G.writes[sheet][a1] = { f: newF, rf: newRf, v: newV };
}
function writtenKofN_() {
  if (!G.plan) return '';
  var full = 0, cellsDone = 0, cellsTotal = 0;
  for (var i = 0; i < G.plan.targets.length; i++) {
    var t = G.plan.targets[i];
    var tb = t.bounds;
    var total = (tb.r2 - tb.r1 + 1) * (tb.c2 - tb.c1 + 1);
    var done = 0;
    var w = G.writes[t.sheetName] || {};
    for (var a1 in w) {
      var b = parseA1_(a1);
      if (b.r1 >= tb.r1 && b.r1 <= tb.r2 && b.c1 >= tb.c1 && b.c1 <= tb.c2) done++;
    }
    cellsTotal += total; cellsDone += Math.min(done, total);
    if (done >= total) full++;
  }
  return 'targets fully written ' + full + '/' + G.plan.targets.length + ' (cells ' + cellsDone + '/' + cellsTotal + ')';
}
function deltaRead_(sheet, b) {
  var sampled = false;
  // sampled values readback + errors, updates overlay v
  var sh = G.ss.getSheetByName(sheet);
  var rows = b.r2 - b.r1 + 1,
    cols = b.c2 - b.c1 + 1,
    out = [],
    errs = [];
  function readRow(r) {
    var vs = sh.getRange(r, b.c1, 1, cols).getValues()[0];
    for (var c = 0; c < cols; c++) {
      var a1 = colStr_(b.c1 + c) + r;
      var v = vs[c];
      if (G.writes[sheet] && G.writes[sheet][a1]) G.writes[sheet][a1].v = v;
      if (isErr_(v)) errs.push(a1 + '=' + v);
    }
    return vs;
  }
  if (rows * cols <= 60) {
    for (var r = b.r1; r <= b.r2; r++) {
      var vs = readRow(r);
      out.push(
        vs
          .map(function (v, c) {
            return colStr_(b.c1 + c) + r + ': ' + full_(v);
          })
          .join('  ') +
          '  |' +
          labelOf_(sheet, r, b.c1),
      );
    }
  } else {
    var first = readRow(b.r1),
      last = readRow(b.r2);
    out.push(
      'r' +
        b.r1 +
        ': ' +
        first
          .slice(0, 12)
          .map(function (v) {
            return short_(v, 10);
          })
          .join(' | ') +
        (cols > 12 ? ' …' : '') +
        '  |' +
        labelOf_(sheet, b.r1, b.c1),
    );
    out.push(
      'r' +
        b.r2 +
        ': ' +
        last
          .slice(0, 12)
          .map(function (v) {
            return short_(v, 10);
          })
          .join(' | ') +
        (cols > 12 ? ' …' : '') +
        '  |' +
        labelOf_(sheet, b.r2, b.c1),
    );
    out.push('(' + rows + '×' + cols + ' cells; first+last rows sampled)');
    sampled = true;
  }
  return { lines: out, errs: errs, sampled: sampled };
}
function guardWrite_(sheet, a1, wantKinds) {
  if (!G.plan)
    return 'REFUSED: no plan on file. Call set_new_plan first — writes are checked against your declared targets.';
  var b = parseA1_(a1);
  var t = inTargets_(sheet, b, wantKinds);
  if (!t)
    return (
      'REFUSED: ' +
      sheet +
      '!' +
      a1 +
      ' is not inside your declared targets (' +
      G.plan.targets
        .map(function (x) {
          return x.range;
        })
        .join(', ') +
      '). Correct the range or amend the plan with set_new_plan.'
    );
  return t;
}
function tFill_(a) {
  var t = guardWrite_(a.sheet, a.range, ['formula']);
  if (typeof t === 'string') return t;
  if (t.kind !== 'formula')
    return (
      'REFUSED (kind mismatch): covering target is kind=' + t.kind +
      '. fill writes formulas — declare a kind=formula target for this range; a format target only licenses set_number_format. Target: ' +
      t.range +
      ' is kind=' +
      t.kind +
      '; fill writes formulas.'
    );
  var b = parseA1_(a.range);
  if (!a.force)
    for (var rr0 = b.r1; rr0 <= b.r2; rr0++)
      for (var cc0 = b.c1; cc0 <= b.c2; cc0++)
        if (!snapBlank_(a.sheet, rr0, cc0))
          return (
            'REFUSED: ' + a.sheet + '!' + colStr_(cc0) + rr0 +
            ' had content at run-start; this fill would overwrite it. Pass force:true to replace ' +
            '(e.g. hardcode→formula), or narrow the range to blank output cells only.'
          );
  var sh = G.ss.getSheetByName(a.sheet);
  sh.getRange(a.range).setFormulaR1C1(a.formula_r1c1);
  var fA1 = sh.getRange(b.r1, b.c1).getFormula();
  for (var r = b.r1; r <= b.r2; r++)
    for (var c = b.c1; c <= b.c2; c++)
      recordCell_(
        a.sheet,
        r,
        c,
        r === b.r1 && c === b.c1 ? fA1 : '(fill)',
        a.formula_r1c1,
        null,
      );
  var d = deltaRead_(a.sheet, b);
  ev_('write', {
    tool: 'fill',
    range: a.sheet + '!' + a.range,
    rf: a.formula_r1c1,
    errs: d.errs.length,
  });
  return (
    'FILLED ' +
    a.sheet +
    '!' +
    a.range +
    ' with ' +
    a.formula_r1c1 +
    '\n' +
    d.lines.join('\n') +
    (d.errs.length
      ? '\nERRORS in written range: ' + d.errs.slice(0, 8).join(', ') + (d.errs.length > 8 ? ' +' + (d.errs.length - 8) + ' more' : '')
      : d.sampled
        ? '\nno errors in sampled first+last rows (middle rows unscanned; verify checks the full range)'
        : '\nno errors in written range') +
    '\n' +
    writtenKofN_()
  );
}
function tWriteCells_(a) {
  var cells;
  try {
    cells = JSON.parse(a.cells_json);
  } catch (e) {
    return 'REFUSED: cells_json unparseable: ' + e;
  }
  if (!cells.length) return 'REFUSED: empty cells list.';
  if (cells.length > 200) return 'REFUSED: >200 cells; use fill for blocks.';
  for (var i = 0; i < cells.length; i++) {
    var g = guardWrite_(a.sheet, cells[i].a1, ['formula', 'value', 'clear']);
    if (typeof g === 'string') return g + ' (cell ' + cells[i].a1 + ')';
  }
  if (!a.force)
    for (var pj = 0; pj < cells.length; pj++) {
      var pc = cells[pj].content;
      if (pc === '' || pc === null) continue; // clears are fine
      var pb = parseA1_(cells[pj].a1);
      if (!snapBlank_(a.sheet, pb.r1, pb.c1))
        return (
          'REFUSED: ' + a.sheet + '!' + cells[pj].a1 +
          ' had content at run-start; writing would overwrite it. Pass force:true to replace, ' +
          'or clear it via a clear-kind target.'
        );
    }
  var sh = G.ss.getSheetByName(a.sheet);
  var minR = 1e9,
    maxR = 0,
    minC = 1e9,
    maxC = 0;
  for (var j = 0; j < cells.length; j++) {
    var cell = cells[j];
    var b = parseA1_(cell.a1);
    var content = cell.content;
    var rng = sh.getRange(cell.a1);
    if (content === '' || content === null) {
      rng.clearContent();
      recordCell_(a.sheet, b.r1, b.c1, '', '', '');
    } else if (typeof content === 'string' && content.charAt(0) === '=') {
      rng.setFormula(content);
      recordCell_(a.sheet, b.r1, b.c1, content, rng.getFormulaR1C1(), null);
    } else {
      var num = typeof content === 'string' && String(Number(content)) === content ? Number(content) : content;
      rng.setValue(num);
      recordCell_(a.sheet, b.r1, b.c1, '', '', num);
    }
    minR = Math.min(minR, b.r1);
    maxR = Math.max(maxR, b.r1);
    minC = Math.min(minC, b.c1);
    maxC = Math.max(maxC, b.c1);
  }
  var d = deltaRead_(a.sheet, {
    r1: minR,
    r2: Math.min(maxR, minR + 20),
    c1: minC,
    c2: Math.min(maxC, minC + 15),
  });
  ev_('write', {
    tool: 'write_cells',
    n: cells.length,
    sheet: a.sheet,
    errs: d.errs.length,
  });
  return (
    'WROTE ' +
    cells.length +
    ' cells on ' +
    a.sheet +
    '\n' +
    d.lines.slice(0, 22).join('\n') +
    (d.errs.length
      ? '\nERRORS: ' + d.errs.slice(0, 8).join(', ') + (d.errs.length > 8 ? ' +' + (d.errs.length - 8) + ' more' : '')
      : '\nno errors in checked cells (echo box only; verify checks all writes)') +
    '\n' +
    writtenKofN_()
  );
}
function tClear_(a) {
  var ranges;
  try {
    ranges = JSON.parse(a.ranges_json);
  } catch (e) {
    return 'REFUSED: ranges_json unparseable: ' + e;
  }
  var sh = G.ss.getSheetByName(a.sheet);
  if (!sh) return 'ERROR: unknown sheet';
  var cleared = 0;
  for (var i = 0; i < ranges.length; i++) {
    var t = guardWrite_(a.sheet, ranges[i]);
    if (typeof t === 'string') return t;
    if (t.kind !== 'clear' && t.kind !== 'value')
      return (
        'REFUSED: target ' +
        t.range +
        ' is kind=' +
        t.kind +
        '; declare a clear-kind target.'
      );
    var b = parseA1_(ranges[i]);
    sh.getRange(ranges[i]).clearContent();
    for (var r = b.r1; r <= b.r2; r++)
      for (var c = b.c1; c <= b.c2; c++) {
        var old = cellNow_(a.sheet, r, c);
        if (old.f || old.v !== '') cleared++;
        recordCell_(a.sheet, r, c, '', '', '');
      }
  }
  var census = '';
  try {
    var shC = G.ss.getSheetByName(a.sheet);
    if (shC.getLastRow() * shC.getLastColumn() <= 20000 && shC.getLastRow() > 0) {
      var vC = shC.getDataRange().getValues();
      var cC = shC.getDataRange().getFontColors();
      var histC = {};
      for (var iC = 0; iC < vC.length; iC++)
        for (var jC = 0; jC < vC[iC].length; jC++)
          if (vC[iC][jC] !== '') {
            var kC = cC[iC][jC] === '#000000' ? 'default' : cC[iC][jC];
            histC[kC] = (histC[kC] || 0) + 1;
          }
      census = ' Survivors on sheet by font color: ' + Object.keys(histC).map(function (k) { return k + '\u00d7' + histC[k]; }).join(', ') + '.';
    }
  } catch (eC) { census = ' Font-color census UNAVAILABLE (' + eC + ').'; }
  ev_('write', { tool: 'clear_contents', sheet: a.sheet, ranges: ranges.join(','), cleared: cleared, census: census });
  return 'CLEARED ' + cleared + ' non-empty cells in ' + ranges.join(', ') + '.' + census + ' ' + writtenKofN_();
}
function tNumFmt_(a) {
  // wantKinds matters: without it inTargets_ returns the first CONTAINING target of any
  // kind, so an overlapping formula target shadowed every format target and this tool
  // refused unconditionally. That is why the model learned to go around it via the hatch.
  var t = guardWrite_(a.sheet, a.range, ['format']);
  if (typeof t === 'string') return t;
  if (t.kind !== 'format')
    return (
      'REFUSED: number-format changes need a format-kind target (' +
      t.range +
      ' is ' +
      t.kind +
      '). Add a format target covering ' +
      a.sheet + '!' + a.range +
      ' with set_new_plan; it may overlap your formula targets.'
    );
  var sh = G.ss.getSheetByName(a.sheet);
  if (!G.fmtBase[a.sheet + '!' + a.range])
    G.fmtBase[a.sheet + '!' + a.range] = sh
      .getRange(a.range)
      .getNumberFormats();
  sh.getRange(a.range).setNumberFormat(a.format);
  G.fmtWrites.push({ sheet: a.sheet, range: a.range, format: a.format });
  ev_('write', {
    tool: 'set_number_format',
    range: a.sheet + '!' + a.range,
    format: a.format,
  });
  return 'FORMAT SET ' + a.sheet + '!' + a.range + ' → ' + a.format;
}
function tDV_(a) {
  var t = guardWrite_(a.sheet, a.a1);
  if (typeof t === 'string') return t;
  if (t.kind !== 'format')
    return 'REFUSED: data-validation needs a format-kind target.';
  var sh = G.ss.getSheetByName(a.sheet);
  var src = splitRef_(
    a.source_range.indexOf('!') >= 0
      ? a.source_range
      : a.sheet + '!' + a.source_range,
  );
  var prev = sh.getRange(a.a1).getDataValidation();
  G.dvWrites.push({ sheet: a.sheet, a1: a.a1, prev: prev });
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(G.ss.getSheetByName(src.sheet).getRange(src.a1), true)
    .build();
  sh.getRange(a.a1).setDataValidation(rule);
  ev_('write', {
    tool: 'set_data_validation',
    a1: a.sheet + '!' + a.a1,
    src: a.source_range,
  });
  return (
    'DATA-VALIDATION SET on ' +
    a.sheet +
    '!' +
    a.a1 +
    ' source=' +
    a.source_range
  );
}
function tCF_(a) {
  var t = guardWrite_(a.sheet, a.range);
  if (typeof t === 'string') return t;
  if (t.kind !== 'format')
    return 'REFUSED: conditional formats need a format-kind target.';
  var sh = G.ss.getSheetByName(a.sheet);
  if (G.cfBase[a.sheet] === undefined)
    G.cfBase[a.sheet] = sh.getConditionalFormatRules();
  var rules = sh.getConditionalFormatRules();
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(a.custom_formula)
      .setFontColor(a.font_color)
      .setRanges([sh.getRange(a.range)])
      .build(),
  );
  sh.setConditionalFormatRules(rules);
  ev_('write', {
    tool: 'set_conditional_format',
    range: a.sheet + '!' + a.range,
    formula: a.custom_formula,
  });
  var echo = sh.getConditionalFormatRules().map(function (r2) {
    var bc = r2.getBooleanCondition();
    return (
      r2
        .getRanges()
        .map(function (x) {
          return x.getA1Notation();
        })
        .join(',') +
      ' ' +
      (bc
        ? bc.getCriteriaType() +
          ' ' +
          JSON.stringify(bc.getCriteriaValues()).slice(0, 40)
        : 'gradient')
    );
  });
  return 'CF RULE ADDED. Sheet rules now: ' + echo.join(' | ');
}
var HATCH_BAN =
  /(insertRow|insertColumn|deleteRow|deleteColumn|deleteSheet|insertSheet|setName|moveTo|\.sort\(|\.clear\(|clearFormat|autoFill|setBackground|setFont|setNumberFormat|setBorder|setHorizontalAlignment|setVerticalAlignment|setWrap|setTextRotation)/;
function tHatch_(a) {
  if (!G.plan) return 'REFUSED: no plan on file. Call set_new_plan first.';
  var touches;
  try {
    touches = JSON.parse(a.touches_json);
  } catch (e) {
    return 'REFUSED: touches_json unparseable: ' + e;
  }
  for (var i = 0; i < touches.length; i++) {
    var sr = splitRef_(touches[i]);
    var g = guardWrite_(sr.sheet, sr.a1);
    if (typeof g === 'string') return g;
  }
  if (!touches.length && /\.(set[A-Z]|clear[A-Z])/.test(a.code)) return 'REFUSED: script appears to mutate but touches_json is empty. Declare the ranges you modify.';
  if (/DataValidation/.test(a.code) && !G.plan.targets.some(function (t9) { return t9.kind === 'format'; })) return 'REFUSED: data-validation changes need a format-kind target.';
  var banned = a.code.match(HATCH_BAN);
  if (banned)
    return (
      'REFUSED: script uses banned API "' +
      banned[1] +
      '". Use the typed tools, or declare a format target for style ops.'
    );
  if (a.code.indexOf('copyTo') >= 0 && a.code.indexOf('contentsOnly') < 0)
    return 'REFUSED: copyTo without contentsOnly:true damages formats.';
  var result;
  try {
    result = new Function('ss', a.code)(G.ss);
  } catch (e2) {
    ev_('hatch_error', { err: String(e2) });
    return 'SCRIPT ERROR: ' + (e2.stack || e2);
  }
  SpreadsheetApp.flush();
  // reconcile: re-read touched ranges into overlay
  for (var k = 0; k < touches.length; k++) {
    var sr2 = splitRef_(touches[k]);
    var b = parseA1_(sr2.a1);
    var sh = G.ss.getSheetByName(sr2.sheet);
    var fs = sh
      .getRange(b.r1, b.c1, b.r2 - b.r1 + 1, b.c2 - b.c1 + 1)
      .getFormulas();
    var rf = sh
      .getRange(b.r1, b.c1, b.r2 - b.r1 + 1, b.c2 - b.c1 + 1)
      .getFormulasR1C1();
    var vs = sh
      .getRange(b.r1, b.c1, b.r2 - b.r1 + 1, b.c2 - b.c1 + 1)
      .getValues();
    for (var r = b.r1; r <= b.r2; r++)
      for (var c = b.c1; c <= b.c2; c++)
        recordCell_(
          sr2.sheet,
          r,
          c,
          fs[r - b.r1][c - b.c1],
          rf[r - b.r1][c - b.c1],
          vs[r - b.r1][c - b.c1],
        );
  }
  ev_('write', {
    tool: 'run_apps_script',
    touches: touches.join(','),
    result: short_(JSON.stringify(result), 80),
  });
  return (
    'SCRIPT OK. returned: ' +
    short_(JSON.stringify(result), 200) +
    '\n(touched ranges re-read into state) ' +
    writtenKofN_()
  );
}
function revertAll_() {
  for (var sheet in G.oldmap) {
    var sh = G.ss.getSheetByName(sheet);
    for (var a1 in G.oldmap[sheet]) {
      var o = G.oldmap[sheet][a1];
      if (o.f) sh.getRange(a1).setFormula(o.f);
      else if (o.v === '' || o.v === null) sh.getRange(a1).clearContent();
      else sh.getRange(a1).setValue(o.v);
    }
  }
  for (var key in G.fmtBase) {
    var sr = splitRef_(key);
    G.ss
      .getSheetByName(sr.sheet)
      .getRange(sr.a1)
      .setNumberFormats(G.fmtBase[key]);
  }
  for (var d = 0; d < G.dvWrites.length; d++) {
    var dv = G.dvWrites[d];
    G.ss.getSheetByName(dv.sheet).getRange(dv.a1).setDataValidation(dv.prev);
  }
  for (var cs in G.cfBase)
    G.ss.getSheetByName(cs).setConditionalFormatRules(G.cfBase[cs]);
  G.writes = {};
  G.oldmap = {};
  G.fmtBase = {};
  G.fmtWrites = [];
  G.dvWrites = [];
  G.cfBase = {};
  ev_('revert', {});
}
function tRevert_() {
  if (!Object.keys(G.oldmap).length && !G.fmtWrites.length)
    return 'Nothing to revert.';
  revertAll_();
  G.failedOpen = false;
  G.planHistory = []; // explicit revert: prior footprints are deliberately abandoned
  return 'REVERTED: workbook restored to run-start state. Set a new plan to begin the next attempt.';
}

// ---------- verifier ----------
function fmtMatches_(fmt, decimals, percent) {
  var s = fmt.replace(/"[^"]*"|\\.|_.|\*./g, '');
  var sec = s.split(';')[0];
  var m = sec.match(/\.([0#?]+)/);
  var d = m ? m[1].length : 0;
  var pct = sec.indexOf('%') >= 0;
  return d === (decimals || 0) && pct === !!percent;
}
function verify_() {
  var rep = [],
    fails = 0;
  hb_('verify');
  SpreadsheetApp.flush();
  // V1 footprint + V5 errors + V6 structure: live read all sheets
  var fmtOff = [], fmtUnread = [];
  var offenders = [],
    newErrs = [],
    refTexts = [];
  var sheets = G.ss.getSheets();
  var liveNames = sheets.map(function (s) {
    return s.getName();
  });
  var snapNames = Object.keys(G.snap);
  if (
    liveNames.length !== snapNames.length ||
    snapNames.some(function (n) {
      return liveNames.indexOf(n) < 0;
    })
  ) {
    rep.push('V6 STRUCTURE FAIL: sheets changed (' + liveNames.join(',') + ')');
    fails++;
  }
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s],
      name = sh.getName(),
      sn = G.snap[name];
    if (!sn) continue;
    var R = Math.max(sn.R, sh.getLastRow()),
      C = Math.max(sn.C, sh.getLastColumn());
    if (R === 0) continue;
    if (sh.getLastRow() > sn.R + 0 || sh.getLastColumn() > sn.C) {
      rep.push(
        'V6 STRUCTURE WARN: ' +
          name +
          ' used range grew (' +
          sn.R +
          'x' +
          sn.C +
          ' → ' +
          sh.getLastRow() +
          'x' +
          sh.getLastColumn() +
          ')',
      );
    }
    hb_('verify:' + name);
    var rng = sh.getRange(1, 1, R, C);
    var lf = rng.getFormulas(),
      lv = rng.getValues();
    var lnf = null;
    if (sn.nf) { try { lnf = rng.getNumberFormats(); } catch (e) { fmtUnread.push(name + ' (' + String(e).slice(0, 40) + ')'); } }
    else fmtUnread.push(name + (sn.nfErr ? ' (' + sn.nfErr + ')' : ' (no baseline)'));
    var base = {};
    (G.baseErr[name] || []).forEach(function (a) {
      base[a] = 1;
    });
    for (var i = 0; i < R; i++)
      for (var j = 0; j < C; j++) {
        var of_ = i < sn.R && j < sn.C ? sn.f[i][j] : '',
          ov = i < sn.R && j < sn.C ? sn.v[i][j] : '';
        var nf = lf[i][j],
          nv = lv[i][j];
        var a1 = colStr_(j + 1) + (i + 1);
        var changed =
          of_ !== nf || (of_ === '' && nf === '' && String(ov) !== String(nv));
        if (changed && !inTargets_(name, parseA1_(a1)))
          offenders.push(
            name +
              '!' +
              a1 +
              ' (' +
              (of_ || short_(ov, 10) || 'blank') +
              ' → ' +
              (nf || short_(nv, 10) || 'blank') +
              ')',
          );
        if (isErr_(nv) && !base[a1])
          newErrs.push(name + '!' + a1 + '=' + short_(nv, 10));
        if (
          nf &&
          nf.replace(/"(?:[^"]|"")*"/g, '').indexOf('#REF!') >= 0 &&
          (!of_ || of_.replace(/"(?:[^"]|"")*"/g, '').indexOf('#REF!') < 0)
        )
          refTexts.push(name + '!' + a1);
        // V3: number-format preservation. A format change outside a format-kind target
        // is a preservation violation the grader will score, so fail it here.
        if (lnf && i < sn.R && j < sn.C && lnf[i][j] !== sn.nf[i][j] &&
            !inTargets_(name, parseA1_(a1), ['format']))
          fmtOff.push(name + '!' + a1 + ' (' + (sn.nf[i][j] || 'General') + ' \u2192 ' + (lnf[i][j] || 'General') + ')');
      }
  }
  if (offenders.length) {
    rep.push(
      'V1 FOOTPRINT FAIL: ' +
        offenders.length +
        ' cells changed outside targets: ' +
        offenders.slice(0, 10).join('; '),
    );
    fails++;
  } else rep.push('V1 footprint ok');
  // V3 number-format preservation
  if (fmtOff.length) {
    rep.push(
      'V3 FORMAT FAIL: ' + fmtOff.length +
        ' cells reformatted outside format targets (preservation is strict; revert them or declare a format target only if the task asked for formatting): ' +
        fmtOff.slice(0, 10).join('; ') + (fmtOff.length > 10 ? ' +' + (fmtOff.length - 10) + ' more' : ''),
    );
    fails++;
  } else rep.push('V3 number formats ok' + (fmtUnread.length ? ' (unread: ' + fmtUnread.slice(0, 3).join(', ') + ')' : ''));
  // V2 kinds
  var kindFails = [];
  for (var t = 0; t < G.plan.targets.length; t++) {
    var tg = G.plan.targets[t];
    var w = G.writes[tg.sheetName] || {};
    for (var a1k in w) {
      var bk = parseA1_(a1k);
      if (
        bk.r1 < tg.bounds.r1 ||
        bk.r1 > tg.bounds.r2 ||
        bk.c1 < tg.bounds.c1 ||
        bk.c1 > tg.bounds.c2
      )
        continue;
      var wk = w[a1k];
      if (tg.kind === 'formula' && !wk.f && wk.v !== '' && wk.v !== null)
        kindFails.push(tg.sheetName + '!' + a1k + ' literal in formula target');
      if (tg.kind === 'value' && wk.f)
        kindFails.push(tg.sheetName + '!' + a1k + ' formula in value target');
      if (tg.kind === 'clear' && (wk.f || (wk.v !== '' && wk.v !== null)))
        kindFails.push(tg.sheetName + '!' + a1k + ' content in clear target');
    }
  }
  if (kindFails.length) {
    rep.push('V2 KIND FAIL: ' + kindFails.slice(0, 8).join('; ') + (kindFails.length > 8 ? ' +' + (kindFails.length - 8) + ' more' : ''));
    fails++;
  } else rep.push('V2 kinds ok');
  // V2b completeness: a declared formula/value target must not contain blank holes
  // unless a blank assertion covers them.
  function blankAsserted_(sheet, r, cc) {
    for (var z = 0; z < G.plan.asserts.length; z++) {
      var az = G.plan.asserts[z];
      if (az.check !== 'blank' || az.sheetName !== sheet) continue;
      if (r >= az.bounds.r1 && r <= az.bounds.r2 && cc >= az.bounds.c1 && cc <= az.bounds.c2) return true;
    }
    return false;
  }
  var holes = [];
  for (var th = 0; th < G.plan.targets.length; th++) {
    var tgh = G.plan.targets[th];
    if (tgh.kind !== 'formula' && tgh.kind !== 'value') continue;
    for (var rh = tgh.bounds.r1; rh <= tgh.bounds.r2 && holes.length <= 12; rh++)
      for (var ch = tgh.bounds.c1; ch <= tgh.bounds.c2 && holes.length <= 12; ch++) {
        var cn = cellNow_(tgh.sheetName, rh, ch);
        var blank = !cn.f && (cn.v === '' || cn.v === null);
        if (blank && !blankAsserted_(tgh.sheetName, rh, ch))
          holes.push(tgh.sheetName + '!' + colStr_(ch) + rh);
      }
  }
  if (holes.length) {
    rep.push('V2b HOLE FAIL: declared target cells left blank (assert blank to license): ' +
      holes.slice(0, 12).join(', ') + (holes.length > 12 ? ' +more' : ''));
    fails++;
  } else rep.push('V2b no holes');
  if (newErrs.length) {
    rep.push('V5 NEW-ERROR FAIL: ' + newErrs.slice(0, 10).join('; ') + (newErrs.length > 10 ? ' +' + (newErrs.length - 10) + ' more' : ''));
    fails++;
  } else rep.push('V5 no new errors');
  if (refTexts.length) {
    rep.push('V5b #REF-IN-FORMULA FAIL: ' + refTexts.slice(0, 8).join('; ') + (refTexts.length > 8 ? ' +' + (refTexts.length - 8) + ' more' : ''));
    fails++;
  }
  // V7 assertions + V8 auto
  for (var a = 0; a < G.plan.asserts.length; a++) {
    var as = G.plan.asserts[a];
    if (as.check === 'waive') {
      rep.push('V7 waived: ' + as.range + ' — ' + as.reason);
      continue;
    }
    var sh2 = G.ss.getSheetByName(as.sheetName);
    var b2 = as.bounds;
    var vs2 = sh2
      .getRange(b2.r1, b2.c1, b2.r2 - b2.r1 + 1, b2.c2 - b2.c1 + 1)
      .getValues();
    var bad = [];
    for (var i2 = 0; i2 < vs2.length; i2++)
      for (var j2 = 0; j2 < vs2[i2].length; j2++) {
        var v2 = vs2[i2][j2];
        var a12 = colStr_(b2.c1 + j2) + (b2.r1 + i2);
        if (as.check === 'equals' && typeof as.value === 'string') {
          if (String(v2) !== as.value) bad.push(a12 + '=' + short_(v2, 12));
        } else if (as.check === 'equals') {
          var tol = as.tol || 1e-6;
          var v2n =
            typeof v2 === 'number'
              ? v2
              : typeof v2 === 'string' && v2 !== '' && isFinite(Number(v2))
                ? Number(v2)
                : null;
          if (
            v2n === null ||
            Math.abs(v2n - as.value) > Math.max(tol, Math.abs(as.value) * 1e-6)
          )
            bad.push(a12 + '=' + short_(v2, 12));
        }
        if (as.check === 'equals_old') {
          var sne = G.snap[as.sheetName];
          var inR = sne && (b2.r1 + i2) <= sne.R && (b2.c1 + j2) <= sne.C;
          if (!inR) {
            bad.push(a12 + ' (no run-start value — cell was blank/outside; equals_old needs a pre-existing value)');
          } else {
            var ov7 = sne.v[b2.r1 + i2 - 1][b2.c1 + j2 - 1];
            var tolo = as.tol || 1e-6;
            var v2o = typeof v2 === 'number' ? v2
              : (typeof v2 === 'string' && v2 !== '' && isFinite(Number(v2)) ? Number(v2) : null);
            var ovo = typeof ov7 === 'number' ? ov7
              : (typeof ov7 === 'string' && ov7 !== '' && isFinite(Number(ov7)) ? Number(ov7) : null);
            if (ovo !== null && v2o !== null) {
              if (Math.abs(v2o - ovo) > Math.max(tolo, Math.abs(ovo) * 1e-6))
                bad.push(a12 + '=' + short_(v2, 12) + ' (old ' + short_(ov7, 12) + ')');
            } else if (String(v2) !== String(ov7)) {
              bad.push(a12 + '=' + short_(v2, 12) + ' (old ' + short_(ov7, 12) + ')');
            }
          }
        }
        if (as.check === 'nonblank' && v2 === '') bad.push(a12);
        if (as.check === 'blank' && v2 !== '') bad.push(a12);
        if (as.check === 'no_error' && isErr_(v2)) bad.push(a12 + '=' + v2);
      }
    if (as.check === 'format') {
      var fmts = sh2
        .getRange(b2.r1, b2.c1, b2.r2 - b2.r1 + 1, b2.c2 - b2.c1 + 1)
        .getNumberFormats();
      for (var i3 = 0; i3 < fmts.length; i3++)
        for (var j3 = 0; j3 < fmts[i3].length; j3++)
          if (!fmtMatches_(fmts[i3][j3], as.decimals, as.percent))
            bad.push(
              colStr_(b2.c1 + j3) + (b2.r1 + i3) + ' fmt=' + fmts[i3][j3],
            );
    }
    if (bad.length) {
      rep.push(
        'V7 ASSERT FAIL ' +
          as.check +
          ' ' +
          as.range +
          ': ' +
          bad.slice(0, 8).join(', ') +
          (bad.length > 8 ? ' +' + (bad.length - 8) + ' more' : ''),
      );
      fails++;
      G.failedAsserts = G.failedAsserts || [];
      var dup = false;
      for (var fx = 0; fx < G.failedAsserts.length; fx++)
        if (G.failedAsserts[fx].range === as.range && G.failedAsserts[fx].check === as.check) dup = true;
      if (!dup) G.failedAsserts.push(as);
    } else rep.push('V7 assert ok: ' + as.check + ' ' + as.range);
  }
  // V8 uniformity per formula target with >1 written formula cell
  for (var t8 = 0; t8 < G.plan.targets.length; t8++) {
    var tg8 = G.plan.targets[t8];
    if (tg8.kind !== 'formula') continue;
    var w8 = G.writes[tg8.sheetName] || {};
    var perRow = {};
    for (var a18 in w8) {
      var b8 = parseA1_(a18);
      if (
        b8.r1 < tg8.bounds.r1 ||
        b8.r1 > tg8.bounds.r2 ||
        b8.c1 < tg8.bounds.c1 ||
        b8.c1 > tg8.bounds.c2
      )
        continue;
      if (!w8[a18].rf) continue;
      (perRow[b8.r1] = perRow[b8.r1] || {})[w8[a18].rf] = 1;
    }
    var rowBad = [];
    for (var rr in perRow)
      if (Object.keys(perRow[rr]).length > 1)
        rowBad.push(
          'r' + rr + ' has ' + Object.keys(perRow[rr]).length + ' patterns',
        );
    if (rowBad.length) {
      rep.push(
        'V8 UNIFORMITY WARN ' +
          tg8.range +
          ': ' +
          rowBad.slice(0, 4).join('; '),
      );
    }
  }
  var verdict = fails === 0 ? 'PASS' : 'FAIL (' + fails + ' axes)';
  if (G.plan.weak)
    rep.push('NOTE: plan is WEAK — no equals-assertion; values unverified.');
  ev_('verdict', { verdict: verdict, fails: fails });
  if (fails > 0) G.failedOpen = true;
  return {
    pass: fails === 0,
    text: 'VERIFIER: ' + verdict + '\n' + rep.join('\n'),
  };
}
function tSubmit_() {
  if (!G.plan) return { pass: false, text: 'REFUSED: no plan on file.' };
  var anyWrite =
    Object.keys(G.writes).length ||
    G.fmtWrites.length ||
    G.dvWrites.length ||
    Object.keys(G.cfBase).length;
  if (!anyWrite)
    return {
      pass: false,
      text: 'REFUSED: nothing written yet. A submit with zero writes cannot pass.',
    };
  // Dropped-target confrontation: targets present in earlier plans but absent now.
  var left9 = DEADLINE_MS - (Date.now() - G.t0);
  if (!G.droppedAck && left9 >= 90000 && (G.planHistory || []).length > 1) {
    var cur = G.planHistory[G.planHistory.length - 1];
    var dropped = [], seenD = {};
    for (var h = 0; h < G.planHistory.length - 1; h++)
      for (var p = 0; p < G.planHistory[h].length; p++) {
        var pt = G.planHistory[h][p];
        var covered = false;
        for (var q9 = 0; q9 < cur.length; q9++) {
          var qb = cur[q9].bounds;
          if (
            cur[q9].sheetName === pt.sheetName &&
            pt.bounds.r1 >= qb.r1 && pt.bounds.r2 <= qb.r2 &&
            pt.bounds.c1 >= qb.c1 && pt.bounds.c2 <= qb.c2
          ) { covered = true; break; }
        }
        if (!covered && !seenD[pt.sheetName + '!' + pt.range]) {
          seenD[pt.sheetName + '!' + pt.range] = 1;
          dropped.push(pt.sheetName + '!' + pt.range);
        }
      }
    if (dropped.length) {
      G.droppedAck = true;
      return {
        pass: false,
        text:
          'DROPPED since earlier attempts: ' + dropped.join(', ') +
          '. Earlier plans targeted these ranges; the current plan does not. If intentional, submit again to proceed; otherwise re-plan to cover them.',
      };
    }
  }
  return verify_();
}

// ---------- OpenAI ----------
function openai_(body) {
  var key = PropertiesService.getScriptProperties().getProperty('OPENAI_KEY');
  if (!key) throw new Error('OPENAI_KEY script property missing');
  var opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  var err;
  for (var attempt = 0; attempt < 5; attempt++) {
    if (attempt) {
      if (Date.now() - G.t0 > DEADLINE_MS - 60000)
        throw new Error('OpenAI: ' + err + ' (deadline too close to retry)');
      var waitMs = Math.pow(2, attempt) * 1000;
      ev_('api_retry', { attempt: attempt, error: err, wait_ms: waitMs });
      Utilities.sleep(waitMs);
    }
    try {
      var res = UrlFetchApp.fetch('https://api.openai.com/v1/responses', opts);
      var code = res.getResponseCode();
      if (code === 200) return JSON.parse(res.getContentText());
      err = 'HTTP ' + code + ': ' + res.getContentText().slice(0, 400);
      if (code !== 429 && code < 500) break;
    } catch (e) {
      err = String(e);
    }
  }
  throw new Error('OpenAI: ' + err);
}
function runTool_(name, args) {
  try {
    if (name === 'peek') return tPeek_(args);
    if (name === 'find') return tFind_(args);
    if (name === 'trace') return tTrace_(args);
    if (name === 'diff') return tDiff_();
    if (name === 'set_new_plan') return tPlan_(args);
    if (name === 'fill') return tFill_(args);
    if (name === 'write_cells') return tWriteCells_(args);
    if (name === 'clear_contents') return tClear_(args);
    if (name === 'set_number_format') return tNumFmt_(args);
    if (name === 'set_data_validation') return tDV_(args);
    if (name === 'set_conditional_format') return tCF_(args);
    if (name === 'run_apps_script') return tHatch_(args);
    if (name === 'revert') return tRevert_();
    return 'ERROR: unknown tool ' + name;
  } catch (e) {
    return 'ERROR: ' + (e.stack || e);
  }
}

// ---------- main ----------
function runAgent(req) {
  var t0 = Date.now();
  try {
    return runAgentInner_(req, t0);
  } catch (e) {
    var tr = G && G.trace ? G.trace : [];
    tr.push({
      t: 'agent_error',
      err: String((e && e.stack) || e),
      at: Date.now() - t0,
    });
    return {
      status: 'agent_error',
      error: String(e),
      trace: tr,
      elapsed_ms: Date.now() - t0,
    };
  }
}
function runAgentInner_(req, t0) {
  var prompt = req.prompt,
    id = req.spreadsheetId;
  if (!String(prompt || '').trim()) throw new Error('prompt required');
  G = {
    ss: SpreadsheetApp.openById(id),
    id: id,
    t0: t0,
    prompt: prompt,
    map: null,
    writes: {},
    oldmap: {},
    fmtBase: {},
    fmtWrites: [],
    dvWrites: [],
    cfBase: {},
    plan: null,
    failedOpen: false,
    failedAsserts: [],
    planHistory: [],
    droppedAck: false,
    attempt: 0,
    trace: [],
    turn: 0,
    prevId: null,
    cost: 0,
    ckptFrom: 0,
  };
  try {
    PropertiesService.getScriptProperties().deleteProperty('hb:' + id);
  } catch (e) {}
  hb_('start');
  snapshotAll_();
  hb_('snapshot_done');
  var map = describe_();
  G.map = map;
  ev_('map', { bytes: map.length, text: map, task: prompt });
  hb_('describe_done');
  ckpt_();
  var input = [
    { role: 'user', content: 'TASK:\n' + prompt + '\n\nWORKBOOK MAP:\n' + map },
  ];
  var stopped = 'turns';
  for (;;) {
    var left = DEADLINE_MS - (Date.now() - t0);
    if (left < HARD_RETURN_LEFT + 15000) {
      stopped = 'deadline';
      break;
    }
    if (left < MODEL_CALL_MIN_LEFT) {
      if (G.finalCalled) { stopped = 'deadline'; break; }
      G.finalCalled = true;
      input.push({ role: 'user', content: 'FINAL TURN: time nearly up. submit now if anything is written; otherwise stop.' });
    }
    G.turn++;
    hb_('model_call_' + G.turn);
    var tCall = Date.now();
    var res = openai_({
      model: MODEL,
      reasoning: { effort: EFFORT, summary: 'auto' },
      instructions: SYSTEM_PROMPT,
      tools: TOOLS,
      input: input,
      previous_response_id: G.prevId,
      max_output_tokens: MAX_OUT,
      store: true,
    });
    G.prevId = res.id;
    var u = res.usage || {};
    var cached = (u.input_tokens_details || {}).cached_tokens || 0;
    G.cost +=
      ((u.input_tokens - cached) * PRICE.inp +
        cached * PRICE.cached +
        u.output_tokens * PRICE.out) /
      1e6;
    var txt = '', rsum = '';
    (res.output || []).forEach(function (o) {
      if (o.type === 'reasoning' && o.summary) o.summary.forEach(function (sm) { if (sm.text) rsum += sm.text + ' '; });
      (o.content || []).forEach(function (c) {
        if (c.text) txt += c.text;
      });
    });
    ev_('turn', {
      n: G.turn,
      ms: Date.now() - tCall,
      inp: u.input_tokens,
      cached: cached,
      out: u.output_tokens,
      status: res.status,
      text: txt,
      think: rsum,
    });
    var calls = (res.output || []).filter(function (o) {
      return o.type === 'function_call';
    });
    if (!calls.length) {
      if (res.status === 'incomplete') {
        input = [
          {
            role: 'user',
            content: 'Reply was cut off. Continue with tool calls.',
          },
        ];
        ckpt_();
        continue;
      }
      input = [
        {
          role: 'user',
          content: 'Prose alone does nothing. Use tools; finish with submit.',
        },
      ];
      ckpt_();
      continue;
    }
    input = [];
    var done = false;
    for (var ci = 0; ci < calls.length; ci++) {
      var call = calls[ci];
      var args = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch (e2) {}
      var tc0 = Date.now();
      var out;
      if (call.name === 'submit') {
        var vr = tSubmit_();
        out = vr.text;
        if (vr.pass) done = true;
      } else out = runTool_(call.name, args);
      if (typeof out !== 'string') out = JSON.stringify(out);
      ev_('call', {
        ms: Date.now() - tc0,
        tool: call.name,
        args: JSON.stringify(args),
        out: out.length > 30000 ? out.slice(0, 30000) + '\n…[output truncated at 30000 chars]' : out,
      });
      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: out.length > 30000 ? out.slice(0, 30000) + '\n…[output truncated at 30000 chars]' : out,
      });
      if (done) break;
    }
    ckpt_();
    if (done) {
      stopped = 'submitted';
      break;
    }
    var left2 = DEADLINE_MS - (Date.now() - t0);
    if (left2 < MODEL_CALL_MIN_LEFT && left2 > HARD_RETURN_LEFT)
      input.push({
        role: 'user',
        content: 'TIME NEARLY UP. submit now if anything is written.',
      });
  }
  hb_('loop_exit_' + stopped);
  ckpt_();
  return {
    status: stopped === 'submitted' ? 'done' : stopped,
    attempts: G.attempt,
    cost_usd: Math.round(G.cost * 1000) / 1000,
    turns: G.turn,
    written: writtenKofN_(),
    elapsed_ms: Date.now() - t0,
    trace: G.trace,
  };
}
