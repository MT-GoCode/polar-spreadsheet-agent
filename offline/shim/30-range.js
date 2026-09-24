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
