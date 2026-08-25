'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const checker = path.join(__dirname, 'link-audit.js');

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberminds-link-audit-'));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function run(root, extraArgs = []) {
  const reportJson = path.join(root, 'reports', 'link-audit.json');
  const reportText = path.join(root, 'reports', 'link-audit.txt');
  const result = spawnSync(
    process.execPath,
    [
      checker,
      '--root',
      root,
      '--report-json',
      reportJson,
      '--report-text',
      reportText,
      ...extraArgs,
    ],
    { encoding: 'utf8' }
  );
  let report = null;
  if (fs.existsSync(reportJson)) {
    report = JSON.parse(fs.readFileSync(reportJson, 'utf8'));
  }
  return { ...result, report };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('passes when all local references resolve', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="page.html">Page</a><img src="pic.png" alt="">',
    'page.html': '<title>Page</title>',
    'pic.png': '',
  });
  const { status, report } = run(root);
  assert.equal(status, 0);
  assert.equal(report.summary.newBroken, 0);
  cleanup(root);
});

test('flags a broken local href with correct file and line number', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title>\n\n<a href="missing.html">Broken</a>\n',
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.newBroken.length, 1);
  assert.equal(report.newBroken[0].file, 'index.html');
  assert.equal(report.newBroken[0].line, 3);
  assert.equal(report.newBroken[0].target, 'missing.html');
  cleanup(root);
});

test('flags a broken form action separately from href/src', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><form action="missing-handler.html"></form>',
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.newBroken[0].type, 'action');
  cleanup(root);
});

test('flags a broken script/img src', () => {
  const root = makeRepo({
    'index.html':
      '<title>Home</title><script src="missing.js"></script><img src="missing.png" alt="">',
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.newBroken.length, 2);
  const types = report.newBroken.map((f) => f.type).sort();
  assert.deepEqual(types, ['src', 'src']);
  cleanup(root);
});

test('does not flag or fetch external http(s) URLs', () => {
  const root = makeRepo({
    'index.html':
      '<title>Home</title><a href="https://nonexistent.invalid.example/path">External</a>',
  });
  const { status } = run(root);
  assert.equal(status, 0);
  cleanup(root);
});

test('does not copy external query-string values into reports', () => {
  const root = makeRepo({
    'index.html':
      '<title>Home</title><a href="https://example.invalid/path?token=super-secret-value">External</a>',
  });
  const { status, report } = run(root);
  assert.equal(status, 0);
  assert.equal(report.external[0].target, 'https://example.invalid/path');
  assert.doesNotMatch(JSON.stringify(report), /super-secret-value/);
  cleanup(root);
});

test('classifies template-syntax references as runtime-generated, not broken', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="dynamic/{{id}}/page.html">Templated</a>',
  });
  const { status, report } = run(root);
  assert.equal(status, 0);
  assert.equal(report.summary.newBroken, 0);
  cleanup(root);
});

test('skips in-page fragments and non-navigable schemes', () => {
  const root = makeRepo({
    'index.html':
      '<title>Home</title><a href="#section">Anchor</a><a href="mailto:a@b.com">Mail</a><a href="tel:+15551234567">Tel</a>',
  });
  const { status, report } = run(root);
  assert.equal(status, 0);
  assert.equal(report.summary.newBroken, 0);
  cleanup(root);
});

test('ignores commented-out markup', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><!-- <a href="missing.html">Draft</a> -->',
  });
  const { status } = run(root);
  assert.equal(status, 0);
  cleanup(root);
});

test('data-qa-ignore-link with a reason passes and is reported as ignored, not broken', () => {
  const root = makeRepo({
    'index.html':
      '<title>Home</title><a href="/dynamic/route.html" data-qa-ignore-link="server-rendered at runtime, ticket CM-1">Runtime</a>',
  });
  const { status, report } = run(root);
  assert.equal(status, 0);
  assert.equal(report.summary.newBroken, 0);
  assert.equal(report.ignored.length, 1);
  assert.equal(report.ignored[0].detail, 'server-rendered at runtime, ticket CM-1');
  cleanup(root);
});

test('data-qa-ignore-link WITHOUT a reason fails as an invalid directive', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="/dynamic/route.html" data-qa-ignore-link="">Runtime</a>',
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.invalidIgnoreDirectives.length, 1);
  cleanup(root);
});

test('a finding present in the baseline does not fail the gate', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="missing.html">Broken</a>',
    'scripts/link-baseline.json': JSON.stringify({
      generatedAt: '2026-01-01T00:00:00.000Z',
      entries: [
        {
          file: 'index.html',
          type: 'href',
          target: 'missing.html',
          owner: 'frontend-team',
          note: 'Known debt, tracked in TICKET-123',
        },
      ],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 0);
  assert.equal(report.summary.newBroken, 0);
  assert.equal(report.summary.knownBroken, 1);
  cleanup(root);
});

test('a NEW broken reference fails even when other baseline entries exist', () => {
  const root = makeRepo({
    'index.html':
      '<title>Home</title><a href="missing-known.html">Known</a><a href="missing-new.html">New</a>',
    'scripts/link-baseline.json': JSON.stringify({
      generatedAt: '2026-01-01T00:00:00.000Z',
      entries: [
        {
          file: 'index.html',
          type: 'href',
          target: 'missing-known.html',
          owner: 'frontend-team',
          note: 'tracked',
        },
      ],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.summary.newBroken, 1);
  assert.equal(report.newBroken[0].target, 'missing-new.html');
  assert.equal(report.summary.knownBroken, 1);
  cleanup(root);
});

test('a changed file cannot add its broken reference to the baseline to pass', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="page.html">Page</a>',
    'page.html': '<title>Page</title>',
    'scripts/link-baseline.json': JSON.stringify({
      entries: [
        {
          file: 'old.html',
          type: 'href',
          target: 'old-missing.html',
          owner: 'frontend-team',
          note: 'Existing reviewed debt',
        },
      ],
    }),
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'],
    { cwd: root }
  );

  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<title>Home</title><a href="new-broken.html">New</a>'
  );
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scripts', 'link-baseline.json'),
    JSON.stringify({
      entries: [
        {
          file: 'old.html',
          type: 'href',
          target: 'old-missing.html',
          owner: 'frontend-team',
          note: 'Existing reviewed debt',
        },
        {
          file: 'index.html',
          type: 'href',
          target: 'new-broken.html',
          owner: 'frontend-team',
          note: 'Tracked baseline entry',
        },
      ],
    })
  );

  const { status, report } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 1);
  assert.equal(report.summary.baselineEntriesAdded, 1);
  assert.equal(report.summary.newBroken, 1);
  cleanup(root);
});

test('rejects an unowned baseline entry', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="missing.html">Broken</a>',
    'scripts/link-baseline.json': JSON.stringify({
      entries: [
        {
          file: 'index.html',
          type: 'href',
          target: 'missing.html',
          owner: 'TODO',
          note: 'Auto-generated by --write-baseline.',
        },
      ],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.summary.invalidBaselineEntries, 1);
  cleanup(root);
});

test('never resolves a reference outside the repo root, even via traversal', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="../../../etc/passwd">Traversal</a>',
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.newBroken[0].class, 'broken-local');
  assert.equal(report.newBroken[0].target, '../../../etc/passwd');
  cleanup(root);
});

test('never includes query-string values (potential tokens) in report output', () => {
  const root = makeRepo({
    'index.html':
      '<title>Home</title><a href="missing.html?token=super-secret-value">Broken with token</a>',
  });
  const { report } = run(root);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /super-secret-value/);
  assert.equal(report.newBroken[0].target, 'missing.html');
  cleanup(root);
});

test('--write-baseline snapshots current broken-local findings with TODO owners', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="missing.html">Broken</a>',
  });
  const { status } = run(root, ['--write-baseline']);
  assert.equal(status, 0);
  const baseline = JSON.parse(
    fs.readFileSync(path.join(root, 'scripts', 'link-baseline.json'), 'utf8')
  );
  assert.equal(baseline.entries.length, 1);
  assert.equal(baseline.entries[0].owner, 'TODO');
  assert.equal(baseline.entries[0].target, 'missing.html');
  cleanup(root);
});

test('--write-baseline refuses to run while invalid ignore directives exist', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="/x.html" data-qa-ignore-link="">Bad</a>',
  });
  const { status } = run(root, ['--write-baseline']);
  assert.equal(status, 1);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'link-baseline.json')), false);
  cleanup(root);
});

test('--changed-from scans only files changed since the given ref', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="page.html">Page</a>',
    'page.html': '<title>Page</title><a href="missing-in-page.html">Broken</a>',
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'],
    { cwd: root }
  );

  // Only touch index.html; page.html (with the broken link) stays untouched.
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<title>Home</title><a href="page.html">Page updated</a>'
  );

  const { status, report } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 0);
  assert.equal(report.filesScanned, 1);
  cleanup(root);
});

test('--changed-from fails on a NEW broken reference in a changed file', () => {
  const root = makeRepo({
    'index.html': '<title>Home</title><a href="page.html">Page</a>',
    'page.html': '<title>Page</title>',
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'],
    { cwd: root }
  );

  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<title>Home</title><a href="page.html">Page</a><a href="new-broken.html">New</a>'
  );

  const { status, report } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 1);
  assert.equal(report.newBroken[0].target, 'new-broken.html');
  cleanup(root);
});
