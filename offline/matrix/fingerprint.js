/* Shared by BOTH sides, byte-identical. Any difference in how the two sides are
   fingerprinted would show up as a fake divergence, so this file is concatenated
   into the offline bundle and the online .gs without modification. */
function fingerprint(thunk) {
  try {
    var v = thunk();
    return { ok: true, shape: shapeOf(v) };
  } catch (e) {
    return { ok: false, error: { name: e && e.name, message: String(e && e.message || e) } };
  }
}
function shapeOf(v) {
  if (v === null) return { t: "null" };
  if (v === undefined) return { t: "undefined" };
  var t = typeof v;
  if (t === "number") return { t: "number", v: v };
  if (t === "string") return { t: "string", v: v };
  if (t === "boolean") return { t: "boolean", v: v };
  if (Array.isArray(v)) return { t: "array", n: v.length, items: v.map(shapeOf) };
  if (v instanceof Date) return { t: "date", v: v.toISOString() };
  if (t === "object" || t === "function") {
    // Enum values and API objects: compare identity by toString, not by reference.
    var s; try { s = String(v); } catch (e) { s = "<unstringable>"; }
    return { t: "object", str: s, ctor: (v.constructor && v.constructor.name) || null };
  }
  return { t: t, v: String(v) };
}

/* A case's RESULT is only comparable to another run's if both ran the SAME case body.
   Regenerating cases-auto.js silently changed bodies twice while keeping ids, which would
   have compared a new test against an old answer -- a false green. So each result carries
   a hash of its own source, and compare.py refuses to compare across a mismatch. */
function caseHash(c) {
  var src = String(c.setup) + "|" + String(c.expr);
  var h = 5381;
  for (var i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
