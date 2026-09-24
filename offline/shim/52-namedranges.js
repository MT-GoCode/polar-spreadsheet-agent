/* Named ranges, on mog's NamedItemCollection ops (shapes captured from the engine:
   nameGetCount uses `resultId`, nameGetItem takes a NAME, nameDelete takes the item id). */
Spreadsheet.prototype._names = function () {
  if (!this._nameColl) {
    this._nameColl = GAS.nid();
    GAS.apply([{ op: "getNamedItemCollection", id: this._nameColl, worksheetId: null }]);
  }
  return this._nameColl;
};
/* Sheets VALIDATES a named range's name and mog does not, so "hello world", "" and "0"
   were accepted offline and rejected online -- a FALSE GREEN, the one direction this
   harness exists to prevent: a script that names a range with a space passed here and
   would have failed the real run. Measured against Apps Script on all four pool values.
   Rules: 1-250 chars, letters/digits/underscore only, must not start with a digit, must
   not be spellable as a cell reference (A1 or R1C1 form), and not a boolean literal. */
function validateRangeName(name) {
  var bad = typeof name !== "string" || !name.length || name.length > 250 ||
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
            /^[A-Za-z]{1,3}[0-9]+$/.test(name) ||
            /^[Rr][0-9]+[Cc][0-9]+$/.test(name) ||
            /^(true|false)$/i.test(name);
  if (bad) throw GAS.error("The name given to this range is invalid.");
}
Spreadsheet.prototype.setNamedRange = function (name, range) {
  GAS.needArgs("Spreadsheet", "setNamedRange", arguments, 2);
  validateRangeName(name);
  /* Apps Script REPLACES an existing name; mog's nameAdd errors with
     "A name with this name already exists in this scope". Remove first, then add. */
  this._names();
  try { this.removeNamedRange(name); } catch (e) { /* not present: fine */ }
  var id = GAS.nid();
  GAS.apply([{ op: "nameAdd", id: id, worksheetId: null, name: name, comment: null,
               formulaLocal: false,
               reference: "=" + range.getSheet().getName() + "!" + range.getA1Notation(),
               rangeId: null }]);
  return this;
};
Spreadsheet.prototype._nameItems = function () {
  var coll = this._names();
  var r = GAS.apply([{ op: "load", id: coll, properties: ["items"] }]);
  return (r.loaded[coll] || {}).items || [];
};
Spreadsheet.prototype.getNamedRanges = function () {
  /* items come back as {key, properties:{name, value:"Sheet1!A1", ...}} — the
     address is already there, so no second round trip per name. */
  var self = this;
  return this._nameItems().map(function (it) {
    var props = it.properties || {};
    var nm = it.key || props.name;
    var addr = props.value ? String(props.value).split("!").pop() : null;
    if (!nm || !addr) return null;
    return new NamedRange(self, nm, new Range(self._active, addr));
  }).filter(Boolean);
};
Spreadsheet.prototype.getRangeByName = function (name) {
  var iid = GAS.nid(), rid = GAS.nid();
  try {
    var r = GAS.apply([
      { op: "nameGetItem", id: iid, worksheetId: null, name: name, orNullObject: true },
      { op: "nameGetRange", id: rid, nameId: iid, orNullObject: true },
      { op: "load", id: rid, properties: ["address"] }]);
    var info = r.loaded[rid];
    if (!info || info.isNullObject || !info.address) return null;
    var addr = String(info.address);
    return new Range(this._active, addr.split("!").pop());
  } catch (e) { return null; }             // Apps Script returns null, never throws
};
Spreadsheet.prototype.removeNamedRange = function (name) {
  GAS.needArgs("Spreadsheet", "removeNamedRange", arguments, 1);
  var iid = GAS.nid();
  /* Removing a name that does not exist is a NO-OP in Apps Script (returns null, no throw);
     mog raises "The requested named item doesn't exist". orNullObject makes the lookup
     tolerant so the delete simply does nothing. */
  try {
    GAS.apply([{ op: "nameGetItem", id: iid, worksheetId: null, name: name, orNullObject: true },
               { op: "nameDelete", id: iid }]);
  } catch (e) { /* absent name: Apps Script ignores it */ }
  return null;
};
Sheet.prototype.getNamedRanges = function () {
  var self = this;
  return SpreadsheetApp.getActiveSpreadsheet().getNamedRanges()
    .filter(function (nr) { return nr.getRange()._sid === self._id; });
};
