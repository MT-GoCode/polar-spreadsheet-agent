/** Truth script for task 06 (Annual cohorts). Harness ceiling test only; never deployed with the agent. */
function runAgent({ prompt, spreadsheetId }) {
  const s = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Annual Cohorts');
  // Cohort Revenue: sum the monthly-basis row (21 rows up) over columns whose row-8 year bucket equals this column's key in row 29.
  s.getRange('G31:T44').setFormulaR1C1('=SUMIF(R8C7:R8C170,R29C,R[-21]C7:R[-21]C170)');
  // Revenue per Account: cohort revenue (19 rows up) / account count in column E; "-" where division fails.
  s.getRange('G50:T63').setFormulaR1C1('=IFERROR(R[-19]C/RC5,"-")');
  SpreadsheetApp.flush();
  return { truth: 'task_06', touched: ['Annual Cohorts!G31:T44', 'Annual Cohorts!G50:T63'] };
}
