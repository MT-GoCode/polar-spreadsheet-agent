/**
 * Candidate entry point. Called inside Apps Script with a fresh task workbook.
 * Tool loop: the model reads the workbook and edits it through the tools in
 * Prompts.gs until it stops calling tools or the clock runs out. The return
 * value is diagnostics only; the grader scores the workbook.
 */
const MODEL = 'gpt-5.4';
const REASONING_EFFORT = 'medium';
const MAX_OUTPUT_TOKENS = 16000;
const DEADLINE_MS = 5 * 60 * 1000; // Apps Script kills at 6 min.
const READ_GRID_MAX_CELLS = 800;
const WRITE_MAX_CELLS = 60;
const PRICE = { input: 2.5, cached: 0.25, output: 15 }; // USD per 1M tokens

function runAgent({ prompt, spreadsheetId }) {
  if (!String(prompt || '').trim())
    throw new Error('A task prompt is required.');
  if (!spreadsheetId) throw new Error('A target spreadsheetId is required.');
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const started = Date.now();
  const state = { ss, touched: {}, baseErrors: errorCells_(ss) };
  const trace = {
    model: MODEL,
    effort: REASONING_EFFORT,
    turns: [],
    calls: [],
    touched: state.touched,
    cost_usd: 0,
    stopped_by: 'done',
  };
  const instructions = SYSTEM_PROMPT + '\n\nWorkbook sheets:\n' + overview_(ss);
  let input = [{ role: 'user', content: prompt }];
  let previousId = null;

  try {
    while (true) {
      if (Date.now() - started > DEADLINE_MS) {
        trace.stopped_by = 'deadline';
        break;
      }
      const t0 = Date.now();
      const res = openai_({
        model: MODEL,
        reasoning: { effort: REASONING_EFFORT },
        instructions,
        tools: TOOLS,
        input,
        previous_response_id: previousId,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: true,
      });
      previousId = res.id;
      const u = res.usage || {};
      const cached = (u.input_tokens_details || {}).cached_tokens || 0;
      trace.cost_usd +=
        ((u.input_tokens - cached) * PRICE.input +
          cached * PRICE.cached +
          u.output_tokens * PRICE.output) /
        1e6;
      trace.turns.push({
        ms: Date.now() - t0,
        status: res.status,
        in: u.input_tokens,
        cached,
        out: u.output_tokens,
        reasoning: (u.output_tokens_details || {}).reasoning_tokens,
      });
      const calls = res.output.filter((o) => o.type === 'function_call');
      if (res.status === 'incomplete' && !calls.length) {
        input = [
          {
            role: 'user',
            content:
              'Your reply was cut off. Use fill_formula or smaller batches and continue.',
          },
        ];
        continue;
      }
      if (!calls.length) {
        trace.final = textOf_(res);
        break;
      }
      input = calls.map((call) => {
        const args = JSON.parse(call.arguments || '{}');
        const c0 = Date.now();
        let output;
        try {
          output = runTool_(state, call.name, args);
        } catch (e) {
          output = 'Error: ' + String(e.message || e);
        }
        trace.calls.push({
          name: call.name,
          args: call.name === 'read_range' ? args : summarizeArgs_(args),
          ms: Date.now() - c0,
          error: typeof output === 'string' && output.startsWith('Error:'),
        });
        return {
          type: 'function_call_output',
          call_id: call.call_id,
          output: typeof output === 'string' ? output : JSON.stringify(output),
        };
      });
    }
  } catch (e) {
    trace.stopped_by = 'error';
    trace.error = String(e.stack || e);
  }
  SpreadsheetApp.flush();
  trace.new_errors = newErrors_(state);
  trace.elapsed_ms = Date.now() - started;
  return trace;
}

// ---- tools ----

function runTool_(state, name, a) {
  const ss = state.ss;
  if (name === 'run_apps_script') {
    (a.touches || []).forEach((t) => touch_(state, t));
    return { result: new Function('ss', a.code)(ss) };
  }
  const sheet = ss.getSheetByName(a.sheet);
  if (!sheet) throw new Error('Unknown sheet: ' + a.sheet);
  if (name === 'read_range') return readGrid_(sheet, a.range);
  if (name === 'write_cells') {
    if (a.cells.length > WRITE_MAX_CELLS)
      throw new Error(
        `Too many cells (${a.cells.length} > ${WRITE_MAX_CELLS}); use fill_formula for blocks.`,
      );
    const skipped = [];
    const written = [];
    for (const c of a.cells) {
      const r = sheet.getRange(c.a1);
      if (!a.overwrite && !isBlank_(r)) {
        skipped.push(c.a1);
        continue;
      }
      r.setValue(c.content); // USER_ENTERED semantics: '=' → formula, '5%' → number
      touch_(state, sheet.getName() + '!' + c.a1);
      written.push(c.a1);
    }
    return afterWrite_(state, sheet, written, skipped);
  }
  if (name === 'fill_formula') {
    const range = sheet.getRange(a.range);
    const skipped = [];
    if (!a.overwrite) {
      const vals = range.getValues();
      vals.forEach((row, i) =>
        row.forEach((v, j) => {
          if (v !== '')
            skipped.push(range.getCell(i + 1, j + 1).getA1Notation());
        }),
      );
      if (skipped.length)
        return {
          skipped,
          note: 'Nothing written: range has existing content. Pass overwrite=true or split the range.',
        };
    }
    const anchor = range.getCell(1, 1);
    anchor.setFormula(a.formula);
    if (range.getNumRows() * range.getNumColumns() > 1)
      anchor.copyTo(range, { contentsOnly: true });
    touch_(state, sheet.getName() + '!' + range.getA1Notation());
    return afterWrite_(state, sheet, sampleAddrs_(range), []);
  }
  if (name === 'set_number_format') {
    sheet.getRange(a.range).setNumberFormat(a.format);
    touch_(state, sheet.getName() + '!' + a.range);
    return { ok: true };
  }
  throw new Error('Unknown tool: ' + name);
}

function afterWrite_(state, sheet, addrs, skipped) {
  SpreadsheetApp.flush();
  const values = addrs.map((a1) => [
    a1,
    cellValue_(sheet.getRange(a1).getValue()),
  ]);
  return { values, skipped, new_errors: newErrors_(state) };
}

/** TSV grid with row/col headers; formula shown where present, else value. */
function readGrid_(sheet, a1) {
  let range = sheet.getRange(a1);
  const totalRows = range.getNumRows();
  const totalCols = range.getNumColumns();
  let note = '';
  if (totalRows * totalCols > READ_GRID_MAX_CELLS) {
    const rows = Math.max(1, Math.floor(READ_GRID_MAX_CELLS / totalCols));
    range = sheet.getRange(range.getRow(), range.getColumn(), rows, totalCols);
    note = `\n[truncated: requested ${a1} has ${totalRows} rows x ${totalCols} cols; showing rows ${range.getRow()}-${range.getLastRow()}. Request a narrower range for the rest.]`;
  }
  const formulas = range.getFormulas();
  const values = range.getValues();
  const c0 = range.getColumn();
  const header = [''].concat(values[0].map((_, j) => columnLetter_(c0 + j)));
  const lines = [header.join('\t')];
  values.forEach((row, i) =>
    lines.push(
      [range.getRow() + i]
        .concat(
          row.map((v, j) =>
            formulas[i][j]
              ? formulas[i][j]
              : String(cellValue_(v) == null ? '' : cellValue_(v)),
          ),
        )
        .join('\t'),
    ),
  );
  return lines.join('\n') + note;
}

// ---- workbook helpers ----

function overview_(ss) {
  return ss
    .getSheets()
    .map(
      (s) =>
        `- "${s.getName()}": used range A1:${columnLetter_(s.getLastColumn())}${s.getLastRow()}`,
    )
    .join('\n');
}

/** Set of "Sheet!A1" for every cell currently showing an error. */
function errorCells_(ss) {
  const out = new Set();
  ss.getSheets().forEach((s) => {
    if (s.getLastRow() === 0) return;
    const vals = s.getDataRange().getDisplayValues();
    vals.forEach((row, i) =>
      row.forEach((v, j) => {
        if (v.startsWith('#'))
          out.add(`${s.getName()}!${columnLetter_(j + 1)}${i + 1}`);
      }),
    );
  });
  return out;
}

function newErrors_(state) {
  return [...errorCells_(state.ss)].filter((k) => !state.baseErrors.has(k));
}

function touch_(state, ref) {
  const [sheet, a1] = ref.split('!');
  if (!state.touched[sheet]) state.touched[sheet] = [];
  state.touched[sheet].push(a1);
}

function isBlank_(range) {
  return range.getValues().every((row) => row.every((v) => v === ''));
}

function sampleAddrs_(range) {
  const rows = range.getNumRows();
  const cols = range.getNumColumns();
  const picks = new Set([
    range.getCell(1, 1),
    range.getCell(1, cols),
    range.getCell(rows, 1),
    range.getCell(rows, cols),
  ]);
  return [...picks]
    .map((c) => c.getA1Notation())
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

function cellValue_(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

function columnLetter_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function summarizeArgs_(args) {
  const a = { ...args };
  if (a.cells)
    a.cells = `${a.cells.length} cells: ${a.cells
      .slice(0, 3)
      .map((c) => c.a1)
      .join(',')}…`;
  if (a.code) a.code = a.code.slice(0, 400);
  return a;
}

function textOf_(res) {
  return (res.output || [])
    .flatMap((o) => o.content || [])
    .map((c) => c.text || '')
    .join('');
}

// ---- OpenAI ----

function openai_(body) {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_KEY');
  if (!key) throw new Error('OPENAI_KEY script property is missing.');
  const opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  for (let attempt = 0; ; attempt++) {
    let res, code;
    try {
      res = UrlFetchApp.fetch('https://api.openai.com/v1/responses', opts);
      code = res.getResponseCode();
    } catch (e) {
      if (attempt) throw e;
      continue; // one retry on transport failure
    }
    if (code === 200) return JSON.parse(res.getContentText());
    if (attempt === 0 && (code === 429 || code >= 500)) {
      Utilities.sleep(2000);
      continue;
    }
    throw new Error(
      'OpenAI HTTP ' + code + ': ' + res.getContentText().slice(0, 500),
    );
  }
}

/** Editor-only: run against a --keep-sheets copy without the bench. */
function dev() {
  const p = PropertiesService.getScriptProperties();
  const out = runAgent({
    prompt: p.getProperty('DEV_PROMPT'),
    spreadsheetId: p.getProperty('DEV_SHEET_ID'),
  });
  console.log(JSON.stringify(out, null, 2));
}
