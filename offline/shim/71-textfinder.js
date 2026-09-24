/* TextFinder. mog exposes `find`/`replaceAll` but no findAll, so findAll is built
   by iterating find. Apps Script regex is RE2; JS RegExp is not RE2, so patterns
   using constructs outside the intersection THROW rather than silently differing. */
function TextFinder(sheetId, a1, text) {
  this._sid = sheetId; this._a1 = a1; this._text = text;
  this._opts = { matchCase: false, entireCell: false, regex: false, formulaText: false, diacritics: true };
  this._cursor = null;
}
Sheet.prototype.createTextFinder = function (text) { return new TextFinder(this._id, null, text); };
Range.prototype.createTextFinder = function (text) { return new TextFinder(this._sid, this._a1, text); };

["matchCase:matchCase", "matchEntireCell:entireCell", "useRegularExpression:regex",
 "matchFormulaText:formulaText", "ignoreDiacritics:diacritics"].forEach(function (d) {
  var parts = d.split(":");
  TextFinder.prototype[parts[0]] = function (v) {
    GAS.needArgs("TextFinder", parts[0], arguments, 1);
    this._opts[parts[1]] = !!v; return this;
  };
});
TextFinder.prototype.startFrom = function (range) {
  GAS.needArgs("TextFinder", "startFrom", arguments, 1);
  this._cursor = range.getA1Notation(); return this;
};
TextFinder.prototype.getCurrentMatch = function () { return this._cursor ? new Range(this._sid, this._cursor) : null; };

var RE2_UNSUPPORTED = /\(\?<|\\\d|\(\?=|\(\?!/;      // lookbehind, backrefs, lookahead
TextFinder.prototype._scan = function () {
  if (this._opts.regex && RE2_UNSUPPORTED.test(this._text))
    throw new Error("NotImplemented: pattern uses a construct outside the RE2 n JS RegExp intersection: " + this._text);
  var sheet = new Sheet(this._sid);
  var area = this._a1 ? new Range(this._sid, this._a1) : sheet.getDataRange();
  var values = this._opts.formulaText ? area.getFormulas() : area.getValues();
  var origin = cellRef(area.getA1Notation().split(":")[0]);
  var needle = this._opts.matchCase ? this._text : String(this._text).toLowerCase();
  var re = this._opts.regex ? new RegExp(this._text, this._opts.matchCase ? "" : "i") : null;
  var hits = [];
  for (var r = 0; r < values.length; r++) for (var c = 0; c < values[r].length; c++) {
    var cell = values[r][c]; if (cell === "" || cell === null) continue;
    var hay = String(cell); if (!this._opts.matchCase) hay = hay.toLowerCase();
    var hit = re ? re.test(String(cell))
                 : (this._opts.entireCell ? hay === needle : hay.indexOf(needle) >= 0);
    if (hit) hits.push(new Range(this._sid, colName(origin.col + c) + (origin.row + r)));
  }
  return hits;
};
TextFinder.prototype.findAll = function () { return this._scan(); };
TextFinder.prototype.findNext = function () {
  var hits = this._scan(); if (!hits.length) return null;
  if (!this._cursor) { this._cursor = hits[0].getA1Notation(); return hits[0]; }
  for (var i = 0; i < hits.length; i++)
    if (hits[i].getA1Notation() === this._cursor && i + 1 < hits.length) {
      this._cursor = hits[i + 1].getA1Notation(); return hits[i + 1]; }
  return null;
};
TextFinder.prototype.findPrevious = function () {
  var hits = this._scan(); if (!hits.length) return null;
  if (!this._cursor) { this._cursor = hits[hits.length - 1].getA1Notation(); return hits[hits.length - 1]; }
  for (var i = 0; i < hits.length; i++)
    if (hits[i].getA1Notation() === this._cursor && i > 0) {
      this._cursor = hits[i - 1].getA1Notation(); return hits[i - 1]; }
  return null;
};
TextFinder.prototype.replaceAllWith = function (replacement) {
  var hits = this._scan(), self = this, n = 0;
  hits.forEach(function (cell) {
    var v = self._opts.formulaText ? cell.getFormula() : cell.getValue();
    var out = self._opts.regex
      ? String(v).replace(new RegExp(self._text, self._opts.matchCase ? "g" : "gi"), replacement)
      : (self._opts.entireCell ? replacement : String(v).split(self._text).join(replacement));
    if (self._opts.formulaText) cell.setFormula(out); else cell.setValue(out);
    n++;
  });
  return n;
};
TextFinder.prototype.replaceWith = function (replacement) {
  GAS.needArgs("TextFinder", "replaceWith", arguments, 1);
  var hit = this.findNext(); if (!hit) return 0;
  hit.setValue(replacement); return 1;
};
