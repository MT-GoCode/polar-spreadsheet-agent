/** System prompt + tool schemas. Byte-stable across turns (prompt-cache prefix). */

const SYSTEM_PROMPT = `# Spreadsheet agent

## Overview
You are a formula-writing agent running inside Google Apps Script. One live Google Sheets workbook is
open; the first user message contains the task and a machine-generated WORKBOOK MAP (facts only:
formula groups in R1C1, row structure with holes, column composition, colors, validations, errors).
You are graded on the workbook's final state. Preservation is strict: changing ANY cell, format, or
object outside what the task requires fails the whole task. Budget ~5 minutes. Work in ATTEMPTS: a
failed attempt is reverted; the final sheet is the original plus your winning writes only.

## Workflow
1. Read the map. Peek every range you will write or reference (peek/find/trace/diff are instant).
2. Call set_new_plan: your targets (range + kind + intent) AND assertions — your pass/fail checks,
   declared BEFORE writing (e.g. a balance row equals 0). A plan with no equals-assertion is stamped WEAK.
3. Write with the typed tools. Every write returns computed values with row labels and any errors in
   the written range — read them. Writes outside your declared targets are refused with the reason.
4. submit runs the mechanical verifier (footprint vs plan, kinds, formats, validations, new errors
   anywhere, structure, your assertions). Clean report = done.
5. On FAIL: inspect with diff/peek. Small in-target slip: fix and resubmit. Wrong understanding:
   set_new_plan — the workbook auto-reverts to pristine and a fresh attempt begins.
Batch independent tool calls into one turn (multiple peeks; plan+writes; writes+submit) — turns are
the time cost, not tools.

## Spreadsheet rules
- Output cells get LIVE FORMULAS unless the task says to type/store/hardcode a number — then a
  literal (0.0338), never a formula like =3.38%.
- HARD RULE: when the task explicitly forbids or mandates a pattern ("do not add a cutoff",
  "carry as a positive amount", "grow monthly"), that instruction is law — a formula containing a
  forbidden pattern is WRONG even if it looks professionally cautious. Re-read the task before
  designing formulas; quote each such constraint in the matching target's prompt_quote field.
- Match the workbook's own conventions: clone the R1C1 pattern of the row above / column to the left,
  re-anchored. But conventions STATED IN THE TASK outrank neighbors.
- A clean write proves the formula evaluates, not that it's right: anchor one row, check its computed
  values against the labels, then fill the rest.
- "-" (text), 0, blank, and #N/A are four different answers. Match what the task/conventions require.
- Number formats come from the TASK's words, not from neighbors. Change formats only when asked.
- Existing data validations / conditional formats that already satisfy the ask: KEEP them, never
  rebuild equivalents.
- Never touch cells outside your targets. No new sheets, rows, columns, renames, or sorting.

## Tips
- Write formulas INTO CELLS. Never compute results in script and paste numbers unless the task
  demands literals. Do not simulate the workbook in JavaScript — the sheet is the calculator.
- No VBA. No prose plans in place of tool calls.
- Do bps/percent arithmetic yourself and write the literal (e.g. +48.61bps on 4.5% → 0.049861).
- Don't re-verify what a delta already told you; don't re-read unchanged ranges.
- If a tool refuses, the refusal names the legal next action. Follow it.`;

function toolDef_(name, desc, props, req) {
  return {
    type: 'function',
    name: name,
    description: desc,
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: props,
      required: req,
    },
  };
}
const S_ = { type: 'string' };
const TOOLS = [
  toolDef_(
    'peek',
    'Zoom into a range: grid with row numbers/column letters, formulas deduped to an R1C1 legend, values, verbatim header rows and label columns attached as context. Modes: default | fontColor | numberFormat (1-char census grids) | r1c1. Served from the run-start snapshot plus your writes. Cap 400 cells.',
    {
      sheet: S_,
      range: S_,
      mode: {
        type: 'string',
        enum: ['default', 'fontColor', 'numberFormat', 'r1c1'],
      },
    },
    ['sheet', 'range', 'mode'],
  ),
  toolDef_(
    'find',
    'Literal case-insensitive text search across all sheets. Returns address, formula-or-value, row label, column header. Cap 40.',
    { text: S_ },
    ['text'],
  ),
  toolDef_(
    'trace',
    'One cell: its formula (A1+R1C1) and value, plus 1-hop precedents with address, value, label.',
    { sheet: S_, cell: S_ },
    ['sheet', 'cell'],
  ),
  toolDef_(
    'diff',
    'Everything changed since run start (entered content: formulas, and values where no formula), compressed into uniform groups. Your footprint; the autopsy tool after a failed attempt.',
    {},
    [],
  ),
  toolDef_(
    'set_new_plan',
    'Declare your contract before writing: targets (what you will change and what kind) and assertions (your pass/fail checks, e.g. a balance row equals 0). If a failed attempt is open, setting a new plan REVERTS the workbook to pristine first. targets_json: [{"range":"Sheet!A1:B2","kind":"formula|value|clear|format","intent":"...","prompt_quote":"verbatim task words this target obeys (required when the task states a convention)"}]. assertions_json: [{"range":"Sheet!H134:L134","check":"equals|nonblank|blank|no_error|format","value":0,"tol":1e-6,"decimals":1,"percent":false}] (value/tol for equals; decimals/percent for format).',
    { targets_json: S_, assertions_json: S_, rationale: S_ },
    ['targets_json', 'assertions_json', 'rationale'],
  ),
  toolDef_(
    'fill',
    'Write one R1C1 formula to every cell of a range (drag-fill semantics; relative refs shift). The workhorse for pattern blocks. Range must be inside a declared formula-kind target.',
    { sheet: S_, range: S_, formula_r1c1: S_ },
    ['sheet', 'range', 'formula_r1c1'],
  ),
  toolDef_(
    'write_cells',
    'Batched individual cells. cells_json: [{"a1":"D7","content":"=..."}] — "=" prefix writes a formula, anything else a literal, "" clears the cell. All cells must be inside declared targets.',
    { sheet: S_, cells_json: S_ },
    ['sheet', 'cells_json'],
  ),
  toolDef_(
    'clear_contents',
    'Clear cell contents (formats untouched) in ranges declared as clear-kind targets. Returns cleared count and survivors-by-font-color census.',
    { sheet: S_, ranges_json: S_ },
    ['sheet', 'ranges_json'],
  ),
  toolDef_(
    'set_number_format',
    'Apply a number format (e.g. "0.0", "0.0%", "#,##0.0") to a range declared as a format-kind target.',
    { sheet: S_, range: S_, format: S_ },
    ['sheet', 'range', 'format'],
  ),
  toolDef_(
    'set_data_validation',
    'Dropdown from a source range, on a cell inside a format-kind target.',
    { sheet: S_, a1: S_, source_range: S_ },
    ['sheet', 'a1', 'source_range'],
  ),
  toolDef_(
    'set_conditional_format',
    'Add an expression-type conditional format rule (custom formula + font color) on a range inside a format-kind target. Response echoes the sheet rule list.',
    { sheet: S_, range: S_, custom_formula: S_, font_color: S_ },
    ['sheet', 'range', 'custom_formula', 'font_color'],
  ),
  toolDef_(
    'run_apps_script',
    'LAST RESORT for operations the typed tools cannot express. Runs JavaScript with `ss` (Spreadsheet) in scope. Structural APIs are refused. touches_json: ranges you will modify (must be inside declared targets). Followed by an immediate footprint diff.',
    { code: S_, touches_json: S_ },
    ['code', 'touches_json'],
  ),
  toolDef_(
    'revert',
    'Abandon the current attempt NOW: restore the workbook to its run-start state. Use after autopsy of a failed attempt, before or instead of set_new_plan.',
    {},
    [],
  ),
  toolDef_(
    'submit',
    'Run the full mechanical verifier. Clean report ends the task. Refused when nothing has been written.',
    {},
    [],
  ),
];
