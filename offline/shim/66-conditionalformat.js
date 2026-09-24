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
