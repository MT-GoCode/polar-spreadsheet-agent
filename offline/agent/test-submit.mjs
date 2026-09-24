/* Controller/loop contract tests. No engine, credentials or expected benchmark answers. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const src=['ReviewPrompt.gs','Submit.gs','Tools.gs','Agent.gs'].map(n=>readFileSync(new URL(n,import.meta.url),'utf8')).join('\n');
const {SubmitReview,ReviewTools,runLoop,CFG}=new Function(src+';return {SubmitReview,ReviewTools,runLoop,CFG}')();
const copy=x=>JSON.parse(JSON.stringify(x));
const digest=s=>createHash('sha256').update(s).digest('hex');
let count=0;function test(n,f){f();console.log('PASS '+n);count++;}
const request=(x={})=>({mode:'review',report_id:null,decisions:[],finish:false,page:0,group_ids:[],ranges:[],checks:[],...x});
const check={obligation:'Complete the requested schedule and preserve other cells',observation:'First, diagonal, side input and last cells inspected',check:'Independent components reconcile',outcome:'satisfied'};
const val=x=>({type:typeof x==='number'?'number':'string',value:x});
const formula=x=>({type:'formula',value:x});
function cell(r,c,content=null){return {sheetId:'1',sheet:'Sheet',row:r,col:c,content,properties:{fontWeight:'normal',numberFormat:'0.###############'},computed:content,blocked:[]};}
function fixture(options={}){
 let current={cells:{'1!A1':cell(1,1,formula('=B1'))},objects:{},structure:{sheets:[['1','Sheet']]},defaultProperties:{fontWeight:'normal',numberFormat:'0.###############'},restoreProperties:['content','fontWeight','numberFormat'],coverage:[]};
 let writes=[];const events=[];
 const adapter={capture:()=>copy(current),digest,event:e=>events.push(e),restore(ps){writes.push(copy(ps));for(const p of ps){const c=current.cells[p.key]??=cell(p.row,p.col);if(p.property==='content')c.content=copy(p.before);else c.properties[p.property]=p.before;}return {ok:true};}};
 const controller=SubmitReview.create(adapter,options);
 return {adapter,controller,events,writes,get current(){return current},set current(v){current=v},submit:x=>controller.submit(request(x))};
}
const decide=(r,action='keep')=>r.groups.map(g=>({group_ids:[g.id],action,reason:'Required by the task and original scope',evidence:['Read representative original/current content and independently verified its meaning']}));
function finish(f,r){return f.submit({report_id:r.report_id,decisions:decide(r),checks:[check],finish:true});}
test('unchanged report is stable and still requires task evidence',()=>{
 const f=fixture(),r=f.submit();assert.equal(r.groups_total,0);assert.equal(f.submit().report_id,r.report_id);
 assert.equal(f.submit({report_id:r.report_id,finish:true}).status,'obligations_unresolved');assert.equal(finish(f,r).status,'complete');
});
test('recalculation is not an entered edit',()=>{const f=fixture();f.current.cells['1!A1'].computed=val(42);assert.equal(f.submit().groups_total,0)});
test('formula, numeric, literal formula text, blank and empty string stay distinct',()=>{
 for(const x of [val(0),val('0'),val('=B1'),val(''),null]){const f=fixture();f.current.cells['1!A1'].content=x;const r=f.submit();assert.equal(r.changed_properties,1);assert.equal(r.groups[0].property,'content');}
});
test('existing singleton never merges with blank fill',()=>{
 const f=fixture();f.current.cells['1!A1'].content=formula('=C1');for(let r=2;r<1002;r++)f.current.cells['1!A'+r]=cell(r,1,formula('=C'+r));
 const report=f.submit();assert.equal(report.changed_properties,1001);assert(report.groups.some(g=>g.count===1&&g.examples[0].cell==='A1'));
});
test('staircase exact restore leaves holes and unrelated properties intact',()=>{
 const f=fixture();f.current.cells['1!A1'].properties.fontWeight='bold';
 for(const [r,cols] of [[2,[1,2]],[3,[1,2,3]],[4,[1,3,4]]])for(const c of cols)f.current.cells['1!'+String.fromCharCode(64+c)+r]=cell(r,c,val(9));
 const r=f.submit();const ds=decide(r).map(d=>({...d,action:r.groups.find(g=>g.id===d.group_ids[0]).property==='content'?'restore':'keep'}));
 const out=f.submit({report_id:r.report_id,decisions:ds});assert.equal(out.status,'restored');assert.equal(f.writes.flat().length,8);assert(!f.current.cells['1!B4']);assert.equal(f.current.cells['1!A1'].properties.fontWeight,'bold');assert.equal(out.changed_properties,1);
});
test('complete validation precedes every write including invalid page',()=>{
 for(const bad of [{action:'bad'},{group_ids:['unknown']},{evidence:[]},{extra:true}]){const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit();assert.equal(f.submit({report_id:r.report_id,decisions:[{...decide(r,'restore')[0],...bad}]}).status,'invalid_submission');assert.equal(f.writes.length,0);}
 const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit();assert.equal(f.submit({report_id:r.report_id,decisions:decide(r,'restore'),page:100}).status,'invalid_submission');assert.equal(f.writes.length,0);
});
test('stale decisions cannot restore an intervening edit',()=>{const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit();f.current.cells['1!A1'].content=val(3);assert.equal(f.submit({report_id:r.report_id,decisions:decide(r,'restore')}).status,'stale_report');assert.equal(f.writes.length,0)});
test('duplicate decisions rejected atomically',()=>{const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit(),d=decide(r,'restore');assert.equal(f.submit({report_id:r.report_id,decisions:[...d,...d]}).status,'invalid_submission');assert.equal(f.writes.length,0)});
test('successful restore receipt is idempotent and original survives later edits',()=>{
 const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit(),a={report_id:r.report_id,decisions:decide(r,'restore')};const res=f.submit(a);assert.equal(res.status,'restored');assert.deepEqual(f.submit(a),res);assert.equal(f.writes.length,1);
 assert.equal(f.submit().groups_total,0);f.current.cells['1!A1'].content=val(2);const r2=f.submit();assert(r2.groups[0].prior_restore);assert.equal(r2.groups[0].examples[0].before.value,'=B1');
});
test('partial adapter failure is recaptured and not blindly replayed',()=>{
 const f=fixture();f.current.cells['1!A1'].content=val(2);f.current.cells['1!A1'].properties.fontWeight='bold';const r=f.submit();let calls=0;
 f.adapter.restore=ps=>{calls++;const p=ps[0];if(p.property==='content')f.current.cells[p.key].content=p.before;else f.current.cells[p.key].properties[p.property]=p.before;throw Error('transport lost');};
 const a={report_id:r.report_id,decisions:decide(r,'restore')};const out=f.submit(a);assert.equal(out.status,'restore_incomplete');assert.equal(out.restore_failures.length,1);assert.deepEqual(f.submit(a),out);assert.equal(calls,1);
});
test('array content blocked while unrelated format can be restored',()=>{const f=fixture();f.current.cells['1!A1'].blockedProperties={content:['spill']};f.current.cells['1!A1'].content=val(2);f.current.cells['1!A1'].properties.fontWeight='bold';const r=f.submit();assert(!r.groups.find(g=>g.property==='content').restorable);assert(r.groups.find(g=>g.property==='fontWeight').restorable)});
test('pagination requires coverage and visited pages',()=>{
 const f=fixture({pageSize:1});f.current.cells['1!A1'].content=val(2);f.current.cells['1!A1'].properties.fontWeight='bold';const r=f.submit();assert.equal(r.pages,2);
 assert.equal(f.submit({report_id:r.report_id,decisions:decide(r),checks:[check],finish:true}).status,'decisions_incomplete');
 const p=f.submit({report_id:r.report_id,page:1});assert.equal(f.submit({report_id:r.report_id,decisions:decide(p),checks:[check],finish:true,page:1}).status,'complete');
});
test('split keeps exact selected membership and invalidates old report',()=>{
 const f=fixture();for(const r of [2,3,4])f.current.cells['1!A'+r]=cell(r,1,val(9));const r=f.submit();const split=f.submit({mode:'split',report_id:r.report_id,group_ids:[r.groups[0].id],ranges:['A3']});assert.equal(split.groups_total,2);assert.equal(split.groups.find(g=>g.count===1).examples[0].cell,'A3');assert.notEqual(split.report_id,r.report_id);
});
test('investigate cannot finish; valid repair rounds are bounded',()=>{
 const f=fixture({maxRounds:1});f.current.cells['1!A1'].content=val(2);const r=f.submit();assert.equal(f.submit({report_id:r.report_id,decisions:decide(r,'investigate'),checks:[check],finish:true}).status,'investigation_required');assert.equal(finish(f,r).status,'review_limit');
});
test('accept without finish does not waste repair budget',()=>{const f=fixture({maxRounds:1});f.current.cells['1!A1'].content=val(2);const r=f.submit();assert.equal(f.submit({report_id:r.report_id,decisions:decide(r)}).status,'reviewed');assert.equal(finish(f,r).status,'complete')});
test('three malformed requests stop and never write',()=>{const f=fixture();for(let i=0;i<3;i++)assert.equal(f.controller.submit(null).status,i===2?'review_invalid':'invalid_submission');assert.equal(f.writes.length,0)});
test('quoted strings sheet names structured references and absolute refs retain identity',()=>{
 const p=SubmitReview.formulaPattern;assert.equal(p('="A1"+\'A1\'!B2+Table[A1]+$C$5',2,2),'="A1"+\'A1\'!R[0]C[0]+Table[A1]+R5C3');assert.notEqual(p('=A1',2,2),p('=-A1',2,2));assert.notEqual(p('=$A1',2,2),p('=A1',2,2));
});
test('loop implicit stop returns review then accepts explicit evidenced finish',()=>{
 const f=fixture(),events=[];let n=0;
 const env={review:f.adapter,event:e=>events.push(e),uuid:()=>String(n),sleep:()=>{},exec:()=>({ok:true,out:''}),http:(url,h,body)=>{
  const input=JSON.parse(body).input;n++;
  let output=[];if(n===2){const report=JSON.parse(input.at(-1).content.replace('Completion requires submit review. ',''));output=[{type:'function_call',name:'submit',call_id:'s',arguments:JSON.stringify(request({report_id:report.report_id,finish:true,checks:[check]}))}];}
  return {status:200,headers:{},body:JSON.stringify({status:'completed',output})};}};
 assert.equal(runLoop(env,{system:'test',first:'task'}).reason,'done');assert.equal(n,2);assert(events.some(e=>e.ev==='review.implicit'));
});
test('loop malformed JSON is bounded by the same controller',()=>{
 const f=fixture();let n=0;const env={review:f.adapter,event:()=>{},uuid:()=>String(n),http:()=>{n++;return {status:200,headers:{},body:JSON.stringify({status:'completed',output:[{type:'function_call',name:'submit',call_id:'s',arguments:'bad json'}]})}}};assert.equal(runLoop(env,{system:'test',first:'task'}).reason,'review_invalid');assert.equal(n,3);
});
test('only consecutive malformed requests exhaust the retry bound',()=>{
 const f=fixture();for(let i=0;i<4;i++){assert.equal(f.controller.submit(null).status,'invalid_submission');assert.equal(f.submit().status,'review_required');}
});
test('runtime snapshot failure is not blamed on submit argument format',()=>{
 const f=fixture();f.adapter.capture=()=>{throw Error('engine unavailable')};assert.equal(f.submit().status,'review_error');
});
test('baseline failure still records an unsuccessful run.end',()=>{
 const events=[],env={review:{capture:()=>{throw Error('capture failed')}},event:e=>events.push(e)};
 assert.equal(runLoop(env,{system:'test',first:'task'}).reason,'review_error');assert.equal(events.at(-1).ev,'run.end');
});
for(const phase of ['original','current'])test('unavailable '+phase+' property is never restored as a default',()=>{
 let unavailable=phase==='original',value=1,writes=0;
 const values={numberFormat:'0.00',fontWeight:'normal',fontStyle:'normal',fontSize:11,fontFamily:'Arial',fontLine:'none',horizontalAlignment:'left',verticalAlignment:'bottom',wrap:true};
 const range={getValues:()=>[[value]],getFormulas:()=>[['']]};
 for(const f of ReviewTools.fields)range[f[1]]=()=>{
  if(f[0]==='numberFormat'&&unavailable)throw Error('transient property read failure');
  const observed=f[0]==='fontColor'?{getColorType:()=> 'RGB',asRgbColor:()=>({asHexString:()=> '#000000'})}:values[f[0]];
  return [[observed]];
 };
 const sheet={getSheetId:()=>1,getName:()=> 'Sheet',getRange:()=>range},ss={getSheets:()=>[sheet]};
 const adapter={capture:()=>({...ReviewTools.read(ss,{sheetId:'1',row:1,col:1,rows:1,cols:1}),objects:{},restoreProperties:['content',...ReviewTools.fields.map(f=>f[0])]}),digest,restore:()=>{writes++;return {ok:true}}};
 const reviewer=SubmitReview.create(adapter);unavailable=phase==='current';
 const report=reviewer.submit(request()),group=report.groups.find(g=>g.property==='numberFormat');
 assert(group);assert.equal(group.restorable,false);assert(group.restore_blockers.some(s=>s.includes('Property read unavailable')));
 const attempted=reviewer.submit(request({report_id:report.report_id,decisions:decide(report,'restore')}));
 assert.equal(attempted.status,'invalid_submission');assert.equal(writes,0);
});
test('apply defaults omitted properties to restore while KEEP and INVESTIGATE stay untouched',()=>{
 const f=fixture();f.current.cells['1!A1'].content=val(99);f.current.cells['1!A1'].properties.fontWeight='bold';f.current.cells['1!A2']=cell(2,1,val(8));
 const r=f.submit(),content=r.groups.find(g=>g.examples.some(e=>e.cell==='A1')&&g.property==='content'),pending=r.groups.find(g=>g.examples.some(e=>e.cell==='A2'));
 const ds=[{group_ids:[content.id],action:'keep',reason:'Requested input',evidence:['Task requests 99']},{group_ids:[pending.id],action:'investigate',reason:'Check source',evidence:['Source has two candidates']}];
 const out=f.submit({mode:'apply',report_id:r.report_id,decisions:ds,finish:true});
 assert.equal(out.status,'restored');assert.equal(f.current.cells['1!A1'].content.value,99);assert.equal(f.current.cells['1!A2'].content.value,8);assert.equal(f.current.cells['1!A1'].properties.fontWeight,'normal');
 assert.equal(out.default_restored_group_ids.length,1);assert.equal(out.investigations.length,1);assert(!out.complete);
 assert.equal(f.submit({mode:'apply',report_id:out.report_id,decisions:ds,finish:true,checks:[check]}).status,'investigation_required');
 assert.equal(f.submit({mode:'apply',report_id:out.report_id,decisions:decide(out),finish:true,checks:[check]}).status,'complete');
});
test('reading pages and empty review requests never restore; empty apply explicitly restores all',()=>{
 const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit();assert.equal(r.default_action,'restore');
 assert.equal(f.submit({report_id:r.report_id}).status,'review_required');assert.equal(f.writes.length,0);
 const args={mode:'apply',report_id:r.report_id,finish:true},restored=f.submit(args);
 assert.equal(restored.status,'restored');assert.equal(restored.changed_properties,0);assert(!restored.complete);assert.equal(f.writes.length,1);
 assert.deepEqual(f.submit(args),restored);assert.equal(f.writes.length,1);
 assert.equal(f.submit({mode:'apply',report_id:restored.report_id,finish:true}).status,'obligations_unresolved');
 assert.equal(f.submit({mode:'apply',report_id:restored.report_id,finish:true,checks:[check]}).status,'complete');
});
test('default restore requires all report pages even when finish is false',()=>{
 const f=fixture({pageSize:1});f.current.cells['1!A1'].content=val(2);f.current.cells['1!A1'].properties.fontWeight='bold';const r=f.submit();
 assert.equal(f.submit({mode:'apply',report_id:r.report_id,decisions:decide(r)}).status,'pages_unreviewed');assert.equal(f.writes.length,0);
 const p=f.submit({report_id:r.report_id,page:1});
 const out=f.submit({mode:'apply',report_id:r.report_id,decisions:[...decide(r),...decide(p)],checks:[check],finish:true});assert.equal(out.status,'complete');assert.equal(f.writes.length,0);
});
test('malformed stale unknown duplicate and unbound apply requests never infer restores',()=>{
 for(const bad of [{report_id:null},{decisions:[{group_ids:['unknown'],action:'keep',reason:'r',evidence:['e']}]},{page:99},{group_ids:['unused']},{decisions:[{group_ids:[],action:'keep',reason:'r',evidence:['e']}]},{decisions:[{group_ids:['x'],action:'keep',reason:'',evidence:[]}]}]) {
  const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit();assert.equal(f.submit({mode:'apply',report_id:r.report_id,...bad}).status,'invalid_submission');assert.equal(f.writes.length,0);
 }
 const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit(),d=decide(r);assert.equal(f.submit({mode:'apply',report_id:r.report_id,decisions:[...d,...d]}).status,'invalid_submission');assert.equal(f.writes.length,0);
 f.current.cells['1!A1'].content=val(3);assert.equal(f.submit({mode:'apply',report_id:r.report_id}).status,'stale_report');assert.equal(f.writes.length,0);
});
test('unsupported default restoration remains unresolved without mutating the blocked property',()=>{
 const f=fixture();f.current.cells['1!A1'].content=val(2);f.current.cells['1!A1'].blockedProperties={content:['spill']};const r=f.submit();
 const out=f.submit({mode:'apply',report_id:r.report_id,finish:true,checks:[check]});assert.equal(out.status,'investigation_required');assert.equal(out.investigations.length,1);assert.equal(f.writes.length,0);assert.equal(f.current.cells['1!A1'].content.value,2);
});
test('default restoration reports partial failures and retries do not repeat writes',()=>{
 const f=fixture();f.current.cells['1!A1'].content=val(2);f.current.cells['1!A1'].properties.fontWeight='bold';const r=f.submit();let calls=0;
 f.adapter.restore=ps=>{calls++;const p=ps[0],c=f.current.cells[p.key];if(p.property==='content')c.content=p.before;else c.properties[p.property]=p.before;throw Error('lost response');};
 const args={mode:'apply',report_id:r.report_id};const out=f.submit(args);assert.equal(out.status,'restore_incomplete');assert.equal(out.restore_failures.length,1);assert.deepEqual(f.submit(args),out);assert.equal(calls,1);
});
test('every apply replaces prior exceptions and task checks instead of inheriting approval',()=>{
 const f=fixture();f.current.cells['1!A1'].content=val(2);const r=f.submit();assert.equal(f.submit({mode:'apply',report_id:r.report_id,decisions:decide(r),checks:[check]}).status,'reviewed');
 assert.equal(f.submit({mode:'apply',report_id:r.report_id,decisions:decide(r),finish:true}).status,'obligations_unresolved');assert.equal(f.writes.length,0);
 assert.equal(f.submit({mode:'apply',report_id:r.report_id}).status,'restored');assert.equal(f.writes.length,1);
});
test('loop applies default restore and requires a fresh evidenced finish',()=>{
 const f=fixture(),events=[];let n=0;
 const env={review:f.adapter,event:e=>events.push(e),uuid:()=>String(n),http:(url,h,body)=>{
  n++;const input=JSON.parse(body).input;if(n===1)f.current.cells['1!A1'].content=val(2);
  let output=[];if(n===2||n===3){const item=input.at(-1),report=JSON.parse(item.output||item.content.replace('Completion requires submit review. ',''));
   output=[{type:'function_call',name:'submit',call_id:'s'+n,arguments:JSON.stringify(request({mode:'apply',report_id:report.report_id,finish:true,checks:n===3?[check]:[]}))}];}
  return {status:200,headers:{},body:JSON.stringify({status:'completed',output})};}};
 const out=runLoop(env,{system:'test',first:'task'});assert.equal(out.reason,'done');assert.equal(n,3);assert.equal(f.writes.length,1);assert.equal(f.current.cells['1!A1'].content.value,'=B1');assert(events.some(e=>e.ev==='review.implicit'));
});

console.log(`${count} submit tests passed`);
