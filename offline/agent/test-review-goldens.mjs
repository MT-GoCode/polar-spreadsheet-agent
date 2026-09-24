/* Golden scripts are test inputs only. Shared harness never reads a golden or grader mask. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nodeEnv} from './adapters/node.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),repo=process.argv[2]||root;
const tasks=process.argv.slice(3).length?process.argv.slice(3):Array.from({length:15},(_,i)=>'task_'+String(i+1).padStart(2,'0'));
const mog=join(repo,'.mog/bin/mog'),py=join(repo,'.venv/bin/python'),pristine=join(repo,'..');
const shared=['ReviewPrompt.gs','Submit.gs','Tools.gs','Agent.gs'].map(n=>readFileSync(join(here,n),'utf8')).join('\n');
const {ReviewTools,SubmitReview}=new Function(shared+';return {ReviewTools,SubmitReview};')();
const shim=readFileSync(join(root,'dist/appsscript.js'),'utf8')+'\n'+readFileSync(join(here,'Tools.gs'),'utf8');
const artifacts=mkdtempSync(join(tmpdir(),'review-golden-')),results=[];
writeFileSync(join(artifacts,'harness.gs'),shared);writeFileSync(join(artifacts,'shim.js'),shim);
writeFileSync(join(artifacts,'manifest.json'),JSON.stringify({source_sha256:createHash('sha256').update(shared).update(shim).digest('hex')},null,2));
console.log('ARTIFACTS '+artifacts);
for(const task of tasks){
 const start=Date.now(),dir=join(artifacts,task),sessionDir=join(dir,'sessions');mkdirSync(sessionDir,{recursive:true,mode:0o700});
 const engineEnv={...process.env,MOG_SESSION_DIR:sessionDir},base=join(dir,'base.xlsx'),output=join(dir,'submission.xlsx');
 let session=null,env=null;
 console.log(task+' START');
 try{
  execFileSync(mog,['-i',join(pristine,'benchmarks/tasks',task,'init.xlsx'),'-o',base,'-r'],{env:engineEnv,timeout:1200000});
  session=execFileSync(mog,['-s','-i',base],{encoding:'utf8',env:engineEnv,timeout:60000}).trim();
  env=nodeEnv({mog,shim,sessionId:session,sessionDir,eventsPath:join(dir,'events.jsonl'),apiKey:'unused',runStart:start});
  const io=ReviewTools.bridge(env,Date.now()+1200000),t0=Date.now(),controller=SubmitReview.create(io);
  console.log(task+' baseline '+Math.round((Date.now()-t0)/1000)+'s');
  const req=(x={})=>({mode:'review',report_id:null,decisions:[],finish:false,page:0,group_ids:[],ranges:[],checks:[],...x});
  assert.equal(controller.submit(req()).changed_properties,0);
  const script=readFileSync(join(repo,'e2e/solution-'+task+'.js'),'utf8').replace('var ss = SpreadsheetApp.getActiveSpreadsheet();','').replaceAll('__LOG__','log');
  const executed=io.exec(script,1200000);assert(executed.ok,executed.out);assert(!executed.out.includes('ERROR:'),executed.out);
  const t1=Date.now(),report=controller.submit(req()),decisions=[];
  for(let p=0;p<report.pages;p++){
   const page=p?controller.submit(req({report_id:report.report_id,page:p})):report;
   for(const g of page.groups)decisions.push({group_ids:[g.id],action:'keep',reason:'Mechanical golden-control run; external grader checks afterward',evidence:['Script execution succeeded; this control tests harness preservation, not model judgment']});
  }
  const complete=controller.submit(req({report_id:report.report_id,decisions,finish:true,checks:[{obligation:'Run control unchanged',observation:'Golden script completed',check:'External unchanged grader will verify after export',outcome:'satisfied'}]}));
  assert.equal(complete.status,'complete',JSON.stringify(complete));
  const reviewMs=Date.now()-t1;
  execFileSync(mog,['-s',session,'--close','-r','-o',output],{env:engineEnv,timeout:60000});session=null;
  const grade=join(dir,'grade.json');
  execFileSync(py,['-m','grader.google_grade','--task',task,'--initial',base,'--golden',join(pristine,'benchmarks/tasks',task,'golden.xlsx'),'--submission',output,'--out',grade],{cwd:pristine,encoding:'utf8',timeout:180000});
  const verdict=JSON.parse(execFileSync(py,[join(repo,'agent/verdict_cli.py'),grade,task,output,JSON.stringify(env.wroteSheets()),base],{encoding:'utf8',timeout:60000}));
  const result={task,pass:verdict.pass,failures:verdict.failures,ms:Date.now()-start,reviewMs,groups:report.groups_total};results.push(result);console.log(JSON.stringify(result));
 }catch(e){results.push({task,pass:false,error:String(e.stack||e),ms:Date.now()-start});console.log(task+' FAIL '+e.message.slice(0,700));}
 finally{if(session)try{execFileSync(mog,['-s',session,'--close','--discard'],{env:engineEnv,timeout:30000})}catch{}if(env)env.cleanup();}
 writeFileSync(join(artifacts,'results.json'),JSON.stringify(results,null,2));
}
console.log('RESULTS '+JSON.stringify(results));if(results.some(r=>!r.pass))process.exitCode=1;
