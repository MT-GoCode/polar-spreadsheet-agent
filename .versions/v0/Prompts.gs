/** Prompt and tool schemas. Keep byte-stable across turns: they are the cached prefix. */
const SYSTEM_PROMPT = `You are a financial-modeling analyst completing a task in an existing Google Sheets workbook.

The workbook is a finished model with conventions already established. Your job is to make exactly the change the task describes and nothing else.

Constraints:
- Only modify cells the task asks for. Do not change any other cell's content or formatting, do not add/remove/rename sheets, rows or columns. Preservation is checked strictly; a single stray edit fails the task.
- Output cells should hold live formulas unless the task says to hardcode. Match neighboring conventions: reference the same driver rows, same sign convention, same cross-sheet style.
- Before writing, read the target block and its neighbors (labels, the row above/below, the historical columns, the driver rows) so you know the exact addresses and the pattern to follow.
- Use A1 notation. Cross-sheet references need the sheet name, quoted if it has spaces: ='Sheet Name'!B4.
- fill_formula is the way to fill a block: write the formula for the top-left cell with correct $-anchors and it is copied across the range with relative references shifted.
- Writes skip cells that already have content unless you pass overwrite=true. Read what is there first.
- Every write returns computed values and a list of error cells (yours and any elsewhere in the workbook). Fix all of them before finishing.
- run_apps_script is only for what the other tools cannot do (data validation, conditional formatting, borders, clearing). Touch only the cells the task names.
- Number formats: only change them when the task asks. Target cells are usually already formatted.

When the task is complete and no errors remain, reply with a brief summary and no tool calls.`;

const TOOLS = [
  {
    type: 'function',
    name: 'read_range',
    description:
      'Read a range. Returns a TSV grid (row numbers and column letters as headers) with each cell shown as its formula if it has one, else its value. Blank cells are empty. Large ranges are truncated with a notice; ask for a smaller range.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sheet: { type: 'string' },
        range: { type: 'string', description: 'A1 range, e.g. A1:L40' },
      },
      required: ['sheet', 'range'],
    },
  },
  {
    type: 'function',
    name: 'write_cells',
    description:
      'Write up to 60 individual cells. content is a formula (starts with =) or a literal typed as a user would. Use "" to clear. Returns computed values and error cells.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sheet: { type: 'string' },
        cells: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              a1: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['a1', 'content'],
          },
        },
        overwrite: {
          type: 'boolean',
          description: 'Replace cells that already have content.',
        },
      },
      required: ['sheet', 'cells', 'overwrite'],
    },
  },
  {
    type: 'function',
    name: 'fill_formula',
    description:
      'Write one formula to the top-left cell of range and copy it to the whole range with relative references shifted (like drag-fill). Returns sample computed values and error cells.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sheet: { type: 'string' },
        range: { type: 'string', description: 'Target block, e.g. H104:L104' },
        formula: {
          type: 'string',
          description: 'Formula as it should read in the top-left cell',
        },
        overwrite: { type: 'boolean' },
      },
      required: ['sheet', 'range', 'formula', 'overwrite'],
    },
  },
  {
    type: 'function',
    name: 'set_number_format',
    description:
      'Apply a number format (e.g. "0.0", "0.0%", "#,##0") to a range.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sheet: { type: 'string' },
        range: { type: 'string' },
        format: { type: 'string' },
      },
      required: ['sheet', 'range', 'format'],
    },
  },
  {
    type: 'function',
    name: 'run_apps_script',
    description:
      'Escape hatch: run JavaScript in Google Apps Script with `ss` (the Spreadsheet) in scope. Use only for what other tools cannot do. Return a value with `return`. Returns the result or the error.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string' },
        touches: {
          type: 'array',
          description:
            'Ranges this code modifies, as "Sheet!A1:B2", for the audit log.',
          items: { type: 'string' },
        },
      },
      required: ['code', 'touches'],
    },
  },
];
