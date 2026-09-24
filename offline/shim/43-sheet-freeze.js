/* Frozen rows/columns. mog reports the frozen area as an address range
   ("Sheet1!1:2" = two frozen rows, "Sheet1!A:B" = two frozen columns). */
Sheet.prototype._freezeLocation = function () {
  var id = GAS.nid();
  try {
    var r = GAS.apply([{ op: "freezeLocation", id: id, worksheetId: this._id, nullable: true },
                       { op: "load", id: id, properties: ["address"] }]);
    var info = r.loaded[id];
    return (!info || info.isNullObject || !info.address) ? null : String(info.address).split("!").pop();
  } catch (e) {
    return null;                 // nothing frozen: the location is a null object
  }
};
/* The frozen area comes back in one of three forms:
     "1:2"    -> 2 frozen rows, no frozen columns
     "A:C"    -> 3 frozen columns, no frozen rows
     "A1:C2"  -> both (3 columns, 2 rows)                        */
function parseFrozen(a) {
  if (!a) return { rows: 0, cols: 0 };
  var end = a.split(":").pop();
  var m = /^\$?([A-Z]*)\$?(\d*)$/.exec(end);
  if (!m) return { rows: 0, cols: 0 };
  var cols = 0;
  for (var i = 0; i < m[1].length; i++) cols = cols * 26 + (m[1].charCodeAt(i) - 64);
  return { rows: m[2] ? Number(m[2]) : 0, cols: cols };
}
Sheet.prototype.getFrozenRows = function () { return parseFrozen(this._freezeLocation()).rows; };
Sheet.prototype.getFrozenColumns = function () { return parseFrozen(this._freezeLocation()).cols; };

/* ThemeColor value object (getColorType / getThemeColorType) */
function ThemeColor(t) { this._t = t; }
ThemeColor.prototype.getColorType = function () { return ColorType.THEME; };
ThemeColor.prototype.getThemeColorType = function () { return this._t; };
