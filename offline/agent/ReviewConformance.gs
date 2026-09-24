/* Run runSubmitReviewConformance() in a temporary Apps Script project containing
   Tools.gs, Submit.gs and ReviewPrompt.gs. Creates and trashes only its own workbook.
   No Sheets API, model calls, golden answers or grader access. */
function runSubmitReviewConformance() {
  var book=SpreadsheetApp.create('submit-review-conformance-'+Utilities.getUuid());
  var events=[],checks=[],result;
  function assert(condition,message){if(!condition)throw new Error(message);checks.push(message);}
  try {
    var sh=book.getSheets()[0];sh.setName('Probe');
    sh.getRange('A1:A8').setValues([[42],[0],["'0"],[false],[null],['=SUM(A1:A2)'],["'=literal"],['=IF(TRUE,"","x")']]);
    sh.getRange('B1').setValue('Rate');sh.getRange('B2').setValue(.25).setNumberFormat('0.00');
    sh.getRange('B3').setValue('Theme').setFontColorObject(SpreadsheetApp.newColor().setThemeColor(SpreadsheetApp.ThemeColorType.ACCENT2).build());
    var env={uuid:function(){return Utilities.getUuid();},event:function(e){events.push({ev:e.ev,status:e.status});},exec:function(code){
      var lines=[];function log(v){lines.push(typeof v==='string'?v:JSON.stringify(v));}
      try{runHarnessScript(book,log,code);return {ok:true,out:lines.join('\n')};}catch(e){return {ok:false,out:String(e.message||e)};}
    }};
    var io=ReviewTools.bridge(env,Date.now()+240000),review=SubmitReview.create(io),base=io.capture();
    var sid=String(sh.getSheetId());
    assert(base.cells[sid+'!A3'].content.type==='string','Numeric text retains its type');
    assert(base.cells[sid+'!A7'].content.type==='string','Formula-looking literal remains text');
    assert(base.cells[sid+'!A6'].content.type==='formula','Real formula remains a formula');
    assert(base.cells[sid+'!A8'].content.type==='formula','Formula displaying blank is retained');
    assert(!Object.prototype.hasOwnProperty.call(base.cells[sid+'!B2'].properties,'fill'),'Background is excluded');
    function req(x){var a={mode:'review',report_id:null,decisions:[],checks:[],finish:false,page:0,group_ids:[],ranges:[]};Object.keys(x||{}).forEach(function(k){a[k]=x[k];});return a;}
    assert(review.submit(req()).changed_properties===0,'No-op review has no false edits');
    var edited=io.exec("var s=ss.getSheetByName('Probe');s.getRange('A1:A4').setValue(999);s.getRange('A6:A7').setValue(999);s.getRange('B2').setNumberFormat('0%');s.getRange('B3').setFontColor('#ff0000');",120000);
    assert(edited.ok && edited.out.indexOf('ERROR:')<0,'Ordinary edits execute through the shared wrapper');
    var report=review.submit(req()),decisions=report.groups.map(function(g){return {group_ids:[g.id],action:'restore',reason:'Restore the fixture original',evidence:['Captured original values and formatting']};});
    var restored=review.submit(req({report_id:report.report_id,decisions:decisions}));
    assert(restored.status==='restored','Property restores complete');
    assert(restored.changed_properties===0,'Readback matches the original observed properties');
    assert(sh.getRange('A3').getValue()==='0','Restored numeric text remains text');
    assert(sh.getRange('A7').getFormula()==='' && sh.getRange('A7').getValue()==='=literal','Restored formula-looking literal remains text');
    assert(sh.getRange('A6').getFormula()==='=SUM(A1:A2)','Exact original formula restored');
    assert(sh.getRange('B2').getNumberFormat()==='0.00','Number format restored independently');
    var done=review.submit(req({report_id:restored.report_id,finish:true,checks:[{obligation:'Restore fixture original',observation:'All changed properties read back equal',check:'Explicit typed-value and formula assertions passed',outcome:'satisfied'}]}));
    assert(done.complete,'Explicit reviewed completion succeeds');
    result={ok:true,checks:checks,events:events};
  } catch(e) {result={ok:false,error:String(e.stack||e),checks:checks,events:events};}
  finally {try{DriveApp.getFileById(book.getId()).setTrashed(true);}catch(e){if(result)result.cleanup_error=String(e.message||e);}}
  console.log(JSON.stringify(result));return result;
}
