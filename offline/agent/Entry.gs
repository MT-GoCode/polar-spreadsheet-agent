/* Candidate entry point, bundled with the shared harness for online deployment. */
function runAgent(request) {
  if(!request || !String(request.prompt||'').trim() || !request.spreadsheetId)throw new Error('prompt and spreadsheetId are required');
  var env=gasEnv(request.spreadsheetId),started=Date.now();
  /* 120 s of the 360 s execution. Describe is CPU-bound on big workbooks and cannot be
     parallelised or batched further (reads are already one getValues per sheet), so the
     only lever is spending a fixed slice and handing the rest to the agent. task_03 wrote
     zero cells when describe was unbounded. */
  var map=env.exec('log(describe_spreadsheet(ss,120000,60000));log("<<<MAP-OK>>>");',300000);
  var text=map.out||'',ok=map.ok && /\n<<<MAP-OK>>>\s*$/.test(text);
  var description=ok?text.slice(0,text.lastIndexOf('<<<MAP-OK>>>')).trim():'[NO MAP AVAILABLE: read relevant workbook ranges through run_apps_script.]';
  var system=SYSTEM_PROMPT.replace('<valid-surface-placeholder>',function(){return AGENT_SURFACE;})
    .replace('<describe-source-placeholder>',function(){return AGENT_DESCRIBE_SOURCE;});
  var first=FIRST_PROMPT.replace('<prompt>',function(){return request.prompt;})
    .replace('<describe_spreadsheet>',function(){return description;});
  /* Offline, bench.mjs records this as run.start + manifest.json. Online there is no
     harness writing files, so the same provenance has to be emitted into the transcript
     that rides home -- otherwise a run cannot be told apart from another, or tied to the
     source that produced it. Prompt bytes and a digest rather than the prompts themselves:
     they are ~100 KB and fully determined by the deployed source plus the map. */
  /* PROGRESS BEACON. Nothing runAgent returns survives Apps Script killing the execution
     at 360 s -- the tail that overruns is Runtime.gs, outside our control -- and four
     task_03 runs died leaving no turns, no timing, no transcript. A tiny Drive file
     written as we go DOES survive, and is readable afterwards with the Drive scope we
     already hold. Overwrite one file per run; ~0.3 s a write, only on phase changes. */
  function beacon(state){
    try{
      var name='agent-progress-'+request.spreadsheetId+'.json';
      var body=JSON.stringify(state);
      var hit=DriveApp.getFilesByName(name),f;
      if(hit.hasNext()){f=hit.next();f.setContent(body);}
      else{
        f=DriveApp.createFile(name,body);
        /* Files an Apps Script creates are owned by THAT app, and the benchmark's token is
           a different app -- drive.file scoping then denies the read, which is exactly how
           the first beacon came back 403. Link-visible so it can be fetched without auth.
           Contents are turn counts and elapsed times; no workbook data, no credentials. */
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
      }
    }catch(e){}   // diagnostics must never break the run
  }
  beacon({phase:'described',map_ok:ok,map_bytes:description.length,describe_ms:Date.now()-started});
  env.beacon=beacon;
  env.event({ev:'run.start',model:CFG.model,effort:CFG.effort,
    script_id:ScriptApp.getScriptId(),spreadsheet_id:request.spreadsheetId,
    map_ok:ok,map_bytes:description.length,
    system_bytes:system.length,first_bytes:first.length,
    prompt_sha256:Utilities.base64Encode(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,system+first)),
    describe_ms:Date.now()-started});
  /* Apps Script kills the whole execution at 360 s, and runAgent is only the middle of it.
     Runtime.gs then flushes, samples the outputs until they settle (up to 10 reads a second
     apart), re-reads them as formulas, and OPENS AND READS THE GOLDEN WORKBOOK. A 30 s
     reserve was not enough: task_01 returned at ~330 s and the post-work overran 360 s, so
     Google killed the execution mid-response -- the client saw `fetch failed`, and with no
     response the run was not graded at all and the transcript was lost. A budget that ends
     early still grades; one that overruns scores nothing. Measured post-agent cost on a
     no-edit run was 3.2 s, but that is the floor (settle converged immediately); 60 s
     covers a full 10-sample settle plus the golden read.
     ponytail: fixed 60 s reserve. Tune from `timing.calculation_ms + final_read_ms` in
     response.json once real edited runs report it. */
  var result=runLoop(env,{system:system,first:first,deadlineMs:Math.max(1,300000-(Date.now()-started))});
  var t=env.transcript();
  result.events=t.events;result.transcript_bytes=t.bytes;result.transcript_truncated=t.truncated;
  return result;
}
