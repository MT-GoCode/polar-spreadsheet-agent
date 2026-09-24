/* Reports honest surface coverage: real implementations vs loud throwers. */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gas-cov-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const script = join(dir, "c.js");
writeFileSync(script, readFileSync("dist/appsscript.js", "utf8") + `
__mogLog("__COV__" + JSON.stringify(GAS_COVERAGE));`);
const out = execFileSync(".mog/bin/mog", ["-f", script, "-o", join(dir, "o.xlsx")], { encoding: "utf8" });
const cov = JSON.parse(out.split("__COV__")[1].split("\n")[0]);
const total = cov.implemented + cov.missing + cov.outOfScope;
console.log(`  ${cov.implemented}/${total} implemented  |  ${cov.missing} unimplemented (throw)  |  ${cov.outOfScope} out-of-scope`);
for (const [c, v] of Object.entries(cov.byClass).sort((a, b) => b[1].missing - a[1].missing))
  if (v.missing) console.log(`    ${c.padEnd(22)} ${v.implemented} impl, ${v.missing} unimplemented`);
