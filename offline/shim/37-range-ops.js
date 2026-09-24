/* Range geometry, navigation and cell operations. */
Range.prototype.getCell = function (row, col) {
  var o = cellRef(this.getA1Notation().split(":")[0]);
  return new Range(this._sid, colName(o.col + col - 1) + (o.row + row - 1));
};
Range.prototype.offset = function (rowOffset, colOffset, numRows, numCols) {
  var o = cellRef(this.getA1Notation().split(":")[0]), d = this._dims();
  var nr = numRows === undefined ? d.rows : numRows, nc = numCols === undefined ? d.cols : numCols;
  var r0 = o.row + rowOffset, c0 = o.col + colOffset;
  return new Range(this._sid, colName(c0) + r0 + ":" + colName(c0 + nc - 1) + (r0 + nr - 1));
};
Range.prototype.getLastRow = function () { var o = cellRef(this.getA1Notation().split(":")[0]); return o.row + this._dims().rows - 1; };
Range.prototype.getLastColumn = function () { var o = cellRef(this.getA1Notation().split(":")[0]); return o.col + this._dims().cols - 1; };
Range.prototype.getRowIndex = function () { return this.getRow(); };
Range.prototype.getColumnIndex = function () { return this.getColumn(); };
Range.prototype.getHeight = function () { return this._dims().rows; };
Range.prototype.getWidth = function () { return this._dims().cols; };
Range.prototype.isBlank = function () {
  // COUNTA counts formulas (including =""), literal empty strings and ordinary values.
  // Reading values alone cannot distinguish an empty string from an absent cell.
  var rid=GAS.nid(),fid=GAS.nid();
  var out=GAS.apply([{op:"getRange",id:rid,worksheetId:this._sid,address:this._boundedA1()},
    {op:"functionEvaluate",id:fid,worksheetId:this._sid,name:"COUNTA",args:[{rangeId:rid}]},
    {op:"load",id:fid,properties:["value","error"]}]).loaded[fid];
  if(out.error || typeof out.value!=="number")throw new Error("Cannot determine blank cells: "+out.error);
  return out.value===0;
};
Range.prototype.getDataRegion = GAS.notImplemented("Range.getDataRegion");
Range.prototype.breakApart = function () {
  GAS.apply(this._bind(function (id) { return [{ op: "rangeUnmerge", rangeId: id }]; }).ops); return this; };
Range.prototype.mergeVertically = function () {
  GAS.apply(this._bind(function (id) { return [{ op: "rangeMerge", rangeId: id, across: false }]; }).ops); return this; };
Range.prototype.clearDataValidations = function () {
  var rid = GAS.nid(), did = GAS.nid();
  GAS.apply([{ op: "getRange", id: rid, worksheetId: this._sid, address: this._boundedA1() },
             { op: "getRangeDataValidation", id: did, rangeId: rid },
             { op: "set", id: did, property: "clear", value: null }]);
  return this;
};
