import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { graderPython } from './setup-support.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createFile, drive, exportXlsx } from './google-api.mjs';
import {
  ensureDeployment,
  dispatch,
  captureNativeSnapshot,
} from './google-dispatch.mjs';

async function main() {
  const started = Date.now();
  const root = fileURLToPath(new URL('..', import.meta.url));
  const json = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
  const save = async (p, data) => {
    const temp = `${p}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n');
    await fs.rename(temp, p);
  };
  const available = (
    await fs.readdir(path.join(root, 'benchmarks/grading_specs'))
  )
    .filter((name) => /^task_\d{2}\.json$/.test(name))
    .map((name) => name.slice(0, -5))
    .sort();
  const options = parseOptions(process.argv.slice(2), available);
  if (options.help || options.list) {
    console.log(
      options.list
        ? (
            await Promise.all(
              available.map(
                async (id) =>
                  `${id.slice(5)}  ${(await json(path.join(root, 'benchmarks/grading_specs', `${id}.json`))).title}`,
              ),
            )
          ).join('\n')
        : `Real Google Sheets benchmark
  npm run bench                           Run all 15 concurrently
  npm run bench -- 02                     Run one task
  npm run bench -- 01 03 06               Run a subset
  npm run bench -- --tasks 01,03,06       Equivalent subset
  npm run bench -- --failed               Retry previous failures on fresh copies
  npm run bench -- --concurrency 5        Limit concurrent task executions
  npm run bench -- --prepare              Prepare fresh workbooks ahead of time
  npm run bench -- --prepared latest      Execute the prepared workbooks once
  npm run bench -- --prepared latest 02   Execute one unused prepared task
  npm run bench -- --list                 List task numbers and names
  npm run bench -- --keep-sheets          Keep run workbooks for debugging
  npm run bench -- --cleanup              Trash all generated run copies (including prepared)
  npm run bench -- --refresh-cache        Refresh reference exports

--timeout SECONDS limits each HTTP request (default 360). A timeout never retries
an agent automatically. Prepared task copies can be consumed only once.`,
    );
    process.exit(0);
  }
  const runs = path.join(root, 'grading-results/google-runs');
  let previous;
  if (options.failed) {
    try {
      previous = await json(
        (await json(path.join(runs, 'latest.json'))).report,
      );
      if (!Array.isArray(previous.tasks)) throw new Error('Invalid report');
    } catch {
      throw new Error('No readable previous run. Run npm run bench first.');
    }
    options.tasks = [
      ...new Set(
        previous.tasks
          .filter((task) => task.passed !== true)
          .map((task) => task.task_id),
      ),
    ];
    if (!options.tasks.length) {
      console.log('No failed tasks in the previous run.');
      return;
    }
    if (options.tasks.some((id) => !available.includes(id)))
      throw new Error('The task catalog changed; select tasks explicitly.');
  }
  const config = await json(path.join(root, '.benchmark-google.json')).catch(
    () => {
      throw new Error('Run npm run setup first.');
    },
  );
  if (options.cleanup) {
    let pageToken;
    const files = [];
    do {
      const page = await drive(
        'files?' +
          new URLSearchParams({
            q: `'${config.runsFolderId}' in parents and trashed = false`,
            fields: 'nextPageToken,files(id,name,mimeType)',
            pageSize: '1000',
            ...(pageToken ? { pageToken } : {}),
          }),
      );
      files.push(...page.files.filter(isRunCopy));
      pageToken = page.nextPageToken;
    } while (pageToken);
    await mapLimit(files, 5, (file) => trashRunCopy(config, file.id));
    console.log(
      `Moved ${files.length} generated run workbooks to trash. Templates are unchanged.`,
    );
    return;
  }
  const python = graderPython(root);
  await fs.mkdir(runs, { recursive: true });
  let runDir,
    manifest,
    selected = options.tasks;
  if (options.prepared) {
    runDir =
      options.prepared === 'latest'
        ? (await json(path.join(runs, 'prepared-latest.json'))).directory
        : path.resolve(root, options.prepared);
    manifest = await json(path.join(runDir, 'prepared.json'));
    if (!selected.length)
      selected = Object.keys(manifest.jobs).filter(
        (t) => !existsSync(path.join(runDir, t, 'consumed.json')),
      );
    if (!selected.length)
      throw new Error(
        'No unused prepared tasks remain. Run npm run bench -- --prepare again.',
      );
    for (const id of selected) {
      if (!manifest.jobs[id])
        throw new Error(`${id} is not in this prepared batch`);
      if (existsSync(path.join(runDir, id, 'consumed.json')))
        throw new Error(`${id} was already consumed. Prepare a fresh copy.`);
    }
  } else {
    selected = selected.length ? selected : available;
    const runId =
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      crypto.randomUUID().slice(0, 8);
    runDir = path.join(runs, runId);
    await fs.mkdir(runDir);
    manifest = {
      run_id: runId,
      created_at: new Date().toISOString(),
      jobs: {},
      sourceIdentity: {},
    };
  }
  for (const tid of selected) {
    const identity = {};
    for (const kind of ['init', 'golden']) {
      const hash = crypto
        .createHash('sha256')
        .update(
          await fs.readFile(
            path.join(root, 'benchmarks/tasks', tid, `${kind}.xlsx`),
          ),
        )
        .digest('hex');
      if (hash !== config.templates[tid]?.[kind]?.sourceHash)
        throw new Error(`${tid} ${kind} changed; run npm run setup`);
      identity[kind] = { hash, id: config.templates[tid][kind].id };
    }
    identity.settings = config.templateSettingsDigest;
    for (const [key, filename] of [
      ['prompt', `tasks/${tid}/prompt.txt`],
      ['spec', `grading_specs/${tid}.json`],
    ])
      identity[key] = crypto
        .createHash('sha256')
        .update(await fs.readFile(path.join(root, 'benchmarks', filename)))
        .digest('hex');
    if (
      options.prepared &&
      JSON.stringify(identity) !== JSON.stringify(manifest.sourceIdentity[tid])
    )
      throw new Error(`${tid} prepared inputs are stale; prepare again`);
    if (
      previous &&
      JSON.stringify(previous.source_identity?.[tid]) !==
        JSON.stringify(identity)
    )
      throw new Error(
        `${tid} changed since the previous run; select current tasks explicitly.`,
      );
    manifest.sourceIdentity[tid] = identity;
  }
  const specs = Object.fromEntries(
    await Promise.all(
      selected.map(async (tid) => [
        tid,
        await json(path.join(root, 'benchmarks/grading_specs', `${tid}.json`)),
      ]),
    ),
  );
  // File size is a cheap estimate of work; start large tasks before small ones.
  const sizes = await Promise.all(
    selected.map(async (id) => ({
      id,
      size: (
        await fs.stat(path.join(root, 'benchmarks/tasks', id, 'init.xlsx'))
      ).size,
    })),
  );
  const scheduled = sizes.sort((a, b) => b.size - a.size).map(({ id }) => id);
  const stages = new Map();
  let lastProgress = Date.now();
  const status = (tid, stage, detail = '') => {
    stages.set(tid, stage);
    lastProgress = Date.now();
    console.log(
      `${tid.slice(5)} ${stage.padEnd(10)} ${specs[tid].title}${detail ? ' · ' + detail : ''}`,
    );
  };
  const deployment = await ensureDeployment(root, config);
  const setupMs = Date.now() - started;
  console.log(
    `${selected.length} task(s), concurrency ${Math.min(options.concurrency, selected.length)}, immediate Google execution\nRun: ${runDir}`,
  );
  const heartbeat = setInterval(() => {
    if (Date.now() - lastProgress < 20000) return;
    const waiting = [...stages].filter(
      ([, stage]) => !['PASS', 'FAIL', 'ERROR'].includes(stage),
    );
    if (!waiting.length) return;
    const names = waiting
      .slice(0, 5)
      .map(([id, stage]) => `${id.slice(5)} ${stage.toLowerCase()}`)
      .join(', ');
    console.log(
      `Waiting (${Math.round((Date.now() - started) / 1000)}s elapsed): ${names}${waiting.length > 5 ? ` +${waiting.length - 5} more` : ''}`,
    );
    lastProgress = Date.now();
  }, 10000);
  heartbeat.unref();
  const cacheStats = { hit: 0, miss: 0 };
  const preparationStart = Date.now();
  let preparationFinished = preparationStart;
  const prepareTask = async (tid) => {
    const dir = path.join(runDir, tid);
    await fs.mkdir(dir);
    const taskStart = Date.now();
    status(tid, 'PREPARING');
    let copy;
    try {
      let creationMethod = 'native_copy';
      try {
        copy = await drive(
          `files/${config.templates[tid].init.id}/copy?fields=id`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${manifest.run_id} ${tid}`,
              parents: [config.runsFolderId],
            }),
          },
        );
      } catch (error) {
        if (!error.message.includes('Google API 404')) throw error;
        await drive(`files/${config.templates[tid].init.id}?fields=id`);
        copy = await createFile(
          {
            name: `${manifest.run_id} ${tid}`,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            parents: [config.runsFolderId],
          },
          await fs.readFile(
            path.join(root, 'benchmarks/tasks', tid, 'init.xlsx'),
          ),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        creationMethod = 'native_reimport_after_copy_404';
      }
      const spec = specs[tid];
      const job = {
        jobId: `${manifest.run_id}-${tid}`,
        taskId: tid,
        spreadsheetId: copy.id,
        creationMethod,
        initialTemplateId: config.templates[tid].init.id,
        goldenSpreadsheetId: config.templates[tid].golden.id,
        outputRanges: spec.outputs,
        prompt: await fs.readFile(
          path.join(root, 'benchmarks/tasks', tid, 'prompt.txt'),
          'utf8',
        ),
      };
      await save(path.join(dir, 'request.json'), job);
      const prepared = await dispatch(
        config,
        { action: 'prepare', job },
        options.timeout,
      );
      if (prepared.status !== 'prepared' || prepared.spreadsheetId !== copy.id)
        throw new Error(`${tid}: invalid preparation response`);
      await save(path.join(dir, 'preparation.json'), prepared);
      // Both exports are independent; wait for both even if one fails.
      const exports = await Promise.allSettled([
        exportXlsx(copy.id, path.join(dir, 'initial.xlsx')),
        cachedExport({
          id: job.goldenSpreadsheetId,
          identity: {
            sourceHash: config.templates[tid].golden.sourceHash,
            settings: config.templateSettingsDigest,
          },
          directory: path.join(root, 'grading-results/google-cache'),
          target: path.join(dir, 'golden.xlsx'),
          metadata: (id) => drive(`files/${id}?fields=version`),
          exportFile: exportXlsx,
          refresh: options.refreshCache,
        }),
      ]);
      const failure = exports.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
      const cache = exports[1].value;
      cacheStats[cache]++;
      job.preparation_ms = Date.now() - taskStart;
      manifest.jobs[tid] = job;
      status(tid, 'READY', `${(job.preparation_ms / 1000).toFixed(1)}s`);
    } catch (error) {
      manifest.preparation_errors ||= {};
      manifest.preparation_errors[tid] = error.message;
      status(tid, 'ERROR', `preparation: ${short(error.message)}`);
      if (copy?.id && !options.keepSheets) {
        try {
          await trashRunCopy(config, copy.id);
        } catch (cleanupError) {
          console.error(
            `Cleanup failed: ${short(cleanupError.message)}. Run npm run bench -- --cleanup.`,
          );
        }
      }
    }
    preparationFinished = Math.max(preparationFinished, Date.now());
  };
  const persistPreparation = async () => {
    if (options.prepared) return;
    manifest.preparation_ms = preparationFinished - preparationStart;
    await save(path.join(runDir, 'prepared.json'), manifest);
    await save(path.join(runs, 'prepared-latest.json'), { directory: runDir });
  };
  if (options.prepare) {
    await mapLimit(scheduled, Math.min(options.concurrency, 5), prepareTask);
    await persistPreparation();
    console.log(
      `Prepared ${Object.keys(manifest.jobs).length}/${selected.length} tasks. Run: npm run bench -- --prepared latest`,
    );
    clearInterval(heartbeat);
    process.exitCode = Object.keys(manifest.preparation_errors || {}).length
      ? 2
      : 0;
    return;
  }
  const grading = concurrencyLimit(3);
  let gradingStarted = 0,
    gradingFinished = 0,
    completed = 0;
  const gradeTask = async ({
    job,
    dir,
    response,
    request_ms,
    snapshots,
    cleanupAllowed,
  }) => {
    const start = Date.now();
    gradingStarted ||= start;
    status(job.taskId, 'GRADING');
    let result;
    try {
      if (response.status !== 'completed') throw new Error(response.error);
      await exportXlsx(job.spreadsheetId, path.join(dir, 'submission.xlsx'));
      const flags = [
        '-m',
        'grader.google_grade',
        '--task',
        job.taskId,
        '--initial',
        path.join(dir, 'initial.xlsx'),
        '--golden',
        path.join(dir, 'golden.xlsx'),
        '--submission',
        path.join(dir, 'submission.xlsx'),
        '--execution',
        path.join(dir, 'response.json'),
        '--native-initial',
        path.join(dir, 'native-initial.json'),
        '--native-final',
        path.join(dir, 'native-final.json'),
        '--out',
        path.join(dir, 'grade.json'),
      ];
      await new Promise((resolve, reject) => {
        const proc = spawn(python, flags, {
          cwd: root,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let diagnostic = '';
        proc.stderr.on('data', (chunk) => {
          diagnostic = (diagnostic + chunk).slice(-64000);
        });
        proc.on('error', reject);
        proc.on('exit', async (code) => {
          try {
            if (diagnostic)
              await fs.writeFile(path.join(dir, 'grader.log'), diagnostic);
          } catch (error) {
            reject(error);
            return;
          }
          code === 0
            ? resolve()
            : reject(
                new Error(
                  diagnostic.trim().split('\n').at(-1) ||
                    `Grader exited ${code}`,
                ),
              );
        });
      });
      result = await json(path.join(dir, 'grade.json'));
    } catch (error) {
      result = {
        task_id: job.taskId,
        score: 0,
        passed: false,
        provisional: false,
        execution: { status: 'failed', error: error.message },
      };
    }
    result.remote_execution = response;
    result.spreadsheet_url = job.spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${job.spreadsheetId}/edit`
      : null;
    result.snapshots = snapshots;
    result.timing = {
      preparation_ms: job.preparation_ms,
      request_ms,
      export_and_grade_ms: Date.now() - start,
      remote_ms: response.completedAt
        ? Date.parse(response.completedAt) - Date.parse(response.startedAt)
        : null,
    };
    await save(path.join(dir, 'grade.json'), result);
    if (!options.keepSheets && cleanupAllowed && job.spreadsheetId) {
      try {
        await trashRunCopy(config, job.spreadsheetId);
        result.workbook_trashed = true;
      } catch (error) {
        result.cleanup_error = error.message;
        console.error(
          `${job.taskId}: cleanup failed: ${short(error.message)}. Run npm run bench -- --cleanup after resolving it.`,
        );
      }
      await save(path.join(dir, 'grade.json'), result);
    }
    gradingFinished = Date.now();
    completed++;
    status(
      job.taskId,
      verdict(result),
      `${(result.score * 100).toFixed(1)}% outputs · ${completed}/${selected.length} done`,
    );
    printFailures(result);
    return result;
  };
  let executionStart = 0,
    executionFinished = 0;
  const runTask = async (tid) => {
    executionStart ||= Date.now();
    const job =
        manifest.jobs[tid] ||
        (await json(path.join(runDir, tid, 'request.json')).catch(() => ({
          taskId: tid,
        }))),
      dir = path.join(runDir, tid),
      requestStart = Date.now();
    let completedResponse, response;
    let cleanupAllowed = !options.prepared;
    const snapshots = {};
    try {
      if (manifest.preparation_errors?.[tid])
        throw new Error(manifest.preparation_errors[tid]);
      // The exclusive file claim survives errors and unknown execution outcomes.
      await fs.writeFile(
        path.join(dir, 'consumed.json'),
        JSON.stringify({
          claimed_at: new Date().toISOString(),
          pid: process.pid,
        }),
        { flag: 'wx' },
      );
      cleanupAllowed = true;
      status(tid, 'CHECKING', 'input snapshot');
      snapshots.initial = await captureNativeSnapshot(
        config,
        job.spreadsheetId,
        path.join(dir, 'native-initial.json'),
        options.timeout,
      );
      status(tid, 'RUNNING');
      response = await dispatch(
        config,
        { action: 'run', job },
        options.timeout,
      );
      if (
        response.status !== 'completed' ||
        response.jobId !== job.jobId ||
        response.spreadsheetId !== job.spreadsheetId ||
        response.engine !== 'google-apps-script' ||
        (response.calculation?.stableSamples || 0) < 3
      )
        throw new Error('Missing verified Google execution');
      completedResponse = response;
      status(tid, 'CHECKING', 'final snapshot');
      snapshots.final = await captureNativeSnapshot(
        config,
        job.spreadsheetId,
        path.join(dir, 'native-final.json'),
        options.timeout,
      );
      await save(path.join(dir, 'response.json'), response);
    } catch (error) {
      response = {
        ...completedResponse,
        ...error.remoteResponse,
        status: 'failed',
        error: error.message,
      };
      await save(path.join(dir, 'response.json'), response);
    }
    executionFinished = Math.max(executionFinished, Date.now());
    const request_ms = Date.now() - requestStart;
    return grading(() =>
      gradeTask({ job, dir, response, request_ms, snapshots, cleanupAllowed }),
    );
  };
  const preparing = concurrencyLimit(Math.min(options.concurrency, 5));
  const running = concurrencyLimit(options.concurrency);
  const results = await Promise.all(
    scheduled.map(async (tid) => {
      if (!options.prepared) await preparing(() => prepareTask(tid));
      return running(() => runTask(tid));
    }),
  );
  results.sort(
    (a, b) => selected.indexOf(a.task_id) - selected.indexOf(b.task_id),
  );
  clearInterval(heartbeat);
  await persistPreparation();
  const preparationMs = options.prepared
    ? 0
    : preparationFinished - preparationStart;
  const executionMs = executionFinished - executionStart;
  const summary = {
    score:
      (results.reduce((sum, r) => sum + r.score, 0) / selected.length) * 100,
    tasks_passed: results.filter((r) => r.passed).length,
    tasks_total: selected.length,
    tasks_completed: results.length,
    execution_failures: results.filter(
      (r) => r.execution.status !== 'completed',
    ).length,
    compatibility_failures: results.filter(
      (r) => r.compatibility && !r.compatibility.passed,
    ).length,
    cleanup_failures: results.filter((r) => r.cleanup_error).length,
    preservation_failures: results.filter(
      (r) => r.preservation && !r.preservation.passed,
    ).length,
  };
  const report = {
    run_id: manifest.run_id,
    engine: 'google-apps-script',
    transport: 'signed-http',
    deployment,
    selected_tasks: selected,
    source_identity: manifest.sourceIdentity,
    timing: {
      started_at: new Date(started).toISOString(),
      elapsed_ms: Date.now() - started,
      setup_ms: setupMs,
      preparation_ms: preparationMs,
      execution_ms: executionMs,
      grading_ms: gradingFinished - gradingStarted,
      phases_overlap: true,
      concurrency: options.concurrency,
      observed_peak_concurrency: peakOverlap(results),
    },
    reference_cache: cacheStats,
    summary,
    tasks: results,
  };
  const reportName = `report-${Date.now()}.json`;
  await save(path.join(runDir, reportName), report);
  await save(path.join(runDir, 'report.json'), report);
  await save(path.join(runs, 'latest.json'), {
    report: path.join(runDir, reportName),
    summary,
  });
  console.log('\nTASK  RESULT  OUTPUTS  PROTECTED EDITS  UNMET REQS');
  for (const task of results)
    console.log(
      `${task.task_id.slice(5).padEnd(6)}${verdict(task).padEnd(8)}${(task.score * 100).toFixed(1).padStart(5)}%   ${String(task.preservation?.violations.length ?? '—').padEnd(17)}${task.requirements?.filter((check) => !check.passed).length ?? '—'}`,
    );
  console.log(
    `\n${summary.tasks_passed}/${summary.tasks_total} passed in ${(report.timing.elapsed_ms / 1000).toFixed(1)}s · ${summary.execution_failures} execution errors · ${summary.compatibility_failures} conversion errors`,
  );
  console.log(
    `Preparation ${(preparationMs / 1000).toFixed(1)}s · execution window ${(executionMs / 1000).toFixed(1)}s · grading window ${(report.timing.grading_ms / 1000).toFixed(1)}s (overlapping)`,
  );
  console.log(`Report: ${path.join(runDir, reportName)}`);
  if (results.some((task) => task.passed !== true))
    console.log('Retry failures on fresh copies: npm run bench -- --failed');
  process.exitCode =
    summary.execution_failures ||
    summary.compatibility_failures ||
    summary.cleanup_failures
      ? 2
      : results.every((r) => r.passed)
        ? 0
        : 1;
}

function isRunCopy(file) {
  return (
    file.mimeType === 'application/vnd.google-apps.spreadsheet' &&
    /^\d{4}-\d{2}-\d{2}T[\dTZ.-]+-[a-f0-9]{8} task_\d{2}$/.test(file.name)
  );
}

export async function trashRunCopy(config, id) {
  const references = Object.values(config.templates).flatMap((task) => [
    task.init.id,
    task.golden.id,
  ]);
  if (references.includes(id))
    throw new Error('Refusing to trash a reference workbook');
  const file = await drive(
    `files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed`,
  );
  if (file.trashed) return;
  if (!isRunCopy(file) || !file.parents?.includes(config.runsFolderId))
    throw new Error(
      'Refusing to trash a file outside the generated run copies',
    );
  await drive(`files/${encodeURIComponent(id)}?fields=id,trashed`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

/** A small FIFO gate: grading starts as soon as a completed task has a slot. */
function concurrencyLimit(maximum) {
  let active = 0;
  const queue = [];
  return async (operation) => {
    if (active >= maximum) await new Promise((resolve) => queue.push(resolve));
    else active++;
    try {
      return await operation();
    } finally {
      if (queue.length) queue.shift()();
      else active--;
    }
  };
}
function short(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text ?? 'blank')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 180);
}
function verdict(task) {
  return task.execution?.status !== 'completed' ||
    task.compatibility?.passed === false
    ? 'ERROR'
    : task.passed
      ? 'PASS'
      : 'FAIL';
}
function printFailures(task) {
  if (task.execution?.status !== 'completed')
    console.log(`   ${short(task.execution?.error)}`);
  const examples = [];
  for (const failure of (task.output_failures || []).slice(0, 2))
    examples.push(
      `${failure.sheet}!${failure.cell}: expected ${short(failure.expected)}, got ${short(failure.actual)} (${failure.reasons.join(', ')})`,
    );
  const violation = task.preservation?.violations[0];
  if (violation)
    examples.push(
      `Protected content changed: ${violation.sheet || ''}${violation.cell ? '!' + violation.cell : ''} (${violation.field || violation.kind})`,
    );
  const requirement = task.requirements?.find((check) => !check.passed);
  if (requirement) examples.push(`Requirement failed: ${requirement.id}`);
  const formulaError = task.execution?.new_errors?.[0];
  if (formulaError)
    examples.unshift(
      `${formulaError.sheet}!${formulaError.cell}: new spreadsheet error ${formulaError.error}`,
    );
  if (task.compatibility?.passed === false)
    examples.unshift(
      'Reference conversion mismatch; this task cannot receive a certified score.',
    );
  for (const example of examples.slice(0, 3))
    console.log('   ' + short(example));
  if (task.passed !== true && task.spreadsheet_url && !task.workbook_trashed)
    console.log('   Sheet: ' + task.spreadsheet_url);
}

/** Bounded concurrency, preserving input order and waiting for every started operation. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        try {
          results[index] = await fn(items[index], index);
        } catch (error) {
          failures.push(error);
        }
      }
    }),
  );
  if (failures.length)
    throw new AggregateError(
      failures,
      failures.map((e) => e.message).join('\n'),
    );
  return results;
}

/** Cache only version-pinned exports. Every run still reads native reference values. */
export async function cachedExport({
  id,
  identity,
  directory,
  target,
  metadata,
  exportFile,
  refresh = false,
}) {
  const before = await metadata(id);
  const key = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({ schema: 1, id, identity, version: before.version }),
    )
    .digest('hex');
  const cached = path.join(directory, `${key}.xlsx`);
  await fs.mkdir(directory, { recursive: true });
  if (!refresh && before.version) {
    try {
      await fs.copyFile(cached, target);
      return 'hit';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await exportFile(id, target);
  const after = await metadata(id);
  if (before.version && before.version === after.version) {
    const temporary = `${cached}.${crypto.randomUUID()}.tmp`;
    await fs.copyFile(target, temporary);
    await fs.rename(temporary, cached);
  }
  return 'miss';
}

export function parseOptions(args, available) {
  const options = {
    tasks: [],
    concurrency: 15,
    timeout: 360,
    refreshCache: false,
    prepare: false,
  };
  const task = (input) => {
    for (const part of input.split(',')) {
      if (!/^(?:task_)?\d{1,2}$/.test(part))
        throw new Error(`Invalid task: ${part}`);
      const id = `task_${String(Number(part.replace('task_', ''))).padStart(2, '0')}`;
      if (!available.includes(id))
        throw new Error(`Task ${id} is not in the shortlist`);
      options.tasks.push(id);
    }
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      if (!args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error(`Missing value for ${arg}`);
      return args[++i];
    };
    if (arg === '--task' || arg === '--tasks') task(value());
    else if (arg === '--concurrency') options.concurrency = Number(value());
    else if (arg === '--timeout') options.timeout = Number(value());
    else if (arg === '--prepared') options.prepared = value();
    else if (arg === '--prepare') options.prepare = true;
    else if (arg === '--failed') options.failed = true;
    else if (arg === '--keep-sheets') options.keepSheets = true;
    else if (arg === '--cleanup') options.cleanup = true;
    else if (arg === '--refresh-cache') options.refreshCache = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--') continue;
    else if (!arg.startsWith('-')) task(arg);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 15
  )
    throw new Error('Concurrency must be 1–15');
  if (!Number.isFinite(options.timeout) || options.timeout <= 0)
    throw new Error('Timeout must be positive');
  if (options.prepare && options.prepared)
    throw new Error('Choose --prepare or --prepared');
  if (
    options.failed &&
    (options.tasks.length || options.prepared || options.prepare)
  )
    throw new Error(
      'Use --failed alone to select previous failures on fresh copies.',
    );
  if (
    options.cleanup &&
    (options.tasks.length ||
      options.prepare ||
      options.prepared ||
      options.failed ||
      options.keepSheets)
  )
    throw new Error(
      'Use --cleanup alone; it trashes all generated run copies, including unused prepared copies.',
    );
  options.tasks = [...new Set(options.tasks)];
  return options;
}

export function peakOverlap(tasks) {
  const events = tasks.flatMap((t) =>
    t.remote_execution?.startedAt && t.remote_execution?.completedAt
      ? [
          [Date.parse(t.remote_execution.startedAt), 1],
          [Date.parse(t.remote_execution.completedAt), -1],
        ]
      : [],
  );
  let current = 0,
    peak = 0;
  for (const [, delta] of events.sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    peak = Math.max(peak, (current += delta));
  return peak;
}

if (
  process.argv[1] &&
  (await fs.realpath(process.argv[1]).catch(() => null)) ===
    fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
