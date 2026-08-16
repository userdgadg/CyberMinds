# Deployment & Security Headers

This document clarifies which security headers can be controlled by each deployment tier of CyberMinds.

**TL;DR:**
- **Frontend (GitHub Pages):** Cannot set HTTP response headers. CSP is validated locally via `qa-static.js`.
- **Terminal Backend (Azure):** Can set HTTP response headers. CSP is enforced as report-only.

---

## Deployment Architecture

```
User Browser
    ↓
GitHub Pages (STATIC FRONTEND)
  - HTML, CSS, JavaScript, Images
  - No backend code execution
  - No state/session data
  - NO HTTP RESPONSE HEADERS (GitHub-controlled)
    ↓
  Links to Terminal Backend (DYNAMIC API)
  - REST API + WebSocket for learner code execution
  - Docker container per session
  - Can set ANY HTTP RESPONSE HEADERS
```

---

## Frontend: GitHub Pages

### Hosting
- **Host:** `https://cyber-minds.github.io`
- **Content:** Public HTML, CSS, JavaScript, images
- **Technology:** GitHub Pages (Jekyll, static site hosting)

### What We CAN Control
✅ HTML file contents (meta tags, element attributes)  
✅ CSS stylesheets (file contents, inline styles)  
✅ JavaScript file contents (code, logic)  
✅ Image files (filenames, alt text)  
✅ Font files (served from CDN or included)  

### What We CANNOT Control
❌ HTTP response headers (no `Content-Security-Policy`, `X-Frame-Options`, etc.)  
❌ CORS headers  
❌ Cache-Control headers  
❌ Custom server-side logic  

**Reason:** GitHub Pages uses a fixed, non-customizable HTTP response header configuration managed by GitHub. You cannot override or add headers via repository settings or configuration files.

---

### CSP Strategy for GitHub Pages

#### Option 1: Meta Tag (Current)

```html
<meta http-equiv="Content-Security-Policy-Report-Only" 
      content="default-src 'self'; script-src 'self' https://approved-origins.com; ...">
```

**Pros:**
- Serves as documentation of intended CSP policy
- Some browsers honor meta tag CSP (varies by browser)

**Cons:**
- Not enforced by all browsers or user agents
- Not validated by automated tools (requires custom QA)
- Learners using older browsers or certain extensions may not benefit

#### Option 2: Static QA + Origin Validation (Current)

File: [`scripts/qa-static.js`](../scripts/qa-static.js)

**How it works:**
1. On every commit, QA script scans all HTML files
2. Extracts all external URLs (href, src, link, script tags)
3. Checks against approved allowlist: [`scripts/qa-allowlist.json`](../scripts/qa-allowlist.json)
4. Fails build if unapproved origin is found
5. Blocks deployment to GitHub Pages

**Pros:**
- Deterministic: no ambiguity about what's approved
- Fast: runs locally before deployment
- Comprehensive: catches all external resources

**Cons:**
- Local validation, not browser-enforced
- Does not catch runtime dynamic loading (if any)

**Important:** This is a **gate at deployment time**, not a runtime security boundary. It prevents unapproved origins from ever reaching production.

---

### Why No CSP Response Header?

GitHub Pages does not allow custom HTTP response headers because:

1. **GitHub Pages uses a shared, managed infrastructure.** Allowing per-repository headers would increase complexity and support burden.
2. **Security & abuse prevention.** Restricting headers prevents users from accidentally exposing credentials or misconfiguring origins.
3. **HTTPS enforcement.** GitHub Pages automatically redirects to HTTPS and manages certificates; custom header control would complicate this.

**Workaround for future:** If you need HTTP response header CSP, deploy the frontend to a different host (Netlify, Vercel, your own server) that supports custom headers. But for GitHub Pages, you must rely on static validation.

---

## Terminal Backend: Azure

### Hosting
- **Host:** `https://cyberminds-terminal-*.northcentralus.cloudapp.azure.com`
- **Content:** Go backend, Docker containers for learner sessions, REST/WebSocket APIs
- **Technology:** Docker Compose + Caddy reverse proxy

### What We CAN Control
✅ HTTP response headers (Content-Security-Policy, CORS, X-Frame-Options, etc.)  
✅ WebSocket upgrade validation  
✅ CORS origin allowlist  
✅ Request/response middleware  
✅ Logging and CSP violation reporting  

### HTTP Response Headers Set by Backend

#### Content-Security-Policy (Report-Only)

```
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report
```

**Applied to:** Non-WebSocket HTTP requests (HTML pages, health checks, etc.)

**NOT applied to:** WebSocket upgrade requests (to avoid blocking terminal connections)

**Rationale:** Terminal frontend is served by GitHub Pages, not this backend. CSP here is for any debugging/admin pages served by backend.

---

#### CORS Headers

```
Access-Control-Allow-Origin: https://cyber-minds.github.io
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 3600
Vary: Origin
```

**Validation:** Every request is checked against `ALLOWED_ORIGINS` environment variable (see [`terminal/.env.example`](../terminal/.env.example#L9)).

**Origin Check Logic:**
1. Extract `Origin` header from request
2. Normalize (trim, strip path/query)
3. Compare against allowlist
4. If not in allowlist and environment is production: reject with 403 Forbidden
5. If in allowlist: echo back in `Access-Control-Allow-Origin` header

**Code:** [`terminal/backend/middleware.go:corsMiddleware`](middleware.go#L31)

---

#### Other Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking (no framing allowed) |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter (modern browsers use CSP) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control what referrer data is sent |

**Code:** [`terminal/backend/middleware.go:securityHeadersMiddleware`](middleware.go#L17)

---

### WebSocket Origin Validation

WebSocket connections bypass normal HTTP header responses (no CSP header set) but still validate the `Origin` header before upgrade.

**Process:**
1. Browser initiates WebSocket upgrade request
2. Backend extracts `Origin` header
3. Calls `isOriginAllowed()` to check against `ALLOWED_ORIGINS`
4. If not allowed: reject with HTTP 403 before upgrade
5. If allowed: upgrade to WebSocket, bridge to Docker container

**Code:** [`terminal/backend/middleware.go:corsMiddleware`](middleware.go#L31), [`terminal/backend/terminal_handler.go`](terminal_handler.go#L18)

---

## GitHub Pages Limitations

### Static Content Only
- ✅ HTML, CSS, JavaScript, images, video files
- ❌ No server-side code execution
- ❌ No database or persistent sessions (state lives in browser localStorage)
- ❌ No custom HTTP headers

### Performance
- ✅ CDN delivery (fast globally)
- ✅ No cold-start latency
- ❌ Large files (>100MB) may be slow; consider deferring to terminal backend

### Security Model
- ✅ HTTPS enforced by GitHub
- ✅ DDoS protection by GitHub/Cloudflare
- ❌ No authentication/authorization logic (optional sign-in is frontend-only, no session server)
- ❌ No CSP enforcement at HTTP layer (must use static validation)

---

## Terminal Backend Responsibilities

### What Terminal Backend Does NOT Do
- ❌ Serve the frontend HTML/CSS/JS (GitHub Pages does this)
- ❌ Handle user authentication/session persistence (future feature)
- ❌ Contact external analytics or third-party services directly

### What Terminal Backend DOES Do
- ✅ Receive learner code submissions via REST/WebSocket
- ✅ Execute code in isolated Docker containers
- ✅ Stream terminal I/O back to browser
- ✅ Validate origin of every request (CORS + WebSocket)
- ✅ Log security violations (CSP reports)
- ✅ Manage learner progress/challenge state in memory (no persistence)

---

## Deployment Checklist

### Before Deploying Frontend to GitHub Pages

- [ ] Run static QA check: `npm run qa:static`
- [ ] Verify all external origins are in `scripts/qa-allowlist.json`
- [ ] No unapproved external resources in HTML/CSS/JS
- [ ] All security documentation updated (this file, `docs/ORIGINS.md`)
- [ ] Smoke tests pass: `npm run test:smoke`

### Before Deploying Terminal Backend to Azure

- [ ] Set `ALLOWED_ORIGINS` environment variable to GitHub Pages URL
  ```bash
  export ALLOWED_ORIGINS=https://cyber-minds.github.io
  ```
- [ ] Verify CSP headers are set (non-WebSocket requests):
  ```bash
  curl -i https://terminal.example.com/health | grep -i csp
  ```
- [ ] Test WebSocket upgrade with correct origin:
  ```bash
  # Expect upgrade success (101 Switching Protocols)
  curl -i -H "Origin: https://cyber-minds.github.io" \
       -H "Connection: upgrade" \
       -H "Upgrade: websocket" \
       https://terminal.example.com/api/terminal/test-session
  ```
- [ ] Test WebSocket upgrade with wrong origin:
  ```bash
  # Expect 403 Forbidden
  curl -i -H "Origin: https://attacker.com" \
       -H "Connection: upgrade" \
       -H "Upgrade: websocket" \
       https://terminal.example.com/api/terminal/test-session
  ```
- [ ] CSP report endpoint is reachable:
  ```bash
  curl -X POST https://terminal.example.com/api/csp-report \
       -H "Content-Type: application/json" \
       -d '{"csp-report": {"blocked-uri": "https://evil.com/script.js"}}'
  ```

---

## Testing Security Headers Locally

### Frontend (GitHub Pages)

GitHub Pages cannot be emulated locally with custom headers. Instead:

1. **Validate with static QA:**
   ```bash
   npm run qa:static
   ```

2. **Inspect HTML for CSP meta tag:**
   ```bash
   grep -r "Content-Security-Policy" HTML/*.html
   ```

### Terminal Backend (Docker)

1. **Start backend locally:**
   ```bash
   cd terminal
   docker compose up -d
   ```

2. **Check CSP header on non-WebSocket request:**
   ```bash
   curl -i http://localhost:3000/health
   # Should include: Content-Security-Policy-Report-Only: ...
   ```

3. **Check CORS header:**
   ```bash
   curl -i -H "Origin: http://localhost" http://localhost:3000/health
   # Should include: Access-Control-Allow-Origin: http://localhost
   ```

4. **Reject invalid origin:**
   ```bash
   curl -i -H "Origin: https://evil.com" http://localhost:3000/health
   # Should return 403 Forbidden
   ```

---

## Incident Response

### Scenario: CSP Violation Detected in Production

1. **Check backend logs for violations:**
   ```bash
   ssh production-host
   docker logs terminal-backend | grep "CSP Violation"
   ```

2. **Identify the blocked resource:**
   - Timestamp of violation
   - Learner's origin (should be `https://cyber-minds.github.io`)
   - Blocked URI (external resource)
   - Violated directive (script-src, style-src, etc.)

3. **Determine if it's legitimate:**
   - Is this a new feature that added a new CDN?
   - Did a third-party service change domains?
   - Is it a CDN misconfiguration?

4. **Fix and redeploy:**
   - If legitimate: add origin to allowlist and CSP policy, redeploy
   - If attack/misconfiguration: block and investigate

---

## FAQ

**Q: Can GitHub Pages set CSP headers?**  
A: No. GitHub Pages uses GitHub-managed infrastructure and does not support custom response headers. You must use static validation (QA script) and meta tags for documentation.

**Q: How does the terminal frontend connect to the backend without CORS errors?**  
A: The terminal backend's CORS middleware echoes back the `Access-Control-Allow-Origin` header if the origin matches the allowlist. The browser checks this header and allows the fetch/WebSocket.

**Q: What happens if the terminal backend is down?**  
A: The frontend page loads fine (served by GitHub Pages). When the learner tries to run code or access the terminal, the browser shows an error connecting to the backend. See [`Javascript/terminal/app/runtime.js`](../Javascript/terminal/app/runtime.js) for the error handling logic.

**Q: Can the frontend send learner data to unapproved third parties?**  
A: Not through a successful HTTP request. The CSP policy and CORS would block it. The only way to bypass CSP is with script injection (XSS), which would require an attacker to compromise GitHub Pages or inject malicious code into an approved CDN.

**Q: How do I add a new external origin?**  
A: See [`docs/ORIGINS.md#appendix-how-to-add-a-new-external-origin`](ORIGINS.md#appendix-how-to-add-a-new-external-origin) for the full checklist.

---

**For questions or escalations, contact the security team or repository maintainers.**
