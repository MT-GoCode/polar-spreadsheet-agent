/** Static xlsx format reader: font colors + named ranges, parsed straight from the file.
 * Valid for the whole run because no agent write tool can change fonts or named ranges
 * (format-safe write set; HATCH_BAN blocks setFont*). If a color-writing tool is ever
 * added, this map needs invalidation. */
import { execFileSync } from 'node:child_process';

function entry(xlsx, name) {
  try { return execFileSync('unzip', ['-p', xlsx, name], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); }
  catch (e) { return ''; }
}

// legacy indexed palette (0-63); 64/65 = auto → default
const INDEXED = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];

function applyTint(hex, tint) {
  if (!tint) return hex;
  let r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;   // ECMA-376: tint acts on luminance
  const hue = (p, q2, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q2 - p) * 6 * t; if (t < 1 / 2) return q2; if (t < 2 / 3) return p + (q2 - p) * (2 / 3 - t) * 6; return p; };
  let r2, g2, b2;
  if (s === 0) { r2 = g2 = b2 = l; } else {
    const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q2;
    r2 = hue(p, q2, h + 1 / 3); g2 = hue(p, q2, h); b2 = hue(p, q2, h - 1 / 3);
  }
  const to = x => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
  return to(r2) + to(g2) + to(b2);
}

function themePalette(xlsx) {
  const xml = entry(xlsx, 'xl/theme/theme1.xml');
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml);
  if (!scheme) return [];
  const byName = {};
  for (const m of scheme[0].matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g)) {
    const v = /(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"/.exec(m[2]);
    byName[m[1]] = v ? v[1].toUpperCase() : '000000';
  }
  // Excel maps theme index 0↔lt1, 1↔dk1, 2↔lt2, 3↔dk2 (contrary to element order)
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(k => byName[k] || '000000');
}

function parseColor(colorXml, theme) {
  if (!colorXml) return null;                       // no <color> = inherited default
  if (/auto="1"/.test(colorXml)) return null;
  let m = /rgb="(?:FF)?([0-9A-Fa-f]{6})"/.exec(colorXml);
  if (m) return m[1].toUpperCase();
  m = /indexed="(\d+)"/.exec(colorXml);
  if (m) { const i = +m[1]; return i >= 64 ? null : (INDEXED[i] || null); }
  m = /theme="(\d+)"/.exec(colorXml);
  if (m) {
    const base = theme[+m[1]];
    if (!base) return null;
    const t = /tint="([-\d.eE]+)"/.exec(colorXml);
    return applyTint(base, t ? parseFloat(t[1]) : 0);
  }
  return null;
}

function sheetFiles(xlsx) {
  const wb = entry(xlsx, 'xl/workbook.xml');
  const rels = entry(xlsx, 'xl/_rels/workbook.xml.rels');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  const out = [];
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    let t = relMap[m[2]] || '';
    if (t && !t.startsWith('/')) t = 'xl/' + t.replace(/^\.\//, '');
    out.push({ name: m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"), file: t });
  }
  return out;
}

/** → { sheetName: { 'A1': '#rrggbb' } } — only cells whose effective font color ≠ default. */
export function buildFontColorMap(xlsx) {
  const styles = entry(xlsx, 'xl/styles.xml');
  const theme = themePalette(xlsx);
  const fonts = [...styles.matchAll(/<font\/>|<font>[\s\S]*?<\/font>/g)].map(m => {
    const c = /<color[^>]*\/>/.exec(m[0]);
    return parseColor(c ? c[0] : null, theme);
  });
  const xfBlock = name => {
    const b = new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>').exec(styles);
    return b ? [...b[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => {
      const g = k => { const r = new RegExp(k + '="([^"]*)"').exec(m[0]); return r ? r[1] : null; };
      return { fontId: +(g('fontId') || 0), applyFont: g('applyFont'), xfId: g('xfId') };
    }) : [];
  };
  const cellXfs = xfBlock('cellXfs'), styleXfs = xfBlock('cellStyleXfs');
  // effective font per style index: applyFont=0 with an xfId defers to the cell-style xf
  const styleColor = cellXfs.map(xf => {
    let fid = xf.fontId;
    if (xf.applyFont === '0' && xf.xfId !== null && styleXfs[+xf.xfId]) fid = styleXfs[+xf.xfId].fontId;
    return fonts[fid] || null;
  });
  const map = {};
  for (const { name, file } of sheetFiles(xlsx)) {
    if (!file) continue;
    const xml = entry(xlsx, file);
    const sheet = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?s="(\d+)"/g)) {
      const col = styleColor[+m[2]];
      if (col && col !== '000000') sheet[m[1]] = '#' + col.toLowerCase();
    }
    map[name] = sheet;
  }
  return map;
}

/** → [{name, sheet, a1}] from workbook.xml definedNames (skips _xlnm builtins). */
export function parseNamedRanges(xlsx) {
  const wb = entry(xlsx, 'xl/workbook.xml');
  const out = [];
  for (const m of wb.matchAll(/<definedName[^>]*name="([^"]+)"[^>]*>([^<]+)<\/definedName>/g)) {
    if (m[1].startsWith('_xlnm')) continue;
    const ref = m[2].replace(/&amp;/g, '&');
    const rm = /^'?([^'!]+)'?!(.+)$/.exec(ref);
    if (rm) out.push({ name: m[1], sheet: rm[1], a1: rm[2].replace(/\$/g, '') });
  }
  return out;
}
