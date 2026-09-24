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
