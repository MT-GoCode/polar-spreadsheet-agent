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
            /* clear() keeps the NUMBER FORMAT by design (both engines agree), so it must
               be reset explicitly or it leaks from the previous case. */
            r0.clear(); r0.setNumberFormat("General");
            r0.setFontFamily("Arial").setFontSize(10); r0.setValue(1);
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
