/* ============================================================================
   Apps Script on mog — runtime bridge.
   mog's __mogApply(json) is SYNCHRONOUS and returns results inline, which is
   exactly Apps Script's execution model. Every call below flushes immediately,
   giving eager-write semantics (see UNCERTAINTIES U9/U21).
   ========================================================================== */
var GAS = (function () {
  var seq = 0;
  function nid() { return "gas" + (++seq); }

  /* Every op reaches the engine through here, so this is where we record WHICH SHEETS the
     agent wrote to. A preservation violation on a sheet the agent never wrote to cannot be
     the agent's doing -- mog recalculates cells that are literals in the file (task_15's
     `Formula Audit!D35`: -92884 -> 48048.72 when `Forecast Model` is edited, a sheet the
     agent never touched). No agent-free control can measure that: reproducing it requires
     changing values, which is what an agent does. This is a RECORD, not a heuristic.
     Sheet granularity is sufficient and sound: to damage a protected cell the agent must
     write to its sheet. A cross-sheet formula it authored changes a FORMULA cell, and
     grader/workbook.py:103 raw() compares the formula text there, not the value. */
  /* Read-only by RULE, not by hand-enumerated list -- a list gets it wrong. The first
     version missed `getWorksheetCollection`/`getActiveWorksheet`, which the shim issues at
     load time before anything else, so every run started with an incomplete record.
     Rule: anything named get* plus load/rangeQuery only fetches. cfQuery is deliberately
     NOT read-only -- cfQuery{method:"clear"} deletes every conditional format on the range
     (42-sheet-rest.js clearConditionalFormatRules). Unknown ops count as writes, which is
     the safe direction: it records more sheets, so it forgives less. */
  function isRead(op) {
    return op === "load" || op === "rangeQuery" || op === "functionEvaluate" || String(op).indexOf("get") === 0;
  }
  var writtenSheets = {};
  var revision = 0;
  var recordComplete = true;
  function apply(ops) {
    var touched = [], wrote = false, i, o;
    for (i = 0; i < ops.length; i++) {
      o = ops[i];
      if (o.worksheetId !== undefined && o.worksheetId !== null) touched.push(o.worksheetId);
      if (!isRead(o.op)) wrote = true;
    }
    if (wrote) {
      revision++;
      /* A mutating batch that names no worksheet (Sheet.setName, setNamedRange, ...) means
         we cannot say which sheet was touched. The record is then INCOMPLETE, and an
         incomplete record must never be used to forgive anything. */
      if (!touched.length) recordComplete = false;
      for (i = 0; i < touched.length; i++) writtenSheets[touched[i]] = 1;
    }
    var res = JSON.parse(__mogApply(JSON.stringify(ops)));
    if (res.error) throw asGasError(res.error);
    return res;
  }
  /* Sheet NAMES, resolved through the same handles the agent used. Returning the raw
     handles is useless to the caller: nid() is a counter, so any later getSheets() mints
     fresh handles that cannot match (measured: agent ["gas3"] vs probe {"gas8".."gas11"}
     -> empty intersection -> every violation discounted -> total false green).
     null means "cannot vouch for this record" and the verdict then discounts nothing. */
  function writtenSheetNames() {
    if (!recordComplete) return null;
    var out = {}, k, r;                 // dedupe: many handles can name one sheet
    for (k in writtenSheets) {
      try {
        r = apply([{ op: "load", id: k, properties: ["name"] }]).loaded[k];
        if (!r || typeof r.name !== "string") return null;
        out[r.name] = 1;
      } catch (e) { return null; }
    }
    return Object.keys(out);
  }

  /* Apps Script surfaces engine problems as plain Error with specific text.
     We keep mog's message but tag the origin so conformance can compare shapes.

     Some engine failures are the SAME failure Apps Script reports, in different words --
     an agent that branches on the message (or just logs it) sees a different program. The
     table translates only failures whose CAUSE is identical on both sides; anything else
     keeps mog's wording rather than being dressed up as an Apps Script error it is not. */
  var ENGINE_MESSAGE = [
    [/Name cannot look like a cell reference|invalid name|Name is invalid/i,
     "The name given to this range is invalid."]
  ];
  function asGasError(e) {
    var msg = e.message || JSON.stringify(e), name = e.name || "Error";
    for (var i = 0; i < ENGINE_MESSAGE.length; i++) {
      if (ENGINE_MESSAGE[i][0].test(msg)) { msg = ENGINE_MESSAGE[i][1]; name = "Exception"; break; }
    }
    var err = new Error(msg);
    err.name = name;
    err.__engine = true;
    return err;
  }

  /* Apps Script's own API errors carry name "Exception", not "Error" — verified against
     real Apps Script (SHAPES channel: the ConditionalFormatRuleBuilder validation error).
     Use this for anything that mirrors an Apps Script semantic error; NotImplemented and
     OutOfScope deliberately keep name "Error" because they are OUR markers, not Google's. */
  function gasError(message) {
    var e = new Error(message); e.name = "Exception"; return e;
  }

  /* Loud failure: a member that is in scope but unbuilt must THROW, never no-op.
     A silent no-op is a false green — the one unacceptable outcome offline. */
  function notImplemented(name) {
    var f = function () { throw new Error("NotImplemented: " + name +
      " is in the supported surface but is not yet implemented offline."); };
    f.__unimplemented = true;          // so coverage counts it honestly
    return f;
  }
  function outOfScope(name) {
    var f = function () { throw new Error("OutOfScope: " + name +
      " is deliberately unsupported offline."); };
    f.__outOfScope = true;
    return f;
  }

  /* THE CATCH-ALL. Everything in the surface is implemented and verified; anything else
     was removed from vocab/KEPT.txt rather than left as a half-member. A class prototype
     inherits from this proxy, so a real member resolves on the prototype itself and only a
     genuine miss reaches the trap. We return a THROWING FUNCTION instead of throwing on the
     property read, so `typeof sheet.foo === "function"` still works the way JS callers
     expect and only an actual call fails -- loudly, and naming the member. */
  var PROTOCOL = { toJSON: 1, then: 1, valueOf: 1, inspect: 1, length: 1, name: 1,
                   nodeType: 1, splice: 1, callee: 1, caller: 1, prototype: 1 };
  function outsideSurface(cls) {
    return new Proxy({}, {
      get: function (target, key) {
        /* JS protocol hooks are probed by the ENGINE, not called by agent code:
           JSON.stringify asks for toJSON, `await` asks for then, string coercion asks
           for valueOf/Symbol.toPrimitive. Throwing on those breaks ordinary JavaScript --
           JSON.stringify(range) died with "OutOfSurface: Range.toJSON". Let them miss. */
        if (typeof key !== "string" || key in Object.prototype || key.charAt(0) === "_" ||
            PROTOCOL[key]) {
          return target[key];
        }
        var msg = "OutOfSurface: " + cls + "." + key + " is not part of the supported " +
          "Apps Script surface offline. If the agent needs it, add it to vocab/KEPT.txt " +
          "and implement it -- do not stub it.";
        var f = function () { throw new Error(msg); };
        f.__outOfSurface = true;
        /* Reading a property off the stub must fail too. SpreadsheetApp.ThemeColorType was
           missing from the surface; the bare stub made .ACCENT1 evaluate to undefined and
           the gap stayed invisible until a probe caught it. */
        return new Proxy(f, {
          get: function (t, k) {
            if (typeof k !== "string" || k in Function.prototype || PROTOCOL[k] ||
                k.charAt(0) === "_") return t[k];
            throw new Error(msg + " (reading ." + k + ")");
          }
        });
      }
    });
  }

  /* Apps Script validates arity BEFORE doing anything and reports one exact message.
     One guard, used by every member with a required argument -- never a bespoke check. */
  function needArgs(cls, method, args, n) {
    if (args.length < n) {
      throw gasError("The parameters (" + (args.length ? "..." : "") +
        ") don't match the method signature for SpreadsheetApp." + cls + "." + method + ".");
    }
  }

  return { nid: nid, apply: apply, revision: function(){return revision;}, writtenSheetNames: writtenSheetNames, notImplemented: notImplemented, needArgs: needArgs,
           outOfScope: outOfScope, asGasError: asGasError, error: gasError,
           outsideSurface: outsideSurface };
})();
