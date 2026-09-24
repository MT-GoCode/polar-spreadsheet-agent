/* The Node half of ENV. Five functions, nothing else.
   Synchronous HTTP via curl: the loop must be sync (Runtime.gs calls runAgent
   synchronously and UrlFetchApp.fetch is sync), and Node has no sync fetch.
   ponytail: curl = a fresh TLS handshake per call (~150ms) against calls that take
   5-60s. If that ever shows up in the timings, swap for worker_threads + Atomics.wait
   to get keepalive; same signature. */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, appendFileSync, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function nodeEnv({ shim, sessionId, mog, sessionDir, eventsPath, apiKey, runStart }) {
  const scratch = mkdtempSync(join(tmpdir(), "agentenv-"));
  /* Each turn is a SEPARATE mog process, so the shim's write record covers only that turn.
     Accumulate across turns here. null (the shim could not vouch for a turn) is sticky:
     once we cannot account for a write, the whole record is untrustworthy and the verdict
     must discount nothing. */
  let wrote = new Set(), wroteOk = true;
  const cfgPath = join(scratch, "curl.cfg");
  /* The key goes in a 0600 config file, NEVER in argv -- ps exposes argv to every local
     process, and the previous shim had exactly that bug. */
  writeFileSync(cfgPath, `header = "Authorization: Bearer ${apiKey}"\n`);
  chmodSync(cfgPath, 0o600);

  return {
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),

    wroteSheets: () => (wroteOk ? [...wrote] : null),

    uuid: () => randomUUID(),

    sleep: (ms) => {
      const sab = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sab, 0, 0, ms);
    },

    event: (o) => {
      appendFileSync(eventsPath,
        JSON.stringify({ t: new Date().toISOString(), ms: Date.now() - runStart, ...o }) + "\n");
    },

    http: (url, headers, body, timeoutMs = 600000) => {
      const bodyPath = join(scratch, "req.json");
      const hdrPath = join(scratch, "hdr.txt");
      writeFileSync(bodyPath, body);
      const args = ["-sS", "--config", cfgPath, "-D", hdrPath, "--max-time", String(Math.max(0.001, timeoutMs / 1000)),
                    "--connect-timeout", "10", "-w", "\n%{http_code}", "-d", `@${bodyPath}`];
      for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
      args.push(url);
      let out;
      try {
        // maxBuffer: a store:false response carries encrypted_content and blows the 1 MiB
        // default, which DISCARDS the body we just paid for.
        out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: Infinity });
      } catch (e) {
        return { status: 0, headers: {}, body: JSON.stringify({ error: { message: String(e).slice(0, 300) } }) };
      }
      const cut = out.lastIndexOf("\n");
      const status = parseInt(out.slice(cut + 1), 10) || 0;
      const hdrs = {};
      try {
        for (const line of readFileSync(hdrPath, "utf8").split("\n")) {
          const i = line.indexOf(":");
          if (i > 0) hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        }
      } catch {}
      return { status, headers: hdrs, body: out.slice(0, cut) };
    },

    /* One turn = one mog invocation against the LIVE session. The try/catch is
       load-bearing: measured, an uncaught throw sends NOTHING to stdout -- exit 1, the
       exception on stderr, and every log() before it lost. Wrapped, we keep both. */
    exec: (code, timeoutMs = 1200000) => {
      /* A SYNTAX error in the model's code is the MODEL's problem and it is recoverable --
         but it cannot be caught by the try/catch we wrap around the code below, because
         parsing fails before that try block exists. mog then exits non-zero, which the loop
         reads as engine death, and a single typo kills the whole run. (Observed live:
         "GeneralException: invalid assignment left-hand side" -> session_dead on turn 2.)
         So check parseability here and hand the error back as an ordinary tool result. */
      try { new Function(code); }
      catch (e) {
        return { ok: true, out: "ERROR: your code did not parse -- " + (e && e.message || e) +
                              "\nNothing was executed. Fix the syntax and try again." };
      }
      const path = join(scratch, "turn.js");
      writeFileSync(path,
        shim + "\nvar ss = SpreadsheetApp.getActiveSpreadsheet();\nvar log = __mogLog;\n" +
        "try{\n" + code + "\n}catch(e){log('ERROR: '+(e && e.message || e));}\n" +
        'try{__mogLog("__WROTE__ "+JSON.stringify(GAS.writtenSheetNames()));}' +
        'catch(e){__mogLog("__WROTE__ null");}\n');
      try {
        const out = execFileSync(mog, ["-s", sessionId, "-f", path],
          { encoding: "utf8", maxBuffer: Infinity, timeout: Math.max(1, timeoutMs),
            env: { ...process.env, MOG_SESSION_DIR: sessionDir } });
        // peel the write record off the tail; the model never sees it
        const lines = out.split("\n");
        const keep = [];
        let records = 0;
        for (const line of lines) {
          if (line.startsWith("__WROTE__ ")) {
            records++;
            let v = null;
            try { v = JSON.parse(line.slice(10)); } catch {}
            if (!Array.isArray(v) || !v.every(n => typeof n === "string")) wroteOk = false; else for (const n of v) wrote.add(n);
          } else keep.push(line);
        }
        if (records !== 1) wroteOk = false;
        return { ok: true, out: keep.join("\n") };
      } catch (e) {
        wroteOk = false; // failed execution may already have changed the workbook
        // Non-zero exit leaves execution and write attribution uncertain.
        return { ok: false, out: String(e.stderr || e.stdout || e).slice(0, 2000) };
      }
    }
  };
}
