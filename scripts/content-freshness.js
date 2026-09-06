'use strict';


const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.lastIndexOf(name);
  return index === -1 ? null : args[index + 1];
};

const repoRoot = path.resolve(option('--root') || path.join(__dirname, '..'));
const manifestPath = path.resolve(
  option('--manifest') || path.join(repoRoot, 'scripts', 'content-manifest.json')
);
const courseContentsPath = path.resolve(
  option('--course-contents') || path.join(repoRoot, 'HTML', 'course_Contents.html')
);
const ctfCatalogPath = path.resolve(
  option('--ctf-catalog') || path.join(repoRoot, 'HTML', 'CTF.html')
);
const reportJsonPath = path.resolve(
  option('--report-json') || path.join(repoRoot, 'reports', 'content-freshness.json')
);
const reportTextPath = path.resolve(
  option('--report-text') || path.join(repoRoot, 'reports', 'content-freshness.txt')
);
const changedFrom = option('--changed-from');
const mode = changedFrom ? 'changed' : 'full';
const DEFAULT_REVIEW_CADENCE_DAYS = 180;


const ALLOWED_DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
const REQUIRED_PUBLISHED_FIELDS = ['owner', 'difficulty', 'objective', 'lastReviewedAt'];

function loadManifest() {
  if (!fs.existsSync(manifestPath)) {
    return { reviewCadenceDays: DEFAULT_REVIEW_CADENCE_DAYS, entries: [] };
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    reviewCadenceDays: raw.reviewCadenceDays || DEFAULT_REVIEW_CADENCE_DAYS,
    entries: raw.entries || [],
  };
}


function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateSnippet(text, max = 140) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}\u2026` : clean;
}

const PLACEHOLDER_PATTERNS = [
  { re: /lorem ipsum/i, label: 'Lorem ipsum placeholder text' },
  { re: /\btodo\b/i, label: '"TODO" marker' },
  { re: /\btbd\b/i, label: '"TBD" marker' },
  { re: /\bfixme\b/i, label: '"FIXME" marker' },
  { re: /coming soon/i, label: '"coming soon" placeholder copy' },
  { re: /\bplaceholder\b/i, label: 'the word "placeholder"' },
  { re: /content (goes|coming) here/i, label: 'generic "content goes/coming here" placeholder' },
  { re: /under construction/i, label: '"under construction" placeholder copy' },
];

function scanForPlaceholders(text) {
  const hits = [];
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(text.length, match.index + match[0].length + 40);
      hits.push({ label, snippet: truncateSnippet(text.slice(start, end)) });
    }
  }
  return hits;
}

// ─── catalog card extraction ────────────────────────────────────────────

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

/**
 * Extract every course card from course_Contents.html. A card with no
 * `href` (a teaser/"coming soon" card) is still returned, with
 * `published: false`, so it can be matched against an explicit manifest
 * exception rather than silently ignored.
 */
function extractCourseCards(content) {
  const cardRe = /<a\b([^<>]*\bcourse-card\b[^<>]*)>([\s\S]*?)<\/a>/gi;
  const cards = [];
  let match;
  while ((match = cardRe.exec(content)) !== null) {
    const openTag = match[1];
    const inner = match[2];
    const hrefMatch = /\bhref\s*=\s*"([^"]*)"/i.exec(openTag);
    const numberMatch = /<p class="courseclass">\s*Course\s+(\d+)\s*<\/p>/i.exec(inner);
    if (!numberMatch) continue; // not a recognisable numbered course card
    const titleMatch = /<h2 class="course-title">([\s\S]*?)<\/h2>/i.exec(inner);
    cards.push({
      id: `course-${numberMatch[1]}`,
      number: numberMatch[1],
      href: hrefMatch ? hrefMatch[1] : null,
      published: !!hrefMatch,
      title: titleMatch ? htmlToText(titleMatch[1]) : null,
    });
  }
  return cards;
}

/**
 * Extract every CTF card from CTF.html, keyed by the ?challenge= id in its
 * href. Mirrors the same pattern used by
 * tests/ctf-catalog-consistency.spec.js.
 */
function extractCtfCards(content) {
  const cardRe = /<a\b([^<>]*\bcourse-card\b[^<>]*)>([\s\S]*?)<\/a>/gi;
  const cards = [];
  let match;
  while ((match = cardRe.exec(content)) !== null) {
    const openTag = match[1];
    const inner = match[2];
    const hrefMatch = /\bhref\s*=\s*"([^"]*)"/i.exec(openTag);
    if (!hrefMatch) continue;
    let challengeId = null;
    try {
      const url = new URL(hrefMatch[1], 'https://example.invalid/HTML/CTF.html');
      challengeId = url.searchParams.get('challenge');
    } catch {
      challengeId = null;
    }
    if (!challengeId) continue;
    const titleMatch = /<h2 class="course-title">([\s\S]*?)<\/h2>/i.exec(inner);
    cards.push({
      id: `ctf-${challengeId}`,
      challengeId,
      href: hrefMatch[1],
      published: true,
      title: titleMatch ? htmlToText(titleMatch[1]) : null,
    });
  }
  return cards;
}

// ─── entry validation ───────────────────────────────────────────

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function validateEntry(entry, reviewCadenceDays, now) {
  const findings = [];
  const id = entry.id || '(missing id)';

  if (entry.status === 'intentionally-unpublished') {
    if (isBlank(entry.owner)) {
      findings.push({ id, class: 'invalid-exception', detail: 'exception is missing an owner' });
    }
    if (isBlank(entry.exceptionReason)) {
      findings.push({ id, class: 'invalid-exception', detail: 'exception is missing a reason' });
    }
    return findings;
  }

  if (entry.status !== 'published') {
    findings.push({
      id,
      class: 'invalid-status',
      detail: `status must be "published" or "intentionally-unpublished", got "${entry.status}"`,
    });
    return findings;
  }

  for (const field of REQUIRED_PUBLISHED_FIELDS) {
    if (isBlank(entry[field])) {
      findings.push({ id, class: 'missing-field', detail: `missing required field "${field}"` });
    }
  }

  if (!isBlank(entry.difficulty) && !ALLOWED_DIFFICULTIES.includes(entry.difficulty)) {
    findings.push({
      id,
      class: 'invalid-difficulty',
      detail: `difficulty "${entry.difficulty}" is not one of ${ALLOWED_DIFFICULTIES.join(', ')}`,
    });
  }

  if (!isBlank(entry.lastReviewedAt)) {
    const reviewed = new Date(entry.lastReviewedAt);
    if (Number.isNaN(reviewed.getTime())) {
      findings.push({
        id,
        class: 'invalid-date',
        detail: `lastReviewedAt "${entry.lastReviewedAt}" is not a valid date`,
      });
    } else {
      const age = daysBetween(reviewed, now);
      if (age > reviewCadenceDays) {
        findings.push({
          id,
          class: 'stale-review',
          detail: `last reviewed ${age} day(s) ago, exceeds the ${reviewCadenceDays}-day cadence`,
        });
      }
    }
  }

  return findings;
}

// ─── coverage cross-check ────────────────────────────────────────────────

function crossCheck(cards, entries, type) {
  const findings = [];
  const byId = new Map(entries.filter((e) => e.type === type).map((e) => [e.id, e]));
  const seen = new Set();

  for (const card of cards) {
    seen.add(card.id);
    const entry = byId.get(card.id);
    if (!entry) {
      findings.push({
        id: card.id,
        class: 'undocumented-content',
        detail: card.published
          ? `live ${type} card has no manifest entry`
          : `unpublished/teaser ${type} card has no manifest entry documenting the exception`,
      });
      continue;
    }
    if (card.published && entry.status !== 'published') {
      findings.push({
        id: card.id,
        class: 'status-mismatch',
        detail: `card is live (has a target) but manifest marks it "${entry.status}"`,
      });
    }
    if (!card.published && entry.status === 'published') {
      findings.push({
        id: card.id,
        class: 'status-mismatch',
        detail: 'manifest marks this published but the catalog card has no live target',
      });
    }
  }

  const orphans = [];
  for (const [id] of byId) {
    if (!seen.has(id)) {
      orphans.push({ id, class: 'orphan-manifest-entry', detail: `no matching ${type} card found in the catalog` });
    }
  }

  return { findings, orphans };
}

// ─── placeholder scanning of actual page content ────────────────────────

function courseDirectory(entry) {
  if (entry.directory) return path.resolve(repoRoot, entry.directory);
  const num = String(entry.id || '').replace(/^course-/, '');
  return path.resolve(repoRoot, 'HTML', 'Courses and Activities', `Course ${num}`);
}

function scanCoursePlaceholders(entry) {
  const dir = courseDirectory(entry);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [{ id: entry.id, class: 'missing-content-directory', detail: `course directory not found: ${relative(dir)}` }];
  }
  const findings = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.html')) continue;
    const file = path.join(dir, name);
    const text = htmlToText(fs.readFileSync(file, 'utf8'));
    for (const hit of scanForPlaceholders(text)) {
      findings.push({
        id: entry.id,
        class: 'placeholder-detected',
        file: relative(file),
        detail: `${hit.label}: "${hit.snippet}"`,
      });
    }
  }
  return findings;
}

function scanCtfPlaceholders(entry) {
  const text = [entry.title, entry.objective].filter(Boolean).join(' ');
  return scanForPlaceholders(text).map((hit) => ({
    id: entry.id,
    class: 'placeholder-detected',
    file: relative(manifestPath),
    detail: `${hit.label} in manifest objective/title: "${hit.snippet}"`,
  }));
}

// ─── changed-file helper ──────────────────────────

function changedFiles(base, files) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', base, '--', ...files],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  return new Set(output.trim().split('\n').filter(Boolean));
}

// ─── report writing ──────────────────────────────────────────────────────

function writeReports(report) {
  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [];
  lines.push(`Content freshness check (${report.mode})`);
  lines.push('');
  const groups = [
    ['undocumented-content', 'Undocumented content (no manifest entry)'],
    ['invalid-exception', 'Invalid exception (missing owner/reason)'],
    ['invalid-status', 'Invalid manifest status'],
    ['missing-field', 'Missing required field'],
    ['invalid-difficulty', 'Invalid difficulty value'],
    ['invalid-date', 'Invalid lastReviewedAt date'],
    ['stale-review', 'Review overdue'],
    ['placeholder-detected', 'Placeholder copy detected'],
    ['status-mismatch', 'Manifest/catalog status mismatch'],
    ['missing-content-directory', 'Course directory missing on disk'],
  ];
  for (const [cls, label] of groups) {
    const items = report.findings.filter((f) => f.class === cls);
    if (!items.length) continue;
    lines.push(`${label}: ${items.length}`);
    for (const f of items) {
      const loc = f.file ? ` (${f.file})` : '';
      lines.push(`  ${f.id}${loc}: ${f.detail}`);
    }
    lines.push('');
  }
  if (report.orphans.length) {
    lines.push(`Orphan manifest entries (not failing, cleanup reminder): ${report.orphans.length}`);
    for (const o of report.orphans) {
      lines.push(`  ${o.id}: ${o.detail}`);
    }
    lines.push('');
  }
  if (!report.findings.length) {
    lines.push('No content freshness issues found.');
  }
  fs.mkdirSync(path.dirname(reportTextPath), { recursive: true });
  fs.writeFileSync(reportTextPath, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

// ─── main ────────────────────────────────────────────────────────────────

function main() {
  const manifest = loadManifest();
  const now = new Date();

  if (mode === 'changed') {
    const relevant = ['scripts/content-manifest.json', 'HTML/course_Contents.html', 'HTML/CTF.html'];
    const changed = changedFiles(changedFrom, relevant);
    const findings = [];

    if (changed.has('HTML/course_Contents.html')) {
      const cards = extractCourseCards(fs.readFileSync(courseContentsPath, 'utf8'));
      findings.push(...crossCheck(cards, manifest.entries, 'course').findings);
    }
    if (changed.has('HTML/CTF.html')) {
      const cards = extractCtfCards(fs.readFileSync(ctfCatalogPath, 'utf8'));
      findings.push(...crossCheck(cards, manifest.entries, 'ctf').findings);
    }
    if (changed.has('scripts/content-manifest.json')) {
      for (const entry of manifest.entries) {
        findings.push(...validateEntry(entry, manifest.reviewCadenceDays, now));
      }
    }

    const report = { generatedAt: now.toISOString(), mode, findings, orphans: [] };
    writeReports(report);
    if (findings.length) process.exitCode = 1;
    return;
  }

  // full mode
  const courseCards = extractCourseCards(fs.readFileSync(courseContentsPath, 'utf8'));
  const ctfCards = extractCtfCards(fs.readFileSync(ctfCatalogPath, 'utf8'));

  const courseCheck = crossCheck(courseCards, manifest.entries, 'course');
  const ctfCheck = crossCheck(ctfCards, manifest.entries, 'ctf');

  const findings = [...courseCheck.findings, ...ctfCheck.findings];
  const orphans = [...courseCheck.orphans, ...ctfCheck.orphans];

  const courseOrphanIds = new Set(courseCheck.orphans.map((o) => o.id));
  const ctfOrphanIds = new Set(ctfCheck.orphans.map((o) => o.id));

  for (const entry of manifest.entries) {
    findings.push(...validateEntry(entry, manifest.reviewCadenceDays, now));
    if (entry.status !== 'published') continue;
    if (entry.type === 'course' && !courseOrphanIds.has(entry.id)) {
      findings.push(...scanCoursePlaceholders(entry));
    }
    if (entry.type === 'ctf' && !ctfOrphanIds.has(entry.id)) {
      findings.push(...scanCtfPlaceholders(entry));
    }
  }

  const report = {
    generatedAt: now.toISOString(),
    mode,
    reviewCadenceDays: manifest.reviewCadenceDays,
    coursesScanned: courseCards.length,
    ctfsScanned: ctfCards.length,
    findings,
    orphans,
  };
  writeReports(report);
  if (findings.length) process.exitCode = 1;
}

main();