/* Sheet */
function Sheet(id, name) { this._id = id; this._name = name; }

Sheet.prototype._load = function (property) {
  return GAS.apply([{ op: "load", id: this._id, properties: [property] }]).loaded[this._id][property];
};
Sheet.prototype.getName = function () { return this._load("name"); };
Sheet.prototype.getSheetName = function () { return this.getName(); };

/* getRange overloads: (a1) | (row,col) | (row,col,numRows) | (row,col,numRows,numCols) */
Sheet.prototype.getRange = function (a, b, c, d) {
  if (typeof a === "string") return new Range(this._id, a);
  var row = a, col = b, nr = (c === undefined ? 1 : c), nc = (d === undefined ? 1 : d);
  return new Range(this._id, colName(col) + row + ":" + colName(col + nc - 1) + (row + nr - 1));
};
function colName(n) { var s = ""; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; }

Sheet.prototype.getLastRow = function () { return this._usedDims().lastRow; };
Sheet.prototype.getLastColumn = function () { return this._usedDims().lastCol; };
Sheet.prototype._usedDims = function () {
  var id = GAS.nid();
  var r;
  try {
    /* valuesOnly=TRUE. Without it mog reports the whole grid (A1:XFD1048576) on a real
       workbook, so getLastRow() returned 1048576 where Google returns 297 — any agent
       using it for bounds would behave completely differently offline. */
    r = GAS.apply([{ op: "rangeQuery", method: "used", args: [true], nullable: true,
                     id: id, worksheetId: this._id },
                   { op: "load", id: id, properties: ["address"] }]);
  } catch (e) {
    return { lastRow: 0, lastCol: 0 };   /* empty sheet: Apps Script returns 0, not an error */
  }
  var info = r.loaded[id];
  if (!info || info.isNullObject || !info.address) return { lastRow: 0, lastCol: 0 };
  var ref = String(info.address).split("!").pop().split(":");
  var end = cellRef(ref[1] || ref[0]);
  return { lastRow: end.row, lastCol: end.col };
};

/* Apps Script hands back opaque host objects: String(sheet) is "Sheet" and their
   constructor is plain Object (verified online - the shape probe reads ctor "Object",
   str "Sheet"). Mirror that, so anything that stringifies one - a log line, a shape
   probe - sees what Google shows instead of "[object Object]". */
Sheet.prototype.toString = function () { return "Sheet"; };
Sheet.prototype.constructor = Object;
