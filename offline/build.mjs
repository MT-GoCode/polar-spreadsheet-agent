/* Concatenate shim/*.js in filename order -> dist/appsscript.js.
   Numeric prefixes are the load order. No bundler, no config. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
const files = readdirSync("shim").filter(f => f.endsWith(".js")).sort();
const body = files.map(f => `/* ---- ${f} ---- */\n` + readFileSync(`shim/${f}`, "utf8")).join("\n");
writeFileSync("dist/appsscript.js", body);
console.log(`built dist/appsscript.js from ${files.length} files (${body.split("\n").length} lines)`);
