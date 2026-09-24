/* One offline agent run: fresh workbook -> mog session -> the loop -> grade -> verdict.
   Usage: node agent/bench.mjs task_01 [--seed 1]
   `npm run bench` is taken by the company's ONLINE harness (repo-readonly), hence
   `npm run bench:offline`. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeEnv } from "./adapters/node.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PRISTINE = join(ROOT, "..");
const MOG = join(ROOT, ".mog/bin/mog");
const PY = join(ROOT, ".venv/bin/python");

const task = process.argv[2] || "task_01";
const seed = (process.argv.includes("--seed") && process.argv[process.argv.indexOf("--seed") + 1]) || "1";
if (!/^task_(0[1-9]|1[0-5])$/.test(task) || !/^[A-Za-z0-9_-]+$/.test(seed))
  throw new Error("invalid task or seed label");
const runId = new Date().toISOString().replace(/[:.]/g, "-") + "_" + randomUUID().slice(0,8);
const outDir = join(ROOT, "runs", `${runId}_${task}_s${seed}`);
mkdirSync(outDir, { recursive: true });

/* --map-only builds (and caches) the workbook map, then exits. Same code path as a real
   run, so the cache key and the map bytes cannot drift from what a run would produce --
   which is exactly what a separate map script would risk. */
const mapOnly = process.argv.includes("--map-only");
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && !mapOnly) { console.error("OPENAI_API_KEY not set"); process.exit(2); }

/* Lift the two prompt literals. Prompts.gs stays valid .gs so it ships online unchanged. */
const pg = readFileSync(join(ROOT, "agent/Prompts.gs"), "utf8");
const templates = new Function(pg + "\nreturn {SYSTEM_PROMPT, FIRST_PROMPT};")();
const lift = name => templates[name];
const agentSrc = ["ReviewPrompt.gs", "Submit.gs", "Tools.gs", "Agent.gs"].map(name =>
  readFileSync(join(ROOT, "agent", name), "utf8")).join("\n");
const {runLoop, config} = new Function(agentSrc + "\nreturn {runLoop:runLoop,config:CFG};")();
const surface = readFileSync(join(ROOT, "agent/surface.txt"), "utf8").trim();
const prompt = readFileSync(join(PRISTINE, `benchmarks/tasks/${task}/prompt.txt`), "utf8").trim();
const describeSrc = readFileSync(join(ROOT, "agent/Describe.gs"), "utf8");
const shim = readFileSync(join(ROOT, "dist/appsscript.js"), "utf8") + "\n" +
             readFileSync(join(ROOT, "agent/Tools.gs"), "utf8") + "\n" +
             describeSrc;

const sessionDir = join(outDir, ".sess");
mkdirSync(sessionDir, { mode: 0o700, recursive: true });
const mogEnv = { ...process.env, MOG_SESSION_DIR: sessionDir };
const eventsPath = join(outDir, "events.jsonl");
const runStart = Date.now();
let sessionId = null, env = null;

const cleanup = () => {
  try { if (sessionId) execFileSync(MOG, ["-s", sessionId, "--close", "--discard"],
                                    { env: mogEnv, timeout: 120000, stdio: "ignore" }); } catch {}
  try { env && env.cleanup(); } catch {}
  try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(sig, () => { cleanup(); process.exit(130); });

try {
  // the agent's starting workbook, in mog's own serialization so its quirks cancel at grading
  const base = join(outDir, "base.xlsx");
  execFileSync(MOG, ["-i", join(PRISTINE, `benchmarks/tasks/${task}/init.xlsx`), "-o", base, "-r"],
               { env: mogEnv, timeout: 1800000 });

  // open the session; stdout is ONLY the id
  sessionId = execFileSync(MOG, ["-s", "-i", base], { encoding: "utf8", env: mogEnv, timeout: 1800000 }).trim();

  env = nodeEnv({ shim, sessionId, mog: MOG, sessionDir, eventsPath, apiKey, runStart });

  // describe_spreadsheet: computed ONCE, here. Never per turn -- that would also break the
  // cache prefix.
  /* The map is a pure function of (Describe.gs, this workbook, the mog binary) -- none of
     which change within a sweep. Computing it costs 1-160s per run and the slowest
     workbooks would spend 2.6 min of a 20-min budget rebuilding the same bytes 5 times.
     Cache on a key covering all three inputs, so editing Describe.gs invalidates every
     entry automatically and there is no stale-map failure mode. OFFLINE ONLY: online,
     Apps Script computes it fresh. */
  const mapKey = createHash("sha256").update(
      describeSrc)
    .update(Buffer.from(shim))   // exact source executed by this run
    .update("map-cache-v2")
    .update(readFileSync(base))
    .update(readFileSync(MOG))
    .digest("hex").slice(0, 32);
  const mapDir = join(ROOT, ".mapcache");
  const mapFile = join(mapDir, `${task}_${mapKey}.txt`);
  let desc, cached = false;
  if (existsSync(mapFile)) {
    desc = { ok: true, out: readFileSync(mapFile, "utf8") };
    cached = true;
  } else {
    /* The adapter reports a THROWN script as ok:true with the throw text in `out`, so
       "non-empty output" is not success -- a failed describe() would be cached as a map and
       silently served forever, defeating the [NO MAP AVAILABLE] fallback. Require an
       explicit end marker the map cannot produce by accident, and write the file
       atomically so a killed run never leaves a half-map behind. */
    /* Offline is not under Apps Script's 360 s axe, so the budget is generous: it exists
       only so the same code path runs, never to shape the map. Online passes 120000. */
    desc = env.exec('log(describe_spreadsheet(ss, 900000)); log("<<<MAP-OK>>>");');
    const ok = desc.ok && desc.out.trimEnd().endsWith("\n<<<MAP-OK>>>");
    if (ok) desc.out = desc.out.slice(0, desc.out.lastIndexOf("<<<MAP-OK>>>")).trim();
    desc.ok = ok;
    if (ok && desc.out) {
      mkdirSync(mapDir, { recursive: true });
      const tmp = mapFile + ".tmp" + process.pid;
      writeFileSync(tmp, desc.out);
      renameSync(tmp, mapFile);
    }
  }
  env.event({ ev: "describe", cached, bytes: (desc.out || "").length, key: mapKey });
  if (mapOnly) {
    console.log(`  ${task}  ${String((desc.out || "").length).padStart(6)} bytes  ` +
                (cached ? "(already cached)" : `built in ${((Date.now() - runStart) / 1000).toFixed(1)}s`));
    cleanup();
    rmSync(outDir, { recursive: true, force: true });   // no run happened; leave no run dir
    process.exit(desc.ok && desc.out.trim() ? 0 : 1);
  }
  /* A silently-empty map is worse than no map: the agent cannot tell the workbook was
     never described from "this workbook has nothing in it". Fail loud, in the transcript
     AND in the prompt the model reads. */
  if (!desc.ok || !desc.out.trim()) {
    env.event({ ev: "describe.failed", task, seed, detail: (desc.out || "").slice(0, 2000) });
    console.error(`  !! describe_spreadsheet FAILED for ${task}: ${(desc.out || "").slice(0, 300)}`);
  }
  const describe = (desc.ok && desc.out.trim())
    ? desc.out.trim()
    : "[NO MAP AVAILABLE -- describe_spreadsheet failed on this workbook. Explore with " +
      "run_apps_script before writing anything; assume nothing about the layout.]";

  /* Describe.gs source ships INSIDE the system prompt: identical for every task and seed,
     so it rides the cached prefix and can receive cached-input pricing on matching requests. Function
     replacer, not a string -- the source contains `$` in its regexes and a string
     replacement would eat them as $-patterns. */
  const system = lift("SYSTEM_PROMPT")
    .replace("<valid-surface-placeholder>", () => surface)
    .replace("<describe-source-placeholder>", () => describeSrc);
  /* Function replacers throughout: both the task prompt and the map contain `$` (currency
     number formats like "$#,##0", dollar amounts in prose), and a string replacement would
     eat `$&`/`$\'`/`$1` as substitution patterns and silently corrupt them. */
  const first = lift("FIRST_PROMPT")
    .replace("<prompt>", () => prompt)
    .replace("<describe_spreadsheet>", () => describe);

  env.event({ ev: "run.start", task, seed, model: config.model, effort: config.effort,
              session: sessionId, surface_members: surface.split("\n").length,
              system_bytes: system.length, first_bytes: first.length });
  console.log(`  ${task} seed ${seed}  session ${sessionId}  -> ${outDir}`);

  // Save exactly what the model saw and the source used, so later edits cannot obscure a run.
  writeFileSync(join(outDir, "system.txt"), system);
  writeFileSync(join(outDir, "first.txt"), first);
  writeFileSync(join(outDir, "agent-source.gs"), agentSrc);
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({
    task, seed, config, mapKey, mapCached: cached, node: process.version,
    platform: process.platform, arch: process.arch,
    source_sha256: createHash("sha256").update(agentSrc).update(shim).update(pg).digest("hex"),
    mog_sha256: createHash("sha256").update(readFileSync(MOG)).digest("hex")
  }, null, 2));
  const result = runLoop(env, { system, first });
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(`  RUN END: ${result.reason}  turns ${result.turns}  ${Math.round(result.ms / 1000)}s  $${result.cost_usd}`);

  // close the session AND SAVE -- partial work still scores
  const submission = join(outDir, "submission.xlsx");
  execFileSync(MOG, ["-s", sessionId, "--close", "-r", "-o", submission], {env: mogEnv, timeout: 1800000});
  sessionId = null;

  // which sheets did the agent write to? accumulated across turns at the shim's write
  // choke point. null = could not be vouched for -> the verdict discounts nothing.
  const wrote = env.wroteSheets();
  env.event({ ev: "wrote", sheets: wrote });

  const gradePath = join(outDir, "grade.json");
  try {
    execFileSync(PY, ["-m", "grader.google_grade", "--task", task,
                      "--initial", base, "--golden", join(PRISTINE, `benchmarks/tasks/${task}/golden.xlsx`),
                      "--submission", submission, "--out", gradePath],
                 { cwd: PRISTINE, timeout: 1800000 });
  } catch (e) {
    // A submission the grader cannot even open is a FAIL, not a crash -- on Google the
    // same workbook would be broken. Fail closed and say why.
    const why = String((e.stderr || "") + (e.message || "")).trim().split("\n").slice(-3).join(" | ");
    env.event({ ev: "verdict", pass: false, grader_error: why });
    console.log(`\n  AGENT RUN: FAIL (grader could not grade submission)\n    - ${why}`);
    cleanup();                 // top-level try/finally: no `return` here, so unwind by hand
    process.exit(1);
  }

  const v = execFileSync(PY, [join(ROOT, "agent/verdict_cli.py"), gradePath, task, submission,
                              JSON.stringify(wrote), base], { encoding: "utf8", cwd: ROOT, timeout: 600000 });
  const verdict = JSON.parse(v);
  verdict.run_reason = result.reason;
  verdict.completed = result.reason === "done";
  verdict.map_ok = desc.ok && !!desc.out.trim();
  writeFileSync(join(outDir, "verdict.json"), JSON.stringify(verdict, null, 1));
  env.event({ ev: "verdict", ...verdict });

  const g = JSON.parse(readFileSync(gradePath, "utf8"));
  console.log(`  score ${g.correct}/${g.total}   violations ${g.preservation.violations.length} raw, ${verdict.discounted.length} discounted`);
  if (verdict.failures.length) {
    console.log("\n  FAIL:");
    for (const f of verdict.failures.slice(0, 12)) console.log("    - " + f);
  }
  console.log(`\n  AGENT RUN: ${verdict.pass ? "PASS" : "FAIL"}`);
  process.exitCode = verdict.pass ? 0 : 1;
} catch (e) {
  const failure = { pass: false, harness_error: String(e.message || e) };
  writeFileSync(join(outDir, "harness-error.json"), JSON.stringify(failure, null, 2));
  if (env) env.event({ ev: "harness.error", ...failure });
  console.error("HARNESS ERROR: " + failure.harness_error);
  process.exitCode = 2;
} finally {
  cleanup();
}
