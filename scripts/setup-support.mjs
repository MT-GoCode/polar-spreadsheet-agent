import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { googleFetch, drive } from './google-api.mjs';

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function saveJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  await fs.rename(temporary, file);
}

export function supportsNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

export function venvPython(root, platform = process.platform) {
  return path.join(
    root,
    '.venv',
    platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
}

export function graderPython(root) {
  return (
    process.env.GRADER_PYTHON ||
    (existsSync(venvPython(root))
      ? venvPython(root)
      : process.platform === 'win32'
        ? 'python'
        : 'python3')
  );
}

export function run(command, args, { cwd, capture = false, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      ...options,
    });
    let stdout = '',
      stderr = '';
    child.stdout?.on('data', (data) => {
      stdout += data;
    });
    child.stderr?.on('data', (data) => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(
            new Error(
              stderr.trim() || `${path.basename(command)} exited ${code}`,
            ),
          ),
    );
  });
}

export async function ensurePython(root) {
  const target = process.env.GRADER_PYTHON || venvPython(root);
  if (!existsSync(target)) {
    if (process.env.GRADER_PYTHON)
      throw new Error(
        'GRADER_PYTHON must point to an existing Python executable.',
      );
    const candidates =
      process.platform === 'win32'
        ? [['py', '-3'], ['python'], ['python3']]
        : [['python3'], ['python']];
    const found = candidates.find(
      ([command, ...args]) =>
        spawnSync(
          command,
          [
            ...args,
            '-c',
            'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)',
          ],
          { stdio: 'ignore' },
        ).status === 0,
    );
    if (!found)
      throw new Error(
        'Python 3.10+ is required. Install it from https://www.python.org/downloads/ and rerun setup.',
      );
    await run(
      found[0],
      [...found.slice(1), '-m', 'venv', path.join(root, '.venv')],
      { cwd: root },
    );
  }
  await run(
    target,
    [
      '-c',
      'import sys; assert sys.version_info >= (3,10), "Python 3.10+ is required"',
    ],
    { capture: true },
  );
  const requirement = (
    await fs.readFile(path.join(root, 'grader/requirements.txt'), 'utf8')
  ).trim();
  // Dependencies are pinned; skip pip when the installed version already matches.
  const expected = /^openpyxl==([\d.]+)$/.exec(requirement)?.[1];
  const ready =
    expected &&
    spawnSync(
      target,
      ['-c', `import openpyxl; assert openpyxl.__version__ == '${expected}'`],
      { stdio: 'ignore' },
    ).status === 0;
  if (!ready)
    await run(
      target,
      [
        '-m',
        'pip',
        'install',
        '-r',
        path.join(root, 'grader/requirements.txt'),
      ],
      { cwd: root },
    );
  return target;
}

export async function installDependencies(root) {
  const execPath = process.env.npm_execpath;
  if (!execPath)
    throw new Error('Start setup with npm run setup or pnpm run setup.');
  if (/pnpm/i.test(path.basename(execPath)))
    await run(process.execPath, [execPath, 'install', '--frozen-lockfile'], {
      cwd: root,
    });
  else
    await run(
      process.execPath,
      [
        execPath,
        'exec',
        '--yes',
        '--package=pnpm@11.6.0',
        '--',
        'pnpm',
        'install',
        '--frozen-lockfile',
      ],
      { cwd: root },
    );
}

export function createUI({
  interactive = Boolean(process.stdin.isTTY),
  browser = true,
  log = console.log,
} = {}) {
  return {
    interactive,
    browser,
    log,
    async browserStep(url, instructions) {
      log(`\n${instructions}\n${url}`);
      if (!interactive)
        throw new Error(
          'A Google approval step is required. Complete the instructions above, then rerun npm run setup in an interactive terminal. Saved progress will be reused.',
        );
      if (browser) {
        const command =
          process.platform === 'darwin'
            ? ['open', url]
            : process.platform === 'win32'
              ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
              : ['xdg-open', url];
        try {
          await run(command[0], command.slice(1), { capture: true });
        } catch {
          log('Open the link above in your browser.');
        }
      }
      const input = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        await input.question('Press Enter after completing the Google step… ');
      } finally {
        input.close();
      }
    },
  };
}

export function needsApiEnabled(error) {
  return /(?:has not enabled|enable|disabled|not enabled).*Apps Script API|Apps Script API.*(?:disabled|not enabled|has not been used)/i.test(
    error.message,
  );
}

export function needsAuthorization(error) {
  return (
    error.code === 'GOOGLE_AUTHORIZATION_REQUIRED' ||
    /authorization (?:is )?required|you do not have permission to call|required permissions|script does not have permission|not authorized to access/i.test(
      error.message,
    )
  );
}

/** Retry only an explicit rejected authorization check, never an uncertain agent execution. */
export async function withGoogleApproval(operation, ui, editorUrl) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 2) throw error;
      if (needsApiEnabled(error))
        await ui.browserStep(
          'https://script.google.com/home/usersettings',
          'Turn on Google Apps Script API for the account you signed in with.',
        );
      else if (needsAuthorization(error) && editorUrl)
        await ui.browserStep(
          editorUrl,
          'In the Apps Script editor, select authorizeBenchmark from the function dropdown and click Run. Approve the Google permissions using the same account. Setup will verify the connection when you return.',
        );
      else throw error;
    }
  }
}

/** Use the REST API instead of clasp create, which can write starter files over local code. */
export async function ensureProject(
  root,
  { request = googleFetch, driveRequest = drive } = {},
) {
  const claspPath = path.join(root, '.clasp.json');
  const existing = await readJson(claspPath, null);
  if (existing) {
    if (!existing.scriptId)
      throw new Error(
        '.clasp.json has no scriptId. Repair the connection before running setup.',
      );
    const project = await (
      await request(
        `https://script.googleapis.com/v1/projects/${existing.scriptId}`,
      )
    ).json();
    return {
      scriptId: existing.scriptId,
      parentId: project.parentId,
      reused: true,
    };
  }
  const statePath = path.join(root, '.setup-state.json');
  const state = await readJson(statePath, {});
  if (!state.parentId) {
    const sheet = await driveRequest('files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Spreadsheet Agent Assessment',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      }),
    });
    state.parentId = sheet.id;
    await saveJson(statePath, state);
  }
  const project = await (
    await request('https://script.googleapis.com/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Spreadsheet Agent Assessment',
        parentId: state.parentId,
      }),
    })
  ).json();
  await saveJson(claspPath, { scriptId: project.scriptId, rootDir: '.' });
  return {
    scriptId: project.scriptId,
    parentId: state.parentId,
    reused: false,
  };
}

export function loginArguments(ui) {
  if (ui.interactive === false)
    throw new Error(
      'Google sign-in is required. Rerun npm run setup in an interactive terminal.',
    );
  return ['login', ...(ui.browser === false ? ['--no-localhost'] : [])];
}
