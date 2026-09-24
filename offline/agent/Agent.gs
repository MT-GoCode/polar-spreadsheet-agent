/* THE LOOP. Ships inside the submission unchanged.
   Touches nothing but ENV -- five functions the platform supplies:
     http(url, headers, bodyString) -> {status, headers, body}
     exec(code)                     -> {ok, out}      runs Apps Script against the workbook
     uuid()                         -> string
     sleep(ms)
     event(obj)                     -> records one transcript event
   Synchronous throughout, because Runtime.gs:160 calls runAgent synchronously and
   UrlFetchApp.fetch is synchronous. An async loop cannot ship. */

var CFG = {
  model: "gpt-5.4",
  effort: "medium",          // default is "none" -- must be sent explicitly EVERY request
  deadlineMs: 1200000,       // 20 min; Node adapter caps blocking calls to remaining budget
  maxOutputTokens: 32000,
  contextLimit: 1050000,
  promptCacheKey: "polar-v1",
  timeoutMs: 600000,
  /* Neither a model call nor a run_apps_script call can be interrupted once started:
     UrlFetchApp takes no timeout and Apps Script cannot preempt itself. So the deadline
     must be a point after which we start NOTHING NEW, leaving the operation already in
     flight room to land inside the budget. task_03 overran its 300 s budget by 29 s this
     way, and the overrun cost the whole response. */
  opReserveMs: 60000,
  maxAttempts: 8,
  /* What the MODEL sees. ~100 KB ~= 25k tokens, and a tool result stays in `input` for
     EVERY later turn, so it compounds -- four big dumps is ~100k tokens carried for the
     rest of the run, well inside the 1,050,000 window. The full text always lands in
     events.jsonl regardless. Hitting this cap usually means the read was a bad idea; the
     model is told how much was cut so it can narrow the range and try again. */
  toolOutputCap: 100000
};


function retryable(status, body) {
  if (status === 0 || status === 408 || status === 409 || status === 429 || status >= 500) {
    var code = body && body.error && body.error.code;
    if (code === "insufficient_quota" || code === "credit_balance_exhausted" ||
        code === "organization_spend_limit_exceeded") return false;   // money, not load
    return true;
  }
  return false;
}

function callModel(env, input, idem, deadline) {
  var body = JSON.stringify({
    model: CFG.model,
    reasoning: { effort: CFG.effort },
    store: false,
    prompt_cache_key: CFG.promptCacheKey,
    max_output_tokens: CFG.maxOutputTokens,
    parallel_tool_calls: false,    // spreadsheet edits are order-dependent
    tools: agentTools(),                  // fixed order: reordering invalidates the cache prefix
    input: input
  });
  for (var attempt = 1; attempt <= CFG.maxAttempts; attempt++) {
    env.event({ ev: "llm.request", attempt: attempt, idem: idem, body_bytes: body.length,
                input_items: input.length });
    if (Date.now() >= deadline) return { fatal: "deadline", reason: "deadline" };
    var r = env.http("https://api.openai.com/v1/responses",
                     { "Content-Type": "application/json", "Idempotency-Key": idem }, body, Math.min(CFG.timeoutMs, deadline - Date.now()));
    var parsed = null;
    try { parsed = JSON.parse(r.body); } catch (e) { parsed = null; }
    if (r.status === 200 && parsed && Array.isArray(parsed.output) &&
        (parsed.status === "completed" || parsed.status === "incomplete")) return { resp: parsed, reqId: r.headers["x-request-id"] };
    var retryHeader = r.headers["retry-after"] || "";
    var ra = /^\d+(\.\d+)?$/.test(retryHeader) ? Number(retryHeader) :
             (Date.parse(retryHeader) - Date.now()) / 1000;
    var wait = ra > 0 ? ra * 1000 :
      Math.min((r.status === 429 ? 10000 : 2000) * Math.pow(2, attempt - 1), 60000);
    wait += Math.floor(Math.random() * 1000);
    env.event({ ev: "llm.retry", attempt: attempt, status: r.status,
                err: parsed && parsed.error ? parsed.error : String(r.body).slice(0, 300),
                retry_after: ra || null, sleep_ms: wait });
    if (!(retryable(r.status, parsed) || (r.status === 200 && !parsed)) || attempt === CFG.maxAttempts)
      return { fatal: "http " + r.status + ": " + String(r.body).slice(0, 400) };
    if (Date.now() + wait >= deadline) return { fatal: "deadline during retry", reason: "deadline" };
    env.sleep(wait);
  }
}

function runLoop(env, opts) {
  var enginefails = 0;
  var started = Date.now(), deadline = started + (opts.deadlineMs === undefined ? CFG.deadlineMs : opts.deadlineMs);
  var reviewIO = opts.review === false ? null : (env.review || ReviewTools.bridge(env, deadline));
  var reviewer;
  /* SubmitReview.create takes the review BASELINE -- a full-workbook capture of values,
     formulas and ten formatting properties. On a 22k-row sheet that is millions of getter
     reads, it runs BEFORE turn 1, and nothing inside it checks the clock. Bracket it so a
     killed run says whether it died here rather than in the model loop. */
  if (env.beacon) env.beacon({ phase: "baseline.start", ms_left: deadline - Date.now() });
  try { reviewer = opts.review === false ? null : SubmitReview.create(reviewIO, {
    deadline: deadline, maxRounds: 3, pageSize: 30
  }); } catch (e) {
    var failure={reason:Date.now()>=deadline?'deadline':'review_error',turns:0,ms:Date.now()-started,
      usage:{input:0,cached:0,output:0,reasoning:0},cost_usd:0,error:String(e.message||e)};
    env.event({ev:'review.error',error:failure.error});env.event({ev:'run.end',reason:failure.reason,turns:0,ms:failure.ms,cost_usd:0});return failure;
  }
  if (env.beacon) env.beacon({ phase: "baseline.done", ms_left: deadline - Date.now() });
  var stopsWithoutSubmit = 0;
  var input = [
    { role: "developer", content: opts.system },
    { role: "user", content: opts.first }
  ];
  /* `usage` is CUMULATIVE across turns -- it is what the run costs. `lastInput` is the
     size of the most recent request, which is what the context window actually holds.
     Comparing the cumulative figure against the context limit ended runs early: twenty
     turns of a 50k-token request summed to 1M and tripped the limit, though no single
     request was ever near it. A bigger system prompt makes that fire sooner. */
  var usage = { input: 0, cached: 0, output: 0, reasoning: 0 };
  var lastInput = 0, longContext = false;
  var turn = 0, reason = "done";

  mainLoop: for (;;) {
    if (Date.now() >= deadline - CFG.opReserveMs) { reason = "deadline"; break; }
    if (lastInput >= CFG.contextLimit * 0.95) { reason = "context_exhausted"; break; }

    turn++;
    env.event({ ev: "turn.start", n: turn });
    /* ENV.beacon is optional and online-only: a durable marker that survives the platform
       killing the execution, which no return value can. Offline the transcript is already
       on disk per event, so the Node adapter supplies none. */
    if (env.beacon) env.beacon({ phase: "turn", turn: turn, ms_left: deadline - Date.now() });
    var t0 = Date.now();
    var call = callModel(env, input, env.uuid(), deadline);
    if (call.fatal) {
      env.event({ ev: "llm.fatal", n: turn, error: call.fatal });
      reason = call.reason || "llm_error"; break;
    }
    var resp = call.resp;
    var u = resp.usage || {};
    var det = u.input_tokens_details || {}, odet = u.output_tokens_details || {};
    longContext = longContext || (u.input_tokens || 0) > 272000;
    lastInput = u.input_tokens || 0;            // what this request put in the window
    usage.input += u.input_tokens || 0;          // cumulative, for cost
    usage.cached += det.cached_tokens || 0;
    usage.output += u.output_tokens || 0;
    usage.reasoning += odet.reasoning_tokens || 0;

    var text = "", calls = [];
    for (var i = 0; i < (resp.output || []).length; i++) {
      var item = resp.output[i];
      if (item.type === "function_call") calls.push(item);
      if (item.type === "message" && item.content)
        for (var j = 0; j < item.content.length; j++)
          if (item.content[j].text) text += item.content[j].text;
    }
    env.event({ ev: "llm.response", n: turn, response_id: resp.id, request_id: call.reqId,
                status: resp.status, service_tier: resp.service_tier,
                ms: Date.now() - t0, usage: u, text: text,
                output_types: (resp.output || []).map(function (o) { return o.type; }) });

    /* Echo EVERY output item back verbatim, including reasoning with its encrypted_content.
       Dropping them makes the model silently re-derive its chain each turn. */
    for (var k = 0; k < (resp.output || []).length; k++) input.push(resp.output[k]);

    /* A response truncated by max_output_tokens contains no function_call, so without this
       it reads as a clean finish. */
    if (resp.status === "incomplete" && !calls.length) { reason = "incomplete"; break; }
    if (!calls.length) {
      if (!reviewer) { reason = "done"; break; }
      stopsWithoutSubmit++;
      if (stopsWithoutSubmit > 2) { reason = "review_invalid"; break; }
      var reviewResult = reviewer.submit({mode:"review",report_id:null,decisions:[],finish:false,page:0,group_ids:[],ranges:[],checks:[]});
      env.event({ev:"review.implicit",n:turn,result:reviewResult});
      if (["review_limit","review_invalid","review_error","deadline"].indexOf(reviewResult.status)>=0) { reason = reviewResult.status; break; }
      input.push({role:"developer",content:"Completion requires submit review. " + JSON.stringify(reviewResult)});
      continue;
    }

    for (var c = 0; c < calls.length; c++) {
      if (Date.now() >= deadline - CFG.opReserveMs) { reason = "deadline"; break mainLoop; }
      var fc = calls[c], code = "";
      if (fc.name === "submit" && reviewer) {
        var submitted;
        try { submitted = reviewer.submit(JSON.parse(fc.arguments)); }
        catch (e) { submitted = reviewer.submit(null); }
        stopsWithoutSubmit = 0;
        env.event({ev:"review.submit",n:turn,call_id:fc.call_id,arguments:fc.arguments,result:submitted});
        input.push({type:"function_call_output",call_id:fc.call_id,output:JSON.stringify(submitted)});
        if (submitted.complete) { reason = "done"; break mainLoop; }
        if (["review_limit","review_invalid","review_error","deadline"].indexOf(submitted.status)>=0) { reason = submitted.status; break mainLoop; }
        continue;
      }
      try {
        code = JSON.parse(fc.arguments).code;
        if (fc.name !== "run_apps_script" || typeof code !== "string")
          throw new Error("expected run_apps_script with a string code field");
      }
      catch (e) {
        /* Malformed arguments are the model's problem to fix, not a crash. Hand it back. */
        env.event({ ev: "tool.badargs", n: turn, call_id: fc.call_id, raw: fc.arguments });
        input.push({ type: "function_call_output", call_id: fc.call_id,
                     output: "ERROR: your arguments were not valid JSON: " + e.message });
        continue;
      }
      env.event({ ev: "tool.call", n: turn, call_id: fc.call_id, code: code });
      var e0 = Date.now();
      var res = (reviewIO && reviewIO.exec ? reviewIO : env).exec(code, Math.max(1, deadline - Date.now()));
      if (!res.ok) {
        /* Engine failure. Syntax errors never reach here -- the adapter checks parseability
           first and returns those as ordinary results. What lands here is the engine itself
           refusing the script. One of those is survivable: the session is still open and the
           next turn may well work. Two in a row means the engine really is gone, and there is
           no point letting the agent argue with a corpse. */
        env.event({ ev: "tool.enginefail", n: turn, call_id: fc.call_id, detail: res.out,
                    consecutive: enginefails + 1 });
        enginefails++;
        if (enginefails >= 2) { reason = "session_dead"; break mainLoop; }
        input.push({ type: "function_call_output", call_id: fc.call_id,
                     output: "ERROR: the script engine rejected that script:\n" + res.out +
                             "\nExecution state is uncertain; earlier writes may have applied. Read affected cells before retrying." });
        continue;
      }
      enginefails = 0;
      var full = res.out || "";
      var shown = full.length > CFG.toolOutputCap
        ? full.slice(0, CFG.toolOutputCap) + "\n[... cut " + (full.length - CFG.toolOutputCap) + " bytes]"
        : full;
      env.event({ ev: "tool.result", n: turn, call_id: fc.call_id, ms: Date.now() - e0,
                  bytes: full.length, shown_bytes: shown.length, out: full });
      input.push({ type: "function_call_output", call_id: fc.call_id, output: shown });
    }
  }

  var cost = (((usage.input - usage.cached) * 2.50 + usage.cached * 0.25) *
              (longContext ? 2 : 1) + usage.output * 15.00 * (longContext ? 1.5 : 1)) / 1e6;
  var out = { reason: reason, turns: turn, ms: Date.now() - started, usage: usage,
              cost_usd: Math.round(cost * 10000) / 10000, cost_estimated: true, long_context: longContext };
  env.event({ ev: "run.end", reason: reason, turns: turn, ms: out.ms, usage: usage,
              cost_usd: out.cost_usd });
  return out;
}
