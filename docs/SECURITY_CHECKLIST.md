# Security Boundary Validation Checklist

This document provides a checklist for security reviews and incident response related to external origins, CSP, and trust boundaries in CyberMinds.

---

## Pre-Deployment Checklist

### ✅ Frontend: Before pushing to GitHub Pages

- [ ] **Static QA passes**
  ```bash
  npm run qa:static
  ```
  No unapproved external origins detected.

- [ ] **No new external origins without documentation**
  - [ ] New origin added to `scripts/qa-allowlist.json` with justification in comments
  - [ ] New origin documented in `docs/ORIGINS.md` with:
    - [ ] Purpose
    - [ ] Resources (scripts, styles, fonts, frames)
    - [ ] Data classification (what data is sent)
    - [ ] Controlled by (which party controls the service)
    - [ ] CSP directive (how it fits in CSP policy)
    - [ ] Approval date

- [ ] **All HTML files have required meta tags**
  ```bash
  grep -r "<meta name=\"viewport\"" HTML/*.html
  grep -r "<meta charset" HTML/*.html
  ```
  All pages have viewport and charset meta tags.

- [ ] **No hardcoded HTTP URLs for external resources**
  ```bash
  grep -rE '(src|href)="http://[^/]' HTML/ Javascript/
  ```
  All external URLs use HTTPS.

- [ ] **No embedded credentials or secrets**
  ```bash
  grep -r "password\|token\|secret\|key" HTML/ Javascript/ --include="*.html" --include="*.js"
  ```
  False positives only (comments, variable names, etc.).

- [ ] **Smoke tests pass**
  ```bash
  npm run test:smoke
  ```
  All tests pass, including CSP and external origin checks.

- [ ] **ORIGINS.md matches actual usage**
  - [ ] Run `npm run qa:static` and verify against `docs/ORIGINS.md`
  - [ ] No discrepancies between approved list and actual HTML

### ✅ Terminal Backend: Before deploying to Azure

- [ ] **Environment variables set correctly**
  ```bash
  export ALLOWED_ORIGINS=https://cyber-minds.github.io
  export ENVIRONMENT=production
  ```

- [ ] **CSP header configured in middleware**
  - [ ] Verify `buildContentSecurityPolicy()` in `terminal/backend/middleware.go`
  - [ ] CSP approved origins match `docs/ORIGINS.md`

- [ ] **Security headers present (non-WebSocket requests)**
  ```bash
  curl -i https://terminal.example.com/health | grep -E "(X-Content-Type-Options|X-Frame-Options|CSP|Referrer-Policy)"
  ```
  Expected headers present.

- [ ] **CORS validation enabled**
  - [ ] `ALLOWED_ORIGINS` environment variable set
  - [ ] Middleware checks supplied browser `Origin` headers on every request
  - [ ] WebSocket upgrade validates origin before upgrade

- [ ] **CSP report endpoint configured**
  - [ ] `/api/csp-report` endpoint registered
  - [ ] Violations logged to stdout/file
  - [ ] Logging includes timestamp, origin, blocked resource, directive

- [ ] **Docker image built and tested**
  ```bash
  docker build -t terminal-base:latest -f terminal/Dockerfile.terminal .
  ```

- [ ] **Load test with approved origin**
  ```bash
  for i in {1..10}; do
    curl -i -H "Origin: https://cyber-minds.github.io" \
         https://terminal.example.com/health
  done
  ```
  All requests succeed (200 OK).

- [ ] **Load test rejects unapproved origin**
  ```bash
  curl -i -H "Origin: https://evil.com" \
       https://terminal.example.com/health
  ```
  Request fails with 403 Forbidden.

- [ ] **WebSocket upgrade with approved origin**
  ```bash
  curl -i -H "Origin: https://cyber-minds.github.io" \
       -H "Connection: upgrade" \
       -H "Upgrade: websocket" \
       -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
       -H "Sec-WebSocket-Version: 13" \
       https://terminal.example.com/api/terminal/test-session
  ```
  Response: 101 Switching Protocols.

- [ ] **WebSocket upgrade with unapproved origin**
  ```bash
  curl -i -H "Origin: https://attacker.com" \
       -H "Connection: upgrade" \
       -H "Upgrade: websocket" \
       https://terminal.example.com/api/terminal/test-session
  ```
  Response: 403 Forbidden (before upgrade).

- [ ] **Monitoring and alerting configured**
  - [ ] CSP violations logged to centralized logging system
  - [ ] Alert on critical CSP violation (unapproved origin)
  - [ ] Alert on repeated violations from same origin

---

## Review Checklist: New External Origin Request

When a developer submits a PR to add a new external origin (new CDN, analytics, etc.):

### Security Review

- [ ] **Privacy Policy**
  - [ ] Third-party service publishes a privacy policy
  - [ ] Policy confirms: no PII storage, no session tracking, respects DNT

- [ ] **Data Flow**
  - [ ] Clearly document what data is sent to the service
  - [ ] Verify no learner credentials, auth tokens, or session IDs are sent
  - [ ] Verify no email addresses or personal information is sent
  - [ ] Verify no code submitted by learners is sent

- [ ] **Security Assessment**
  - [ ] No known CVEs in the service or its dependencies
  - [ ] Service has a responsible disclosure policy
  - [ ] Service is from a reputable, established vendor
  - [ ] Service has HTTPS with valid certificate
  - [ ] Service supports CORS or explicit origin whitelisting

- [ ] **Performance Impact**
  - [ ] Service has a published SLA (uptime, latency)
  - [ ] Service is geographically distributed (low latency from US)
  - [ ] Fallback behavior defined if service goes down

- [ ] **Cost & Budget**
  - [ ] If applicable, free tier is sufficient or cost approved
  - [ ] No usage-based billing surprises
  - [ ] Service contract terms reviewed

### Code Review

- [ ] **Allowlist Updated**
  ```json
  {
    "externalUrls": [
      "https://new-service.com"
    ],
    "note": "Updated scripts/qa-allowlist.json"
  }
  ```

- [ ] **Documentation Updated**
  - [ ] `docs/ORIGINS.md` has new row in approved origins table
  - [ ] All columns filled: origin, purpose, resources, data, controlled by, CSP directive, approval date

- [ ] **CSP Policy Updated (if applicable)**
  - [ ] `terminal/backend/middleware.go:buildContentSecurityPolicy()` updated
  - [ ] CSP directive matches resource type (script-src, style-src, frame-src, etc.)

- [ ] **Tests Updated**
  - [ ] `tests/smoke.spec.js` CSP test includes new origin in `APPROVED_ORIGINS` set
  - [ ] Mock routing in `test.beforeEach` updated if new CDN
  - [ ] No new external requests fail CSP validation

- [ ] **QA Script Tests**
  ```bash
  npm run qa:static -- --root .
  ```
  All checks pass.

- [ ] **Smoke Tests**
  ```bash
  npm run test:smoke
  ```
  All tests pass, including external origin checks.

### Approval

- [ ] Code review: approved by maintainer
- [ ] Security review: approved by security team
- [ ] PR description includes security justification
- [ ] Merged and deployed

---

## Incident Response: CSP Violation Detected

### Scenario 1: New External Resource Appearing in Logs

**Symptoms:**
- Backend logs show CSP violation: `CSP Violation | critical | directive=script-src blocked-uri=https://unexpected-cdn.com/script.js`
- Learners report errors in console
- Smoke tests detect unapproved origin

**Response:**

1. **Identify the issue**
   ```bash
   # Check backend logs for recent violations
   docker logs terminal-backend | grep "CSP Violation"

   # Identify which HTML or JS file is loading the resource
   grep -r "unexpected-cdn.com" HTML/ Javascript/
   ```

2. **Determine if legitimate**
   - [ ] Did a recent PR add this resource?
   - [ ] Is this a dependency of an approved library (e.g., jsDelivr importing from CDN)?
   - [ ] Did a third-party service change domains?

3. **If legitimate**
   - [ ] Add origin to `scripts/qa-allowlist.json`
   - [ ] Add origin to `docs/ORIGINS.md` with security justification
   - [ ] Update `terminal/backend/middleware.go` CSP policy if applicable
   - [ ] Update `tests/smoke.spec.js` approved origins list
   - [ ] Create PR with security documentation
   - [ ] Redeploy with updated allowlist

4. **If not legitimate (misconfiguration or attack)**
   - [ ] Disable or remove the resource
   - [ ] Investigate the root cause
   - [ ] Check for compromised dependencies or malicious injection
   - [ ] Review git history for unauthorized changes
   - [ ] If attack: notify security team, consider audit
   - [ ] Create PR to remove resource
   - [ ] Redeploy

### Scenario 2: Third-Party Service Domain Changes

**Symptoms:**
- Analytics stopped working after service migration
- Learner reporting "content blocked" error
- CSP logs show `blocked-uri=https://new-domain-of-service.com`

**Response:**

1. **Confirm the change**
   - [ ] Check third-party service announcement
   - [ ] Verify new domain is legitimate (not spoofed)

2. **Update allowlist**
   - [ ] Add new domain to `scripts/qa-allowlist.json`
   - [ ] Update `docs/ORIGINS.md` with note about domain migration
   - [ ] Update any hardcoded URLs in HTML/JS files

3. **Update CSP policy**
   - [ ] If old domain still in use, keep it for backward compatibility (for a period)
   - [ ] If old domain retired, remove from CSP

4. **Deploy and verify**
   - [ ] Run QA: `npm run qa:static`
   - [ ] Run tests: `npm run test:smoke`
   - [ ] Verify service working: test analytics, look for CSP violations

5. **Communicate**
   - [ ] Document the domain migration in `docs/ORIGINS.md`
   - [ ] Notify users if manual action needed (unlikely)

### Scenario 3: CDN Down (jsDelivr, Google Fonts, etc.)

**Symptoms:**
- Terminal editor or fonts not loading
- Learner cannot complete challenges
- Logs show `blocked-uri=https://cdn.jsdelivr.net/...`

**Response:**

1. **Assess impact**
   - [ ] Which service is down? (identify from blocked-uri)
   - [ ] Which learner flows are affected?
   - [ ] Can learners use fallbacks?

2. **Activate fallback plan**
   - [ ] **Fonts down:** UI still works, fonts fall back to system fonts ✅ Acceptable
   - [ ] **jsDelivr (xterm/Monaco) down:** Terminal editor doesn't load ❌ Unacceptable
     - [ ] Consider secondary CDN or cached version
     - [ ] Notify users of incident
     - [ ] Set up monitoring alert for CDN recovery

3. **Monitor for recovery**
   ```bash
   # Check if CDN is responding
   curl -i https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css
   ```

4. **Verify once recovered**
   - [ ] Smoke tests pass again
   - [ ] No lingering CSP violations

---

## Maintenance Checklist (Monthly/Quarterly)

- [ ] **Review CSP violations**
  ```bash
  # Extract all CSP violations from last 30 days
  docker logs terminal-backend --since 30d | grep "CSP Violation"
  ```
  No unexpected violations. Investigate any anomalies.

- [ ] **Review external origins**
  - [ ] Are all approved origins still in use?
  - [ ] Remove obsolete entries from `qa-allowlist.json` and `docs/ORIGINS.md`
  - [ ] Check for usage drift (new resources not in allowlist)

- [ ] **Update dependencies**
  - [ ] jsDelivr packages: check for new versions of xterm, Monaco Editor
  - [ ] If upgrading: update package versions in HTML, document in `docs/ORIGINS.md`

- [ ] **Test CDN failover**
  - [ ] Verify UI degrades gracefully if jsDelivr is unreachable
  - [ ] Verify analytics queuing if Umami is down

- [ ] **Security audit**
  - [ ] Run full static QA: `npm run qa:static --root .`
  - [ ] Run smoke tests: `npm run test:smoke`
  - [ ] Review backend logs for CORS rejections or security errors

---

## Troubleshooting

### QA Static Fails: "Unallowlisted external URL"

**Fix:**
1. Identify the URL from the error message
2. Check if it's legitimate (review code)
3. Add to `scripts/qa-allowlist.json`:
   ```json
   {
     "externalUrls": [
       "https://the-new-origin.com"
     ]
   }
   ```
4. Document in `docs/ORIGINS.md`
5. Run `npm run qa:static` again to verify

### Smoke Tests Fail: "Unexpected external origin"

**Fix:**
1. Identify the origin from the test output
2. Check if approved in `docs/ORIGINS.md`
3. If not approved: remove the resource or add to allowlist (with documentation)
4. If approved but not in test: update `APPROVED_ORIGINS` set in `tests/smoke.spec.js`
5. Run `npm run test:smoke` again

### Terminal Backend CSP Report Endpoint Returns 404

**Fix:**
1. Verify endpoint is registered in `terminal/backend/main.go`:
   ```go
   router.HandleFunc("/api/csp-report", handleCSPReport).Methods("POST", "OPTIONS")
   ```
2. Verify handler function exists in `terminal/backend/handlers_security.go`
3. Rebuild and redeploy

### CORS Error: "Cross-origin request blocked"

**Possible causes:**
1. `ALLOWED_ORIGINS` environment variable not set or wrong value
2. Frontend origin doesn't match allowlist
3. WebSocket origin header stripped by proxy

**Fix:**
1. Check environment variable:
   ```bash
   docker exec terminal-backend env | grep ALLOWED_ORIGINS
   ```
2. Verify value is correct (no trailing slash, https protocol):
   ```
   ALLOWED_ORIGINS=https://cyber-minds.github.io
   ```
3. Check browser console for actual origin being sent:
   ```javascript
   console.log(window.location.origin)  // https://cyber-minds.github.io
   ```
4. Test CORS directly:
   ```bash
   curl -i -H "Origin: https://cyber-minds.github.io" \
        https://terminal.example.com/health
   ```
   Should include: `Access-Control-Allow-Origin: https://cyber-minds.github.io`

---

## Contact & Escalation

- **Security Issues:** Create an issue in the repository or contact security team
- **CSP Violations (Non-Critical):** File a GitHub issue
- **CSP Violations (Critical/Attack):** Notify maintainers immediately
- **Third-Party Service Issues:** Contact the third-party vendor's support

---

**Last Updated:** 2026-08-16
**Maintained By:** CyberMinds Security Team
