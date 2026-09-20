#!/usr/bin/env python3
"""response.json (or raw trace) -> transcript.md: ONE chronological conversation.
Every event in order; one summary line; full content collapsed under it. Raw = response.json."""
import json, sys, os
def esc(x): return str(x).replace('<','&lt;')
def block(summary, body):
    if not body or len(str(body)) <= len(summary): return f"**{summary}**\n"
    return f"<details><summary>{summary}</summary>\n\n```\n{esc(body)}\n```\n</details>\n"
def render(trace, meta, out_path):
    L = [f"# {meta.get('task','?')} · {meta.get('status','?')} · ${meta.get('cost_usd','?')} · {meta.get('turns','?')} turns · {round((meta.get('elapsed_ms') or 0)/1000)}s · {meta.get('written','')}",'']
    for e in trace:
        t = e.get('t','?'); at = f"`{round(e.get('at',0)/1000):>4}s`"
        if t == 'map':
            L.append(block(f"{at} ▸ WORKBOOK MAP injected ({e.get('bytes','?')}B)", e.get('text','')))
        elif t == 'turn':
            head = f"{at} ── model turn {e.get('n')} · {e.get('ms',0)//1000}s · in {e.get('inp')} ({e.get('cached')} cached) · out {e.get('out')}"
            body = ''
            if e.get('think'): body += 'REASONING: ' + e['think'] + '\n\n'
            if e.get('text'): body += 'ASSISTANT: ' + e['text']
            L.append(block(head + (' · 🧠' if e.get('think') else '') + (' · 💬' if e.get('text') else ''), body))
        elif t == 'call':
            first = (e.get('out','') or '').split('\n')[0][:100]
            L.append(block(f"{at} → {e.get('tool')} · {str(e.get('args',''))[:90]} ⇒ {first}",
                           f"ARGS: {e.get('args','')}\n\nRESULT:\n{e.get('out','')}"))
        elif t == 'plan':
            L.append(block(f"{at} ✎ PLAN attempt {e.get('attempt')} · {len(e.get('targets',[]))} targets · {e.get('asserts')} assertions" + (' · WEAK' if e.get('weak') else ''),
                           '\n'.join(e.get('targets',[]))))
        elif t == 'verdict':
            L.append(f"**{at} ✔ VERDICT: {e.get('verdict')}**\n")
        elif t == 'revert':
            L.append(f"**{at} ⟲ REVERT to pristine**\n")
        elif t in ('agent_error','hatch_error'):
            L.append(block(f"{at} ☠ {t}", e.get('err','')))
        elif t == 'write':
            pass  # covered by its 'call' event
        else:
            L.append(block(f"{at} · {t}", json.dumps(e)))
    open(out_path,'w').write('\n'.join(L))
    return out_path
if __name__ == '__main__':
    src = sys.argv[1]; d = json.load(open(src))
    resp = d.get('response', d) if isinstance(d, dict) else {'trace': d}
    trace = resp.get('trace', d if isinstance(d, list) else [])
    meta = {k: resp.get(k) for k in ('status','cost_usd','turns','elapsed_ms','written')}
    meta['task'] = d.get('taskId', os.path.basename(os.path.dirname(os.path.abspath(src))))
    print(render(trace, meta, os.path.join(os.path.dirname(os.path.abspath(src)), 'transcript.md')))
