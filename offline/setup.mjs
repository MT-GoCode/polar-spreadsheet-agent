/* Fetch the pinned mog binary and verify the offline harness can run.

   The binary is Apache-2.0 and published from the fork that carries the Google
   Sheets parity patches: github.com/MT-GoCode/mog (branch polar-harness).
   out/controls.json records the sha of the binary its noise floor was measured
   on, and e2e/verdict.py refuses to grade against a different one -- a floor
   measured on a noisier build silently forgives real agent damage. So the sha
   is checked here, loudly, rather than left to fail obscurely later. */
import { createWriteStream, existsSync, mkdirSync, chmodSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TAG = "polar-harness-v1";
const REPO = "MT-GoCode/mog";
const PINNED = "a5a3269871187fc9f8ace5ca4d8440d322dcdb523ff973b044df39997df47307";
const DEST = join(ROOT, ".mog/bin/mog");

const asset = { "darwin-arm64": "mog-darwin-arm64", "linux-x64": "mog-linux-x64" }[
  `${process.platform}-${process.arch}`
];
if (!asset) {
  console.error(`No published mog build for ${process.platform}-${process.arch}.`);
  console.error(`Build one from https://github.com/${REPO}/tree/polar-harness and place it at .mog/bin/mog`);
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (existsSync(DEST) && sha256(DEST) === PINNED) {
  console.log(`mog already present and pinned (${PINNED.slice(0, 16)})`);
} else {
  const url = `https://github.com/${REPO}/releases/download/${TAG}/${asset}`;
  console.log(`downloading ${asset} from ${TAG} ...`);
  mkdirSync(dirname(DEST), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) { console.error(`download failed: ${res.status} ${url}`); process.exit(1); }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(DEST));
  chmodSync(DEST, 0o755);
  const got = sha256(DEST);
  if (got !== PINNED) {
    console.error(`sha256 MISMATCH\n  expected ${PINNED}\n  got      ${got}`);
    console.error("Refusing to continue: out/controls.json was measured on the pinned binary.");
    process.exit(1);
  }
  console.log(`verified sha256 ${got.slice(0, 16)}  (${(statSync(DEST).size / 1e6).toFixed(1)} MB)`);
}

/* A binary that downloads is not a harness that works. Prove the engine answers. */
console.log("checking the engine responds ...");
const out = execFileSync(DEST, ["--help"], { encoding: "utf8", timeout: 60000 });
if (!/--session/.test(out)) { console.error("mog --help did not look right"); process.exit(1); }

const control = join(ROOT, "out/controls.json");
if (existsSync(control)) {
  const sha = JSON.parse(readFileSync(control, "utf8")).mog_sha;
  if (sha && !PINNED.startsWith(sha) && !sha.startsWith(PINNED.slice(0, sha.length)))
    console.warn(`WARNING: controls.json records mog_sha ${sha}, which is not this binary.`);
  else console.log("controls.json matches this binary; grading will not re-measure");
}

console.log("\nready:\n  npm test           unit + verdict suites\n  npm run bench:offline task_03   one task offline\n  npm run bench      the 15 tasks on real Apps Script");
