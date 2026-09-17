/** Immediate signed dispatch. The lock protects only replay checks, never agent execution. */
function doPost(event) {
  try {
    const envelope = JSON.parse(event.postData.contents);
    benchmarkAuthenticate_(envelope);
    const request = JSON.parse(envelope.payload);
    let result;
    if (request.action === 'health') {
      result = {
        status: 'ready',
        engine: 'google-apps-script',
        transport: 'signed-http',
        scriptId: ScriptApp.getScriptId(),
      };
    } else if (request.action === 'snapshot') {
      benchmarkCheckRunCopy_(request.spreadsheetId);
      result = benchmarkSnapshot_(request.spreadsheetId);
    } else if (request.action === 'configure') {
      prepareBenchmarkTemplates_();
      result = { status: 'ready' };
    } else if (request.action === 'smoke') {
      benchmarkCheckRunCopy_(request.spreadsheetId);
      const sheet = SpreadsheetApp.openById(
        request.spreadsheetId,
      ).getSheets()[0];
      sheet.getRange('A1:B1').setValues([[2, 3]]);
      sheet.getRange('A2').setFormula('=SUM(A1:B1)');
      SpreadsheetApp.flush();
      const value = sheet.getRange('A2').getValue();
      if (value !== 5) throw new Error('Smoke-test formula did not calculate');
      const native = benchmarkSnapshot_(request.spreadsheetId);
      const formula = native.data.sheets[0].cells.find(
        (cell) => cell[0] === 'A2',
      );
      if (formula?.[1]?.formulaValue !== '=SUM(A1:B1)')
        throw new Error(
          'Native preservation read did not return the entered formula',
        );
      result = {
        status: 'verified',
        nativePreservation: true,
        spreadsheetId: request.spreadsheetId,
        value,
      };
    } else if (request.action === 'prepare' || request.action === 'run') {
      result = benchmarkDirect_(request.job, request.action);
    } else throw new Error('Unknown action');
    return benchmarkJson_(result);
  } catch (error) {
    return benchmarkJson_({
      status: 'failed',
      error: String(error.message || error),
    });
  }
}

function benchmarkJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function benchmarkAuthenticate_(envelope) {
  if (
    typeof envelope.payload !== 'string' ||
    typeof envelope.signature !== 'string'
  )
    throw new Error('Unauthorized');
  const expected = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(
      envelope.payload,
      BENCHMARK_HTTP_SECRET,
    ),
  );
  let difference = expected.length ^ envelope.signature.length;
  for (let i = 0; i < expected.length; i++)
    difference |=
      expected.charCodeAt(i) ^ (envelope.signature.charCodeAt(i) || 0);
  if (difference) throw new Error('Unauthorized');
  const request = JSON.parse(envelope.payload);
  if (
    !Number.isFinite(request.timestamp) ||
    Math.abs(Date.now() - request.timestamp) > 300000 ||
    !/^[a-f0-9-]{36}$/.test(request.nonce)
  )
    throw new Error('Expired or invalid request');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const key = 'http:' + request.nonce;
    if (cache.get(key)) throw new Error('Request already used');
    cache.put(key, '1', 600);
  } finally {
    lock.releaseLock();
  }
}

function benchmarkDirect_(job, action) {
  const started = Date.now();
  const response = {
    jobId: job.jobId,
    taskId: job.taskId,
    spreadsheetId: job.spreadsheetId,
    engine: 'google-apps-script',
    transport: 'signed-http',
    scriptId: ScriptApp.getScriptId(),
    startedAt: new Date(started).toISOString(),
    timing: {},
  };
  let checkpoint = started;
  const mark = (name) => {
    const now = Date.now();
    response.timing[name] = now - checkpoint;
    checkpoint = now;
  };
  try {
    const settings = BENCHMARK_CONFIG.templateSettings.find(
      (s) => s.id === job.initialTemplateId,
    );
    if (
      !settings ||
      !BENCHMARK_CONFIG.templateSettings.some(
        (s) => s.id === job.goldenSpreadsheetId,
      )
    )
      throw new Error('Unknown template');
    benchmarkCheckRunCopy_(job.spreadsheetId);
    const spreadsheet = SpreadsheetApp.openById(job.spreadsheetId);
    mark('open_ms');
    if (action === 'prepare') {
      spreadsheet.setIterativeCalculationEnabled(settings.enabled);
      if (settings.enabled) {
        spreadsheet.setMaxIterativeCalculationCycles(settings.maxIterations);
        spreadsheet.setIterativeCalculationConvergenceThreshold(
          settings.threshold,
        );
      }
      SpreadsheetApp.flush();
      // Warm native calculation before the local runner captures its preservation baseline.
      benchmarkReadOutputs_(spreadsheet, job.outputRanges);
      response.status = 'prepared';
      mark('prepare_ms');
    } else {
      response.initialValues = benchmarkReadOutputs_(
        spreadsheet,
        job.outputRanges,
      );
      response.initialFormulas = benchmarkReadOutputs_(
        spreadsheet,
        job.outputRanges,
        true,
      );
      mark('initial_read_ms');
      SpreadsheetApp.setActiveSpreadsheet(spreadsheet);
      const agentRequest = {
        prompt: job.prompt,
        spreadsheetId: job.spreadsheetId,
      };
      response.response = runAgent(agentRequest);
      mark('agent_ms');
      SpreadsheetApp.flush();
      let fingerprint,
        previous = null,
        stable = 0,
        samples = 0;
      for (; samples < 10 && stable < 2; samples++) {
        response.outputValues = benchmarkReadOutputs_(
          spreadsheet,
          job.outputRanges,
        );
        fingerprint = Utilities.base64Encode(
          Utilities.computeDigest(
            Utilities.DigestAlgorithm.SHA_256,
            JSON.stringify(response.outputValues),
          ),
        );
        stable = fingerprint === previous ? stable + 1 : 0;
        previous = fingerprint;
        if (stable < 2) Utilities.sleep(1000);
      }
      if (stable < 2)
        throw new Error(
          'Calculated values did not settle within 10 observations',
        );
      response.calculation = {
        method: 'SpreadsheetApp.flush + repeated getValues',
        stableSamples: 3,
        samples,
        valueDigest: fingerprint,
      };
      mark('calculation_ms');
      response.outputFormulas = benchmarkReadOutputs_(
        spreadsheet,
        job.outputRanges,
        true,
      );
      response.goldenValues = benchmarkReadOutputs_(
        SpreadsheetApp.openById(job.goldenSpreadsheetId),
        job.outputRanges,
      );
      mark('final_read_ms');
      response.status = 'completed';
    }
  } catch (error) {
    response.status = 'failed';
    response.error = String(error.stack || error);
  }
  response.completedAt = new Date().toISOString();
  return response;
}

/** Run once in the editor only if Google requests first-time authorization. */
function authorizeBenchmark() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  DriveApp.getFolderById(BENCHMARK_CONFIG.runsFolderId).getName();
  prepareBenchmarkTemplates_();
  console.log('Benchmark authorized. Return to the setup terminal.');
}

function prepareBenchmarkTemplates_() {
  const properties = PropertiesService.getScriptProperties();
  if (
    properties.getProperty('benchmarkTemplateSettings') ===
    BENCHMARK_CONFIG.templateSettingsDigest
  )
    return;
  BENCHMARK_CONFIG.templateSettings.forEach((settings) => {
    const spreadsheet = SpreadsheetApp.openById(settings.id);
    spreadsheet.setIterativeCalculationEnabled(settings.enabled);
    if (settings.enabled) {
      spreadsheet.setMaxIterativeCalculationCycles(settings.maxIterations);
      spreadsheet.setIterativeCalculationConvergenceThreshold(
        settings.threshold,
      );
    }
  });
  SpreadsheetApp.flush();
  properties.setProperty(
    'benchmarkTemplateSettings',
    BENCHMARK_CONFIG.templateSettingsDigest,
  );
}

function benchmarkCheckRunCopy_(id) {
  if (BENCHMARK_CONFIG.templateSettings.some((settings) => settings.id === id))
    throw new Error('Workbook is not a run copy');
  const parents = DriveApp.getFileById(id).getParents();
  while (parents.hasNext())
    if (parents.next().getId() === BENCHMARK_CONFIG.runsFolderId) return;
  throw new Error('Workbook is not a run copy');
}

/** Capture entered state, not calculated values or Excel-export representations. */
function benchmarkSnapshot_(id) {
  const started = Date.now();
  const metrics = {
    requests: 0,
    response_chars: 0,
    max_response_chars: 0,
    quota_wait_ms: 0,
    read_ms: 0,
  };
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const address = (row, col) => {
    let label = '';
    while (col) {
      const digit = (col - 1) % 26;
      label = String.fromCharCode(65 + digit) + label;
      col = Math.floor((col - 1) / 26);
    }
    return label + row;
  };
  const tabs = SpreadsheetApp.openById(id).getSheets();
  const sheets = tabs.map((tab) => ({
    properties: { sheetId: tab.getSheetId(), title: tab.getName() },
    coverage: {
      rows: Math.max(1, tab.getLastRow()),
      columns: Math.max(1, tab.getLastColumn()),
    },
    conditionalFormats: [],
    cells: [],
    formats: [{}],
    validations: [null],
  }));
  const byId = new Map(
    sheets.map((sheet) => [sheet.properties.sheetId, sheet]),
  );
  const indices = new Map(
    sheets.map((sheet) => [
      sheet.properties.sheetId,
      {
        formats: new Map([['{}', 0]]),
        validations: new Map([['null', 0]]),
      },
    ]),
  );
  const intern = (value, values, index) => {
    value = canonical(value);
    const key = JSON.stringify(value);
    if (!index.has(key)) {
      index.set(key, values.length);
      values.push(value);
    }
    return index.get(key);
  };
  // Pack small sheets together while bounding each response's cell count.
  // Every used cell is read exactly once, including blank cells with formatting.
  const cellBudget = 80000;
  let ranges = [],
    count = 0,
    rangeChars = 0;
  const flush = () => {
    if (!ranges.length) return;
    const part = benchmarkSheetsRead_(
      id,
      {
        ranges,
        fields:
          'sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue,userEnteredFormat,dataValidation,textFormatRuns,chipRuns))))',
      },
      metrics,
    );
    for (const returned of part.sheets || []) {
      const sheet = byId.get(returned.properties.sheetId);
      if (!sheet) throw new Error('Unknown sheet in preservation response');
      const index = indices.get(returned.properties.sheetId);
      for (const grid of returned.data || [])
        for (let i = 0; i < (grid.rowData || []).length; i++)
          for (let j = 0; j < (grid.rowData[i].values || []).length; j++) {
            const cell = grid.rowData[i].values[j];
            if (!Object.keys(cell).length) continue;
            const format = { ...(cell.userEnteredFormat || {}) };
            if (cell.textFormatRuns)
              format._textFormatRuns = cell.textFormatRuns;
            if (cell.chipRuns) format._chipRuns = cell.chipRuns;
            sheet.cells.push([
              address(
                (grid.startRow || 0) + i + 1,
                (grid.startColumn || 0) + j + 1,
              ),
              cell.userEnteredValue || null,
              intern(format, sheet.formats, index.formats),
              intern(
                cell.dataValidation || null,
                sheet.validations,
                index.validations,
              ),
            ]);
          }
    }
    ranges = [];
    count = 0;
    rangeChars = 0;
  };
  for (const sheet of sheets) {
    const { rows, columns } = sheet.coverage;
    const name = "'" + sheet.properties.title.replace(/'/g, "''") + "'!";
    for (let c = 1; c <= columns; ) {
      const width = Math.min(columns - c + 1, cellBudget);
      for (let r = 1; r <= rows; ) {
        if (cellBudget - count < width || ranges.length >= 50) flush();
        const height = Math.min(
          rows - r + 1,
          Math.floor((cellBudget - count) / width),
        );
        const range =
          name + address(r, c) + ':' + address(r + height - 1, c + width - 1);
        const encodedChars = encodeURIComponent(range).length + 8;
        // Leave room for the endpoint and field mask within UrlFetch's URL limit.
        if (ranges.length && rangeChars + encodedChars > 1200) flush();
        ranges.push(range);
        rangeChars += encodedChars;
        count += width * height;
        r += height;
      }
      c += width;
    }
  }
  flush();
  // Ranged reads filter conditional rules; fetch their complete ordered lists once.
  const metadata = benchmarkSheetsRead_(
    id,
    {
      fields: 'sheets(properties(sheetId),conditionalFormats)',
    },
    metrics,
  );
  if (metadata.sheets?.length !== sheets.length)
    throw new Error('Incomplete sheet metadata in preservation response');
  for (const returned of metadata.sheets) {
    const sheet = byId.get(returned.properties.sheetId);
    if (!sheet) throw new Error('Unknown sheet in preservation metadata');
    sheet.conditionalFormats = returned.conditionalFormats || [];
  }
  metrics.elapsed_ms = Date.now() - started;
  return {
    status: 'snapshot',
    schema_version: 1,
    complete: true,
    spreadsheetId: id,
    data: { spreadsheetId: id, sheets },
    metrics,
  };
}

/** Read plain JSON to avoid the advanced-service proxy cost for large cell arrays. */
function benchmarkSheetsRead_(id, options, metrics) {
  for (let attempt = 0; ; attempt++) {
    try {
      return benchmarkSheetsReadOnce_(id, options, metrics);
    } catch (error) {
      if (attempt >= 2 || !/quota|429|rate limit/i.test(String(error)))
        throw error;
      Utilities.sleep(30000);
      if (metrics) metrics.quota_wait_ms += 30000;
    }
  }
}

function benchmarkSheetsReadOnce_(id, options, metrics) {
  // Reserve read slots across concurrent tasks in this Apps Script project.
  // The lock protects only scheduling; neither HTTP nor sleep holds it.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let scheduled;
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const next = Math.max(
      now,
      Math.min(
        Number(props.getProperty('benchmarkNextNativeRead')) || 0,
        now + 60000,
      ),
    );
    // At most 10 immediate reads, then 40/minute: under 50 in any minute.
    scheduled = Math.max(now, next - 9 * 1500);
    props.setProperty('benchmarkNextNativeRead', String(next + 1500));
  } finally {
    lock.releaseLock();
  }
  const wait = Math.max(0, scheduled - Date.now());
  if (wait) Utilities.sleep(wait);
  if (metrics) metrics.quota_wait_ms += wait;
  const readStarted = Date.now();

  const query = [
    'prettyPrint=false',
    'fields=' + encodeURIComponent(options.fields),
  ];
  for (const range of options.ranges || [])
    query.push('ranges=' + encodeURIComponent(range));
  const response = UrlFetchApp.fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(id) +
      '?' +
      query.join('&'),
    {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    },
  );
  const body = response.getContentText();
  if (metrics) {
    metrics.requests++;
    metrics.response_chars += body.length;
    metrics.max_response_chars = Math.max(
      metrics.max_response_chars || 0,
      body.length,
    );
    metrics.read_ms += Date.now() - readStarted;
  }
  const status = response.getResponseCode();
  if (status !== 200)
    throw new Error(
      'Native Sheets read HTTP ' + status + ': ' + body.slice(0, 500),
    );
  return JSON.parse(body);
}

/** Authoritative native values for scored cells; exports can retain stale caches. */
function benchmarkReadOutputs_(spreadsheet, ranges, formulaOnly) {
  const output = {};
  const column = (letters) =>
    letters.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const address = (col, row) => {
    let letters = '';
    for (; col > 0; col = Math.floor((col - 1) / 26))
      letters = String.fromCharCode(65 + ((col - 1) % 26)) + letters;
    return letters + row;
  };
  Object.keys(ranges).forEach((name) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw new Error('Missing sheet ' + name);
    // One bounded read per sheet, including only the rectangle around scored cells.
    // This avoids pulling tens of thousands of unrelated source rows.
    const parsed = ranges[name].map((ref) => {
      const m = /^([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$/.exec(ref);
      if (!m) throw new Error('Invalid output range ' + ref);
      return {
        r1: Number(m[2]),
        r2: Number(m[4] || m[2]),
        c1: column(m[1]),
        c2: column(m[3] || m[1]),
      };
    });
    output[name] = {};
    if (!parsed.length) return;
    const firstRow = Math.min.apply(
      null,
      parsed.map((r) => r.r1),
    );
    const firstCol = Math.min.apply(
      null,
      parsed.map((r) => r.c1),
    );
    const lastRow = Math.max.apply(
      null,
      parsed.map((r) => r.r2),
    );
    const lastCol = Math.max.apply(
      null,
      parsed.map((r) => r.c2),
    );
    const range = sheet.getRange(
      firstRow,
      firstCol,
      lastRow - firstRow + 1,
      lastCol - firstCol + 1,
    );
    const values = formulaOnly ? range.getFormulas() : range.getValues();
    output[name] = {};
    ranges[name].forEach((ref) => {
      const m = /^([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$/.exec(ref);
      if (!m) throw new Error('Invalid output range ' + ref);
      for (let r = Number(m[2]); r <= Number(m[4] || m[2]); r++) {
        for (let c = column(m[1]); c <= column(m[3] || m[1]); c++) {
          const value = (values[r - firstRow] || [])[c - firstCol];
          output[name][address(c, r)] =
            value instanceof Date
              ? { date: value.toISOString().replace('.000Z', '') }
              : value === undefined || value === ''
                ? null
                : value;
        }
      }
    });
  });
  return output;
}
