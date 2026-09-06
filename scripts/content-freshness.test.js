'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const checker = path.join(__dirname, 'content-freshness.js');

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberminds-content-freshness-'));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function run(root, extraArgs = []) {
  const reportJson = path.join(root, 'reports', 'content-freshness.json');
  const reportText = path.join(root, 'reports', 'content-freshness.txt');
  const result = spawnSync(
    process.execPath,
    [checker, '--root', root, '--report-json', reportJson, '--report-text', reportText, ...extraArgs],
    { encoding: 'utf8' }
  );
  let report = null;
  if (fs.existsSync(reportJson)) report = JSON.parse(fs.readFileSync(reportJson, 'utf8'));
  return { ...result, report };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

const COURSE_CONTENTS_ONE_COURSE = `<html><body><section>
  <a href="../HTML/Courses and Activities/Course 3/Introductioncourse3.html" class="course-card">
    <div class="course-info"><div class="course-number"><p class="courseclass">Course 3</p></div><h2 class="course-title">Intro</h2></div>
  </a>
</section></body></html>`;

const COURSE_CONTENTS_WITH_TEASER = `<html><body><section>
  <a href="../HTML/Courses and Activities/Course 3/Introductioncourse3.html" class="course-card">
    <div class="course-info"><div class="course-number"><p class="courseclass">Course 3</p></div><h2 class="course-title">Intro</h2></div>
  </a>
  <a class="course-card c12trigger">
    <div class="course-info"><div class="course-number"><p class="courseclass">Course 12</p></div><h2 class="course-title">Coming soon!</h2></div>
  </a>
</section></body></html>`;

const CTF_ONE_CARD = `<html><body><section>
  <a href="terminal/index.html?challenge=linux-basics" class="course-card">
    <h2 class="course-title">Linux Basics Warmup</h2>
  </a>
</section></body></html>`;

function validManifest(overrides = {}) {
  return JSON.stringify({
    reviewCadenceDays: 180,
    entries: [
      {
        id: 'course-3',
        type: 'course',
        status: 'published',
        owner: 'Aditya',
        difficulty: 'Beginner',
        objective: 'Understand basic attacks.',
        lastReviewedAt: '2026-08-01',
      },
      {
        id: 'ctf-linux-basics',
        type: 'ctf',
        status: 'published',
        owner: 'Aditya',
        difficulty: 'Beginner',
        objective: 'Run pwd, whoami, ls -la.',
        lastReviewedAt: '2026-08-01',
      },
    ],
    ...overrides,
  });
}

test('passes when catalog cards, manifest, and page content all agree', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': CTF_ONE_CARD,
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>Real course content.</p>',
    'scripts/content-manifest.json': validManifest(),
  });
  const { status, report } = run(root);
  assert.equal(status, 0, JSON.stringify(report));
  assert.equal(report.findings.length, 0);
  cleanup(root);
});

test('flags a live course card with no manifest entry', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': JSON.stringify({ reviewCadenceDays: 180, entries: [] }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].class, 'undocumented-content');
  assert.equal(report.findings[0].id, 'course-3');
  cleanup(root);
});

test('a teaser card with no href requires an explicit, owned exception -- not silently skipped', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_WITH_TEASER,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest(),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  const finding = report.findings.find((f) => f.id === 'course-12');
  assert.ok(finding, 'expected a finding for the undocumented teaser card');
  assert.equal(finding.class, 'undocumented-content');
  cleanup(root);
});

test('a properly declared exception (owner + reason) passes for an unpublished card', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_WITH_TEASER,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [
        JSON.parse(validManifest()).entries[0],
        {
          id: 'course-12',
          type: 'course',
          status: 'intentionally-unpublished',
          owner: 'Harshith Gande',
          exceptionReason: 'Still in development.',
        },
      ],
    }),
  });
  const { status } = run(root);
  assert.equal(status, 0);
  cleanup(root);
});

test('an exception missing owner or reason fails as invalid-exception', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_WITH_TEASER,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [
        JSON.parse(validManifest()).entries[0],
        { id: 'course-12', type: 'course', status: 'intentionally-unpublished', owner: '', exceptionReason: '' },
      ],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  const invalid = report.findings.filter((f) => f.class === 'invalid-exception');
  assert.equal(invalid.length, 2); // missing owner AND missing reason
  cleanup(root);
});

test('flags a missing required field on a published entry', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: '', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2026-08-01' }],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'missing-field' && f.detail.includes('owner')));
  cleanup(root);
});

test('flags an invalid difficulty value', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Expert', objective: 'x', lastReviewedAt: '2026-08-01' }],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'invalid-difficulty'));
  cleanup(root);
});

test('flags a review date past the configured cadence', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      reviewCadenceDays: 30,
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2020-01-01' }],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'stale-review'));
  cleanup(root);
});

test('flags an unparseable review date', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: 'not-a-date' }],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'invalid-date'));
  cleanup(root);
});

test('detects placeholder copy in the actual course page content', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>Lorem ipsum dolor sit amet.</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2026-08-01' }],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  const hit = report.findings.find((f) => f.class === 'placeholder-detected');
  assert.ok(hit);
  assert.match(hit.detail, /Lorem ipsum/);
  cleanup(root);
});

test('does not flag legitimate content with no placeholder markers', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html':
      '<p>A cyberattack is an attempt to damage or gain access to a system.</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2026-08-01' }],
    }),
  });
  const { status } = run(root);
  assert.equal(status, 0);
  cleanup(root);
});

test('detects placeholder text inside a CTF objective in the manifest itself', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': '<html><body></body></html>',
    'HTML/CTF.html': CTF_ONE_CARD,
    'scripts/content-manifest.json': JSON.stringify({
      reviewCadenceDays: 180,
      entries: [
        {
          id: 'ctf-linux-basics',
          type: 'ctf',
          status: 'published',
          owner: 'A',
          difficulty: 'Beginner',
          objective: 'TODO: write the real objective',
          lastReviewedAt: '2026-08-01',
        },
      ],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'placeholder-detected' && f.id === 'ctf-linux-basics'));
  cleanup(root);
});

test('detects instructional placeholder text in a CTF objective', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': '<html><body></body></html>',
    'HTML/CTF.html': CTF_ONE_CARD,
    'scripts/content-manifest.json': JSON.stringify({
      reviewCadenceDays: 180,
      entries: [{
        id: 'ctf-linux-basics',
        type: 'ctf',
        status: 'published',
        owner: 'A',
        difficulty: 'Beginner',
        objective: 'fill in the real objective for this challenge.',
        lastReviewedAt: '2026-08-01',
      }],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'placeholder-detected' && f.id === 'ctf-linux-basics'));
  cleanup(root);
});

test('never executes page content -- a script tag with malicious code is inert', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html':
      '<script>global.PWNED = true;</script><p>Fine content.</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2026-08-01' }],
    }),
  });
  const { status } = run(root);
  assert.equal(status, 0);
  assert.equal(global.PWNED, undefined);
  cleanup(root);
});

test('a manifest entry with no matching catalog card is reported as an orphan, not a failure', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [
        { id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2026-08-01' },
        { id: 'course-99', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2026-08-01' },
      ],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 0); // orphans never fail the gate
  assert.equal(report.orphans.length, 1);
  assert.equal(report.orphans[0].id, 'course-99');
  cleanup(root);
});

test('--changed-from finds nothing to check when neither the catalog nor manifest changed', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': CTF_ONE_CARD,
    'scripts/content-manifest.json': validManifest(),
    'unrelated.txt': 'x',
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'changed');

  const { status } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 0);
  cleanup(root);
});

test('--changed-from catches a newly added course card with no manifest entry', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': CTF_ONE_CARD,
    'scripts/content-manifest.json': validManifest(),
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });

  const newCatalog = COURSE_CONTENTS_ONE_COURSE.replace(
    '</section>',
    '<a href="x/Course13.html" class="course-card"><div class="course-info"><div class="course-number"><p class="courseclass">Course 13</p></div><h2 class="course-title">New</h2></div></a></section>'
  );
  fs.writeFileSync(path.join(root, 'HTML/course_Contents.html'), newCatalog);

  const { status, report } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.id === 'course-13' && f.class === 'undocumented-content'));
  cleanup(root);
});

test('--changed-from catches a catalog entry removed from the manifest', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': CTF_ONE_CARD,
    'scripts/content-manifest.json': validManifest(),
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });

  const manifest = JSON.parse(validManifest());
  manifest.entries = manifest.entries.filter((entry) => entry.id !== 'course-3');
  fs.writeFileSync(path.join(root, 'scripts/content-manifest.json'), JSON.stringify(manifest));

  const { status, report } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.id === 'course-3' && f.class === 'undocumented-content'));
  cleanup(root);
});

test('--changed-from scans changed course HTML for placeholder copy', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': CTF_ONE_CARD,
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>Real course content.</p>',
    'scripts/content-manifest.json': validManifest(),
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });
  fs.writeFileSync(
    path.join(root, 'HTML/Courses and Activities/Course 3/Introductioncourse3.html'),
    '<p>TODO: replace this lesson content.</p>'
  );

  const { status, report } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'placeholder-detected' && f.id === 'course-3'));
  cleanup(root);
});

test('--changed-from fails when the manifest is deleted', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': CTF_ONE_CARD,
    'scripts/content-manifest.json': validManifest(),
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });
  fs.rmSync(path.join(root, 'scripts/content-manifest.json'));

  const { status, report } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'missing-input' && f.file === 'scripts/content-manifest.json'));
  cleanup(root);
});

test('--changed-from does not fail on pre-existing staleness when the catalog/manifest are untouched', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': CTF_ONE_CARD,
    'scripts/content-manifest.json': validManifest({
      entries: [
        { id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2020-01-01' },
        JSON.parse(validManifest()).entries[1],
      ],
    }),
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'unrelated.txt': 'x',
  });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'changed');

  // Full mode WOULD fail (stale review from 2020), but changed-from mode
  // should pass since neither the catalog nor the manifest were touched.
  const full = run(root);
  assert.equal(full.status, 1);

  const { status } = run(root, ['--changed-from', 'HEAD']);
  assert.equal(status, 0);
  cleanup(root);
});

test('rejects calendar dates that JavaScript would normalize', () => {
  const root = makeRepo({
    'HTML/course_Contents.html': COURSE_CONTENTS_ONE_COURSE,
    'HTML/CTF.html': '<html><body></body></html>',
    'HTML/Courses and Activities/Course 3/Introductioncourse3.html': '<p>x</p>',
    'scripts/content-manifest.json': validManifest({
      entries: [{ id: 'course-3', type: 'course', status: 'published', owner: 'A', difficulty: 'Beginner', objective: 'x', lastReviewedAt: '2026-02-31' }],
    }),
  });
  const { status, report } = run(root);
  assert.equal(status, 1);
  assert.ok(report.findings.some((f) => f.class === 'invalid-date'));
  cleanup(root);
});
