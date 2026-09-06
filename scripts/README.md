# Link and asset audit

`scripts/link-audit.js` scans learner-facing HTML for local `href`, `src`,
and form `action` references and flags ones that don't resolve to a real
file in the repo. It never fetches external URLs — external links are
recorded for visibility only, never validated.

## Running it

```bash
# Full corpus (every learner HTML page) — same thing the scheduled workflow runs
node scripts/link-audit.js

# Only files changed since some git ref — same thing the PR check runs
node scripts/link-audit.js --changed-from origin/main

# (Re)generate the baseline from the current full-corpus scan
node scripts/link-audit.js --write-baseline
```

Reports are written to `reports/link-audit.json` and `reports/link-audit.txt`.
Query strings are removed from report targets so accidental tokens in markup
are not copied into CI artifacts.

## Finding classes

| Class | Meaning | Fails the gate? |
|---|---|---|
| `broken-local` | Local reference does not resolve to a file in the repo | Yes, unless in the baseline |
| `invalid-ignore-directive` | `data-qa-ignore-link` present with no reason text | Always yes — cannot be baselined |
| `ignored` | `data-qa-ignore-link="reason"` present, excluded intentionally | No |
| `runtime-generated` | Target contains `&#123;&#123;` or `${` (template syntax) | No |
| `external` | `http(s)://` URL — classified only, never fetched or checked | No |
| `ok` | Local reference resolves | No |

## The baseline (`scripts/link-baseline.json`)

Existing broken links are tracked explicitly in `scripts/link-baseline.json`,
one entry per `(file, type, target)`. Baselined findings are visible in
every report but do not fail the build. Anything **not** in the baseline
that is broken **does** fail the build — that's what actually catches new
drift.

Each entry must have a real `owner` and a short `note` (a ticket link is
ideal). `--write-baseline` will happily generate the file for you from a
full scan, but it fills `owner: "TODO"` — **someone has to replace every
`TODO` with a real owner before that baseline is merged.** An
auto-generated, un-owned baseline is not a reviewed baseline.

Removing a fixed entry from the baseline is expected and encouraged — the
scheduled full-corpus report lists any baseline entry that no longer
reproduces (`staleBaselineEntries`) as a reminder to clean it up.

**Do not add entries to the baseline to make a change pass CI.** The
baseline is for pre-existing, owned, tracked debt — not a way to silence a
new broken link you just introduced. If you introduce a new one, fix it or
route it through the ignore directive below (with a real reason).

On pull requests, the audit compares against the base branch's baseline and
fails if the change adds a baseline entry. Baseline growth requires a separate
reviewed change; it cannot silently suppress a new broken reference.

## Marking an intentional non-repo reference: `data-qa-ignore-link`

Some references are correct even though they don't point at a file in the
repo — a backend API route in a `<form action>`, a link built at runtime
from data the scanner can't see, etc. Mark these explicitly on the tag
itself, with a real reason:

```html
<form
  action="/api/session"
  method="post"
  data-qa-ignore-link="backend API route served by the terminal backend, not a repo file"
></form>
```

`data-qa-ignore-link=""` (present but empty) is treated as a bug in the
markup, not a valid exclusion — it will fail the gate as
`invalid-ignore-directive` until it has an actual reason. This is
intentionally narrow and per-reference: it does not create a blanket
allowlist for a file, a directory, or a URL pattern.
