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
// Row/col parts are independently optional (RC4, R29C, bare RC are valid R1C1; absent
// part = relative offset 0). Leading lookbehind stops identifier tails (=SUM(ARC));
// trailing guard stops identifier heads (RC_TOTAL, RCA). Excel forbids defined names
// that collide with R1C1 refs, so a real name can never be eaten.
const RC = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. ]*)!)?(?<![A-Za-z0-9_.$])R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?(?![A-Za-z0-9_.([])/g;
export function toA1(f, row, col) {
  return splitLiterals(f, part => part.replace(RC, (m, sh, rr, cc) => {
    rr = rr || '[0]'; cc = cc || '[0]';
    const abs = x => !x.startsWith('[');
    const r = abs(rr) ? +rr : row + +rr.slice(1, -1);
    const c = abs(cc) ? +cc : col + +cc.slice(1, -1);
    if (r < 1 || c < 1) throw new Error('R1C1 ref out of bounds at ' + colStr(col) + row + ': ' + m + ' → row ' + r + ', col ' + c);
    return (sh || '') + (abs(cc) ? '$' : '') + colStr(c) + (abs(rr) ? '$' : '') + r;
  }));
}
