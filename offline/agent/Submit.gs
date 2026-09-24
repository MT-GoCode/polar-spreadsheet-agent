/* Shared submit/review controller. No platform I/O: adapter snapshots and writes are
   host-owned, so the immutable original survives separate Mog interpreter invocations.
   Snapshot contract: {cells:{key:{sheetId,sheet,row,col,content,properties,computed,
   blocked}}, objects:{key:{value,restorable}}, coverage:[], structure:{...}}.
   content/properties are canonical ENTERED state; computed never determines edits.
   adapter: capture(ms), restore(patches,ms), digest(string), event(object). */
var SubmitReview = (function () {
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function stable(x) {
    if (x === undefined) return 'null';
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    return '{' + Object.keys(x).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stable(x[k]);
    }).join(',') + '}';
  }
  function equal(a, b) { return stable(a) === stable(b); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function column(n) { var s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }
  function a1(r, c) { return column(c) + r; }
  function kind(v) { return v === null || v === undefined ? 'blank' : v.type || typeof v; }
  function scalar(v) { return v && own(v, 'value') ? v.value : v; }
  function bounded(v, cap) { var s = stable(v); return s.length <= cap ? v : { preview: s.slice(0, cap), truncated: true }; }
  function parseRange(s) {
    var m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(s).toUpperCase());
    if (!m) throw new Error('Expected a bounded A1 range on the group sheet: ' + s);
    function col(v) { var n = 0; for (var i = 0; i < v.length; i++) n = n * 26 + v.charCodeAt(i) - 64; return n; }
    var x = { r1: Number(m[2]), c1: col(m[1]), r2: Number(m[4] || m[2]), c2: col(m[3] || m[1]) };
    if (x.r1 < 1 || x.c1 < 1 || x.r2 < x.r1 || x.c2 < x.c1) throw new Error('Invalid range: ' + s);
    return x;
  }
  /* Lex strings, quoted sheet names and bracketed structured references before
     translating A1 tokens. This is a grouping hint, NEVER a formula rewrite. */
  function formulaPattern(s, row, col) {
    if (typeof s !== 'string') return stable(s);
    var out = '', i = 0;
    while (i < s.length) {
      var ch = s[i];
      if (ch === '"' || ch === "'") {
        var q = ch; out += ch; i++;
        while (i < s.length) { ch = s[i++]; out += ch; if (ch === q) { if (s[i] === q) { out += s[i++]; } else break; } }
        continue;
      }
      if (ch === '[') { var depth = 0; do { ch = s[i++]; out += ch; if (ch === '[') depth++; if (ch === ']') depth--; } while (i < s.length && depth); continue; }
      var m = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)/.exec(s.slice(i));
      if (m && (i === 0 || !/[A-Za-z0-9_.]/.test(s[i-1])) && !/[A-Za-z0-9_!.(]/.test(s[i + m[0].length] || ' ')) {
        var n = 0; for (var j = 0; j < m[2].length; j++) n = n * 26 + m[2].toUpperCase().charCodeAt(j) - 64;
        var r = Number(m[4]);
        if (n <= 16384 && r <= 1048576) {
          out += (m[3] ? 'R' + r : 'R[' + (r-row) + ']') + (m[1] ? 'C' + n : 'C[' + (n-col) + ']'); i += m[0].length; continue;
        }
      }
      out += ch; i++;
    }
    return out;
  }
  function spans(facts) {
    var cells = facts.filter(function (f) { return f.row !== undefined; }).map(function (f) { return [f.row, f.col]; });
    cells.sort(function (a,b) { return a[0]-b[0] || a[1]-b[1]; });
    var out = [];
    cells.forEach(function (x) { var last = out[out.length-1]; if (last && last[0] === x[0] && last[2]+1 === x[1]) last[2] = x[1]; else out.push([x[0],x[1],x[1]]); });
    return out;
  }
  function blankCell(c, defaults) { return { sheetId: c.sheetId, sheet: c.sheet, row: c.row, col: c.col, content: null, properties: defaults || {}, blocked: [] }; }
  function diff(original, current) {
    var facts = [], cells = {}, objects = {};
    Object.keys(original.cells || {}).concat(Object.keys(current.cells || {})).forEach(function (k) { cells[k] = true; });
    Object.keys(cells).sort().forEach(function (k) {
      var b = original.cells[k], n = current.cells[k]; if (!b) b = blankCell(n,original.defaultProperties); if (!n) n = blankCell(b,current.defaultProperties);
      var props = { content: true };
      Object.keys(b.properties || {}).concat(Object.keys(n.properties || {})).forEach(function (p) { props[p] = true; });
      Object.keys(props).sort().forEach(function (p) {
        var before = p === 'content' ? b.content : b.properties[p], after = p === 'content' ? n.content : n.properties[p];
        before = before === undefined ? null : before; after = after === undefined ? null : after;
        if (equal(before, after)) return;
        var blocked = (b.blocked || []).concat(n.blocked || [],(b.blockedProperties || {})[p] || [],(n.blockedProperties || {})[p] || []);
        facts.push({ key: k, sheetId: n.sheetId, sheet: n.sheet, row: n.row, col: n.col, property: p, before: before, after: after,
          computed: n.computed, label: n.label || b.label || '', blocked: blocked,
          restorable: !blocked.length && (current.restoreProperties || []).indexOf(p) >= 0 });
      });
    });
    Object.keys(original.objects || {}).concat(Object.keys(current.objects || {})).forEach(function (k) { objects[k] = true; });
    Object.keys(objects).sort().forEach(function (k) {
      var b = original.objects[k], n = current.objects[k]; var before = b ? b.value : null, after = n ? n.value : null;
      if (!equal(before, after)) facts.push({ key:k, property:'object', sheet:(n || b).sheet || '', sheetId:(n || b).sheetId,
        before:before, after:after, restorable:!!((n || b).restorable), blocked:(n || b).blocked || [] });
    });
    return facts;
  }
  function groupFacts(facts, digest) {
    var buckets = {};
    facts.forEach(function (f) {
      var p = f.property, bk = kind(f.before), ak = kind(f.after);
      var shape = p === 'content' ? [bk, ak,
        bk === 'formula' ? formulaPattern(scalar(f.before),f.row,f.col) : null,
        ak === 'formula' ? formulaPattern(scalar(f.after),f.row,f.col) : null] : [f.before, f.after];
      var k = stable([f.sheetId, p, shape, f.restorable, f.blocked]);
      if (!buckets[k]) buckets[k] = []; buckets[k].push(f);
    });
    var out = Object.keys(buckets).sort().map(function (k) {
      var fs = buckets[k].sort(function (a,b) { return (a.row || 0)-(b.row || 0) || (a.col || 0)-(b.col || 0) || a.key.localeCompare(b.key); });
      return makeGroup(fs, digest);
    });
    out.sort(function (a,b) { return a.priority-b.priority || a.sheet.localeCompare(b.sheet) || a.id.localeCompare(b.id); });
    return out;
  }
  function makeGroup(fs, digest) {
    var f = fs[0];
    var id = 'g' + digest(stable(fs.map(function (x) { return [x.key,x.property,x.before,x.after]; }))).slice(0,20);
    return { id:id, sheet:f.sheet || '', sheetId:f.sheetId, property:f.property, count:fs.length, facts:fs, spans:spans(fs),
      beforeKind:kind(f.before), afterKind:kind(f.after), restorable:fs.every(function (x) { return x.restorable; }),
      priority:f.property === 'object' ? 0 : f.property === 'content' && f.before !== null ? 1 : f.property === 'content' ? 2 : 3 };
  }
  function entered(snapshot) {
    var out = { cells:{}, objects:snapshot.objects || {}, structure:snapshot.structure || {}, coverage:snapshot.coverage || [] };
    Object.keys(snapshot.cells || {}).sort().forEach(function (k) { var c = snapshot.cells[k]; out.cells[k] = [c.content, c.properties, c.blocked || [], c.blockedProperties || {}]; });
    return out;
  }
  function observableErrors(snapshot) {
    var out = [];
    Object.keys(snapshot.cells || {}).forEach(function (k) { var c = snapshot.cells[k]; if (c.computed && c.computed.type === 'error') out.push({ key:k, sheet:c.sheet, cell:a1(c.row,c.col), error:c.computed.value }); });
    return out;
  }
  function create(adapter, options) {
    options = options || {};
    var original = adapter.capture(options.deadline ? Math.max(1,options.deadline-Date.now()) : 1200000);
    var current = original, fingerprint = null, groups = [], reportId = null, serial = 0, rounds = 0, invalid = 0;
    var receipts = {}, history = {}, visited = {}, decisions = {}, finished = false, checked = [];
    var maxRounds = options.maxRounds || 3, pageSize = options.pageSize || 30;
    function remaining() { var n = options.deadline ? options.deadline-Date.now() : 1200000; if (n <= 0) throw new Error('review deadline'); return n; }
    function emit(e) { if (adapter.event) adapter.event(e); }
    function refresh() {
      try { current = adapter.capture(remaining()); } catch(e) { e.reviewRuntime=true; throw e; } var next = adapter.digest(stable(entered(current)));
      if (next !== fingerprint) {
        fingerprint = next; reportId = 'r' + (++serial) + '-' + next.slice(0,12); groups = groupFacts(diff(original,current),adapter.digest);
        visited = {}; decisions = {}; checked = [];
      }
    }
    function summary(g) {
      var picks = [0, Math.floor((g.facts.length-1)/2), g.facts.length-1], seen = {}, examples = [];
      picks.forEach(function (i) { if (seen[i]) return; seen[i] = true; var f = g.facts[i]; examples.push({ cell:f.row ? a1(f.row,f.col) : f.key,
        before:bounded(adapter.describe ? adapter.describe(f.property,f.before) : f.before,700), after:bounded(adapter.describe ? adapter.describe(f.property,f.after) : f.after,700), computed:f.computed, label:f.label || undefined }); });
      return { id:g.id, sheet:g.sheet, property:g.property, count:g.count, transition:g.beforeKind+' → '+g.afterKind,
        spans:g.spans.slice(0,16), additional_spans:Math.max(0,g.spans.length-16), restorable:g.restorable,
        restore_blockers:g.facts[0].blocked, examples:examples, prior_restore:history[g.id] || undefined };
    }
    function report(page, status, extra) {
      page = page || 0; var pages = Math.max(1,Math.ceil(groups.length/pageSize));
      if (page < 0 || page >= pages || Math.floor(page) !== page) throw new Error('Invalid report page; expected 0..'+(pages-1));
      visited[page] = true;
      var oldErrors = {}; observableErrors(original).forEach(function (e) { oldErrors[stable([e.key,e.error])] = true; });
      var errors = observableErrors(current), newErrors = errors.filter(function (e) { return !oldErrors[stable([e.key,e.error])]; });
      var out = { status:status || 'review_required', report_id:reportId, page:page, pages:pages, groups_total:groups.length,
        changed_properties:groups.reduce(function (n,g) { return n+g.count; },0), rounds_remaining:Math.max(0,maxRounds-rounds),
        decision_mode:'apply', default_action:'restore', unsupported_default:'investigate',
        coverage:current.coverage || [], seconds_remaining:Math.max(0,Math.floor(remaining()/1000)), groups:groups.slice(page*pageSize,(page+1)*pageSize).map(summary),
        errors:{new_count:newErrors.length, preexisting_count:errors.length-newErrors.length, examples:newErrors.slice(0,30)},
        instructions:typeof SUBMIT_REVIEW_PROMPT === 'string' ? SUBMIT_REVIEW_PROMPT : 'Review the task, changes, independent evidence and intended coverage. KEEP, RESTORE a supported property, or INVESTIGATE using normal tools.' };
      if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
      return out;
    }
    function validate(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('submit expects an object');
      var keys=['mode','report_id','decisions','finish','page','group_ids','ranges','checks'];
      if (Object.keys(args).some(function(k){return keys.indexOf(k)<0;}) || keys.some(function(k){return !own(args,k);})) throw new Error('Expected exactly: '+keys.join(', '));
      if (args.report_id !== null && typeof args.report_id !== 'string') throw new Error('report_id must be string or null');
      if (!Array.isArray(args.checks) || !args.checks.every(function(c){return c && Object.keys(c).length===4 && ['obligation','observation','check'].every(function(k){return typeof c[k]==='string' && c[k].trim();}) && ['satisfied','unresolved'].indexOf(c.outcome)>=0;})) throw new Error('checks require obligation, observation, independent check and outcome satisfied/unresolved');
      if (!Array.isArray(args.group_ids) || !Array.isArray(args.ranges) || !args.group_ids.concat(args.ranges).every(function(x){return typeof x==='string';})) throw new Error('group_ids/ranges require strings');
      if (['review','apply','inspect','split'].indexOf(args.mode) < 0) throw new Error('mode must be review, apply, inspect or split');
      if (!Array.isArray(args.decisions) || !Array.isArray(args.group_ids) || !Array.isArray(args.ranges) || typeof args.finish !== 'boolean') throw new Error('decisions/group_ids/ranges must be arrays; finish must be boolean');
      if (!Number.isInteger(args.page) || args.page < 0) throw new Error('page must be a nonnegative integer');
      args.decisions.forEach(function (d) {
        if (!d || Object.keys(d).length !== 4 || !Array.isArray(d.group_ids) || !d.group_ids.length || ['keep','restore','investigate'].indexOf(d.action) < 0 ||
            typeof d.reason !== 'string' || !d.reason.trim() || !Array.isArray(d.evidence) || !d.evidence.every(function (x) { return typeof x === 'string' && x.trim(); }) || !d.evidence.length)
          throw new Error('Each decision needs group_ids, action keep/restore/investigate, a nonempty reason and evidence strings');
      });
    }
    function perform(args) {
      if (finished) return {status:'complete', report_id:reportId, complete:true};
      try {
        validate(args); remaining();
        var receiptKey = adapter.digest(stable(args));
        refresh();
        if (receipts[receiptKey] && receipts[receiptKey].fingerprint === fingerprint) return clone(receipts[receiptKey].result);
        if (args.report_id !== null && args.report_id !== reportId) return report(0,'stale_report',{message:'Workbook changed or report was replaced. No decisions applied. Review this current report.'});
        if (args.mode === 'inspect') {
          if (args.report_id !== reportId || args.decisions.length || args.finish || args.ranges.length || args.checks.length) throw new Error('inspect needs current report, group_ids and page only');
          var wanted = args.group_ids; if (!wanted.length || wanted.length > 10) throw new Error('inspect requires 1..10 group IDs');
          var detail = wanted.map(function (id) { var g = groups.filter(function (x) { return x.id === id; })[0]; if (!g) throw new Error('Unknown group '+id);
            if(args.page>=Math.ceil(g.facts.length/100)) throw new Error('Invalid inspection page');
            return {id:id, sheet:g.sheet, property:g.property, count:g.count, page:args.page,
              facts:g.facts.slice(args.page*100,(args.page+1)*100).map(function(f){var x=clone(f); if(adapter.describe){x.before=adapter.describe(f.property,f.before);x.after=adapter.describe(f.property,f.after);}return x;}), pages:Math.ceil(g.facts.length/100)}; });
          return {status:'inspection',report_id:reportId,groups:detail,instructions:typeof SUBMIT_REVIEW_PROMPT==='string'?SUBMIT_REVIEW_PROMPT:''};
        }
        if (args.mode === 'split') {
          if (args.report_id !== reportId || args.group_ids.length !== 1 || !args.ranges.length || args.decisions.length || args.finish || args.checks.length) throw new Error('split requires current report, one group_id, ranges and no decisions/finish');
          var index = -1; groups.forEach(function (g,i) { if (g.id === args.group_ids[0]) index = i; });
          if (index < 0) throw new Error('Unknown group');
          var target = groups[index], selections = args.ranges.map(parseRange), yes = [], no = [];
          target.facts.forEach(function (f) { (selections.some(function (x) { return f.row>=x.r1 && f.row<=x.r2 && f.col>=x.c1 && f.col<=x.c2; }) ? yes : no).push(f); });
          if (!yes.length || !no.length) throw new Error('split must select a nonempty proper subset of the exact group');
          groups.splice(index,1,makeGroup(yes,adapter.digest),makeGroup(no,adapter.digest));
          reportId = 'r'+(++serial)+'-'+fingerprint.slice(0,12); visited = {}; decisions = {}; checked = [];
          return report(0,'review_required');
        }
        if (args.group_ids.length || args.ranges.length) throw new Error('group_ids/ranges are only used for inspect/split');
        if (args.mode === 'review' && !args.decisions.length && !args.finish && !args.checks.length) return report(args.page);
        if (args.page >= Math.max(1,Math.ceil(groups.length/pageSize))) throw new Error('Invalid report page');
        if (args.report_id !== reportId) throw new Error('Decisions require the current report_id');
        
        var byId = {}, proposed = {}, duplicate = {};
        groups.forEach(function (g) { byId[g.id] = g; });
        args.decisions.forEach(function (d) { d.group_ids.forEach(function (id) {
          if (typeof id !== 'string' || !own(byId,id)) throw new Error('Unknown group '+id);
          if (duplicate[id]) throw new Error('Duplicate group '+id); duplicate[id] = true;
          if (d.action === 'restore' && !byId[id].restorable) throw new Error('RESTORE unsupported for '+id+'; use INVESTIGATE');
          proposed[id] = d;
        }); });
        var defaultRestored = [], defaultInvestigations = [];
        if (args.mode === 'apply') {
          // A full, explicit application request is the only way omission can restore.
          // Page reads, implicit stops and legacy explicit decisions never infer writes.
          if (Object.keys(visited).length < Math.max(1,Math.ceil(groups.length/pageSize))) return report(args.page,'pages_unreviewed',{message:'Read every report page, then resubmit mode=apply with the full KEEP/INVESTIGATE exception list. No writes applied.'});
          decisions = {}; checked = clone(args.checks);
        } else if(args.checks.length) checked=clone(args.checks);
        Object.keys(proposed).forEach(function (id) { decisions[id] = proposed[id]; });
        var missing = groups.filter(function (g) { return !own(decisions,g.id); });
        if (args.mode === 'apply') missing.forEach(function (g) {
          if (g.restorable) {
            decisions[g.id] = {action:'restore',reason:'Default RESTORE: no KEEP or INVESTIGATE exception supplied for this current report.'};
            defaultRestored.push(g.id);
          } else {
            decisions[g.id] = {action:'investigate',reason:'Default RESTORE is unsupported for this property; inspect its restore blockers and resolve with normal tools or justify KEEP.'};
            defaultInvestigations.push(g.id);
          }
        });
        else if (missing.length) return report(args.page,'decisions_incomplete',{missing_group_ids:missing.map(function(g){return g.id;}), message:'No writes applied. Read every page, then use mode=apply with all KEEP/INVESTIGATE exceptions; omitted supported groups will restore.'});
        if (args.finish && Object.keys(visited).length < Math.max(1,Math.ceil(groups.length/pageSize))) return report(args.page,'pages_unreviewed',{message:'Inspect every report page before finishing. No writes applied.'});
        var patches = [], investigations = [], kept = 0, restored = [];
        groups.forEach(function (g) { var d = decisions[g.id];
          if (d.action === 'restore') { restored.push({id:g.id,reason:d.reason}); g.facts.forEach(function (f) { patches.push({ key:f.key, sheetId:f.sheetId, sheet:f.sheet, row:f.row, col:f.col, property:f.property, before:f.before, expected:f.after }); }); }
          else if (d.action === 'investigate') investigations.push({group_id:g.id,reason:d.reason}); else kept++;
        });
        if(args.finish && !patches.length && !investigations.length && (!checked.length || checked.some(function(c){return c.outcome!=='satisfied';}))) return report(args.page,'obligations_unresolved',{message:'Provide checks covering the requested work, including work missing from the diff; all must be satisfied before finishing.'});
        if (rounds >= maxRounds) return {status:'review_limit',complete:false,unresolved:true};
        // Reading pages or accepting without finishing consumes no repair round.
        if(patches.length || investigations.length || args.finish) rounds++;
        invalid = 0;
        emit({ev:'review.decisions',report_id:reportId,round:rounds,keep:kept,restore:restored.length,investigate:investigations.length,decisions:args.decisions,default_restored_group_ids:defaultRestored,default_investigate_group_ids:defaultInvestigations});
        var result;
        if (patches.length) {
          var applied;
          try { applied = adapter.restore(patches,remaining()); } catch (e) { applied = {ok:false,error:String(e.message || e),partial:true}; }
          restored.forEach(function (x) { history[x.id] = { reason:x.reason, round:rounds }; });
          refresh(); decisions = {}; checked = [];
          var failed = patches.filter(function (p) { var c = current.cells[p.key]; var got = p.property === 'object' ? (current.objects[p.key] || {}).value : c ? p.property === 'content' ? c.content : c.properties[p.property] : p.property === 'content' ? null : (current.defaultProperties || {})[p.property]; return !equal(got,p.before); });
          result = report(0,failed.length ? 'restore_incomplete' : 'restored',{application:applied,restore_failures:failed.map(function (p) { return {key:p.key,property:p.property}; }),default_restored_group_ids:defaultRestored,investigations:investigations,message:'Review the refreshed workbook before finishing. Resubmit the full KEEP/INVESTIGATE exception list for the current report.'});
        } else if (investigations.length) result = report(args.page,'investigation_required',{investigations:investigations,message:'Use run_apps_script to inspect or edit, then submit again.'});
        else if (args.finish) { finished = true; result = {status:'complete',complete:true,report_id:reportId,groups_reviewed:groups.length,rounds:rounds}; }
        else result = report(args.page,'reviewed',{message:'All current groups accepted. Continue working or submit finish=true against this report.'});
        receipts[receiptKey] = {fingerprint:fingerprint,result:clone(result)};
        return clone(result);
      } catch (e) {
        if(options.deadline && Date.now()>=options.deadline)return {status:'deadline',complete:false,error:String(e.message||e)};
        if(e.reviewRuntime){emit({ev:'review.error',error:String(e.message||e),runtime:true});return {status:'review_error',complete:false,error:String(e.message||e)};}
        invalid++; emit({ev:'review.error',error:String(e.message || e),consecutive:invalid});
        return {status:invalid >= 3 ? 'review_invalid' : 'invalid_submission',complete:false,error:String(e.message || e),message:'No schema-invalid decisions are applied. Correct the submit arguments.',report_id:reportId};
      }
    }
    function submit(args){
      var out=perform(args);
      if(out.status!=='invalid_submission' && out.status!=='review_invalid')invalid=0;
      return out;
    }
    return {submit:submit, original:original};
  }
  var TOOL = {type:'function', name:'submit', strict:true,
    description:'First request mode=review, report_id=null, empty decisions/checks, finish=false, page=0; read every report page. Then use mode=apply with the current report_id and the FULL list of KEEP/INVESTIGATE exceptions, each with reason and evidence. Omitted supported groups RESTORE automatically; omitted unsupported groups become INVESTIGATE. KEEP and INVESTIGATE leave properties untouched; INVESTIGATE blocks completion. An empty exception list in mode=apply restores all supported changes. Explicit RESTORE is optional. After edits/restores, review the refreshed report and resubmit the full exceptions. Read-only review and implicit stops never restore. Use inspect for original/current details and split for a subset. finish=true succeeds only with all remaining groups KEEP and satisfied task checks, including work absent from the diff. Each check states obligation, observation, independent check and satisfied/unresolved outcome.',
    parameters:{type:'object',additionalProperties:false,required:['mode','report_id','decisions','finish','page','group_ids','ranges','checks'],properties:{
      mode:{type:'string',enum:['review','apply','inspect','split'],description:'review reads a report page; apply submits the full exception list after all pages are read, restoring omitted supported groups; inspect/split examine or divide groups'},report_id:{type:['string','null']},finish:{type:'boolean'},page:{type:'integer',minimum:0},
      checks:{type:'array',items:{type:'object',additionalProperties:false,required:['obligation','observation','check','outcome'],properties:{obligation:{type:'string'},observation:{type:'string'},check:{type:'string'},outcome:{type:'string',enum:['satisfied','unresolved']}}}},
      group_ids:{type:'array',items:{type:'string'}},ranges:{type:'array',items:{type:'string'}},
      decisions:{type:'array',items:{type:'object',additionalProperties:false,required:['group_ids','action','reason','evidence'],properties:{
        group_ids:{type:'array',items:{type:'string'}},action:{type:'string',enum:['keep','restore','investigate']},reason:{type:'string'},evidence:{type:'array',items:{type:'string'}}}}}
    }}};
  return {create:create,tool:TOOL,stable:stable,diff:diff,groupFacts:groupFacts,formulaPattern:formulaPattern,spans:spans};
})();
