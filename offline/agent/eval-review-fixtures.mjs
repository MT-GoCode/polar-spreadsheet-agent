/* Fixed-medium semantic evaluation. Only task, original/current workbook and shared
   prompt reach the model. The fixture's expected fields are used AFTER completion. */
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nodeEnv} from './adapters/node.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),repo=process.argv[2]||root;
const oracleOnly=process.argv.includes('--oracle-only');
if(!oracleOnly && !process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY must be set; the key is never logged');
const mog=join(repo,'.mog/bin/mog'),python=join(repo,'.venv/bin/python');
const names=['ReviewPrompt.gs','Submit.gs','Tools.gs','Agent.gs','Prompts.gs'];
const source=names.map(n=>readFileSync(join(here,n),'utf8')).join('\n');
const {ReviewTools,runLoop,CFG,SYSTEM_PROMPT}=new Function(source+';return {ReviewTools,runLoop,CFG,SYSTEM_PROMPT};')();
const describe=readFileSync(join(here,'Describe.gs'),'utf8'),tools=readFileSync(join(here,'Tools.gs'),'utf8');
const shim=readFileSync(join(root,'dist/appsscript.js'),'utf8')+'\n'+tools+'\n'+describe;
const system=SYSTEM_PROMPT.replace('<valid-surface-placeholder>',()=>readFileSync(join(here,'surface.txt'),'utf8'))
 .replace('<describe-source-placeholder>',()=>describe);
const fixtures=JSON.parse(readFileSync(join(here,'submit-review/semantic-fixtures.json'),'utf8'));
const selected=process.argv.slice(3).filter(s=>s!=='--oracle-only'),cases=selected.length?fixtures.filter(c=>selected.includes(c.name)):fixtures;
if(!cases.length)throw new Error('No matching fixtures');
const artifacts=mkdtempSync(join(tmpdir(),'review-semantic-')),results=[];
writeFileSync(join(artifacts,'harness.gs'),source);writeFileSync(join(artifacts,'shim.js'),shim);
writeFileSync(join(artifacts,'manifest.json'),JSON.stringify({model:CFG.model,effort:CFG.effort,prompt_sha256:createHash('sha256').update(readFileSync(join(here,'ReviewPrompt.gs'))).digest('hex'),source_sha256:createHash('sha256').update(source).update(shim).digest('hex')},null,2));
console.log('ARTIFACTS '+artifacts);
function scriptFor(values={},formats={}){
 let out="var s=ss.getSheets()[0];\n";
 for(const [a,v] of Object.entries(values))out+='s.getRange('+JSON.stringify(a)+').setValue('+JSON.stringify(v)+');\n';
 const setters={numberFormat:'setNumberFormat',fontWeight:'setFontWeight'};
 for(const [a,props] of Object.entries(formats))for(const [p,v] of Object.entries(props)){
  if(!setters[p])throw new Error('Unknown fixture format '+p);
  out+='s.getRange('+JSON.stringify(a)+').'+setters[p]+'('+JSON.stringify(v)+');\n';
 }
 return out;
}
for(const f of cases)for(const variant of ['mutation','passing_control']){
 const id=f.name+'-'+variant,dir=join(artifacts,id),sessionDir=join(dir,'sessions');mkdirSync(sessionDir,{recursive:true,mode:0o700});
 const engineEnv={...process.env,MOG_SESSION_DIR:sessionDir},input=join(dir,'input.xlsx');
 execFileSync(python,['-c','from openpyxl import Workbook; import sys; w=Workbook(); w.active.title="Main"; w.save(sys.argv[1])',input]);
 let session=execFileSync(mog,['-s','-i',input],{encoding:'utf8',env:engineEnv,timeout:30000}).trim(),env;
 try{
  env=nodeEnv({mog,shim,sessionId:session,sessionDir,eventsPath:join(dir,'events.jsonl'),apiKey:process.env.OPENAI_API_KEY||'unused',runStart:Date.now()});
  const setup=env.exec(scriptFor(f.original,f.originalFormats));if(!setup.ok||setup.out.includes('ERROR:'))throw new Error(setup.out);
  const io=ReviewTools.bridge(env,Date.now()+CFG.deadlineMs),original=io.capture();
  const candidate=io.exec(scriptFor(f.candidates[variant],(f.candidateFormats||{})[variant]),120000);if(!candidate.ok||candidate.out.includes('ERROR:'))throw new Error(candidate.out);
  // Initialize the ordinary controller with the real pre-candidate original, then all
  // subsequent captures are the real live workbook. No expected answers enter ENV.
  let first=true;env.review={...io,capture:()=>{if(first){first=false;return original;}return io.capture();}};
  const firstMessage=f.task+'\n\nThe workbook already contains a proposed solution. Review it through submit(), inspect evidence and repair only justified errors. Preserve supported correct work. Start by requesting the review report.';
  const run=oracleOnly?{reason:'oracle_only'}:runLoop(env,{system,first:firstMessage});
  const expected={};
  for(const [a,v] of Object.entries(f.original))expected[a]=typeof v==='string'&&v.startsWith('=')?{formulaExact:v}:{value:v};
  for(const [a,props] of Object.entries(f.originalFormats||{}))expected[a]={...(expected[a]||{}),...props};
  for(const [a,props] of Object.entries(f.expected))expected[a]={...(expected[a]||{}),...props};
  const addresses=Object.keys(expected);
  const observed=env.exec('log(JSON.stringify('+JSON.stringify(addresses)+'.map(function(a){var r=ss.getSheets()[0].getRange(a);return {cell:a,value:r.getValue(),formula:r.getFormula(),numberFormat:r.getNumberFormat(),fontWeight:r.getFontWeight()};})));');
  if(!observed.ok)throw new Error(observed.out);
  const cells=JSON.parse(observed.out.trim()),failures=[];
  for(const c of cells){const x=expected[c.cell],v=c.value===''?null:c.value;
   if('value' in x && (typeof x.value==='number'?!(typeof v==='number'&&Math.abs(v-x.value)<=1e-8*Math.max(1,Math.abs(x.value))):v!==x.value))failures.push(c.cell+': value');
   if(x.formula && (!c.formula || /^=[\d.]+$/.test(c.formula)))failures.push(c.cell+': live formula');
   if(x.literal && c.formula)failures.push(c.cell+': literal required');
   if(x.formulaExact && x.formulaExact!==c.formula)failures.push(c.cell+': preserved formula');
   for(const p of ['fontWeight','numberFormat'])if(p in x && x[p]!==c[p])failures.push(c.cell+': '+p);
  }
  const result={id,variant,requirements:f.requirements,pass:!failures.length,review_complete:run.reason==='done',failures,run};results.push(result);console.log(JSON.stringify(result));
  execFileSync(mog,['-s',session,'--close','-r','-o',join(dir,'submission.xlsx')],{env:engineEnv,timeout:60000});session=null;
 }catch(e){results.push({id,variant,pass:false,harness_error:String(e.stack||e)});console.log(id+' HARNESS ERROR '+e.message);}
 finally{if(session)try{execFileSync(mog,['-s',session,'--close','--discard'],{env:engineEnv,timeout:30000})}catch{}if(env)env.cleanup();}
 writeFileSync(join(artifacts,'results.json'),JSON.stringify(results,null,2));
}
const mutations=results.filter(r=>r.variant==='mutation'),controls=results.filter(r=>r.variant==='passing_control');
const summary={oracleOnly,mutations:{repaired:mutations.filter(r=>r.pass).length,total:mutations.length},controls:{retained:controls.filter(r=>r.pass).length,total:controls.length},harness_errors:results.filter(r=>r.harness_error).length};
writeFileSync(join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log('SUMMARY '+JSON.stringify(summary));

if(oracleOnly){const valid=results.every(r=>!r.harness_error && r.pass===(r.variant==='passing_control'));console.log('FIXTURE INTEGRITY '+(valid?'PASS':'FAIL'));if(!valid)process.exitCode=1;}
