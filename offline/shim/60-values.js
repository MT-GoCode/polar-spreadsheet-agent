/* Colour and text-style value objects. Pure JS — no engine involved, so these
   match Apps Script exactly by construction. */
function RgbColor(hex) { this._hex = normaliseHex(hex); }
function normaliseHex(h) {
  /* Apps Script's RgbColor.asHexString() returns SIX-digit hex — verified against real
     Apps Script (SHAPES channel, case color.hex: Google "#3366cc", not "#ff3366cc"). */
  var s = String(h || "#000000").replace("#", "");
  if (s.length === 3) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
  if (s.length === 8) s = s.slice(2);                     // drop any alpha prefix
  return "#" + s.toLowerCase();
}
RgbColor.prototype.asHexString = function () { return this._hex; };
RgbColor.prototype.getRed = function () { return parseInt(this._hex.substr(1, 2), 16); };
RgbColor.prototype.getGreen = function () { return parseInt(this._hex.substr(3, 2), 16); };
RgbColor.prototype.getBlue = function () { return parseInt(this._hex.substr(5, 2), 16); };
RgbColor.prototype.getColorType = function () { return ColorType.RGB; };

function ThemeColorValue(t) { this._t = t; }
ThemeColorValue.prototype.getColorType = function () { return ColorType.THEME; };
ThemeColorValue.prototype.getThemeColorType = function () { return this._t; };
var ThemeColor = ThemeColorValue;      // the surface calls this class ThemeColor

function Color(kind, value) { this._kind = kind; this._value = value; }
Color.prototype.getColorType = function () { return this._kind; };
Color.prototype.asRgbColor = function () {
  if (this._kind !== ColorType.RGB) throw GAS.error("Object is not of type RgbColor.");
  return this._value;
};
Color.prototype.asThemeColor = function () {
  if (this._kind !== ColorType.THEME) throw GAS.error("Object is not of type ThemeColor.");
  return this._value;
};

function ColorBuilder() { this._kind = null; this._value = null; }
ColorBuilder.prototype.setRgbColor = function (hex) { this._kind = ColorType.RGB; this._value = new RgbColor(hex); return this; };
ColorBuilder.prototype.setThemeColor = function (t) { this._kind = ColorType.THEME; this._value = new ThemeColorValue(t); return this; };
ColorBuilder.prototype.getColorType = function () { return this._kind || ColorType.UNSUPPORTED; };
ColorBuilder.prototype.asRgbColor = function () { return Color.prototype.asRgbColor.call(this); };
ColorBuilder.prototype.asThemeColor = function () { return Color.prototype.asThemeColor.call(this); };
ColorBuilder.prototype.build = function () { return new Color(this._kind, this._value); };

function TextStyle(s) { this._s = s || {}; }
TextStyle.prototype.getFontFamily = function () { return this._s.family === undefined ? null : this._s.family; };
TextStyle.prototype.getFontSize = function () { return this._s.size === undefined ? null : this._s.size; };
TextStyle.prototype.getForegroundColor = function () { return this._s.color === undefined ? null : this._s.color; };
TextStyle.prototype.getForegroundColorObject = function () { return this._s.colorObj === undefined ? null : this._s.colorObj; };
TextStyle.prototype.isBold = function () { return this._s.bold === undefined ? null : this._s.bold; };
TextStyle.prototype.isItalic = function () { return this._s.italic === undefined ? null : this._s.italic; };
TextStyle.prototype.isUnderline = function () { return this._s.underline === undefined ? null : this._s.underline; };
TextStyle.prototype.isStrikethrough = function () { return this._s.strikethrough === undefined ? null : this._s.strikethrough; };
TextStyle.prototype.copy = function () { var b = new TextStyleBuilder(); b._s = JSON.parse(JSON.stringify(this._s)); return b; };

function TextStyleBuilder() { this._s = {}; }
TextStyleBuilder.prototype.setBold = function (v) { this._s.bold = v; return this; };
TextStyleBuilder.prototype.setItalic = function (v) { this._s.italic = v; return this; };
TextStyleBuilder.prototype.setUnderline = function (v) { this._s.underline = v; return this; };
TextStyleBuilder.prototype.setStrikethrough = function (v) { this._s.strikethrough = v; return this; };
TextStyleBuilder.prototype.setFontFamily = function (v) { this._s.family = v; return this; };
TextStyleBuilder.prototype.setFontSize = function (v) { this._s.size = v; return this; };
TextStyleBuilder.prototype.setForegroundColor = function (v) { this._s.color = v; return this; };
TextStyleBuilder.prototype.setForegroundColorObject = function (v) { this._s.colorObj = v; return this; };
TextStyleBuilder.prototype.build = function () { return new TextStyle(this._s); };

/* Apps Script returns opaque host objects: String(color) is "Color", ctor is Object. */
Color.prototype.toString = function () { return "Color"; };
Color.prototype.constructor = Object;
TextStyle.prototype.toString = function () { return "TextStyle"; };
TextStyle.prototype.constructor = Object;
