/* INPUT POOLS — named value sets, reused across every member that takes that kind of input.

   GENERALISATION 1: a pool is defined ONCE and assigned to members by NAME PATTERN, so
   adding a value to POOL.color instantly widens every colour-taking member, and a new
   member picks up the right pool without being listed anywhere.

   Pools marked FROM-TASKS are mined from the 15 benchmark workbooks themselves
   (matrix/pools-from-tasks.json): 112 real number formats, 43 real functions. Those are
   the actual distribution an agent will meet, not a guess at it. */

var TASK_POOLS = null;          // injected by the runner from pools-from-tasks.json

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
