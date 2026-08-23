'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.lastIndexOf(name);
  return index === -1 ? null : args[index + 1];
};
const hasFlag = (name) => args.includes(name);

const repoRoot = path.resolve(option('--root') || path.join(__dirname, '..'));
const baselinePath = path.resolve(
  option('--baseline') || path.join(repoRoot, 'scripts', 'link-baseline.json')
);
const reportJsonPath = path.resolve(
  option('--report-json') || path.join(repoRoot, 'reports', 'link-audit.json')
);
const reportTextPath = path.resolve(
  option('--report-text') || path.join(repoRoot, 'reports', 'link-audit.txt')
);
const changedFrom = option('--changed-from');
const writeBaselineMode = hasFlag('--write-baseline');
const mode = changedFrom ? 'changed' : 'full';


const REF_ATTR_BY_TAG = {
  a: 'href',
  area: 'href',
  link: 'href',
  script: 'src',
  img: 'src',
  source: 'src',
  iframe: 'src',
  audio: 'src',
  video: 'src',
  embed: 'src',
  form: 'action',
};

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^<>]*?)\/?>/g;

function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const match = re.exec(attrs);
  if (!match) return null;
  return match[2] !== undefined ? match[2] : match[3];
}


function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function allHtmlFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) allHtmlFiles(fullPath, files);
    else if (entry.name.endsWith('.html')) files.push(fullPath);
  }
  return files;
}

function changedHtmlFiles(base) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', base, '--', '*.html'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((file) => path.join(repoRoot, file))
    .filter((file) => fs.existsSync(file));
}

// ─── reference classification ───────────────────────────────────────────────

function cleanReference(value) {
  return value.trim().split(/[?#]/, 1)[0];
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function resolveLocal(file, value) {
  const clean = cleanReference(value);
  if (!clean) return { clean, resolved: null, insideRepo: true, exists: true };

  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return { clean, resolved: null, insideRepo: false, exists: false };
  }

  const resolved = decoded.startsWith('/')
    ? path.resolve(repoRoot, `.${decoded}`)
    : path.resolve(path.dirname(file), decoded);
  const insideRepo =
    resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`);

  return {
    clean,
    resolved,
    insideRepo,
    exists: insideRepo && fs.existsSync(resolved),
  };
}

/**
 * Classify a single attribute value found on a tag. Returns null when the
 * value doesn't need any further handling (empty, in-page fragment,
 * non-navigable scheme).
 *
 * `absFile` (absolute path) is used for resolving local targets so behavior
 * never depends on process.cwd(). `relFile` (repo-relative) is only used for
 * the human/JSON-facing "file" field on the finding.
 */
function classifyReference({ absFile, relFile, line, tag, attrName, rawValue, ignoreReason }) {
  const value = (rawValue || '').trim();
  if (!value) return null;

  if (ignoreReason !== null) {
    if (!ignoreReason.trim()) {
      return {
        file: relFile,
        line,
        tag,
        type: attrName,
        target: cleanReference(value),
        class: 'invalid-ignore-directive',
        detail: 'data-qa-ignore-link is present but has no reason text',
      };
    }
    return {
      file: relFile,
      line,
      tag,
      type: attrName,
      target: cleanReference(value),
      class: 'ignored',
      detail: ignoreReason.trim(),
    };
  }

  if (value.startsWith('#')) return null; // in-page fragment
  if (/^(mailto:|tel:|data:|blob:|javascript:)/i.test(value)) return null; // not a site-local navigation target

  if (value.includes('{{') || value.includes('${')) {
    return {
      file: relFile,
      line,
      tag,
      type: attrName,
      target: value,
      class: 'runtime-generated',
    };
  }

  if (/^https?:/i.test(value)) {
    return {
      file: relFile,
      line,
      tag,
      type: attrName,
      target: value,
      class: 'external',
    };
  }

  const { clean, exists } = resolveLocal(absFile, value);
  return {
    file: relFile,
    line,
    tag,
    type: attrName,
    target: clean,
    class: exists ? 'ok' : 'broken-local',
  };
}

function scanFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const active = content.replace(/<!--[\s\S]*?-->/g, (comment) =>
    // Preserve line numbers while blanking out comment contents so
    // commented-out markup is never scanned.
    comment.replace(/[^\n]/g, ' ')
  );

  const rel = relative(file);
  const findings = [];

  TAG_RE.lastIndex = 0;
  let match;
  while ((match = TAG_RE.exec(active)) !== null) {
    const tag = match[1].toLowerCase();
    const attrName = REF_ATTR_BY_TAG[tag];
    if (!attrName) continue;

    const attrs = match[2] || '';
    const rawValue = getAttr(attrs, attrName);
    if (rawValue === null) continue;

    const ignoreAttr = getAttr(attrs, 'data-qa-ignore-link');
    const line = lineNumberAt(active, match.index);

    const finding = classifyReference({
      absFile: file,
      relFile: rel,
      line,
      tag,
      attrName,
      rawValue,
      ignoreReason: ignoreAttr,
    });
    if (finding) findings.push(finding);
  }

  return findings;
}

// ─── baseline ────────────────────────────────────────────────────────────

function findingKey(finding) {
  return `${finding.file}::${finding.type}::${finding.target}`;
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) {
    return { generatedAt: null, entries: [] };
  }
  const raw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  return { generatedAt: raw.generatedAt || null, entries: raw.entries || [] };
}

function writeBaseline(entries) {
  const payload = {
    generatedAt: new Date().toISOString(),
    description:
      'Reviewed, owned baseline of known broken local links/assets. ' +
      'Entries here do not fail the quality gate. New findings not listed ' +
      'here DO fail the gate. Remove an entry once it is fixed; do not ' +
      'widen this file into a general suppression list.',
    entries,
  };
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
}

// ─── main ────────────────────────────────────────────────────────────────

function main() {
  const files = (changedFrom ? changedHtmlFiles(changedFrom) : allHtmlFiles(repoRoot))
    .filter((file) => fs.existsSync(file));

  const allFindings = [];
  for (const file of files) {
    allFindings.push(...scanFile(file));
  }

  const brokenFindings = allFindings.filter((f) => f.class === 'broken-local');
  const invalidIgnoreFindings = allFindings.filter(
    (f) => f.class === 'invalid-ignore-directive'
  );
  const ignoredFindings = allFindings.filter((f) => f.class === 'ignored');

  if (writeBaselineMode) {
    if (invalidIgnoreFindings.length) {
      console.error(
        `Refusing to write baseline: ${invalidIgnoreFindings.length} data-qa-ignore-link ` +
          `attribute(s) are missing a reason. Fix these first:\n` +
          invalidIgnoreFindings
            .map((f) => `  ${f.file}:${f.line} [${f.type}] "${f.target}"`)
            .join('\n')
      );
      process.exitCode = 1;
      return;
    }
    if (mode !== 'full') {
      console.error('--write-baseline requires a full-corpus scan (do not pass --changed-from).');
      process.exitCode = 1;
      return;
    }
    const entries = brokenFindings
      .map((f) => ({
        file: f.file,
        type: f.type,
        target: f.target,
        owner: 'TODO',
        note: 'Auto-generated by --write-baseline. Assign a real owner and a short note before merging.',
        line: f.line,
      }))
      .sort(
        (a, b) =>
          a.file.localeCompare(b.file) ||
          a.type.localeCompare(b.type) ||
          a.target.localeCompare(b.target)
      );
    writeBaseline(entries);
    console.log(
      `Wrote ${entries.length} baseline entrie(s) to ${relative(baselinePath)}. ` +
        `Every entry has owner: "TODO" -- assign real owners before merging this baseline.`
    );
    return;
  }

  const baseline = loadBaseline();
  const baselineKeys = new Set(baseline.entries.map((e) => findingKey(e)));

  const newBroken = brokenFindings.filter((f) => !baselineKeys.has(findingKey(f)));
  const knownBroken = brokenFindings.filter((f) => baselineKeys.has(findingKey(f)));

  let staleBaseline = [];
  if (mode === 'full') {
    const currentBrokenKeys = new Set(brokenFindings.map((f) => findingKey(f)));
    const scannedFiles = new Set(files.map((f) => relative(f)));
    staleBaseline = baseline.entries.filter(
      (e) => scannedFiles.has(e.file) && !currentBrokenKeys.has(findingKey(e))
    );
  }

  // ── reports ──
  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    filesScanned: files.length,
    summary: {
      newBroken: newBroken.length,
      knownBroken: knownBroken.length,
      invalidIgnoreDirectives: invalidIgnoreFindings.length,
      ignored: ignoredFindings.length,
      staleBaselineEntries: staleBaseline.length,
    },
    newBroken,
    knownBroken,
    invalidIgnoreDirectives: invalidIgnoreFindings,
    ignored: ignoredFindings,
    staleBaselineEntries: staleBaseline,
  };

  const lines = [];
  lines.push(`Link/asset audit (${mode}) - ${files.length} file(s) scanned`);
  lines.push('');

  if (newBroken.length) {
    lines.push(`NEW broken local reference(s): ${newBroken.length}`);
    for (const f of newBroken) {
      lines.push(`  ${f.file}:${f.line} [${f.type}] "${f.target}"`);
    }
    lines.push('');
  }

  if (invalidIgnoreFindings.length) {
    lines.push(`Invalid ignore directive(s) (missing reason): ${invalidIgnoreFindings.length}`);
    for (const f of invalidIgnoreFindings) {
      lines.push(`  ${f.file}:${f.line} [${f.type}] "${f.target}"`);
    }
    lines.push('');
  }

  if (knownBroken.length) {
    lines.push(`Known baseline debt (not failing): ${knownBroken.length}`);
    for (const f of knownBroken) {
      lines.push(`  ${f.file}:${f.line} [${f.type}] "${f.target}"`);
    }
    lines.push('');
  }

  if (ignoredFindings.length) {
    lines.push(`Intentionally ignored (data-qa-ignore-link): ${ignoredFindings.length}`);
    for (const f of ignoredFindings) {
      lines.push(`  ${f.file}:${f.line} [${f.type}] "${f.target}" -- ${f.detail}`);
    }
    lines.push('');
  }

  if (staleBaseline.length) {
    lines.push(
      `Stale baseline entries (target now resolves or file gone -- remove from baseline): ${staleBaseline.length}`
    );
    for (const e of staleBaseline) {
      lines.push(`  ${e.file} [${e.type}] "${e.target}" (owner: ${e.owner || 'unknown'})`);
    }
    lines.push('');
  }

  if (!newBroken.length && !invalidIgnoreFindings.length) {
    lines.push('No new broken local references found.');
  }

  const text = lines.join('\n');

  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.mkdirSync(path.dirname(reportTextPath), { recursive: true });
  fs.writeFileSync(reportTextPath, `${text}\n`);

  console.log(text);

  if (newBroken.length || invalidIgnoreFindings.length) {
    process.exitCode = 1;
  }
}

main();