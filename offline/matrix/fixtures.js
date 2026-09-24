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
  /* clear() deliberately KEEPS the number format -- that is real Apps Script behaviour and
     both engines agree on it. So a reset built on clear() alone leaked the previous case's
     format into the next one, and the two runs drifted apart the moment they formatted
     anything differently. Reset it explicitly. */
  try { sh.getRange(a1).setNumberFormat("General"); } catch (e) {}
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
