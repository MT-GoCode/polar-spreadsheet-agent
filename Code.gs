/**
 * Candidate entry point. Called inside Apps Script with a fresh task workbook.
 * Read the prompt, inspect the workbook, and apply edits before returning.
 * The return value is diagnostics; the grader scores the resulting workbook.
 */
function runAgent({ prompt, spreadsheetId }) {
  if (!String(prompt || '').trim())
    throw new Error('A task prompt is required.');
  if (!spreadsheetId) throw new Error('A target spreadsheetId is required.');
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);

  // TODO: implement your model/tool loop here. Use spreadsheet, not getActive().
  // For credentials, use Apps Script Script Properties (see README.md).
  return {
    mode: 'noop',
    message:
      'Starter connected. Implement runAgent in Code.gs to edit this workbook.',
    sheets: spreadsheet.getSheets().map((sheet) => sheet.getName()),
  };
}
