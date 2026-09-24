/* Remaining Sheet surface.
   getMaxRows/getMaxColumns stay unimplemented on purpose: Apps Script reports the sheet's
   GRID size, and mog has no such property. A worksheet's loadable properties are exactly
   id/name/position/visibility/tabColor/showGridlines (the engine answers "Unknown Worksheet
   property" for anything else), and every sheet in an .xlsx shares one fixed Excel grid, so
   the only thing we could return is a constant - which is exactly what Google disproves
   (1000 rows on a fresh sheet, 23 columns after three deletes). A loud thrower beats a
   plausible constant. */
/* CF read/clear ride on the cfQuery op (count / at / range / clear), captured from the
   engine. Apps Script reports and replaces rules SHEET-wide, while cfQuery only sees the
   rules intersecting the range it is given - so the query range is the whole grid. The
   used area would miss every rule sitting outside it. */
Sheet.prototype._cfRange = function () { return this.getRange("A1:XFD1048576"); };
/* mog's read-back vocabulary is not its write vocabulary: a rule written as type "Custom"
   reads back as type "PresetCriteria" carrying `formula`, and cellValue/textComparison rules
   read back an `operator` in lowerCamel ("greaterThan", "notContains"). The loadable
   properties are id/type/priority/stopIfTrue/formula/operator/text/value1/value2 and no
   more: a rule's FORMAT is write-only in mog, so a rule read back here carries its
   condition and its ranges but not its colours. */
function cfCriteriaFromMog(info) {
  if (info.formula !== null && info.formula !== undefined) return { name: "CUSTOM_FORMULA", args: [info.formula] };
  var name = CF_OPERATOR_FROM_MOG[info.operator];
  if (!name) return null;                                  // gradient/icon-set and friends
  if (info.type === "ContainsText") return { name: name, args: [info.text === null || info.text === undefined ? "" : info.text] };
  return { name: name, args: (info.value2 === null || info.value2 === undefined) ? [info.value1] : [info.value1, info.value2] };
}
Sheet.prototype.getConditionalFormatRules = function () {
  var a1 = this._cfRange().getA1Notation(), rid = GAS.nid(), cid = GAS.nid();
  /* cfQuery returns a ClientResult: the value arrives in `results`, not `loaded`,
     and must NOT be followed by a load op ("The object to load is not available"). */
  var res = GAS.apply([{ op: "getRange", id: rid, worksheetId: this._id, address: a1 },
                       { op: "cfQuery", method: "count", rangeId: rid, key: null, id: cid }]);
  var n = (res.results || {})[cid];
  n = typeof n === "number" ? n : 0;
  var out = [];
  for (var i = 0; i < n; i++) {
    var rid2 = GAS.nid(), iid = GAS.nid(), aid = GAS.nid();
    /* A rule PARSED from an imported file exposes only type/priority/stopIfTrue/id --
       mog rejects `formula`/`operator`/`value1`... on it with "Unknown ConditionalFormat
       property". Loading all of them in ONE op made the whole apply throw, and the catch
       below then dropped the rule entirely, so getConditionalFormatRules() returned []
       for a sheet that demonstrably HAS a rule. Reporting no rule where one exists is the
       worst outcome here: a caller then creates a duplicate. So load the always-safe set
       first and keep the rule no matter what, then try the descriptive set separately. */
    var info = {}, addr = null;
    try {
      var q = GAS.apply([{ op: "getRange", id: rid2, worksheetId: this._id, address: a1 },
                         { op: "cfQuery", method: "at", rangeId: rid2, key: i, id: iid },
                         { op: "cfQuery", method: "range", sourceId: iid, id: aid, nullable: true },
                         { op: "load", id: iid, properties: ["type", "priority", "stopIfTrue"] },
                         { op: "load", id: aid, properties: ["address"] }]);
      info = q.loaded[iid] || {};
      addr = (q.loaded[aid] || {}).address;
    } catch (e) { /* even the safe set failed; the rule still exists and still counts */ }
    var opt = ["formula", "operator", "text", "value1", "value2"];
    for (var oi = 0; oi < opt.length; oi++) {
      var rid3 = GAS.nid(), iid3 = GAS.nid();
      try {
        var q2 = GAS.apply([{ op: "getRange", id: rid3, worksheetId: this._id, address: a1 },
                            { op: "cfQuery", method: "at", rangeId: rid3, key: i, id: iid3 },
                            { op: "load", id: iid3, properties: [opt[oi]] }]);
        var got = (q2.loaded[iid3] || {})[opt[oi]];
        if (got !== undefined && got !== null) info[opt[oi]] = got;
      } catch (e2) { /* this engine cannot describe that facet of this rule */ }
    }
    try {
      var b = new ConditionalFormatRuleBuilder()
        .setRanges([new Range(this._id, addr ? String(addr).split("!").pop() : a1)]);
      var criteria = cfCriteriaFromMog(info);
      /* a rule whose shape we cannot describe still exists, and Apps Script still counts it */
      if (criteria) b.withCriteria(BooleanCriteria[criteria.name], criteria.args);
      out.push(b.build());
    } catch (e3) { out.push(null); /* unbuildable, but it EXISTS -- never silently vanish */ }
  }
  return out;
};
Sheet.prototype.clearConditionalFormatRules = function () {
  var r = this._cfRange(), rid = GAS.nid();
  GAS.apply([{ op: "getRange", id: rid, worksheetId: this._id, address: r.getA1Notation() },
             { op: "cfQuery", method: "clear", rangeId: rid }]);
  return this;
};
/* Apply conditional formatting rules. Formula-driven rules (whenFormulaSatisfied) map to
   ConditionalFormatType.Custom, which serialises to <cfRule type="expression"> — the form
   toggle_checks requires. That type is supported by our patched mog. */
var CF_CRITERIA_TO_EXCEL = {
  CUSTOM_FORMULA: "Custom",
  NUMBER_GREATER_THAN: "CellValue", NUMBER_GREATER_THAN_OR_EQUAL_TO: "CellValue",
  NUMBER_LESS_THAN: "CellValue", NUMBER_LESS_THAN_OR_EQUAL_TO: "CellValue",
  NUMBER_EQUAL_TO: "CellValue", NUMBER_NOT_EQUAL_TO: "CellValue",
  NUMBER_BETWEEN: "CellValue", NUMBER_NOT_BETWEEN: "CellValue",
  TEXT_CONTAINS: "ContainsText", TEXT_DOES_NOT_CONTAIN: "ContainsText",
  /* These were MISSING, and every one of them is reachable: whenCellNotEmpty,
     whenTextStartsWith, whenTextEndsWith, whenTextEqualTo and the date family are all in
     the surface. setConditionalFormatRules threw NotImplemented for them, and the sweep
     fixture's try/catch swallowed the throw -- so the suite reported a harmless-looking
     background colour difference instead of "this rule cannot be created at all".
     All four mog types below were verified against the real binary before mapping. */
  CELL_EMPTY: "PresetCriteria", CELL_NOT_EMPTY: "PresetCriteria",
  TEXT_STARTS_WITH: "ContainsText", TEXT_ENDS_WITH: "ContainsText",
  TEXT_EQUAL_TO: "CellValue", TEXT_NOT_EQUAL_TO: "CellValue",
  DATE_AFTER: "CellValue", DATE_BEFORE: "CellValue", DATE_EQUAL_TO: "CellValue"
};
var CF_PRESET = { CELL_EMPTY: "Blanks", CELL_NOT_EMPTY: "NonBlanks" };
var CF_TEXT_OPERATOR = {
  TEXT_CONTAINS: "Contains", TEXT_DOES_NOT_CONTAIN: "NotContains",
  TEXT_STARTS_WITH: "BeginsWith", TEXT_ENDS_WITH: "EndsWith"
};
var CF_OPERATOR = {
  NUMBER_GREATER_THAN: "GreaterThan", NUMBER_GREATER_THAN_OR_EQUAL_TO: "GreaterThanOrEqual",
  NUMBER_LESS_THAN: "LessThan", NUMBER_LESS_THAN_OR_EQUAL_TO: "LessThanOrEqual",
  NUMBER_EQUAL_TO: "EqualTo", NUMBER_NOT_EQUAL_TO: "NotEqualTo",
  NUMBER_BETWEEN: "Between", NUMBER_NOT_BETWEEN: "NotBetween",
  TEXT_EQUAL_TO: "EqualTo", TEXT_NOT_EQUAL_TO: "NotEqualTo",
  DATE_AFTER: "GreaterThan", DATE_BEFORE: "LessThan", DATE_EQUAL_TO: "EqualTo"
};
/* mog's read-back spelling of the same operators, plus the two text ones it renames. */
var CF_OPERATOR_FROM_MOG = (function () {
  var m = { containsText: "TEXT_CONTAINS", notContains: "TEXT_DOES_NOT_CONTAIN" };
  for (var k in CF_OPERATOR) m[CF_OPERATOR[k].charAt(0).toLowerCase() + CF_OPERATOR[k].slice(1)] = k;
  return m;
})();
Sheet.prototype.setConditionalFormatRules = function (rules) {
  var self = this;
  /* Apps Script REPLACES every rule in the sheet ("Replaces all currently existing
     conditional format rules in the sheet with the input rules"), so two calls must not
     accumulate - and setConditionalFormatRules([]) is how a script clears them. */
  this.clearConditionalFormatRules();
  /* Precedence is INVERTED between the two engines: in Apps Script rules[0] wins, in mog
     the rule added LAST gets priority 1 and wins. Adding back-to-front makes rules[0] end
     up as priority 1 - which also makes getConditionalFormatRules read them back in the
     order they were set, since cfQuery.at() walks rules in priority order. */
  (rules || []).slice().reverse().forEach(function (rule) {
    var cond = rule.getBooleanCondition && rule.getBooleanCondition();
    if (!cond) throw GAS.error("Only boolean conditional format rules are supported.");
    var name = cond.getCriteriaType() && cond.getCriteriaType().name;
    var type = CF_CRITERIA_TO_EXCEL[name];
    if (!type) throw new Error("NotImplemented: conditional format criteria " + name);
    var args = cond.getCriteriaValues() || [];
    (rule.getRanges() || []).forEach(function (range) {
      var rid = GAS.nid(), cid = GAS.nid();
      var ops = [{ op: "getRange", id: rid, worksheetId: self._id, address: range.getA1Notation() },
                 { op: "cfAdd", id: cid, rangeId: rid, type: type }];
      if (type === "Custom") {
        ops.push({ op: "set", id: cid, property: "custom.rule", value: { formula: args[0] } });
        pushCfStyle(ops, cid, "custom", cond);
      } else if (type === "PresetCriteria") {
        ops.push({ op: "set", id: cid, property: "preset.rule",
                   value: { criterion: CF_PRESET[name] } });
        pushCfStyle(ops, cid, "preset", cond);
      } else if (type === "ContainsText") {
        ops.push({ op: "set", id: cid, property: "textComparison.rule",
                   value: { operator: CF_TEXT_OPERATOR[name], text: args[0] } });
        pushCfStyle(ops, cid, "textComparison", cond);
      } else {
        /* A cellValue comparison against TEXT needs the literal quoted, or the engine reads
           it as a defined name. Dates compare as the serial the sheet actually stores. */
        var a0 = args[0];
        if (a0 instanceof Date) a0 = dateToSerial(a0);
        else if (typeof a0 === "string" && name.indexOf("TEXT_") === 0) a0 = '"' + a0 + '"';
        var v = { operator: CF_OPERATOR[name], formula1: a0 };
        if (args.length > 1) v.formula2 = args[1];
        ops.push({ op: "set", id: cid, property: "cellValue.rule", value: v });
        pushCfStyle(ops, cid, "cellValue", cond);
      }
      GAS.apply(ops);
    });
  });
  return this;
};
function pushCfStyle(ops, cid, prefix, cond) {
  if (cond.getFontColor()) ops.push({ op: "set", id: cid, property: prefix + ".format.font.color", value: normColor(cond.getFontColor()) });
  if (cond.getBackground()) ops.push({ op: "set", id: cid, property: prefix + ".format.fill.color", value: normColor(cond.getBackground()) });
  if (cond.getBold() !== null && cond.getBold() !== undefined)
    ops.push({ op: "set", id: cid, property: prefix + ".format.font.bold", value: cond.getBold() });
  if (cond.getItalic() !== null && cond.getItalic() !== undefined)
    ops.push({ op: "set", id: cid, property: prefix + ".format.font.italic", value: cond.getItalic() });
}
Sheet.prototype.getNamedRanges = GAS.notImplemented("Sheet.getNamedRanges");
/* Apps Script copies the sheet INTO the given spreadsheet and names the copy
   "Copy of <name>". Offline there is exactly one workbook - openById/openByUrl are out of
   scope - so any Spreadsheet argument is this one, and mog's worksheetCopy does the work. */
Sheet.prototype.copyTo = function (spreadsheet) {
  if (!spreadsheet) throw GAS.error("The parameters () don't match the method signature for SpreadsheetApp.Sheet.copyTo.");
  var id = GAS.nid();
  GAS.apply([{ op: "worksheetCopy", id: id, worksheetId: this._id, positionType: "End" }]);
  var copy = new Sheet(id);
  try { copy.setName("Copy of " + this.getName()); } catch (e) { /* name taken: keep the engine's */ }
  return copy;
};

/* ThemeColor value object */
function ThemeColorObj(t) { this._t = t; }
ThemeColorObj.prototype.getColorType = function () { return ColorType.THEME; };
ThemeColorObj.prototype.getThemeColorType = function () { return this._t; };
