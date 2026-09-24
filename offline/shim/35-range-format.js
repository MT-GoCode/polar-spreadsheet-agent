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
