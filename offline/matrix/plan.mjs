/* The PLAN: [class, member, stateSensitive] for all 395 members, derived from
   vocab/KEPT.txt so it cannot drift from the agreed surface. */
import { readFileSync, writeFileSync } from "node:fs";
const KEPT = readFileSync("vocab/KEPT.txt", "utf8");
const cls = {}; let cur = null;
for (const l of KEPT.split("\n")) {
  const h = /^##\s+(\S+)\s+\((\d+)\)/.exec(l);
  if (h) { cur = h[1]; cls[cur] = []; continue; }
  const m = /^\s{2}(\S+)\s*$/.exec(l);
  if (m && cur) cls[cur].push(m[1]);
}
const isEnum = n => /^[A-Z0-9_]+$/.test(n);
/* A member is STATE-SENSITIVE when what the cell already holds can change its answer:
   every Range reader, and every Range writer that merges with or clears existing content. */
const STATEFUL = /^(get|is)[A-Z]|^(setValue|setValues|setFormula|setNumberFormat|clear|clearContent|clearFormat|clearDataValidations|merge|breakApart|trimWhitespace|copyTo|moveTo)$/;
const plan = [];
for (const [c, ms] of Object.entries(cls)) {
  if (ms.every(isEnum)) continue;
  for (const m of ms) plan.push([c, m, c === "Range" && STATEFUL.test(m)]);
}
writeFileSync("matrix/plan.json", JSON.stringify(plan));
const nStateful = plan.filter(p => p[2]).length;
console.log(`  plan: ${plan.length} members, ${nStateful} state-sensitive`);
