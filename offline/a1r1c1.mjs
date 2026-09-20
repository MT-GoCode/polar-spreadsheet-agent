const REF = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?(\$?)([A-Z]{1,3})(\$?)([0-9]+)(?![A-Za-z0-9_(])/g;
export function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
export function colStr(n) { let s = ''; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; }
function splitLiterals(f, fn) {
  return f.split(/("(?:[^"]|"")*")/).map((p, i) => (i % 2 ? p : fn(p))).join('');
}
export function toR1C1(f, row, col) {
  return splitLiterals(f, part => part.replace(REF, (m, sh, ca, cl, ra, rn) => {
    const c = colNum(cl), r = +rn;
    return (sh || '') + (ra ? 'R' + r : 'R[' + (r - row) + ']') + (ca ? 'C' + c : 'C[' + (c - col) + ']');
  }));
}
const RC = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?R(\[?-?\d+\]?)C(\[?-?\d+\]?)/g;
export function toA1(f, row, col) {
  return splitLiterals(f, part => part.replace(RC, (m, sh, rr, cc) => {
    const abs = x => !x.startsWith('[');
    const r = abs(rr) ? +rr : row + +rr.slice(1, -1);
    const c = abs(cc) ? +cc : col + +cc.slice(1, -1);
    if (r < 1 || c < 1) return m;
    return (sh || '') + (abs(cc) ? '$' : '') + colStr(c) + (abs(rr) ? '$' : '') + r;
  }));
}
