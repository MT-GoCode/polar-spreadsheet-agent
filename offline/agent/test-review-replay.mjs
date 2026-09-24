/* Replay retained transcripts and mechanically exercise selected RESTORE decisions.
   This tests restoration, not the model's ability to choose the repair. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,readdirSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nodeEnv} from './adapters/node.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),repo=process.argv[2]||root;
const mog=join(repo,'.mog/bin/mog'),py=join(repo,'.venv/bin/python'),pristine=join(repo,'..');
const src=['ReviewPrompt.gs','Submit.gs','Tools.gs','Agent.gs'].map(n=>readFileSync(join(here,n),'utf8')).join('\n');
const {ReviewTools,SubmitReview}=new Function(src+';return {ReviewTools,SubmitReview};')();
const shim=readFileSync(join(root,'dist/appsscript.js'),'utf8')+'\n'+readFileSync(join(here,'Tools.gs'),'utf8')+'\n'+readFileSync(join(here,'Describe.gs'),'utf8');
const runs=readdirSync(join(repo,'runs')).filter(n=>n.startsWith('2026-09-24T08-46-') && /_task_09_s[1-4]$/.test(n));
assert.equal(runs.length,4,'Expected four retained noisy restoration cases');
const artifacts=mkdtempSync(join(tmpdir(),'review-replay-')),results=[];console.log('ARTIFACTS '+artifacts);
for(const run of runs){
 const dir=join(artifacts,run),sessionDir=join(dir,'sessions');mkdirSync(sessionDir,{recursive:true,mode:0o700});
 const engineEnv={...process.env,MOG_SESSION_DIR:sessionDir},base=join(dir,'base.xlsx');copyFileSync(join(repo,'runs',run,'base.xlsx'),base);
 let session=execFileSync(mog,['-s','-i',base],{encoding:'utf8',env:engineEnv,timeout:60000}).trim(),env;
 try{
  env=nodeEnv({mog,shim,sessionId:session,sessionDir,eventsPath:join(dir,'events.jsonl'),apiKey:'unused',runStart:Date.now()});
  const io=ReviewTools.bridge(env,Date.now()+1200000),review=SubmitReview.create(io);
  const transcript=readFileSync(join(repo,'runs',run,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const oldResults=new Map(transcript.filter(e=>e.ev==='tool.result').map(e=>[e.call_id,e.out||'']));
  let calls=0,expectedErrors=0;
  for(const e of transcript.filter(e=>e.ev==='tool.call')){
   const r=io.exec(e.code,1200000);assert(r.ok,r.out);calls++;
   const errors=r.out.split('\n').filter(line=>line.startsWith('ERROR:'));
   for(const error of errors){assert((oldResults.get(e.call_id)||'').includes(error),'New replay error '+e.call_id+': '+error);expectedErrors++;}
  }
  const req=(x={})=>({mode:'review',report_id:null,decisions:[],checks:[],finish:false,page:0,group_ids:[],ranges:[],...x});
  let report=review.submit(req()),groups=[];
  for(let page=0;page<report.pages;page++)groups.push(...review.submit(req({report_id:report.report_id,page})).groups);
  const candidates=groups.filter(g=>g.sheet==='Cash Flow Valuation'&&g.property==='content');let target;
  for(const g of candidates){
   for(let page=0;page<Math.ceil(g.count/100);page++){
    const d=review.submit(req({mode:'inspect',report_id:report.report_id,group_ids:[g.id],page}));
    if(d.groups[0].facts.some(f=>f.row===24&&f.col===12)){target=g;break;}
   }if(target)break;
  }
  assert(target,'The needless rewrite must be visible');
  if(target.count>1){
   report=review.submit(req({mode:'split',report_id:report.report_id,group_ids:[target.id],ranges:['L24']}));groups=[];
   for(let page=0;page<report.pages;page++)groups.push(...review.submit(req({report_id:report.report_id,page})).groups);
   target=groups.find(g=>g.sheet==='Cash Flow Valuation'&&g.property==='content'&&g.count===1&&g.examples[0].cell==='L24');
  }
  const response=review.submit(req({report_id:report.report_id,decisions:groups.map(g=>({group_ids:[g.id],action:g.id===target.id?'restore':'keep',reason:g.id===target.id?'Mechanical test of preserving an original formula':'Keep the retained candidate for this mechanical test',evidence:['Original/current report; the test selects the repair, no model claim']}))}));
  assert.equal(response.status,'restored',JSON.stringify(response.application));
  const output=join(dir,'submission.xlsx');execFileSync(mog,['-s',session,'--close','-r','-o',output],{env:engineEnv,timeout:60000});session=null;
  const grade=join(dir,'grade.json');execFileSync(py,['-m','grader.google_grade','--task','task_09','--initial',base,'--golden',join(pristine,'benchmarks/tasks/task_09/golden.xlsx'),'--submission',output,'--out',grade],{cwd:pristine,timeout:60000});
  const verdict=JSON.parse(execFileSync(py,[join(repo,'agent/verdict_cli.py'),grade,'task_09',output,JSON.stringify(env.wroteSheets()),base],{encoding:'utf8',timeout:60000}));
  const result={run,pass:verdict.pass,failures:verdict.failures,calls,expectedErrors,newErrors:0};results.push(result);console.log(JSON.stringify(result));
 }catch(e){results.push({run,pass:false,error:String(e.stack||e)});console.log(run+' FAIL '+e.message.slice(0,500));}
 finally{if(session)try{execFileSync(mog,['-s',session,'--close','--discard'],{env:engineEnv,timeout:30000})}catch{}if(env)env.cleanup();}
 writeFileSync(join(artifacts,'results.json'),JSON.stringify(results,null,2));
}
console.log('RESULTS '+JSON.stringify(results));if(results.some(r=>!r.pass))process.exitCode=1;
