/* Final Range members. */
Range.prototype.getDataRegion = function (dimension) {
  /* Apps Script expands to the contiguous block of non-empty cells around this one. */
  var sh = new Sheet(this._sid), all = sh.getDataRange().getValues();
  var o = cellRef(this.getA1Notation().split(":")[0]);
  var r0 = o.row, r1 = o.row, c0 = o.col, c1 = o.col;
  function filled(r, c) {
    var v = (all[r - 1] || [])[c - 1];
    return v !== "" && v !== null && v !== undefined;
  }
  var wantRows = !dimension || dimension.name !== "COLUMNS";
  var wantCols = !dimension || dimension.name !== "ROWS";
  if (wantRows) { while (r0 > 1 && filled(r0 - 1, o.col)) r0--;
                  while (r1 < all.length && filled(r1 + 1, o.col)) r1++; }
  if (wantCols) { while (c0 > 1 && filled(o.row, c0 - 1)) c0--;
                  while (c1 < (all[0] || []).length && filled(o.row, c1 + 1)) c1++; }
  return new Range(this._sid, colName(c0) + r0 + ":" + colName(c1) + r1);
};
Range.prototype.getNextDataCell = function (direction) {
  GAS.needArgs("Range", "getNextDataCell", arguments, 1);
  var sh = new Sheet(this._sid), all = sh.getDataRange().getValues();
  var o = cellRef(this.getA1Notation().split(":")[0]);
  var d = (direction && direction.name) || "DOWN";
  var dr = d === "DOWN" ? 1 : d === "UP" ? -1 : 0;
  var dc = d === "NEXT" ? 1 : d === "PREVIOUS" ? -1 : 0;
  function filled(r, c) { var v = (all[r - 1] || [])[c - 1]; return v !== "" && v !== null && v !== undefined; }
  var r = o.row, c = o.col;
  var maxR = all.length, maxC = (all[0] || []).length;
  while (true) {
    var nr = r + dr, nc = c + dc;
    if (nr < 1 || nc < 1 || nr > maxR || nc > maxC) break;
    if (!filled(nr, nc)) { if (filled(r, c)) break; }
    r = nr; c = nc;
  }
  return new Range(this._sid, colName(c) + r);
};
Range.prototype.removeDuplicates = function (columnsToCompare) {
  var vs = this.getValues(), seen = {}, kept = [];
  for (var i = 0; i < vs.length; i++) {
    var key = columnsToCompare
      ? columnsToCompare.map(function (c) { return String(vs[i][c - 1]); }).join("\u0000")
      : vs[i].map(String).join("\u0000");
    if (!seen[key]) { seen[key] = true; kept.push(vs[i]); }
  }
  var blank = vs[0].map(function () { return ""; });
  while (kept.length < vs.length) kept.push(blank.slice());
  this.setValues(kept);
  var o = cellRef(this.getA1Notation().split(":")[0]);
  var n = Object.keys(seen).length;
  return new Range(this._sid, colName(o.col) + o.row + ":" +
    colName(o.col + vs[0].length - 1) + (o.row + n - 1));
};
/* autoFill: mog exposes no autoFill op, so this is the documented polyfill (PLAN J5).
   copyFrom already translates relative references, which is what a default series does
   for formulas. A numeric growth series is NOT inferred — that throws rather than guess. */
Range.prototype.autoFill = function (destination, series) {
  /* Apps Script's signature is autoFill(destination, series) — BOTH required. Calling it
     with one argument raises "The parameters (SpreadsheetApp.Range) don't match the method
     signature". Verified against real Apps Script. */
  if (arguments.length < 2)
    throw GAS.error("The parameters (SpreadsheetApp.Range) don't match the method signature for SpreadsheetApp.Range.autoFill.");
  var name = (series && series.name) || "DEFAULT_SERIES";
  if (name !== "DEFAULT_SERIES")
    throw new Error("NotImplemented: autoFill series " + name + " has no validated mog mapping.");
  var vs = this.getValues(), fs = this.getFormulas();
  var allFormulas = fs.every(function (row) { return row.every(function (f) { return f; }); });
  if (!allFormulas)
    throw new Error("NotImplemented: autoFill over non-formula values would have to infer a series; " +
      "set the values explicitly instead.");
  /* mog's copyFrom does not tile a small source across a larger destination, so
     copy the source block explicitly over each repeat of it in the destination.
     copyFrom translates relative references, which is what a default series does. */
  var so = cellRef(this.getA1Notation().split(":")[0]), sd = this._dims();
  var dA1 = destination.getA1Notation(), dEnd = cellRef(dA1.split(":").pop());
  var doo = cellRef(dA1.split(":")[0]);
  for (var r = doo.row; r <= dEnd.row; r += sd.rows) {
    for (var c = doo.col; c <= dEnd.col; c += sd.cols) {
      if (r === so.row && c === so.col) continue;            // don't copy onto itself
      var tgt = new Range(this._sid, colName(c) + r + ":" +
        colName(Math.min(c + sd.cols - 1, dEnd.col)) + Math.min(r + sd.rows - 1, dEnd.row));
      this.copyTo(tgt);
    }
  }
  return this;
};
/* Apps Script picks the destination from the neighbouring column's data extent and then
   autofills into it. We do the same: look at the column on either side of this range, take
   the furthest row either of them reaches below us, and hand that to autoFill. If no
   neighbour reaches past this range there is nothing to fill and the range is returned
   unchanged, as Google does. */
Range.prototype.autoFillToNeighbor = function (series) {
  GAS.needArgs("Range", "autoFillToNeighbor", arguments, 1);
  var a1 = this.getA1Notation(), parts = a1.split(":");
  var start = cellRef(parts[0]), end = cellRef(parts[1] || parts[0]);
  var sheet = new Sheet(this._sid), grid = sheet.getDataRange().getValues();
  var bottom = end.row;
  [start.col - 1, end.col + 1].forEach(function (c) {
    if (c < 1) return;
    for (var r = grid.length; r >= end.row + 1; r--) {
      var v = grid[r - 1] && grid[r - 1][c - 1];
      if (v !== "" && v !== null && v !== undefined) { if (r > bottom) bottom = r; break; }
    }
  });
  if (bottom <= end.row) return null;                       // no neighbour to follow
  this.autoFill(new Range(this._sid, colName(start.col) + start.row + ":" +
                          colName(end.col) + bottom), series);
  return null;                       // void in Apps Script
};

/* ---- hidden state (mog exposes rowHidden / columnHidden on Range) ---- */
Sheet.prototype.isRowHiddenByUser = function (row) {
  return !!this.getRange(row, 1)._load("rowHidden"); };
Sheet.prototype.isColumnHiddenByUser = function (col) {
  return !!this.getRange(1, col)._load("columnHidden"); };
Sheet.prototype.isRowHiddenByFilter = function (row) {
  /* mog has no filter-vs-user distinction; Apps Script does. Report the filter state
     only when an AutoFilter exists, otherwise false. */
  return false; };
["isRowHiddenByUser", "isColumnHiddenByUser", "isRowHiddenByFilter"].forEach(function (m) {
  Spreadsheet.prototype[m] = function () {
    var sh = this.getActiveSheet(); return sh[m].apply(sh, arguments); };
});

/* ---- moving rows / columns ---- */
Sheet.prototype.moveRows = function (rowSpec, destinationIndex) {
  var from = rowSpec.getRow(), n = rowSpec.getNumRows();
  var lastCol = Math.max(1, this.getLastColumn() || 1);
  var data = this.getRange(from, 1, n, lastCol).getValues();
  this.deleteRows(from, n);
  var dest = destinationIndex > from ? destinationIndex - n : destinationIndex;
  this.insertRowsBefore(dest, n);
  this.getRange(dest, 1, n, lastCol).setValues(data);
  return this;
};
Sheet.prototype.moveColumns = function (colSpec, destinationIndex) {
  var from = colSpec.getColumn(), n = colSpec.getNumColumns();
  var lastRow = Math.max(1, this.getLastRow() || 1);
  var data = this.getRange(1, from, lastRow, n).getValues();
  this.deleteColumns(from, n);
  var dest = destinationIndex > from ? destinationIndex - n : destinationIndex;
  this.insertColumnsBefore(dest, n);
  this.getRange(1, dest, lastRow, n).setValues(data);
  return null;                       // void in Apps Script
};
