/* Online ENV. All review logic remains in Tools.gs / Submit.gs / Agent.gs.
   This adapter uses SpreadsheetApp only to bind ss; no Sheets API calls. */
function gasEnv(spreadsheetId) {
  var ss=SpreadsheetApp.openById(spreadsheetId);
  var p=PropertiesService.getScriptProperties();
  // Accept either name: the assessment README suggests OPENAI_API_KEY, this project was
  // provisioned with OPENAI_KEY. Reading both means the deployment works as provisioned.
  var key=p.getProperty('OPENAI_API_KEY')||p.getProperty('OPENAI_KEY');
  if(!key)throw new Error('Set OPENAI_API_KEY (or OPENAI_KEY) in Script Properties');
  var started=Date.now(),ledger=[],ledgerBytes=0,truncated=false;
  /* Offline the transcript is events.jsonl. Online, runAgent's RETURN VALUE is the only
     channel home: console.log goes to Stackdriver, which the benchmark never reads. So
     every event is logged AND collected. 4 MB is ~10x a typical offline transcript
     (220-460 KB) and bounds the response if an event ever grows the way review.baseline
     once did (167 MB on task_03). */
  var LEDGER_CAP=4000000;
  return {
    uuid:function(){return Utilities.getUuid();},
    sleep:function(ms){Utilities.sleep(ms);},
    event:function(e){
      /* Summarise the one payload that is genuinely large, then log and collect the same
         record. Reaching into event fields here once killed a run at turn 0 (Tools.gs:283
         stopped carrying `snapshot` in 43fa35d); the Node adapter writes events verbatim
         without reading fields, so offline is structurally blind to that class. Hence the
         catch: telemetry must never abort a run. */
      var rec=e;
      try{
        if(e.ev==='review.original_extension')rec={ev:e.ev,cells:Object.keys(e.cells).length};
        else if(e.ev==='review.submit' || e.ev==='review.implicit')
          rec={ev:e.ev,n:e.n,status:e.result.status,report_id:e.result.report_id};
      }catch(err){rec={ev:e&&e.ev,summary_error:String(err.message||err)};}
      var line;
      try{line=JSON.stringify(rec);}
      catch(err){rec={ev:e&&e.ev,stringify_error:String(err.message||err)};line=JSON.stringify(rec);}
      console.log(line);
      if(ledgerBytes+line.length<=LEDGER_CAP){ledgerBytes+=line.length;ledger.push(rec);}
      else if(!truncated){truncated=true;ledger.push({ev:'transcript.truncated',kept_bytes:ledgerBytes});}
    },
    http:function(url,headers,body,timeoutMs){
      if(timeoutMs<=0)return {status:0,headers:{},body:'Deadline reached'};
      var h={Authorization:'Bearer '+key};Object.keys(headers).forEach(function(k){h[k]=headers[k];});
      try{
        var response=UrlFetchApp.fetch(url,{method:'post',headers:h,payload:body,muteHttpExceptions:true});
        var raw=response.getAllHeaders(),out={};Object.keys(raw).forEach(function(k){out[k.toLowerCase()]=String(raw[k]);});
        return {status:response.getResponseCode(),headers:out,body:response.getContentText()};
      }catch(e){return {status:0,headers:{},body:String(e.message||e)};}
    },
    exec:function(code,timeoutMs){
      if(timeoutMs!==undefined && timeoutMs<=0)return {ok:false,out:'Deadline reached'};
      var logs=[];
      function log(v){logs.push(typeof v==='string'?v:JSON.stringify(v));}
      try{runHarnessScript(ss,log,code);}
      catch(e){logs.push('ERROR: '+String(e.message||e));}
      return {ok:true,out:logs.join('\n')};
    },
    transcript:function(){return {events:ledger,bytes:ledgerBytes,truncated:truncated};}
  };
}
