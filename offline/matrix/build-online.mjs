/* Emits matrix/online.gs: the SAME suite, to paste into Apps Script.

   Everything is wrapped in one closure so the editor's function dropdown shows exactly
   ONE entry point (RUN) instead of every helper. Resumable: each run works through as
   many cases as fit in 4.5 minutes, saves, and reports how many are left. */
import { readFileSync, writeFileSync } from "node:fs";

const parts = ["matrix/fingerprint.js", "matrix/pools.js", "matrix/fixtures.js",
               "matrix/sweep.js"].map(f => `/* ---- ${f} ---- */\n` + readFileSync(f, "utf8"));
const plan  = readFileSync("matrix/plan.json", "utf8");
const pools = readFileSync("matrix/pools-from-tasks.json", "utf8");

const crypto = await import("node:crypto");
const SUITE_VERSION = crypto.createHash("sha256")
  .update(parts.join("") + plan + pools).digest("hex").slice(0, 8);
const gs = `/* GENERATED — do not edit here. Source: gas-offline/matrix/*.
   Paste into Apps Script, pick RUN, press Run. Repeat until it says DONE.

   Runs the identical suite that ran offline against mog, and saves the results to Drive
   as matrix-online.json so the two can be compared case by case. */

function RUN() { return __SUITE__.run(); }          // the only entry point

var __SUITE__ = (function () {

var TASK_POOLS = ${pools};
var PLAN = ${plan};

${parts.join("\n").replace(/^var TASK_POOLS = null;.*$/m, "")}

/* The filename carries a hash of the test sources. Change sweep.js or the pools and the
   next run writes a NEW file instead of resuming into answers from different code. */
var SUITE_VERSION = "${SUITE_VERSION}";
var NAME = "matrix-online-" + SUITE_VERSION + ".json";
/* Apps Script hard-stops at 6 minutes. 5.5 leaves enough room to load, merge and save
   the results file without being killed mid-write. */
var BUDGET_MS = 5.5 * 60 * 1000;

function loadDone() {
  var it = DriveApp.getFilesByName(NAME);
  if (!it.hasNext()) return {};
  try { return JSON.parse(it.next().getBlob().getDataAsString()); } catch (e) { return {}; }
}

function save(obj) {
  var old = DriveApp.getFilesByName(NAME);
  while (old.hasNext()) old.next().setTrashed(true);
  return DriveApp.createFile(NAME, JSON.stringify(obj), "application/json");
}

function run() {
  var done = loadDone();
  var deadline = Date.now() + BUDGET_MS;
  /* Fixed name: with Date.now() in it, Spreadsheet.getName() was unmatchable by construction. */
  var ss = SpreadsheetApp.create("matrix-scratch");
  var added = 0, total = 0, stopped = false, captured = [];
  try {
    var sh = ss.getSheets()[0];
    /* the SAME explicit base the offline side uses -- literally the same function, from
       matrix/sweep.js, because when it was copy-pasted into both runners it drifted */
    prepSheet(sh, true);
    SpreadsheetApp.flush();

    runSuite(sh, PLAN, function (id, thunk) {
      total++;
      if (done[id]) { captured.push(id); return; }   // already captured by an earlier run
      if (Date.now() > deadline) { stopped = true; return; }
      done[id] = fingerprint(thunk);
      captured.push(id);
      added++;
    });
  } finally {
    /* SAVE FIRST. This used to trash the scratch before saving, and save() sits after the
       finally -- so when the trash threw ("No item with the given ID could be found",
       e.g. the scratch was removed out from under it) the whole run died and 5.5 minutes
       of captured cases went in the bin. Cleanup is best-effort; results are not. */
    try { save(done); } catch (e) { /* reported by the caller's log line */ }
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) { /* already gone */ }
  }
  var left = total - captured.length;
  Logger.log("SAVED " + Object.keys(done).length + "/" + total +
             "  this run: " + added +
             "  REMAINING " + (left > 0 ? left + "  -> press Run again" : "0  -> DONE"));
  return left;
}

return { run: run };
})();
`;
writeFileSync("matrix/online.gs", gs);
console.log(`  matrix/online.gs  ${(gs.length / 1024).toFixed(0)} KB`);
