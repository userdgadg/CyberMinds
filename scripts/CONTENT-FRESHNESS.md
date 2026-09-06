# Content freshness

`scripts/content-freshness.js` cross-checks `scripts/content-manifest.json`
against the live course catalog (`HTML/course_Contents.html`) and CTF
catalog (`HTML/CTF.html`) to catch stale or incomplete learning content
before it reaches learners: missing owner/difficulty/objective/review
metadata, overdue reviews, placeholder copy, and courses or CTF challenges
that are live on the site but not tracked in the manifest at all.

It never executes page HTML/JS and never fetches anything over the
network — page content is read as plain text only, then regex-stripped to
extract visible copy for the placeholder scan. It collects no learner data;
it only reads static repo files.

## Running it

```bash
# Full corpus: coverage + field validation + staleness + placeholder scan
node scripts/content-freshness.js

# PR-scoped: only re-checks what the diff actually touched
node scripts/content-freshness.js --changed-from origin/main
```

Reports are written to `reports/content-freshness.json` and
`reports/content-freshness.txt`.

## What `--changed-from` does and doesn't check

To avoid blocking unrelated content edits, the PR-scoped mode only runs
checks relevant to what actually changed in the diff:

- If `HTML/course_Contents.html` changed → re-run coverage for courses.
- If `HTML/CTF.html` changed → re-run coverage for CTF challenges.
- If `scripts/content-manifest.json` changed → re-run both catalog coverage
  checks and re-validate every entry's required fields, difficulty, and date.
- If a published course HTML file changed → scan that file for placeholder
  copy.
- If a required manifest or catalog file was deleted → fail explicitly.
- If none of those inputs changed, the check passes immediately.

Full mode scans every published course file and CTF objective. Changed mode
only scans touched course files, so a PR that doesn't touch content will never
fail because some unrelated course elsewhere contains placeholder copy. The
scheduled job remains responsible for the complete corpus.

## The manifest (`scripts/content-manifest.json`)

```json
{
  "reviewCadenceDays": 180,
  "entries": [
    {
      "id": "course-3",
      "type": "course",
      "status": "published",
      "owner": "Aditya",
      "difficulty": "Beginner",
      "objective": "Understand the basic types of cyberattacks and attackers.",
      "lastReviewedAt": "2026-08-01"
    }
  ]
}
```

- `reviewCadenceDays` — the review cadence for **all** entries, top-level
  and explicit. Default is 180 days if omitted. Change this file to change
  the cadence; there's no separate config to keep in sync.
- `id` — `course-<N>` matching the `Course <N>` label in
  `course_Contents.html`, or `ctf-<challengeId>` matching the `?challenge=`
  id used in `CTF.html` / the terminal's `challengeCatalog`.
- `type` — `course` or `ctf`.
- `status` — `published` or `intentionally-unpublished` (see below).
- `difficulty` — one of `Beginner`, `Intermediate`, `Advanced`.
- `objective` — a short, specific statement of what the learner should be
  able to do after finishing. This is also scanned for placeholder text for
  CTF entries, since CTF "content" mostly lives in the manifest/terminal
  registry rather than a standalone HTML page.
- `lastReviewedAt` — `YYYY-MM-DD`, the date someone last actually reviewed
  the content for accuracy and completeness.
- `directory` (course entries only, optional) — override the default
  `HTML/Courses and Activities/Course <N>` lookup if a course's folder
  doesn't follow that convention.

Every `*.html` file directly inside a published course's directory is
scanned for placeholder copy (Lorem ipsum, "TODO", "coming soon", "under
construction", etc.) — see `PLACEHOLDER_PATTERNS` in the script for the
exact list.

## Intentional exceptions: unpublished content

Some catalog cards are deliberately live-but-not-clickable — e.g. Course
12's "Coming soon!" teaser card in `course_Contents.html`, which has no
`href`. These are not bugs, but they must be declared, not just absent from
the manifest:

```json
{
  "id": "course-12",
  "type": "course",
  "status": "intentionally-unpublished",
  "owner": "Harshith Gande",
  "exceptionReason": "Course still in development; catalog card intentionally has no href."
}
```

Both `owner` and `exceptionReason` are required — an exception entry with
either field blank fails the check as `invalid-exception`. This is the same
"no silent suppression" discipline as the link-audit baseline: an
unpublished card with **no** manifest entry at all fails as
`undocumented-content`, not as a free pass.

## Finding classes

| Class | Meaning | Fails the gate? |
|---|---|---|
| `undocumented-content` | A live or teaser catalog card has no manifest entry at all | Yes |
| `invalid-exception` | `intentionally-unpublished` entry missing `owner` or `exceptionReason` | Yes |
| `invalid-status` | `status` is neither `published` nor `intentionally-unpublished` | Yes |
| `missing-field` | A published entry is missing `owner`/`difficulty`/`objective`/`lastReviewedAt` | Yes |
| `invalid-difficulty` | `difficulty` isn't Beginner/Intermediate/Advanced | Yes |
| `invalid-date` | `lastReviewedAt` isn't a real `YYYY-MM-DD` date | Yes |
| `stale-review` | `lastReviewedAt` is older than `reviewCadenceDays` | Yes |
| `placeholder-detected` | Placeholder copy found in page content or CTF objective | Yes |
| `status-mismatch` | e.g. manifest says `published` but the catalog card has no live target | Yes |
| `missing-content-directory` | A published course's expected directory doesn't exist on disk | Yes |
| `missing-input` | A required manifest or catalog file was deleted | Yes |
| `orphan-manifest-entry` | Manifest lists an id with no matching catalog card | No — cleanup reminder only |

## Review cadence

Default: **180 days**. Set by `reviewCadenceDays` in the manifest. Anyone
changing the cadence should do it there, with a commit message explaining
why, rather than a one-off script flag — the manifest is meant to be the
single place this policy lives.
