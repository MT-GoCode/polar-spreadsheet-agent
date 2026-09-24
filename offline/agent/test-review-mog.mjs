/* Live shared-Apps-Script conformance on a private Mog session. Python only creates
   the test fixture and inspects exported results; it is never part of the harness. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nodeEnv} from './adapters/node.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),engineRoot=process.argv[2]||root;
const mog=join(engineRoot,'.mog/bin/mog'),py=join(engineRoot,'.venv/bin/python');
const source=['ReviewPrompt.gs','Submit.gs','Tools.gs','Agent.gs'].map(n=>readFileSync(join(here,n),'utf8')).join('\n');
const {ReviewTools,SubmitReview}=new Function(source+';return {ReviewTools,SubmitReview};')();
const scratch=mkdtempSync(join(tmpdir(),'review-gs-test-')),sessionDir=join(scratch,'sessions');mkdirSync(sessionDir,{mode:0o700});
const input=join(scratch,'fixture-input.xlsx'),fixture=join(scratch,'fixture.xlsx'),output=join(scratch,'output.xlsx');
const engineEnv={...process.env,MOG_SESSION_DIR:sessionDir};
execFileSync(py,['-c',`from openpyxl import Workbook
from openpyxl.styles import Font, Color
from datetime import datetime
w=Workbook();s=w.active;s.title='Probe'
for r,v in enumerate([42,0,'0',False,None,'=SUM(A1:A2)','=literal','=IF(TRUE,"","x")',datetime(2025,1,2),'#REF!'],1):
 s.cell(r,1,v)
 if r in (3,7,10):s.cell(r,1).data_type='s'
s['A9'].number_format='yyyy-mm-dd'
s['B1']='labels';s['B2']=12.345;s['B2'].number_format='0.00'
s['B3'].font=Font(name='Calibri',family=2,sz=11,scheme='minor',color=Color(theme=5));s['B3']='theme'
s['Z30']='';s['Z30'].font=Font(bold=True)
w.save(${JSON.stringify(input)})`]);
execFileSync(mog,['-i',input,'-o',fixture,'-r'],{env:engineEnv,timeout:30000});
let session=execFileSync(mog,['-s','-i',fixture],{encoding:'utf8',env:engineEnv,timeout:30000}).trim();
const shim=readFileSync(join(root,'dist/appsscript.js'),'utf8')+'\n'+readFileSync(join(here,'Tools.gs'),'utf8')+'\n'+readFileSync(join(here,'Describe.gs'),'utf8');
const env=nodeEnv({mog,shim,sessionId:session,sessionDir,eventsPath:join(scratch,'events.jsonl'),apiKey:'unused',runStart:Date.now()});
let passed=0;function test(n,f){f();console.log('PASS '+n);passed++;}
const io=ReviewTools.bridge(env,Date.now()+180000),review=SubmitReview.create(io);
const request=(x={})=>({mode:'review',report_id:null,decisions:[],finish:false,page:0,group_ids:[],ranges:[],checks:[],...x});
try{
 const parity=env.exec(`var r=ss.getSheetByName('Probe').getRange('A1:C10');
 var pairs=[['getFontWeights','getFontWeight'],['getFontStyles','getFontStyle'],['getFontSizes','getFontSize'],['getFontFamilies','getFontFamily'],['getFontColors','getFontColor'],['getFontLines','getFontLine'],['getHorizontalAlignments','getHorizontalAlignment'],['getVerticalAlignments','getVerticalAlignment'],['getWraps','getWrap'],['getNumberFormats','getNumberFormat']];
 pairs.forEach(function(p){var bulk=r[p[0]](),single=r._eachCell(function(c){return c[p[1]]();});if(JSON.stringify(bulk)!==JSON.stringify(single))throw new Error('Getter drift: '+p[0]);});
 var testRange=ss.getSheetByName('Probe').getRange('M1:N2');testRange.getFontWeights();testRange.setFontWeight('bold');if(testRange.getFontWeights()[0][0]!=='bold')throw new Error('stale font cache');testRange.clearFormat();
 log('GETTERS_MATCH');`,120000);
 test('batched getters match singular reads and invalidate after writes',()=>assert(parity.ok&&parity.out.includes('GETTERS_MATCH'),parity.out));
 const bindings=io.exec("const probe=ss.getSheetByName('Probe');SpreadsheetApp.flush();if(!describe_spreadsheet(ss))throw Error('missing describe');console.log('CONSOLE_VISIBLE');log('BINDINGS_VISIBLE');",120000);
 test('shared globals describe and console survive wrapped execution',()=>assert(bindings.ok&&bindings.out.includes('BINDINGS_VISIBLE')&&bindings.out.includes('CONSOLE_VISIBLE')&&!bindings.out.includes('ERROR:'),bindings.out));
 const fresh=io.exec("const probe=ss.getSheetByName('Probe');log(probe.getName());",120000);
 test('separate scripts may reuse top-level lexical declarations',()=>assert(fresh.ok&&fresh.out.includes('Probe')&&!fresh.out.includes('ERROR:'),fresh.out));
 const base=io.capture();const k=a=>Object.keys(base.cells).find(k=>k.endsWith('!'+a));
 test('literal formula-looking text distinguished from formulas',()=>{assert.equal(base.cells[k('A7')].content.type,'string');assert.equal(base.cells[k('A6')].content.type,'formula')});
 test('typed strings numbers booleans dates and formula-empty captured',()=>{
  assert.equal(base.cells[k('A2')].content.type,'number');assert.equal(base.cells[k('A3')].content.type,'string');assert.equal(base.cells[k('A4')].content.type,'boolean');assert.equal(base.cells[k('A5')].content,null);assert.equal(base.cells[k('A8')].content.type,'formula');assert.equal(base.cells[k('A9')].content.type,'date');
 });
 test('background excluded and font theme retained',()=>{assert(!('fill' in base.cells[k('B3')].properties));assert.equal(base.cells[k('B3')].properties.fontColor.type,'theme')});
 test('no-op report has no false property differences',()=>assert.equal(review.submit(request()).changed_properties,0));
 const res=io.exec("var s=ss.getSheetByName('Probe');s.getRangeList(['A1:A4','A6:A7']).setValue(999);s.getRange('B2').setNumberFormat('0%');s.getRange('B3').setFontColor('#ff0000');log('edited');",120000);
 assert(res.ok,res.out);assert(res.out.includes('edited'));
 const report=review.submit(request());
 test('content and format changes appear as separate groups',()=>{assert(report.groups.some(g=>g.property==='content'));assert(report.groups.some(g=>g.property==='numberFormat'));assert(report.groups.some(g=>g.property==='fontColor'));assert(!report.groups.some(g=>g.property==='horizontalAlignment'),'calculated general alignment is not an entered change')});
 const result=review.submit(request({mode:'apply',report_id:report.report_id}));
 test('default restore executes real property-specific restoration',()=>{assert.equal(result.status,'restored',JSON.stringify({status:result.status,error:result.error,application:result.application,failures:result.restore_failures}));assert.equal(result.changed_properties,0)});
 test('baseline survives several interpreter invocations',()=>{assert.equal(io.capture().cells[k('A1')].content.value,42);assert.equal(review.original.cells[k('A7')].content.value,'=literal')});
 const escaped=io.exec("SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Probe').getRange('A5').setValue(123);",120000);assert(escaped.ok,escaped.out);
 const uncertain=review.submit(request()),uncertainGroup=uncertain.groups.find(g=>g.property==='content'&&g.examples.some(e=>e.cell==='A5'));
 test('unknown entered-content provenance blocks automatic restoration',()=>{assert(uncertainGroup);assert.equal(uncertainGroup.restorable,false);assert(uncertainGroup.restore_blockers.some(s=>s.includes('provenance unavailable')));const held=review.submit(request({mode:'apply',report_id:uncertain.report_id}));assert.equal(held.status,'investigation_required');assert.equal(io.capture().cells[k('A5')].content.value,123)});
 const resolved=io.exec("ss.getSheetByName('Probe').getRange('A5').clearContent();",120000);assert(resolved.ok,resolved.out);assert.equal(review.submit(request()).changed_properties,0);
 const late=io.exec("ss.getSheetByName('Probe').getRange('Z30').setValue(8);",120000);assert(late.ok,late.out);
 test('newly touched region gets a pre-edit baseline',()=>{const r=review.submit(request());const g=r.groups.find(g=>g.property==='content'&&g.examples.some(e=>e.cell==='Z30'));assert(g);assert.deepEqual(g.examples[0].before,{type:'string',value:''})});
 const lateReport=review.submit(request());const lateResult=review.submit(request({report_id:lateReport.report_id,decisions:lateReport.groups.map(g=>({group_ids:[g.id],action:'restore',reason:'Fixture preservation',evidence:['Original before edit']}))}));assert.equal(lateResult.status,'restored',JSON.stringify(lateResult.application));
 execFileSync(mog,['-s',session,'--close','-r','-o',output],{env:engineEnv,timeout:30000});session=null;
 // Independent exported-file oracle catches type/format collateral invisible to getters.
 const check=JSON.parse(execFileSync(py,['-c',`import json,sys,copy
from openpyxl import load_workbook
x=load_workbook(sys.argv[1]);y=load_workbook(sys.argv[2]);diff=[]
for a in ['A1','A2','A3','A4','A6','A7','A8','A9','A10','B2','B3','Z30']:
 for p in ['value','data_type','number_format','font','fill','border','alignment','protection']:
  if copy.copy(getattr(x['Probe'][a],p)) != copy.copy(getattr(y['Probe'][a],p)):diff.append([a,p])
print(json.dumps(diff))`,fixture,output],{encoding:'utf8'}));
 test('exported typed values and unrelated styles remain intact',()=>assert.deepEqual(check,[]));
 console.log(`${passed} real Mog review checks passed; artifacts ${scratch}`);
}catch(e){console.error('Artifacts: '+scratch);throw e;}
finally{if(session)try{execFileSync(mog,['-s',session,'--close','--discard'],{env:engineEnv,timeout:30000})}catch{}env.cleanup();}
