# External Origins Inventory

This document is the **source of truth** for all approved external origins used by CyberMinds. Every external resource—scripts, styles, frames, fonts, API calls, and WebSocket connections—must be listed here with explicit approval and documented purpose.

**Last Updated:** 2026-08-16

---

## Table of Contents

1. [Approved Origins](#approved-origins)
2. [Trust Boundary Model](#trust-boundary-model)
3. [CSP Policies by Deployment](#csp-policies-by-deployment)
4. [Deployment Differences](#deployment-differences)
5. [Validation and Enforcement](#validation-and-enforcement)
6. [Incident Response](#incident-response)

---

## Approved Origins

### Group 1: Styling & Fonts (UI Library Dependencies)

| Origin | Purpose | Resources | Data Sent | Controlled By | CSP Directive | Approval Date |
|--------|---------|-----------|-----------|---------------|---------------|---------------|
| `https://fonts.googleapis.com` | Google Fonts metadata & CSS | Stylesheet with font family definitions | None (GET only) | Google | `style-src` | 2025-09-01 |
| `https://fonts.gstatic.com` | Google Fonts CDN (font files) | WOFF2/TTF font binary files | None (GET only) | Google | `font-src` | 2025-09-01 |
| `https://kit.fontawesome.com` | FontAwesome icon library | JavaScript (async-loaded) + CSS | Icon kit ID in query string | Cloudflare/FontAwesome | `script-src`, `style-src` | 2025-09-01 |
| `https://ka-f.fontawesome.com` | FontAwesome runtime assets | Kit CSS and icon assets loaded by the approved kit | Icon kit ID in request path | Cloudflare/FontAwesome | `script-src`, `style-src` | 2026-08-16 |
| `https://unpkg.com` | Boxicons icon library | CSS stylesheet | Package name in URL path | Cloudflare/Boxicons | `style-src` | 2025-09-01 |

**Data Classification:** Public UI styling only. No learner data.

---

### Group 2: Code Editor & Runtime Display

| Origin | Purpose | Resources | Data Sent | Controlled By | CSP Directive | Approval Date |
|--------|---------|-----------|-----------|---------------|---------------|---------------|
| `https://cdn.jsdelivr.net` | xterm.js & Monaco Editor CDN | JavaScript/CSS: `@xterm/xterm`, `@xterm/addon-fit`, `monaco-editor` | Package names/versions in URL path (no learner data) | jsDelivr (Fastly) | `script-src`, `style-src` | 2025-09-01 |

**Data Classification:** Public UI library code only. Used by terminal frontend to display editor and terminal output.

**Security Note:** Only the following packages are approved:
- `@xterm/xterm@5.x` CSS and JS
- `@xterm/addon-fit@0.x` JS
- `monaco-editor@0.x` loader.js only

---

### Group 3: Analytics (Privacy-Preserving)

| Origin | Purpose | Resources | Data Sent | Controlled By | CSP Directive | Approval Date |
|--------|---------|-----------|-----------|---------------|---------------|---------------|
| `https://cloud.umami.is` | Umami privacy-first analytics | Script (`script.js`) | Event payloads: lesson page, CTF entry, quiz completion. **NO PII, no query parameters, no learner credentials.** See [`Javascript/analytics.js`](../Javascript/analytics.js) for schema. | Umami (self-hosted) | `script-src` | 2025-09-01 |

**Data Classification:** Aggregated event telemetry only.

**Privacy Guarantees:**
- Umami script is loaded with `data-exclude-search` (strips query parameters)
- Do Not Track (DNT) is respected
- Event schema explicitly blocks fields containing `token`, `sessionid`, `userid`, `email`, `password`, `key`, `secret`, `auth` (see [`Javascript/analytics.js:BLOCKED_KEYS`](../Javascript/analytics.js#L42))
- No session IDs, auth tokens, or learner-identifiable information is sent
- If the analytics service becomes unavailable, learner pages continue to work

---

### Group 4: Third-Party Embeds

| Origin | Purpose | Resources | Data Sent | Controlled By | CSP Directive | Approval Date |
|--------|---------|-----------|-----------|---------------|---------------|---------------|
| `https://www.chatbase.co` | Chatbase helper and chatbot iframe | Chat helper script and chat iframe | Learner chat messages and page context when Live Help is used | Chatbase | `script-src`, `frame-src` | 2026-08-16 |
| `https://www.youtube.com` | Educational video embeds | `<iframe>` video player | Video ID and playback requests | YouTube | `frame-src` | 2026-08-16 |
| `https://i.simmer.io` | Game embed (Course 3 only) | `<iframe>` sandbox embed | None (self-contained game) | Itch.io/Simmer | `frame-src` | 2025-09-01 |

**Data Classification:** Third-party embed data. Simmer receives public game state; Chatbase receives learner chat messages and page context; YouTube receives playback requests.

**Usage:** Simmer is embedded in [`HTML/Courses and Activities/Course 3/Game_Course3.html`](../HTML/Courses%20and%20Activities/Course%203/Game_Course3.html); Chatbase is used by Live Help; YouTube is used for course videos.

---

### Group 5: Learning Resource Links

| Origin | Purpose | Resources | Data Sent | Controlled By | CSP Directive | Approval Date |
|--------|---------|-----------|-----------|---------------|---------------|---------------|
| `https://www.duplichecker.com` | ASCII conversion reference | Outbound ASCII-to-text tool link in Course 5 | None unless a learner chooses to leave the site | Duplichecker | N/A (navigation) | 2026-08-16 |
| `https://www.kali.org` | Kali Linux download reference | Outbound download links in Course 6 | None unless a learner chooses to leave the site | Kali Linux | N/A (navigation) | 2026-08-16 |
| `https://www.parrotsec.org` | Parrot OS download reference | Outbound download links in Course 6 | None unless a learner chooses to leave the site | Parrot OS | N/A (navigation) | 2026-08-16 |
| `https://www.virtualbox.org` | VirtualBox download reference | Outbound download link in Course 6 | None unless a learner chooses to leave the site | Oracle VirtualBox | N/A (navigation) | 2026-08-16 |

**Data Classification:** Outbound educational links. The site does not send learner data to these origins automatically.

---

### Group 6: Terminal Backend API & WebSocket

| Origin | Purpose | Resources | Data Sent | Controlled By | CSP Directive | Approval Date |
|--------|---------|-----------|-----------|---------------|---------------|---------------|
| `https://cyberminds-terminal-20260621-ncus.northcentralus.cloudapp.azure.com` | Terminal backend API & WebSocket | HTTP REST API + WebSocket (`wss://`) | Challenge metadata, code submission, terminal I/O (learner commands & output). **Same origin as frontend in localhost dev; separate in production.** | Terminal backend middleware | N/A (connect-src for legacy browsers) | 2025-09-01 |

**Data Classification:** Learner code & terminal session data.

**Deployment Notes:**
- **Development:** Terminal backend and frontend served from same origin (`http://localhost`). CORS/WebSocket validation skipped.
- **Production:** Frontend at `https://cyber-minds.github.io` (GitHub Pages). Terminal backend at `https://cyberminds-terminal-*.northcentralus.cloudapp.azure.com` (Azure). CORS and WebSocket origin checks enforced.

**Security Controls:**
- Terminal backend enforces `ALLOWED_ORIGINS` environment variable (see [`terminal/.env.example`](../terminal/.env.example))
- CORS: `Access-Control-Allow-Origin` header validated against allowlist
- WebSocket: `Origin` header checked before upgrade (see [`terminal/backend/middleware.go:corsMiddleware`](../terminal/backend/middleware.go))
- CSP: Report-only policy applied to non-WebSocket requests

---

## Trust Boundary Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        Learner Browser                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ CyberMinds Public Frontend (HTML, CSS, JS, Images)     │  │
│  │ Served by: GitHub Pages (https://cyber-minds.github.io)│  │
│  │ CSP: report-only                                       │  │
│  │ No learner data stored here                            │  │
│  └──────────────────────────────────────────────────────┬─┘  │
│                                                          │     │
│  External CDNs (Approved List)                          │     │
│  ├─ Google Fonts (fonts.googleapis.com)                 │     │
│  ├─ FontAwesome Kit (kit.fontawesome.com)               │     │
│  ├─ jsDelivr (cdn.jsdelivr.net)                         │     │
│  ├─ Boxicons (unpkg.com)                                │     │
│  ├─ Umami Analytics (cloud.umami.is) ◄─ PII-blocked    │     │
│  └─ Simmer Game Embed (i.simmer.io) [Course 3 only]     │     │
│                                                          │     │
│  Terminal WebSocket Connection                          │     │
│  └─► wss://cyberminds-terminal-*.northcentralus...      │     │
│      cloudapp.azure.com                                 │     │
└─────────────────────────────────────────────────────────┘     │
   │         ▲                                          │
   │         │ CORS validated                          │
   │ Learner │ Origin: https://cyber-minds.github.io    │
   │ Code &  │                                          │
   │ Terminal│                                          │
   │ Output  │                                          │
   │         │                                          │
   └─────────┴──────────────────────────────────────────┘
        │                              │
        └─────────────────────────────────────────────────
                                       │
              ┌────────────────────────▼─────────────────────┐
              │  Terminal Backend API                        │
              │  (Isolated Docker per session)               │
              │  ALLOWED_ORIGINS enforced                    │
              │  CSP header: report-only                     │
              │  No external origin except GitHub Pages      │
              └────────────────────────────────────────────┘
```

### Trust Boundaries

1. **Public Frontend ↔ External CDNs (Read-Only)**
   - One-way: frontend fetches styles, fonts, scripts
   - No learner data sent
   - Only approved, immutable resources
   - Fallback: UI degrades gracefully if CDN unavailable

2. **Frontend ↔ Terminal Backend (Bidirectional, browser-origin validated)**
   - CORS checks supplied browser `Origin` headers against an allowlist
   - CORS is not user authentication; originless non-browser clients are not blocked by this boundary
   - WebSocket upgrade validates `Origin` header
   - Learner code & session data exchanged
   - Backend runs in isolated Docker container

3. **Terminal Backend ↔ External Services (None)**
   - Terminal backend must not contact external origins
   - Exception: If backend logging or monitoring is added in future, must be approved in this document

---

## CSP Policies by Deployment

### GitHub Pages (Static Frontend)

**Host:** `cyber-minds.github.io`
**CSP Header:** None (GitHub Pages does not support custom response headers)
**Boundary:** Static QA plus Playwright runtime origin checks. This is validation at the deployment gate, not browser-enforced CSP.

```
Content-Security-Policy-Report-Only:
  default-src 'self';
  script-src 'self' https://kit.fontawesome.com https://ka-f.fontawesome.com https://cdn.jsdelivr.net https://cloud.umami.is https://www.chatbase.co;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://kit.fontawesome.com https://ka-f.fontawesome.com https://unpkg.com https://cdn.jsdelivr.net;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  frame-src https://i.simmer.io https://www.chatbase.co https://www.youtube.com;
  connect-src 'self' https://cyberminds-terminal-20260621-ncus.northcentralus.cloudapp.azure.com https://cloud.umami.is;
  report-uri https://cyberminds-terminal-20260621-ncus.northcentralus.cloudapp.azure.com/api/csp-report
```

**Notes:**
- This is a reference policy for a future header-capable frontend host; it is not emitted as a response header or HTML meta tag by GitHub Pages.
- `scripts/qa-static.js` and the Playwright smoke suite enforce the approved-origin boundary for the current frontend deployment.
- `unsafe-inline` for styles is required for inline CSS in existing templates; a future refactor can move to external stylesheets
- Learner code executed in isolated backend terminals, not in browser, so `script-src` restrictions do not apply to code editing

### Terminal Backend API

**Host:** `https://cyberminds-terminal-*.northcentralus.cloudapp.azure.com`
**CSP Header:** `Content-Security-Policy-Report-Only`
**Applied to:** Non-WebSocket API and health responses. The Go backend does not serve the frontend HTML.

```
Content-Security-Policy-Report-Only:
  default-src 'self';
  script-src 'self' https://cdn.jsdelivr.net;
  style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline';
  report-uri /api/csp-report
```

**Why Report-Only:** Allows validation of CSP violations without breaking terminal functionality. Violations should be rare; if violations occur, they indicate a new external resource was added without approval.

**Important:** CSP header is **NOT** set on WebSocket upgrade requests to avoid blocking terminal connections. See [`terminal/backend/middleware.go:securityHeadersMiddleware`](../terminal/backend/middleware.go#L23).

---

## Deployment Differences

### ⚠️ GitHub Pages (Frontend Only)

**What it can control:**
- ✅ HTML content
- ✅ CSS, JavaScript file contents
- ✅ Local image/font files

**What it CANNOT control:**
- ❌ HTTP response headers (Content-Security-Policy, X-Frame-Options, etc.)
  - GitHub Pages uses fixed headers controlled by GitHub, not the repository
  - Custom headers are not configurable on the GitHub Pages host

**CSP Strategy for GitHub Pages:**
- CSP is declared as a `<meta http-equiv="Content-Security-Policy">` tag (documentation only; not enforced by browser)
- Alternatively: serve a proxy or inject headers at a reverse-proxy layer (future optimization)
- For now: static HTML validation via `qa-static.js` enforces the approved origins list

**Implication:** Do not claim "CSP enforced on GitHub Pages" in documentation. It is a local validation layer, not browser-enforced security.

---

### Terminal Backend (API + WebSocket)

**What it can control:**
- ✅ HTTP response headers (CSP, CORS, etc.)
- ✅ WebSocket upgrade validation
- ✅ Origin allowlist via `ALLOWED_ORIGINS` environment variable
- ✅ Logging and CSP violation reporting

**Enforcement:**
- All non-WebSocket requests receive CSP report-only header
- All requests (WebSocket and non-WebSocket) pass through CORS middleware
- A supplied origin not in the allowlist is rejected with 403 Forbidden; originless non-browser clients are intentionally allowed

---

## Validation and Enforcement

### 1. Static QA Check (Every Commit)

**File:** [`scripts/qa-static.js`](../scripts/qa-static.js)

**What it checks:**
- All external URLs in HTML (href, src, link, script tags) must be in the approved list
- Approved list is [`scripts/qa-allowlist.json`](../scripts/qa-allowlist.json)
- New external origins fail CI unless explicitly added to allowlist with documentation

**Invocation:**
```bash
npm run qa:static -- --changed-from <base-ref>
```

**CI Configuration:**
- Runs on every push to `main` and pull request
- Workflow file: [`.github/workflows/qa-static.yml`](.github/workflows/qa-static.yml)

---

### 2. CSP Violation Reporting (Production)

**Backend Endpoint:** `POST /api/csp-report`

**Purpose:** Collect CSP violations from clients that explicitly use the backend report-only policy. The GitHub Pages frontend currently uses static and runtime origin checks and does not send reports here.

**Expected Violations (should not occur):**
- New external resource added without approval
- External resource domain changed
- CDN misconfiguration

**Action on Violation:**
1. Backend logs violation with timestamp, document URI, and blocked resource
2. Operator reviews logs
3. If legitimate: add origin to allowlist and redeploy
4. If attack/misconfiguration: block and investigate

**Implementation:** See [`terminal/backend/handlers_security.go#handleCSPReport`](../terminal/backend/handlers_security.go). The endpoint accepts reports only from clients that explicitly configure the backend policy; the GitHub Pages frontend currently uses static and runtime checks instead.

---

### 3. Smoke Tests (CI)

**File:** [`tests/smoke.spec.js`](../tests/smoke.spec.js)

**What it checks:**
- Terminal UI loads without errors
- No unexpected external resource requests
- Mock terminal initializes without WebSocket/backend (offline mode)
- Challenge panel populates once editors load

**CSP Validation:**
- Tests route external resource requests to check against approved list
- Any unapproved request fails the test

**Invocation:**
```bash
npm run test:smoke
```

---

## Incident Response

### Scenario 1: New External Resource Needed

**Process:**
1. Engineer submits pull request with new external resource (e.g., new CDN, analytics provider)
2. PR includes:
   - Updated `scripts/qa-allowlist.json` with new origin and reason
   - Updated `docs/ORIGINS.md` with new entry, data classification, and security justification
   - Link to security review of third-party service (privacy policy, SLAs, etc.)
3. Code review:
   - Maintainer verifies third-party service credentials, privacy policy, and data handling
   - Checks that no learner credentials or PII are sent
   - Approves or requests changes
4. Merge → CI validates → Deploy

**Key:** No external origin is used without explicit documentation and approval.

---

### Scenario 2: CSP Violation Detected in Production

**Steps:**
1. Operator receives alert or finds violation in backend logs
2. Log entry shows: timestamp, learner origin, document URI, blocked resource
3. Operator checks:
   - Did a legitimate feature add a new resource? If yes, follow "New External Resource" process.
   - Is a CDN domain misconfigured or hijacked? If yes, investigate and rollback.
   - Is it a false positive (browser extension, malware on learner device)? Log and continue.
4. If production incident: disable resource, notify users, create pull request to fix

---

### Scenario 3: Third-Party Service Down (CDN, Analytics)

**Impact by Service:**

| Service | Impact | Fallback |
|---------|--------|----------|
| Google Fonts | UI fonts fall back to system fonts; readable but degraded | ✅ Acceptable |
| FontAwesome | Icons fall back to text labels; readable but less polished | ✅ Acceptable |
| jsDelivr (xterm, Monaco) | Terminal editor does not render; learner cannot use terminal | ⚠️ Unacceptable; notify ops |
| Umami Analytics | Events are queued; learner page continues to work | ✅ Acceptable |
| Terminal Backend | Learner cannot submit code or view output; cannot complete challenges | ⚠️ Unacceptable; notify ops |

**Action for Critical Services (jsDelivr, Terminal Backend):**
- Maintain fallback plans (secondary CDN, read-only mode, offline access)
- Test failover regularly in staging
- SLA: restore within 30 minutes or activate contingency

---

## Appendix: How to Add a New External Origin

### Checklist for Approvers

- [ ] Third-party service has published privacy policy
- [ ] Privacy policy confirms: no PII storage, no session tracking, respects DNT
- [ ] Security audit: no known vulnerabilities in third-party service
- [ ] Data flow: all data sent to service is documented and approved
- [ ] Fallback: UI continues to work if service is down
- [ ] CSP Directive: what type of resource (script, style, frame, font, etc.)
- [ ] Sunset plan: what happens when we stop using this service
- [ ] Cost: if applicable, budget approved
- [ ] Monitoring: alerting set up if service goes down or violates CSP

### Checklist for Implementers

- [ ] Updated `scripts/qa-allowlist.json` with new origin
- [ ] Updated `docs/ORIGINS.md` with new entry and all required columns
- [ ] Tested locally: `npm run qa:static` passes
- [ ] Tested in staging: no CSP violations in browser console
- [ ] Updated CSP policy in `terminal/backend/middleware.go` if applicable
- [ ] Updated smoke tests if new resource affects test mocks
- [ ] PR description links to security review and approval

---

**For questions or escalations, contact the security team or repository maintainers.**
