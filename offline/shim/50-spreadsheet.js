/* Spreadsheet + the SpreadsheetApp entry point */
function Spreadsheet(wsCollectionId, activeId) { this._wsc = wsCollectionId; this._active = activeId; }

Spreadsheet.prototype.getActiveSheet = function () { return new Sheet(this._active); };
Spreadsheet.prototype.getSheetByName = function (name) {
  var id = GAS.nid();
  try {
    /* the op takes `name`, not `key`, and no collection id (captured from the engine) */
    var r = GAS.apply([{ op: "getItem", id: id, name: name },
                       { op: "load", id: id, properties: ["name"] }]);
    if (r.loaded[id] && r.loaded[id].isNullObject) return null;
    return new Sheet(id, name);
  } catch (e) { return null; }                 // Apps Script returns null, never throws
};
Spreadsheet.prototype.getSheets = function () {
  /* Collection items carry a key/name but NO object id, so each sheet has to be
     resolved by name — otherwise every later op is sent with id: undefined
     ("missing field `id`"). */
  var r = GAS.apply([{ op: "load", id: this._wsc, properties: ["items"] }]);
  var items = (r.loaded[this._wsc] || {}).items || [];
  var self = this;
  return items.map(function (it) {
    var name = it.key || (it.properties && it.properties.name) || it.name;
    var id = GAS.nid();
    GAS.apply([{ op: "getItem", id: id, name: name }]);
    return new Sheet(id, name);
  });
};
Spreadsheet.prototype.getRange = function (a1) { return new Range(this._active, a1); };

/* Opaque host object, exactly as on Google: see the note in 40-sheet.js. */
Spreadsheet.prototype.toString = function () { return "Spreadsheet"; };
Spreadsheet.prototype.constructor = Object;

var SpreadsheetApp = (function () {
  var wsc = GAS.nid(), active = GAS.nid();
  GAS.apply([{ op: "getWorksheetCollection", id: wsc },
             { op: "getActiveWorksheet", id: active, worksheetCollectionId: wsc }]);
  var ss = new Spreadsheet(wsc, active);
  var api = {
    getActiveSpreadsheet: function () { return ss; },
    getActive: function () { return ss; },
    getActiveSheet: function () { return ss.getActiveSheet(); },
    flush: function () { GAS.apply([]); return null; },   // eager already; void -> null
    /* builder factories */
    newDataValidation: function () { return new DataValidationBuilder(); },
    newConditionalFormatRule: function () { return new ConditionalFormatRuleBuilder(); },
    newColor: function () { return new ColorBuilder(); },
    newTextStyle: function () { return new TextStyleBuilder(); }
  };
  Object.keys(GAS_ENUMS).forEach(function (k) { api[k] = GAS_ENUMS[k]; });
  Object.setPrototypeOf(api, GAS.outsideSurface("SpreadsheetApp"));
  return api;
})();
