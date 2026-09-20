/** 15x3 sweep: RAM-sorted snake lanes, N workers. node offline/sweep.mjs [--workers 4] [--seeds 3] [--deadline 600] */
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const TIMEOUT_BIN = existsSync('/opt/homebrew/bin/gtimeout') ? '/opt/homebrew/bin/gtimeout'
  : existsSync('/usr/bin/timeout') ? 'timeout' : null;
const root = path.resolve(new URL('..', import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(2).map((a,i,arr)=>a.startsWith('--')?[a.slice(2),arr[i+1]&&!arr[i+1].startsWith('--')?arr[i+1]:true]:[]).filter(x=>x.length));
const WORKERS = +(args.workers||2), SEEDS = +(args.seeds||3), DEADLINE = +(args.deadline||600);
// cell-count weights from task profiling (init.xlsx total cells, approx)
const WEIGHT = {'03':362000,'04':93000,'06':93000,'15':30000,'12':16000,'09':14000,'11':14000,'14':12000,'05':12000,'07':11000,'10':8000,'01':6000,'02':5000,'13':2000,'08':1000};
const HEAVY = ['03','04'];  // pinned to lane 0: the giants must never co-run
const tasks = Object.keys(WEIGHT).filter(t=>!HEAVY.includes(t)).sort((a,b)=>WEIGHT[b]-WEIGHT[a]);
const lanes = Array.from({length:WORKERS},()=>[]);
lanes[0].push(...HEAVY);
tasks.forEach((t,i)=>{ const k = Math.floor(i/WORKERS)%2 ? WORKERS-1-(i%WORKERS) : i%WORKERS; lanes[k].push(t); });
const queue = [];
let TOTAL_RUNS = 0;
for (let s=1;s<=SEEDS;s++) {
  const maxLen = Math.max(...lanes.map(l=>l.length));
  for (let k=0;k<maxLen;k++) for (let li=0;li<WORKERS;li++)
    if (lanes[li][k] !== undefined) queue.push({t:lanes[li][k],s,lane:li});
}
const LOG = '/tmp/polar-sweep.log', STATUS='/tmp/polar-sweep-status.json';
const results = [];
let active=0, qi=0, heavyActive=0;
function log(m){ appendFileSync(LOG, `[${new Date().toISOString().slice(11,19)}] ${m}\n`); }
function status(){ writeFileSync(STATUS, JSON.stringify({done:results.length,total:TOTAL_RUNS,active,last:results.slice(-3)},null,1)); }
function runOne(job) {
  active++; if (HEAVY.includes(job.t)) heavyActive++; const t0=Date.now();
  const hardCap=String(DEADLINE+180);
  const argsArr = TIMEOUT_BIN
    ? ['-s','KILL',hardCap,'node',path.join(root,'offline/runner.mjs'),'--task',job.t,'--tag','s'+job.s,'--deadline',String(DEADLINE)]
    : [path.join(root,'offline/runner.mjs'),'--task',job.t,'--tag','s'+job.s,'--deadline',String(DEADLINE)];
  const child = execFile(TIMEOUT_BIN || 'node', TIMEOUT_BIN ? argsArr : argsArr, {cwd:root, timeout:(DEADLINE+300)*1000, killSignal:'SIGKILL'},(err,stdout,stderr)=>{
    active--; if (HEAVY.includes(job.t)) heavyActive--;
    const wall=Math.round((Date.now()-t0)/1000);
    const m = /grade: score ([\d.]+)/.exec(stdout||'');
    const st = /status: (\w+)/.exec(stdout||'');
    const tn = /turns: (\d+)/.exec(stdout||'');
    const dirm = /dir: (.*)/.exec(stdout||'');
    const gerr = /grade failed: (.*)/.exec(stdout||'');
    const rec = {task:job.t,seed:job.s,score:m?+m[1]:null,status:st?st[1]:(err&&err.signal?'killed_'+err.signal:err?'spawn_error':'?'),turns:tn?+tn[1]:null,wall,dir:dirm?dirm[1].trim():null,err:err?String(err).slice(0,150):null, grade_error:gerr?gerr[1].slice(0,120):null};
    results.push(rec);
    log(`t${job.t} s${job.s} → ${rec.status} score=${rec.score} turns=${rec.turns} wall=${wall}s${wall>300?' OVER-5M':''}`);
    // metadata sidecar
    if (rec.dir) { try { writeFileSync(path.join(rec.dir,'meta.json'), JSON.stringify(rec,null,1)); } catch(e){}
      try { execFileSync('sh',['-c',`MOG_SESSION_DIR='${rec.dir}/.mogsess' '${root}/.mog/bin/mog' --close-all --discard 2>/dev/null || true`],{timeout:20000}); } catch(e){} }
    try { execFileSync('sh',['-c','[ "$(uname)" = Linux ] || exit 0; for p in $(pgrep -x mog); do pp=$(ps -o ppid= -p $p|tr -d " "); et=$(ps -o etimes= -p $p|tr -d " "); [ "$pp" = 1 ] && [ "$et" -gt 850 ] && kill -9 $p; done; true'],{timeout:15000}); } catch(e){}
    status(); next();
  });
}
function next(){
  while (active<WORKERS && queue.length>0){
    let idx=0;
    if (HEAVY.includes(queue[0].t) && heavyActive>0){
      idx=queue.findIndex(j=>!HEAVY.includes(j.t));
      if (idx<0) break; // only heavies left; wait for the running one
    }
    const j=queue.splice(idx,1)[0]; log(`start t${j.t} s${j.s} (lane ${j.lane})`); runOne(j);
  }
  if (active===0 && queue.length===0) finish();
}
function finish(){
  const agg={};
  for (const r of results){ (agg[r.task]=agg[r.task]||[]).push(r); }
  let lines=['\n=== SWEEP RESULTS (15x'+SEEDS+') ==='], total=0;
  for (const t of Object.keys(agg).sort()){
    const marks=agg[t].sort((a,b)=>a.seed-b.seed).map(r=>r.score===1?'P':(r.status==='done'||r.status==='deadline'||r.status==='turns')?(r.score!=null?'F':'E'):'E');
    const passes=marks.filter(x=>x==='P').length; total+=passes;
    lines.push(`task_${t}: ${marks.join('')} (${passes}/${SEEDS})  scores=[${agg[t].map(r=>r.score==null?'-':r.score.toFixed(2)).join(',')}] walls=[${agg[t].map(r=>r.wall+'s').join(',')}]`);
  }
  lines.push(`TOTAL passes: ${total}/${TOTAL_RUNS}`);
  log(lines.join('\n'));
  writeFileSync('/tmp/polar-sweep-final.txt', lines.join('\n'));
  log('SWEEP-COMPLETE');
}
TOTAL_RUNS = queue.length;
log(`sweep start: ${queue.length} runs, ${WORKERS} workers, deadline ${DEADLINE}s; lanes=${JSON.stringify(lanes)}`);
status(); next();
