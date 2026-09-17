# Spreadsheet agent assessment

Build an agent that takes a natural-language instruction and edits a real Google Sheets workbook. Start in **[Code.gs](Code.gs)**. The starter deliberately makes no edits.

## Setup

You need **Node.js 22.12+**, **Python 3.10+**, and a Google account with Apps Script access.

```sh
npm run setup
```

Setup installs dependencies, guides you through Google sign-in and permissions, creates your Apps Script project, imports the 15 workbooks and verifies a real formula calculation. Follow the terminal instructions. Rerun the same command if interrupted; it preserves your code and reuses completed steps. No model key is needed for setup.

## Implement

```js
function runAgent({ prompt, spreadsheetId }) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  // Inspect the workbook, call your model, apply edits, and verify the result.
  return { message: 'Finished' }; // Optional diagnostics.
}
```

Choose your own tools, context representation, planning and validation. Use Apps Script directly or build JavaScript wrappers. Add `.gs` files if needed; the benchmark deploys your changes automatically. Always open the supplied workbook ID: each task gets a fresh copy.

For credentials, run `npm run open:script`, open **Project Settings → Script Properties**, and add your model key (for example, `OPENAI_API_KEY`). Read it with `PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY')` and call your provider using `UrlFetchApp.fetch`. A local `.env` is not automatically available inside Apps Script. Never log or commit credentials.

The function runs inside Apps Script and must apply its edits before returning. Google's execution limits and service quotas apply. Returning a plan without modifying the workbook does not solve the task.

## Run and iterate

```sh
npm run bench -- 03          # one task
npm run bench -- 01 03 06    # a subset
npm run bench               # all 15
npm run bench -- --failed    # previous failures, on fresh copies
npm run bench -- --list      # task numbers and names
```

Tasks are numbered **01–15**; see [the task list](benchmarks/README.md). Runs deploy changed code automatically, print each task’s progress and results as it finishes, and show representative mismatches (and workbook links with `--keep-sheets`). `--failed` selects failures from the most recent run; it never reuses edited workbooks. Generated files go in the ignored `grading-results/` directory. Inspect `response.json` for agent diagnostics and `grade.json` for mismatches and preservation violations. Rerun relevant tasks after edits, then the whole set.

Run workbooks are moved to Google Drive trash after grading; local exports, diagnostics and reports remain available. Add `--keep-sheets` to retain live workbooks for debugging. Unused prepared copies stay available until run. After an interrupted run, or to remove retained/unused copies, use `npm run bench -- --cleanup`; this clears generated copies in the assessment's Runs folder, including prepared copies, and preserves templates. Do not run cleanup while an agent is executing.

The unchanged starter should score **0/15** with no execution or preservation failures. Exit codes: **0** all passed; **1** tasks completed but some failed (expected for the starter); **2** infrastructure failed. Preparation, execution and grading overlap, so their reported timings should not be added together. Reference exports are cached; each run still uses fresh task copies and checks native Google Sheets state. Agent calls are concurrent; grader reads are batched and paced to respect Google quotas. Use `--concurrency 3` if your provider needs lower concurrency.

To move workbook preparation out of your next iteration, prepare a task or subset while you work:

```sh
npm run bench -- --prepare 01 03
# Edit Code.gs, then run the prepared copies with your latest code:
npm run bench -- --prepared latest
```

Each prepared copy can run only once. You can also append a task number to run just that unused copy. Normal runs handle preparation automatically.

The workbook is the submission. We check calculated outputs, requested formulas and formatting, and preservation of existing content. Use workbook labels, neighboring formulas and conventions to make reasonable assumptions. Do not hardcode task IDs, answers or benchmark-specific ranges into the agent. Reference workbooks and grader specs are present for local reproducibility; do not feed them or failed-cell lists into agent context. Leave the tasks and grader unchanged.

## Hand in

Submit your code, final full-suite report and a short explanation of the design, model/settings, experiments and remaining limitations. We evaluate the design and reproducibility alongside the score.

## Repository

- `Code.gs`: your agent; the only `.gs` file at the root.
- `appsscript.json`: Apps Script configuration.
- `benchmarks/`: the 15 prompts, starting workbooks and references.
- `scripts/`: setup, deployment and runner; `Runtime.gs` is the Google-side infrastructure.
- `grader/`: the scoring code used by the benchmark.

`npm run bench -- --help` lists preparation, concurrency and cache options. `npm run auth` renews an expired Google login. Connection state and credentials are ignored by Git; clone the committed repository rather than copying another person's local credentials.
