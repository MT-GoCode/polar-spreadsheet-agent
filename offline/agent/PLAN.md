# The agent harness — plan

`runAgent({prompt, spreadsheetId})` is the deliverable. It runs as real Apps Script against a
real Google Sheet. This harness runs **the same loop** offline against `mog` so you can
iterate without burning Apps Script quota.

Everything below is grounded in something measured or read, not assumed. Where it is a
judgement call it says so.

---

## 0. The sharing principle

`Runtime.gs:160` calls `runAgent` **synchronously**, and `UrlFetchApp.fetch` is synchronous.
So the loop must be synchronous — which means Node needs synchronous HTTP, and once it has
that, everything except I/O can be shared verbatim.

```
SHARED — ships inside the submission, byte-identical offline
  Prompts.gs     prompt templates
  Tools.gs       the power tools the model calls (describe_spreadsheet, …)
  Agent.gs       the loop: request build, retry/backoff, response parse,
                 tool dispatch, deadline, event emission
  surface.txt    the 395-member list, frozen at build time

PER-PLATFORM — five functions, ~35 lines each
  adapters/node.mjs    offline
  adapters/gas.js      ships

OFFLINE ONLY — online's equivalent is repo-readonly/scripts/bench.mjs
  bench.mjs      one run: session, loop, grade, verdict
  sweep.mjs      N tasks x M seeds, scheduler, cleanup
  render.mjs     events.jsonl -> transcript.md
```

`Agent.gs` touches nothing but `ENV`. That is what makes retry logic — the part you least
want duplicated — shared rather than written twice.

### Sync HTTP in Node

`execFileSync('curl', …)`. Ten lines. One TLS handshake per call (~150 ms) against calls
that take 5–60 s, so under 1%, and it buys a loop that is byte-identical across platforms.

The key goes in a mode-0600 `--config` file, never in argv — `ps` exposes argv to every
local process, and the old shim had exactly that bug.

```
// ponytail: curl per call = fresh TLS each time. If handshake ever shows up in the
// timings, swap for worker_threads + Atomics.wait to get keepalive. Same signature.
```

---

## 1. Credentials

From the official README line 27, verbatim:

> For credentials, run `npm run open:script`, open **Project Settings → Script Properties**,
> and add your model key (for example, `OPENAI_API_KEY`). Read it with
> `PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY')` and call your
> provider using `UrlFetchApp.fetch`. **A local `.env` is not automatically available inside
> Apps Script.** Never log or commit credentials.

So the key is genuinely different per platform and belongs in `ENV`:

| | |
|---|---|
| online | `PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY')` |
| offline | `process.env.OPENAI_API_KEY` |

Never in a committed file, never in argv, never in an event. The transcript records the
**`Idempotency-Key`** and **`x-request-id`**, never the bearer token.

---

## 2. `ENV` — the entire platform surface

Five members.

| | node.mjs | gas.js |
|---|---|---|
| `http(url, headers, body)` | `execFileSync('curl', … --config keyfile)` | `UrlFetchApp.fetch(…, {muteHttpExceptions:true})` |
| `exec(code)` | write `turn.js`, `mog -s SID -f` | `eval(code)` in-process |
| `uuid()` | `crypto.randomUUID()` | `Utilities.getUuid()` |
| `sleep(ms)` | `Atomics.wait` on a dummy buffer | `Utilities.sleep(ms)` |
| `event(o)` | `fs.appendFileSync(jsonl, …)` | `events.push(o)` |
| `key()` | `process.env.OPENAI_API_KEY` | Script Properties, above |

`Date.now()` is identical in Apps Script V8 and Node, so it is used directly rather than
wrapped. Test the deadline path by setting the deadline to 0.

### The spreadsheet handle — the other real divergence

Offline, mog has one open workbook and `getActiveSpreadsheet()` is the handle. Online it is
**null**; the starter says so itself (`Code.gs:12`: *"Use `spreadsheet`, not `getActive()`"*),
and `runAgent` must use `SpreadsheetApp.openById(spreadsheetId)`. Our shim deliberately has
no `openById` — it is out of scope offline.

**The model writes neither.** It writes `ss`, and `exec` injects the binding:

```js
// adapters/node.mjs — prepended to turn.js
"var ss = SpreadsheetApp.getActiveSpreadsheet();"

// adapters/gas.js — prepended before eval
"var ss = SpreadsheetApp.openById(SPREADSHEET_ID);"
```

`spreadsheetId` is passed into the adapter at construction, never into `Agent.gs`. The system
prompt says "use `ss`" on both platforms, so it stays byte-identical and the cache prefix
holds.

### ES2017 constraint

Apps Script V8 is ES2017-ish. The shared files must avoid `?.`, `??`, `flat()`,
`replaceAll()`, `Object.fromEntries`, `Array.at`. Node accepts them silently, so
offline-green would not prove online-green at the language level. One lint over
`Agent.gs` / `Prompts.gs` / `Tools.gs` at build time catches it.

---

## 3. What `exec` actually does, and why the wrapper is load-bearing

```js
turn.js = dist/appsscript.js                        // the 2,380-line shim
        + Tools.gs                                  // power tools, in scope for the model
        + "var ss = SpreadsheetApp.getActiveSpreadsheet();\n"
        + "var log = __mogLog;\n"
        + "try{\n" + code + "\n}catch(e){log('ERROR: '+(e&&e.message||e));}"
```

Measured, not assumed:

| | exit | stdout | stderr |
|---|---|---|---|
| raw throw | 1 | **empty — every `log()` before the error is LOST** | `GeneralException: …` |
| wrapped in try/catch | 0 | **logs *and* `ERROR: …` both present** | empty |

Without the wrapper the model gets nothing back at exactly the moment it most needs
feedback. The session survives either way, and edits made before the throw persist.

Also measured: **JS globals do not persist between turns** — each `-f` gets a fresh JS
context; only the workbook persists. That matches Apps Script, so it is correct behaviour,
not a limitation. The shim is re-parsed every turn; total per-turn overhead is **30–50 ms**,
which is not worth optimising.

---

## 4. Power tools — `Tools.gs`

Prepended to every turn, so the model can call them directly. Pure Apps Script over `ss`, so
they ship online verbatim and need no adapter.

```js
function describe_spreadsheet(ss) {
  return ss.getSheets().map(function (s) {
    return s.getName() + '  ' + s.getLastRow() + 'x' + s.getLastColumn();
  }).join('\n');
}
```

Computed ONCE at startup and substituted into `FIRST_PROMPT`. Never recomputed per turn --
that would also break the cache prefix. This is where further tools go as they earn their
place; each is plain Apps Script over `ss`, so it ships online verbatim.

They are **not** OpenAI tools. The model has one OpenAI tool (`run_apps_script`) and calls
these from inside the code it writes. That keeps the tool surface — and therefore the cache
prefix — fixed.

---

## 5. `Prompts.gs`

Valid `.gs`; the Node side lifts each with one regex.

```js
var SYSTEM_PROMPT = `You are editing a Google Sheets workbook by writing Google Apps
Script. Each time you call run_apps_script, your code runs against the live workbook and
persists — later calls see earlier edits. The workbook is bound to `ss`; do not call
openById or getActiveSpreadsheet. Globals do not persist between calls; only the workbook
does. Use log(x) to print anything you want to see; that output comes back to you. If your
code throws you get the error text and everything you logged before it, and the workbook
keeps the edits made before the throw. Batch your writes — setValues on a range is far
cheaper than a loop of setValue. Only these members exist; anything else throws by name:

<valid-surface-placeholder>`;

var FIRST_PROMPT = `<prompt>

<describe_spreadsheet>`;
```

| placeholder | source |
|---|---|
| `<valid-surface-placeholder>` | `agent/surface.txt`, generated from `vocab/KEPT.txt` — 395 `Class.method` lines + 13 enum namespaces, ~2.7k tokens |
| `<prompt>` | `benchmarks/tasks/<task>/prompt.txt` |
| `<describe_spreadsheet>` | `describe_spreadsheet(ss)` → `""` |

The system prompt must be **byte-identical across every task and seed** or prompt caching
never hits. `surface.txt` is generated at build time and frozen, never regenerated per run.

---

## 6. `Agent.gs` — the shared loop

```js
var CFG = {
  model: "gpt-5.4",
  effort: "medium",          // default is "none" — must be sent explicitly every request
  deadlineMs: 1200000,       // 20 minutes. No turn cap -- the deadline is the only bound.
  maxOutputTokens: 32000,
  promptCacheKey: "polar-v1",
  timeoutMs: 600000,         // one timeout. Not plumbed into the request.
  maxAttempts: 5,
  toolOutputCap: 65536       // what the MODEL sees; the event keeps the full text
};

var TOOLS = [{               // fixed order; reordering invalidates the cache
  type: "function", name: "run_apps_script", strict: true,
  description: "Run Apps Script against the workbook. Returns whatever you log(), " +
               "plus the error text if it throws.",
  parameters: { type: "object", additionalProperties: false, required: ["code"],
                properties: { code: { type: "string" } } }
}];

function runLoop(env, opts) { … }   // -> {reason, turns, usage, events}
```

`gpt-5.4-medium` is **not a model id** — verified against the live `/v1/models` endpoint. The
id is `gpt-5.4`; "medium" is `reasoning.effort`. Its default is `none`, so omitting it gives
a non-reasoning model.

No `service_tier` — default processing, not flex, not priority.

### Request body

Ordered for cache-prefix stability: static first, volatile last.

```json
{ "model": "gpt-5.4",
  "reasoning": { "effort": "medium" },
  "store": false,
  "prompt_cache_key": "polar-v1",
  "max_output_tokens": 32000,
  "parallel_tool_calls": false,
  "tools": [ … fixed order … ],
  "input": [ {developer: SYSTEM}, {user: FIRST},
             …every prior output item, verbatim…, …tool outputs… ] }
```

`store:false` means reasoning items come back carrying `encrypted_content`. **Append every
item of `output` to `input` verbatim, never filter.** Dropping reasoning items makes the
model silently re-derive its chain each turn — more reasoning tokens, worse multi-step
accuracy.

`parallel_tool_calls:false` — spreadsheet edits are order-dependent, and serial keeps the
transcript readable.

### Loop

build → POST (with retry) → append every output item → for each `function_call`, `exec` and
append `{type:"function_call_output", call_id, output}` → repeat.

Ends on: no tool calls in the response (`reason:"done"`), or deadline (`reason:"deadline"`).
**No turn cap.**

### Retry — one backoff, deliberately boring

```
retry on:    408, 409, 429, >=500, network error, timeout
never retry: error.code in {insufficient_quota, credit_balance_exhausted,
                            organization_spend_limit_exceeded}
sleep      = min(0.5 * 2^n, 8s)
retry-after: honoured when <= 120 s, else give up
attempts: 5      timeout: 600 s
Idempotency-Key: one per turn, REUSED across that turn's retries
```

No per-platform policy object, no budget in `ENV`, no nested timeouts. Online the same code
runs with smaller constants.

### Deadline and stopping

**20 minutes, checked between steps only** — not plumbed into the request, and the model is
never told how much time is left. On expiry the loop stops and the run **still closes the
session, saves, and grades**: partial work scores.

Four stop reasons, each distinct in `run.end`:

| reason | when |
|---|---|
| `done` | the model answered with no tool call |
| `deadline` | 20 min elapsed, checked between steps |
| `incomplete` | `response.status == "incomplete"` — the model ran out of output tokens mid-turn. Without this it emits no tool call and reads as a clean finish |
| `session_dead` | non-zero exit from `mog -s`. The engine is gone; abort. **Never** hand a host failure back as a tool result, or the agent spends the rest of the run arguing with a corpse |
| `context_exhausted` | cumulative input approaches the 1,050,000 window |

### Token accounting

Running totals of `input`, `cached`, `output`, `reasoning` across all turns, emitted per turn
and summed in `run.end`. Cost is
`(input - cached) x $2.50 + cached x $0.25 + output x $15.00` per 1M — `cached_tokens` is a
SUBSET of `input_tokens` and `reasoning_tokens` a subset of `output_tokens`, so neither is
added separately. There is no `cache_write` charge on this API; do not log one.

Offline 20 min vs the online 360 s hard cap is a deliberate, recorded divergence: offline
measures what the agent *can* do, online measures what fits. `run.end` records elapsed time
so you can see which runs would not have fitted online.

---

## 6b. What the grader half now guarantees (settled since this plan was written)

`npm run e2e task_NN` -> PASS means it passes on Google; FAIL means the agent is wrong.
**Verified 15/15** on binary `c5f0e52bf303cce5`, with 26 unit + 4 integration tests.

An adversarial review found four false greens in the classifier, all since fixed:

| | |
|---|---|
| the write record was always **empty** | keyed on `GAS.nid()` handles, resolved against a fresh `getSheets()` whose handles are disjoint by construction. Every violation carrying a sheet was discounted — a full sweep read 15/15 while checking nothing. Now keyed on sheet NAMES, with read-only ops identified by rule rather than a hand-list that missed two load-time ops |
| `cell_style` blanket-forgiven | an agent formatting one row past `style_editable` passed offline and failed online |
| requirements forgiven by **id** | task_08's golden fails `output_number_formats` offline, so an agent setting no formats at all passed. Now per cell |
| `vkey` carries no object content | any conditional-format change on a sheet matched the control key. Object violations are now never excused by a control |

`reconcile()` is **not** subtractive — `native_preservation.py:99-119` re-derives
`cell_content` from `userEnteredValue`. The old README asserted the opposite and the
classifier implemented it. Nothing is blanket-discounted now: every discount is MEASURED
(baseline / golden / writepath controls, `lossy_cells`, all sha256-pinned to the binary) or
RECORDED (the sheets the agent wrote, at the shim's single write choke point).

**Consequence for this plan:** the agent loop needs no grading logic of its own. `bench.mjs`
calls `grader.google_grade` and then `verdict.classify`, exactly as `e2e/run_offline.py`
does, and gets a binary answer. The write record is already captured by the shim, so a real
agent run gets a *better* record than the fixture does — every `run_apps_script` call goes
through the same choke point.

## 7. `bench.mjs` — one run

```
npm run bench:offline task_09 [--seed 1] [--deadline 1200] [--out runs/…]
```

```
scratch dir + private MOG_SESSION_DIR
  mog -i init.xlsx -o base.xlsx -r        the agent's starting workbook
  SID = mog -s -i base.xlsx               stdout is ONLY the id
  runLoop(nodeEnv, {prompt, deadline})
  mog -s SID --close -o submission.xlsx
  python -m grader.google_grade           cwd=repo-readonly, unmodified
  verdict.classify(grade, task)           -> PASS / FAIL
finally: close session -> confirm worker pid dead -> kill -9 -> rm -rf scratch
```

Measured session mechanics:

```
SID=$(mog -s -i base.xlsx)              stdout is only the id
mog -s $SID -f turn.js                  workbook state persists across turns
mog -s $SID --close -o submission.xlsx  saves
```

`npm run bench` is already taken by the company's online harness
(`repo-readonly/package.json`), hence `bench:offline`.

---

## 8. Visibility

`events.jsonl`, **append-only, one `appendFileSync` per event**. That is what survives a
SIGKILL or a deadline. Nothing is ever truncated.

```
run.start     task seed model effort deadline_s mog_commit surface_members prompt_bytes
turn.start    n
llm.request   n attempt idem_key body_bytes input_items
llm.retry     n attempt status err_type err_code retry_after sleep_ms
llm.response  n response_id request_id status service_tier ms
              usage{input, cached, cache_write, output, reasoning, total}
              output_item_types[] text reasoning_summary
tool.call     n call_id code            <- FULL source, never truncated
tool.result   n call_id ms exit stdout  <- FULL output, never truncated
deadline.hit  n elapsed_ms
run.end       reason turns ms usage_total cost_usd
grade         <raw grader json>
verdict       pass failures[] discounted[]
```

Log **`x-request-id`** and **`response.id`** every turn — the first is what OpenAI support
asks for, the second is the handle for polling and cancel.

`transcript.md` is a **pure function of `events.jsonl`** (`render.mjs`), so a killed run
still renders and there is no second write path that can disagree with the first.

Cost from `usage`: `input×$2.50 + cached×$0.25 + output×$15.00` per 1M. Note
`reasoning_tokens ⊆ output_tokens` and `cached_tokens ⊆ input_tokens` — do not double-count.

### Artifacts

```
runs/<runId>/
  run.json                    aggregate summary
  <task>-s<seed>/
    events.jsonl              append-only, durable
    transcript.md             rendered from events.jsonl
    base.xlsx                 the agent's starting workbook
    submission.xlsx
    grade.json
    verdict.json
    meta.json                 timings, usage, cost, retries, session id, worker pid
```

---

## 9. `sweep.mjs` — fan-out

```
npm run sweep:offline -- --tasks 01,02,09 --seeds 3 --jobs 12 --ram-gb 32 --deadline 1200
```

### RAM model — measured on this binary

`worker RSS ≈ 20 MB + 0.0022 MB/cell`

| task | cells | measured |
|---|---|---|
| task_01 | 3,570 | 26 MB |
| task_09 | 12,586 | 43 MB |
| task_03 | 362,692 | **810 MB** |

All 15 concurrently ≈ 1.8 GB; 15×3 seeds ≈ 5.4 GB. On mac-personal (18 cores / 48 GB)
**cores bind, not RAM**. Cells come from the xlsx `<dimension>` — the old sweep's trick, and
its `PER_CELL_MB = 0.002` was right; only `BASE_MB = 300` was off, because it was sizing a
node+mog pair rather than a session worker.

### Admission — five fixes to the old sweep

```
admit if: running < jobsCap
      AND committed + predicted <= budget
      AND measuredFree() > floor                   closed-loop, not a static budget
      AND leaves room for the largest unstarted job  no starvation
biggest-first, rescan on every completion
```

### Process control

The old `sweep.mjs:79` SIGKILLed the `timeout` wrapper, orphaning the real runner **and**
releasing its full RAM estimate — every backstop fire double-committed memory.

```js
spawn(child, args, { detached: true })     // own process group
process.kill(-child.pid, 'SIGTERM')        // group; SIGKILL after a grace period
SIGINT/SIGTERM/exit -> group-kill every live child, then exit
```

### Cleanup

Per job and at run level: close session → confirm the `mog --session-worker` pid is gone →
`kill -9` → `rm -rf` scratch. Session workers **do** leak (two orphans were found on the VM),
so tracking the PID is required; `--close` alone is not enough.

`runs/` is pruned to the last N. The old `offline-runs/` grew without bound.

---

## 10. Build order

1. `surface.txt` generator + the ES2017 lint (both trivial, both gate everything else)
2. `Prompts.gs`, `Tools.gs` — no logic, just content
3. `adapters/node.mjs` — `exec` first, testable against mog with no model in the loop
4. `Agent.gs` — the loop, with a fake `ENV` for the retry/deadline tests
5. `bench.mjs` — one real run on task_09 (smallest, 21 output cells)
6. `render.mjs`
7. `sweep.mjs`
8. `adapters/gas.js` — last, because nothing offline depends on it

Steps 1–5 are the first real agent run. Everything after is scale and reporting.

---

## Recorded divergences

| | offline | online | why it is acceptable |
|---|---|---|---|
| deadline | 20 min | 360 s hard cap | recorded per run; you can see which would not have fitted |
| spreadsheet | `getActiveSpreadsheet()` | `openById(id)` | injected by `exec`; the model writes `ss` either way |
| key | env var | Script Properties | README line 27 |
| transport | curl | `UrlFetchApp` | same JSON in, same JSON out |
| streaming | none | impossible | `UrlFetchApp` buffers; `stream:false` everywhere |
