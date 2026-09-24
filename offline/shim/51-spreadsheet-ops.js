/* Spreadsheet. In Apps Script most of these operate on the ACTIVE sheet, so they
   genuinely are delegation — not a shortcut. Members that depend on Drive identity
   (getId/getUrl) have no offline meaning and throw rather than invent a value. */
Spreadsheet.prototype._active = function () { return new Sheet(this._active_id || this._activeId); };
["appendRow","deleteColumn","deleteColumns","deleteRow","deleteRows","getColumnWidth","getDataRange",
 "getFrozenColumns","getFrozenRows","getLastColumn","getLastRow","getRangeList","getRowHeight",
 "getSheetValues","insertColumnAfter","insertColumnBefore","insertColumnsAfter","insertColumnsBefore",
 "insertRowAfter","insertRowBefore","insertRowsAfter","insertRowsBefore","setFrozenColumns",
 "setFrozenRows","sort","createTextFinder"
].forEach(function (m) {
  Spreadsheet.prototype[m] = function () {
    var sh = this.getActiveSheet();
    if (typeof sh[m] !== "function") throw new Error("NotImplemented: Sheet." + m);
    /* Apps Script's Spreadsheet.insertRowAfter/appendRow/deleteRow/... are documented
       "Return: Sheet", not the spreadsheet - verified online. Hand back what the sheet
       returned instead of re-wrapping it as `this`. */
    return sh[m].apply(sh, arguments);
  };
});
Spreadsheet.prototype.getNumSheets = function () { return this.getSheets().length; };
Spreadsheet.prototype.getSheetName = function () { return this.getActiveSheet().getName(); };
Spreadsheet.prototype.getSheetId = function () { return this.getActiveSheet().getSheetId(); };
Spreadsheet.prototype.getSheetById = function (id) {
  var found = null;
  this.getSheets().forEach(function (s) { if (s.getSheetId() === id) found = s; });
  return found;
};
Spreadsheet.prototype.getName = function () { return this._load ? this._load("name") : null; };
Spreadsheet.prototype.getSpreadsheetTimeZone = function () { return "Etc/UTC"; };   // pinned in appsscript.json
Spreadsheet.prototype.getSpreadsheetLocale = function () { return "en_US"; };
Spreadsheet.prototype.toast = function () {                       // no UI offline; harmless
  GAS.needArgs("Spreadsheet", "toast", arguments, 1); return this;
};

/* ---- iterative calculation (live in 9/15 benchmark tasks) ---- */

/* ---- named ranges ---- */
function NamedRange(ss, name, range) { this._ss = ss; this._name = name; this._range = range; }
NamedRange.prototype.getName = function () { return this._name; };
NamedRange.prototype.getRange = function () { return this._range; };
/* These updated a LOCAL field and nothing else, so a rename or re-point was invisible to
   the workbook: getNamedRanges() still returned the old name and the old address. Apps
   Script rewrites the definition, so do that -- and validate the name first, the way
   Spreadsheet.setNamedRange does, or an invalid name is accepted here and rejected online. */
NamedRange.prototype.setName = function (n) {
  GAS.needArgs("NamedRange", "setName", arguments, 1);
  validateRangeName(n);
  this._ss.removeNamedRange(this._name);
  this._ss.setNamedRange(n, this._range);
  this._name = n;
  return this;
};
NamedRange.prototype.setRange = function (r) {
  GAS.needArgs("NamedRange", "setRange", arguments, 1);
  this._ss.setNamedRange(this._name, r);      // setNamedRange REPLACES an existing name
  this._range = r;
  return this;
};
NamedRange.prototype.remove = function () { this._ss.removeNamedRange(this._name); };

Spreadsheet.prototype.setNamedRange = function (name, range) {
  var nid = GAS.nid();
  GAS.apply([{ op: "getNamedItemCollection", id: nid },
             { op: "addName", collectionId: nid, name: name,
               reference: "=" + range.getSheet().getName() + "!" + range.getA1Notation() }]);
  return this;
};
Spreadsheet.prototype.getNamedRanges = GAS.notImplemented("Spreadsheet.getNamedRanges");
Spreadsheet.prototype.getRangeByName = GAS.notImplemented("Spreadsheet.getRangeByName");
Spreadsheet.prototype.removeNamedRange = GAS.notImplemented("Spreadsheet.removeNamedRange");
