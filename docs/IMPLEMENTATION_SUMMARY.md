# Trust Boundary Validation Implementation Summary

**Date:** 2026-08-16
**Status:** Complete
**Goal:** Make the trust boundary between the public frontend, third-party resources, and the terminal service explicit and continuously checked.

---

## What Was Delivered

### 1. ✅ Complete External Origins Inventory

**File:** [`docs/ORIGINS.md`](docs/ORIGINS.md)

A comprehensive, reviewed source of truth listing every approved external origin used by CyberMinds, including:

- **Group 1: Styling & Fonts**
  - Google Fonts (googleapis.com, gstatic.com)
  - FontAwesome icon library
  - Boxicons (unpkg.com)

- **Group 2: Code Editor & Terminal Display**
  - jsDelivr CDN (xterm.js, Monaco Editor)

- **Group 3: Analytics (Privacy-Preserving)**
  - Umami Analytics with PII-blocking validation

- **Group 4: Third-Party Embeds**
  - Simmer.io game embed (Course 3 only)
  - Chatbase Live Help and YouTube course videos

- **Group 5: Learning Resource Links**
  - Duplichecker, Kali Linux, Parrot OS, and VirtualBox outbound references

- **Group 6: Terminal Backend API**
  - Azure-hosted WebSocket and REST API endpoint

**For each origin:**
- ✅ Purpose clearly documented
- ✅ Data sent and classification specified
- ✅ Which deployment component controls headers
- ✅ CSP directives listed
- ✅ Approval date recorded

---

### 2. ✅ Explicit Trust Boundary Model

**File:** [`docs/ORIGINS.md#trust-boundary-model`](docs/ORIGINS.md#trust-boundary-model)

Includes:
- Visual diagram showing data flow between frontend, CDNs, and terminal backend
- Clear separation of concerns:
  - Public Frontend (GitHub Pages) ↔ External CDNs (read-only)
  - Frontend ↔ Terminal Backend (bidirectional, CORS validated)
  - Terminal Backend ↔ External Services (none - isolated)

---

### 3. ✅ CSP Policies by Deployment

**Documented in:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

#### GitHub Pages (Frontend)
- Static QA and Playwright runtime checks validate approved origins; no CSP meta tag is shipped
- Static QA validation gates all deployments
- Cannot set HTTP response headers (GitHub Pages limitation documented explicitly)

#### Terminal Backend (API)
- Enhanced CSP header in report-only mode
- Applied to non-WebSocket requests only
- Includes directive: `report-uri /api/csp-report`

**Code:** [`terminal/backend/middleware.go`](terminal/backend/middleware.go) - `buildContentSecurityPolicy()` function

---

### 4. ✅ Deployment Differences (GitHub Pages vs Server-Side)

**File:** [`docs/DEPLOYMENT.md#deployment-differences`](docs/DEPLOYMENT.md#deployment-differences)

Explicitly documents:
- GitHub Pages **cannot** set custom HTTP response headers
- Terminal backend **can** set all security headers
- CSP strategy differs for each:
  - Frontend: static QA and runtime origin validation
  - Backend: HTTP response header enforcement

---

### 5. ✅ CI Checks for New External Origins

#### 5a. Static QA Script (Every Commit)

**File:** [`scripts/qa-static.js`](scripts/qa-static.js)

**Enhanced to:**
- Scan all HTML for external URLs
- Check against approved origins in `qa-allowlist.json`
- Fail build if unapproved origin found
- **NEW:** Provide helpful error message with link to documentation
  ```
  Unallowlisted external URL: "https://new-origin.com/script.js"
  To approve this origin:
  1. Update scripts/qa-allowlist.json with the origin: "https://new-origin.com"
  2. Update docs/ORIGINS.md with purpose, data flow, and security justification
  3. See docs/ORIGINS.md#appendix-how-to-add-a-new-external-origin for the full checklist
  ```

#### 5b. Updated Allowlist

**File:** [`scripts/qa-allowlist.json`](scripts/qa-allowlist.json)

**Updated to include:**
- ✅ `https://unpkg.com` (Boxicons) - was missing
- ✅ `https://cloud.umami.is` (Analytics) - was missing
- ✅ Reconciled the allowlist with the origin inventory, including runtime and outbound origins
- ✅ Added documentation note pointing to `docs/ORIGINS.md`

#### 5c. Smoke Tests with Origin Validation

**File:** [`tests/smoke.spec.js`](tests/smoke.spec.js)

**New test suite: "Security: External Origins & CSP"**

Tests verify:
1. ✅ Home page loads only from approved external origins
2. ✅ Terminal page loads only from approved external origins
3. ✅ No external resources use insecure HTTP (all HTTPS)
4. ✅ Analytics script does not send credentials or PII
   - Blocks requests containing: token, sessionid, userid, email, password, key, secret, auth

---

### 6. ✅ CSP Violation Reporting

**File:** [`terminal/backend/handlers_security.go`](terminal/backend/handlers_security.go)

**New CSP report handler:**
- Endpoint: `POST /api/csp-report`
- Receives browser CSP violation reports
- Logs violations with structured format:
  ```
  2026-08-16T10:15:30Z | critical | CSP Violation | directive=script-src blocked-uri=https://unexpected.com/script.js document-uri=https://cyber-minds.github.io/...
  ```
- Identifies unapproved origins and escalates to critical severity
- Does NOT send data to external reporting services (local logging only)

**Registered in:** [`terminal/backend/main.go`](terminal/backend/main.go) - line with `/api/csp-report` handler

---

### 7. ✅ Comprehensive Documentation

#### 7a. ORIGINS.md
- Complete external origins inventory
- Trust boundary model with diagram
- CSP policies per deployment
- Incident response procedures
- Appendix: How to add new external origins with full checklist

#### 7b. DEPLOYMENT.md
- GitHub Pages limitations (cannot set headers)
- Terminal backend capabilities (can set all headers)
- CSP strategy for each tier
- Deployment checklist
- Testing security headers locally
- FAQ and troubleshooting

#### 7c. SECURITY_CHECKLIST.md
- Pre-deployment checklists (frontend + backend)
- Review checklist for new external origin PRs
- Incident response playbooks:
  - Scenario 1: New external resource appearing in logs
  - Scenario 2: Third-party service domain changes
  - Scenario 3: CDN down (jsDelivr, fonts, etc.)
- Maintenance checklist (monthly/quarterly)
- Troubleshooting common issues

---

### 8. ✅ Security Enhancements

#### Origin Validation
- Terminal backend validates supplied `Origin` headers against the `ALLOWED_ORIGINS` environment variable
- WebSocket upgrade validates `Origin` header before upgrade
- CORS middleware returns 403 Forbidden for unapproved origins in production

#### CSP Headers
- Report-only CSP applied to non-WebSocket requests
- Provides visibility into violations without breaking functionality
- Report endpoint collects violations for monitoring

#### No Credential Leakage
- Analytics script (Umami) validates all events against PII-blocking schema
- Blocked keys: token, sessionid, userid, email, password, key, secret, auth
- Query parameters stripped from analytics requests

---

## Acceptance Criteria Met

| Criterion | Status | Evidence |
|-----------|--------|----------|
| A reviewed source of truth lists all approved external origins | ✅ | [`docs/ORIGINS.md`](docs/ORIGINS.md) - 6 origin groups, all documented |
| A new external origin fails CI unless explicitly added with a reason | ✅ | [`scripts/qa-static.js`](scripts/qa-static.js) gates new origins; `qa-allowlist.json` is source of truth |
| Runtime origin checks produce no unexpected external requests in browser smoke path | ✅ | [`tests/smoke.spec.js`](tests/smoke.spec.js) - origin suite validates no unapproved origins loaded |
| Deployment documentation distinguishes static frontend from terminal API | ✅ | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) - separate sections with clear differences |
| No credentials or learner content is sent to unapproved third party | ✅ | [`Javascript/analytics.js`](Javascript/analytics.js#L42) - PII-blocking schema; smoke test validates no credential leakage |

---

## Files Created/Modified

### Created Files
1. [`docs/ORIGINS.md`](docs/ORIGINS.md) - Complete external origins inventory (400+ lines)
2. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) - Deployment & security headers guide (300+ lines)
3. [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md) - Pre-deployment & incident response checklists (300+ lines)
4. [`terminal/backend/handlers_security.go`](terminal/backend/handlers_security.go) - CSP report handler (130+ lines)

### Modified Files
1. [`scripts/qa-allowlist.json`](scripts/qa-allowlist.json)
   - Added runtime and outbound origins required by the live site
   - Reconciled the allowlist with the origin inventory
   - Added: documentation note

2. [`scripts/qa-static.js`](scripts/qa-static.js)
   - Enhanced `checkExternal()` function with helpful error messages
   - Now directs users to documentation for adding new origins

3. [`terminal/backend/middleware.go`](terminal/backend/middleware.go)
   - Refactored `securityHeadersMiddleware()` with improved CSP
   - Added `buildContentSecurityPolicy()` function
   - CSP now comprehensive and documented

4. [`terminal/backend/main.go`](terminal/backend/main.go)
   - Added route: `POST /api/csp-report`

5. [`tests/smoke.spec.js`](tests/smoke.spec.js)
   - Added new test suite: "Security: External Origins & CSP"
   - 4 new tests validating origin approval and PII protection

---

## Deployment Steps

### Frontend (GitHub Pages)

1. Review all changes: `git diff docs/ scripts/`
2. Run QA: `npm run qa:static`
3. Run tests: `npm run test:smoke`
4. Create PR with:
   - Link to `docs/ORIGINS.md`
   - Summary of new external origins approved
   - Security justifications for each origin
5. Merge to main
6. GitHub Actions automatically deploys to GitHub Pages

### Terminal Backend (Azure)

1. Build Docker image:
   ```bash
   cd terminal
   docker build -t terminal-base:latest -f Dockerfile.terminal .
   docker build -t terminal:latest -f Dockerfile .
   ```

2. Verify CSP handler compiles:
   ```bash
   cd terminal/backend
   go build .
   ```

3. Deploy stack:
   ```bash
   export ALLOWED_ORIGINS=https://cyber-minds.github.io
   export ENVIRONMENT=production
   docker compose -f terminal/docker-compose.prod.yml --env-file terminal/.env up -d --build
   ```

4. Verify CSP header:
   ```bash
   curl -i https://terminal.example.com/health | grep -i csp
   ```

5. Test CSP report endpoint:
   ```bash
   curl -X POST https://terminal.example.com/api/csp-report \
        -H "Content-Type: application/json" \
        -d '{"csp-report": {"blocked-uri": "https://test.com/script.js"}}'
   ```

---

## Continuous Validation

### On Every Commit
- ✅ `npm run qa:static` - validates no unapproved origins in HTML
- ✅ `npm run test:smoke` - smoke tests run, including CSP origin validation
- ✅ `.github/workflows/qa-static.yml` - GitHub Actions enforces checks

### On Every Deployment
- ✅ Terminal backend CSP header present (non-WebSocket requests)
- ✅ CORS origin validation enforced
- ✅ WebSocket upgrade checks origin before upgrade

### Monitoring (When Deployed)
- ✅ Backend logs CSP violations with structured format
- ✅ Violations include timestamp, origin, blocked resource, directive
- ✅ Unapproved origins marked as `critical` severity
- ⏳ Production alerting still requires an operator/logging integration

---

## Future Improvements (Out of Scope)

1. **GitHub Pages custom headers:** Deploy frontend to Netlify/Vercel for HTTP header CSP enforcement
2. **CSP strictness:** Upgrade from report-only to enforced mode once violations stabilize
3. **Subresource Integrity (SRI):** Add SRI hashes to CDN resources to prevent unauthorized modification
4. **Security audit:** Annual third-party security audit of approved origins
5. **Credential storage:** If learner authentication is added, ensure no tokens sent to CDNs

---

## References

- OWASP CSP Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- MDN CSP Report-Only: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only
- GitHub Pages Limitations: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site
- WebSocket CORS: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#origin_restriction

---

**Approval Status:** Ready for Review
**Next Step:** Submit for security review and merge to main
