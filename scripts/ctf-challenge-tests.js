'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const image = process.env.CTF_TEST_IMAGE || 'cyberminds-terminal-ctf:test';
const timeoutMs = 90_000;

function loadCatalog() {
  const statePath = path.join(__dirname, '..', 'Javascript', 'terminal', 'state.js');
  const source =
    fs.readFileSync(statePath, 'utf8') +
    '\nglobalThis.__cyberMindsCatalog = { challengeCatalog, challengeOrder };';
  const context = {
    URL,
    URLSearchParams,
    window: { location: { hostname: 'localhost', origin: 'http://localhost', search: '' } },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: statePath });
  return context.__cyberMindsCatalog;
}

const cases = {
  'linux-basics': {
    pass: 'printf "%s\\n" "owner: root, group: staff, permissions: drwxr-xr-x" > report.txt',
    invalid: [{ label: 'missing ownership keyword', command: 'printf "hello\\n" > report.txt' }],
  },
  'web-recon': {
    pass: [
      'printf "%s\\n"',
      '  "Status: 200 OK"',
      '  "Server: nginx/1.18.0"',
      '  "Content-Type: text/html"',
      '  "Port: 9090"',
      '  "X-Powered-By: PHP/7.4.3"',
      '  "X-Application: InternalPortal/2.1"',
      '  > recon-notes.txt',
    ].join(' '),
    invalid: [{ label: 'missing service port', command: 'printf "%s\\n" "Status: 200" "PHP/7.4" "InternalPortal" > recon-notes.txt' }],
  },
  'log-hunt': {
    pass: 'printf "%s\\n" "12  192.168.1.45  brute force auth spike detected" "3  10.0.0.12" > findings.txt',
    invalid: [{ label: 'wrong top offender', command: 'printf "%s\\n" "12  10.0.0.12  auth spike" > findings.txt' }],
  },
  'priv-esc': {
    pass: 'printf "%s\\n" "User jsmith authenticated via SSH." "At 02:11 jsmith ran su to escalate privileges to root." > priv-esc-report.txt',
    invalid: [{ label: 'missing escalation timestamp', command: 'printf "%s\\n" "User jsmith used su to escalate privileges." > priv-esc-report.txt' }],
  },
  'incident-timeline': {
    pass: [
      'printf "%s\\n"',
      '  "03:10:14 SSH failed password"',
      '  "03:10:29 SSH failed password"',
      '  "03:10:47 SSH accepted password"',
      '  "03:10:48 SSH session opened"',
      '  "03:10:50 HTTP GET /login"',
      '  "03:11:02 HTTP POST /login"',
      '  "03:11:05 HTTP GET /admin"',
      '  "03:12:05 SSH session closed"',
      '  > timeline.txt',
    ].join(' '),
    invalid: [{ label: 'too few events', command: 'printf "%s\\n" "03:10:14 SSH login" "03:10:29 SSH failed" "03:11:00 HTTP GET" > timeline.txt' }],
  },
  'suspicious-beaconing': {
    pass: 'printf "%s\\n" "IP: 192.0.2.10 UA: Mozilla/5.0 interval: 30s" "Pattern: periodic callback every 30 seconds" > beacon-report.txt',
    invalid: [{ label: 'missing beacon source', command: 'printf "%s\\n" "UA: Mozilla/5.0 interval: 30s" > beacon-report.txt' }],
  },
  'phishing-header': {
    pass: 'printf "%s\\n" "Impersonated domain: corporate-alerts.example.com" "Return-Path mismatch: bounces@phish-mailer.invalid" "SPF fail: sender is not permitted" "DKIM fail: signature verification failed" > phishing-findings.txt',
    invalid: [{ label: 'only two spoofing indicators', command: 'printf "%s\\n" "Impersonated domain: corporate-alerts.example.com" "SPF fail: sender is not permitted" "DKIM fail: signature verification failed" > phishing-findings.txt' }],
  },
  'iam-least-privilege': {
    pass: [
      'printf "%s\\n"',
      '  "{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"s3:GetObject\\",\\"Resource\\":\\"arn:aws:s3:::cm-backup-data-123456789012/prod/daily/*\\"},{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"s3:ListBucket\\",\\"Resource\\":\\"arn:aws:s3:::cm-backup-data-123456789012\\"},{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"logs:CreateLogStream\\",\\"Resource\\":\\"arn:aws:logs:us-east-1:123456789012:log-group:/backup/cm-agent:*\\"},{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"logs:PutLogEvents\\",\\"Resource\\":\\"arn:aws:logs:us-east-1:123456789012:log-group:/backup/cm-agent:*\\"}]}"',
      '  > policy.json',
    ].join(' '),
    invalid: [
      { label: 'wildcard action', command: 'printf "%s\\n" "{\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":\\"*\\",\\"Resource\\":\\"*\\"}]}" > policy.json' },
      { label: 'missing log stream action', command: 'printf "%s\\n" "{\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":[\\"s3:GetObject\\",\\"s3:ListBucket\\",\\"logs:PutLogEvents\\"],\\"Resource\\":[\\"arn:aws:s3:::cm-backup-data-123456789012/prod/daily/*\\",\\"arn:aws:s3:::cm-backup-data-123456789012\\",\\"arn:aws:logs:us-east-1:123456789012:log-group:/backup/cm-agent:*\\"]}]}" > policy.json' },
      { label: 'unrelated action', command: 'printf "%s\\n" "{\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Action\\":[\\"s3:GetObject\\",\\"s3:PutObject\\"],\\"Resource\\":[\\"arn:aws:s3:::cm-backup-data-123456789012/prod/daily/*\\"]}]}" > policy.json' },
      { label: 'public principal', command: 'printf "%s\\n" "{\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Principal\\":\\"*\\",\\"Action\\":\\"s3:GetObject\\",\\"Resource\\":\\"arn:aws:s3:::cm-backup-data-123456789012/prod/daily/*\\"}]}" > policy.json' },
      { label: 'malformed JSON', command: 'printf "%s\\n" not-json > policy.json' },
    ],
  },
};

function runDocker(command) {
  return spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--memory',
      '192m',
      '--cpus',
      '0.5',
      '--security-opt',
      'no-new-privileges',
      '--workdir',
      '/workspace',
      image,
      'bash',
      '-lc',
      command,
    ],
    { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' }
  );
}

function assertImageAvailable() {
  const result = spawnSync('docker', ['image', 'inspect', image], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`test image is unavailable: ${image}\n${result.stderr || ''}`);
  }
}

function runCase(label, challenge, submission, wantPass) {
  const command = [challenge.setupScript, submission, challenge.checkScript]
    .filter(Boolean)
    .join('\n');
  const result = runDocker(command);
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error || result.signal || result.status === 125) {
    throw new Error(`${label}: Docker execution failed\n${output}\n${result.error || result.signal || ''}`);
  }
  const passed = result.status === 0;
  if (passed !== wantPass) {
    throw new Error(`${label}: expected ${wantPass ? 'pass' : 'failure'}, got exit ${result.status}\n${output}`);
  }
  console.log(`${wantPass ? 'ok   ' : 'ok ! '} ${label}`);
}

function main() {
  const { challengeCatalog, challengeOrder } = loadCatalog();
  const missing = challengeOrder.filter((id) => !cases[id]);
  const extra = Object.keys(cases).filter((id) => !challengeOrder.includes(id));
  if (missing.length || extra.length) {
    throw new Error(
      `fixture map must match challengeOrder; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`
    );
  }

  assertImageAvailable();
  let total = 0;
  for (const id of challengeOrder) {
    const challenge = challengeCatalog[id];
    const testCase = cases[id];
    if (!challenge || typeof challenge.checkScript !== 'string') {
      throw new Error(`${id}: missing production checkScript`);
    }
    runCase(`${id}: valid submission`, challenge, testCase.pass, true);
    total += 1;
    for (const invalid of testCase.invalid) {
      runCase(`${id}: ${invalid.label}`, challenge, invalid.command, false);
      total += 1;
    }
  }
  console.log(`\n=== Results: ${total} production challenge cases passed ===`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
