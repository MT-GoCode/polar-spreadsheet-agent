import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken, drive, folder, createFile } from './google-api.mjs';
import { ensureDeployment, dispatch } from './google-dispatch.mjs';
import {
  graderPython,
  readJson,
  saveJson,
  run,
  supportsNode,
  ensurePython,
  installDependencies,
  createUI,
  withGoogleApproval,
  ensureProject,
  loginArguments,
} from './setup-support.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function smokeTest(
  config,
  { driveRequest = drive, send = dispatch } = {},
) {
  const probe = await driveRequest('files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Setup connection check',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [config.runsFolderId],
    }),
  });
  // Leave an uncertain request's workbook intact; don't race an execution still running.
  const result = await send(config, {
    action: 'smoke',
    spreadsheetId: probe.id,
  });
  if (
    result.status !== 'verified' ||
    result.spreadsheetId !== probe.id ||
    result.value !== 5 ||
    result.nativePreservation !== true
  )
    throw new Error(
      'Google Sheets calculation/native preservation check failed.',
    );
  await driveRequest(`files/${probe.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  return result;
}

export async function setup({
  directory = root,
  ui = createUI(),
  localOnly = false,
} = {}) {
  if (!supportsNode(process.versions.node))
    throw new Error(
      'Node.js 22.12+ is required. Install a current Node LTS release, then rerun setup.',
    );
  ui.log('[1/5] Installing project dependencies…');
  await installDependencies(directory);
  ui.log('[2/5] Checking Python and the grader…');
  await ensurePython(directory);
  if (localOnly) {
    ui.log(
      'Local dependencies are ready. Run npm run setup to connect Google.',
    );
    return;
  }
  ui.log('[3/5] Connecting your Google account…');
  try {
    await accessToken();
  } catch (error) {
    if (
      !(
        error.code === 'ENOENT' ||
        /sign in|Google authentication failed: (invalid_grant|invalid_client)/.test(
          error.message,
        )
      )
    )
      throw error;
    if (process.env.CLASP_AUTH_FILE)
      throw new Error(
        'CLASP_AUTH_FILE is missing or invalid. Supply valid clasp credentials or unset it to use browser sign-in.',
      );
    const loginArgs = loginArguments(ui);
    ui.log(
      'Follow Google sign-in using the account that should own your assessment workbooks.',
    );
    const pkg = await readJson(
      path.join(directory, 'node_modules/@google/clasp/package.json'),
    );
    await run(
      process.execPath,
      [
        path.join(directory, 'node_modules/@google/clasp', pkg.bin.clasp),
        ...loginArgs,
      ],
      { cwd: directory },
    );
    await accessToken();
  }
  ui.log('[4/5] Preparing your Apps Script project and benchmark…');
  const project = await withGoogleApproval(() => ensureProject(directory), ui);
  const editorUrl = `https://script.google.com/home/projects/${project.scriptId}/edit`;
  ui.log(
    `${project.reused ? 'Using existing' : 'Created'} Apps Script project: ${editorUrl}`,
  );
  const config = await setupBenchmark(directory, {
    verify: (operation) => withGoogleApproval(operation, ui, editorUrl),
    log: ui.log,
  });
  ui.log('[5/5] Verifying a real Google Sheets write and formula calculation…');
  await withGoogleApproval(() => smokeTest(config), ui, editorUrl);
  const statePath = path.join(directory, '.setup-state.json');
  await saveJson(statePath, {
    ...(await readJson(statePath, {})),
    verifiedAt: new Date().toISOString(),
    scriptId: project.scriptId,
  });
  ui.log(
    `\nSetup complete. Your Apps Script source is unchanged.\n\n  npm run bench -- 03         Run one task\n  npm run bench -- 01 03 06   Run a subset\n  npm run bench              Run all 15\n\nStart with README.md and edit runAgent in Code.gs. Bench uploads and deploys changes automatically.\nThe initial no-op agent scores zero; benchmark exit code 1 is expected.\nProject: ${editorUrl}`,
  );
}

export async function setupBenchmark(
  root,
  { verify = (operation) => operation(), log = console.log } = {},
) {
  const configPath = path.join(root, '.benchmark-google.json');
  const config = await readJson(configPath, { templates: {} });
  // Persist each created folder so interrupted setup resumes without duplicating it.
  for (const [field, name] of [
    ['folderId', 'Spreadsheet Agent Assessment'],
    ['templatesFolderId', 'Templates'],
    ['runsFolderId', 'Runs'],
  ]) {
    if (!config[field]) {
      config[field] = (
        await folder(name, field === 'folderId' ? undefined : config.folderId)
      ).id;
      await saveJson(configPath, config);
    }
  }
  const tasks = (await fs.readdir(path.join(root, 'benchmarks/grading_specs')))
    .filter((name) => /^task_\d{2}\.json$/.test(name))
    .map((name) => name.slice(5, 7))
    .sort();
  // A reused checkout may contain templates from a previous task catalog.
  const activeIds = new Set(tasks.map((number) => `task_${number}`));
  config.templates = Object.fromEntries(
    Object.entries(config.templates).filter(([id]) => activeIds.has(id)),
  );
  await saveJson(configPath, config);
  for (const number of tasks) {
    const taskId = `task_${number}`;
    config.templates[taskId] ||= {};
    for (const kind of ['init', 'golden']) {
      const source = await fs.readFile(
        path.join(root, 'benchmarks/tasks', taskId, `${kind}.xlsx`),
      );
      const hash = crypto.createHash('sha256').update(source).digest('hex');
      if (config.templates[taskId][kind]?.sourceHash === hash) continue;
      const result = await createFile(
        {
          name: `${taskId} ${kind}`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [config.templatesFolderId],
        },
        source,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      config.templates[taskId][kind] = { id: result.id, sourceHash: hash };
      await saveJson(configPath, config);
      log(
        `Imported ${taskId} ${kind}: https://docs.google.com/spreadsheets/d/${result.id}/edit`,
      );
    }
  }
  log(
    `Templates ready: https://drive.google.com/drive/folders/${config.folderId}`,
  );
  const python = graderPython(root);
  const extracted = spawnSync(python, ['-m', 'grader.calc_settings'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (extracted.status !== 0)
    throw new Error(
      extracted.stderr || 'Could not read workbook calculation settings',
    );
  const templateSettings = JSON.parse(extracted.stdout);
  config.templateSettingsDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify(templateSettings))
    .digest('hex');
  config.runtimeConfig = {
    runsFolderId: config.runsFolderId,
    templateSettings,
    templateSettingsDigest: config.templateSettingsDigest,
  };
  await saveJson(configPath, config);
  await verify(async () => {
    await ensureDeployment(root, config);
    await dispatch(config, { action: 'configure' });
  });
  return config;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.includes('--help'))
    console.log(
      'npm run setup [-- --no-browser | --non-interactive | --local-only]\nInstalls dependencies, signs in, creates a project, imports templates, deploys, and verifies Google Sheets.\nSafe to rerun: existing progress is reused. Google approval steps remain interactive.',
    );
  else if (
    args.some(
      (arg) =>
        !['--no-browser', '--non-interactive', '--local-only'].includes(arg),
    )
  ) {
    console.error('Unknown setup option. Run npm run setup -- --help.');
    process.exitCode = 2;
  } else
    setup({
      ui: createUI({
        browser: !args.includes('--no-browser'),
        interactive:
          !args.includes('--non-interactive') && Boolean(process.stdin.isTTY),
      }),
      localOnly: args.includes('--local-only'),
    }).catch((error) => {
      console.error(
        `\nSetup stopped: ${error.message}\nFix the issue and rerun npm run setup; completed steps are saved.`,
      );
      process.exitCode = 2;
    });
}
