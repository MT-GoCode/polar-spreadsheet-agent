/* Shared harness tools. This file ships verbatim in Apps Script and under Mog.
   All workbook reads, restore writes and mutation observation use SpreadsheetApp.
   The platform ENV only executes these scripts and transports their results. */
function agentTools() {
  return [{type:'function',name:'run_apps_script',strict:true,
    description:'Run Google Apps Script against the workbook. ss is bound. Returns log output and errors.',
    parameters:{type:'object',additionalProperties:false,required:['code'],properties:{code:{type:'string'}}}}, SubmitReview.tool];
}
// Direct eval retains the shared source bindings (SpreadsheetApp, describe, etc.)
// in Mog as well as Google. A fresh function isolates each call's declarations.
// Function(...) alone loses Mog's lexical bindings and breaks ordinary scripts.
function runHarnessScript(ss,log,code) {
  return eval('(function(ss,log){\n'+code+'\n})')(ss,log);
}
var ReviewTools = (function () {
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function stable(x) {
    if(x===undefined || x===null) return 'null';
    if(typeof x!=='object')return JSON.stringify(x);
    if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
    return '{'+Object.keys(x).sort().map(function(k){return JSON.stringify(k)+':'+stable(x[k]);}).join(',')+'}';
  }
  function equal(a,b) {return stable(a)===stable(b);}
  function col(n){var s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
  function key(s,r,c){return s+'!'+col(c)+r;}
  function typed(v){
    if(v===null || v===undefined || v==='')return null;
    if(v instanceof Date)return {type:'date',value:v.toISOString()};
    return {type:typeof v==='number'?'number':typeof v==='boolean'?'boolean':'string',value:v};
  }
  function color(v){
    if(!v)return null;
    var type=String(v.getColorType());
    return type==='THEME'?{type:'theme',value:String(v.asThemeColor().getThemeColorType())}:
      {type:'rgb',value:v.asRgbColor().asHexString().toLowerCase()};
  }
  function uncolor(v){
    if(!v)return null;
    var b=SpreadsheetApp.newColor();
    return (v.type==='theme'?b.setThemeColor(SpreadsheetApp.ThemeColorType[v.value]):b.setRgbColor(v.value)).build();
  }
  var fields=[
    ['numberFormat','getNumberFormats','setNumberFormats'],
    ['fontColor','getFontColorObjects','setFontColorObjects',color],
    ['fontWeight','getFontWeights','setFontWeights'],
    ['fontStyle','getFontStyles','setFontStyles'],
    ['fontSize','getFontSizes','setFontSizes'],
    ['fontFamily','getFontFamilies','setFontFamilies'],
    ['fontLine','getFontLines','setFontLines'],
    ['horizontalAlignment','getHorizontalAlignments','setHorizontalAlignments'],
    ['verticalAlignment','getVerticalAlignments','setVerticalAlignments'],
    ['wrap','getWraps','setWraps']
  ];
  var limitations=[
    'Background color/fill is excluded from snapshotting, change reports and restoration.',
    'Values/formulas and the listed formatting properties are observed through Apps Script getters. Entered versus inherited default formatting is not universally distinguishable. Restoring an observed font property can materialize inherited font defaults in Mog; exact raw style provenance is not certified.',
    'Borders, rich-text runs, validation, conditional-format styling, notes, charts and other drawing/object properties have no complete shared reader here; they are not silently certified or auto-restored.',
    'Initial coverage is each sheet\'s content rectangle. Before an agent writes outside it through ss, the affected cells are captured. Untouched formatting outside these rectangles is not enumerated.'
  ];
  function sheetById(ss,id){
    var sheets=ss.getSheets();for(var i=0;i<sheets.length;i++)if(String(sheets[i].getSheetId())===String(id))return sheets[i];
    throw new Error('Review sheet missing: '+id);
  }
  function metadata(ss){
    SpreadsheetApp.flush();
    var sheets=ss.getSheets().map(function(s){return {id:String(s.getSheetId()),name:s.getName(),rows:Math.max(1,s.getLastRow()),columns:Math.max(1,s.getLastColumn())};});
    var names=ss.getNamedRanges().map(function(n){var r=n.getRange();return [n.getName(),String(r.getSheet().getSheetId()),r.getA1Notation()];});
    names.sort(function(a,b){return a[0].localeCompare(b[0]);});
    return {sheets:sheets,names:names};
  }
  function read(ss,part){
    var s=sheetById(ss,part.sheetId),range=s.getRange(part.row,part.col,part.rows,part.cols);
    var sheetName=s.getName();
    var values=range.getValues(),formulas=range.getFormulas(),grids={},missing=[],unavailable={},cells={},emptyStrings={};
    // isBlank preserves the difference between a truly empty cell and literal empty
    // text. Probe contiguous blank-looking runs, splitting only nonempty runs.
    function blankRun(row,start,end){
      if(start>=end || s.getRange(part.row+row,part.col+start,1,end-start).isBlank())return;
      if(end-start===1){emptyStrings[row+':'+start]=true;return;}
      var mid=Math.floor((start+end)/2);blankRun(row,start,mid);blankRun(row,mid,end);
    }
    for(var br=0;br<part.rows;br++){
      var bs=null;
      for(var bc=0;bc<=part.cols;bc++){
        var candidate=bc<part.cols && values[br][bc]==='' && !formulas[br][bc];
        if(candidate && bs===null)bs=bc;
        if(!candidate && bs!==null){blankRun(br,bs,bc);bs=null;}
      }
    }
    fields.forEach(function(f){try{grids[f[0]]=range[f[1]]();}catch(e){var reason='Property read unavailable: '+f[0]+': '+String(e.message||e);missing.push(reason);unavailable[f[0]]=[reason];}});
    for(var r=0;r<part.rows;r++){
      var label='';
      for(var c=0;c<part.cols;c++){
        var v=values[r][c],f=formulas[r][c],content=f?{type:'formula',value:f}:emptyStrings[r+':'+c]?{type:'string',value:''}:typed(v);
        if(!label && !f && typeof v==='string' && v)label=v.slice(0,120);
        var props={},blocked=copy(unavailable);
        fields.forEach(function(d){if(grids[d[0]]){var x=grids[d[0]][r][c];props[d[0]]=d[3]?d[3](x):d[0]==='horizontalAlignment' && /^general/.test(x)?'general':x;}});
        // Reapplying an observed default may materialize formatting that was inherited.
        // Keep observation useful without advertising an exact restore we cannot prove.
        if(props.wrap===false)blocked.wrap=['No-wrap does not distinguish overflow from clipping'];
        if(props.fontLine==='line-through')blocked.fontLine=['Underline and strikethrough may coexist; this getter cannot distinguish both'];
        if(!f && typeof v==='string' && /^#(REF!|DIV\/0!|N\/A|NAME\?|NUM!|VALUE!|ERROR!|NULL!)$/.test(v))blocked.content=['Literal error text and imported error cells are ambiguous through Apps Script getters'];
        var cv=typed(v);
        if(f && typeof v==='string' && /^#(REF!|DIV\/0!|N\/A|NAME\?|NUM!|VALUE!|ERROR!|NULL!)$/.test(v))cv={type:'error',value:v};
        cells[key(part.sheetId,part.row+r,part.col+c)]={sheetId:String(part.sheetId),sheet:sheetName,row:part.row+r,col:part.col+c,content:content,properties:props,computed:cv,label:label,blocked:[],blockedProperties:blocked};
      }
    }
    return {cells:cells,unavailable:missing};
  }
  // Current state of exactly the spans a script touched. The alarm needs a real
  // before/after comparison: the damage that fails runs is collateral, so no journal of
  // which setters were called can find it. task_07 wrote values to G19:K21, never called
  // a style setter there, and lost on 15 fill + 13 font + 5 border at those cells.
  function readSpans(ss,spans){
    var cells={};
    spans.forEach(function(w){
      var res=read(ss,{sheetId:w.sheetId,row:w.row,col:w.col,rows:w.rows,cols:w.cols});
      Object.keys(res.cells).forEach(function(k){cells[k]=res.cells[k];});
    });
    return {cells:cells};
  }
  function batches(cells){
    var out=[];cells.sort(function(a,b){return String(a.sheetId).localeCompare(String(b.sheetId))||a.property.localeCompare(b.property)||a.row-b.row||a.col-b.col;});
    cells.forEach(function(p){var b=out[out.length-1];if(b && b.sheetId===p.sheetId && b.property===p.property && b.row===p.row && b.col+b.patches.length===p.col)b.patches.push(p);else out.push({sheetId:p.sheetId,property:p.property,row:p.row,col:p.col,patches:[p]});});
    return out;
  }
  function restore(ss,patches){
    // Validate the complete request and reread its exact cells before the first mutation.
    var duplicate={},groups=batches(patches.slice());
    groups.forEach(function(b){
      var state=read(ss,{sheetId:b.sheetId,row:b.row,col:b.col,rows:1,cols:b.patches.length});
      b.patches.forEach(function(p){
        var c=state.cells[key(p.sheetId,p.row,p.col)],id=p.key+'/'+p.property;
        if(p.key!==key(p.sheetId,p.row,p.col) || duplicate[id])throw new Error('Invalid or duplicate patch '+id);duplicate[id]=true;
        if(p.property!=='content' && !fields.some(function(f){return f[0]===p.property;}))throw new Error('Unsupported restore '+p.property);
        var now=p.property==='content'?c.content:c.properties[p.property];
        if(!equal(now,p.expected))throw new Error('Stale restore '+id);
        if((c.blockedProperties[p.property]||[]).length)throw new Error('Ambiguous current state '+id);
      });
    });
    var applied=[];
    try{
      groups.forEach(function(b){
        var range=sheetById(ss,b.sheetId).getRange(b.row,b.col,1,b.patches.length);
        if(b.property==='content'){
          // A matrix may contain formulas and literals. Prefix literal strings with an
          // apostrophe so numeric/formula-looking text survives setValues on both runtimes.
          var vs=b.patches.map(function(p){var v=p.before;return !v?null:v.type==='date'?new Date(v.value):v.type==='string'?"'"+v.value:v.value;});
          range.setValues([vs]);
        }else{
          var d=fields.filter(function(f){return f[0]===b.property;})[0];
          range[d[2]]([b.patches.map(function(p){return d[3]?uncolor(p.before):p.before;})]);
        }
        b.patches.forEach(function(p){applied.push({key:p.key,property:p.property});});
      });
      SpreadsheetApp.flush();return {ok:true,applied:applied};
    }catch(e){SpreadsheetApp.flush();return {ok:false,partial:true,error:String(e.message||e),applied:applied};}
  }
  /* Observe ordinary Apps Script calls before mutation. Captures an original extension
     before a write outside the initial rectangle, and records unsafe coordinate changes.
     No engine-specific operations, hidden sheets or separate workbook copies. */
  function execute(ss,code,extents,log){
    var extensions={},regions=copy(extents),structural={},unsupported=[],contentWrites=[],styleWrites=[],unknown={},wrappers=new WeakMap(),raws=new WeakMap();
    function objectKind(x){
      if(!x || typeof x!=='object')return '';
      // Both Apps Script host objects and the shim stringify to their class name.
      // Duck typing is unsafe: the shim deliberately returns throwing functions for
      // missing members, so typeof missingMethod === 'function' proves nothing.
      var name=String(x);
      return ['Range','Sheet','Spreadsheet','RangeList','NamedRange','TextFinder'].indexOf(name)>=0?name:'';
    }
    function cover(range){
      var sid=String(range.getSheet().getSheetId()),r=range.getRow(),c=range.getColumn(),nr=range.getNumRows(),nc=range.getNumColumns(),known=regions[sid]||[];
      // Exact uncovered spans; already captured cells are never overwritten by a later edit.
      for(var row=r;row<r+nr;row++){
        var start=null;
        for(var column=c;column<=c+nc;column++){
          var covered=column===c+nc || known.some(function(x){return row>=x.row && row<x.row+x.rows && column>=x.col && column<x.col+x.cols;});
          if(!covered && start===null)start=column;
          if(covered && start!==null){
            var part={sheetId:sid,row:row,col:start,rows:1,cols:column-start},res=read(ss,part);
            Object.keys(res.cells).forEach(function(k){extensions[k]=res.cells[k];});known.push(part);start=null;
          }
        }
      }
      regions[sid]=known;
    }
    function span(range){return {sheetId:String(range.getSheet().getSheetId()),row:range.getRow(),col:range.getColumn(),rows:range.getNumRows(),cols:range.getNumColumns()};}
    function contentWrite(range){contentWrites.push(span(range));}
    function styleWrite(range,method){var s=span(range);s.method=method;styleWrites.push(s);}
    function wrap(x){
      if(Array.isArray(x))return x.map(wrap);
      var kind=objectKind(x);if(!kind)return x;if(wrappers.has(x))return wrappers.get(x);
      var p=new Proxy(x,{get:function(target,name){
        var member=target[name];if(typeof member!=='function')return member;
        return function(){
          var args=Array.prototype.slice.call(arguments).map(function(a){return a && typeof a==='object' && raws.has(a)?raws.get(a):a;}),mutating=!/^(get|is|can|has|toString)/.test(String(name));
          if(mutating){
            if(kind==='TextFinder' || kind==='Spreadsheet' && !/^setActive/.test(String(name)))unknown['*']=true;
            if(kind==='Range'){
              cover(target);
              if(!/^(setFont|setNumberFormat|setBackground|setBorder|setHorizontalAlignment|setVerticalAlignment|setWrap|setTextStyle|setTextDirection|setTextRotation|setShowHyperlink|setNote|setDataValidation|clearFormat|clearNote|clearDataValidation|activate|protect|addDeveloperMetadata)/.test(String(name)))contentWrite(target);
              else if(/^(setFont|setNumberFormat|setBackground|setBorder|setHorizontalAlignment|setVerticalAlignment|setWrap|setTextStyle|clearFormat)/.test(String(name)))styleWrite(target,String(name));
            }
            if(/^(copyTo|moveTo|autoFill)$/.test(String(name)) && objectKind(args[0])==='Range'){
              cover(args[0]);if(!(args[1] && args[1].formatOnly))contentWrite(args[0]);
            }
            if(name==='moveTo' && kind==='Range')contentWrite(target);
            if(kind==='Range' && /^(copyValuesToRange|copyFormatToRange|autoFillToNeighbor|splitTextToColumns|removeDuplicates)$/.test(String(name)))unknown['*']=true;
            if(kind==='RangeList')target.getRanges().forEach(function(r){cover(r);if(!/^(setFont|setNumberFormat|setBackground|setBorder|setHorizontalAlignment|setVerticalAlignment|setWrap|setTextStyle|setNote|setDataValidation|clearFormat|clearNote|clearDataValidation|activate)/.test(String(name)))contentWrite(r);});
            var sid=kind==='Sheet'?String(target.getSheetId()):kind==='Range'?String(target.getSheet().getSheetId()):'*';
            if(/insert|delete|removeDuplicates|randomize|sort|move|setName|setPosition/i.test(String(name)))structural[sid]=true;
            if(kind==='Sheet' && /^(clear|append)/.test(String(name))){cover(target.getDataRange());unknown[sid]=true;}
            if(/border|richtext|validation|conditional|chart|note|merge/i.test(String(name)))unsupported.push({sheetId:sid,method:String(name)});
          }
          return wrap(member.apply(target,args));
        };
      }});wrappers.set(x,p);raws.set(p,x);return p;
    }
    if(/\bSpreadsheetApp\s*\./.test(code))unknown['*']=true;
    try{runHarnessScript(wrap(ss),log,code);}catch(e){log('ERROR: '+String(e.message||e));}
    return {extensions:extensions,regions:regions,structural:structural,unsupported:unsupported,contentWrites:contentWrites,styleWrites:styleWrites,unknown:unknown};
  }
  // SHA-256 over UTF-8, shared by Apps Script and Node; no runtime-specific hashing API.
  function digest(text){
    var bytes=unescape(encodeURIComponent(text)),words=[],bitLength=bytes.length*8;
    for(var i=0;i<bytes.length;i++)words[i>>2]=(words[i>>2]||0)|bytes.charCodeAt(i)<<(24-(i%4)*8);
    words[bitLength>>5]=(words[bitLength>>5]||0)|(0x80<<(24-bitLength%32));
    words[((bitLength+64>>9)<<4)+15]=bitLength;
    var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function rr(x,n){return (x>>>n)|(x<<(32-n));}
    for(var off=0;off<words.length;off+=16){
      var w=[],v=h.slice();
      for(i=0;i<64;i++){
        if(i<16)w[i]=words[off+i]|0;else{var x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rr(x,7)^rr(x,18)^(x>>>3))+w[i-7]+(rr(y,17)^rr(y,19)^(y>>>10)))|0;}
        var t1=(v[7]+(rr(v[4],6)^rr(v[4],11)^rr(v[4],25))+((v[4]&v[5])^(~v[4]&v[6]))+k[i]+w[i])|0;
        var t2=((rr(v[0],2)^rr(v[0],13)^rr(v[0],22))+((v[0]&v[1])^(v[0]&v[2])^(v[1]&v[2])))|0;
        v=[(t1+t2)|0,v[0],v[1],v[2],(v[3]+t1)|0,v[4],v[5],v[6]];
      }
      for(i=0;i<8;i++)h[i]=(h[i]+v[i])|0;
    }
    return h.map(function(n){return ('00000000'+(n>>>0).toString(16)).slice(-8);}).join('');
  }
  function bridge(env,deadline){
    var original=null,cached=null,regions={},structural={},unsupported=[],contentWrites=[],unknown={};
    function remaining(){var ms=deadline-Date.now();if(ms<=0)throw new Error('review deadline');return ms;}
    function invoke(expression){
      var marker='__REVIEW_'+env.uuid()+'__';
      var res=env.exec('log('+JSON.stringify(marker)+'+JSON.stringify('+expression+'));',remaining());
      if(!res.ok)throw new Error('Review execution failed: '+res.out);
      var line=res.out.split('\n').filter(function(s){return s.indexOf(marker)===0;});
      if(line.length!==1)throw new Error('Review execution returned no unique result: '+res.out.slice(0,500));
      return JSON.parse(line[0].slice(marker.length));
    }
    function capture(){
      if(cached)return cached;
      var meta=invoke('ReviewTools.metadata(ss)'),snap={cells:{},objects:{},structure:{sheets:meta.sheets.map(function(s){return [s.id,s.name];})},coverage:limitations.slice(),restoreProperties:['content'].concat(fields.map(function(f){return f[0];}))};
      snap.objects['workbook:sheets']={value:snap.structure.sheets,restorable:false,blocked:['Sheet structure requires normal tools']};
      snap.objects['workbook:names']={value:meta.names,restorable:false,blocked:['Named ranges require normal tools']};
      meta.sheets.forEach(function(s){
        if(!regions[s.id])regions[s.id]=[{sheetId:s.id,row:1,col:1,rows:s.rows,cols:s.columns}];
        var parts=regions[s.id].slice();
        // Include newly populated cells even if a script escaped the provided ss handle.
        if(!parts.some(function(p){return p.row===1 && p.col===1 && p.rows>=s.rows && p.cols>=s.columns;}))parts.push({sheetId:s.id,row:1,col:1,rows:s.rows,cols:s.columns});
        parts.forEach(function(p){
          var rowsPer=Math.max(1,Math.floor(4000/p.cols));
          for(var r=p.row;r<p.row+p.rows;r+=rowsPer){
            var part={sheetId:s.id,row:r,col:p.col,rows:Math.min(rowsPer,p.row+p.rows-r),cols:p.cols};
            var readback=invoke('ReviewTools.read(ss,'+JSON.stringify(part)+')');
            Object.keys(readback.cells).forEach(function(k){var c=readback.cells[k];if(structural['*'] || structural[s.id])c.blocked.push('Coordinate-changing operation observed; use normal tools');snap.cells[k]=c;});
            if(readback.unavailable.length)snap.coverage.push({sheet:s.name,unavailable:readback.unavailable});
          }
        });
        snap.coverage.push({sheet:s.name,regions:regions[s.id]});
      });
      if(Object.keys(unknown).length)snap.coverage.push({content_provenance_unavailable:Object.keys(unknown)});
      if(unsupported.length){snap.coverage.push({observed_uncovered_operations:copy(unsupported)});snap.objects['review:uncoveredOperations']={value:copy(unsupported),restorable:false,blocked:['Review these observed operations through normal tools; exact restoration is unavailable']};}
      if(original){
        // Spill results, recalc effects and format-induced Date conversions are computed
        // observations, not entered edits. ss is the task's supported workbook handle.
        // If provenance was lost or coordinates changed, retain the observed diff and
        // block restoration rather than guessing at original identity.
        Object.keys(snap.cells).forEach(function(k){
          var c=snap.cells[k],sid=c.sheetId;
          if(!original.cells[k])c.blocked.push('Original cell was not captured before an unobserved write; exact restoration unavailable');
          var written=contentWrites.some(function(w){return w.sheetId===sid && c.row>=w.row && c.row<w.row+w.rows && c.col>=w.col && c.col<w.col+w.cols;});
          if(unknown['*'] || unknown[sid] || structural['*'] || structural[sid]){
            if(!written && !equal(c.content,(original.cells[k]||{}).content))c.blockedProperties.content=(c.blockedProperties.content||[]).concat(['Entered-content provenance unavailable: this may be a computed spill effect; use normal tools to establish the original entered state']);
            return;
          }
          if(!written && !equal(c.content,(original.cells[k]||{}).content)){
            c.computed_effect=true;c.content=original.cells[k]?original.cells[k].content:null;
          }
        });
      }
      // Summarise, never serialise. The snapshot is the whole workbook's cell state and
      // reached 167 MB on task_03 -- one event, 99.9% of a 183 MB log, and the JSON cost
      // tripled that run's wall clock. `original` holds it in memory for the diff; the log
      // only needs enough to tell runs apart.
      if(!original){original=snap;env.event({ev:'review.baseline',
        cells:Object.keys(snap.cells).length,objects:Object.keys(snap.objects).length,
        sheets:snap.structure.sheets.length,coverage:snap.coverage});}
      cached=snap;return snap;
    }
    // Compare the spans a script touched against the pre-run baseline, across every class
    // the end-of-run review scores: content plus each observable format property. Reads
    // only the touched spans -- never the whole workbook, which is what made one task_03
    // baseline event 167 MB.
    //
    // Background fill is absent by design: it is excluded from snapshotting throughout
    // (see `limitations`), so this cannot report it even though the grader scores it.
    function touchedDiff(spans){
      if(!original || !spans.length)return [];
      var now;
      try{now=invoke('ReviewTools.readSpans(ss,'+JSON.stringify(spans)+')');}
      catch(e){return [];}
      var byProp={},rewrites=[];
      Object.keys(now.cells).forEach(function(k){
        var before=original.cells[k],after=now.cells[k];
        if(!before)return;
        // A formula rewritten to a different text that computes the same number is the
        // clearest unintended edit there is: nothing was gained and the grader compares
        // formula text, not value. task_09 loses every failing seed to exactly this --
        // =L23/SQRT(Market_Correlation)*(1-Buyer_Diversification) retyped as
        // =L23/SQRT($F$10)*(1-$F$11), identical result, named refs swapped for coordinates.
        if(before.content && after.content && !equal(before.content,after.content) &&
           before.computed && after.computed && equal(before.computed,after.computed))
          rewrites.push(after.sheet+'!'+col(after.col)+after.row+
            '\n        was: '+describeValue(before.content)+
            '\n        now: '+describeValue(after.content)+
            '\n        both evaluate to '+describeValue(after.computed));
        // Filling a cell that was blank is the job, not damage. Counting it made task_09's
        // alert read "68 pre-existing properties changed" whose first examples were the
        // agent's own blank -> =MEDIAN(...) fills, burying the single real overwrite at
        // L24 under 19 false positives. Report content only where content existed.
        var wasBlank=before.content===null || before.content===undefined;
        function note(prop,b,a){
          if(prop==='content' && wasBlank)return;
          if(equal(b,a))return;
          var g=byProp[prop]||(byProp[prop]={prop:prop,cells:0,examples:[]});
          g.cells++;
          if(g.examples.length<3)g.examples.push(after.sheet+'!'+col(after.col)+after.row+
            '  '+describeValue(b)+' -> '+describeValue(a));
        }
        note('content',before.content,after.content);
        fields.forEach(function(f){note(f[0],before.properties[f[0]],after.properties[f[0]]);});
      });
      var props=Object.keys(byProp).map(function(p){return byProp[p];})
        .sort(function(a,b){return b.cells-a.cells;});
      props.rewrites=rewrites;
      return props;
    }
    function describeValue(v){
      if(v===null || v===undefined)return 'blank';
      if(typeof v!=='object')return String(v).slice(0,40);
      if(v.type)return v.type==='formula'?String(v.value).slice(0,40):String(v.value).slice(0,40);
      return stable(v).slice(0,40);
    }
    return {capture:capture,digest:digest,event:env.event,
      restore:function(patches){cached=null;return invoke('ReviewTools.restore(ss,'+JSON.stringify(patches)+')');},
      exec:function(code,ms){
        var marker='__REVIEW_'+env.uuid()+'__',result=env.exec('log('+JSON.stringify(marker)+'+JSON.stringify(ReviewTools.execute(ss,'+JSON.stringify(code)+','+JSON.stringify(regions)+',log)));',ms);
        cached=null;
        if(!result.ok){structural['*']=true;return result;}
        var lines=[],record=null;
        result.out.split('\n').forEach(function(line){if(line.indexOf(marker)===0)record=JSON.parse(line.slice(marker.length));else lines.push(line);});
        if(!record){structural['*']=true;return {ok:false,out:'Review mutation journal missing. '+lines.join('\n')};}
        Object.keys(record.extensions).forEach(function(k){if(!original.cells[k])original.cells[k]=record.extensions[k];});
        regions=record.regions;
        Object.keys(record.structural).forEach(function(k){structural[k]=true;});
        unsupported=unsupported.concat(record.unsupported);
        contentWrites=contentWrites.concat(record.contentWrites);
        Object.keys(record.unknown).forEach(function(k){unknown[k]=true;});
        if(Object.keys(record.extensions).length)env.event({ev:'review.original_extension',cells:record.extensions});
        env.event({ev:'review.mutations',structural:record.structural,unsupported:record.unsupported,contentWrites:record.contentWrites,styleWrites:record.styleWrites,unknown:record.unknown});
        // Report collateral damage on the turn it happens, not eight turns later at review.
        // By review time the model is defending a past decision and reliably keeps it: across
        // 75 runs it chose keep on every group and restore never fired once, while task_10
        // wrote a perfect 740/740 and destroyed 218 pre-existing cells, and task_09 lost a
        // perfect 21/21 to a single one. Stated as fact, never as a challenge -- asking a
        // model whether it is sure flips correct answers as often as wrong ones.
        var touched=(record.contentWrites||[]).concat(record.styleWrites||[]);
        var diff=touchedDiff(touched);
        if(diff.rewrites && diff.rewrites.length){
          env.event({ev:'review.pointless_rewrite',n:diff.rewrites.length,cells:diff.rewrites.slice(0,20)});
          lines.push('','*** POINTLESS REWRITE: '+diff.rewrites.length+' formula(s) replaced with different');
          lines.push('    text that computes the SAME value. ***');
          diff.rewrites.slice(0,10).forEach(function(x){lines.push('  '+x);});
          if(diff.rewrites.length>10)lines.push('  ...and '+(diff.rewrites.length-10)+' more.');
          lines.push('This gained nothing and is scored as preservation damage: the grader compares formula');
          lines.push('TEXT, not the value it produces. Swapping a named range for its coordinates, or');
          lines.push('rearranging terms, fails the cell even though the number is right. Restore the original');
          lines.push('text unless the task required this exact rewrite.');
        }
        if(diff.length){
          env.event({ev:'review.touched_diff',classes:diff.length,detail:diff});
          var total=0;diff.forEach(function(g){total+=g.cells;});
          lines.push('','*** PRESERVATION ALERT: '+total+' pre-existing cell propert'+(total===1?'y':'ies')+' changed. ***');
          lines.push('Measured against the workbook as it was before this run, not against your last edit.');
          diff.forEach(function(g){
            lines.push('  '+g.prop.toUpperCase()+'  -- '+g.cells+' cell(s)');
            g.examples.forEach(function(x){lines.push('      '+x);});
          });
          lines.push('Check each class above against the task. They are judged separately at the end.');
          lines.push('');
          lines.push('Changing existing CONTENT is often correct and you should keep it when the task calls');
          lines.push('for it: replacing a hardcode the task asked you to make live, repairing a formula that');
          lines.push('errors, repointing a reference the task requires you to move, or writing a cell the task');
          lines.push('names. Do not revert work the task asked for -- that fails the run just as surely.');
          lines.push('');
          lines.push('FORMATTING can be required output -- some tasks grade borders, number formats or fonts');
          lines.push('as the answer, so do not reflexively undo formatting you were asked for. But writing a');
          lines.push('value can also disturb that cell\'s format on its own, without you asking; when that is');
          lines.push('what happened, keep the value and restore the format. A required content change does not');
          lines.push('by itself authorize a formatting change: check the task, then decide per property.');
          lines.push('');
          lines.push('Correct output does not excuse preservation damage: a perfect answer still fails the');
          lines.push('run. Restore what the task does not require, now, while you know why you wrote it.');
          lines.push('This alert repeats while the change stands.');
        }
        return {ok:true,out:lines.join('\n')};
      }
    };
  }
  return {metadata:metadata,read:read,readSpans:readSpans,restore:restore,execute:execute,bridge:bridge,digest:digest,fields:fields};
})();
