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
