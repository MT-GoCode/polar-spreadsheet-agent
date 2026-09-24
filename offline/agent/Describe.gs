/* describe_spreadsheet(ss) -- the workbook map. Plain Apps Script over ss, so it ships
   online verbatim and needs no adapter. Spec: mapspec/SPEC-V3-FINAL.md.

   THREE RULES
     R0  every fact carries its owning region -- row/col numbers are reused across
         neighbouring regions with different meanings; this is common in real models.
     R1  delta governs ENUMERATION, never DESCRIPTION. A uniform region still gets its
         one-line summary; what is suppressed is listing each member.
     R2  observe, never conclude. No "units are thousands", no "cell X is wrong", no
         ranked candidates. Of 33 measured failures, zero came from not looking.

   Each layer is an INDEPENDENT partition of the same grid. They overlap and may disagree;
   that is information, not a defect, and they are never reconciled.

   NOT AVAILABLE HERE: cell borders (Apps Script has setBorder and no getBorder) and merged
   ranges (write-only in this surface). */

/* 200k bytes ~= 50k tokens. The largest map in this corpus is 97k, so at this cap NOTHING
   is dropped anywhere and every layer survives -- the priority drops were costing task_15
   its INPUTS and NUMERICS layers to meet a number nobody had measured. There is still no
   truncation at any size: over the cap the map says so and stays complete. */
var MAP_CAP = 200000;

function describe_spreadsheet(ss, budgetMs, maxCells) {
  /* TIME BUDGET (optional). Every read here is already batched -- one getValues /
     getFormulas / getNumberFormats per sheet, no per-cell calls -- so the cost on a large
     workbook is CPU in the analysis layers, not round trips. Batching cannot help it and
     Apps Script has no parallelism. What CAN help is spending the time where it is worth
     most: run the core layers, then keep adding optional ones until the budget is gone.
     Online that matters because the whole execution dies at 360 s and a describe that eats
     the budget leaves the agent nothing -- task_03 wrote zero cells that way. Omit budgetMs
     (offline default) and behaviour is byte-identical to before: no checks, nothing
     skipped. */
  var T0 = Date.now(), SKIPPED = [], CAPPED = [];
  /* ROW CAP. Checkpoints only fire BETWEEN layers, so they cannot help when a single core
     layer is the cost: task_03 is 22,398 x 16 on one sheet and its core pass alone ran 6+
     minutes under mog, which is ~20x faster than Apps Script. The map's job is to show
     STRUCTURE, and structure repeats down a data block -- the 12,000th row of a SUMIF
     column teaches nothing the 2,000th did not. So analyse a bounded prefix of each sheet
     and say exactly where the view stops. Omit maxCells (offline default) for no cap. */
  function capRows(lr, lc) {
    if (!maxCells || !lc || lr * lc <= maxCells) return lr;
    return Math.max(1, Math.floor(maxCells / lc));
  }
  function timeLeft() { return !budgetMs || (Date.now() - T0) < budgetMs; }
  function note(layer) { if (SKIPPED.indexOf(layer) < 0) SKIPPED.push(layer); return true; }
  var O = [], SECS = [], cur = null;
  var PRI = { FORMAT: 5, GRAPH: 5, INPUTS: 4, NUMERICS: 3 };
  function sec(label) {
    var p = 0;
    for (var k in PRI) if (label.indexOf(k) === 0) p = PRI[k];
    cur = { pri: p, label: label, lines: [] };
    SECS.push(cur);
  }
  function line(s) { cur.lines.push("  " + s); }

  sec("HOW TO READ THIS MAP");
  line("Rn[a-b]   = REGION id n, spanning rows a-b on that sheet. NOT R1C1 notation.");
  line("R[-2]C[1] = R1C1 formula notation: row/col offsets from the cell itself.");
  line("@         = a reference blanked out, leaving the formula's SHAPE (its skeleton).");
  line("Blocks group by skeleton: one line can stand for thousands of cells.");
  line("Difficulty tracks SKELETON COUNT in what you must write, not cell count.");
  line("Every layer partitions the same grid independently; they may disagree.");
  line("This map OBSERVES, it never concludes. Read cells directly before relying on them.");
  line("Absent by construction: cell borders (no getBorder in Apps Script), merged ranges.");

  var sheets = ss.getSheets();

  /* CHEAP FIRST. getName / getLastRow / getLastColumn cost milliseconds and need no grid
     read; getFormulas over every sheet is the single most expensive thing in this file.
     Doing the expensive pass first -- purely to sort sheets by formula density -- meant a
     workbook that runs out of clock emitted NOTHING, not even its sheet names. Names and
     dimensions are established here so they always land. */
  var meta = [];
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i], lrFull = sh.getLastRow(), lc = sh.getLastColumn();
    var lr = capRows(lrFull, lc);
    if (lr < lrFull) CAPPED.push(sh.getName() + " rows 1-" + lr + " of " + lrFull);
    meta.push({ sh: sh, name: sh.getName(), lr: lr, lc: lc, lrFull: lrFull, nf: 0 });
  }

  /* The density sort is a nicety, not a fact about the workbook. Buy it only if the clock
     allows; otherwise keep tab order and say so, rather than spending the whole budget
     ranking sheets the agent will never get a map of. */
  var ordered = false;
  if (timeLeft()) {
    for (i = 0; i < meta.length; i++) {
      var m0 = meta[i];
      if (m0.lr > 0 && m0.lc > 0) {
        var fs = m0.sh.getRange(1, 1, m0.lr, m0.lc).getFormulas();
        for (var r = 0; r < fs.length; r++)
          for (var c = 0; c < fs[r].length; c++) if (fs[r][c]) m0.nf++;
        m0.formulas = fs;
      }
    }
    meta.sort(function (a, b) { return b.nf - a.nf; });
    ordered = true;
  } else note("SHEET ORDER by density");

  sec("SHEET ORDER");
  line(ordered ? "ordered by formula density, not tab order: " +
       meta.map(function (m) { return m.name; }).join(" > ")
     : "TAB ORDER (no clock left to rank by formula density): " +
       meta.map(function (m) { return m.name; }).join(" > "));

  sec("WORKBOOK SHEETS");
  for (i = 0; i < meta.length; i++) {
    var m2 = meta[i], bits = [m2.name, "used " + a1(1, 1) + ":" + a1(m2.lr, m2.lc),
                              (m2.formulas ? m2.nf + " formula cells" : "formula count not taken")];
    var fr = m2.sh.getFrozenRows(), fc2 = m2.sh.getFrozenColumns();
    if (fr) bits.push("frozen rows " + fr);
    if (fc2) bits.push("frozen cols " + fc2);
    var hid = [];
    var hidScan = Math.min(m2.lr, 300);
    for (var r2 = 1; r2 <= hidScan; r2++)
      if (m2.sh.isRowHiddenByUser(r2)) hid.push(r2);
    if (m2.lr > hidScan) bits.push("hidden-row scan covered rows 1-" + hidScan + " only");
    if (hid.length) bits.push("HIDDEN rows " + hid.join(","));
    line(bits.join(" | "));
  }

  var nrs = ss.getNamedRanges();
  if (nrs && nrs.length) {
    sec("NAMED RANGES");
    for (i = 0; i < nrs.length; i++) {
      try {
        var rg = nrs[i].getRange();
        line(nrs[i].getName() + " -> '" + rg.getSheet().getName() + "'!" + rg.getA1Notation());
      } catch (e) { }
    }
  }

  var axes = [];

  for (var si = 0; si < meta.length; si++) {
    var M = meta[si], sh = M.sh, S = M.name, LR = M.lr, LC = M.lc;
    if (!LR || !LC) continue;
    /* Whole sheets, not partial ones. Starting a sheet we cannot finish spends the grid
       reads and emits nothing; skipping it leaves the sheet named and sized above, with
       its absence stated below. */
    if (!timeLeft()) { note("whole-sheet survey of '" + S + "'"); continue; }
    if (!M.formulas) M.formulas = sh.getRange(1, 1, LR, LC).getFormulas();
    var rng = sh.getRange(1, 1, LR, LC);
    /* Only V and F are core (REGIONS and BLOCKS need them). NF, FCOL and FW feed exactly
       one optional layer each -- NUMERICS, INPUTS, FORMAT -- so reading them here spent
       three full-grid reads per sheet even when the budget then skipped every consumer.
       Each is now fetched immediately after the checkpoint that decides to use it. */
    var F = M.formulas, V = rng.getValues(), NF = null, FCOL = null, FW = null;

    /* REGIONS -- partition by blank-row runs */
    var occ = [], bands = [];
    for (r = 0; r < LR; r++) {
      var any = false;
      /* A cell holding a formula that currently returns "" is OCCUPIED. Keying occupancy
         off displayed values alone drops those rows out of every band, and regionOf then
         answers "R?" for them -- breaking the guarantee that every fact carries its
         region, on the common hide-until-populated pattern. */
      for (c = 0; c < LC; c++)
        if ((V[r][c] !== "" && V[r][c] !== null) || F[r][c]) { any = true; break; }
      occ.push(any);
    }
    var st = -1;
    for (r = 0; r < LR; r++) {
      if (occ[r] && st < 0) st = r;
      if ((!occ[r] || r === LR - 1) && st >= 0) {
        bands.push([st + 1, (occ[r] ? r : r - 1) + 1]); st = -1;
      }
    }
    function regionOf(row) {
      for (var b = 0; b < bands.length; b++)
        if (row >= bands[b][0] && row <= bands[b][1]) return "R" + (b + 1) + "[" + bands[b][0] + "-" + bands[b][1] + "]";
      /* Outside every band: say which bands it sits between rather than a bare "R?",
         so the reader can still place it. */
      for (var b2 = 0; b2 < bands.length; b2++)
        if (row < bands[b2][0])
          return "R?(above R" + (b2 + 1) + "[" + bands[b2][0] + "-" + bands[b2][1] + "])";
      return bands.length ? "R?(below R" + bands.length + ")" : "R?(sheet has no bands)";
    }
    function txt(row, col) {
      if (row < 1 || col < 1 || row > LR || col > LC) return "";
      var v = V[row - 1][col - 1];
      return (typeof v === "string" && v && v.charAt(0) !== "#" && !F[row - 1][col - 1]) ? v.trim() : "";
    }

    sec("REGIONS  " + S);
    for (var b2 = 0; b2 < bands.length; b2++) {
      var t0 = "";
      for (r = bands[b2][0]; r <= Math.min(bands[b2][0] + 2, bands[b2][1]) && !t0; r++)
        for (c = 1; c <= Math.min(LC, 30) && !t0; c++) t0 = txt(r, c);
      line("R" + (b2 + 1) + "[" + bands[b2][0] + "-" + bands[b2][1] + "] '" + t0 + "'");
    }

    /* BLOCKS -- partition by R1C1 skeleton */
    if (M.nf) {
      var groups = Object.create(null);
      for (r = 0; r < LR; r++) for (c = 0; c < LC; c++) {
        if (!F[r][c]) continue;
        var sk = skeleton(toR1C1(F[r][c], r + 1, c + 1));
        (groups[sk] = groups[sk] || []).push([r + 1, c + 1]);
      }
      var keys = Object.keys(groups).sort(function (x, y) { return groups[y].length - groups[x].length; });
      sec("BLOCKS  " + S + "   (partition by R1C1 skeleton)");
      line("[" + M.nf + " formula cells -> " + keys.length + " skeletons]" +
           (keys.length === 1 ? "  [1 skeleton]" : ""));
      for (var gi = 0; gi < keys.length; gi++) {
        var cells = groups[keys[gi]], bb = bboxOf(cells), top = cells[0];
        /* label: scan LEFT from the block's own column, never a hardcoded column --
           side-by-side tables reuse row numbers, so one row can carry two labels */
        var lbl = "", lblc = 0;
        /* Stop at a run of empty columns: that gap is the boundary between side-by-side
           tables, and stepping over it attributes a neighbouring table's label to this
           block. Scanning left is right; scanning left FOREVER is how row 5 of one table
           gets labelled with row 5 of another. */
        /* Scan left for the row's label. Stop at DATA, not at blanks: a number or a
           formula to the left means we have walked into a different table, but blank
           columns are just indentation. The old rule stopped after 2 blank columns, which
           misses every indented statement -- task_15's Forecast Model labels its rows in
           column D and starts its numbers in column H, so 7 of 10 blocks on a fully
           labelled sheet reported "(no row label left)". */
        for (c = bb[1] - 1; c >= 1; c--) {
          var tt = txt(top[0], c);
          if (tt) { lbl = tt; lblc = c; break; }
          var vv2 = V[top[0] - 1][c - 1];
          if (F[top[0] - 1][c - 1] || (vv2 !== "" && vv2 !== null)) break;   /* another table */
        }
        var regs = {}, ro = [];
        for (i = 0; i < cells.length; i++) { var rr = regionOf(cells[i][0]); if (!regs[rr]) { regs[rr] = 1; ro.push(rr); } }
        /* two lines per group, not four: the skeleton rides the header, and the concrete
           A1 example carries the real refs. The R1C1 form sat between the two and said
           nothing neither already said. */
        line(bboxStr(bb) + "  n=" + cells.length + "  " + shapeOf(cells) + "  " +
             (ro.length === 1 ? ro[0] : "spans " + ro.join(",")) + "  " +
             (lblc ? "'" + lbl + "'@" + a1(top[0], lblc) : "(no row label left)") +
             "   " + keys[gi]);
        line("    eg " + a1(top[0], top[1]) + " = " + F[top[0] - 1][top[1] - 1]);
      }
    }

    /* Optional layers, in descending value. Each checkpoint abandons the REST of this
       sheet's optional analysis, never a partial layer -- a half-computed layer is the
       silent truncation this map exists to eliminate. */
    optional: {
    if (!timeLeft()) { note("NUMERICS+"); break optional; }
    NF = rng.getNumberFormats();
    /* NUMERICS -- own partition, by numfmt string */
    var nfg = Object.create(null);
    for (r = 0; r < LR; r++) for (c = 0; c < LC; c++) {
      if (V[r][c] === "" || V[r][c] === null) continue;
      (nfg[NF[r][c]] = nfg[NF[r][c]] || []).push([r + 1, c + 1]);
    }
    var nfk = Object.keys(nfg).sort(function (x, y) { return nfg[y].length - nfg[x].length; });
    if (nfk.length) {
      sec("NUMERICS  " + S + "   (partition by numfmt string)");
      for (i = 0; i < nfk.length; i++) {
        var cc2 = nfg[nfk[i]], bb2 = bboxOf(cc2), tag = "";
        /* Sheets surfaces the default format as '0.###############', not 'General'. Both
           mean the same thing: nobody has set a convention on these cells yet. */
        if (/^(general|0\.#+|)$/i.test(nfk[i]) && cc2.length > 5)
          tag = "  [default format]";
        if (nfk[i].indexOf("%") >= 0) {
          for (var q = 0; q < cc2.length; q++) {
            var vv = V[cc2[q][0] - 1][cc2[q][1] - 1];
            if (typeof vv === "number") { tag = "  [stored " + vv + ", displayed as a percent]"; break; }
          }
        }
        line(bboxStr(bb2) + "  n=" + cc2.length + "  " + regionOf(bb2[0]) + "  numfmt '" + nfk[i] + "'" +
             (nfk.length === 1 ? "  [1 format]" : "") + tag);
      }
    }

    /* INPUTS -- own partition, by font colour */
    if (!timeLeft()) { note("INPUTS+"); break optional; }
    FCOL = rng.getFontColors();
    var blue = [], blk = [];
    for (r = 0; r < LR; r++) for (c = 0; c < LC; c++) {
      if (V[r][c] === "" || V[r][c] === null || F[r][c]) continue;
      var fc3 = String(FCOL[r][c] || "").toLowerCase();
      (fc3 === "#0000ff" ? blue : blk).push([r + 1, c + 1]);
    }
    if (blue.length) {
      sec("INPUTS  " + S + "   (partition by font colour)");
      line("blue literals  " + bboxStr(bboxOf(blue)) + "  n=" + blue.length + "  " + regionOf(bboxOf(blue)[0]));
      /* Only a NUMBER can break the blue-means-input convention. Text cells are row
         labels and headings -- reporting 110 of them as convention-breakers buried the
         handful that matter. */
      var blkNum = [];
      for (i = 0; i < blk.length; i++)
        if (typeof V[blk[i][0] - 1][blk[i][1] - 1] === "number") blkNum.push(blk[i]);
      if (blkNum.length)
        line("NON-blue NUMERIC literals  " + bboxStr(bboxOf(blkNum)) + "  n=" + blkNum.length +
             "  " + regionOf(bboxOf(blkNum)[0]) +
             "  [numeric literals not in the blue set]");
    }

    /* FORMAT -- own partition, visual only (numfmt lives in NUMERICS) */
    if (!timeLeft()) { note("FORMAT+"); break optional; }
    FW = rng.getFontWeights();
    var bold = [];
    for (r = 0; r < LR; r++) for (c = 0; c < LC; c++)
      if (FW[r][c] === "bold" && V[r][c] !== "" && V[r][c] !== null) bold.push([r + 1, c + 1]);
    if (bold.length && bold.length < LR * LC) {
      sec("FORMAT  " + S + "   (partition by visual style)");
      line("bold  " + bboxStr(bboxOf(bold)) + "  n=" + bold.length + "  " + regionOf(bboxOf(bold)[0]));
    }

    /* BLANKS -- own partition, with shape tag */
    var holes = [];
    for (var bi = 0; bi < bands.length; bi++)
      for (r = bands[bi][0]; r <= bands[bi][1]; r++)
        for (c = 1; c <= LC; c++)
          if (V[r - 1][c - 1] === "" || V[r - 1][c - 1] === null) holes.push([r, c]);
    if (holes.length) {
      /* One bbox over scattered blanks collapses to the whole sheet -- "A1:P113 n=1120
         sparse" told the agent nothing, and on most tasks the blanks ARE the job. Report
         the maximal blank RUN per row instead, grouped by identical run so a rectangular
         hole is one line, and scoped to its region. */
      var runs = {};
      for (var hb = 0; hb < bands.length; hb++) {
        for (r = bands[hb][0]; r <= bands[hb][1]; r++) {
          var c0 = 0;
          for (c = 1; c <= LC + 1; c++) {
            var empty = c <= LC && (V[r - 1][c - 1] === "" || V[r - 1][c - 1] === null);
            if (empty && !c0) c0 = c;
            else if (!empty && c0) {
              if (c - c0 >= 2) {                       /* single stray gaps are not holes */
                var k3 = colLetter(c0) + "-" + colLetter(c - 1);
                (runs[k3] = runs[k3] || []).push(r);
              }
              c0 = 0;
            }
          }
        }
      }
      var rk = Object.keys(runs).sort(function (x, y) { return runs[y].length - runs[x].length; });
      if (rk.length) {
        if (!timeLeft()) { note("BLANKS+"); break optional; }
        sec("BLANKS  " + S + "   (contiguous empty spans inside occupied row-bands)");
        for (i = 0; i < rk.length; i++) {
          var rws = runs[rk[i]], a = rk[i].split("-");
          var lo3 = rws[0], hi3 = rws[rws.length - 1], contig = (hi3 - lo3 + 1) === rws.length;
          line(a[0] + lo3 + ":" + a[1] + hi3 + "  cols " + rk[i] + "  " + rws.length + " rows" +
               (contig ? " [CONTIGUOUS BLOCK]"
                       : rws.length <= 20 ? " (rows " + rws.join(",") + ")"
                       : " (" + rws.length + " rows between " + lo3 + " and " + hi3 + ")") +
               "  " + regionOf(lo3));
        }
      }
    }

    /* ERRORS -- in-sheet only, never hoisted to a global section */
    var errs = [];
    for (r = 0; r < LR; r++) for (c = 0; c < LC; c++) {
      var ev = V[r][c];
      if (typeof ev === "string" && ev.charAt(0) === "#" && ev.length > 2) errs.push([r + 1, c + 1, ev]);
    }
    if (errs.length) {
      if (!timeLeft()) { note("ERRORS+"); break optional; }
      sec("ERRORS  " + S);
      for (i = 0; i < errs.length; i++)
        line(a1(errs[i][0], errs[i][1]) + "  " + errs[i][2] + "  " + regionOf(errs[i][0]) +
             "  " + (F[errs[i][0] - 1][errs[i][1] - 1] || ""));
      if (errs.length > 40) line("(+" + (errs.length - 40) + " more error cells)");
    }

    /* OBJECTS -- always current state. Never suppressed for being unchanged: a task may
       ask for something the workbook already contains, and silence invites a duplicate. */
    var dvs = rng.getDataValidations(), dvl = [];
    for (r = 0; r < LR; r++) for (c = 0; c < LC; c++)
      if (dvs[r][c]) dvl.push([r + 1, c + 1, dvs[r][c]]);
    var cfr = [];
    try { cfr = sh.getConditionalFormatRules() || []; } catch (e) { cfr = []; }
    if (dvl.length || cfr.length || si === 0) {
      if (!timeLeft()) { note("OBJECTS+"); break optional; }
      sec("OBJECTS  " + S + "   (present in the starting workbook)");
      for (i = 0; i < dvl.length; i++) {
        var d = dvl[i][2], crit = "";
        try { crit = d.getCriteriaType() + " " + JSON.stringify(d.getCriteriaValues()); } catch (e) { }
        line("data validation  " + a1(dvl[i][0], dvl[i][1]) + "  " + crit);
      }
      if (!cfr.length)
        line("conditional formats: none reported by this engine. Absence here is weaker " +
             "evidence than presence -- verify before creating one.");
      for (i = 0; i < cfr.length; i++) {
        if (!cfr[i]) { line("conditional format  <exists, unreadable by this engine>"); continue; }
        var rs = "", bc = null;
        try { rs = cfr[i].getRanges().map(function (x) { return x.getA1Notation(); }).join(","); } catch (e) { }
        try { bc = cfr[i].getBooleanCondition(); } catch (e) { }
        line("conditional format  " + (rs || "<range unknown>") + "  " +
             (bc ? bc.getCriteriaType() + " " + JSON.stringify(bc.getCriteriaValues())
                 : "<condition not exposed for rules parsed from an imported file; " +
                   "the RULE EXISTS on this range -- do not create a second one>"));
      }
    }

    /* PERIOD AXIS -- explicit banner is PRIMARY; any derived seam is secondary and flagged */
    var BAN = /^(actuals?|forecast|projected|historical|budget|plan|estimated?)$/i;
    for (bi = 0; bi < bands.length; bi++) {
      var done = false;
      for (r = bands[bi][0]; r <= bands[bi][1] && !done; r++) {
        var hits = [];
        for (c = 1; c <= LC; c++) { var tb = txt(r, c); if (tb && BAN.test(tb)) hits.push([c, tb]); }
        if (hits.length >= 2) {
          sec("PERIOD AXIS BANNER  " + S + "   " + regionOf(r) + "   (a row of period labels)");
          line("row " + r + "  " + hits.map(function (h) { return a1(r, h[0]) + " '" + h[1] + "'"; }).join("   "));
          for (var r3 = r + 1; r3 <= Math.min(r + 3, bands[bi][1]); r3++) {
            var lit = [], fml = [];
            for (c = 1; c <= LC; c++) {
              if (V[r3 - 1][c - 1] === "" || V[r3 - 1][c - 1] === null) continue;
              (F[r3 - 1][c - 1] ? fml : lit).push(c);
            }
            if (lit.length && fml.length) {
              line("row " + r3 + " derived seam: literals cols " + lit[0] + "-" + lit[lit.length - 1] +
                   ", formulas cols " + fml[0] + "-" + fml[fml.length - 1]);
              line("  [where the banner and this seam disagree, the BANNER wins: some models");
              line("   hold formulas on the actuals side and literals on the forecast side]");
              break;
            }
          }
          done = true;
        }
      }
    }

    /* PERIOD AXIS -- the dated/period header row itself */
    var PERIOD = /^(FY)?\s*(19|20)\d{2}\s*[AEP]?$|^Q[1-4][\s\-\/]?((19|20)\d{2})?$/i;
    for (bi = 0; bi < bands.length; bi++) {
      var found = false;
      for (r = bands[bi][0]; r <= bands[bi][1] && !found; r++) {
        var dts = [], labs = [], isDate = false;
        for (c = 1; c <= LC; c++) {
          var pv = V[r - 1][c - 1];
          if (pv instanceof Date) { dts.push(c); labs.push(fmtDate(pv)); isDate = true; }
          else if (typeof pv === "string" && PERIOD.test(pv.trim())) { dts.push(c); labs.push(pv.trim()); }
        }
        if (dts.length >= 4) {
          sec("PERIOD AXIS  " + S + "   " + regionOf(r));
          line("row " + r + "  " + a1(r, dts[0]) + ":" + a1(r, dts[dts.length - 1]) +
               "  n=" + dts.length + (isDate ? "  [dates]" : "  [TEXT labels, not dates]"));
          line("labels " + labs.join(" "));
          if (isDate) {
            var d0 = V[r - 1][dts[0] - 1], d1 = V[r - 1][dts[1] - 1];
            if (d0 instanceof Date && d1 instanceof Date) axes.push({ s: S, r: r, c0: dts[0], c1: dts[dts.length - 1], a: d0.getTime(),
                        step: Math.round((d1 - d0) / 86400000) });
          }
          found = true;
        }
      }
    }

    /* CHECKS -- forward-looking: a check reading 0 today still breaks after your write */
    var chk = [];
    for (r = 1; r <= LR; r++) {
      var lab = (txt(r, 1) + " " + txt(r, 2) + " " + txt(r, 3)).toLowerCase();
      if (!/check|balance|tie|must equal|diff/.test(lab)) continue;
      for (c = 1; c <= LC; c++)
        /* a check evaluates to a NUMBER -- a formula returning text is a heading whose
           label merely matched (task_11's F53 = $F$6 reading "Reporting Units:") */
        if (F[r - 1][c - 1] && typeof V[r - 1][c - 1] === "number") { chk.push([r, c]); break; }
    }
    if (chk.length) {
      if (!timeLeft()) { note("CHECKS+"); break optional; }
      sec("CHECKS  " + S + "   (labelled check/balance/tie rows that read cells you may edit)");
      for (i = 0; i < chk.length; i++)
        line(a1(chk[i][0], chk[i][1]) + "  " + regionOf(chk[i][0]) + "  " +
             F[chk[i][0] - 1][chk[i][1] - 1] + "  now=" + V[chk[i][0] - 1][chk[i][1] - 1]);
    }


    /* ---- TWIN: the same block laid out twice, history above forecast ----
       Financial models repeat a structure: the past filled in, the future blank, same
       labels. Where that holds, the historical row IS the shape of the forecast row, and
       its VALUE is the order of magnitude. Measured on task_15: rows 105-191 mirror 5-91
       at +100, 56/56 labels equal, and 35 of the 56 correct formulas are the historical
       formula shifted. It also catches an annual figure written monthly as a 16x break --
       which every reconciliation cell in that workbook misses. */
    var rowLab = [];
    for (r = 1; r <= LR; r++) {
      var lb = "";
      for (c = 1; c <= Math.min(LC, 6) && !lb; c++) lb = txt(r, c);
      rowLab[r] = lb ? lb.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
    }
    var byLab = Object.create(null);
    for (r = 1; r <= LR; r++) if (rowLab[r] && rowLab[r].length > 3)
      (byLab[rowLab[r]] = byLab[rowLab[r]] || []).push(r);
    /* MEASURE BEFORE PAIRING. A twin repeats a label once per copy of the block. A label
       repeating thousands of times is a DATA VALUE in a transaction column, and pairing
       those is quadratic. Report the size that stopped us rather than vanishing. */
    /* A bucket too big to pair is not nothing -- it is either a REPEATING BLOCK (the same
       label every k rows, which is a structure worth naming) or a DATA COLUMN (a value
       repeated irregularly). Both are answered by walking the bucket once, O(n), and both
       are more useful than refusing. Only the pairing is quadratic, so only it is skipped. */
    var bigLabs = [];
    for (var dk in byLab) {
      if (byLab[dk].length <= 40) continue;
      var rowsB = byLab[dk], steps = {}, domN = 0, domS = 0;
      for (i = 1; i < rowsB.length; i++) {
        var st2 = rowsB[i] - rowsB[i - 1];
        steps[st2] = (steps[st2] || 0) + 1;
        if (steps[st2] > domN) { domN = steps[st2]; domS = st2; }
      }
      bigLabs.push({ lab: dk, n: rowsB.length, lo: rowsB[0], hi: rowsB[rowsB.length - 1],
                     step: domS, reg: domN / (rowsB.length - 1) });
      delete byLab[dk];
    }
    if (bigLabs.length) {
      bigLabs.sort(function (x, y) { return y.n - x.n; });
      if (!timeLeft()) { note("REPEATS+"); break optional; }
      sec("REPEATS  " + S + "   (row labels occurring too often to be section headings)");
      for (i = 0; i < bigLabs.length; i++) {
        var bl = bigLabs[i];
        line("'" + bl.lab + "'  x" + bl.n + "  rows " + bl.lo + "-" + bl.hi +
             (bl.reg >= 0.9
               ? "  every " + bl.step + " rows"
               : "  irregular spacing"));
      }
      line("[twin-pairing skipped for these: it is quadratic in the repeat count and a");
      line(" transaction value is not a section heading. The rows are summarised above.]");
    }
    function rowHasFormula(row) {
      for (var cc = 1; cc <= LC; cc++) if (F[row - 1][cc - 1]) return true;
      return false;
    }
    function rowFilled(row) {
      var n = 0;
      for (var cc = 1; cc <= LC; cc++) if (V[row - 1][cc - 1] !== "" && V[row - 1][cc - 1] !== null) n++;
      return n;
    }
    var offs = {};
    for (var lk in byLab) {
      var rs = byLab[lk];
      for (i = 0; i < rs.length; i++) for (var j2 = i + 1; j2 < rs.length; j2++) {
        var k2 = rs[j2] - rs[i];
        if (k2 > 2) (offs[k2] = offs[k2] || []).push([rs[i], rs[j2]]);
      }
    }
    var bestK = 0, bestPairs = null;
    for (var ko in offs) {
      var pr = offs[ko], live = [];
      for (i = 0; i < pr.length; i++)
        if (rowFilled(pr[i][0]) >= 3 && rowFilled(pr[i][1]) < rowFilled(pr[i][0])) live.push(pr[i]);
      if (live.length >= 5 && (!bestPairs || live.length > bestPairs.length)) { bestK = +ko; bestPairs = live; }
    }
    if (bestPairs) {
      if (!timeLeft()) { note("TWIN+"); break optional; }
      sec("TWIN  " + S + "   [a filled block and an emptier one share " + bestPairs.length +
          " row labels at offset +" + bestK + "]");
      line("same labels, " + bestK + " rows apart. Source rows are populated; target rows are not.");
      for (i = 0; i < bestPairs.length; i++) {
        var sR = bestPairs[i][0], tR = bestPairs[i][1], ex = "";
        for (c = 1; c <= LC && !ex; c++) if (F[sR - 1][c - 1]) ex = a1(sR, c) + " = " + F[sR - 1][c - 1];
        if (!ex) for (c = 1; c <= LC && !ex; c++)
          if (typeof V[sR - 1][c - 1] === "number") ex = a1(sR, c) + " = " + V[sR - 1][c - 1];
        line("r" + sR + " -> r" + tR + "  '" + (rowLab[sR] ? txt(sR, 1) || txt(sR, 2) || rowLab[sR] : "") +
             "'  source " + (ex || "(empty)"));
      }
    }


    /* ---- IDENTITIES: arithmetic that holds in every already-filled column ----
       Where several columns are fully typed-in history, a relationship that holds in ALL
       of them is the workbook's own arithmetic, proven before you write anything. task_02:
       columns E,F,G give r9=r5-r7, r17=r9-r15, r15=SUM(r12:r14) and five more -- 8 of its
       17 output rows, settled without reference to any answer. */
    var anchCols = [];
    for (c = 1; c <= LC; c++) {
      var lit = 0, fml = 0;
      for (r = 1; r <= LR; r++) {
        if (F[r - 1][c - 1]) fml++;
        else if (typeof V[r - 1][c - 1] === "number") lit++;
      }
      if (lit >= 5 && fml <= 1) anchCols.push(c);
    }
    if (anchCols.length >= 2) {
      var rowsN = [];
      for (r = 1; r <= LR; r++) {
        var ok = true;
        for (i = 0; i < anchCols.length; i++)
          if (typeof V[r - 1][anchCols[i] - 1] !== "number") { ok = false; break; }
        if (ok) rowsN.push(r);
        if (rowsN.length > 60) break;
      }
      if (rowsN.length > 60) {
        sec("IDENTITIES  " + S + "   [NOT COMPUTED]");
        line(rowsN.length + " rows are numeric in every filled column; the relation search is");
        line("cubic in that count. Mine identities yourself on the block you care about.");
        rowsN = [];
      }
      function holds(fn) {
        for (var q = 0; q < anchCols.length; q++) if (!fn(anchCols[q])) return false;
        return true;
      }
      function val(row, col) { return V[row - 1][col - 1]; }
      function near(a, b) { return Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-9; }
      var ids = [], idSeen = {};
      /* a relation is most useful when its TARGET row is one you still have to write */
      function unwritten(row) {
        for (var cc = 1; cc <= LC; cc++)
          if (anchCols.indexOf(cc) < 0 && (V[row - 1][cc - 1] === "" || V[row - 1][cc - 1] === null)) return true;
        return false;
      }
      var targetsN = rowsN.slice(); // retain ascending rows for contiguous SUM searches
      targetsN.sort(function (x, y) { return (unwritten(y) ? 1 : 0) - (unwritten(x) ? 1 : 0); });
      for (i = 0; i < rowsN.length && ids.length < 14; i++) {
        var ra = targetsN[i];
        /* a = SUM(contiguous run) */
        for (var j3 = 0; j3 < rowsN.length && ids.length < 14; j3++) {
          for (var k3 = j3 + 1; k3 < rowsN.length; k3++) {
            var lo = rowsN[j3], hi = rowsN[k3];
            if (lo <= ra && ra <= hi) continue;
            if (hi - lo > 12) break;
            if (holds(function (cc) {
              var acc = 0;
              for (var z = lo; z <= hi; z++) { var vv = val(z, cc); if (typeof vv !== "number") return false; acc += vv; }
              return near(acc, val(ra, cc));
            })) { ids.push("r" + ra + " = SUM(r" + lo + ":r" + hi + ")"); j3 = rowsN.length; break; }
          }
        }
        /* a = b - c */
        for (var j4 = 0; j4 < rowsN.length && ids.length < 14; j4++)
          for (var k4 = 0; k4 < rowsN.length; k4++) {
            var rb = rowsN[j4], rc2 = rowsN[k4];
            if (rb === ra || rc2 === ra || rb === rc2) continue;
            if (holds(function (cc) { return near(val(rb, cc) - val(rc2, cc), val(ra, cc)); })) {
              /* a=b-c, b=a+c and c=b-a are ONE fact. Key on the sorted triple so the same
                 relation is stated once, in the direction whose target is unwritten. */
              var tri = [ra, rb, rc2].sort(function (x, y) { return x - y; }).join(",");
              if (!idSeen[tri]) { idSeen[tri] = 1; ids.push("r" + ra + " = r" + rb + " - r" + rc2); }
              j4 = rowsN.length; break;
            }
          }
      }
      if (ids.length) {
        sec("IDENTITIES  " + S + "   (holds in EVERY filled column: " +
            anchCols.map(colLetter).join(",") + ")");
      line("relations holding to 1e-9 in every column listed above.");
        for (i = 0; i < ids.length; i++) {
          var rn = +ids[i].slice(1).split(" ")[0];
          line(ids[i] + "   '" + (txt(rn, 1) || txt(rn, 2) || txt(rn, 3) || "") + "'");
        }
      }
    }

    /* ---- ANCHORS: constants that sum to another constant ----
       An inputs column where one figure equals the sum of the run beneath it tells you
       what those figures MEAN. task_10: Drivers!C37=914 and C38:C43 sum to exactly 914,
       which settles whether the last line is a per-year or a whole-period figure. Visible
       before any work; the wrong reading is what a plain reading of the label invites. */
    var cons = [], consSkipped = [];
    for (c = 1; c <= LC; c++) {
      /* A constant equalling the run beneath it is meaningful in an ASSUMPTIONS column of
         a few dozen numbers (task_10's Drivers!C37 = 914 = SUM(C38:C43)). In a data column
         of thousands it happens by chance -- task_03's transaction quantities produced 140
         coincidences. Count the column's literals first and say when one is skipped. */
      var nlit = 0;
      for (r = 1; r <= LR; r++)
        if (!F[r - 1][c - 1] && typeof V[r - 1][c - 1] === "number") nlit++;
      if (nlit > 200) { if (nlit) consSkipped.push(colLetter(c) + "(" + nlit + ")"); continue; }
      for (r = 1; r <= LR; r++) {
        var K = V[r - 1][c - 1];
        if (typeof K !== "number" || Math.abs(K) <= 1.5 || F[r - 1][c - 1]) continue;
        var acc = 0, run = 0;
        for (var r3 = r + 1; r3 <= Math.min(LR, r + 40); r3++) {
          var x2 = V[r3 - 1][c - 1];
          if (typeof x2 !== "number" || F[r3 - 1][c - 1] || x2 === 0) break;
          acc += x2; run++;
          if (run >= 3 && Math.abs(acc - K) <= Math.abs(K) * 1e-9) {
            cons.push([r, c, r + 1, r3, K]); r3 = LR + 1;
          }
        }
      }
    }
    if (cons.length || consSkipped.length) {
      if (!timeLeft()) { note("ANCHORS+"); break optional; }
      sec("ANCHORS  " + S + "   (a constant equal to the sum of the run below it)");
      if (consSkipped.length)
        line("[not searched in data columns " + consSkipped.join(",") +
             " -- with that many literals a matching sum is chance, not structure]");
      for (i = 0; i < cons.length; i++) {
        var cn = cons[i];
        line(a1(cn[0], cn[1]) + " = " + cn[4] + " = SUM(" + a1(cn[2], cn[1]) + ":" + a1(cn[3], cn[1]) +
             ")  '" + (txt(cn[0], 1) || txt(cn[0], 2) || "") + "'");
      }
    }

    /* LABELS -- region-scoped, plus a global string index with collisions */
    var idx = Object.create(null), distinctByCol = {};
    for (r = 1; r <= LR; r++) for (c = 1; c <= LC; c++) {
      var tv = txt(r, c);
      if (!tv) continue;
      (idx[tv] = idx[tv] || []).push([r, c]);
      (distinctByCol[c] = distinctByCol[c] || Object.create(null))[tv] = 1;
    }
    var datacols = {}, dcn = [];
    for (c in distinctByCol) if (Object.keys(distinctByCol[c]).length > 50) { datacols[c] = 1; dcn.push(colLetter(+c)); }
    var ikeys = Object.keys(idx).filter(function (t) {
      if (idx[t].every(function (p) { return datacols[p[1]]; })) return false;
      /* all on ONE row = a repeated data value across columns ('N/A' x13), not two
         different things sharing a name. Only cross-row repeats are real collisions. */
      if (idx[t].length > 2) {
        var r0 = idx[t][0][0], sameRow = true;
        for (var q = 1; q < idx[t].length; q++) if (idx[t][q][0] !== r0) { sameRow = false; break; }
        if (sameRow) return false;
      }
      return true;
    });
    if (ikeys.length) {
      if (!timeLeft()) { note("LABELS+"); break optional; }
      sec("LABELS  " + S + "   (non-data text, region-scoped)");
      if (dcn.length)
        line("[cols " + dcn.join(",") + " hold >50 distinct strings each = DATA columns; not indexed]");
      ikeys.sort(function (x, y) { return idx[y].length - idx[x].length || (x < y ? -1 : 1); });
      for (i = 0; i < ikeys.length; i++) {
        var ks = idx[ikeys[i]];
        var w = ks.length <= 12
          ? ks.map(function (p) { return a1(p[0], p[1]) + " " + regionOf(p[0]); }).join("  ")
          : extent(ks);
        line("'" + ikeys[i] + "' -> " + w +
             (ks.length > 1 && ks.length <= 12 ? "  [COLLISION]" : ""));
      }
    }
    }   /* end optional: */
  }

  /* CROSS-SHEET AXIS ALIGNMENT -- two sheets whose period axes share anchor AND step.
     This is what licenses column-parallel SUMIFs instead of a date lookup. */
  if (axes.length > 1 && (timeLeft() || !note("AXIS ALIGN"))) {
    sec("AXIS ALIGN  cross-sheet period axes");
    for (i = 0; i < axes.length; i++)
      for (var j = i + 1; j < axes.length; j++)
        if (axes[i].a === axes[j].a && axes[i].step === axes[j].step)
          line("'" + axes[i].s + "' row " + axes[i].r + " || '" + axes[j].s + "' row " + axes[j].r +
               "  SAME anchor " + fmtDate(new Date(axes[i].a)) + "  SAME step " + axes[i].step +
               "d  col offset " + (axes[j].c0 - axes[i].c0));
    for (i = 0; i < axes.length; i++)
      line("'" + axes[i].s + "' row " + axes[i].r + "  " + a1(axes[i].r, axes[i].c0) + ":" +
           a1(axes[i].r, axes[i].c1) + "  anchor " + fmtDate(new Date(axes[i].a)) + "  step " + axes[i].step + "d");
  }

  /* GRAPH -- flat cross-sheet pulls. Same-sheet chains are already visible in BLOCKS. */
  var edges = {};
  for (si = 0; si < meta.length; si++) {
    if (!meta[si].formulas) continue;
    var FF = meta[si].formulas, nm = meta[si].name;
    for (r = 0; r < FF.length; r++) for (c = 0; c < FF[r].length; c++) {
      if (!FF[r][c]) continue;
      var mm, RE = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!/g;
      while ((mm = RE.exec(FF[r][c])) !== null) {
        var tgt = mm[1] || mm[2];
        if (tgt && tgt !== nm) { var k2 = nm + " -> " + tgt; edges[k2] = (edges[k2] || 0) + 1; }
      }
    }
  }


  /* ---- CONTROL TOTALS: two blocks aggregating the same raw rectangle ----
     When one block totals a raw data region by rows and another totals the same region by
     something else, the two must agree -- nobody labels this, and it is the only way to
     verify a large aggregation from inside the workbook. task_04: the grid you must build
     over 'Data Set' has a sibling block already totalling that same rectangle by year, so
     every column and row total of your work has an independent counterpart. */
  var aggBlocks = [];
  for (si = 0; si < meta.length; si++) {
    var MA = meta[si];
    if (!MA.formulas || !MA.lr) continue;
    var FA = MA.formulas, an = MA.name, seen = {};
    for (r = 0; r < FA.length; r++) for (c = 0; c < FA[r].length; c++) {
      var fa = FA[r][c];
      if (!fa || !/SUM|SUMIF|SUMIFS|SUMPRODUCT|COUNTIF/i.test(fa)) continue;
      var mk2 = maskStrings(fa)[0], mm2, best = null;
      REF_RE.lastIndex = 0;
      var pts = [];
      while ((mm2 = REF_RE.exec(mk2)) !== null) {
        if (isWordChar(mk2.charAt(mm2.index - 1))) continue;
        var af = mk2.charAt(mm2.index + mm2[0].length);
        if (af === "(" || /[A-Za-z0-9_]/.test(af || "")) continue;
        pts.push([(mm2[1] || mm2[2] || an), colIndex(mm2[4]), +mm2[6]]);
      }
      /* the source is the sheet this formula pulls the most cells from */
      var cnt = {};
      for (i = 0; i < pts.length; i++) cnt[pts[i][0]] = (cnt[pts[i][0]] || 0) + 1;
      var srcSheet = null, bestN = 0;
      for (var sk2 in cnt) if (cnt[sk2] > bestN) { bestN = cnt[sk2]; srcSheet = sk2; }
      if (!srcSheet || bestN < 2) continue;
      var lo2 = null, hi2 = null;
      for (i = 0; i < pts.length; i++) if (pts[i][0] === srcSheet) {
        if (lo2 === null || pts[i][2] < lo2) lo2 = pts[i][2];
        if (hi2 === null || pts[i][2] > hi2) hi2 = pts[i][2];
      }
      if (hi2 - lo2 < 20) continue;                       /* only real data rectangles */
      var kk = an + "|" + srcSheet + "!" + lo2 + "-" + hi2;
      if (seen[kk]) { seen[kk].n++; continue; }
      seen[kk] = { host: an, src: srcSheet, lo: lo2, hi: hi2, n: 1, eg: a1(r + 1, c + 1), f: fa };
      aggBlocks.push(seen[kk]);
    }
  }
  var pairs = [];
  for (i = 0; i < aggBlocks.length; i++) for (var j5 = i + 1; j5 < aggBlocks.length; j5++) {
    var A1b = aggBlocks[i], B1b = aggBlocks[j5];
    if (A1b.src !== B1b.src) continue;
    if (Math.max(A1b.lo, B1b.lo) > Math.min(A1b.hi, B1b.hi)) continue;   /* must overlap */
    if (A1b.n < 10 && B1b.n < 10) continue;
    pairs.push([A1b, B1b]);
  }
  /* one line per (host, host, source): the same pair reappears at every row span it was
     sampled at, and six restatements of one fact is noise, not recall. */
  var pseen = {}, merged = [];
  for (i = 0; i < pairs.length; i++) {
    var pk = pairs[i][0].host + "|" + pairs[i][1].host + "|" + pairs[i][0].src;
    var ov = [Math.max(pairs[i][0].lo, pairs[i][1].lo), Math.min(pairs[i][0].hi, pairs[i][1].hi)];
    if (!pseen[pk]) { pseen[pk] = { p: pairs[i], lo: ov[0], hi: ov[1] }; merged.push(pseen[pk]); }
    else { pseen[pk].lo = Math.min(pseen[pk].lo, ov[0]); pseen[pk].hi = Math.max(pseen[pk].hi, ov[1]); }
  }
  pairs = merged;
  if (pairs.length && (timeLeft() || !note("RELATED AGGREGATIONS"))) {
    sec("RELATED AGGREGATIONS  blocks whose formulas read overlapping rows of one source");
    line("CANDIDATES ONLY. The operation, the columns and the criteria are NOT compared, so");
    line("two entries here may count different things (COUNTIF of customers vs SUMIF of");
    line("revenue) and need not be equal. Read both formulas before relying on either.");
    for (i = 0; i < pairs.length; i++) {
      var pa = pairs[i].p[0], pb = pairs[i].p[1];
      line("'" + pa.src + "' rows " + pairs[i].lo + "-" + pairs[i].hi + "  read by:");
      line("    '" + pa.host + "' n=" + pa.n + "  " + pa.eg + " = " + String(pa.f).slice(0, 70));
      line("    '" + pb.host + "' n=" + pb.n + "  " + pb.eg + " = " + String(pb.f).slice(0, 70));
    }
  }

  /* ---- CONSUMERS: which cells anything actually depends on ----
     A cell that nothing reads is a dead end -- a leftover, or a decoy. A cell five other
     cells read is load-bearing. When a task names a quantity and two cells both look like
     it, this is what separates them. task_09: D24 is read by nothing, L24 is read by D29
     and feeds the discount rate; the agent overwrote the live one on all five attempts,
     and the dead one was what it had been asked to clear. */
  var consumed = {}, refSkipped = [];
  for (si = 0; si < meta.length; si++) {
    if (!meta[si].formulas) continue;
    /* MEASURE FIRST: every formula is scanned for references. Report any sheet too big to
       index rather than dropping it silently -- a missing sheet here would read as "nothing
       depends on these cells", which is the opposite of the truth. */
    if (meta[si].nf > 60000) { refSkipped.push(meta[si].name + " (" + meta[si].nf + " formulas)"); continue; }
    var FC = meta[si].formulas, hn = meta[si].name;
    for (r = 0; r < FC.length; r++) for (c = 0; c < FC[r].length; c++) {
      if (!FC[r][c]) continue;
      var hol = maskStrings(FC[r][c])[0], mr, hits = [];
      REF_RE.lastIndex = 0;
      while ((mr = REF_RE.exec(hol)) !== null) {
        /* same boundary guards toR1C1 uses: LOG10/DAYS360 are not cell refs */
        if (isWordChar(hol.charAt(mr.index - 1))) continue;
        var aft = hol.charAt(mr.index + mr[0].length);
        if (aft === "(" || /[A-Za-z0-9_]/.test(aft || "")) continue;
        hits.push({ sh: mr[1] || mr[2], c: colIndex(mr[4]), r: +mr[6],
                    i: mr.index, len: mr[0].length });
      }
      /* Walk the matches so a RANGE marks every cell it covers. SUM(E40:G40) reads F40,
         and counting only the endpoints reported F40 as referenced by nothing -- a false
         "no reference" on a live cell is the most harmful thing this layer can say.
         A range also writes its sheet once (Data!C5:C50), so the end cell inherits it. */
      for (var hi2 = 0; hi2 < hits.length; hi2++) {
        var A = hits[hi2], B = hits[hi2 + 1];
        var joined = B && hol.charAt(A.i + A.len) === ":" && B.i === A.i + A.len + 1;
        var ash = A.sh || hn;
        if (joined) {
          for (var rr1 = Math.min(A.r, B.r); rr1 <= Math.max(A.r, B.r); rr1++)
            for (var cc1 = Math.min(A.c, B.c); cc1 <= Math.max(A.c, B.c); cc1++) {
              var kk2 = ash + "!" + a1(rr1, cc1);
              consumed[kk2] = (consumed[kk2] || 0) + 1;
            }
          hi2++;
        } else {
          var k1 = ash + "!" + a1(A.r, A.c);
          consumed[k1] = (consumed[k1] || 0) + 1;
        }
      }
    }
  }
  var deadRows = [];
  for (si = 0; si < meta.length; si++) {
    var MM = meta[si];
    if (!MM.formulas || !MM.lr) continue;
    var FD = MM.formulas, snm = MM.name;
    for (r = 1; r <= Math.min(MM.lr, 400); r++) {
      var live = [], dead = [];
      for (c = 1; c <= MM.lc; c++) {
        if (!FD[r - 1][c - 1]) continue;
        var n2 = consumed[snm + "!" + a1(r, c)] || 0;
        (n2 > 0 ? live : dead).push([a1(r, c), n2]);
      }
      /* only interesting where the SAME row holds both -- side-by-side alternatives */
      if (dead.length && live.length && dead.length + live.length <= 8)
        deadRows.push([snm, r, live, dead]);
    }
  }
  if ((deadRows.length || refSkipped.length) && (timeLeft() || !note("CONSUMERS"))) {
    sec("CONSUMERS  formula cells with no direct reference detected, beside cells with one");
    if (refSkipped.length)
      line("[NOT INDEXED: " + refSkipped.join(", ") + " -- too many formulas to scan. " +
           "Cells on those sheets are absent below; absence here is NOT evidence nothing reads them.]");
    line("how many formulas reference each cell. 0 = no DIRECT reference detected; refs via\n  defined names or INDIRECT are not traced, so 0 is not proof nothing reads it.");
    for (i = 0; i < deadRows.length; i++) {
      var dr = deadRows[i];
      line(dr[0] + " r" + dr[1] + "   read: " +
           dr[2].map(function (x) { return x[0] + "(" + x[1] + ")"; }).join(" ") +
           "   |   NO DIRECT REF: " + dr[3].map(function (x) { return x[0]; }).join(" "));
    }
  }

  var ek = Object.keys(edges).sort(function (x, y) { return edges[y] - edges[x]; });
  if (ek.length && (timeLeft() || !note("GRAPH"))) {
    sec("GRAPH  cross-sheet pulls");
    for (i = 0; i < ek.length; i++) line(ek[i] + "   " + edges[ek[i]] + " refs");
  }

  /* assemble under budget: drop WHOLE LAYERS, loudly. Never truncate mid-list -- silent
     truncation is the failure this map exists to eliminate. */
  function render(maxPri) {
    var o = [];
    for (var x = 0; x < SECS.length; x++)
      if (SECS[x].lines.length && SECS[x].pri <= maxPri)
        o.push("", SECS[x].label, SECS[x].lines.join("\n"));
    return o.join("\n").replace(/^\n+/, "") + "\n";
  }
  var lim = 5, out = render(lim), dropped = [];
  while (out.length > MAP_CAP && lim > 0) {
    for (i = 0; i < SECS.length; i++)
      if (SECS[i].pri === lim && SECS[i].lines.length) {
        var nmx = SECS[i].label.split(" ")[0];
        if (dropped.indexOf(nmx) < 0) dropped.push(nmx);
      }
    lim--; out = render(lim);
  }
  /* Priority-0 layers are never dropped, so the loop CAN exit still over cap. Saying
     "dropped layers to fit" then would be a false statement about the very thing this
     map exists to be honest about. Report what actually happened, either way. */
  if (out.length > MAP_CAP) {
    out += "\n[BUDGET: this map is " + out.length + " bytes, OVER the " + MAP_CAP +
           "-byte target" + (dropped.length ? " even after dropping " + dropped.join(", ") : "") +
           ". Nothing was cut mid-list and no undroppable layer was removed: the map is " +
           "COMPLETE, just large. Read it all.]\n";
  } else if (dropped.length) {
    out += "\n[BUDGET: dropped whole layers to fit " + MAP_CAP + " bytes: " +
           dropped.join(", ") + ". Nothing was cut mid-list.]\n";
  }
  /* Say what the clock cost, in the map the model reads. A map that is quietly thinner
     than usual is worse than a small one: the agent cannot tell "this workbook has no
     such layer" from "we ran out of time". */
  if (CAPPED.length)
    out += "\n[ROW CAP: this workbook is too large to analyse whole inside the execution " +
           "limit, so each layer above describes only a PREFIX of these sheets: " +
           CAPPED.join("; ") + ". Rows past the prefix exist and are NOT described here -- " +
           "read them directly. Structure usually repeats, but verify before assuming it.]\n";
  if (SKIPPED.length)
    out += "\n[TIME BUDGET: " + Math.round((Date.now() - T0) / 1000) + "s of a " +
           (budgetMs / 1000) + "s budget spent; these layers were NOT computed: " +
           SKIPPED.join(", ") + ". Their absence says nothing about the workbook -- read " +
           "those ranges directly if you need them.]\n";
  return out;
}

/* Render a set of cells COMPLETELY but compactly. Listing 20,577 addresses for one
   repeated string is not detail, it is noise -- and cutting the list silently is worse.
   Few cells: name them. Many: give the count, the bounding box and the columns, which
   describes every one of them without enumerating any. Used by every layer that can face
   a data region. */
function extent(cells, limit) {
  if (cells.length <= (limit || 12))
    return cells.map(function (p) { return a1(p[0], p[1]); }).join(" ");
  var b = bboxOf(cells), cols = {}, cn = [];
  for (var i = 0; i < cells.length; i++)
    if (!cols[cells[i][1]]) { cols[cells[i][1]] = 1; cn.push(colLetter(cells[i][1])); }
  cn.sort();
  return "x" + cells.length + " in " + bboxStr(b) +
         (cn.length <= 6 ? "  cols " + cn.join(",") : "  across " + cn.length + " cols");
}

/* ---------- A1 <-> R1C1 <-> skeleton ---------- */
/* Boundary-guarded so digit-suffixed function names (LOG10, DAYS360, DEC2BIN) are not
   parsed as cell references. String literals are masked out first. */
var REF_RE = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_]*))!)?(\$?)([A-Z]{1,3})(\$?)([0-9]+)/g;

function maskStrings(f) {
  var holes = [];
  return [f.replace(/"(?:[^"]|"")*"/g, function (m) {
    holes.push(m); return "\u0000" + (holes.length - 1) + "\u0000";
  }), holes];
}
function unmask(f, holes) {
  return f.replace(/\u0000(\d+)\u0000/g, function (_, i) { return holes[+i]; });
}
function isWordChar(ch) { return ch && /[A-Za-z0-9_.]/.test(ch); }

function toR1C1(f, row, col) {
  var mk = maskStrings(f), s = mk[0];
  s = s.replace(REF_RE, function (m, q, bare, ad, cl, ar, rw, off, whole) {
    if (isWordChar(whole.charAt(off - 1))) return m;
    var after = whole.charAt(off + m.length);
    if (after === "(" || /[A-Za-z0-9_]/.test(after || "")) return m;
    var ci = colIndex(cl), ri = parseInt(rw, 10);
    var cs = ad ? "C" + ci : (ci !== col ? "C[" + (ci - col) + "]" : "C");
    var rs = ar ? "R" + ri : (ri !== row ? "R[" + (ri - row) + "]" : "R");
    return (q ? "'" + q + "'!" : (bare ? bare + "!" : "")) + rs + cs;
  });
  return unmask(s, mk[1]);
}

function skeleton(f) {
  var mk = maskStrings(f), s = mk[0];
  s = s.replace(REF_RE, function (m, q, bare, ad, cl, ar, rw, off, whole) {
    if (isWordChar(whole.charAt(off - 1))) return m;
    var after = whole.charAt(off + m.length);
    if (after === "(" || /[A-Za-z0-9_]/.test(after || "")) return m;
    return "@";
  });
  s = s.replace(/(?:'[^']+'!|[A-Za-z_][A-Za-z0-9_]*!)?R(\[-?\d+\])?C(\[-?\d+\])?/g, "@");
  return unmask(s, mk[1]);
}

/* ---------- geometry ---------- */
function colLetter(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
function colIndex(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
function a1(r, c) { return colLetter(c) + r; }
function bboxOf(cells) {
  var r0 = cells[0][0], c0 = cells[0][1], r1 = r0, c1 = c0;
  for (var i = 1; i < cells.length; i++) {
    if (cells[i][0] < r0) r0 = cells[i][0]; if (cells[i][0] > r1) r1 = cells[i][0];
    if (cells[i][1] < c0) c0 = cells[i][1]; if (cells[i][1] > c1) c1 = cells[i][1];
  }
  return [r0, c0, r1, c1];
}
function bboxStr(b) { return a1(b[0], b[1]) + ":" + a1(b[2], b[3]); }
function fmtDate(d) {
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}
/* rect | staircase | row | col | cell | sparse. Observation only -- never a domain claim. */
function shapeOf(cells) {
  if (cells.length === 1) return "cell";
  var b = bboxOf(cells), h = b[2] - b[0] + 1, w = b[3] - b[1] + 1;
  if (cells.length === h * w) return h === 1 ? "row" : (w === 1 ? "col" : "rect");
  var byRow = {};
  for (var i = 0; i < cells.length; i++) (byRow[cells[i][0]] = byRow[cells[i][0]] || []).push(cells[i][1]);
  var rows = Object.keys(byRow).map(Number).sort(function (x, y) { return x - y; });
  var starts = [], ends = [];
  for (i = 0; i < rows.length; i++) {
    var cs = byRow[rows[i]].sort(function (x, y) { return x - y; });
    if (cs.length !== cs[cs.length - 1] - cs[0] + 1) return "sparse";
    starts.push(cs[0]); ends.push(cs[cs.length - 1]);
  }
  function uniqDiff(a) { var d = {}; for (var k = 0; k + 1 < a.length; k++) d[a[k + 1] - a[k]] = 1; return Object.keys(d); }
  function allSame(a) { for (var k = 1; k < a.length; k++) if (a[k] !== a[0]) return false; return true; }
  var ds = uniqDiff(starts), de = uniqDiff(ends);
  if (ds.length === 1 && ds[0] !== "0" && allSame(ends)) return "staircase(step " + ds[0] + " col/row, right-aligned)";
  if (de.length === 1 && de[0] !== "0" && allSame(starts)) return "staircase(step " + de[0] + " col/row, left-aligned)";
  return "sparse";
}
