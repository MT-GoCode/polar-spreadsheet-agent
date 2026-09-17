import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let token,
  pendingRefresh,
  expiresAt = 0;
export async function accessToken() {
  if (token && Date.now() < expiresAt) return token;
  pendingRefresh ||= refreshAccessToken().finally(() => {
    pendingRefresh = undefined;
  });
  return pendingRefresh;
}

async function refreshAccessToken() {
  const file =
    process.env.CLASP_AUTH_FILE || path.join(os.homedir(), '.clasprc.json');
  const credentials = JSON.parse(await fs.readFile(file, 'utf8')).tokens
    ?.default;
  if (!credentials?.refresh_token)
    throw new Error('Run pnpm auth to sign in to Google first.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(`Google authentication failed: ${result.error}`);
  token = result.access_token;
  expiresAt = Date.now() + (result.expires_in - 60) * 1000;
  return token;
}

export async function googleFetch(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120000),
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${await accessToken()}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    let message;
    try {
      message = JSON.parse(body).error?.message;
    } catch {}
    throw new Error(
      `Google API ${response.status}: ${message || response.statusText}`,
    );
  }
  return response;
}

export async function drive(endpoint, options = {}) {
  return (
    await googleFetch(
      `https://www.googleapis.com/drive/v3/${endpoint}`,
      options,
    )
  ).json();
}

export async function createFile(
  metadata,
  content,
  contentType = 'application/json',
) {
  const boundary = `benchmark_${crypto.randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return (
    await googleFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    )
  ).json();
}

export async function folder(name, parent) {
  return drive('files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parent ? { parents: [parent] } : {}),
    }),
  });
}

export async function exportXlsx(id, target) {
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  );
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}
