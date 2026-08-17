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
const currentYear = new Date().getFullYear();
const allowlist = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'qa-allowlist.json'), 'utf8')
);
const allowedOrigins = new Set(
  (allowlist.externalUrls || []).map((url) => new URL(url).origin)
);
const issues = [];

// ponytail: regex covers static HTML; use a parser if template syntax becomes complex.
const titleRe = /<title[^>]*>([\s\S]*?)<\/title>/i;
const imgRe = /<img\b([^<>]*?)\s*\/?>/gi;
const altRe = /\balt\s*=\s*["']([^"']*)["']/i;
const hrefRe = /\bhref\s*=\s*["']([^"']*)["']/gi;
const srcRe = /\bsrc\s*=\s*["']([^"']*)["']/gi;
const footerRe = /<footer[^>]*>([\s\S]*?)<\/footer>/gi;
const yearRe = /&copy;\s*(\d{4})/gi;

function relative(file) {
  return path.relative(repoRoot, file);
}

function report(file, message) {
  issues.push(`${relative(file)}: ${message}`);
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
    .map((file) => path.join(repoRoot, file));
}

function cleanReference(value) {
  return value.trim().split(/[?#]/, 1)[0];
}

function checkExternal(file, value, type) {
  try {
    const url = new URL(value);
    const origin = url.origin;
    if (!allowedOrigins.has(origin)) {
      const cleanRef = cleanReference(value);
      report(
        file,
        `Unallowlisted external ${type}: "${cleanRef}"\n    To approve this origin:\n    1. Update scripts/qa-allowlist.json with the origin: "${origin}"\n    2. Update docs/ORIGINS.md with purpose, data flow, and security justification\n    3. See docs/ORIGINS.md#appendix-how-to-add-a-new-external-origin for the full checklist`
      );
    }
  } catch {
    report(file, `Malformed external ${type}: "${cleanReference(value)}"`);
  }
}

function checkLocal(file, value, type) {
  const clean = cleanReference(value);
  if (!clean) return;

  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    report(file, `Malformed ${type}: "${clean}"`);
    return;
  }

  const resolved = decoded.startsWith('/')
    ? path.resolve(repoRoot, `.${decoded}`)
    : path.resolve(path.dirname(file), decoded);
  const insideRepo = resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`);
  if (!insideRepo || !fs.existsSync(resolved)) {
    report(file, `Broken ${type}: "${clean}"`);
  }
}

function checkReferences(file, content, regex, type) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const value = match[1].trim();
    if (!value || value.startsWith('#') || /^(mailto:|tel:|data:|blob:)/i.test(value)) {
      continue;
    }
    if (/^javascript:/i.test(value)) {
      report(file, `Unsafe ${type}: "javascript:"`);
    } else if (/^https?:/i.test(value)) {
      checkExternal(file, value, type);
    } else if (value.includes('{{') || value.includes('${')) {
      continue;
    } else {
      checkLocal(file, value, type);
    }
  }
}

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const activeContent = content.replace(/<!--[\s\S]*?-->/g, '');
  const rel = relative(file);
  const title = titleRe.exec(activeContent);
  if (!title) report(file, 'Missing <title> tag');
  else if (!title[1].trim()) report(file, 'Empty <title> tag');

  if (!(allowlist.skipAltChecks || []).includes(rel)) {
    imgRe.lastIndex = 0;
    let image;
    while ((image = imgRe.exec(activeContent)) !== null) {
      const attributes = image[1];
      const alt = altRe.exec(attributes);
      const decorative =
        /\brole\s*=\s*["'](?:none|presentation)["']/i.test(attributes) ||
        /\baria-hidden\s*=\s*["']true["']/i.test(attributes);
      if (!alt) report(file, '<img> missing alt attribute');
      else if (!alt[1].trim() && !decorative) {
        report(file, '<img> has empty alt without a decorative marker');
      }
    }
  }

  checkReferences(file, activeContent, hrefRe, 'link');
  checkReferences(file, activeContent, srcRe, 'asset');

  if (!/footer\.js/.test(activeContent)) {
    footerRe.lastIndex = 0;
    let footer;
    while ((footer = footerRe.exec(activeContent)) !== null) {
      yearRe.lastIndex = 0;
      let year;
      while ((year = yearRe.exec(footer[1])) !== null) {
        if (Number(year[1]) < currentYear) {
          report(file, `Stale footer year: ${year[1]} (current year is ${currentYear})`);
        }
      }
    }
  }
}

const base = option('--changed-from');
const files = (base ? changedHtmlFiles(base) : allHtmlFiles(repoRoot)).filter(
  (file) => !(allowlist.skipFiles || []).includes(relative(file))
);
for (const file of files) checkFile(file);

if (issues.length) {
  console.error(`Static HTML QA found ${issues.length} issue(s):\n${issues.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Static HTML QA passed for ${files.length} file(s).`);
}
