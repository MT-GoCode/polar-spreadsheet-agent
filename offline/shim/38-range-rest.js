/* Remaining Range surface: data validation, copying, R1C1, text style, misc. */
Range.prototype.setDataValidation = function (rule) {
  var rid = GAS.nid(), did = GAS.nid();
  var ops = [{ op: "getRange", id: rid, worksheetId: this._sid, address: this._boundedA1() },
             { op: "getRangeDataValidation", id: did, rangeId: rid }];
  /* Clearing is a distinct op: setting rule=null is rejected with
     "DataValidation.rule must be an object". Captured from the engine. */
  ops.push(rule ? { op: "set", id: did, property: "rule", value: dvToExcel(rule) }
                : { op: "set", id: did, property: "clear", value: null });
  GAS.apply(ops); return this;
};
Range.prototype.setDataValidations = function (rules) {
  return this._applyCells(rules, function (c, r) { c.setDataValidation(r); }); };
Range.prototype.getDataValidation = function () {
  var rid = GAS.nid(), did = GAS.nid();
  var r = GAS.apply([{ op: "getRange", id: rid, worksheetId: this._sid, address: this._boundedA1() },
                     { op: "getRangeDataValidation", id: did, rangeId: rid },
                     { op: "load", id: did, properties: ["rule", "type"] }]);
  var info = r.loaded[did];
  return (!info || !info.type || info.type === "None") ? null : excelToDv(info);
};
Range.prototype.getDataValidations = function () {
  return this._eachCell(function (c) { return c.getDataValidation(); }); };
function dvToExcel(rule) {
  var c = rule.getCriteriaType && rule.getCriteriaType(), a = rule.getCriteriaValues ? rule.getCriteriaValues() : [];
  var name = c && c.name;
  if (name === "VALUE_IN_LIST") return { list: { inCellDropDown: a[1] !== false, source: (a[0] || []).join(",") } };
  if (name === "NUMBER_BETWEEN") return { wholeNumber: { formula1: a[0], formula2: a[1], operator: "Between" } };
  if (name === "NUMBER_GREATER_THAN") return { wholeNumber: { formula1: a[0], operator: "GreaterThan" } };
  if (name === "NUMBER_LESS_THAN") return { wholeNumber: { formula1: a[0], operator: "LessThan" } };
  if (name === "TEXT_CONTAINS") return { custom: { formula: '=ISNUMBER(SEARCH("' + a[0] + '",INDIRECT("' + "" + '")))' } };
  if (name === "CUSTOM_FORMULA") return { custom: { formula: a[0] } };
  if (name === "VALUE_IN_RANGE") {
    /* Apps Script takes a Range; Excel's list rule takes a formula reference. */
    var rng = a[0];
    var ref = rng && rng.getA1Notation
      ? "=" + rng.getSheet().getName() + "!" + rng.getA1Notation().replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")
      : String(rng);
    return { list: { inCellDropDown: a[1] !== false, source: ref } };
  }
  throw new Error("NotImplemented: DataValidationCriteria." + name + " has no validated Excel mapping.");
}
function excelToDv(info) {
  var b = new DataValidationBuilder();
  var src = info.rule && info.rule.list && info.rule.list.source;
  if (info.type === "List" && src !== undefined) {
    /* a source beginning with "=" is a RANGE reference, not a literal list */
    if (String(src).charAt(0) === "=") return b.withCriteria(DataValidationCriteria.VALUE_IN_RANGE, [src, true]).build();
    return b.requireValueInList(String(src).split(","), true).build();
  }
  return b.build();
}

/* ---- copying ---- */
Range.prototype.copyTo = function (target, options) {
  var src = GAS.nid(), dst = GAS.nid();
  var type = "All";
  if (options && options.contentsOnly) type = "Values";
  if (options && options.formatOnly) type = "Formats";
  GAS.apply([{ op: "getRange", id: src, worksheetId: this._sid, address: this._boundedA1() },
             { op: "getRange", id: dst, worksheetId: target._sid, address: target._a1 },
             { op: "rangeCopyFrom", rangeId: dst, sourceRangeId: src, sourceAddress: null,
               copyType: type, skipBlanks: false, transpose: false }]);
  return null;                     // void in Apps Script
};
Range.prototype.copyValuesToRange = function (sheet, c1, c2, r1, r2) {
  return this.copyTo(sheet.getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1), { contentsOnly: true }); };
Range.prototype.copyFormatToRange = function (sheet, c1, c2, r1, r2) {
  return this.copyTo(sheet.getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1), { formatOnly: true }); };
/* void in Apps Script -- returns null, not the Range. */
Range.prototype.moveTo = function (target) { this.copyTo(target); this.clear(); return null; };

/* ---- R1C1 (mog exposes no formulasR1C1; translate on our side) ---- */
function a1ToR1C1(formula, baseRow, baseCol) {
  return String(formula).replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, function (_, ac, col, ar, row) {
    var c = 0; for (var i = 0; i < col.length; i++) c = c * 26 + (col.charCodeAt(i) - 64);
    /* Apps Script always emits the offset in brackets, including zero:
       "=A1+B1" at E1 -> "=R[0]C[-4]+R[0]C[-3]", never "=RC[-4]".
       Verified against real Apps Script (SHAPES channel, getFormulaR1C1). */
    var rr = ar ? "R" + row : "R[" + (Number(row) - baseRow) + "]";
    var cc = ac ? "C" + c : "C[" + (c - baseCol) + "]";
    return rr + cc;
  });
}
function r1c1ToA1(formula, baseRow, baseCol) {
  return String(formula).replace(/R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?/g, function (_, r, c) {
    function res(tok, base) {
      if (tok === undefined) return { v: base, abs: false };
      if (tok.charAt(0) === "[") return { v: base + parseInt(tok.slice(1, -1), 10), abs: false };
      return { v: parseInt(tok, 10), abs: true };
    }
    var R = res(r, baseRow), C = res(c, baseCol);
    return (C.abs ? "$" : "") + colName(C.v) + (R.abs ? "$" : "") + R.v;
  });
}
Range.prototype.getFormulaR1C1 = function () {
  var f = this.getFormula(); return f ? a1ToR1C1(f, this.getRow(), this.getColumn()) : f; };
Range.prototype.getFormulasR1C1 = function () {
  return this._eachCell(function (c) { return c.getFormulaR1C1(); }); };
/* Translate R1C1 -> A1 in-process, then ONE formulas op -- the same path setFormulas takes.
   These used to go through _applyCells, which issues a separate cell.setFormula() (and so a
   separate engine round-trip plus recalc) per cell. On task_04 that turned the agent's single
   batched call over G8:DR171 into 19,024 sequential writes: 144s when the agent happened to
   build the array itself, still unfinished after 28 MINUTES via R1C1. Apps Script batches this
   natively, so the cell-by-cell version was also a fidelity bug -- it punished correct code. */
function _r1c1Grid(range, at) {
  var d = range._dims(), origin = cellRef(range.getA1Notation().split(":")[0]), grid = [];
  for (var r = 0; r < d.rows; r++) {
    var row = [];
    for (var c = 0; c < d.cols; c++) {
      var f = at(r, c);
      row.push(f == null ? f : r1c1ToA1(f, origin.row + r, origin.col + c));
    }
    grid.push(row);
  }
  return grid;
}
Range.prototype.setFormulaR1C1 = function (f) {
  return this._set("formulas", _r1c1Grid(this, function () { return f; })); };
Range.prototype.setFormulasR1C1 = function (fs) {
  return this._set("formulas", _r1c1Grid(this, function (r, c) { return (fs[r] || [])[c]; })); };

/* ---- text style ---- */
Range.prototype.getTextStyle = function () {
  return new TextStyleBuilder().setBold(this.getFontWeight() === "bold")
    .setItalic(this.getFontStyle() === "italic").setFontSize(this.getFontSize())
    .setFontFamily(this.getFontFamily()).setForegroundColor(this.getFontColor()).build(); };
Range.prototype.getTextStyles = function () { return this._eachCell(function (c) { return c.getTextStyle(); }); };
Range.prototype.setTextStyle = function (ts) {
  if (ts.isBold() !== null) this.setFontWeight(ts.isBold() ? "bold" : "normal");
  if (ts.isItalic() !== null) this.setFontStyle(ts.isItalic() ? "italic" : "normal");
  if (ts.getFontSize() !== null) this.setFontSize(ts.getFontSize());
  if (ts.getFontFamily() !== null) this.setFontFamily(ts.getFontFamily());
  if (ts.getForegroundColor() !== null) this.setFontColor(ts.getForegroundColor());
  return this; };
Range.prototype.setTextStyles = function (vs) { return this._applyCells(vs, function (c, v) { c.setTextStyle(v); }); };

/* ---- misc ---- */
Range.prototype.sort = function (spec) {
  GAS.needArgs("Range", "sort", arguments, 1);
  var fields = (Array.isArray(spec) ? spec : [spec]).map(function (s) {
    if (typeof s === "number") return { key: s - 1, ascending: true };
    return { key: (s.column || 1) - 1, ascending: s.ascending !== false }; });
  GAS.apply(this._bind(function (id) { return [{ op: "rangeSort", rangeId: id, fields: fields }]; }).ops);
  return this; };
Range.prototype.trimWhitespace = function () {
  return this.setValues(this.getValues().map(function (row) {
    return row.map(function (v) { return typeof v === "string" ? v.trim() : v; }); })); };
Range.prototype.canEdit = function () { return true; };
Range.prototype.isStartRowBounded = function () { return true; };
Range.prototype.isStartColumnBounded = function () { return true; };
Range.prototype.isEndRowBounded = function () { return true; };
Range.prototype.isEndColumnBounded = function () { return true; };
/* A cell with NO data-validation rule has nothing to be valid against, and Apps Script
   says so with null rather than true (verified online: a plain A1:B2 of values reports
   null, and isDataValidForAll a grid of nulls). With a rule present we still answer true:
   the engine does not evaluate rules, and claiming a violation we cannot see would be
   worse than claiming none. */
Range.prototype.isDataValid = function () {
  return this.getDataValidation() === null ? null : true; };
Range.prototype.isDataValidForAll = function () {
  /* Documented contract: Boolean[][] — validity PER CELL, not a single flag. */
  return this._eachCell(function (c) { return c.isDataValid(); }); };
Range.prototype.insertCells = function (dim) {
  return Sheet.prototype._rangeOp.call({ _id: this._sid }, this._a1, "rangeInsert",
    { shift: (dim && dim.name === "COLUMNS") ? "Right" : "Down" }) && this; };
Range.prototype.deleteCells = function (dim) {
  Sheet.prototype._rangeOp.call({ _id: this._sid }, this._a1, "rangeDelete",
    { shift: (dim && dim.name === "COLUMNS") ? "Left" : "Up" });
  return null;                       // void in Apps Script
};
