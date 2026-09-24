/* Offline regressions: no credentials, API, or Mog binary required. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nodeEnv} from './adapters/node.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const src=['ReviewPrompt.gs','Submit.gs','Tools.gs','Agent.gs'].map(n=>fs.readFileSync(path.join(root,n),'utf8')).join('\n');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
function setup(respond,execute=()=>({ok:true,out:'ok'})){
 const {runLoop,CFG}=new Function(src+';return {runLoop,CFG}')();
 const events=[],requests=[],sleeps=[];
 let n=0;
 const env={uuid:()=>String(n),event:e=>events.push(e),sleep:ms=>sleeps.push(ms),exec:execute,
 http:(url,headers,body)=>{requests.push(JSON.parse(body));return respond(++n);}};
 return {run:()=>runLoop(env,{system:'test',first:'task',review:false}),CFG,events,requests,sleeps};
}
const tool=(code='log(1)',name='run_apps_script')=>({type:'function_call',call_id:'c',name,arguments:JSON.stringify({code})});
const response=(output=[],input=50000,status='completed')=>({status:200,headers:{},body:JSON.stringify({status,output,usage:{input_tokens:input,output_tokens:10}})});
test('cumulative tokens do not exhaust current context',()=>{
 const s=setup(n=>response(n<=25?[tool()]:[])); const r=s.run();
 assert.equal(r.reason,'done');assert.equal(r.turns,26);assert.equal(r.usage.input,1300000);
});
test('retry transport failure without running a tool twice',()=>{
 let executions=0; const s=setup(n=>n===1?{status:0,headers:{},body:'network'}:response(n===2?[tool()]:[]),()=>{executions++;return {ok:true,out:'ok'}});
 assert.equal(s.run().reason,'done');assert.equal(executions,1);assert.equal(s.sleeps.length,1);
});
test('quota failure stops without retry',()=>{
 const s=setup(()=>({status:429,headers:{},body:'{"error":{"code":"insufficient_quota"}}'}));
 assert.equal(s.run().reason,'llm_error');assert.equal(s.requests.length,1);
});
test('failed HTTP-200 response is not successful completion',()=>{
 const s=setup(()=>response([],0,'failed'));assert.equal(s.run().reason,'llm_error');
});
test('malformed function arguments never execute',()=>{
 let executions=0;const s=setup(n=>response(n===1?[tool(42)]:[]),()=>{executions++;return {ok:true,out:''}});
 assert.equal(s.run().reason,'done');assert.equal(executions,0);assert(s.requests[1].input.some(x=>x.type==='function_call_output'));
});
test('engine death still emits run.end and cost',()=>{
 const s=setup(()=>response([tool()]),()=>({ok:false,out:'failed'}));const r=s.run();
 assert.equal(r.reason,'session_dead');assert.equal(s.events.at(-1).ev,'run.end');assert.equal(typeof r.cost_usd,'number');
 assert(s.requests[1].input.at(-1).output.includes('earlier writes may have applied'));
});
test('encrypted reasoning is replayed unchanged',()=>{
 const reasoning={type:'reasoning',id:'r',summary:[],encrypted_content:'opaque'};
 const s=setup(n=>response(n===1?[reasoning,tool()]:[]));s.run();assert.deepEqual(s.requests[1].input[2],reasoning);
});
test('truncation does not masquerade as done',()=>{
 const s=setup(()=>response([],100,'incomplete'));assert.equal(s.run().reason,'incomplete');
});
test('render templates as Apps Script does, preserving dollar text',()=>{
 const pg=fs.readFileSync(path.join(root,'Prompts.gs'),'utf8');
 const t=new Function(pg+';return {SYSTEM_PROMPT,FIRST_PROMPT}')();
 assert(t.SYSTEM_PROMPT.includes('`ss`'));assert(!t.SYSTEM_PROMPT.includes('\\`'));
 const task='Keep $A$1, $&, $1 and $\' exactly';
 assert(t.FIRST_PROMPT.replace('<prompt>',()=>task).startsWith(task));
});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'harness-test-'));
try{
 function adapter(output,exit=0){
  const mog=path.join(scratch,'engine-'+passed);
  fs.writeFileSync(mog,'#!/bin/sh\nprintf %s '+"'"+output.replaceAll("'","'\\''")+"'"+'\nexit '+exit+'\n',{mode:0o700});
  return nodeEnv({mog,shim:'',sessionId:'test',sessionDir:scratch,eventsPath:path.join(scratch,'events'),apiKey:'test',runStart:Date.now()});
 }
 test('missing write record fails closed',()=>{const e=adapter('hello\n');try{assert(e.exec('log(1)').ok);assert.equal(e.wroteSheets(),null)}finally{e.cleanup()}});
 test('valid write record accumulates',()=>{const e=adapter('__WROTE__ ["Sheet"]\n');try{assert(e.exec('log(1)').ok);assert.deepEqual(e.wroteSheets(),['Sheet'])}finally{e.cleanup()}});
 test('engine failure invalidates write attribution',()=>{const e=adapter('',1);try{assert(!e.exec('log(1)').ok);assert.equal(e.wroteSheets(),null)}finally{e.cleanup()}});
 test('malformed write record fails closed',()=>{const e=adapter('__WROTE__ "Sheet"\n');try{assert(e.exec('log(1)').ok);assert.equal(e.wroteSheets(),null)}finally{e.cleanup()}});
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
console.log(`${passed} harness tests passed`);
