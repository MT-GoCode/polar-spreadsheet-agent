/* ---- 10-runtime.js ---- */
/* ============================================================================
   Apps Script on mog — runtime bridge.
   mog's __mogApply(json) is SYNCHRONOUS and returns results inline, which is
   exactly Apps Script's execution model. Every call below flushes immediately,
   giving eager-write semantics (see UNCERTAINTIES U9/U21).
   ========================================================================== */
var GAS = (function () {
  var seq = 0;
  function nid() { return "gas" + (++seq); }

  /* Every op reaches the engine through here, so this is where we record WHICH SHEETS the
     agent wrote to. A preservation violation on a sheet the agent never wrote to cannot be
     the agent's doing -- mog recalculates cells that are literals in the file (task_15's
     `Formula Audit!D35`: -92884 -> 48048.72 when `Forecast Model` is edited, a sheet the
     agent never touched). No agent-free control can measure that: reproducing it requires
     changing values, which is what an agent does. This is a RECORD, not a heuristic.
     Sheet granularity is sufficient and sound: to damage a protected cell the agent must
     write to its sheet. A cross-sheet formula it authored changes a FORMULA cell, and
     grader/workbook.py:103 raw() compares the formula text there, not the value. */
  /* Read-only by RULE, not by hand-enumerated list -- a list gets it wrong. The first
     version missed `getWorksheetCollection`/`getActiveWorksheet`, which the shim issues at
     load time before anything else, so every run started with an incomplete record.
     Rule: anything named get* plus load/rangeQuery only fetches. cfQuery is deliberately
     NOT read-only -- cfQuery{method:"clear"} deletes every conditional format on the range
     (42-sheet-rest.js clearConditionalFormatRules). Unknown ops count as writes, which is
     the safe direction: it records more sheets, so it forgives less. */
  function isRead(op) {
    return op === "load" || op === "rangeQuery" || op === "functionEvaluate" || String(op).indexOf("get") === 0;
  }
  var writtenSheets = {};
  var revision = 0;
  var recordComplete = true;
  function apply(ops) {
    var touched = [], wrote = false, i, o;
    for (i = 0; i < ops.length; i++) {
      o = ops[i];
      if (o.worksheetId !== undefined && o.worksheetId !== null) touched.push(o.worksheetId);
      if (!isRead(o.op)) wrote = true;
    }
    if (wrote) {
      revision++;
      /* A mutating batch that names no worksheet (Sheet.setName, setNamedRange, ...) means
         we cannot say which sheet was touched. The record is then INCOMPLETE, and an
         incomplete record must never be used to forgive anything. */
      if (!touched.length) recordComplete = false;
      for (i = 0; i < touched.length; i++) writtenSheets[touched[i]] = 1;
    }
    var res = JSON.parse(__mogApply(JSON.stringify(ops)));
    if (res.error) throw asGasError(res.error);
    return res;
  }
  /* Sheet NAMES, resolved through the same handles the agent used. Returning the raw
     handles is useless to the caller: nid() is a counter, so any later getSheets() mints
     fresh handles that cannot match (measured: agent ["gas3"] vs probe {"gas8".."gas11"}
     -> empty intersection -> every violation discounted -> total false green).
     null means "cannot vouch for this record" and the verdict then discounts nothing. */
  function writtenSheetNames() {
    if (!recordComplete) return null;
    var out = {}, k, r;                 // dedupe: many handles can name one sheet
    for (k in writtenSheets) {
      try {
        r = apply([{ op: "load", id: k, properties: ["name"] }]).loaded[k];
        if (!r || typeof r.name !== "string") return null;
        out[r.name] = 1;
      } catch (e) { return null; }
    }
    return Object.keys(out);
  }

  /* Apps Script surfaces engine problems as plain Error with specific text.
     We keep mog's message but tag the origin so conformance can compare shapes.

     Some engine failures are the SAME failure Apps Script reports, in different words --
     an agent that branches on the message (or just logs it) sees a different program. The
     table translates only failures whose CAUSE is identical on both sides; anything else
     keeps mog's wording rather than being dressed up as an Apps Script error it is not. */
  var ENGINE_MESSAGE = [
    [/Name cannot look like a cell reference|invalid name|Name is invalid/i,
     "The name given to this range is invalid."]
  ];
  function asGasError(e) {
    var msg = e.message || JSON.stringify(e), name = e.name || "Error";
    for (var i = 0; i < ENGINE_MESSAGE.length; i++) {
      if (ENGINE_MESSAGE[i][0].test(msg)) { msg = ENGINE_MESSAGE[i][1]; name = "Exception"; break; }
    }
    var err = new Error(msg);
    err.name = name;
    err.__engine = true;
    return err;
  }

  /* Apps Script's own API errors carry name "Exception", not "Error" — verified against
     real Apps Script (SHAPES channel: the ConditionalFormatRuleBuilder validation error).
     Use this for anything that mirrors an Apps Script semantic error; NotImplemented and
     OutOfScope deliberately keep name "Error" because they are OUR markers, not Google's. */
  function gasError(message) {
    var e = new Error(message); e.name = "Exception"; return e;
  }

  /* Loud failure: a member that is in scope but unbuilt must THROW, never no-op.
     A silent no-op is a false green — the one unacceptable outcome offline. */
  function notImplemented(name) {
    var f = function () { throw new Error("NotImplemented: " + name +
      " is in the supported surface but is not yet implemented offline."); };
    f.__unimplemented = true;          // so coverage counts it honestly
    return f;
  }
  function outOfScope(name) {
    var f = function () { throw new Error("OutOfScope: " + name +
      " is deliberately unsupported offline."); };
    f.__outOfScope = true;
    return f;
  }

  /* THE CATCH-ALL. Everything in the surface is implemented and verified; anything else
     was removed from vocab/KEPT.txt rather than left as a half-member. A class prototype
     inherits from this proxy, so a real member resolves on the prototype itself and only a
     genuine miss reaches the trap. We return a THROWING FUNCTION instead of throwing on the
     property read, so `typeof sheet.foo === "function"` still works the way JS callers
     expect and only an actual call fails -- loudly, and naming the member. */
  var PROTOCOL = { toJSON: 1, then: 1, valueOf: 1, inspect: 1, length: 1, name: 1,
                   nodeType: 1, splice: 1, callee: 1, caller: 1, prototype: 1 };
  function outsideSurface(cls) {
    return new Proxy({}, {
      get: function (target, key) {
        /* JS protocol hooks are probed by the ENGINE, not called by agent code:
           JSON.stringify asks for toJSON, `await` asks for then, string coercion asks
           for valueOf/Symbol.toPrimitive. Throwing on those breaks ordinary JavaScript --
           JSON.stringify(range) died with "OutOfSurface: Range.toJSON". Let them miss. */
        if (typeof key !== "string" || key in Object.prototype || key.charAt(0) === "_" ||
            PROTOCOL[key]) {
          return target[key];
        }
        var msg = "OutOfSurface: " + cls + "." + key + " is not part of the supported " +
          "Apps Script surface offline. If the agent needs it, add it to vocab/KEPT.txt " +
          "and implement it -- do not stub it.";
        var f = function () { throw new Error(msg); };
        f.__outOfSurface = true;
        /* Reading a property off the stub must fail too. SpreadsheetApp.ThemeColorType was
           missing from the surface; the bare stub made .ACCENT1 evaluate to undefined and
           the gap stayed invisible until a probe caught it. */
        return new Proxy(f, {
          get: function (t, k) {
            if (typeof k !== "string" || k in Function.prototype || PROTOCOL[k] ||
                k.charAt(0) === "_") return t[k];
            throw new Error(msg + " (reading ." + k + ")");
          }
        });
      }
    });
  }

  /* Apps Script validates arity BEFORE doing anything and reports one exact message.
     One guard, used by every member with a required argument -- never a bespoke check. */
  function needArgs(cls, method, args, n) {
    if (args.length < n) {
      throw gasError("The parameters (" + (args.length ? "..." : "") +
        ") don't match the method signature for SpreadsheetApp." + cls + "." + method + ".");
    }
  }

  return { nid: nid, apply: apply, revision: function(){return revision;}, writtenSheetNames: writtenSheetNames, notImplemented: notImplemented, needArgs: needArgs,
           outOfScope: outOfScope, asGasError: asGasError, error: gasError,
           outsideSurface: outsideSurface };
})();

/* ---- 20-enums.js ---- */
/* GENERATED by gen-surface.mjs from vocab/KEPT.txt — do not edit by hand.
   Each value keeps Apps Script's toString()/name. __excel holds the Excel-side
   mapping where a 1:1 one exists; null means "no unambiguous Excel equivalent",
   and any member whose use requires that mapping throws rather than guessing. */
function gasEnum(ns, names, excel) {
  var o = {};
  names.forEach(function (n) {
    var v = { name: n, toString: function () { return n; },
              __enum: ns, __excel: (excel && excel[n] !== undefined) ? excel[n] : null };
    Object.freeze(v); o[n] = v;
  });
  return Object.freeze(o);
}
var AutoFillSeries = gasEnum("AutoFillSeries", ["ALTERNATE_SERIES","DEFAULT_SERIES"]);
var BooleanCriteria = gasEnum("BooleanCriteria", ["CELL_EMPTY","CELL_NOT_EMPTY","CUSTOM_FORMULA","DATE_AFTER","DATE_AFTER_RELATIVE","DATE_BEFORE","DATE_BEFORE_RELATIVE","DATE_EQUAL_TO","DATE_EQUAL_TO_RELATIVE","DATE_NOT_EQUAL_TO","NUMBER_BETWEEN","NUMBER_EQUAL_TO","NUMBER_GREATER_THAN","NUMBER_GREATER_THAN_OR_EQUAL_TO","NUMBER_LESS_THAN","NUMBER_LESS_THAN_OR_EQUAL_TO","NUMBER_NOT_BETWEEN","NUMBER_NOT_EQUAL_TO","TEXT_CONTAINS","TEXT_DOES_NOT_CONTAIN","TEXT_ENDS_WITH","TEXT_EQUAL_TO","TEXT_NOT_EQUAL_TO","TEXT_STARTS_WITH"]);
var BorderStyle = gasEnum("BorderStyle", ["DASHED","DOTTED","DOUBLE","SOLID","SOLID_MEDIUM","SOLID_THICK"], {"DOTTED":{"style":"Dot","weight":"Thin"},"DASHED":{"style":"Dash","weight":"Thin"},"SOLID":{"style":"Continuous","weight":"Thin"},"SOLID_MEDIUM":{"style":"Continuous","weight":"Medium"},"SOLID_THICK":{"style":"Continuous","weight":"Thick"},"DOUBLE":{"style":"Double","weight":"Thin"}});
var ColorType = gasEnum("ColorType", ["RGB","THEME","UNSUPPORTED"]);
var CopyPasteType = gasEnum("CopyPasteType", ["PASTE_CONDITIONAL_FORMATTING","PASTE_DATA_VALIDATION","PASTE_FORMAT","PASTE_FORMULA","PASTE_NORMAL","PASTE_NO_BORDERS","PASTE_VALUES"]);
var DataValidationCriteria = gasEnum("DataValidationCriteria", ["CUSTOM_FORMULA","DATE_AFTER","DATE_AFTER_RELATIVE","DATE_BEFORE","DATE_BEFORE_RELATIVE","DATE_BETWEEN","DATE_EQUAL_TO","DATE_EQUAL_TO_RELATIVE","DATE_IS_VALID_DATE","DATE_NOT_BETWEEN","DATE_ON_OR_AFTER","DATE_ON_OR_BEFORE","NUMBER_BETWEEN","NUMBER_EQUAL_TO","NUMBER_GREATER_THAN","NUMBER_GREATER_THAN_OR_EQUAL_TO","NUMBER_LESS_THAN","NUMBER_LESS_THAN_OR_EQUAL_TO","NUMBER_NOT_BETWEEN","NUMBER_NOT_EQUAL_TO","TEXT_CONTAINS","TEXT_DOES_NOT_CONTAIN","TEXT_EQUAL_TO","TEXT_IS_VALID_EMAIL","TEXT_IS_VALID_URL","VALUE_IN_LIST","VALUE_IN_RANGE"]);
var Dimension = gasEnum("Dimension", ["COLUMNS","ROWS"], {"COLUMNS":"Columns","ROWS":"Rows"});
var Direction = gasEnum("Direction", ["DOWN","NEXT","PREVIOUS","UP"], {"UP":"Up","DOWN":"Down","PREVIOUS":"Left","NEXT":"Right"});
var InterpolationType = gasEnum("InterpolationType", ["MAX","MIN","NUMBER","PERCENT","PERCENTILE"]);
var RelativeDate = gasEnum("RelativeDate", ["PAST_MONTH","PAST_WEEK","PAST_YEAR","TODAY","TOMORROW","YESTERDAY"]);
var SheetType = gasEnum("SheetType", ["DATASOURCE","GRID","OBJECT"], {"GRID":"Worksheet","OBJECT":"Chartsheet","DATASOURCE":null});
var SortOrder = gasEnum("SortOrder", ["ASCENDING","DESCENDING"], {"ASCENDING":true,"DESCENDING":false});
var ThemeColorType = gasEnum("ThemeColorType", ["ACCENT1","ACCENT2","ACCENT3","ACCENT4","ACCENT5","ACCENT6","BACKGROUND","HYPERLINK","TEXT","UNSUPPORTED"]);
var GAS_ENUMS = { AutoFillSeries: AutoFillSeries, BooleanCriteria: BooleanCriteria, BorderStyle: BorderStyle, ColorType: ColorType, CopyPasteType: CopyPasteType, DataValidationCriteria: DataValidationCriteria, Dimension: Dimension, Direction: Direction, InterpolationType: InterpolationType, RelativeDate: RelativeDate, SheetType: SheetType, SortOrder: SortOrder, ThemeColorType: ThemeColorType };

/* ---- 30-range.js ---- */
/* Range — the surface the agent touches most. Apps Script semantics throughout:
   setters return the Range (chaining); getValue() is the top-left of the range;
   setValue() fills EVERY cell in the range (verified against Google). */
function Range(sheetId, a1) { this._sid = sheetId; this._a1 = a1; }
/* Apps Script hands back opaque host objects: String(range) is "Range" and their
   constructor is plain Object (verified online — the shape probe reads ctor "Object",
   str "Range"). Same rule as Sheet/Spreadsheet in 40-/50-. */
Range.prototype.toString = function () { return "Range"; };
Range.prototype.constructor = Object;

/* Apps Script accepts UNBOUNDED ranges -- getRange("A:A") is the whole column,
   getRange("1:1") the whole row -- and writes/formats across them happily. mog refuses
   with "requires a bounded range", so an agent colouring a column would fail offline and
   succeed online: a false red. Bound such a range to the sheet's used extent (at least one
   cell) before the op reaches mog. Only unbounded addresses pay the extra lookup. */
Range.prototype._boundedA1 = function () {
  var a1 = this._a1;
  if (!/^[A-Z]+:[A-Z]+$|^[0-9]+:[0-9]+$/i.test(String(a1).replace(/\$/g, ""))) return a1;
  var sh = new Sheet(this._sid);
  var rows = Math.max(1, sh.getLastRow() || 1), cols = Math.max(1, sh.getLastColumn() || 1);
  var t = String(a1).toUpperCase().replace(/\$/g, ""), parts = t.split(":");
  if (/^[0-9]+$/.test(parts[0])) {                       // whole row "3:5"
    return "A" + parts[0] + ":" + colName(cols) + parts[1];
  }
  return parts[0] + "1:" + parts[1] + rows;              // whole column "A:B"
};

Range.prototype._bind = function (extra) {
  var id = GAS.nid();
  var ops = [{ op: "getRange", id: id, worksheetId: this._sid, address: this._boundedA1() }];
  return { id: id, ops: extra ? ops.concat(extra(id)) : ops };
};
Range.prototype._set = function (property, value) {
  var b = this._bind(function (id) { return [{ op: "set", id: id, property: property, value: value }]; });
  GAS.apply(b.ops); return this;
};
Range.prototype._load = function (property) {
  var b = this._bind(function (id) { return [{ op: "load", id: id, properties: [property] }]; });
  return GAS.apply(b.ops).loaded[b.id][property];
};
Range.prototype._dims = function () {
  var g = this._load("address");                       // "Sheet1!A1:C3"
  var ref = String(g).split("!").pop();
  var parts = ref.split(":"), a = cellRef(parts[0]), b = cellRef(parts[1] || parts[0]);
  return { rows: b.row - a.row + 1, cols: b.col - a.col + 1 };
};
/* Accepts A1 ("B7"), whole-row ("7") and whole-column ("B") forms, because
   getRange("1:1") and getRange("A:A") are valid Apps Script and previously made this
   regex return null -> "cannot read property '1' of null". */
function cellRef(s) {
  var t = String(s).toUpperCase().replace(/\$/g, "");
  var m = /^([A-Z]*)(\d*)$/.exec(t);
  if (!m || (!m[1] && !m[2])) throw GAS.error("Invalid reference: " + s);
  var col = 0;
  for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
  return { col: col || 1, row: m[2] ? parseInt(m[2], 10) : 1,
           wholeRow: !m[1], wholeCol: !m[2] };
}
function fill(rows, cols, v) {
  var out = []; for (var r = 0; r < rows; r++) { var row = [];
    for (var c = 0; c < cols; c++) row.push(v); out.push(row); } return out;
}

/* mog's `values` setter treats ANY string starting with "-", "+" or "=" as a formula,
   so setValue("-") becomes "=-" and yields #NAME?. Google stores "-" as TEXT (verified
   against the live Sheets API, conformance/engine_truth.py). Leading "=" must still make
   a formula, because Apps Script's setValue("=A1") does. For "-"/"+" we keep the numeric
   cases (-5, +5 -> numbers, as Google does) and force everything else to text with the
   leading apostrophe mog honours. */
/* Sheets and Excel both store a date as a serial number: days since 1899-12-30.
   Apps Script hands you a JS Date and converts on the way in, so we do the same --
   mog's `values` setter rejects anything that is not a string, number, boolean or null. */
function dateToSerial(d) {
  var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
                    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return (ms - Date.UTC(1899, 11, 30)) / 86400000;
}

function coerceValue(v) {
  if (v instanceof Date) return dateToSerial(v);
  if (typeof v !== "string") return v;
  var c = v.charAt(0);
  if (c !== "-" && c !== "+") return v;
  /* Apps Script's setValue is NOT the same as the Sheets API's USER_ENTERED:
       setValue("-5") -> number -5
       setValue("+5") -> TEXT "+5"      (USER_ENTERED would give the number 5)
     Both verified against real Apps Script. Everything else beginning with -/+ is text,
     because mog's `values` setter would otherwise treat it as a formula. */
  if (c === "-" && v.length > 1 && isFinite(Number(v))) return v;
  return "'" + v;
}
function coerceGrid(vs) {
  return vs.map(function (row) { return row.map(coerceValue); });
}

/* A workbook stores a date as a plain serial number and remembers it is a date only in the
   cell's number format. Apps Script hides that: getValue() on a date-formatted cell hands
   back a JS Date, not 45930. So we read the format alongside the value and convert. */
function serialToDate(n) {
  var ms = Math.round((n - 25569) * 86400000);          // 25569 = 1970-01-01 as a serial
  var d = new Date(ms);
  /* Build in local time so getFullYear()/getMonth()/getDate() round-trip dateToSerial. */
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                  d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}
/* True for a format whose FIRST section shows a date or time. Literals must be stripped
   first or 0.0"May" and _(#,##0_) would look like dates: quoted text, backslash escapes
   and [$-409]/[Red] sections all contain letters that mean nothing here. */
function isDateFormat(fmt) {
  if (!fmt) return false;
  var f = String(fmt).split(";")[0]
            .replace(/"[^"]*"/g, "")
            .replace(/\\./g, "")
            .replace(/\[[^\]]*\]/g, "");
  if (/[ymdhs]/i.test(f) === false) return false;
  /* "m" alone is ambiguous (month vs minute) but either way it is a date/time format. */
  return /(y{2,4}|m{1,5}|d{1,4}|h{1,2}|s{1,2})/i.test(f);
}
/* Sheets has no #NULL! -- it reports Excel's intersection error, and every other failure
   its parser cannot classify, as #ERROR!. mog follows Excel. The error TEXT is what an
   agent reads back, so translate the codes Sheets does not have. #NAME? is deliberately
   NOT here: Sheets emits #NAME? too (for an unknown function), so mapping it would hide a
   real difference behind a correct-looking one. */
var ERROR_TEXT = { "#NULL!": "#ERROR!" };
function asErrorText(v) {
  return (typeof v === "string" && ERROR_TEXT.hasOwnProperty(v)) ? ERROR_TEXT[v] : v;
}
/* Walk the written grid from this range's top-left and remember any cell whose formula
   is unbalanced, so the read paths can report #ERROR! for it the way Sheets does. */
Range.prototype._origin = function () {
  return cellRef(String(this._a1).split(":")[0].replace(/\$/g, ""));
};
/* Called AFTER the write. Retires every entry in the written block, then records the
   malformed ones against what the engine repaired them to. */
Range.prototype._markMalformed = function (fs) {
  var o = this._origin(), bad = [], r, c, key;
  for (r = 0; r < (fs || []).length; r++) {
    for (c = 0; c < (fs[r] || []).length; c++) {
      key = this._sid + "|" + colName(o.col + c) + (o.row + r);
      delete MALFORMED[key];
      if (!formulaIsBalanced(fs[r][c])) bad.push([key, r, c, fs[r][c]]);
    }
  }
  if (!bad.length) return;
  var stored = this._load("formulas");
  for (var i = 0; i < bad.length; i++) {
    var row = stored && stored[bad[i][1]];
    MALFORMED[bad[i][0]] = { wrote: bad[i][3], stored: row && row[bad[i][2]] };
  }
  anyMalformed = true;
};
function datify(values, formats) {
  return values.map(function (row, r) {
    return row.map(function (v, c) {
      var f = formats && formats[r] && formats[r][c];
      if (typeof v === "number" && isDateFormat(f)) return serialToDate(v);
      return asErrorText(v);
    });
  });
}

/* ---- values / formulas ---- */
/* A cell holding a malformed formula reads back as #ERROR!, as it does in Sheets. The
   extra `formulas` load is only paid once any malformed formula has been written -- the
   normal case adds no round trip and no property. */
Range.prototype._errorOverlay = function (grid, formulas) {
  if (!anyMalformed || !formulas) return grid;
  var o = cellRef(String(this._a1).split(":")[0].replace(/\$/g, ""));
  var self = this;
  return grid.map(function (row, r) {
    return row.map(function (v, c) {
      return isMalformedCell(self._sid, colName(o.col + c) + (o.row + r),
                             formulas[r] && formulas[r][c]) ? "#ERROR!" : v;
    });
  });
};
Range.prototype.getValues = function () {
  var props = anyMalformed ? ["values", "numberFormat", "formulas"] : ["values", "numberFormat"];
  var b = this._bind(function (id) { return [{ op: "load", id: id, properties: props }]; });
  var got = GAS.apply(b.ops).loaded[b.id];
  return this._errorOverlay(datify(got.values, got.numberFormat), got.formulas);
};
Range.prototype.getValue = function () { return this.getValues()[0][0]; };
Range.prototype.setValues = function (vs) {
  /* null/undefined entries empty their cell, as Apps Script does */
  var self = this, hasNull = false;
  vs.forEach(function (row) { row.forEach(function (v) { if (v === null || v === undefined) hasNull = true; }); });
  if (!hasNull) return this._set("values", coerceGrid(vs));
  this._applyCells(vs, function (cell, v) {
    if (v === null || v === undefined) cell.clearContent(); else cell._set("values", [[coerceValue(v)]]);
  });
  return this;
};
/* A single-cell A1 reference needs no dimension lookup; skipping it removes a whole
   round trip per write, which dominates when an agent writes thousands of cells. */
function isSingleCell(a1) { return /^\$?[A-Z]+\$?\d+$/.test(a1); }
/* Sheets AUTO-APPLIES a date format when a Date is written into an unformatted cell, so
   the value reads back as a Date and displays as "9/30/2025". A workbook stores only the
   serial, so without this the cell reads back as the bare number 45930 and displays as
   "45930" -- measured on the date fixtures and on RangeList.setValue.
   Applied only when the cell has NO format yet; an explicit format the script or the
   workbook set is never overwritten, which is also what Sheets does. */
var AUTO_DATE_FORMAT = "m/d/yyyy";
Range.prototype._autoDateFormat = function (v) {
  if (!(v instanceof Date)) return;
  var f = this._load("numberFormat");
  f = Array.isArray(f) ? f[0][0] : f;
  if (f === "General" || f === null || f === undefined || f === "" ||
      f === DEFAULT_NUMBER_FORMAT) this._set("numberFormat", [[AUTO_DATE_FORMAT]]);
};
Range.prototype.setValue = function (v) {                 // fills the WHOLE range
  /* Apps Script's setValue(null) EMPTIES the cell. mog ignores a null in `values`, which
     silently left the old content in place — caught by the end-to-end test, where a task
     that clears a cell scored the old value instead. */
  if (v === null || v === undefined) return this.clearContent();
  this._autoDateFormat(v);
  if (isSingleCell(this._a1)) return this._set("values", [[coerceValue(v)]]);
  var d = this._dims(); return this._set("values", fill(d.rows, d.cols, coerceValue(v)));
};
/* Apps Script returns "" for a cell with no formula — never the cell's value.
   mog's `formulas` property echoes the literal value for non-formula cells, so
   anything not starting with "=" is reported as "". (Documented contract: String.) */
function asFormula(v) { return (typeof v === "string" && v.charAt(0) === "=") ? v : ""; }
Range.prototype.getFormulas = function () {
  var b=this._bind(function(id){return [{op:"load",id:id,properties:["formulas","values"]}];});
  var got=GAS.apply(b.ops).loaded[b.id],origin=cellRef(this._boundedA1().split(":")[0]),self=this,ops=[],checks=[];
  var out=got.formulas.map(function(row,r){return row.map(function(v,c){
    var f=asFormula(v);
    // A literal '=text' is echoed by Mog's formulas property. Most real formulas
    // have a different calculated value, so only ambiguous strings need ISFORMULA.
    if(f && got.values[r][c]===f){var rid=GAS.nid(),fid=GAS.nid();
      ops.push({op:"getRange",id:rid,worksheetId:self._sid,address:colName(origin.col+c)+(origin.row+r)},
        {op:"functionEvaluate",id:fid,worksheetId:self._sid,name:"ISFORMULA",args:[{rangeId:rid}]},
        {op:"load",id:fid,properties:["value","error"]});checks.push([r,c,fid]);}
    return f;
  });});
  if(ops.length){var results=GAS.apply(ops).loaded;checks.forEach(function(x){var result=results[x[2]];
    if(result.error || typeof result.value!=="boolean")throw new Error("Cannot determine formula identity: "+result.error);
    if(!result.value)out[x[0]][x[1]]="";
  });}
  /* Sheets stores a malformed formula VERBATIM; mog repairs it, so getFormula() returned
     "=SUM(D1:D3)" where Sheets returns "=SUM(D1:D3". Report what the script wrote. */
  if (anyMalformed) out = out.map(function (row, r) {
    return row.map(function (v, c) {
      var e = isMalformedCell(self._sid, colName(origin.col + c) + (origin.row + r), v);
      return e ? e.wrote : v;
    });
  });
  return out; };
Range.prototype.getFormula = function () { return this.getFormulas()[0][0]; };
/* mog SILENTLY REPAIRS a malformed formula: "=SUM(D1:D3" is stored as "=SUM(D1:D3)" and
   evaluates to 6, where Sheets stores it verbatim and shows #ERROR!. That is a FALSE
   GREEN -- the agent's broken formula scores a plausible number offline and errors
   online -- and it is the only failure direction this harness must never have. So the
   cell is recorded on write and reported as Sheets reports it: #ERROR! from the value and
   display paths, and the original text from getFormula.
   Balance is checked outside string literals; "" inside a string is an escaped quote. */
function formulaIsBalanced(f) {
  if (typeof f !== "string" || f.charAt(0) !== "=") return true;
  var depth = 0, inStr = false;
  for (var i = 1; i < f.length; i++) {
    var ch = f.charAt(i);
    if (inStr) {
      if (ch === '"') { if (f.charAt(i + 1) === '"') i++; else inStr = false; }
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth < 0) return false; }
  }
  return depth === 0 && !inStr;
}
/* Sheets STORES a malformed formula and shows #ERROR! in the cell, so refusing the write
   traded a false green for a false red. Record the cell instead and report #ERROR! from
   the read paths, which is exactly what Sheets does.

   The memo cannot go stale: it is keyed by cell AND by the formula text, and it is only
   honoured while the engine still reports that same formula. Anything that overwrites or
   clears the cell changes the formula, and the entry stops applying by itself. */
var MALFORMED = {};
var anyMalformed = false;
/* Keyed by cell. `wrote` is what the SCRIPT wrote, `stored` is what the engine reports
   after its repair -- the entry is only honoured while the engine still reports `stored`,
   and EVERY formula write to the cell drops the entry first. So an overwrite (valid or
   not), a clear, or a copy all retire it, and it cannot outlive the state it describes. */
function isMalformedCell(sid, a1, formula) {
  var e = anyMalformed && MALFORMED[sid + "|" + a1];
  return e && e.stored === formula ? e : null;
}
Range.prototype.setFormulas = function (fs) {
  this._set("formulas", fs); this._markMalformed(fs); return this;
};
Range.prototype.setFormula = function (f) {
  if (isSingleCell(this._a1)) { this._set("formulas", [[f]]); this._markMalformed([[f]]); return this; }
  var d = this._dims(); var g = fill(d.rows, d.cols, f);
  this._set("formulas", g); this._markMalformed(g); return this;
};
/* ---- display values ----
   getDisplayValue(s) returns the cell AS RENDERED. mog renders it too — its `text`
   property already applies percent, currency, separators and decimals — but two things
   differ, and both live in the LITERAL PREFIX of the format section that applied:
     - the FILL token "*x" (Excel: repeat x until the column is full) renders as a
       SINGLE x in Sheets and as nothing in mog, so _("$"* #,##0.0_) is " $ 522.4 "
       online and " $522.4 " here;
     - mog and Apps Script spell Excel's BUILT-IN formats differently (see
       BUILTIN_FORMAT below) — built-in 37 differs by a leading "_(", i.e. one space.
   Nothing after the first digit/text placeholder can differ this way, so re-render just
   the prefix from both spellings and swap mog's for Apps Script's. If mog's text does
   not actually start with the prefix we computed we misread the format: leave it alone. */
function fmtSections(fmt) {                       /* split on ";" outside quotes/brackets */
  var out = [], cur = "", i = 0;
  while (i < fmt.length) {
    var ch = fmt.charAt(i);
    if (ch === "\\" || ch === "_" || ch === "*") { cur += fmt.substr(i, 2); i += 2; continue; }
    if (ch === '"' || ch === "[") {
      var e = fmt.indexOf(ch === '"' ? '"' : "]", i + 1); e = e < 0 ? fmt.length : e;
      cur += fmt.slice(i, e + 1); i = e + 1; continue;
    }
    if (ch === ";") { out.push(cur); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  out.push(cur); return out;
}
/* Excel's section order is positive;negative;zero;text, with the usual fall-backs. */
function fmtSection(fmt, v) {
  var s = fmtSections(fmt);
  if (typeof v === "string") return s.length > 3 ? s[3] : null;
  if (typeof v !== "number") return null;
  if (v < 0) return s.length > 1 ? s[1] : s[0];
  if (v === 0) return s.length > 2 ? s[2] : s[0];
  return s[0];
}
/* what a section emits before its first placeholder. fill=true renders "*x" as one x. */
function fmtPrefix(section, fill) {
  var out = "", i = 0;
  while (i < section.length) {
    var ch = section.charAt(i);
    if (ch === "0" || ch === "#" || ch === "?" || ch === "@") break;
    if (ch === "_") { out += " "; i += 2; }
    else if (ch === "*") { if (fill) out += section.charAt(i + 1); i += 2; }
    else if (ch === "\\") { out += section.charAt(i + 1); i += 2; }
    else if (ch === '"') { var e = section.indexOf('"', i + 1); e = e < 0 ? section.length : e;
                           out += section.slice(i + 1, e); i = e + 1; }
    else if (ch === "[") { var b = section.indexOf("]", i); i = (b < 0 ? section.length : b + 1); }
    else { out += ch; i++; }
  }
  return out;
}
/* Excel keeps the decimal point when every decimal place is OPTIONAL -- "0.###" renders 1
   as "1." -- and Sheets drops it. mog spells General as "0.###############", so every whole
   number in the book came back with a trailing point: 1,400 of 2,510 divergences, one cause.
   The point is never meaningful, so drop it exactly when the section's decimals are all "#",
   which is the only case Excel can emit a bare one. */
function dropBareDecimalPoint(text, section) {
  if (typeof text !== "string" || text.charAt(text.length - 1) !== ".") return text;
  if (!/\.#*$/.test(String(section || "").replace(/[^0#.?]/g, ""))) return text;
  return text.slice(0, -1);
}
function asDisplayValue(text, rawFormat, value) {
  text = dropBareDecimalPoint(text, rawFormat ? fmtSection(String(rawFormat), value) : null);
  if (typeof text !== "string" || !rawFormat || rawFormat === "General") return text;
  var mog = fmtSection(String(rawFormat), value), gas = fmtSection(asNumberFormat(rawFormat), value);
  if (mog === null || gas === null) return text;
  var pm = fmtPrefix(mog, false), pg = fmtPrefix(gas, true);
  if (pm === pg || text.slice(0, pm.length) !== pm) return text;
  return pg + text.slice(pm.length);
}
Range.prototype.getDisplayValues = function () {
  var props = anyMalformed ? ["text", "values", "numberFormat", "formulas"]
                           : ["text", "values", "numberFormat"];
  var b = this._bind(function (id) { return [{ op: "load", id: id, properties: props }]; });
  var got = GAS.apply(b.ops).loaded[b.id];
  var self = this;
  return this._errorOverlay(got.text.map(function (row, r) {
    return row.map(function (t, c) {
      var f = got.numberFormat && got.numberFormat[r] && got.numberFormat[r][c];
      return asErrorText(asDisplayValue(t, f, got.values[r][c]));
    });
  }), got.formulas);
};
Range.prototype.getDisplayValue = function () { return this.getDisplayValues()[0][0]; };

/* ---- number formats ---- */
/* getNumberFormat reads the engine DIRECTLY. It must never call getNumberFormats(),
   which 36-range-plural.js redefines in terms of getNumberFormat — that pair recursed
   infinitely and made every number-format call throw "Maximum call stack size exceeded".
   Caught only by comparing against real Apps Script; no offline gate exercised it. */
/* Apps Script reports an unformatted cell as "0.###############", never "General"
   (verified against real Apps Script). mog uses Excel's "General". */
var DEFAULT_NUMBER_FORMAT = "0.###############";
/* An .xlsx does not store a pattern for Excel's BUILT-IN numFmt ids (0-49) — it stores the
   id, and every engine substitutes its own spelling. mog's table and Google's disagree, so
   an imported workbook reads back differently on the two sides even though neither engine
   changed anything. Verified cell-by-cell against a real imported Sheet (readparity,
   task_09): each key below is what mog reports for a cell whose numFmtId is the built-in
   noted, each value is what Apps Script reports for the same cell.
     Two consequences worth knowing:
   - This is NOT "Apps Script unquotes single-character literals". It reports whatever is
     stored, verbatim: the same workbook's CUSTOM formats keep their quotes and backslashes
     on both sides (numFmt 174's _("–"_) and 165's 0.0%;\(0.0%\) both match already). A
     blanket unwrap would turn _("–"_) into _(–_) and break 3 probes that pass today.
   - The mapping is by SPELLING, so a script that literally sets mog's spelling of a
     built-in reads back Google's. That ambiguity is unavoidable (mog stores a set format
     verbatim, so the two cases are indistinguishable) and is taken in the direction that
     is real: every benchmark workbook is imported, none sets these by hand. */
var BUILTIN_FORMAT = {
  /* 14 */ "m/d/yyyy": "M/D/YYYY",
  /* 37 */ "#,##0_);(#,##0)": "_(#,##0_);(#,##0)",
  /* 41 */ '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)':
           '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  /* 42 */ '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)':
           '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  /* 43 */ '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)':
           '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  /* 44 */ '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)':
           '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'
};
/* mog REWRITES a format on the way in: setNumberFormat("$#,##0.00") is stored as
   "\"$\"#,##0.00", and "yyyy-mm-dd" as "yyyy\\-mm\\-dd". Apps Script stores verbatim, so a
   set/read round trip returned a different string than the script wrote.

   It cannot be undone by unquoting on read: the benchmark workbooks genuinely CONTAIN
   quoted custom formats (measured -- 102 distinct ones across the 15 init.xlsx, including
   _("$"* #,##0.00_) and yyyy\\-mm\\-dd), and Apps Script reports those verbatim too. The
   stored string alone cannot say which is which.

   So remember the rewrite when it happens. Keyed by SPELLING, not by cell: mog's
   canonicalisation is a pure function of the input, so every cell holding the rewritten
   spelling got it from the same script string. Nothing to invalidate, nothing to go
   stale. A format the script never set is untouched and still reads back verbatim. */
var SET_SPELLING = {};
function rememberSpelling(scriptWrote, engineStored) {
  if (typeof scriptWrote !== "string" || typeof engineStored !== "string") return;
  /* Recorded even when mog stored it UNCHANGED. The two later rules both answer for
     spellings a script can legitimately set -- BUILTIN_FORMAT rewrites "m/d/yyyy" to
     Google's spelling of imported built-in 14, and the ";@" strip removes a text section
     the script wrote on purpose. What the script set wins over both, for the spellings it
     actually set; everything else is untouched. */
  SET_SPELLING[engineStored] = scriptWrote;
}
function asNumberFormat(v) {
  if (v === "General" || v === null || v === undefined) return DEFAULT_NUMBER_FORMAT;
  var s = String(v);
  if (SET_SPELLING.hasOwnProperty(s)) return SET_SPELLING[s];
  if (BUILTIN_FORMAT.hasOwnProperty(s)) return BUILTIN_FORMAT[s];
  /* Apps Script reports a CUSTOM format verbatim: it KEEPS backslash escapes
     ([$-409]mmmm\-yy) AND quoted literals (_("–"_), "OK!") — both verified against a
     real imported workbook. The only transform is dropping a trailing text section (;@).
     (mog re-quotes a bare "$" when a SCRIPT sets one — setNumberFormat("$#,##0.00") reads
     back as "\"$\"#,##0.00" — but that is mog rewriting on the way IN, and undoing it here
     would corrupt the imported formats above, which genuinely carry those quotes.) */
  return s.replace(/;@$/, "");
}
Range.prototype.getNumberFormat = function () {
  var v = this._load("numberFormat");
  return asNumberFormat(Array.isArray(v) ? v[0][0] : v);
};
/* One read-back per format write, so the rewrite is MEASURED rather than predicted --
   the shim does not need to know mog's canonicalisation rules, only that it happened. */
Range.prototype._setNumberFormat = function (grid, wrote) {
  this._set("numberFormat", grid);
  var got = this._load("numberFormat");
  if (Array.isArray(got) && Array.isArray(got[0])) rememberSpelling(wrote, got[0][0]);
  return this;
};
Range.prototype.setNumberFormats = function (fs) {
  return this._setNumberFormat(fs, fs && fs[0] && fs[0][0]);
};
Range.prototype.setNumberFormat = function (f) {
  if (isSingleCell(this._a1)) return this._setNumberFormat([[f]], f);
  var d = this._dims(); return this._setNumberFormat(fill(d.rows, d.cols, f), f);
};

/* ---- geometry ---- */
Range.prototype.getA1Notation = function () { return String(this._load("address")).split("!").pop(); };
Range.prototype.getNumRows = function () { return this._dims().rows; };
Range.prototype.getNumColumns = function () { return this._dims().cols; };
Range.prototype.getRow = function () { return cellRef(this.getA1Notation().split(":")[0]).row; };
Range.prototype.getColumn = function () { return cellRef(this.getA1Notation().split(":")[0]).col; };
Range.prototype.getSheet = function () { return new Sheet(this._sid); };

/* ---- clearing ---- */
Range.prototype._clear = function (applyTo) {
  var b = this._bind(function (id) { return [{ op: "rangeClear", id: id, applyTo: applyTo }]; });
  GAS.apply(b.ops); return this;
};
/* Apps Script leaves the NUMBER FORMAT intact for BOTH clear() and clearFormat(); mog
   wipes it in both. That difference is not cosmetic: a cell cleared offline then given a
   number reads back as a number, while the same cell on Google keeps its date format and
   reads back as a Date. Save and restore the format around either clear. */
Range.prototype._clearKeepingNumberFormat = function (applyTo) {
  var keep = this.getNumberFormats();
  this._clear(applyTo);
  this.setNumberFormats(keep);
  return this;
};
Range.prototype.clear = function () { return this._clearKeepingNumberFormat("All"); };
Range.prototype.clearContent = function () { return this._clear("Contents"); };
Range.prototype.clearFormat = function () { return this._clearKeepingNumberFormat("Formats"); };

/* ---- 35-range-format.js ---- */
/* Range formatting. Apps Script and Excel disagree on representation in several
   places, and each mapping below is deliberate:
     font weight   Apps Script "bold"/"normal"   <-> Excel boolean
     font style    Apps Script "italic"/"normal" <-> Excel boolean
     alignment     Apps Script "left"/"center"   <-> Excel "Left"/"Center"
     wrap          Apps Script boolean           <-> Excel wrapText boolean          */
Range.prototype._fmt = function (kind, property, value, read) {
  var rid = GAS.nid(), fid = GAS.nid();
  var ops = [{ op: "getRange", id: rid, worksheetId: this._sid, address: this._boundedA1() },
             { op: "getRangeFormat", id: fid, rangeId: rid, kind: kind }];
  if (read) { ops.push({ op: "load", id: fid, properties: [property] });
              return GAS.apply(ops).loaded[fid][property]; }
  ops.push({ op: "set", id: fid, property: property, value: value });
  GAS.apply(ops); return this;
};

/* ---- cells a "Center Across Selection" run swallowed ----
   Excel's centerContinuous alignment centres a cell's text across the empty
   centerContinuous cells to its right WITHOUT merging them. Google has no such alignment:
   importing the workbook turns each run into a REAL MERGE anchored at the cell holding the
   text, and Google keeps formatting only on a merge's anchor — so every cell the run
   swallowed reports the DEFAULT format, whatever the .xlsx put there.
   Verified against the real imported Sheet (readparity, task_09): on "Books & GAAP Bridge"
   row 5 every cell B5:L5 carries the same dark-blue bold centred style, and Google reports
   it for B5:G5 and L5 but reports #ffffff / #000000 / normal / "general" for H5:K5 — the
   four EMPTY cells that follow G5's "Actuals". B5:F5 keep it because their part of the run
   has no text to anchor a merge. Same on "Trading Comps" (E5 swallows F5:H5, I6 swallows
   J6:K6) and "Valuation Bridge".
   Only the four getters with online ground truth consult this. Font family and size are
   left alone: Google's defaults there (Arial 10 vs Excel's Calibri 11) are a separate,
   already-accepted divergence, so guessing one would trade a fix for a break. */
Range.prototype._rawHAlign = function () { return this._fmt("format", "horizontalAlignment", null, true); };
function isEmptyValue(v) { return v === "" || v === null || v === undefined; }
/* the seven values a formula can evaluate to instead of a number or a string */
function isErrorValue(v) {
  return typeof v === "string" && /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)$/.test(v); }
Range.prototype._isSpanShadow = function () {
  if (!isSingleCell(this._a1)) return false;                  /* a run is a per-cell notion */
  if (this._rawHAlign() !== "CenterAcrossSelection") return false;
  if (!isEmptyValue(this.getValue())) return false;           /* text anchors its own run */
  var o = cellRef(this._a1);
  for (var c = o.col - 1; c >= 1; c--) {                      /* walk the run leftwards */
    var left = new Range(this._sid, colName(c) + o.row);
    if (left._rawHAlign() !== "CenterAcrossSelection") return false;  /* run ended: no anchor */
    if (!isEmptyValue(left.getValue())) return true;                  /* found the anchor */
  }
  return false;
};

/* ---- font ---- */
Range.prototype.setFontWeight = function (w) { return this._fmt("font", "bold", w === "bold"); };
Range.prototype.getFontWeight = function () {
  if (this._isSpanShadow()) return "normal";
  return this._fmt("font", "bold", null, true) ? "bold" : "normal"; };
Range.prototype.setFontStyle = function (s) { return this._fmt("font", "italic", s === "italic"); };
Range.prototype.getFontStyle = function () { return this._fmt("font", "italic", null, true) ? "italic" : "normal"; };
Range.prototype.setFontSize = function (n) { return this._fmt("font", "size", n); };
Range.prototype.getFontSize = function () { return this._fmt("font", "size", null, true); };
Range.prototype.setFontColor = function (c) {
  var v = normColor(c);
  return this._fmt("font", "color", v === null ? "#000000" : v);   // Apps Script resets to black
};
/* Apps Script returns colours in LOWERCASE hex (#ff0000), mog echoes the case it was
   given. Verified against real Apps Script. */
/* GENERALISATION 2: ONE colour READER for every colour getter, mirroring normColor() on the
   write side. mog can hand back a THEME reference ("theme:dark1") where Apps Script always
   resolves to a hex string -- an agent reading a font colour would get something it cannot
   pass to any setter. Resolve to the Office theme's default palette. */
var THEME_HEX = {
  dark1: "#000000", lt1: "#ffffff", light1: "#ffffff", dark2: "#44546a", lt2: "#e7e6e6",
  light2: "#e7e6e6", accent1: "#4472c4", accent2: "#ed7d31", accent3: "#a5a5a5",
  accent4: "#ffc000", accent5: "#5b9bd5", accent6: "#70ad47",
  hyperlink: "#0563c1", followedhyperlink: "#954f72", text1: "#000000", background1: "#ffffff",
  text2: "#44546a", background2: "#e7e6e6"
};
function asColor(c) {
  if (c === null || c === undefined) return c;
  var v = String(c).toLowerCase();
  if (v.indexOf("theme:") === 0) {
    var name = v.slice(6).replace(/[^a-z0-9]/g, "");
    return THEME_HEX[name] || "#000000";
  }
  return v;
}

/* GENERALISATION 2: ONE normaliser for every colour a member can be handed, used by every
   colour-taking setter, so widening it fixes them all at once. Apps Script accepts more
   spellings than mog does, and each unaccepted one is a false red:
     null / ""        -> CLEAR the colour   (mog: "color cannot be null")
     "#fff"           -> "#ffffff"          (mog: "expected #RGB, #RRGGBB, ...")
     "red", "black"   -> a hex value        (mog rejects names outright)
     "#rrggbbaa"      -> drop the alpha, which mog cannot represent */
var CSS_COLORS = {
  black:"#000000", white:"#ffffff", red:"#ff0000", lime:"#00ff00", green:"#008000",
  blue:"#0000ff", yellow:"#ffff00", cyan:"#00ffff", aqua:"#00ffff", magenta:"#ff00ff",
  fuchsia:"#ff00ff", silver:"#c0c0c0", gray:"#808080", grey:"#808080", maroon:"#800000",
  olive:"#808000", purple:"#800080", teal:"#008080", navy:"#000080", orange:"#ffa500"
};
function normColor(c) {
  if (c === null || c === undefined || c === "") return null;      // null => clear
  var v = String(c).trim().toLowerCase();
  if (CSS_COLORS[v]) return CSS_COLORS[v];
  if (v.charAt(0) !== "#") return v;
  var h = v.slice(1);
  if (h.length === 3) return "#" + h[0]+h[0] + h[1]+h[1] + h[2]+h[2];
  if (h.length === 8) return "#" + h.slice(0, 6);                  // drop alpha
  return v;
}
Range.prototype.getFontColor = function () {
  if (this._isSpanShadow()) return "#000000";
  return asColor(this._fmt("font", "color", null, true)); };
Range.prototype.setFontFamily = function (f) { return this._fmt("font", "name", f); };
Range.prototype.getFontFamily = function () { return this._fmt("font", "name", null, true); };
Range.prototype.setFontLine = function (l) {                       // "underline"|"line-through"|"none"
  this._fmt("font", "underline", l === "underline" ? "Single" : "None");
  return this._fmt("font", "strikethrough", l === "line-through");
};

/* ---- fill ---- */
/* Apps Script's setBackground(null) CLEARS the fill; mog's colour setter rejects null
   outright ("color cannot be null"). Route null to the fill's own clear instead. */
Range.prototype.setBackground = function (c) {
  var v = normColor(c);
  return (v === null) ? this._fmt("fill", "clear", null) : this._fmt("fill", "color", v);
};
Range.prototype.getBackground = function () {
  /* Apps Script always returns a colour String; an unset fill reads as white.
     mog reports null for "no fill". (Documented contract: String.) */
  if (this._isSpanShadow()) return "#ffffff";
  var c = this._fmt("fill", "color", null, true);
  return (c === null || c === undefined || c === "") ? "#ffffff" : asColor(c); };

/* ---- alignment / wrap ---- */
var H_GAS2X = { left: "Left", center: "Center", right: "Right", general: "General" };
var H_X2GAS = { Left: "left", Center: "center", Right: "right", General: "general",
                /* Excel's CenterAcrossSelection has no Apps Script equivalent; Apps Script
                   reports it as plain "center". Verified against a real workbook. */
                CenterAcrossSelection: "center", Fill: "left", Justify: "left",
                Distributed: "center" };
var V_GAS2X = { top: "Top", middle: "Center", bottom: "Bottom" };
var V_X2GAS = { Top: "top", Center: "middle", Bottom: "bottom" };
Range.prototype.setHorizontalAlignment = function (a) { return this._fmt("format", "horizontalAlignment", H_GAS2X[a] || a); };
Range.prototype.getHorizontalAlignment = function () {
  /* Apps Script reports an UNSET alignment as "general-left" (text) or "general-right"
     (numbers) — never bare "general". Verified against a real workbook. */
  var v = this._rawHAlign();
  if (v === "CenterAcrossSelection" && this._isSpanShadow()) return "general";
  if (v === "General" || v === "general" || v === null || v === undefined) {
    /* An EMPTY cell reports bare "general"; text reports "general-left" and numbers
       "general-right". Verified against a real workbook. */
    var val = this.getValue();
    if (isEmptyValue(val)) return "general";
    /* A DATE is a number underneath, so Sheets right-aligns it -- but getValue() hands
       back a Date object, which `typeof === "number"` misses, and every date and datetime
       cell reported general-left instead of general-right. */
    if (typeof val === "number" || val instanceof Date) return "general-right";
    /* Sheets CENTRES a boolean, the same way it centres an error value. */
    if (typeof val === "boolean") return "general-center";
    /* Sheets CENTRES an error value, the way it centres a boolean. Verified against the
       real imported Sheet: the #DIV/0! cells report "general-center". */
    if (isErrorValue(val)) return "general-center";
    return "general-left";
  }
  return H_X2GAS[v] || String(v).toLowerCase();
};
Range.prototype.setVerticalAlignment = function (a) { return this._fmt("format", "verticalAlignment", V_GAS2X[a] || a); };
Range.prototype.getVerticalAlignment = function () { var v = this._fmt("format", "verticalAlignment", null, true); return V_X2GAS[v] || String(v).toLowerCase(); };
Range.prototype.setWrap = function (b) { return this._fmt("format", "wrapText", !!b); };
Range.prototype.getWrap = function () {
  /* Apps Script's getWrap() reflects the wrap STRATEGY: it is true for both WRAP and
     OVERFLOW, false only for CLIP. Excel/mog has no CLIP, so a cell mog reports as
     wrapText=false is OVERFLOW, which Apps Script reports as true. Verified against a
     real workbook and a blank sheet — Google said true in both. */
  return true;
};

/* ---- borders ----
   Apps Script's ONE call fans out to up to 6 Excel border objects.
   null = leave alone, true = draw, false = remove. */
var BORDER_SIDES = ["EdgeTop", "EdgeLeft", "EdgeBottom", "EdgeRight", "InsideVertical", "InsideHorizontal"];
Range.prototype.setBorder = function (top, left, bottom, right, vertical, horizontal, color, style) {
  var want = [top, left, bottom, right, vertical, horizontal];
  var spec = style && style.__excel ? style.__excel : { style: "Continuous", weight: "Thin" };
  var rid = GAS.nid(), cid = GAS.nid();
  var ops = [{ op: "getRange", id: rid, worksheetId: this._sid, address: this._boundedA1() },
             { op: "getRangeBorderCollection", id: cid, rangeId: rid }];
  for (var i = 0; i < want.length; i++) {
    if (want[i] === null || want[i] === undefined) continue;        // untouched
    var bid = GAS.nid();
    ops.push({ op: "getRangeBorder", id: bid, collectionId: cid, index: BORDER_SIDES[i] });
    if (want[i]) {
      ops.push({ op: "set", id: bid, property: "style", value: spec.style });
      ops.push({ op: "set", id: bid, property: "weight", value: spec.weight });
      if (color) { var bc = normColor(color); if (bc) ops.push({ op: "set", id: bid, property: "color", value: bc }); }
    } else {
      ops.push({ op: "set", id: bid, property: "style", value: "None" });
    }
  }
  GAS.apply(ops); return this;
};

/* ---- merging ---- */
Range.prototype.merge = function () {
  GAS.apply(this._bind(function (id) { return [{ op: "rangeMerge", rangeId: id, across: false }]; }).ops);
  return this;
};
Range.prototype.mergeAcross = function () {
  GAS.apply(this._bind(function (id) { return [{ op: "rangeMerge", rangeId: id, across: true }]; }).ops);
  return this;
};

/* ---- 36-range-plural.js ---- */
/* Plural format accessors. Apps Script returns a 2D array with one entry PER CELL,
   while the engine exposes a single value for the whole range (null when mixed).
   We therefore iterate cell-by-cell: slower, but it is what Apps Script returns. */
Range.prototype._eachCell = function (fn) {
  var d = this._dims(), origin = cellRef(this.getA1Notation().split(":")[0]);
  var out = [];
  for (var r = 0; r < d.rows; r++) {
    var row = [];
    for (var c = 0; c < d.cols; c++)
      row.push(fn(new Range(this._sid, colName(origin.col + c) + (origin.row + r))));
    out.push(row);
  }
  return out;
};
Range.prototype._applyCells = function (values, fn) {
  var origin = cellRef(this.getA1Notation().split(":")[0]);
  for (var r = 0; r < values.length; r++)
    for (var c = 0; c < values[r].length; c++)
      fn(new Range(this._sid, colName(origin.col + c) + (origin.row + r)), values[r][c]);
  return this;
};
/* singular name -> plural name, derived from the already-implemented singulars */
[["getFontWeight","getFontWeights","setFontWeight","setFontWeights"],
 ["getFontStyle","getFontStyles","setFontStyle","setFontStyles"],
 ["getFontSize","getFontSizes","setFontSize","setFontSizes"],
 ["getFontColor","getFontColors","setFontColor","setFontColors"],
 ["getFontFamily","getFontFamilies","setFontFamily","setFontFamilies"],
 ["getBackground","getBackgrounds","setBackground","setBackgrounds"],
 ["getHorizontalAlignment","getHorizontalAlignments","setHorizontalAlignment","setHorizontalAlignments"],
 ["getVerticalAlignment","getVerticalAlignments","setVerticalAlignment","setVerticalAlignments"],
 ["getWrap","getWraps","setWrap","setWraps"],
 ["getFontLine","getFontLines","setFontLine","setFontLines"]
].forEach(function (d) {
  var getOne = d[0], getMany = d[1], setOne = d[2], setMany = d[3];
  Range.prototype[getMany] = function () {
    return this._eachCell(function (cell) { return cell[getOne](); }); };
  Range.prototype[setMany] = function (vs) {
    return this._applyCells(vs, function (cell, v) { cell[setOne](v); }); };
});
Range.prototype.getFontLine = function () {
  if (this._fmt("font", "strikethrough", null, true)) return "line-through";
  var u = this._fmt("font", "underline", null, true);
  return (u && u !== "None") ? "underline" : "none";
};
Range.prototype.setBackgroundRGB = function (r, g, b) {
  return this.setBackground("#" + [r, g, b].map(function (n) {
    return ("0" + Number(n).toString(16)).slice(-2); }).join("")); };
Range.prototype.getBackgroundObject = function () {
  var c = this.getBackground(); return c ? new Color(ColorType.RGB, new RgbColor(c)) : null; };
Range.prototype.setBackgroundObject = function (c) {
  return this.setBackground(c && c.asRgbColor ? c.asRgbColor().asHexString() : c); };
/* Font Color objects retain theme identity; the string getter resolves to RGB. */
Range.prototype.getFontColorObject = function () {
  if(this._isSpanShadow())return new Color(ColorType.RGB,new RgbColor("#000000"));
  var raw=this._fmt("font","color",null,true),m=/^theme:(.*)$/i.exec(String(raw));
  if(m){var name=m[1].toUpperCase(),aliases={DARK1:"TEXT",TEXT1:"TEXT",LIGHT1:"BACKGROUND",LT1:"BACKGROUND",BACKGROUND1:"BACKGROUND"};name=aliases[name]||name;
    if(ThemeColorType[name])return new Color(ColorType.THEME,new ThemeColorValue(ThemeColorType[name]));}
  return new Color(ColorType.RGB,new RgbColor(asColor(raw)||"#000000"));
};
Range.prototype.setFontColorObject = function (c) {
  if(c && c.getColorType && c.getColorType()===ColorType.THEME){var n=String(c.asThemeColor().getThemeColorType()).toLowerCase();
    return this._fmt("font","color","theme:"+({text:"dark1",background:"light1"}[n]||n));}
  return this.setFontColor(c && c.asRgbColor ? c.asRgbColor().asHexString() : c);
};
Range.prototype.getBackgroundObjects = function () {
  return this._eachCell(function (c) { return c.getBackgroundObject(); }); };
Range.prototype.getFontColorObjects = function () {
  return this._eachCell(function (c) { return c.getFontColorObject(); }); };
Range.prototype.setBackgroundObjects = function (vs) {
  return this._applyCells(vs, function (c, v) { c.setBackgroundObject(v); }); };
Range.prototype.setFontColorObjects = function (vs) {
  return this._applyCells(vs, function (c, v) { c.setFontColorObject(v); }); };
Range.prototype.getNumberFormats = function () {
  return this._eachCell(function (c) { return c.getNumberFormat(); }); };   /* already normalised */

/* Bulk plural formatting reads, preserving the existing singular getter semantics.
   Review snapshots call several getters on the SAME Range. Fetch the raw font and
   alignment fields once per range/revision, then let singular getters interpret them.
   This avoids hundreds of thousands of interpreter/engine crossings on large sheets. */
Range.prototype._formatSnapshot = function () {
  var version=GAS.revision();
  if(this._formatCache && this._formatCache.version===version)return this._formatCache;
  var origin=cellRef(this._boundedA1().split(":")[0]),d=this._dims(),sid=this._sid;
  var b=this._bind(function(id){return [{op:"load",id:id,properties:["values","numberFormat"]}];});
  var values=GAS.apply(b.ops).loaded[b.id];
  /* Formats are read by recursive subdivision, not cell by cell. mog answers a multi-cell
     getRangeFormat the way Excel does: a property uniform across the range comes back with
     its value, a property that varies comes back null. An unformatted range returns the
     DEFAULT ("#000000", "Calibri", 11), never null -- verified directly -- so null means
     "mixed" and nothing else. A non-null answer therefore states that every cell in the
     rectangle holds that value, which makes this exactly equivalent to asking each cell,
     while a uniformly formatted region costs one query instead of one per cell.
     The old per-cell walk cost 5 ops per cell and made task_03's baseline capture 286s. */
  var FONT=["bold","italic","size","name","color","underline","strikethrough"],
      FMT=["horizontalAlignment","verticalAlignment"];
  var cells=new Array(d.rows*d.cols);
  for(var i=0;i<cells.length;i++)cells[i]={font:{},format:{}};
  function assign(blk,kind,prop,val){
    for(var r=blk.r;r<blk.r+blk.rows;r++)for(var c=blk.c;c<blk.c+blk.cols;c++)
      cells[r*d.cols+c][kind][prop]=val;
  }
  var queue=[{r:0,c:0,rows:d.rows,cols:d.cols,font:FONT.slice(),format:FMT.slice()}];
  while(queue.length){
    var level=queue,next=[];
    /* Cap ops per round-trip; each block costs at most five. */
    for(var s=0;s<level.length;s+=400){
      var slice=level.slice(s,s+400),ops=[],meta=[];
      slice.forEach(function(blk){
        var rid=GAS.nid(),fid=GAS.nid(),gid=GAS.nid();
        var a1=colName(origin.col+blk.c)+(origin.row+blk.r)+":"+
               colName(origin.col+blk.c+blk.cols-1)+(origin.row+blk.r+blk.rows-1);
        ops.push({op:"getRange",id:rid,worksheetId:sid,address:a1});
        if(blk.font.length)ops.push({op:"getRangeFormat",id:fid,rangeId:rid,kind:"font"},
          {op:"load",id:fid,properties:blk.font});
        if(blk.format.length)ops.push({op:"getRangeFormat",id:gid,rangeId:rid,kind:"format"},
          {op:"load",id:gid,properties:blk.format});
        meta.push({blk:blk,fid:fid,gid:gid});
      });
      var loaded=GAS.apply(ops).loaded;
      meta.forEach(function(m){
        var blk=m.blk,single=blk.rows===1 && blk.cols===1,restF=[],restG=[];
        blk.font.forEach(function(p){
          var v=(loaded[m.fid]||{})[p];
          /* A single cell is definitive even when the answer is null. */
          if(v!==null || single)assign(blk,"font",p,v===undefined?null:v);else restF.push(p);
        });
        blk.format.forEach(function(p){
          var v=(loaded[m.gid]||{})[p];
          if(v!==null || single)assign(blk,"format",p,v===undefined?null:v);else restG.push(p);
        });
        if(!restF.length && !restG.length)return;
        /* Split the longer side so blocks stay compact. */
        if(blk.rows>=blk.cols){
          var h=Math.floor(blk.rows/2);
          next.push({r:blk.r,c:blk.c,rows:h,cols:blk.cols,font:restF,format:restG});
          next.push({r:blk.r+h,c:blk.c,rows:blk.rows-h,cols:blk.cols,font:restF,format:restG});
        }else{
          var w=Math.floor(blk.cols/2);
          next.push({r:blk.r,c:blk.c,rows:blk.rows,cols:w,font:restF,format:restG});
          next.push({r:blk.r,c:blk.c+w,rows:blk.rows,cols:blk.cols-w,font:restF,format:restG});
        }
      });
    }
    queue=next;
  }
  this._formatCache={version:version,rows:d.rows,cols:d.cols,origin:origin,cells:cells,values:datify(values.values,values.numberFormat)};
  return this._formatCache;
};
Range.prototype._eachFormatCell = function (getter) {
  var cache=this._formatSnapshot(),out=[];
  for(var r=0;r<cache.rows;r++){
    var row=[];
    for(var c=0;c<cache.cols;c++){
      var cell=new Range(this._sid,colName(cache.origin.col+c)+(cache.origin.row+r));
      (function(cell,fields,value){
        cell._fmt=function(kind,property,ignored,read){
          if(read && fields[kind] && Object.prototype.hasOwnProperty.call(fields[kind],property))return fields[kind][property];
          return Range.prototype._fmt.apply(this,arguments);
        };
        cell.getValue=function(){return value;};
      })(cell,cache.cells[r*cache.cols+c],cache.values[r][c]);
      row.push(cell[getter]());
    }
    out.push(row);
  }
  return out;
};
[["getFontWeights","getFontWeight"],["getFontStyles","getFontStyle"],
 ["getFontSizes","getFontSize"],["getFontFamilies","getFontFamily"],
 ["getFontColors","getFontColor"],["getFontColorObjects","getFontColorObject"],
 ["getFontLines","getFontLine"],["getHorizontalAlignments","getHorizontalAlignment"],
 ["getVerticalAlignments","getVerticalAlignment"],["getWraps","getWrap"]].forEach(function(pair){
  Range.prototype[pair[0]]=function(){return this._eachFormatCell(pair[1]);};
});
Range.prototype.getNumberFormats=function(){return this._load("numberFormat").map(function(row){return row.map(asNumberFormat);});};

/* ---- 37-range-ops.js ---- */
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

/* ---- 38-range-rest.js ---- */
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

/* ---- 39-range-final.js ---- */
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

/* ---- 40-sheet.js ---- */
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

/* ---- 41-sheet-ops.js ---- */
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

/* ---- 42-sheet-rest.js ---- */
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

/* ---- 43-sheet-freeze.js ---- */
/* Frozen rows/columns. mog reports the frozen area as an address range
   ("Sheet1!1:2" = two frozen rows, "Sheet1!A:B" = two frozen columns). */
Sheet.prototype._freezeLocation = function () {
  var id = GAS.nid();
  try {
    var r = GAS.apply([{ op: "freezeLocation", id: id, worksheetId: this._id, nullable: true },
                       { op: "load", id: id, properties: ["address"] }]);
    var info = r.loaded[id];
    return (!info || info.isNullObject || !info.address) ? null : String(info.address).split("!").pop();
  } catch (e) {
    return null;                 // nothing frozen: the location is a null object
  }
};
/* The frozen area comes back in one of three forms:
     "1:2"    -> 2 frozen rows, no frozen columns
     "A:C"    -> 3 frozen columns, no frozen rows
     "A1:C2"  -> both (3 columns, 2 rows)                        */
function parseFrozen(a) {
  if (!a) return { rows: 0, cols: 0 };
  var end = a.split(":").pop();
  var m = /^\$?([A-Z]*)\$?(\d*)$/.exec(end);
  if (!m) return { rows: 0, cols: 0 };
  var cols = 0;
  for (var i = 0; i < m[1].length; i++) cols = cols * 26 + (m[1].charCodeAt(i) - 64);
  return { rows: m[2] ? Number(m[2]) : 0, cols: cols };
}
Sheet.prototype.getFrozenRows = function () { return parseFrozen(this._freezeLocation()).rows; };
Sheet.prototype.getFrozenColumns = function () { return parseFrozen(this._freezeLocation()).cols; };

/* ThemeColor value object (getColorType / getThemeColorType) */
function ThemeColor(t) { this._t = t; }
ThemeColor.prototype.getColorType = function () { return ColorType.THEME; };
ThemeColor.prototype.getThemeColorType = function () { return this._t; };

/* ---- 50-spreadsheet.js ---- */
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

/* ---- 51-spreadsheet-ops.js ---- */
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

/* ---- 52-namedranges.js ---- */
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

/* ---- 60-values.js ---- */
/* Colour and text-style value objects. Pure JS — no engine involved, so these
   match Apps Script exactly by construction. */
function RgbColor(hex) { this._hex = normaliseHex(hex); }
function normaliseHex(h) {
  /* Apps Script's RgbColor.asHexString() returns SIX-digit hex — verified against real
     Apps Script (SHAPES channel, case color.hex: Google "#3366cc", not "#ff3366cc"). */
  var s = String(h || "#000000").replace("#", "");
  if (s.length === 3) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
  if (s.length === 8) s = s.slice(2);                     // drop any alpha prefix
  return "#" + s.toLowerCase();
}
RgbColor.prototype.asHexString = function () { return this._hex; };
RgbColor.prototype.getRed = function () { return parseInt(this._hex.substr(1, 2), 16); };
RgbColor.prototype.getGreen = function () { return parseInt(this._hex.substr(3, 2), 16); };
RgbColor.prototype.getBlue = function () { return parseInt(this._hex.substr(5, 2), 16); };
RgbColor.prototype.getColorType = function () { return ColorType.RGB; };

function ThemeColorValue(t) { this._t = t; }
ThemeColorValue.prototype.getColorType = function () { return ColorType.THEME; };
ThemeColorValue.prototype.getThemeColorType = function () { return this._t; };
var ThemeColor = ThemeColorValue;      // the surface calls this class ThemeColor

function Color(kind, value) { this._kind = kind; this._value = value; }
Color.prototype.getColorType = function () { return this._kind; };
Color.prototype.asRgbColor = function () {
  if (this._kind !== ColorType.RGB) throw GAS.error("Object is not of type RgbColor.");
  return this._value;
};
Color.prototype.asThemeColor = function () {
  if (this._kind !== ColorType.THEME) throw GAS.error("Object is not of type ThemeColor.");
  return this._value;
};

function ColorBuilder() { this._kind = null; this._value = null; }
ColorBuilder.prototype.setRgbColor = function (hex) { this._kind = ColorType.RGB; this._value = new RgbColor(hex); return this; };
ColorBuilder.prototype.setThemeColor = function (t) { this._kind = ColorType.THEME; this._value = new ThemeColorValue(t); return this; };
ColorBuilder.prototype.getColorType = function () { return this._kind || ColorType.UNSUPPORTED; };
ColorBuilder.prototype.asRgbColor = function () { return Color.prototype.asRgbColor.call(this); };
ColorBuilder.prototype.asThemeColor = function () { return Color.prototype.asThemeColor.call(this); };
ColorBuilder.prototype.build = function () { return new Color(this._kind, this._value); };

function TextStyle(s) { this._s = s || {}; }
TextStyle.prototype.getFontFamily = function () { return this._s.family === undefined ? null : this._s.family; };
TextStyle.prototype.getFontSize = function () { return this._s.size === undefined ? null : this._s.size; };
TextStyle.prototype.getForegroundColor = function () { return this._s.color === undefined ? null : this._s.color; };
TextStyle.prototype.getForegroundColorObject = function () { return this._s.colorObj === undefined ? null : this._s.colorObj; };
TextStyle.prototype.isBold = function () { return this._s.bold === undefined ? null : this._s.bold; };
TextStyle.prototype.isItalic = function () { return this._s.italic === undefined ? null : this._s.italic; };
TextStyle.prototype.isUnderline = function () { return this._s.underline === undefined ? null : this._s.underline; };
TextStyle.prototype.isStrikethrough = function () { return this._s.strikethrough === undefined ? null : this._s.strikethrough; };
TextStyle.prototype.copy = function () { var b = new TextStyleBuilder(); b._s = JSON.parse(JSON.stringify(this._s)); return b; };

function TextStyleBuilder() { this._s = {}; }
TextStyleBuilder.prototype.setBold = function (v) { this._s.bold = v; return this; };
TextStyleBuilder.prototype.setItalic = function (v) { this._s.italic = v; return this; };
TextStyleBuilder.prototype.setUnderline = function (v) { this._s.underline = v; return this; };
TextStyleBuilder.prototype.setStrikethrough = function (v) { this._s.strikethrough = v; return this; };
TextStyleBuilder.prototype.setFontFamily = function (v) { this._s.family = v; return this; };
TextStyleBuilder.prototype.setFontSize = function (v) { this._s.size = v; return this; };
TextStyleBuilder.prototype.setForegroundColor = function (v) { this._s.color = v; return this; };
TextStyleBuilder.prototype.setForegroundColorObject = function (v) { this._s.colorObj = v; return this; };
TextStyleBuilder.prototype.build = function () { return new TextStyle(this._s); };

/* Apps Script returns opaque host objects: String(color) is "Color", ctor is Object. */
Color.prototype.toString = function () { return "Color"; };
Color.prototype.constructor = Object;
TextStyle.prototype.toString = function () { return "TextStyle"; };
TextStyle.prototype.constructor = Object;

/* ---- 65-datavalidation.js ---- */
/* Data validation. The builder is pure state; applying it to a Range is the only
   part that touches the engine. Criteria identity follows DataValidationCriteria. */
function DataValidation(state) { this._s = state || {}; }
DataValidation.prototype.getCriteriaType = function () { return this._s.criteria || null; };
DataValidation.prototype.getCriteriaValues = function () { return (this._s.args || []).slice(); };
DataValidation.prototype.getHelpText = function () { return this._s.helpText === undefined ? null : this._s.helpText; };
DataValidation.prototype.getAllowInvalid = function () { return this._s.allowInvalid !== false; };
DataValidation.prototype.copy = function () { var b = new DataValidationBuilder(); b._s = JSON.parse(JSON.stringify(this._s)); b._s.criteria = this._s.criteria; return b; };

function DataValidationBuilder() { this._s = { allowInvalid: true, args: [] }; }
/* Apps Script names an array argument by its ELEMENT type in signature errors:
   [3] is number[], ["a"] is String[], anything mixed or empty is Object[]. */
function jsArrayType(a) {
  if (!a || !a.length) return "Object[]";
  var t = typeof a[0];
  for (var i = 1; i < a.length; i++) if (typeof a[i] !== t) return "Object[]";
  return t === "number" ? "number[]" : t === "string" ? "String[]"
       : t === "boolean" ? "Boolean[]" : "Object[]";
}
DataValidationBuilder.prototype.withCriteria = function (criteria, args) {
  GAS.needArgs("DataValidationBuilder", "withCriteria", arguments, 2);
  /* The criteria must come from DataValidationCriteria. Passing a BooleanCriteria (the
     conditional-formatting family) is rejected by Apps Script with a signature error;
     accepting it silently built a validation rule that means nothing. */
  if (!criteria || criteria.__enum !== "DataValidationCriteria") {
    throw GAS.error("The parameters (" +
      (criteria && criteria.__enum ? "SpreadsheetApp." + criteria.__enum : typeof criteria) +
      "," + jsArrayType(args) + ") don't match the method signature for " +
      "SpreadsheetApp.DataValidationBuilder.withCriteria.");
  }
  this._s.criteria = criteria; this._s.args = (args || []).slice(); return this;
};
DataValidationBuilder.prototype.setAllowInvalid = function (v) { this._s.allowInvalid = !!v; return this; };
DataValidationBuilder.prototype.setHelpText = function (t) { this._s.helpText = t; return this; };
DataValidationBuilder.prototype.build = function () { return new DataValidation(this._s); };
DataValidationBuilder.prototype.copy = function () { return this.build().copy(); };
DataValidationBuilder.prototype.getCriteriaType = function () { return this._s.criteria || null; };
DataValidationBuilder.prototype.getCriteriaValues = function () { return this._s.args.slice(); };
DataValidationBuilder.prototype.getHelpText = function () { return this._s.helpText === undefined ? null : this._s.helpText; };
DataValidationBuilder.prototype.getAllowInvalid = function () { return this._s.allowInvalid !== false; };

/* All require* helpers are the same shape: fix a criterion, capture the args.
   Declaring them as data keeps each one honest and makes omissions obvious. */
[["requireNumberBetween","NUMBER_BETWEEN",2],["requireNumberNotBetween","NUMBER_NOT_BETWEEN",2],
 ["requireNumberEqualTo","NUMBER_EQUAL_TO",1],["requireNumberNotEqualTo","NUMBER_NOT_EQUAL_TO",1],
 ["requireNumberGreaterThan","NUMBER_GREATER_THAN",1],["requireNumberGreaterThanOrEqualTo","NUMBER_GREATER_THAN_OR_EQUAL_TO",1],
 ["requireNumberLessThan","NUMBER_LESS_THAN",1],["requireNumberLessThanOrEqualTo","NUMBER_LESS_THAN_OR_EQUAL_TO",1],
 ["requireTextContains","TEXT_CONTAINS",1],["requireTextDoesNotContain","TEXT_DOES_NOT_CONTAIN",1],
 ["requireTextEqualTo","TEXT_EQUAL_TO",1],["requireTextIsEmail","TEXT_IS_VALID_EMAIL",0],
 ["requireTextIsUrl","TEXT_IS_VALID_URL",0],["requireDate","DATE_IS_VALID_DATE",0],
 ["requireDateAfter","DATE_AFTER",1],["requireDateBefore","DATE_BEFORE",1],
 ["requireDateBetween","DATE_BETWEEN",2],["requireDateNotBetween","DATE_NOT_BETWEEN",2],
 ["requireDateEqualTo","DATE_EQUAL_TO",1],["requireDateOnOrAfter","DATE_ON_OR_AFTER",1],
 ["requireDateOnOrBefore","DATE_ON_OR_BEFORE",1],["requireFormulaSatisfied","CUSTOM_FORMULA",1],
 ["requireValueInList","VALUE_IN_LIST",2],["requireValueInRange","VALUE_IN_RANGE",2]
].forEach(function (d) {
  DataValidationBuilder.prototype[d[0]] = function () {
    return this.withCriteria(DataValidationCriteria[d[1]], Array.prototype.slice.call(arguments, 0, Math.max(d[2], arguments.length)));
  };
});

/* ---- 66-conditionalformat.js ---- */
/* Conditional formatting. Builder is pure state; only applying to a sheet touches
   the engine. NOTE: mog cannot CREATE ConditionalFormatType.Custom (type="expression"),
   so whenFormulaSatisfied builds fine but applying it throws loudly rather than
   silently producing the wrong rule type. See PLAN J1. */
function BooleanCondition(s) { this._s = s || {}; }
BooleanCondition.prototype.getCriteriaType = function () { return this._s.criteria || null; };
BooleanCondition.prototype.getCriteriaValues = function () { return (this._s.args || []).slice(); };
BooleanCondition.prototype.getBackground = function () { return this._s.background === undefined ? null : this._s.background; };
BooleanCondition.prototype.getBackgroundObject = function () { return this._s.backgroundObj === undefined ? null : this._s.backgroundObj; };
BooleanCondition.prototype.getFontColor = function () { return this._s.fontColor === undefined ? null : this._s.fontColor; };
BooleanCondition.prototype.getFontColorObject = function () { return this._s.fontColorObj === undefined ? null : this._s.fontColorObj; };
BooleanCondition.prototype.getBold = function () { return this._s.bold === undefined ? null : this._s.bold; };
BooleanCondition.prototype.getItalic = function () { return this._s.italic === undefined ? null : this._s.italic; };
BooleanCondition.prototype.getUnderline = function () { return this._s.underline === undefined ? null : this._s.underline; };
BooleanCondition.prototype.getStrikethrough = function () { return this._s.strikethrough === undefined ? null : this._s.strikethrough; };

function GradientCondition(s) { this._s = s || {}; }
["Min", "Mid", "Max"].forEach(function (p) {
  var k = p.toLowerCase();
  GradientCondition.prototype["get" + p + "Color"] = function () { return this._s[k + "Color"] === undefined ? "" : this._s[k + "Color"]; };
  GradientCondition.prototype["get" + p + "ColorObject"] = function () { return this._s[k + "ColorObj"] === undefined ? null : this._s[k + "ColorObj"]; };
  GradientCondition.prototype["get" + p + "Type"] = function () { return this._s[k + "Type"] === undefined ? null : this._s[k + "Type"]; };
  GradientCondition.prototype["get" + p + "Value"] = function () { return this._s[k + "Value"] === undefined ? "" : this._s[k + "Value"]; };
});

function ConditionalFormatRule(s) { this._s = s || {}; }
ConditionalFormatRule.prototype.getRanges = function () { return (this._s.ranges || []).slice(); };
ConditionalFormatRule.prototype.getBooleanCondition = function () {
  return this._s.criteria ? new BooleanCondition(this._s) : null; };
/* Any gradient field makes this a gradient rule -- setGradientMinpoint() alone is enough,
   and it does NOT set a type. Gating on minType/maxType returned null there, so every
   GradientCondition getter died with "cannot read property of null". */
var GRADIENT_KEYS = ["minColor","midColor","maxColor","minColorObj","midColorObj",
                     "maxColorObj","minType","midType","maxType","minValue","midValue","maxValue"];
ConditionalFormatRule.prototype.getGradientCondition = function () {
  for (var i = 0; i < GRADIENT_KEYS.length; i++)
    if (this._s[GRADIENT_KEYS[i]] !== undefined) return new GradientCondition(this._s);
  return null;
};
ConditionalFormatRule.prototype.copy = function () {
  var b = new ConditionalFormatRuleBuilder(); b._s = JSON.parse(JSON.stringify(this._s));
  b._s.criteria = this._s.criteria; b._s.ranges = (this._s.ranges || []).slice(); return b; };

function ConditionalFormatRuleBuilder() { this._s = { args: [], ranges: [] }; }
ConditionalFormatRuleBuilder.prototype.build = function () {
  /* Apps Script validates at build() — verified against real Apps Script (SHAPES channel):
     building without ranges throws "Ranges must have at least one range." */
  if (!this._s.ranges || !this._s.ranges.length)
    throw GAS.error("Ranges must have at least one range.");
  return new ConditionalFormatRule(this._s);
};
/* copy() must work on a builder that has no ranges yet -- build() demands at least one,
   so clone the state directly instead of round-tripping through a rule. */
ConditionalFormatRuleBuilder.prototype.copy = function () {
  var b = new ConditionalFormatRuleBuilder();
  for (var k in this._s) if (Object.prototype.hasOwnProperty.call(this._s, k)) b._s[k] = this._s[k];
  return b;
};
ConditionalFormatRuleBuilder.prototype.withCriteria = function (c, args) { this._s.criteria = c; this._s.args = (args || []).slice(); return this; };
ConditionalFormatRuleBuilder.prototype.setRanges = function (rs) { this._s.ranges = (rs || []).slice(); return this; };
ConditionalFormatRuleBuilder.prototype.getRanges = function () { return this._s.ranges.slice(); };
ConditionalFormatRuleBuilder.prototype.getBooleanCondition = function () { return ConditionalFormatRule.prototype.getBooleanCondition.call(this); };
ConditionalFormatRuleBuilder.prototype.getGradientCondition = function () { return ConditionalFormatRule.prototype.getGradientCondition.call(this); };
/* Apps Script keeps the string and object forms of a colour in sync: setBackground("#f00")
   makes getBackgroundObject() return a Color, and setBackgroundObject() makes
   getBackground() return the hex. Mirror each write into its partner. */
[["setBackground","background"],["setBackgroundObject","backgroundObj"],["setFontColor","fontColor"],
 ["setFontColorObject","fontColorObj"],["setBold","bold"],["setItalic","italic"],
 ["setUnderline","underline"],["setStrikethrough","strikethrough"]
].forEach(function (d) {
  ConditionalFormatRuleBuilder.prototype[d[0]] = function (v) {
    this._s[d[1]] = v;
    /* keep the string/object pair in sync, as Apps Script does */
    if (d[1] === "background" || d[1] === "fontColor") {
      this._s[d[1] + "Obj"] = (v == null) ? v : SpreadsheetApp.newColor().setRgbColor(v).build();
    } else if (d[1] === "backgroundObj" || d[1] === "fontColorObj") {
      var base = d[1].replace("Obj", "");
      if (v && v.asRgbColor) { try { this._s[base] = v.asRgbColor().asHexString(); } catch (e) {} }
    }
    return this;
  };
});
[["whenNumberBetween","NUMBER_BETWEEN"],["whenNumberNotBetween","NUMBER_NOT_BETWEEN"],
 ["whenNumberEqualTo","NUMBER_EQUAL_TO"],["whenNumberNotEqualTo","NUMBER_NOT_EQUAL_TO"],
 ["whenNumberGreaterThan","NUMBER_GREATER_THAN"],["whenNumberGreaterThanOrEqualTo","NUMBER_GREATER_THAN_OR_EQUAL_TO"],
 ["whenNumberLessThan","NUMBER_LESS_THAN"],["whenNumberLessThanOrEqualTo","NUMBER_LESS_THAN_OR_EQUAL_TO"],
 ["whenTextContains","TEXT_CONTAINS"],["whenTextDoesNotContain","TEXT_DOES_NOT_CONTAIN"],
 ["whenTextEqualTo","TEXT_EQUAL_TO"],["whenTextStartsWith","TEXT_STARTS_WITH"],
 ["whenTextEndsWith","TEXT_ENDS_WITH"],["whenCellEmpty","CELL_EMPTY"],["whenCellNotEmpty","CELL_NOT_EMPTY"],
 ["whenDateAfter","DATE_AFTER"],["whenDateBefore","DATE_BEFORE"],["whenDateEqualTo","DATE_EQUAL_TO"],
 ["whenFormulaSatisfied","CUSTOM_FORMULA"]
].forEach(function (d) {
  ConditionalFormatRuleBuilder.prototype[d[0]] = function () {
    return this.withCriteria(BooleanCriteria[d[1]], Array.prototype.slice.call(arguments));
  };
});
/* Setting a min/max point without a value implies the MIN/MAX interpolation type, and the
   colour is readable both as a string and as a Color object -- both verified against real
   Apps Script. The string and object setters therefore populate each other. */
[["setGradientMinpoint","min","MIN"],["setGradientMaxpoint","max","MAX"]].forEach(function (d) {
  ConditionalFormatRuleBuilder.prototype[d[0]] = function (c) {
    this._s[d[1] + "Color"] = c;
    this._s[d[1] + "ColorObj"] = SpreadsheetApp.newColor().setRgbColor(c).build();
    if (this._s[d[1] + "Type"] === undefined) this._s[d[1] + "Type"] = InterpolationType[d[2]];
    return this;
  };
  ConditionalFormatRuleBuilder.prototype[d[0] + "Object"] = function (c) {
    this._s[d[1] + "ColorObj"] = c;
    if (c && c.asRgbColor) { try { this._s[d[1] + "Color"] = c.asRgbColor().asHexString(); } catch (e) {} }
    if (this._s[d[1] + "Type"] === undefined) this._s[d[1] + "Type"] = InterpolationType[d[2]];
    return this;
  };
});
[["setGradientMinpointWithValue","min"],["setGradientMidpointWithValue","mid"],["setGradientMaxpointWithValue","max"]
].forEach(function (d) {
  ConditionalFormatRuleBuilder.prototype[d[0]] = function (c, t, v) {
    this._s[d[1] + "Color"] = c; this._s[d[1] + "Type"] = t; this._s[d[1] + "Value"] = v; return this; };
  ConditionalFormatRuleBuilder.prototype[d[0].replace("WithValue", "ObjectWithValue")] = function (c, t, v) {
    this._s[d[1] + "ColorObj"] = c; this._s[d[1] + "Type"] = t; this._s[d[1] + "Value"] = v; return this; };
});

/* ---- 70-rangelist.js ---- */
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

/* ---- 71-textfinder.js ---- */
/* TextFinder. mog exposes `find`/`replaceAll` but no findAll, so findAll is built
   by iterating find. Apps Script regex is RE2; JS RegExp is not RE2, so patterns
   using constructs outside the intersection THROW rather than silently differing. */
function TextFinder(sheetId, a1, text) {
  this._sid = sheetId; this._a1 = a1; this._text = text;
  this._opts = { matchCase: false, entireCell: false, regex: false, formulaText: false, diacritics: true };
  this._cursor = null;
}
Sheet.prototype.createTextFinder = function (text) { return new TextFinder(this._id, null, text); };
Range.prototype.createTextFinder = function (text) { return new TextFinder(this._sid, this._a1, text); };

["matchCase:matchCase", "matchEntireCell:entireCell", "useRegularExpression:regex",
 "matchFormulaText:formulaText", "ignoreDiacritics:diacritics"].forEach(function (d) {
  var parts = d.split(":");
  TextFinder.prototype[parts[0]] = function (v) {
    GAS.needArgs("TextFinder", parts[0], arguments, 1);
    this._opts[parts[1]] = !!v; return this;
  };
});
TextFinder.prototype.startFrom = function (range) {
  GAS.needArgs("TextFinder", "startFrom", arguments, 1);
  this._cursor = range.getA1Notation(); return this;
};
TextFinder.prototype.getCurrentMatch = function () { return this._cursor ? new Range(this._sid, this._cursor) : null; };

var RE2_UNSUPPORTED = /\(\?<|\\\d|\(\?=|\(\?!/;      // lookbehind, backrefs, lookahead
TextFinder.prototype._scan = function () {
  if (this._opts.regex && RE2_UNSUPPORTED.test(this._text))
    throw new Error("NotImplemented: pattern uses a construct outside the RE2 n JS RegExp intersection: " + this._text);
  var sheet = new Sheet(this._sid);
  var area = this._a1 ? new Range(this._sid, this._a1) : sheet.getDataRange();
  var values = this._opts.formulaText ? area.getFormulas() : area.getValues();
  var origin = cellRef(area.getA1Notation().split(":")[0]);
  var needle = this._opts.matchCase ? this._text : String(this._text).toLowerCase();
  var re = this._opts.regex ? new RegExp(this._text, this._opts.matchCase ? "" : "i") : null;
  var hits = [];
  for (var r = 0; r < values.length; r++) for (var c = 0; c < values[r].length; c++) {
    var cell = values[r][c]; if (cell === "" || cell === null) continue;
    var hay = String(cell); if (!this._opts.matchCase) hay = hay.toLowerCase();
    var hit = re ? re.test(String(cell))
                 : (this._opts.entireCell ? hay === needle : hay.indexOf(needle) >= 0);
    if (hit) hits.push(new Range(this._sid, colName(origin.col + c) + (origin.row + r)));
  }
  return hits;
};
TextFinder.prototype.findAll = function () { return this._scan(); };
TextFinder.prototype.findNext = function () {
  var hits = this._scan(); if (!hits.length) return null;
  if (!this._cursor) { this._cursor = hits[0].getA1Notation(); return hits[0]; }
  for (var i = 0; i < hits.length; i++)
    if (hits[i].getA1Notation() === this._cursor && i + 1 < hits.length) {
      this._cursor = hits[i + 1].getA1Notation(); return hits[i + 1]; }
  return null;
};
TextFinder.prototype.findPrevious = function () {
  var hits = this._scan(); if (!hits.length) return null;
  if (!this._cursor) { this._cursor = hits[hits.length - 1].getA1Notation(); return hits[hits.length - 1]; }
  for (var i = 0; i < hits.length; i++)
    if (hits[i].getA1Notation() === this._cursor && i > 0) {
      this._cursor = hits[i - 1].getA1Notation(); return hits[i - 1]; }
  return null;
};
TextFinder.prototype.replaceAllWith = function (replacement) {
  var hits = this._scan(), self = this, n = 0;
  hits.forEach(function (cell) {
    var v = self._opts.formulaText ? cell.getFormula() : cell.getValue();
    var out = self._opts.regex
      ? String(v).replace(new RegExp(self._text, self._opts.matchCase ? "g" : "gi"), replacement)
      : (self._opts.entireCell ? replacement : String(v).split(self._text).join(replacement));
    if (self._opts.formulaText) cell.setFormula(out); else cell.setValue(out);
    n++;
  });
  return n;
};
TextFinder.prototype.replaceWith = function (replacement) {
  GAS.needArgs("TextFinder", "replaceWith", arguments, 1);
  var hit = this.findNext(); if (!hit) return 0;
  hit.setValue(replacement); return 1;
};

/* ---- 90-spine.js ---- */
/* GENERATED by gen-surface.mjs — the loud-failure spine.
   Every KEPT member that has no implementation becomes a thrower, so an unbuilt
   member fails visibly instead of silently returning undefined (a false green). */
var GAS_SURFACE = {
 "BooleanCondition": [
  "getBackground",
  "getBackgroundObject",
  "getBold",
  "getCriteriaType",
  "getCriteriaValues",
  "getFontColor",
  "getFontColorObject",
  "getItalic",
  "getStrikethrough",
  "getUnderline"
 ],
 "Color": [
  "asRgbColor",
  "asThemeColor",
  "getColorType"
 ],
 "ColorBuilder": [
  "asRgbColor",
  "asThemeColor",
  "build",
  "getColorType",
  "setRgbColor",
  "setThemeColor"
 ],
 "ConditionalFormatRule": [
  "copy",
  "getBooleanCondition",
  "getGradientCondition",
  "getRanges"
 ],
 "ConditionalFormatRuleBuilder": [
  "build",
  "copy",
  "getBooleanCondition",
  "getGradientCondition",
  "getRanges",
  "setBackground",
  "setBackgroundObject",
  "setBold",
  "setFontColor",
  "setFontColorObject",
  "setGradientMaxpoint",
  "setGradientMaxpointObject",
  "setGradientMaxpointObjectWithValue",
  "setGradientMaxpointWithValue",
  "setGradientMidpointObjectWithValue",
  "setGradientMidpointWithValue",
  "setGradientMinpoint",
  "setGradientMinpointObject",
  "setGradientMinpointObjectWithValue",
  "setGradientMinpointWithValue",
  "setItalic",
  "setRanges",
  "setStrikethrough",
  "setUnderline",
  "whenCellEmpty",
  "whenCellNotEmpty",
  "whenDateAfter",
  "whenDateBefore",
  "whenDateEqualTo",
  "whenFormulaSatisfied",
  "whenNumberBetween",
  "whenNumberEqualTo",
  "whenNumberGreaterThan",
  "whenNumberGreaterThanOrEqualTo",
  "whenNumberLessThan",
  "whenNumberLessThanOrEqualTo",
  "whenNumberNotBetween",
  "whenNumberNotEqualTo",
  "whenTextContains",
  "whenTextDoesNotContain",
  "whenTextEndsWith",
  "whenTextEqualTo",
  "whenTextStartsWith",
  "withCriteria"
 ],
 "DataValidation": [
  "copy",
  "getAllowInvalid",
  "getCriteriaType",
  "getCriteriaValues",
  "getHelpText"
 ],
 "DataValidationBuilder": [
  "build",
  "copy",
  "getAllowInvalid",
  "getCriteriaType",
  "getCriteriaValues",
  "getHelpText",
  "requireDate",
  "requireDateAfter",
  "requireDateBefore",
  "requireDateBetween",
  "requireDateEqualTo",
  "requireDateNotBetween",
  "requireDateOnOrAfter",
  "requireDateOnOrBefore",
  "requireFormulaSatisfied",
  "requireNumberBetween",
  "requireNumberEqualTo",
  "requireNumberGreaterThan",
  "requireNumberGreaterThanOrEqualTo",
  "requireNumberLessThan",
  "requireNumberLessThanOrEqualTo",
  "requireNumberNotBetween",
  "requireNumberNotEqualTo",
  "requireTextContains",
  "requireTextDoesNotContain",
  "requireTextEqualTo",
  "requireTextIsEmail",
  "requireTextIsUrl",
  "requireValueInList",
  "requireValueInRange",
  "setAllowInvalid",
  "setHelpText",
  "withCriteria"
 ],
 "GradientCondition": [
  "getMaxColor",
  "getMaxColorObject",
  "getMaxType",
  "getMaxValue",
  "getMidColor",
  "getMidColorObject",
  "getMidType",
  "getMidValue",
  "getMinColor",
  "getMinColorObject",
  "getMinType",
  "getMinValue"
 ],
 "NamedRange": [
  "getName",
  "getRange",
  "remove",
  "setName",
  "setRange"
 ],
 "Range": [
  "autoFill",
  "autoFillToNeighbor",
  "breakApart",
  "canEdit",
  "clear",
  "clearContent",
  "clearDataValidations",
  "clearFormat",
  "copyFormatToRange",
  "copyTo",
  "copyValuesToRange",
  "createTextFinder",
  "deleteCells",
  "getA1Notation",
  "getBackground",
  "getBackgroundObject",
  "getBackgroundObjects",
  "getBackgrounds",
  "getCell",
  "getColumn",
  "getDataRegion",
  "getDataValidation",
  "getDataValidations",
  "getDisplayValue",
  "getDisplayValues",
  "getFontColor",
  "getFontColorObject",
  "getFontColorObjects",
  "getFontColors",
  "getFontFamilies",
  "getFontFamily",
  "getFontLine",
  "getFontLines",
  "getFontSize",
  "getFontSizes",
  "getFontStyle",
  "getFontStyles",
  "getFontWeight",
  "getFontWeights",
  "getFormula",
  "getFormulaR1C1",
  "getFormulas",
  "getFormulasR1C1",
  "getHeight",
  "getHorizontalAlignment",
  "getHorizontalAlignments",
  "getLastColumn",
  "getLastRow",
  "getNextDataCell",
  "getNumColumns",
  "getNumRows",
  "getNumberFormat",
  "getNumberFormats",
  "getRow",
  "getRowIndex",
  "getSheet",
  "getTextStyle",
  "getTextStyles",
  "getValue",
  "getValues",
  "getVerticalAlignment",
  "getVerticalAlignments",
  "getWidth",
  "getWrap",
  "getWraps",
  "insertCells",
  "isBlank",
  "isDataValid",
  "isDataValidForAll",
  "isEndColumnBounded",
  "isEndRowBounded",
  "isStartColumnBounded",
  "isStartRowBounded",
  "merge",
  "mergeAcross",
  "mergeVertically",
  "moveTo",
  "offset",
  "removeDuplicates",
  "setBackground",
  "setBackgroundObject",
  "setBackgroundObjects",
  "setBackgroundRGB",
  "setBackgrounds",
  "setBorder",
  "setDataValidation",
  "setDataValidations",
  "setFontColor",
  "setFontColorObject",
  "setFontColorObjects",
  "setFontColors",
  "setFontFamilies",
  "setFontFamily",
  "setFontLine",
  "setFontLines",
  "setFontSize",
  "setFontSizes",
  "setFontStyle",
  "setFontStyles",
  "setFontWeight",
  "setFontWeights",
  "setFormula",
  "setFormulaR1C1",
  "setFormulas",
  "setFormulasR1C1",
  "setNumberFormat",
  "setNumberFormats",
  "setTextStyle",
  "setTextStyles",
  "setValue",
  "setValues",
  "sort",
  "trimWhitespace"
 ],
 "RangeList": [
  "breakApart",
  "clear",
  "clearContent",
  "clearDataValidations",
  "clearFormat",
  "getRanges",
  "setBackground",
  "setBackgroundRGB",
  "setBorder",
  "setFontColor",
  "setFontFamily",
  "setFontLine",
  "setFontSize",
  "setFontStyle",
  "setFontWeight",
  "setFormula",
  "setFormulaR1C1",
  "setNumberFormat",
  "setValue",
  "trimWhitespace"
 ],
 "RgbColor": [
  "asHexString",
  "getBlue",
  "getColorType",
  "getGreen",
  "getRed"
 ],
 "Sheet": [
  "appendRow",
  "clear",
  "clearConditionalFormatRules",
  "clearContents",
  "clearFormats",
  "copyTo",
  "createTextFinder",
  "deleteColumn",
  "deleteColumns",
  "deleteRow",
  "deleteRows",
  "getColumnWidth",
  "getConditionalFormatRules",
  "getDataRange",
  "getFrozenColumns",
  "getFrozenRows",
  "getIndex",
  "getLastColumn",
  "getLastRow",
  "getName",
  "getNamedRanges",
  "getParent",
  "getRange",
  "getRangeList",
  "getRowHeight",
  "getSheetId",
  "getSheetName",
  "getSheetValues",
  "getType",
  "insertColumnAfter",
  "insertColumnBefore",
  "insertColumns",
  "insertColumnsAfter",
  "insertColumnsBefore",
  "insertRowAfter",
  "insertRowBefore",
  "insertRows",
  "insertRowsAfter",
  "insertRowsBefore",
  "isColumnHiddenByUser",
  "isRowHiddenByFilter",
  "isRowHiddenByUser",
  "isSheetHidden",
  "moveColumns",
  "moveRows",
  "setConditionalFormatRules",
  "setFrozenColumns",
  "setFrozenRows",
  "setName",
  "sort"
 ],
 "Spreadsheet": [
  "appendRow",
  "createTextFinder",
  "deleteColumn",
  "deleteColumns",
  "deleteRow",
  "deleteRows",
  "getActiveSheet",
  "getColumnWidth",
  "getDataRange",
  "getFrozenColumns",
  "getFrozenRows",
  "getLastColumn",
  "getLastRow",
  "getName",
  "getNamedRanges",
  "getNumSheets",
  "getRange",
  "getRangeByName",
  "getRangeList",
  "getRowHeight",
  "getSheetById",
  "getSheetByName",
  "getSheetId",
  "getSheetName",
  "getSheetValues",
  "getSheets",
  "getSpreadsheetLocale",
  "getSpreadsheetTimeZone",
  "insertColumnAfter",
  "insertColumnBefore",
  "insertColumnsAfter",
  "insertColumnsBefore",
  "insertRowAfter",
  "insertRowBefore",
  "insertRowsAfter",
  "insertRowsBefore",
  "isColumnHiddenByUser",
  "isRowHiddenByFilter",
  "isRowHiddenByUser",
  "removeNamedRange",
  "setFrozenColumns",
  "setFrozenRows",
  "setNamedRange",
  "sort",
  "toast"
 ],
 "SpreadsheetApp": [
  "flush",
  "getActive",
  "getActiveSheet",
  "getActiveSpreadsheet",
  "newColor",
  "newConditionalFormatRule",
  "newDataValidation",
  "newTextStyle"
 ],
 "TextFinder": [
  "findAll",
  "findNext",
  "findPrevious",
  "getCurrentMatch",
  "ignoreDiacritics",
  "matchCase",
  "matchEntireCell",
  "matchFormulaText",
  "replaceAllWith",
  "replaceWith",
  "startFrom",
  "useRegularExpression"
 ],
 "TextStyle": [
  "copy",
  "getFontFamily",
  "getFontSize",
  "getForegroundColor",
  "getForegroundColorObject",
  "isBold",
  "isItalic",
  "isStrikethrough",
  "isUnderline"
 ],
 "TextStyleBuilder": [
  "build",
  "setBold",
  "setFontFamily",
  "setFontSize",
  "setForegroundColor",
  "setForegroundColorObject",
  "setItalic",
  "setStrikethrough",
  "setUnderline"
 ],
 "ThemeColor": [
  "getColorType",
  "getThemeColorType"
 ]
};
var GAS_COVERAGE;
(function () {
  var hosts = { SpreadsheetApp: typeof SpreadsheetApp !== "undefined" && SpreadsheetApp,
                Range: typeof Range !== "undefined" && Range.prototype,
                Sheet: typeof Sheet !== "undefined" && Sheet.prototype,
                Spreadsheet: typeof Spreadsheet !== "undefined" && Spreadsheet.prototype,
                RangeList: typeof RangeList !== "undefined" && RangeList.prototype,
                TextFinder: typeof TextFinder !== "undefined" && TextFinder.prototype,
                DataValidation: typeof DataValidation !== "undefined" && DataValidation.prototype,
                DataValidationBuilder: typeof DataValidationBuilder !== "undefined" && DataValidationBuilder.prototype,
                ConditionalFormatRule: typeof ConditionalFormatRule !== "undefined" && ConditionalFormatRule.prototype,
                ConditionalFormatRuleBuilder: typeof ConditionalFormatRuleBuilder !== "undefined" && ConditionalFormatRuleBuilder.prototype,
                NamedRange: typeof NamedRange !== "undefined" && NamedRange.prototype,
                TextStyle: typeof TextStyle !== "undefined" && TextStyle.prototype,
                TextStyleBuilder: typeof TextStyleBuilder !== "undefined" && TextStyleBuilder.prototype,
                RgbColor: typeof RgbColor !== "undefined" && RgbColor.prototype,
                Color: typeof Color !== "undefined" && Color.prototype,
                ColorBuilder: typeof ColorBuilder !== "undefined" && ColorBuilder.prototype,
                ThemeColor: typeof ThemeColor !== "undefined" && ThemeColor.prototype,
                BooleanCondition: typeof BooleanCondition !== "undefined" && BooleanCondition.prototype,
                GradientCondition: typeof GradientCondition !== "undefined" && GradientCondition.prototype };
  GAS_COVERAGE = { implemented: 0, missing: 0, outOfScope: 0, byClass: {} };
  Object.keys(GAS_SURFACE).forEach(function (cls) {
    var proto = hosts[cls];
    var impl = 0, miss = 0, oos = 0;
    GAS_SURFACE[cls].forEach(function (m) {
      if (!proto) { miss++; return; }
      var f = proto[m];
      if (typeof f === "function" && !f.__unimplemented) {
        if (f.__outOfScope) { oos++; return; }     // deliberately unsupported, counted apart
        impl++; return;
      }
      if (typeof f !== "function") proto[m] = GAS.notImplemented(cls + "." + m);
      miss++;
    });
    GAS_COVERAGE.byClass[cls] = { implemented: impl, missing: miss, outOfScope: oos };
    GAS_COVERAGE.implemented += impl; GAS_COVERAGE.missing += miss; GAS_COVERAGE.outOfScope += oos;
    /* Apps Script hands back OPAQUE host objects: String(v) is the class name and the
       constructor is plain Object, not the class. Verified against real Apps Script for
       every class in the surface. Done here so a new class can never forget it. */
    if (proto && !Object.prototype.hasOwnProperty.call(proto, "__opaque")) {
      proto.toString = (function (n) { return function () { return n; }; })(cls);
      proto.constructor = Object;
      Object.defineProperty(proto, "__opaque", { value: true, enumerable: false });
    }
    /* Anything NOT in the surface reaches the catch-all instead of dying as
       "undefined is not a function". Installed last so every real member shadows it. */
    if (proto) {
      var base = Object.getPrototypeOf(proto);
      if (!base || !base.__outOfSurfaceBase) {
        var fallback = GAS.outsideSurface(cls);
        try { Object.setPrototypeOf(proto, fallback); } catch (e) { /* frozen host: skip */ }
      }
    }
  });
})();

/* ---- 91-void-returns.js ---- */
/* ---- methods Apps Script returns VOID from ----
   The shim returned `this` from these so calls could chain. Apps Script does not:
   `sheet.deleteRows(1, 1).getName()` works here and throws "cannot read property of
   undefined" online, and 37 sweep cases recorded the difference (mog ctor "Object",
   Google null).

   One table applied in one loop, rather than editing eight call sites -- the members live
   in five files and the next void method added anywhere would have missed the fix.

   deleteColumn/deleteRow (SINGULAR) are NOT here: those genuinely return Sheet. They
   delegate to the plural form, so once that went void they returned its null instead --
   they are re-based below so the wrapper cannot reach through. */
(function () {
  var VOID = {
    Sheet: ["deleteColumns", "deleteRows", "insertColumns", "insertRows",
            "setFrozenColumns", "setFrozenRows",
            "clearConditionalFormatRules", "setConditionalFormatRules"],
    Spreadsheet: ["deleteColumns", "deleteRows", "insertColumns", "insertRows",
                  "setFrozenColumns", "setFrozenRows", "setNamedRange", "removeNamedRange"],
    NamedRange: ["remove"]
  };
  var CTOR = { Sheet: Sheet, Spreadsheet: Spreadsheet, NamedRange: NamedRange };
  for (var cls in VOID) {
    for (var i = 0; i < VOID[cls].length; i++) {
      (function (proto, name) {
        var inner = proto[name];
        if (typeof inner !== "function") throw new Error("void table names a missing member: " + name);
        /* Apps Script returns NULL from these, not undefined -- measured. */
        proto[name] = function () { inner.apply(this, arguments); return null; };
      })(CTOR[cls].prototype, VOID[cls][i]);
    }
  }
  /* Re-base the singular forms AFTER the wrappers, so they return the Sheet again. */
  Sheet.prototype.deleteColumn = function (c) { this.deleteColumns(c, 1); return this; };
  Sheet.prototype.deleteRow = function (r) { this.deleteRows(r, 1); return this; };
})();
