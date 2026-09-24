/* RangeList — a thin fan-out over several Ranges. Apps Script applies each
   operation to every range in the list and returns the RangeList for chaining. */
function RangeList(sheetId, a1s) {
  this._sid = sheetId;
  this._ranges = (a1s || []).map(function (a) { return new Range(sheetId, a); });
}
RangeList.prototype.getRanges = function () { return this._ranges.slice(); };
["clear", "clearContent", "clearFormat", "clearDataValidations", "breakApart", "trimWhitespace",
 "setBackground", "setBackgroundRGB", "setBorder", "setFontColor", "setFontFamily", "setFontLine",
 "setFontSize", "setFontStyle", "setFontWeight", "setFormula", "setFormulaR1C1", "setNumberFormat",
 "setValue"
].forEach(function (m) {
  RangeList.prototype[m] = function () {
    var args = arguments;
    this._ranges.forEach(function (r) {
      if (typeof r[m] !== "function") throw new Error("NotImplemented: Range." + m);
      r[m].apply(r, args);
    });
    return this;
  };
});

RangeList.prototype.toString = function () { return "RangeList"; };
RangeList.prototype.constructor = Object;
