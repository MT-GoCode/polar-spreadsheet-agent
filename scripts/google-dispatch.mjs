import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { googleFetch } from './google-api.mjs';

export function signRequest(request, secret) {
  // ASCII transport makes the signed bytes independent of servlet charset defaults.
  const payload = JSON.stringify({
    ...request,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
  }).replace(
    /[^\x00-\x7f]/g,
    (character) =>
      '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  return {
    payload,
    signature: crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64'),
  };
}

export async function dispatch(config, request, timeout = 360) {
  // Do not retry a request of unknown outcome: it could execute the agent twice.
  const response = await fetch(config.http.url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signRequest(request, config.http.secret)),
    signal: AbortSignal.timeout(timeout * 1000),
  });
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    const error = new Error(
      `Google endpoint returned non-JSON (${response.status}); check web-app authorization/deployment.`,
    );
    if (
      /authorization (?:is )?required|authorize access|access denied/i.test(
        body,
      ) ||
      [401, 403].includes(response.status)
    )
      error.code = 'GOOGLE_AUTHORIZATION_REQUIRED';
    throw error;
  }
  if (!response.ok || result.status === 'failed') {
    const error = new Error(
      result.error || `Google endpoint HTTP ${response.status}`,
    );
    error.remoteResponse = result;
    throw error;
  }
  return result;
}

export async function ensureDeployment(root, config) {
  const configPath = path.join(root, '.benchmark-google.json');
  const save = () =>
    fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
    });
  config.http ||= {};
  config.http.secret ||= crypto.randomBytes(32).toString('hex');
  await save();
  await fs.chmod(configPath, 0o600);
  const clasp = JSON.parse(
    await fs.readFile(path.join(root, '.clasp.json'), 'utf8'),
  );
  const api = `https://script.googleapis.com/v1/projects/${clasp.scriptId}`;
  if (!config.runtimeConfig)
    throw new Error('Run npm run setup to configure the assessment runtime.');
  const local = await appsScriptFiles(root);
  if (local.some((file) => file.name === 'AssessmentRuntime'))
    throw new Error(
      'AssessmentRuntime is reserved for the benchmark infrastructure.',
    );
  local.push({
    name: 'AssessmentRuntime',
    type: 'SERVER_JS',
    source:
      `const BENCHMARK_CONFIG = ${JSON.stringify(config.runtimeConfig)};\n` +
      `const BENCHMARK_HTTP_SECRET = ${JSON.stringify(config.http.secret)};\n` +
      (await fs.readFile(path.join(root, 'scripts/Runtime.gs'), 'utf8')),
  });
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(local))
    .digest('hex');
  if (config.http.digest !== digest || !config.http.url) {
    const remote = await (await googleFetch(`${api}/content`)).json();
    const names = new Set([
      ...(config.http.managedFiles || []),
      ...local.map((f) => f.name),
    ]);
    const files = [
      ...remote.files
        .filter((f) => !names.has(f.name))
        .map(({ name, type, source }) => ({ name, type, source })),
      ...local,
    ];
    const options = (value) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    await googleFetch(`${api}/content`, {
      ...options({ files }),
      method: 'PUT',
    });
    const version = await (
      await googleFetch(
        `${api}/versions`,
        options({ description: 'Immediate concurrent benchmark' }),
      )
    ).json();
    const deploymentConfig = {
      versionNumber: version.versionNumber,
      manifestFileName: 'appsscript',
      description: 'Signed benchmark dispatch',
    };
    const deployment = config.http.deploymentId
      ? await (
          await googleFetch(`${api}/deployments/${config.http.deploymentId}`, {
            ...options({ deploymentConfig }),
            method: 'PUT',
          })
        ).json()
      : await (
          await googleFetch(`${api}/deployments`, options(deploymentConfig))
        ).json();
    const url = deployment.entryPoints?.find(
      (e) => e.entryPointType === 'WEB_APP',
    )?.webApp?.url;
    if (!url) throw new Error('Deployment did not expose a web-app endpoint');
    Object.assign(config.http, {
      url,
      deploymentId: deployment.deploymentId,
      digest,
      version: version.versionNumber,
      managedFiles: local.map((file) => file.name),
    });
    await save();
    console.log(`Deployed benchmark version ${version.versionNumber}.`);
  }
  const health = await dispatch(config, { action: 'health' });
  if (health.scriptId !== clasp.scriptId || health.transport !== 'signed-http')
    throw new Error('Unexpected benchmark endpoint');
  return { scriptId: clasp.scriptId, version: config.http.version };
}

const excludedDirectories = new Set([
  'node_modules',
  'scripts',
  'grader',
  'benchmarks',
  'grading-results',
  'tests',
]);

/** Include candidate .gs/.html modules, excluding local tooling and generated reports. */
export async function appsScriptFiles(root) {
  const files = [];
  async function visit(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith('.')) continue;
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await visit(filename);
      } else if (
        entry.isFile() &&
        (/\.(gs|html)$/.test(filename) || filename === 'appsscript.json')
      ) {
        files.push({
          name: filename
            .replace(/\.(gs|html|json)$/, '')
            .split(path.sep)
            .join('/'),
          type: filename.endsWith('.gs')
            ? 'SERVER_JS'
            : filename.endsWith('.html')
              ? 'HTML'
              : 'JSON',
          source: await fs.readFile(path.join(root, filename), 'utf8'),
        });
      }
    }
  }
  await visit();
  if (!files.some((file) => file.name === 'appsscript'))
    throw new Error('Missing appsscript.json');
  const names = files.map((file) => file.name);
  if (new Set(names).size !== names.length)
    throw new Error(
      'Apps Script files must have unique names, including across .gs and .html.',
    );
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read-only evidence belongs to the grader, never the model's tool context. */
export async function captureNativeSnapshot(
  config,
  spreadsheetId,
  file,
  timeout,
  transport = dispatch,
) {
  let state;
  for (let attempt = 0; ; attempt++) {
    try {
      state = await transport(
        config,
        { action: 'snapshot', spreadsheetId },
        timeout,
      );
      break;
    } catch (error) {
      if (attempt >= 2 || error.code === 'GOOGLE_AUTHORIZATION_REQUIRED')
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  if (
    state.status !== 'snapshot' ||
    state.complete !== true ||
    state.schema_version !== 1 ||
    state.spreadsheetId !== spreadsheetId ||
    state.data?.spreadsheetId !== spreadsheetId
  )
    throw new Error('Incomplete or mismatched native preservation snapshot');
  await fs.writeFile(file, JSON.stringify(state), { mode: 0o600 });
  return { file, bytes: JSON.stringify(state).length, ...state.metrics };
}
