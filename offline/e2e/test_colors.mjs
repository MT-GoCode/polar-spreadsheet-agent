/* Every colour the shim sends to mog must be #rrggbb. Apps Script accepts CSS names
   ("black") and #rgb shorthand; mog writes whatever it is given straight into
   styles.xml, and `<color rgb="BLACK"/>` makes the workbook unreadable -- openpyxl
   raises "Colors must be aRGB hex values" and the grader cannot grade at all.
   Found live on task_07, where the agent's setBorder(...,"black",...) was legal
   Apps Script. No mog needed: a fake host captures the ops. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ops = [];
const ctx = {
  __mogLog: () => {},
  __mogApply: (json) => {
    const batch = JSON.parse(json);
    for (const o of batch) ops.push(o);
    // answer reads with a plausible shape so the shim keeps going
    const loaded = {};
    for (const o of batch) if (o.id) loaded[o.id] = { name: "S", address: "A1", values: [[1]] };
    return JSON.stringify({ loaded, rangeQuery: {} });
  },
};
const src = readFileSync(join(ROOT, "dist/appsscript.js"), "utf8");
new Function("__mogApply", "__mogLog", src + `
  var r = new Range("sheet1", "A1:B2");
  r.setBorder(true, true, true, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID);
  r.setBorder(true, null, null, null, null, null, "#f00", SpreadsheetApp.BorderStyle.SOLID);
  r.setFontColor("black");
  r.setBackground("#ABC");
`)(ctx.__mogApply, ctx.__mogLog);

const HEX = /^#[0-9a-f]{6}$/;
const bad = ops.filter(o => /color/i.test(o.property || "") &&
                            typeof o.value === "string" && !HEX.test(o.value));
const seen = ops.filter(o => /color/i.test(o.property || "")).map(o => o.value);
console.log("colour ops sent to mog:", JSON.stringify(seen));
if (!seen.length) { console.error("FAIL: no colour ops captured - test is not exercising the path"); process.exit(1); }
if (bad.length) {
  console.error("FAIL: non-hex colour reached mog:", JSON.stringify(bad));
  process.exit(1);
}
console.log("PASS: every colour normalised to #rrggbb");
