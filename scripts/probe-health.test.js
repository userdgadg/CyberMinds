'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const probe = path.join(__dirname, 'probe-health.sh');

async function startServer(status, body) {
  const source = `
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      response.writeHead(${status}, {'content-type': 'application/json'});
      response.end(${JSON.stringify(body)});
    });
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `;
  const server = spawn(process.execPath, ['-e', source], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const [port] = await once(server.stdout, 'data');
  return { server, url: `http://127.0.0.1:${port.toString().trim()}` };
}

function run(env = {}) {
  const probeEnv = { ...process.env, PROBE_TIMEOUT: '2', ...env };
  if (!('TERMINAL_HEALTH_URL' in env)) delete probeEnv.TERMINAL_HEALTH_URL;
  return spawnSync('bash', [probe], { encoding: 'utf8', env: probeEnv });
}

function output(result) {
  return JSON.parse(result.stdout.trim());
}

test('reports a healthy response with portable millisecond latency', async () => {
  const { server, url } = await startServer(200, '{"status":"ok"}');
  try {
    const result = run({ TERMINAL_HEALTH_URL: url });
    assert.equal(result.status, 0, result.stderr);
    const report = output(result);
    assert.deepEqual(
      { status: report.status, category: report.category, http_code: report.http_code },
      { status: 'ok', category: 'ok', http_code: 200 },
    );
    assert.equal(Number.isInteger(report.latency_ms), true);
  } finally {
    server.kill();
  }
});

test('reports non-2xx responses as down without logging the response body', async () => {
  const { server, url } = await startServer(503, '{"secret":"must-not-be-logged"}');
  try {
    const result = run({ TERMINAL_HEALTH_URL: `${url}/health` });
    assert.equal(result.status, 1);
    assert.deepEqual(
      { status: output(result).status, category: output(result).category, http_code: output(result).http_code },
      { status: 'down', category: 'non_2xx', http_code: 503 },
    );
    assert.doesNotMatch(result.stdout, /must-not-be-logged/);
  } finally {
    server.kill();
  }
});

test('rejects a generic 2xx response as invalid health data', async () => {
  const { server, url } = await startServer(200, '<html>proxy fallback</html>');
  try {
    const result = run({ TERMINAL_HEALTH_URL: `${url}/health` });
    assert.equal(result.status, 1);
    assert.deepEqual(
      { status: output(result).status, category: output(result).category, http_code: output(result).http_code },
      { status: 'down', category: 'invalid_response', http_code: 200 },
    );
  } finally {
    server.kill();
  }
});

test('reports missing configuration as a machine-readable error', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.deepEqual(output(result), {
    status: 'error',
    category: 'misconfigured',
    checked_at: output(result).checked_at,
  });
});
