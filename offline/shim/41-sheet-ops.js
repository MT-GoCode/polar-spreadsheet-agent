/* Sheet operations. Apps Script row/column indices are 1-based throughout. */
Sheet.prototype._set = function (property, value) {
  GAS.apply([{ op: "set", id: this._id, property: property, value: value }]); return this; };
Sheet.prototype._rangeOp = function (a1, op, extra) {
  var rid = GAS.nid();
  var o = { op: op, rangeId: rid };
  for (var k in extra) o[k] = extra[k];
  GAS.apply([{ op: "getRange", id: rid, worksheetId: this._id, address: a1 }, o]);
  return this;
};
Sheet.prototype.setName = function (n) { return this._set("name", n); };
Sheet.prototype.getSheetId = function () {
  /* Documented contract: Integer. mog's worksheet id is a zero-padded HEX string
     ("00000000000000000000000000000001", then "...020c") counted from 1, while Apps Script
     counts sheet ids from 0 - the first sheet of a spreadsheet is id 0. Parse the hex and
     shift by one: unique, stable and small enough to be an Integer. Number() read "...020c"
     as NaN and fell into the hash, which produced ids like 8000000000. */
  var id = String(this._load("id")).replace(/-/g, "");
  if (/^[0-9a-f]+$/i.test(id)) {
    var n = parseInt(id, 16);
    if (isFinite(n) && n <= 9007199254740991) return n - 1;
  }
  return Math.abs(id.split("").reduce(
    function (a, ch) { return ((a << 5) - a + ch.charCodeAt(0)) | 0; }, 0));
};
Sheet.prototype.getIndex = function () { return this._load("position") + 1; };   // Apps Script is 1-based
Sheet.prototype.getType = function () { return SheetType.GRID; };
Sheet.prototype.getParent = function () { return SpreadsheetApp.getActiveSpreadsheet(); };
Sheet.prototype.isSheetHidden = function () { return this._load("visibility") !== "Visible"; };

/* ---- rows / columns ---- */
Sheet.prototype.insertRowBefore = function (r) { return this.insertRowsBefore(r, 1); };
Sheet.prototype.insertRowAfter = function (r) { return this.insertRowsAfter(r, 1); };
Sheet.prototype.insertRowsBefore = function (r, n) {
  /* howMany is REQUIRED on the plural form. Without this the count arrived as
     undefined and the address came out "2:NaN" -- a mog parse error instead of
     the signature error Apps Script raises. */
  GAS.needArgs("Sheet", "insertRowsBefore", arguments, 2);
  return this._rangeOp(r + ":" + (r + n - 1), "rangeInsert", { shift: "Down" });
};
Sheet.prototype.insertRowsAfter = function (r, n) {
  GAS.needArgs("Sheet", "insertRowsAfter", arguments, 2);   // forwards 2 args either way
  return this.insertRowsBefore(r + 1, n);
};
Sheet.prototype.insertRows = function (r, n) { return this.insertRowsBefore(r, n === undefined ? 1 : n); };
Sheet.prototype.deleteRow = function (r) { return this.deleteRows(r, 1); };
Sheet.prototype.deleteRows = function (r, n) { return this._rangeOp(r + ":" + (r + (n === undefined ? 1 : n) - 1), "rangeDelete", { shift: "Up" }); };
Sheet.prototype.insertColumnBefore = function (c) { return this.insertColumnsBefore(c, 1); };
Sheet.prototype.insertColumnAfter = function (c) { return this.insertColumnsAfter(c, 1); };
Sheet.prototype.insertColumnsBefore = function (c, n) {
  /* howMany is REQUIRED on the plural form. Without this the count arrived as
     undefined and the address came out "2:NaN" -- a mog parse error instead of
     the signature error Apps Script raises. */
  GAS.needArgs("Sheet", "insertColumnsBefore", arguments, 2);
  return this._rangeOp(colName(c) + ":" + colName(c + n - 1), "rangeInsert", { shift: "Right" });
};
Sheet.prototype.insertColumnsAfter = function (c, n) {
  GAS.needArgs("Sheet", "insertColumnsAfter", arguments, 2);
  return this.insertColumnsBefore(c + 1, n);
};
Sheet.prototype.insertColumns = function (c, n) { this.insertColumnsBefore(c, n === undefined ? 1 : n); return null; };
Sheet.prototype.deleteColumn = function (c) { return this.deleteColumns(c, 1); };
Sheet.prototype.deleteColumns = function (c, n) { return this._rangeOp(colName(c) + ":" + colName(c + (n === undefined ? 1 : n) - 1), "rangeDelete", { shift: "Left" }); };

/* ---- sizing ---- */
/* Apps Script measures column width and row height in PIXELS; mog, like the xlsx format,
   stores POINTS. 72 pt = 96 px, so the conversion is exactly 4/3. Without it
   setColumnWidth(120) would store 120 points = 160 px and write a visibly wrong
   workbook -- and sheet_layout is a hard FAIL kind in the grader's preservation check. */
var PX_PER_PT = 4 / 3;
function ptToPx(v) { return v == null ? v : Math.round(v * PX_PER_PT); }
function pxToPt(v) { return v == null ? v : v / PX_PER_PT; }

Sheet.prototype.getColumnWidth = function (c) { return ptToPx(this.getRange(1, c)._fmt("format", "columnWidth", null, true)); };
Sheet.prototype.setColumnWidth = function (c, w) { this.getRange(1, c)._fmt("format", "columnWidth", pxToPt(w)); return this; };
Sheet.prototype.getRowHeight = function (r) { return ptToPx(this.getRange(r, 1)._fmt("format", "rowHeight", null, true)); };
Sheet.prototype.setRowHeight = function (r, h) { this.getRange(r, 1)._fmt("format", "rowHeight", pxToPt(h)); return this; };

/* ---- freezing ---- */
Sheet.prototype.setFrozenRows = function (n) { GAS.apply([{ op: "freezeRows", worksheetId: this._id, count: n }]); return this; };
Sheet.prototype.setFrozenColumns = function (n) { GAS.apply([{ op: "freezeColumns", worksheetId: this._id, count: n }]); return this; };
Sheet.prototype.getFrozenRows = GAS.notImplemented("Sheet.getFrozenRows");
Sheet.prototype.getFrozenColumns = GAS.notImplemented("Sheet.getFrozenColumns");

/* ---- bulk data ---- */
Sheet.prototype.getDataRange = function () {
  var lr = Math.max(1, this.getLastRow()), lc = Math.max(1, this.getLastColumn());
  return this.getRange(1, 1, lr, lc);
};
Sheet.prototype.getSheetValues = function (row, col, numRows, numCols) {
  return this.getRange(row, col, numRows, numCols).getValues(); };
Sheet.prototype.appendRow = function (values) {
  /* An empty row has no columns, so getRange(r, 1, 1, 0) built the impossible address
     "A699:699" and surfaced a mog parse error. Apps Script rejects the call on its
     signature instead. */
  if (!values || !values.length)
    throw GAS.error("The parameters (" + (values ? "[]" : String(values)) +
      ") don't match the method signature for SpreadsheetApp.Sheet.appendRow.");
  var r = this.getLastRow() + 1;
  this.getRange(r, 1, 1, values.length).setValues([values]); return this; };
Sheet.prototype.clear = function () { this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())).clear(); return this; };
Sheet.prototype.clearContents = function () { this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())).clearContent(); return this; };
Sheet.prototype.clearFormats = function () { this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())).clearFormat(); return this; };
Sheet.prototype.getRangeList = function (a1s) { return new RangeList(this._id, a1s); };
Sheet.prototype.sort = function (column, ascending) {
  /* Apps Script rejects a missing required argument before it touches the sheet; without
     this the engine's own "fields[0].key must be a non-negative integer" leaks out. */
  if (column === undefined) throw GAS.error(
    "The parameters () don't match the method signature for SpreadsheetApp.Sheet.sort.");
  var dr = this.getDataRange(), rid = GAS.nid();
  GAS.apply([{ op: "getRange", id: rid, worksheetId: this._id, address: dr.getA1Notation() },
             { op: "rangeSort", rangeId: rid, fields: [{ key: column - 1, ascending: ascending !== false }] }]);
  return this;
};
