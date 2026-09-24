/* GENERATED — do not edit here. Source: gas-offline/matrix/*.
   Paste into Apps Script, pick RUN, press Run. Repeat until it says DONE.

   Runs the identical suite that ran offline against mog, and saves the results to Drive
   as matrix-online.json so the two can be compared case by case. */

function RUN() { return __SUITE__.run(); }          // the only entry point

var __SUITE__ = (function () {

var TASK_POOLS = {
 "numberFormats": [
  "General",
  "@",
  "_-* #,##0.0_-;\\-* #,##0.0_-;_-* \"-\"?_-;_-@_-",
  "\"$\"#,##0.0_);\\(\"$\"#,##0.0\\);\"-\"_)",
  "mm/dd/yyyy",
  "#,##0.00;\\(#,##0.00\\)",
  "#,##0.00###;\\(#,##0.00###\\)",
  "#,##0;\\(#,##0\\);;@",
  "#,##0_);\\(#,##0\\);;@",
  "#,##0.0_);\\(#,##0.0\\);#,##0.0_);@_)",
  "0.0%;\\(0.0%\\)",
  "_(* #,##0_);_(* \\(#,##0\\);_(* \"-\"_);_(@_)",
  "_([$$-409]* #,##0_);_([$$-409]* \\(#,##0\\);_([$$-409]* \"-\"_);_(@_)",
  "#,##0_);[Red](#,##0)",
  "0.00;\\(0.00\\)",
  "_(* #,##0_);_(* \\(#,##0\\);_(* \"-\"??_);_(@_)",
  "#,##0_);\\(#,##0\\);#,##0_);@_)",
  "_(* #,##0.0_);_(* \\(#,##0.0\\);_(* \"-\"?_);_(@_)",
  "_(\"$\"* #,##0_);_(\"$\"* \\(#,##0\\);_(\"$\"* \"-\"??_);_(@_)",
  "_-* #,##0_-;\\-* #,##0_-;_-* \"-\"?_-;_-@_-",
  "dd/mm/yy;@",
  "#,##0_);(#,##0)",
  "_(\\$* #,##0_);_(\\$* \\(#,##0\\);_(\\$* \\-_);_(@_)",
  "_(\"$\"* #,##0_);_(\"$\"* \\(#,##0\\);_(\"$\"* \"-\"_);_(@_)",
  "_(* #,##0.0_);_(* \\(#,##0.0\\);_(* \"-\"??_);_(@_)",
  "#,##0.0%;\\(#,##0.0%\\);;@",
  "\"$\"#,##0_);\\(\"$\"#,##0\\)",
  "mm-dd-yy",
  "[$-409]mmm\\-yy;@",
  "#,##0%_);\\(#,##0%\\)",
  "0.0\\ \\x;\\(0.0\\ \\x\\)",
  "#,##0;\\(#,##0\\)",
  "0;\\(0\\)",
  "_(#,##0.0%_);\\(#,##0.0%\\);_(\"\u2013\"_)_%;_(@_)_%",
  "#,##0.000;\\(#,##0.000\\);\\-",
  "0.0%;\\(0.0%\\);\\-",
  "#,##0.0\\x;\\(#,##0.0\\x\\)",
  "_(* #,##0_);_(* \\(#,##0\\);_(* \"-\"?_);_(@_)",
  "#,##0.0;\\(#,##0.0\\);\\-",
  "#,##0.0_);\\(#,##0.0\\)",
  "0%;\\(0%\\)",
  "_(\"$\"* #,##0.0_);_(\"$\"* \\(#,##0.0\\);_(\"$\"* \"-\"?_);_(@_)",
  "0;\\(0\\);;@",
  "0.00%;\\(0.00%\\)",
  "0.0%;\\(0.0%\\);\\-_)_%;@_)_%",
  "_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \"-\"??_);_(@_)",
  "#,##0.0%_);\\(#,##0.0%\\)",
  "[$-409]mmmm\\-yy;@",
  "_(\"$\"* #,##0.00_);_(\"$\"* \\(#,##0.00\\);_(\"$\"* \"-\"??_);_(@_)",
  "[$-409]mmm\\-yy",
  "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)",
  "_-[$\u00a3-809]* #,##0.0_-;\\-[$\u00a3-809]* #,##0.0_-;_-[$\u00a3-809]* \"-\"?_-;_-@",
  "#,##0.0;\\(#,##0.0\\);;@",
  "0.000;\\(0.000\\)",
  "#,##0.00;\\(#,##0.00\\);;@",
  "\"FY\"yy",
  "m/d/yy;@",
  "_(0.0%_);\\(0.0%\\);_(\"\u2013\"_)_%;_(@_)_%",
  "_(0.0%_);\\(0.0%\\);_(\"\u2013\"_);_(@_)",
  "_([$$-409]* #,##0.00_);_([$$-409]* \\(#,##0.00\\);_([$$-409]* \"-\"??_);_(@_)",
  "\"$\"#,##0_);\\(\"$\"#,##0\\);\"OK!\";\"ERROR\"",
  "\"$\"#,##0.00;\\(\"$\"#,##0.00\\)",
  "#;\\(#\\);;@",
  "0.0\\ \\x;\\ \\(0.0\\ \\x\\)",
  "_(0.00%_);\\(0.00%\\);_(\"\u2013\"_)_%;_(@_)_%",
  "_(\"$\"* #,##0_);_(\"$\"* \\(#,##0\\);_(\"$\"* \"-\"?_);_(@_)",
  "#,##0.0;\\(#,##0.0\\)",
  "_([$$-409]* #,##0.0_);_([$$-409]* \\(#,##0.0\\);_([$$-409]* \"-\"??_);_(@_)",
  "yyyy\\-mm\\-dd",
  "_(* #,##0.00_)%;_(* \\(#,##0.00\\)%;_(* \"-\"?_)%;_(@_)",
  "_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \"-\"?_);_(@_)",
  "0.0\\ \\x_);\\(0.0\\ \\x\\);\\-_)",
  "yyyy",
  "0\"P\"",
  "_(* #,##0.000_);_(* \\(#,##0.000\\);_(* \"-\"???_);_(@_)",
  "\"$\"#,##0.000\\);\\(\"$\"#,##0.000\\);\"OK!\";\"ERROR\"",
  "_(#,##0.00_)_%;\\(#,##0.00\\)_%;_(\"\u2013\"_)_%;_(@_)_%",
  "_-* #,##0_-;\\-* #,##0_-;_-* \"-\"_-;_-@_-",
  "_(* #,##0.0_);_(* \\(#,##0.0\\);_(* \"-\"_);_(@_)",
  "_(* #,##0.000_);_(* \\(#,##0.000\\);_(* \"-\"??_);_(@_)",
  "_(#,##0.00_);\\(#,##0.00\\);_(\"\u2013\"_);_(@_)",
  "0\"A\"",
  "0.0\\x;\\(0.0\\x\\)",
  "0.0;\\(0.0\\)",
  ";;;",
  "\"$\"#,##0;\\(\"$\"#,##0\\)",
  "0\\ \"SF\"",
  "\"Year\"\\ 0",
  "0.0000;\\(0.0000\\)",
  "_-* #,##0.00_-;\\-* #,##0.00_-;_-* \"-\"_-;_-@_-",
  "#,##0.00_);(#,##0.00)",
  "0.0%;\\(0.0%\\);\"\u2013\"",
  "\\<0\\>",
  "_(\\\u20a9* #,##0_);_(\\\u20a9* \\(#,##0\\);_(\\\u20a9* \"-\"?_);_(@_)",
  "0\\ \"Years\"",
  "\"L + \"\\ ##",
  "\"Yes\";\"ERROR\";\"No\";\"ERROR\"",
  "\"yes\";;\"no\"",
  "\"$\"0.0,\"B\"",
  "\"Year\"\\ #",
  "_(0.0\\ \\x_);\\(0.0\\ \\x\\);_(\"\u2013\"_);_(@_)",
  "_(#,##0.00%_);\\(#,##0.00%\\);_(\"\u2013\"_)_%;_(@_)_%",
  "#,##0.0#%;\\(#,##0.0#%\\)",
  "#,##0.0000;\\(#,##0.0000\\)",
  "_(* #,##0.00000_);_(* \\(#,##0.00000\\);_(* \"-\"??_);_(@_)",
  "0.00000;\\(0.00000\\)",
  "0.000%;\\(0.000%\\)",
  "\"Month\"\\ 0",
  "0\\ \"Months\"",
  "\"Acquisition\"",
  "\"$\"0.0\"T\"",
  "#,##0.000;\\(#,##0.000\\);;@"
 ],
 "functions": [
  "ABS",
  "AVERAGE",
  "AVERAGEIF",
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
  "COUNTIF",
  "DATE",
  "EDATE",
  "EOMONTH",
  "EXP",
  "IF",
  "IFERROR",
  "INDEX",
  "IPMT",
  "IRR",
  "ISNUMBER",
  "LEFT",
  "LN",
  "MATCH",
  "MAX",
  "MEDIAN",
  "MIN",
  "MONTH",
  "NORMSDIST",
  "NPV",
  "OFFSET",
  "OR",
  "POWER",
  "PPMT",
  "PV",
  "QUARTILE",
  "ROUND",
  "ROUNDUP",
  "SQRT",
  "SUM",
  "SUMIF",
  "SUMIFS",
  "SUMPRODUCT",
  "TEXT",
  "TRANSPOSE",
  "XIRR",
  "YEAR"
 ]
};
var PLAN = [["BooleanCondition","getBackground",false],["BooleanCondition","getBackgroundObject",false],["BooleanCondition","getBold",false],["BooleanCondition","getCriteriaType",false],["BooleanCondition","getCriteriaValues",false],["BooleanCondition","getFontColor",false],["BooleanCondition","getFontColorObject",false],["BooleanCondition","getItalic",false],["BooleanCondition","getStrikethrough",false],["BooleanCondition","getUnderline",false],["Color","asRgbColor",false],["Color","asThemeColor",false],["Color","getColorType",false],["ColorBuilder","asRgbColor",false],["ColorBuilder","asThemeColor",false],["ColorBuilder","build",false],["ColorBuilder","getColorType",false],["ColorBuilder","setRgbColor",false],["ColorBuilder","setThemeColor",false],["ConditionalFormatRule","copy",false],["ConditionalFormatRule","getBooleanCondition",false],["ConditionalFormatRule","getGradientCondition",false],["ConditionalFormatRule","getRanges",false],["ConditionalFormatRuleBuilder","build",false],["ConditionalFormatRuleBuilder","copy",false],["ConditionalFormatRuleBuilder","getBooleanCondition",false],["ConditionalFormatRuleBuilder","getGradientCondition",false],["ConditionalFormatRuleBuilder","getRanges",false],["ConditionalFormatRuleBuilder","setBackground",false],["ConditionalFormatRuleBuilder","setBackgroundObject",false],["ConditionalFormatRuleBuilder","setBold",false],["ConditionalFormatRuleBuilder","setFontColor",false],["ConditionalFormatRuleBuilder","setFontColorObject",false],["ConditionalFormatRuleBuilder","setGradientMaxpoint",false],["ConditionalFormatRuleBuilder","setGradientMaxpointObject",false],["ConditionalFormatRuleBuilder","setGradientMaxpointObjectWithValue",false],["ConditionalFormatRuleBuilder","setGradientMaxpointWithValue",false],["ConditionalFormatRuleBuilder","setGradientMidpointObjectWithValue",false],["ConditionalFormatRuleBuilder","setGradientMidpointWithValue",false],["ConditionalFormatRuleBuilder","setGradientMinpoint",false],["ConditionalFormatRuleBuilder","setGradientMinpointObject",false],["ConditionalFormatRuleBuilder","setGradientMinpointObjectWithValue",false],["ConditionalFormatRuleBuilder","setGradientMinpointWithValue",false],["ConditionalFormatRuleBuilder","setItalic",false],["ConditionalFormatRuleBuilder","setRanges",false],["ConditionalFormatRuleBuilder","setStrikethrough",false],["ConditionalFormatRuleBuilder","setUnderline",false],["ConditionalFormatRuleBuilder","whenCellEmpty",false],["ConditionalFormatRuleBuilder","whenCellNotEmpty",false],["ConditionalFormatRuleBuilder","whenDateAfter",false],["ConditionalFormatRuleBuilder","whenDateBefore",false],["ConditionalFormatRuleBuilder","whenDateEqualTo",false],["ConditionalFormatRuleBuilder","whenFormulaSatisfied",false],["ConditionalFormatRuleBuilder","whenNumberBetween",false],["ConditionalFormatRuleBuilder","whenNumberEqualTo",false],["ConditionalFormatRuleBuilder","whenNumberGreaterThan",false],["ConditionalFormatRuleBuilder","whenNumberGreaterThanOrEqualTo",false],["ConditionalFormatRuleBuilder","whenNumberLessThan",false],["ConditionalFormatRuleBuilder","whenNumberLessThanOrEqualTo",false],["ConditionalFormatRuleBuilder","whenNumberNotBetween",false],["ConditionalFormatRuleBuilder","whenNumberNotEqualTo",false],["ConditionalFormatRuleBuilder","whenTextContains",false],["ConditionalFormatRuleBuilder","whenTextDoesNotContain",false],["ConditionalFormatRuleBuilder","whenTextEndsWith",false],["ConditionalFormatRuleBuilder","whenTextEqualTo",false],["ConditionalFormatRuleBuilder","whenTextStartsWith",false],["ConditionalFormatRuleBuilder","withCriteria",false],["DataValidation","copy",false],["DataValidation","getAllowInvalid",false],["DataValidation","getCriteriaType",false],["DataValidation","getCriteriaValues",false],["DataValidation","getHelpText",false],["DataValidationBuilder","build",false],["DataValidationBuilder","copy",false],["DataValidationBuilder","getAllowInvalid",false],["DataValidationBuilder","getCriteriaType",false],["DataValidationBuilder","getCriteriaValues",false],["DataValidationBuilder","getHelpText",false],["DataValidationBuilder","requireDate",false],["DataValidationBuilder","requireDateAfter",false],["DataValidationBuilder","requireDateBefore",false],["DataValidationBuilder","requireDateBetween",false],["DataValidationBuilder","requireDateEqualTo",false],["DataValidationBuilder","requireDateNotBetween",false],["DataValidationBuilder","requireDateOnOrAfter",false],["DataValidationBuilder","requireDateOnOrBefore",false],["DataValidationBuilder","requireFormulaSatisfied",false],["DataValidationBuilder","requireNumberBetween",false],["DataValidationBuilder","requireNumberEqualTo",false],["DataValidationBuilder","requireNumberGreaterThan",false],["DataValidationBuilder","requireNumberGreaterThanOrEqualTo",false],["DataValidationBuilder","requireNumberLessThan",false],["DataValidationBuilder","requireNumberLessThanOrEqualTo",false],["DataValidationBuilder","requireNumberNotBetween",false],["DataValidationBuilder","requireNumberNotEqualTo",false],["DataValidationBuilder","requireTextContains",false],["DataValidationBuilder","requireTextDoesNotContain",false],["DataValidationBuilder","requireTextEqualTo",false],["DataValidationBuilder","requireTextIsEmail",false],["DataValidationBuilder","requireTextIsUrl",false],["DataValidationBuilder","requireValueInList",false],["DataValidationBuilder","requireValueInRange",false],["DataValidationBuilder","setAllowInvalid",false],["DataValidationBuilder","setHelpText",false],["DataValidationBuilder","withCriteria",false],["GradientCondition","getMaxColor",false],["GradientCondition","getMaxColorObject",false],["GradientCondition","getMaxType",false],["GradientCondition","getMaxValue",false],["GradientCondition","getMidColor",false],["GradientCondition","getMidColorObject",false],["GradientCondition","getMidType",false],["GradientCondition","getMidValue",false],["GradientCondition","getMinColor",false],["GradientCondition","getMinColorObject",false],["GradientCondition","getMinType",false],["GradientCondition","getMinValue",false],["NamedRange","getName",false],["NamedRange","getRange",false],["NamedRange","remove",false],["NamedRange","setName",false],["NamedRange","setRange",false],["Range","autoFill",false],["Range","autoFillToNeighbor",false],["Range","breakApart",true],["Range","canEdit",false],["Range","clear",true],["Range","clearContent",true],["Range","clearDataValidations",true],["Range","clearFormat",true],["Range","copyFormatToRange",false],["Range","copyTo",true],["Range","copyValuesToRange",false],["Range","createTextFinder",false],["Range","deleteCells",false],["Range","getA1Notation",true],["Range","getBackground",true],["Range","getBackgroundObject",true],["Range","getBackgroundObjects",true],["Range","getBackgrounds",true],["Range","getCell",true],["Range","getColumn",true],["Range","getDataRegion",true],["Range","getDataValidation",true],["Range","getDataValidations",true],["Range","getDisplayValue",true],["Range","getDisplayValues",true],["Range","getFontColor",true],["Range","getFontColorObject",true],["Range","getFontColorObjects",true],["Range","getFontColors",true],["Range","getFontFamilies",true],["Range","getFontFamily",true],["Range","getFontLine",true],["Range","getFontLines",true],["Range","getFontSize",true],["Range","getFontSizes",true],["Range","getFontStyle",true],["Range","getFontStyles",true],["Range","getFontWeight",true],["Range","getFontWeights",true],["Range","getFormula",true],["Range","getFormulaR1C1",true],["Range","getFormulas",true],["Range","getFormulasR1C1",true],["Range","getHeight",true],["Range","getHorizontalAlignment",true],["Range","getHorizontalAlignments",true],["Range","getLastColumn",true],["Range","getLastRow",true],["Range","getNextDataCell",true],["Range","getNumColumns",true],["Range","getNumRows",true],["Range","getNumberFormat",true],["Range","getNumberFormats",true],["Range","getRow",true],["Range","getRowIndex",true],["Range","getSheet",true],["Range","getTextStyle",true],["Range","getTextStyles",true],["Range","getValue",true],["Range","getValues",true],["Range","getVerticalAlignment",true],["Range","getVerticalAlignments",true],["Range","getWidth",true],["Range","getWrap",true],["Range","getWraps",true],["Range","insertCells",false],["Range","isBlank",true],["Range","isDataValid",true],["Range","isDataValidForAll",true],["Range","isEndColumnBounded",true],["Range","isEndRowBounded",true],["Range","isStartColumnBounded",true],["Range","isStartRowBounded",true],["Range","merge",true],["Range","mergeAcross",false],["Range","mergeVertically",false],["Range","moveTo",true],["Range","offset",false],["Range","removeDuplicates",false],["Range","setBackground",false],["Range","setBackgroundObject",false],["Range","setBackgroundObjects",false],["Range","setBackgroundRGB",false],["Range","setBackgrounds",false],["Range","setBorder",false],["Range","setDataValidation",false],["Range","setDataValidations",false],["Range","setFontColor",false],["Range","setFontColorObject",false],["Range","setFontColorObjects",false],["Range","setFontColors",false],["Range","setFontFamilies",false],["Range","setFontFamily",false],["Range","setFontLine",false],["Range","setFontLines",false],["Range","setFontSize",false],["Range","setFontSizes",false],["Range","setFontStyle",false],["Range","setFontStyles",false],["Range","setFontWeight",false],["Range","setFontWeights",false],["Range","setFormula",true],["Range","setFormulaR1C1",false],["Range","setFormulas",false],["Range","setFormulasR1C1",false],["Range","setNumberFormat",true],["Range","setNumberFormats",false],["Range","setTextStyle",false],["Range","setTextStyles",false],["Range","setValue",true],["Range","setValues",true],["Range","sort",false],["Range","trimWhitespace",true],["RangeList","breakApart",false],["RangeList","clear",false],["RangeList","clearContent",false],["RangeList","clearDataValidations",false],["RangeList","clearFormat",false],["RangeList","getRanges",false],["RangeList","setBackground",false],["RangeList","setBackgroundRGB",false],["RangeList","setBorder",false],["RangeList","setFontColor",false],["RangeList","setFontFamily",false],["RangeList","setFontLine",false],["RangeList","setFontSize",false],["RangeList","setFontStyle",false],["RangeList","setFontWeight",false],["RangeList","setFormula",false],["RangeList","setFormulaR1C1",false],["RangeList","setNumberFormat",false],["RangeList","setValue",false],["RangeList","trimWhitespace",false],["RgbColor","asHexString",false],["RgbColor","getBlue",false],["RgbColor","getColorType",false],["RgbColor","getGreen",false],["RgbColor","getRed",false],["Sheet","appendRow",false],["Sheet","clear",false],["Sheet","clearConditionalFormatRules",false],["Sheet","clearContents",false],["Sheet","clearFormats",false],["Sheet","copyTo",false],["Sheet","createTextFinder",false],["Sheet","deleteColumn",false],["Sheet","deleteColumns",false],["Sheet","deleteRow",false],["Sheet","deleteRows",false],["Sheet","getColumnWidth",false],["Sheet","getConditionalFormatRules",false],["Sheet","getDataRange",false],["Sheet","getFrozenColumns",false],["Sheet","getFrozenRows",false],["Sheet","getIndex",false],["Sheet","getLastColumn",false],["Sheet","getLastRow",false],["Sheet","getName",false],["Sheet","getNamedRanges",false],["Sheet","getParent",false],["Sheet","getRange",false],["Sheet","getRangeList",false],["Sheet","getRowHeight",false],["Sheet","getSheetId",false],["Sheet","getSheetName",false],["Sheet","getSheetValues",false],["Sheet","getType",false],["Sheet","insertColumnAfter",false],["Sheet","insertColumnBefore",false],["Sheet","insertColumns",false],["Sheet","insertColumnsAfter",false],["Sheet","insertColumnsBefore",false],["Sheet","insertRowAfter",false],["Sheet","insertRowBefore",false],["Sheet","insertRows",false],["Sheet","insertRowsAfter",false],["Sheet","insertRowsBefore",false],["Sheet","isColumnHiddenByUser",false],["Sheet","isRowHiddenByFilter",false],["Sheet","isRowHiddenByUser",false],["Sheet","isSheetHidden",false],["Sheet","moveColumns",false],["Sheet","moveRows",false],["Sheet","setConditionalFormatRules",false],["Sheet","setFrozenColumns",false],["Sheet","setFrozenRows",false],["Sheet","setName",false],["Sheet","sort",false],["Spreadsheet","appendRow",false],["Spreadsheet","createTextFinder",false],["Spreadsheet","deleteColumn",false],["Spreadsheet","deleteColumns",false],["Spreadsheet","deleteRow",false],["Spreadsheet","deleteRows",false],["Spreadsheet","getActiveSheet",false],["Spreadsheet","getColumnWidth",false],["Spreadsheet","getDataRange",false],["Spreadsheet","getFrozenColumns",false],["Spreadsheet","getFrozenRows",false],["Spreadsheet","getLastColumn",false],["Spreadsheet","getLastRow",false],["Spreadsheet","getName",false],["Spreadsheet","getNamedRanges",false],["Spreadsheet","getNumSheets",false],["Spreadsheet","getRange",false],["Spreadsheet","getRangeByName",false],["Spreadsheet","getRangeList",false],["Spreadsheet","getRowHeight",false],["Spreadsheet","getSheetById",false],["Spreadsheet","getSheetByName",false],["Spreadsheet","getSheetId",false],["Spreadsheet","getSheetName",false],["Spreadsheet","getSheetValues",false],["Spreadsheet","getSheets",false],["Spreadsheet","getSpreadsheetLocale",false],["Spreadsheet","getSpreadsheetTimeZone",false],["Spreadsheet","insertColumnAfter",false],["Spreadsheet","insertColumnBefore",false],["Spreadsheet","insertColumnsAfter",false],["Spreadsheet","insertColumnsBefore",false],["Spreadsheet","insertRowAfter",false],["Spreadsheet","insertRowBefore",false],["Spreadsheet","insertRowsAfter",false],["Spreadsheet","insertRowsBefore",false],["Spreadsheet","isColumnHiddenByUser",false],["Spreadsheet","isRowHiddenByFilter",false],["Spreadsheet","isRowHiddenByUser",false],["Spreadsheet","removeNamedRange",false],["Spreadsheet","setFrozenColumns",false],["Spreadsheet","setFrozenRows",false],["Spreadsheet","setNamedRange",false],["Spreadsheet","sort",false],["Spreadsheet","toast",false],["SpreadsheetApp","flush",false],["SpreadsheetApp","getActive",false],["SpreadsheetApp","getActiveSheet",false],["SpreadsheetApp","getActiveSpreadsheet",false],["SpreadsheetApp","newColor",false],["SpreadsheetApp","newConditionalFormatRule",false],["SpreadsheetApp","newDataValidation",false],["SpreadsheetApp","newTextStyle",false],["TextFinder","findAll",false],["TextFinder","findNext",false],["TextFinder","findPrevious",false],["TextFinder","getCurrentMatch",false],["TextFinder","ignoreDiacritics",false],["TextFinder","matchCase",false],["TextFinder","matchEntireCell",false],["TextFinder","matchFormulaText",false],["TextFinder","replaceAllWith",false],["TextFinder","replaceWith",false],["TextFinder","startFrom",false],["TextFinder","useRegularExpression",false],["TextStyle","copy",false],["TextStyle","getFontFamily",false],["TextStyle","getFontSize",false],["TextStyle","getForegroundColor",false],["TextStyle","getForegroundColorObject",false],["TextStyle","isBold",false],["TextStyle","isItalic",false],["TextStyle","isStrikethrough",false],["TextStyle","isUnderline",false],["TextStyleBuilder","build",false],["TextStyleBuilder","setBold",false],["TextStyleBuilder","setFontFamily",false],["TextStyleBuilder","setFontSize",false],["TextStyleBuilder","setForegroundColor",false],["TextStyleBuilder","setForegroundColorObject",false],["TextStyleBuilder","setItalic",false],["TextStyleBuilder","setStrikethrough",false],["TextStyleBuilder","setUnderline",false],["ThemeColor","getColorType",false],["ThemeColor","getThemeColorType",false]];

/* ---- matrix/fingerprint.js ---- */
/* Shared by BOTH sides, byte-identical. Any difference in how the two sides are
   fingerprinted would show up as a fake divergence, so this file is concatenated
   into the offline bundle and the online .gs without modification. */
function fingerprint(thunk) {
  try {
    var v = thunk();
    return { ok: true, shape: shapeOf(v) };
  } catch (e) {
    return { ok: false, error: { name: e && e.name, message: String(e && e.message || e) } };
  }
}
function shapeOf(v) {
  if (v === null) return { t: "null" };
  if (v === undefined) return { t: "undefined" };
  var t = typeof v;
  if (t === "number") return { t: "number", v: v };
  if (t === "string") return { t: "string", v: v };
  if (t === "boolean") return { t: "boolean", v: v };
  if (Array.isArray(v)) return { t: "array", n: v.length, items: v.map(shapeOf) };
  if (v instanceof Date) return { t: "date", v: v.toISOString() };
  if (t === "object" || t === "function") {
    // Enum values and API objects: compare identity by toString, not by reference.
    var s; try { s = String(v); } catch (e) { s = "<unstringable>"; }
    return { t: "object", str: s, ctor: (v.constructor && v.constructor.name) || null };
  }
  return { t: t, v: String(v) };
}

/* A case's RESULT is only comparable to another run's if both ran the SAME case body.
   Regenerating cases-auto.js silently changed bodies twice while keeping ids, which would
   have compared a new test against an old answer -- a false green. So each result carries
   a hash of its own source, and compare.py refuses to compare across a mismatch. */
function caseHash(c) {
  var src = String(c.setup) + "|" + String(c.expr);
  var h = 5381;
  for (var i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ---- matrix/pools.js ---- */
/* INPUT POOLS — named value sets, reused across every member that takes that kind of input.

   GENERALISATION 1: a pool is defined ONCE and assigned to members by NAME PATTERN, so
   adding a value to POOL.color instantly widens every colour-taking member, and a new
   member picks up the right pool without being listed anywhere.

   Pools marked FROM-TASKS are mined from the 15 benchmark workbooks themselves
   (matrix/pools-from-tasks.json): 112 real number formats, 43 real functions. Those are
   the actual distribution an agent will meet, not a guess at it. */



var POOL = {
  /* ---- scalars an agent writes into cells --------------------------------- */
  number: [0, 1, -1, 42, -1.5, 0.005, 1e-300, 1e300, 0.1 + 0.2, 107.23973293768546,
           2.86700826891393, 9007199254740993, -0],
  string: ["", " ", "hi", "42", "007", "-", "+5", "-5", "'42", "TRUE", "=1+1", "#DIV/0!",
           "2025-09-30", "1/2", "(5)", "50%", "a\nb", "café – €", "n/m",
           "  padded  ", "0", "null", "undefined"],
  bool:   [true, false],
  date:   [new Date(2025, 8, 30), new Date(2025, 8, 30, 13, 45, 6), new Date(1899, 11, 30),
           new Date(1970, 0, 1), new Date(2100, 11, 31)],
  empty:  [null, undefined, ""],

  /* ---- formulas, including every shape that breaks an engine -------------- */
  formula: ["=1+1", "=D1", "=$D$1", "=ZZ999", "=ZZ998+1", "=ZZ997&\"x\"", "=SUM(ZZ990:ZZ995)",
            "=SUM(D1:D3)", "=\"a\"&\"b\"", "=1>0", "=NOT(TRUE)", "=D1:D3",
            "=IF(ISNUMBER(D1),ROUND(D1/3,2),\"n/m\")", "=TRANSPOSE(D1:D3)", "=INDEX(D1:D3,2)",
            "=OFFSET(D1,1,0)", "=TEXT(D1,\"0.00\")", "=IFERROR(1/0,\"n/m\")",
            "=SUMIF(D1:D3,\">1\",D1:D3)", "=SUMPRODUCT(D1:D3,D1:D3)", "=NPV(0.1,D1:D3)",
            "=1/0", "=NA()", "=NOSUCHFUNC()", "=\"a\"+1", "=SQRT(-1)", "=SUM(D1 E1)",
            "=#REF!", "=1+", "=SUM(D1:D3", "=", "=TODAY()", "=RAND()"],
  formulaR1C1: ["=R[0]C[-1]+1", "=R1C1", "=RC[-1]", "=SUM(R[-3]C:R[-1]C)"],

  /* ---- colours: every spelling Apps Script accepts ------------------------ */
  color: ["#ff0000", "#FF0000", "#fff", "red", "black", "#00000000", "#ff000080", null, ""],

  /* ---- alignment / wrap / font: the enum-ish string spaces ---------------- */
  hAlign:  ["left", "center", "right", "general", "general-left", "general-right", null],
  vAlign:  ["top", "middle", "bottom", null],
  fontLine:["underline", "line-through", "none", null],
  fontStyle:["italic", "normal", null],
  fontWeight:["bold", "normal", null],
  fontFamily:["Arial", "Times New Roman", "Courier New", "Calibri", "NoSuchFont", ""],
  fontSize:[1, 8, 10, 10.5, 14, 100, 400],
  rotation:[0, 45, -45, 90, -90],

  /* ---- ranges and shapes -------------------------------------------------- */
  a1: ["A1", "A1:B2", "B2:D9", "A:A", "A:C", "1:1", "3:5", "$B$3", "A1:A1", "AZ900:BB902",
       "H2", "D1:D3"],
  index: [1, 2, 3, 26],
  count: [1, 2, 5],

  /* ---- number formats: FROM-TASKS, all 112 real ones + the synthetic edges - */
  numberFormat: null,        // filled at runtime from TASK_POOLS
  numberFormatExtra: ["General", "@", "0", "0.00", "0%", "0.0%", "#,##0", "$#,##0.00",
                      "\"$\"#,##0.00", "0.00E+00", "# ?/?", "[h]:mm", "yyyy-mm-dd",
                      "m/d/yyyy", "hh:mm:ss", "0.0\\k", "0.0\"kg\"", "", null]
};

/* GENERALISATION 1, applied: which pool a member takes, decided by NAME, so the mapping
   is a rule rather than a list. First match wins; order is specific -> general. */
var POOL_FOR = [
  /* GRID pools first: a plural setter takes a 2-D array, and feeding it the singular pool
     produced 354 "not a function" / "requires a 2-dimensional array" failures that were the
     TEST's fault, not the shim's. The grid pools are built from the singular ones so they
     widen automatically. */
  [/^setValues$/,                    "gridScalar"],
  [/^setFormulas$/,                  "gridFormula"],
  [/^setNumberFormats$/,             "gridFormat"],
  [/^set(Backgrounds|FontColors)$/,  "gridColor"],
  [/^setFont(Weights|Styles|Lines|Families)$/, "gridString"],
  [/^setFontSizes$/,                 "gridNumber"],
  [/^set(Horizontal|Vertical)Alignments$/, "gridString"],
  [/^setWraps$/,                     "gridBool"],
  /* members that need a RANGE or an ENUM, not a scalar */
  /* copyFormatToRange/copyValuesToRange do NOT take a Range -- their signature is
     (sheet, column, columnEnd, row, rowEnd). Handing them a Range made both throw. */
  [/^copy(Format|Values)ToRange$/,   "copyGrid"],
  [/^(copyTo|moveTo|setRange)$/,     "rangeArg"],
  /* moveRows/moveColumns take a RANGE plus a destination index, not an index. The index
     pool made both throw "not a function" on rowSpec.getRow() for every case. */
  [/^insert(Rows|Columns)(Before|After)$/, "posCount"],
  [/^autoFillToNeighbor$/,           "series"],
  [/^autoFill$/,                     "autoFill"],
  [/^moveRows$/,                     "moveRows"],
  [/^moveColumns$/,                  "moveColumns"],
  [/^getNextDataCell$/,              "direction"],
  /* READER_WITH_ARGS members still need a pool, or they are "covered" by an arity error. */
  [/^getSheetByName$/,               "sheetName"],
  [/^getSheetById$/,                 "sheetId"],
  [/^getSheetValues$/,               "rcCount"],
  [/^getRangeList$/,                 "a1List"],
  [/^getRangeByName$/,               "definedName"],
  [/^getDataRegion$/,                "dimension"],
  [/^setForegroundColorObject$/,     "colorObj"],
  [/^(deleteCells|insertCells)$/,    "dimension"],
  [/^(insert|delete)(Rows|Columns)(Before|After)?$/, "indexCount"],
  [/^setNumberFormats?$/,            "numberFormat"],
  [/^set(Background|FontColor)RGB$/, "rgb"],
  /* ANCHORED. Unanchored /Color$/ also matched newColor() and asRgbColor() -- members
     that take no colour at all -- so the suite called them WITH one. Google rejects the
     extra argument, mog ignores it, and the divergence is the test's fault. A prefix-only
     guard cannot catch newColor, so the pattern itself has to be anchored. */
  /* ---- builders and the argument-taking writers -------------------------------
     These were calling with ZERO arguments, so 114 members were "covered" only by the
     arity error Apps Script raises. setBorder, setDataValidation, setTextStyle and the
     whole builder surface were never actually exercised. */
  [/^setBorder$/,                    "border"],
  [/^setDataValidations$/,           "dvGrid"],
  [/^setDataValidation$/,            "dv"],
  [/^setTextStyles$/,                "tsGrid"],
  [/^setTextStyle$/,                 "ts"],
  [/^set(Background|FontColor)Objects$/, "colorObjGrid"],
  [/^set(Background|FontColor|Foreground)Object$/, "colorObj"],
  [/^setRanges$/,                    "rangeList"],
  [/^set(Bold|Italic|Underline|Strikethrough|AllowInvalid)$/, "bool"],
  [/^setGradient\w*ObjectWithValue$/, "gradObjVal"],
  [/^setGradient\w*Object$/,         "colorObj"],
  [/^setGradient\w*WithValue$/,      "gradVal"],
  [/^setGradient(Min|Mid|Max)point$/, "color"],
  [/^(when|require)Number(Between|NotBetween)$/, "twoNums"],
  [/^(when|require)Number\w+$/,      "oneNum"],
  [/^(when|require)Text(Contains|DoesNotContain|EqualTo|StartsWith|EndsWith)$/, "oneStr"],
  [/^(when|require)Date(Between|NotBetween)$/, "twoDates"],
  [/^(when|require)Date\w+$/,        "oneDate"],
  [/^(when|require)FormulaSatisfied$/, "formulaStr"],
  [/^requireValueInList$/,           "strList"],
  [/^requireValueInRange$/,          "rangeArg"],
  [/^withCriteria$/,                 "criteria"],
  [/^setHelpText$/,                  "oneStr"],
  [/^createTextFinder$/,             "oneStr"],
  [/^(replaceWith|replaceAllWith)$/, "oneStr"],
  [/^(matchCase|matchEntireCell|matchFormulaText|ignoreDiacritics|useRegularExpression)$/, "bool"],
  [/^startFrom$/,                    "rangeArg"],
  [/^appendRow$/,                    "row"],
  [/^setName$/,                      "oneStr"],
  [/^setNamedRange$/,                "namedRange"],
  [/^removeNamedRange$/,             "oneStr"],
  [/^toast$/,                        "oneStr"],
  [/^setConditionalFormatRules$/,    "cfRules"],
  [/^offset$/,                       "offset"],
  [/^sort$/,                         "sortSpec"],
  [/^setThemeColor$/,                "themeColor"],
  [/^set\w*Color$|^setBackground$/, "color"],
  [/^setHorizontalAlignments?$/,     "hAlign"],
  [/^setVerticalAlignments?$/,       "vAlign"],
  [/^setFontLines?$/,                "fontLine"],
  [/^setFontStyles?$/,               "fontStyle"],
  [/^setFontWeights?$/,              "fontWeight"],
  [/^setFontFamilies$|^setFontFamily$/, "fontFamily"],
  [/^setFontSizes?$/,                "fontSize"],
  [/^setTextRotation$/,              "rotation"],
  [/^setFormulasR1C1$|^setFormulaR1C1$/, "formulaR1C1"],
  [/^setFormulas?$/,                 "formula"],
  [/^setValues?$/,                   "scalar"],
  [/^getRange$|^setRange$/,          "a1"],
  [/^getCell$/,                      "rowcol"],
  [/^(insert|delete|move)(Row|Column)/, "index"],
  [/^(setFrozenRows|setFrozenColumns)$/, "index"],
  [/^(getColumnWidth|getRowHeight|setColumnWidth|setRowHeight)$/, "index"],
  [/^(isRowHidden|isColumnHidden)/,  "index"]
];

/* A READER takes no arguments. Without this guard the colour pattern /Color$/ also matched
   getFontColor, asRgbColor, getMidColor and getForegroundColor, so the suite called them
   WITH a colour -- Google rejects the extra argument and mog ignores it, producing ~300
   divergences caused entirely by the test. The few readers that genuinely take an argument
   (getCell, getRange, getSheetById, getColumnWidth, isRowHiddenByUser...) are listed
   explicitly so the guard cannot swallow them. */
/* Members that wipe or reshape the WHOLE sheet. Run on the shared sheet they destroy the
   base every later case reads: Sheet.clear() and deleteRows() ran early in plan order and
   every subsequent formula case saw an empty D1:D3, so "=INDEX(D1:D3,2)" recorded 0 here
   and 2 online -- a divergence that looked like a mog evaluation bug and was not (mog
   evaluates it correctly in isolation; verified). They get a fresh sheet and run last. */
var DESTRUCTIVE = /^(clear|clearContents|clearFormats|clearConditionalFormatRules|delete(Row|Column)s?$|insert(Row|Column)|setFrozen(Rows|Columns)|sort|setName|appendRow|setNamedRange|removeNamedRange|move(Rows|Columns))/;
function isDestructive(cls, member) {
  return (cls === "Sheet" || cls === "Spreadsheet") && DESTRUCTIVE.test(member);
}

var READER_WITH_ARGS = /^(getRange|getCell|getSheetById|getSheetByName|getSheetValues|getColumnWidth|getRowHeight|getRangeList|getRangeByName|isRowHiddenByUser|isColumnHiddenByUser|isRowHiddenByFilter|getNextDataCell)$/;
/* A pool is keyed by member NAME, which is almost always enough -- but getRange takes an
   address on Range/Sheet and NOTHING on NamedRange, so the name alone picked the wrong
   one and 16 cases tested only Apps Script's signature rejection. */
var NO_ARGS_ON = { "NamedRange.getRange": 1, "NamedRange.getName": 1 };
function poolFor(member, cls) {
  if (cls && NO_ARGS_ON[cls + "." + member]) return null;
  if (/^(get|is|as)[A-Z]/.test(member) && !READER_WITH_ARGS.test(member)) return null;
  for (var i = 0; i < POOL_FOR.length; i++) if (POOL_FOR[i][0].test(member)) return POOL_FOR[i][1];
  return null;
}
/* GENERALISATION 1: grid pools are DERIVED from the singular pools, so widening a scalar
   pool widens the grid pool with it. Nothing is written twice. */
function gridOf(vals) {
  var out = [];
  for (var i = 0; i < vals.length; i++) out.push([[vals[i], vals[i]], [vals[i], vals[i]]]);
  return out;
}

function poolValues(name) {
  if (name === "gridScalar")  return gridOf(poolValues("scalar").slice(0, 12));
  if (name === "gridFormula") return gridOf(POOL.formula.slice(0, 12));
  if (name === "gridFormat")  return gridOf(poolValues("numberFormat").slice(0, 12));
  if (name === "gridColor")   return gridOf(POOL.color.slice(0, 6));
  if (name === "gridString")  return gridOf(["bold", "normal", "italic", "underline", "left", "top"]);
  if (name === "gridNumber")  return gridOf(POOL.fontSize);
  if (name === "gridBool")    return gridOf(POOL.bool);
  if (name === "rowcol")      return ["__RC11__", "__RC22__"];
  if (name === "sheetName")   return ["__SHEETNAME__", "no such sheet", ""];
  if (name === "sheetId")     return ["__SHEETID__", -1];
  if (name === "rcCount")     return ["__RCC_OK__", "__RCC_1__", "__RCC_BAD__"];
  if (name === "a1List")      return ["__A1LIST__", "__A1LIST_EMPTY__"];
  if (name === "definedName") return ["swept_name", "no such name"];
  if (name === "bool")        return [true, false];
  if (name === "posCount")    return ["__POS1_1__", "__POS2_3__"];
  if (name === "series")      return ["__SERIES_DEF__", "__SERIES_ALT__"];
  if (name === "autoFill")    return ["__AUTOFILL__"];
  if (name === "moveRows")    return ["__MOVEROWS__"];
  if (name === "moveColumns") return ["__MOVECOLS__"];
  if (name === "copyGrid")    return ["__COPYGRID__"];
  if (name === "rangeArg")    return ["__RANGE__"];      /* resolved against the live sheet */
  if (name === "direction")   return ["__DIR_DOWN__", "__DIR_UP__", "__DIR_NEXT__", "__DIR_PREV__"];
  if (name === "dimension")   return ["__DIM_ROWS__", "__DIM_COLS__"];
  if (name === "indexCount")  return ["__IDX1__", "__IDX2__"];
  if (name === "scalar")
    return POOL.number.concat(POOL.string, POOL.bool, POOL.date, POOL.empty);
  if (name === "numberFormat")
    return (TASK_POOLS ? TASK_POOLS.numberFormats : []).concat(POOL.numberFormatExtra);
  /* setBackgroundRGB(r, g, b) takes THREE arguments; one array was a single argument. */
  if (name === "border")      return ["__BORDER1__", "__BORDER2__", "__BORDER3__"];
  if (name === "dv")          return ["__DV1__", "__DV2__"];
  if (name === "dvGrid")      return ["__DVGRID__"];
  if (name === "ts")          return ["__TS1__", "__TS2__"];
  if (name === "tsGrid")      return ["__TSGRID__"];
  if (name === "colorObj")    return ["__COLOROBJ__"];
  if (name === "colorObjGrid") return ["__COLOROBJGRID__"];
  if (name === "rangeList")   return ["__RANGELIST__"];
  if (name === "gradObjVal")  return ["__GRADOBJVAL__"];
  if (name === "gradVal")     return ["__GRADVAL__"];
  if (name === "twoNums")     return ["__2NUM_A__", "__2NUM_B__"];
  if (name === "oneNum")      return [0, 5, -1, 1e300];
  if (name === "oneStr")      return ["x", "", "hello world", "0"];
  if (name === "twoDates")    return ["__2DATE__"];
  if (name === "oneDate")     return ["__1DATE__"];
  if (name === "formulaStr")  return ["=$A1>3", "=TRUE", "=ZZ999"];
  if (name === "strList")     return ["__STRLIST__"];
  if (name === "criteria")    return ["__CRITERIA1__", "__CRITERIA2__"];
  if (name === "row")         return ["__ROW1__", "__ROW2__"];
  if (name === "namedRange")  return ["__NAMEDRANGE__"];
  if (name === "cfRules")     return ["__CFRULES__", "__CFEMPTY__"];
  if (name === "offset")      return ["__OFF2__", "__OFF3__", "__OFF4__"];
  if (name === "sortSpec")    return ["__SORT1__", "__SORT2__"];
  if (name === "rgb") return ["__RGB1__", "__RGB2__"];
  if (name === "themeColor") return ["__THEME1__", "__THEME2__"];
  return POOL[name] || [];
}

/* ---- matrix/fixtures.js ---- */
/* THE FIXTURE SPACE — every receiver state an agent could plausibly meet.
   Shared byte-identically by both sides.

   Where a space is enumerable FROM THE API, the fixtures are generated from the enum so
   the coverage is structural rather than remembered: every BorderStyle, every
   DataValidationCriteria, every BooleanCriteria, every alignment. Where it is not
   (error kinds, number-format families), it is written out in full and the list is the
   specification. */

var FIX_COL = "B", FIX_START = 2;
var FIXTURES = [];
function fx(name, build) { FIXTURES.push([name, build]); }

/* ---- emptiness: four DIFFERENT kinds, and engines disagree about them ------ */
fx("empty.untouched",  function (s, a) {});
fx("empty.cleared",    function (s, a) { s.getRange(a).setValue(1); s.getRange(a).clearContent(); });
fx("empty.clearAll",   function (s, a) { s.getRange(a).setValue(1).setBackground("#ff0000"); s.getRange(a).clear(); });
fx("empty.string",     function (s, a) { s.getRange(a).setValue(""); });
fx("empty.space",      function (s, a) { s.getRange(a).setValue(" "); });
fx("empty.formulaBlank", function (s, a) { s.getRange(a).setFormula("=\"\""); });

/* ---- numbers, including the precision and magnitude edges ------------------ */
["42","0","-0","-1.5","0.005","1e300","1e-300","107.23973293768546","2.86700826891393",
 "0.1+0.2","9007199254740993"].forEach(function (n, i) {
  fx("num." + n.replace(/[^0-9a-zA-Z.\-+]/g, "_"), function (s, a) { s.getRange(a).setValue(eval(n)); });
});

/* ---- strings that an engine might mistake for something else --------------- */
['"hi"','"42"','"007"','"-"','"+5"','"-5"','"\'42"','"TRUE"','"=1+1"','" x "','"a\\nb"',
 '"caf\\u00e9 \\u2013 \\u20ac"','"#DIV/0!"','"2025-09-30"','"1/2"','"(5)"','"50%"'].forEach(function (v, i) {
  /* index the slug: "+5" and "-5" both reduce to the same characters otherwise */
  fx("str." + i + "." + v.replace(/[^0-9a-zA-Z]/g, "_").slice(0, 12), function (s, a) { s.getRange(a).setValue(eval(v)); });
});
fx("str.long", function (s, a) { var t = ""; for (var i = 0; i < 2000; i++) t += "x"; s.getRange(a).setValue(t); });
fx("bool.true",  function (s, a) { s.getRange(a).setValue(true); });
fx("bool.false", function (s, a) { s.getRange(a).setValue(false); });
fx("date.plain", function (s, a) { s.getRange(a).setValue(new Date(2025, 8, 30)); });
fx("date.time",  function (s, a) { s.getRange(a).setValue(new Date(2025, 8, 30, 13, 45, 6)); });
fx("date.epoch", function (s, a) { s.getRange(a).setValue(new Date(1899, 11, 30)); });

/* ---- formulas, including references into emptiness ------------------------- */
['"=1+1"','"=D1"','"=ZZ999"','"=ZZ998+1"','"=ZZ997&\\"x\\""','"=SUM(ZZ990:ZZ995)"',
 '"=D1:D3"','"=SUM(D1:D3)"','"=\\"a\\"&\\"b\\""','"=1>0"','"=NOT(TRUE)"',
 '"=IF(ISNUMBER(D1),ROUND(D1/3,2),\\"n/m\\")"','"=TRANSPOSE(D1:D3)"','"=INDEX(D1:D3,2)"',
 '"=OFFSET(D1,1,0)"','"=TEXT(D1,\\"0.00\\")"','"=TODAY()"','"=RAND()"'].forEach(function (f) {
  fx("f." + f.replace(/[^0-9a-zA-Z]/g, "_").slice(0, 16), function (s, a) { s.getRange(a).setFormula(eval(f)); });
});
fx("f.circular", function (s, a) { s.getRange(a).setFormula("=" + a); });

/* ---- EVERY error value. Excel has seven; Sheets adds #ERROR! for a formula it
        cannot parse, which an Excel-shaped engine cannot produce at all. New error
        cells are a hard FAIL term in the grader, so these matter more than most. --- */
[["divZero",'"=1/0"'],["na",'"=NA()"'],["naLookup",'"=VLOOKUP(\\"zz\\",D1:D3,1,FALSE)"'],
 ["name",'"=NOSUCHFUNC()"'],["value",'"=\\"a\\"+1"'],["num",'"=SQRT(-1)"'],
 ["null",'"=SUM(D1 E1)"'],["ref",'"=#REF!"'],["malformed",'"=1+"'],
 ["unclosed",'"=SUM(D1:D3"'],["divZeroText",'"#DIV/0!"']].forEach(function (d) {
  fx("err." + d[0], function (s, a) {
    var v = eval(d[1]);
    if (v.charAt(0) === "=") s.getRange(a).setFormula(v); else s.getRange(a).setValue(v);
  });
});

/* ---- number formats: one per FAMILY, plus the section arrangements --------- */
[["general",'"General"',"1234.5"],["int",'"0"',"1234.5"],["dec2",'"0.00"',"1234.5"],
 ["thousands",'"#,##0"',"1234567"],["thouDec",'"#,##0.00"',"1234.5"],
 ["pct",'"0%"',"0.125"],["pctDec",'"0.0%"',"0.125"],
 ["currency",'"$#,##0.00"',"1234.5"],["currencyQuoted",'"\\"$\\"#,##0.00"',"1234.5"],
 ["accounting",'"_(\\"$\\"* #,##0.0_)"',"522.4"],
 ["accountingFull",'"_($* #,##0.00_);_($* (#,##0.00);_($* \\"-\\"??_);_(@_)"',"-1234.5"],
 ["neg2",'"#,##0.0;(#,##0.0)"',"-5"],["neg3",'"#,##0.0;(#,##0.0);\\"-\\""',"0"],
 ["neg4",'"#,##0.0;(#,##0.0);\\"-\\";@"',"-5"],
 ["sci",'"0.00E+00"',"12345"],["frac",'"# ?/?"',"0.5"],["text",'"@"',"42"],
 ["date",'"yyyy-mm-dd"',"new Date(2025,8,30)"],["dateUS",'"m/d/yyyy"',"new Date(2025,8,30)"],
 ["dateLong",'"[$-409]d\\\\-mmm\\\\-yy"',"new Date(2025,8,30)"],
 ["datetime",'"yyyy-mm-dd hh:mm:ss"',"new Date(2025,8,30,13,45,6)"],
 ["time",'"hh:mm"',"new Date(2025,8,30,13,45,6)"],
 ["elapsed",'"[h]:mm"',"1.5"],["literal",'"0.0\\\\k"',"12.3"],["quotedLit",'"0.0\\"kg\\""',"12.3"]
].forEach(function (d) {
  fx("fmt." + d[0], function (s, a) { s.getRange(a).setValue(eval(d[2])).setNumberFormat(eval(d[1])); });
});

/* ---- EVERY BorderStyle, and the side combinations ------------------------- */
["DOTTED","DASHED","SOLID","SOLID_MEDIUM","SOLID_THICK","DOUBLE"].forEach(function (b) {
  fx("bord." + b, function (s, a) {
    s.getRange(a).setValue(1).setBorder(true, true, true, true, false, false,
      "#000000", SpreadsheetApp.BorderStyle[b]);
  });
});
fx("bord.topOnly",   function (s, a) { s.getRange(a).setValue(1).setBorder(true, null, null, null, null, null); });
fx("bord.innerOnly", function (s, a) { s.getRange(a).setValue(1).setBorder(null, null, null, null, true, true); });
fx("bord.none",      function (s, a) { s.getRange(a).setValue(1).setBorder(false, false, false, false, false, false); });

/* ---- EVERY alignment / wrap / rotation ------------------------------------ */
["left","center","right","general"].forEach(function (h) {
  fx("align.h." + h, function (s, a) { s.getRange(a).setValue(1).setHorizontalAlignment(h); });
});
["top","middle","bottom"].forEach(function (v) {
  fx("align.v." + v, function (s, a) { s.getRange(a).setValue(1).setVerticalAlignment(v); });
});
fx("wrap.on",    function (s, a) { s.getRange(a).setValue("a long piece of text").setWrap(true); });
fx("wrap.off",   function (s, a) { s.getRange(a).setValue("a long piece of text").setWrap(false); });
/* setTextRotation is not in the agreed surface, so no agent can produce this state. */

/* ---- fonts ---------------------------------------------------------------- */
fx("font.bold",    function (s, a) { s.getRange(a).setValue(1).setFontWeight("bold"); });
fx("font.italic",  function (s, a) { s.getRange(a).setValue(1).setFontStyle("italic"); });
fx("font.under",   function (s, a) { s.getRange(a).setValue(1).setFontLine("underline"); });
fx("font.strike",  function (s, a) { s.getRange(a).setValue(1).setFontLine("line-through"); });
fx("font.size",    function (s, a) { s.getRange(a).setValue(1).setFontSize(18); });
fx("font.family",  function (s, a) { s.getRange(a).setValue(1).setFontFamily("Courier New"); });
fx("font.color",   function (s, a) { s.getRange(a).setValue(1).setFontColor("#0000ff"); });
fx("fill.bg",      function (s, a) { s.getRange(a).setValue(1).setBackground("#ffff00"); });
fx("fill.none",    function (s, a) { s.getRange(a).setValue(1).setBackground(null); });

/* ---- EVERY DataValidationCriteria the surface exposes --------------------- */
[["NUMBER_BETWEEN","1, 10"],["NUMBER_NOT_BETWEEN","1, 10"],["NUMBER_GREATER_THAN","5"],
 ["NUMBER_LESS_THAN","5"],["NUMBER_EQUAL_TO","5"],["NUMBER_NOT_EQUAL_TO","5"],
 ["TEXT_CONTAINS",'"x"'],["TEXT_DOES_NOT_CONTAIN",'"x"'],["TEXT_EQUAL_TO",'"x"'],
 ["VALUE_IN_LIST",'["a","b"]'],["CUSTOM_FORMULA",'"=$A1>3"']].forEach(function (d) {
  fx("dv." + d[0], function (s, a) {
    try {
      var b = SpreadsheetApp.newDataValidation()
                .withCriteria(SpreadsheetApp.DataValidationCriteria[d[0]], eval("[" + d[1] + "]"));
      s.getRange(a).setValue(1).setDataValidation(b.build());
    } catch (e) { s.getRange(a).setValue(1); }
  });
});

/* ---- conditional formats, one per BooleanCriteria family ------------------ */
[["NUMBER_GREATER_THAN","whenNumberGreaterThan","3"],["NUMBER_BETWEEN","whenNumberBetween","1, 10"],
 ["TEXT_CONTAINS","whenTextContains",'"x"'],["CUSTOM_FORMULA","whenFormulaSatisfied",'"=$A1>3"'],
 ["CELL_NOT_EMPTY","whenCellNotEmpty",""]].forEach(function (d) {
  fx("cf." + d[0], function (s, a) {
    /* No try/catch. It used to swallow NotImplemented and lay a plain cell instead, so a
       missing CF criterion showed up as a background colour that differed by one shade
       rather than as a failure. A fixture that silently degrades tests nothing. */
    var b = SpreadsheetApp.newConditionalFormatRule();
    b = d[2] ? b[d[1]].apply(b, eval("[" + d[2] + "]")) : b[d[1]]();
    s.getRange(a).setValue(5);
    s.setConditionalFormatRules([b.setBackground("#ff0000").setRanges([s.getRange(a)]).build()]);
  });
});

/* ---- structure ------------------------------------------------------------ */
/* This used to compute B32:B32 -- a 1x1 range -- and never call merge(), so the highest-risk
   state in a spreadsheet engine had ZERO coverage under a fixture named for it. The 5-row
   stride means resetFixtureCell already tears a 2-row merge down. */
fx("merge.anchor", function (s, a) {
  var col = a.replace(/[0-9]+/, ""), row = parseInt(a.replace(/[^0-9]/g, ""), 10);
  s.getRange(a).setValue("merged");
  s.getRange(col + row + ":" + col + (row + 1)).merge();
});
fx("merge.shadow", function (s, a) {
  var col = a.replace(/[0-9]+/, ""), row = parseInt(a.replace(/[^0-9]/g, ""), 10);
  s.getRange(a).setValue("anchor");
  s.getRange(col + (row - 1) + ":" + col + row).merge();   // this cell is the NON-anchor
});
fx("validated.blank", function (s, a) {
  try { s.getRange(a).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberBetween(1, 10).build()); } catch (e) {}
});

/* Stride of 5: a spilling fixture (=TRANSPOSE(D1:D3), =D1:D3) writes several cells DOWN,
   and on consecutive rows it landed on the next fixture and poisoned every later case
   there with "cannot change part of an array formula". */
var FIX_STRIDE = 5;
function fixAddr(i) { return FIX_COL + (FIX_START + i * FIX_STRIDE); }
/* A fixture must leave NOTHING behind for the next case on that cell: an array formula
   blocks later writes ("cannot change part of an array formula") and an unrepresentable
   border makes every later read of that cell throw. Clear content, format AND any spill
   before re-laying. */
function resetFixtureCell(sh, a1) {
  try { sh.getRange(a1).setFormula(""); } catch (e) {}
  try { sh.getRange(a1 + ":" + a1.replace(/[0-9]+/, "") + (parseInt(a1.replace(/[^0-9]/g, ""), 10) + 4)).clear(); } catch (e) {}
  try { sh.getRange(a1).clear(); } catch (e) {}
  try { sh.getRange(a1).setFontFamily("Arial").setFontSize(10); } catch (e) {}
}

function layFixtures(sh) {
  var out = [];
  for (var i = 0; i < FIXTURES.length; i++) {
    var a = fixAddr(i);
    resetFixtureCell(sh, a);
    try { FIXTURES[i][1](sh, a); } catch (e) { /* whatever landed is the state */ }
    out.push({ name: FIXTURES[i][0], a1: a });
  }
  return out;
}

/* ---- matrix/sweep.js ---- */
/* THE SUITE. Shared byte-identically by both sides.

   For every one of the 395 members: one case per value in its POOL (assigned by name
   pattern, so the mapping is a rule not a list), and for members whose behaviour depends
   on what was already in the cell, that pool crossed with every fixture STATE.

   Each case records THREE things, because a divergence can hide in any of them:
     1. what the call RETURNED
     2. the cell's FULL state after the call  (value, formula, format, every style axis)
     3. the state it started FROM
   A single character of difference in any of them fails the comparison. */

/* Each getter is a separate round trip, and Apps Script round trips dominate the online
   run: a full 15-property snapshot before AND after cost ~30 calls per case, which put
   11,314 cases at roughly 19 presses of a 6-minute script.

   So the snapshot has two depths. A POOL case always starts from the same scratch cell,
   so its "before" carries no information and its "after" only needs the axes that any
   member can move. A STATE case is the whole point of the fixture, so it keeps the full
   picture. Same data offline and online, so the comparison is unaffected. */
function snapFull(r) {
  function g(m) { try { var v = r[m](); return v instanceof Date ? "D:" + v.getTime() : v; }
                  catch (e) { return "ERR:" + String(e && e.message).slice(0, 200); } }
  return [g("getValue"), g("getFormula"), g("getNumberFormat"), g("getDisplayValue"),
          g("getBackground"), g("getFontColor"), g("getFontWeight"), g("getFontStyle"),
          g("getFontLine"), g("getFontSize"), g("getFontFamily"),
          g("getHorizontalAlignment"), g("getVerticalAlignment"), g("getWrap"), g("isBlank")];
}
function snapLite(r) {
  function g(m) { try { var v = r[m](); return v instanceof Date ? "D:" + v.getTime() : v; }
                  catch (e) { return "ERR:" + String(e && e.message).slice(0, 200); } }
  return [g("getValue"), g("getFormula"), g("getNumberFormat"), g("getDisplayValue"),
          g("getBackground"), g("getFontWeight"), g("getHorizontalAlignment")];
}
var snap = snapFull;

/* THE BASE STATE, defined once and called by both runners. A blank sheet falls back to
   each engine's own defaults -- Google Arial 10 / 100px, Excel Calibri 11 / 64px -- so
   every style and layout reader diverges for that reason alone unless it is laid first.
   It used to be copy-pasted into run.py AND build-online.mjs, which is how the two halves
   drift. `wide` is the main sheet, which must cover every fixture row; a temp sheet only
   hosts one destructive call and a snapLite of H2, and snapLite reads no layout. */
function prepSheet(s, wide) {
  s.getRange("D1:D3").setValues([[1], [2], [3]]);
  s.getRange(wide ? "A1:BZ400" : "A1:R40").setFontFamily("Arial").setFontSize(10);
  var cols = wide ? 60 : 12, rows = wide ? 300 : 30, i;
  for (i = 1; i <= cols; i++) s.setColumnWidth(i, 100);
  for (i = 1; i <= rows; i++) s.setRowHeight(i, 21);
  return s;
}

var NR_SEQ = 0;

/* the receiver for each class; A is the address under test */
function receiver(cls, s, A) {
  switch (cls) {
    case "Range": return s.getRange(A);
    case "Sheet": return s;
    case "Spreadsheet": return s.getParent();
    case "SpreadsheetApp": return SpreadsheetApp;
    case "RangeList": return s.getRangeList([A, "P1"]);
    case "TextFinder": return s.createTextFinder("x");
    case "ConditionalFormatRuleBuilder": return SpreadsheetApp.newConditionalFormatRule();
    case "ConditionalFormatRule": return SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(3).setBackground("#ff0000").setRanges([s.getRange(A)]).build();
    case "BooleanCondition": return SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(3).setBackground("#ff0000").setRanges([s.getRange(A)]).build()
        .getBooleanCondition();
    case "GradientCondition": return SpreadsheetApp.newConditionalFormatRule()
        .setGradientMinpoint("#ffffff").setGradientMaxpoint("#ff0000")
        .setRanges([s.getRange(A)]).build().getGradientCondition();
    case "DataValidationBuilder": return SpreadsheetApp.newDataValidation();
    case "DataValidation": return SpreadsheetApp.newDataValidation().requireNumberBetween(1,10).build();
    case "TextStyleBuilder": return SpreadsheetApp.newTextStyle();
    case "TextStyle": return SpreadsheetApp.newTextStyle().setBold(true).build();
    case "ColorBuilder": return SpreadsheetApp.newColor();
    case "Color": return SpreadsheetApp.newColor().setRgbColor("#ff0000").build();
    case "RgbColor": return SpreadsheetApp.newColor().setRgbColor("#ff0000").build().asRgbColor();
    case "ThemeColor": return SpreadsheetApp.newColor()
        .setThemeColor(SpreadsheetApp.ThemeColorType.ACCENT1).build().asThemeColor();
    case "NamedRange":
      /* Math.random() here made the name -- and so every error message quoting it --
         differ between the two runs by construction. A counter is reproducible. */
      /* "nr0" is a valid CELL REFERENCE (column NR, row 0 reads as one), so Sheets
         rejected the name and all 19 NamedRange members tested nothing but that error. */
      s.getParent().setNamedRange("swept_nr" + (NR_SEQ++), s.getRange(A));
      return s.getParent().getNamedRanges()[0];
  }
  return null;
}

var SCRATCH = "H2";          /* 1x1, for scalar-taking members  */
var SCRATCH2 = "H2:I3";      /* 2x2, for the plural/grid setters */

/* A grid setter needs a range whose SHAPE matches the grid. Deciding that from the pool
   name keeps it one rule rather than a per-member list. */
function scratchFor(pool) {
  return (pool && pool.indexOf("grid") === 0) ? SCRATCH2 : SCRATCH;
}

/* Sentinels in the pools stand for things that only exist against a LIVE sheet (a Range,
   an enum). Resolved here so the pool tables stay pure data and shareable by both sides. */
function resolveArgs(v, s, cls) {
  if (v === "__RGB1__")     return [255, 0, 0];
  if (v === "__RGB2__")     return [0, 0, 0];
  if (v === "__THEME1__")   return [SpreadsheetApp.ThemeColorType.ACCENT1];
  if (v === "__THEME2__")   return [SpreadsheetApp.ThemeColorType.TEXT];
  if (v === "__RC11__")     return [1, 1];
  if (v === "__RC22__")     return [2, 2];
  if (v === "__RANGE__")    return [s.getRange("P10")];
  if (v === "__COPYGRID__") return [s, 16, 17, 10, 11];   /* sheet, col, colEnd, row, rowEnd */
  if (v === "__POS1_1__")     return [1, 1];
  if (v === "__POS2_3__")     return [2, 3];
  if (v === "__SERIES_DEF__") return [SpreadsheetApp.AutoFillSeries.DEFAULT_SERIES];
  if (v === "__SERIES_ALT__") return [SpreadsheetApp.AutoFillSeries.ALTERNATE_SERIES];
  if (v === "__AUTOFILL__")   return [s.getRange("H2:H5"), SpreadsheetApp.AutoFillSeries.DEFAULT_SERIES];
  if (v === "__MOVEROWS__") return [s.getRange("10:11"), 5];
  if (v === "__MOVECOLS__") return [s.getRange("P:Q"), 5];
  if (v === "__DIR_DOWN__") return [SpreadsheetApp.Direction.DOWN];
  if (v === "__DIR_UP__")   return [SpreadsheetApp.Direction.UP];
  if (v === "__DIR_NEXT__") return [SpreadsheetApp.Direction.NEXT];
  if (v === "__DIR_PREV__") return [SpreadsheetApp.Direction.PREVIOUS];
  if (v === "__DIM_ROWS__") return [SpreadsheetApp.Dimension.ROWS];
  if (v === "__DIM_COLS__") return [SpreadsheetApp.Dimension.COLUMNS];
  if (v === "__IDX1__")     return [1];
  if (v === "__IDX2__")     return [2, 2];

  /* Argument recipes for the builder + formatting surface. Everything here is built
     through the PUBLIC api only, so the recipe is identical on both engines. */
  if (v === "__BORDER1__") return [true, true, true, true, false, false];
  if (v === "__BORDER2__") return [true, null, true, null, true, true, "#ff0000",
                                   SpreadsheetApp.BorderStyle.DASHED];
  if (v === "__BORDER3__") return [false, false, false, false, false, false];
  if (v === "__DV1__")     return [SpreadsheetApp.newDataValidation()
                                    .requireNumberBetween(1, 10).setAllowInvalid(false).build()];
  if (v === "__DV2__")     return [SpreadsheetApp.newDataValidation()
                                    .requireValueInList(["a", "b"]).build()];
  if (v === "__DVGRID__")  return [[[SpreadsheetApp.newDataValidation()
                                    .requireNumberGreaterThan(0).build()]]];
  if (v === "__TS1__")     return [SpreadsheetApp.newTextStyle().setBold(true).setItalic(true).build()];
  if (v === "__TS2__")     return [SpreadsheetApp.newTextStyle()
                                    .setForegroundColor("#00ff00").setUnderline(true).build()];
  if (v === "__TSGRID__")  return [[[SpreadsheetApp.newTextStyle().setBold(true).build()]]];
  if (v === "__COLOROBJ__")     return [SpreadsheetApp.newColor().setRgbColor("#123456").build()];
  if (v === "__COLOROBJGRID__") return [[[SpreadsheetApp.newColor().setRgbColor("#123456").build()]]];
  if (v === "__RANGELIST__")    return [[s.getRange("P10:Q11")]];
  if (v === "__GRADVAL__")      return ["#ff0000", SpreadsheetApp.InterpolationType.NUMBER, "5"];
  if (v === "__GRADOBJVAL__")   return [SpreadsheetApp.newColor().setRgbColor("#ff0000").build(),
                                        SpreadsheetApp.InterpolationType.PERCENT, "50"];
  if (v === "__2NUM_A__")  return [1, 10];
  if (v === "__2NUM_B__")  return [-5, 0];
  if (v === "__1DATE__")   return [new Date(2026, 0, 15)];
  if (v === "__2DATE__")   return [new Date(2026, 0, 1), new Date(2026, 11, 31)];
  if (v === "__STRLIST__") return [["a", "b", "c"]];
  /* withCriteria exists on BOTH builders and takes a DIFFERENT enum on each, which is
     why the class is threaded in -- a pool is keyed by member name alone. */
  if (v === "__CRITERIA1__") return cls === "DataValidationBuilder"
      ? [SpreadsheetApp.DataValidationCriteria.NUMBER_BETWEEN, [1, 10]]
      : [SpreadsheetApp.BooleanCriteria.NUMBER_BETWEEN, [1, 10]];
  if (v === "__CRITERIA2__") return cls === "DataValidationBuilder"
      ? [SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST, [["a", "b"]]]
      : [SpreadsheetApp.BooleanCriteria.TEXT_CONTAINS, ["x"]];
  if (v === "__ROW1__")    return [["a", 1, true]];
  if (v === "__ROW2__")    return [[]];
  if (v === "__NAMEDRANGE__") return ["swept_name", s.getRange("P10:Q11")];
  if (v === "__CFRULES__") return [[SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(5).setBackground("#ff0000")
        .setRanges([s.getRange("P10:Q11")]).build()]];
  if (v === "__CFEMPTY__") return [[]];
  if (v === "__OFF2__")    return [1, 1];
  if (v === "__OFF3__")    return [0, 0, 3];
  if (v === "__OFF4__")    return [-1, -1, 2, 2];
  if (v === "__SORT1__")   return [1];
  if (v === "__SORT2__")   return (cls === "Sheet" || cls === "Spreadsheet")
      ? [1, false]                                  /* (columnPosition, ascending) */
      : [{ column: 1, ascending: false }];           /* Range.sort takes the spec object */
  if (v === "__SHEETNAME__") return [s.getName()];       /* the scratch sheet names itself */
  if (v === "__SHEETID__")   return [s.getSheetId()];
  if (v === "__RCC_OK__")    return [1, 1, 2, 2];
  if (v === "__RCC_1__")     return [1, 1, 1, 1];
  if (v === "__RCC_BAD__")   return [0, 0, 1, 1];        /* 1-based: 0 is an error on both */
  if (v === "__A1LIST__")       return [["A1", "B2:C3"]];
  if (v === "__A1LIST_EMPTY__") return [[]];
  return [v];
}              // away from the fixture column

/* emit(id, thunk) is supplied by the runner so results can be streamed, not accumulated */
function runSuite(sh, PLAN, emit) {
  var laid = layFixtures(sh);

  /* Destructive members LAST, so nothing they wreck is read by a case that has not run
     yet. Ordering alone is not enough -- they would still wreck each other -- so each also
     gets its own sheet below. Both halves sort identically, so case ids still line up. */
  var ORDER = PLAN.slice().sort(function (a, b) {
    return (isDestructive(a[0], a[1]) ? 1 : 0) - (isDestructive(b[0], b[1]) ? 1 : 0);
  });
  for (var p = 0; p < ORDER.length; p++) {
    var cls = ORDER[p][0], m = ORDER[p][1], stateful = ORDER[p][2];
    var pool = poolFor(m, cls);
    var vals = pool ? poolValues(pool) : [null];

    /* ---- member x every value in its pool, on a scratch cell -------------- */
    for (var v = 0; v < vals.length; v++) {
      (function (cls, m, val, k, poolName) {
        emit("pool." + cls + "." + m + "#" + k, function () {
          var addr = scratchFor(poolName);
          var head = addr.split(":")[0];
          var s = sh;
          /* A destructive member gets the base RE-LAID first, so it cannot inherit the
             damage the previous one did. A temp sheet would isolate it better, but
             insertSheet/deleteSheet are not in the pinned surface and the suite may only
             use members an agent could -- adding them to reach a test would change the
             thing being tested. Narrow base: destructive cases run last (see ORDER) and
             record only snapLite of the scratch cell, which reads no layout. */
          if (isDestructive(cls, m)) prepSheet(s, false);
          {
            var r0 = s.getRange(addr);
            /* clear() removes FORMATTING as well as content, so the explicit base font is
               lost and each engine falls back to its own blank default -- Excel Calibri 11,
               Google Arial 10. Re-apply it, or ~1,200 cases diverge for that reason alone. */
            r0.clear(); r0.setFontFamily("Arial").setFontSize(10); r0.setValue(1);
            var recv = receiver(cls, s, addr);
            var ret = poolName ? recv[m].apply(recv, resolveArgs(val, s, cls)) : recv[m]();
            /* before is a constant for every pool case (scratch cell holding 1), so it is
               not recorded -- only the return value and what the call changed. */
            return [ret, snapLite(s.getRange(head))];
          }
        });
      })(cls, m, vals[v], v, pool);
      if (!pool) break;                     // no pool -> a single no-argument call
    }

    /* ---- state-sensitive members x EVERY fixture state -------------------- */
    /* A READER cannot change anything, so it needs no rebuild and no after-snapshot: the
       fixture is laid once and every reader runs across it for one call each. A WRITER
       does mutate, so it rebuilds its cell first and records what changed. That split is
       what makes ~2,600 state cases affordable online. */
    if (stateful) {
      var isReader = /^(get|is)[A-Z]/.test(m);
      for (var f = 0; f < laid.length; f++) {
        (function (cls, m, fx, idx, poolName, val, reader) {
          emit("state." + cls + "." + fx.name + "." + m, function () {
            /* A reader still needs its fixture RE-LAID. Skipping that to save a round
               trip meant readers saw whatever the previous writers had scribbled on the
               cell, so the answer depended on execution order rather than on the state
               under test -- and the two engines drifted apart as soon as any writer
               behaved differently. */
            resetFixtureCell(sh, fx.a1);
            FIXTURES[idx][1](sh, fx.a1);
            if (reader) {
              /* A reader with arguments (getCell, getNextDataCell, ...) still needs them.
                 Calling it bare tested its ARITY REJECTION and nothing else -- 141 cases
                 where Google threw "The parameters () don't match" and mog did not. */
              var rr = sh.getRange(fx.a1);
              return [poolName ? rr[m].apply(rr, resolveArgs(val, sh, cls)) : rr[m]()];
            }
            var r = sh.getRange(fx.a1);
            var ret = poolName
              ? (poolName.indexOf("grid") === 0 ? r[m]([[val[0][0]]]) : r[m].apply(r, resolveArgs(val, sh, cls)))
              : r[m]();
            return [ret, snapLite(sh.getRange(fx.a1))];
          });
        })(cls, m, laid[f], f, pool, vals[0], isReader);
      }
    }
  }

  /* Each fixture STATE is itself recorded once, in full, so a reader's answer can be read
     against the exact state it saw without paying for a snapshot per case. */
  for (var q = 0; q < laid.length; q++) {
    (function (fx, idx) {
      emit("fixture." + fx.name, function () {
        resetFixtureCell(sh, fx.a1);
        FIXTURES[idx][1](sh, fx.a1);
        return snapFull(sh.getRange(fx.a1));
      });
    })(laid[q], q);
  }
}


/* The filename carries a hash of the test sources. Change sweep.js or the pools and the
   next run writes a NEW file instead of resuming into answers from different code. */
var SUITE_VERSION = "aefb8e7f";
var NAME = "matrix-online-" + SUITE_VERSION + ".json";
/* Apps Script hard-stops at 6 minutes. 5.5 leaves enough room to load, merge and save
   the results file without being killed mid-write. */
var BUDGET_MS = 5.5 * 60 * 1000;

function loadDone() {
  var it = DriveApp.getFilesByName(NAME);
  if (!it.hasNext()) return {};
  try { return JSON.parse(it.next().getBlob().getDataAsString()); } catch (e) { return {}; }
}

function save(obj) {
  var old = DriveApp.getFilesByName(NAME);
  while (old.hasNext()) old.next().setTrashed(true);
  return DriveApp.createFile(NAME, JSON.stringify(obj), "application/json");
}

function run() {
  var done = loadDone();
  var deadline = Date.now() + BUDGET_MS;
  /* Fixed name: with Date.now() in it, Spreadsheet.getName() was unmatchable by construction. */
  var ss = SpreadsheetApp.create("matrix-scratch");
  var added = 0, total = 0, stopped = false, captured = [];
  try {
    var sh = ss.getSheets()[0];
    /* the SAME explicit base the offline side uses -- literally the same function, from
       matrix/sweep.js, because when it was copy-pasted into both runners it drifted */
    prepSheet(sh, true);
    SpreadsheetApp.flush();

    runSuite(sh, PLAN, function (id, thunk) {
      total++;
      if (done[id]) { captured.push(id); return; }   // already captured by an earlier run
      if (Date.now() > deadline) { stopped = true; return; }
      done[id] = fingerprint(thunk);
      captured.push(id);
      added++;
    });
  } finally {
    /* SAVE FIRST. This used to trash the scratch before saving, and save() sits after the
       finally -- so when the trash threw ("No item with the given ID could be found",
       e.g. the scratch was removed out from under it) the whole run died and 5.5 minutes
       of captured cases went in the bin. Cleanup is best-effort; results are not. */
    try { save(done); } catch (e) { /* reported by the caller's log line */ }
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) { /* already gone */ }
  }
  var left = total - captured.length;
  Logger.log("SAVED " + Object.keys(done).length + "/" + total +
             "  this run: " + added +
             "  REMAINING " + (left > 0 ? left + "  -> press Run again" : "0  -> DONE"));
  return left;
}

return { run: run };
})();
