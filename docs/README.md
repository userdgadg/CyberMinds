# Security Documentation Index

This folder contains security and deployment documentation for CyberMinds.

---

## Quick Start

**New to CyberMinds security architecture?** Start here:

1. Read [`IMPLEMENTATION_SUMMARY.md`](IMPLEMENTATION_SUMMARY.md) for an overview of what was delivered
2. Read [`ORIGINS.md`](ORIGINS.md) to understand approved external origins
3. Read [`DEPLOYMENT.md`](DEPLOYMENT.md) to understand GitHub Pages vs Terminal Backend differences

---

## Documentation Files

### [`ORIGINS.md`](ORIGINS.md) - External Origins Inventory
**Purpose:** Source of truth for all approved external origins used by CyberMinds

**Contains:**
- Approved origins grouped by purpose (fonts, editor, analytics, etc.)
- For each origin: purpose, data sent, CSP directive, approval date
- Trust boundary model with diagram
- CSP policies by deployment tier
- How to add a new external origin (with checklist)
- Incident response procedures

**Use this when:**
- Adding a new external resource (fonts, CDN, analytics, etc.)
- Reviewing which third-party services CyberMinds uses
- Investigating a CSP violation
- Explaining security model to stakeholders

---

### [`DEPLOYMENT.md`](DEPLOYMENT.md) - Deployment & Security Headers
**Purpose:** Clarify which security headers can be controlled by each deployment tier

**Contains:**
- GitHub Pages limitations (cannot set HTTP response headers)
- Terminal Backend capabilities (can set all headers)
- CSP strategy for static frontend vs dynamic API
- Security headers set by terminal backend
- CORS validation details
- Deployment checklists for both tiers
- How to test security headers locally
- FAQ and troubleshooting

**Use this when:**
- Deploying CyberMinds (frontend or backend)
- Understanding why GitHub Pages cannot enforce CSP headers
- Setting up ALLOWED_ORIGINS environment variable
- Testing security headers before deployment

---

### [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) - Pre-Deployment & Incident Response
**Purpose:** Checklists and playbooks for security reviews and incident response

**Contains:**
- Pre-deployment checklist (frontend and backend)
- Review checklist for new external origin PRs
- Incident response playbooks:
  - New external resource appearing in logs
  - Third-party service domain change
  - CDN down (what to do)
- Monthly/quarterly maintenance checklist
- Troubleshooting common issues

**Use this when:**
- Reviewing code before deployment
- Responding to a CSP violation
- Checking if a CDN outage requires action
- Performing security maintenance

---

### [`IMPLEMENTATION_SUMMARY.md`](IMPLEMENTATION_SUMMARY.md) - What Was Delivered
**Purpose:** Overview of the trust boundary validation implementation

**Contains:**
- Summary of all deliverables
- Files created and modified
- Acceptance criteria verification
- Deployment steps
- Continuous validation strategy
- Future improvements

**Use this when:**
- Onboarding new team members
- Verifying implementation completeness
- Understanding what changed in this release

---

### [`ANALYTICS.md`](ANALYTICS.md) - Analytics Implementation
**Purpose:** Details on how analytics is implemented and privacy-preserved

**Contains:**
- How Umami is configured
- Privacy guarantees (PII-blocking, DNT respect)
- Event schema and blocked keys
- Installation instructions

**Use this when:**
- Adding a new analytics event
- Understanding privacy protections
- Debugging analytics issues

---

### [`QUIZ_ENGINE.md`](QUIZ_ENGINE.md) - Quiz System
**Purpose:** Documentation of the quiz engine implementation

**Contains:**
- Quiz engine architecture
- How scores are calculated
- Progress tracking

**Use this when:**
- Adding new quizzes
- Debugging quiz functionality
- Understanding learner progress

---

## Security-Related Files in Other Locations

### Frontend
- [`scripts/qa-static.js`](../scripts/qa-static.js) - Static QA script that gates deployments
- [`scripts/qa-allowlist.json`](../scripts/qa-allowlist.json) - Approved external origins allowlist
- [`tests/smoke.spec.js`](../tests/smoke.spec.js) - Smoke tests including CSP validation

### Terminal Backend
- [`terminal/backend/middleware.go`](../terminal/backend/middleware.go) - Security headers and CSP
- [`terminal/backend/handlers_security.go`](../terminal/backend/handlers_security.go) - CSP report handler
- [`terminal/.env.example`](../terminal/.env.example) - ALLOWED_ORIGINS configuration

### CI/CD
- [`.github/workflows/qa-static.yml`](../.github/workflows/qa-static.yml) - QA check on every commit

---

## Security Model Summary

```
Public Learner Pages (GitHub Pages)
  ├─ HTML/CSS/JS served by GitHub Pages
  ├─ Cannot set HTTP response headers (GitHub limitation)
  ├─ CSP validated via static QA on every commit
  └─ External origins validated against the approved list

Terminal Page (GitHub Pages)
  ├─ HTML/CSS/JS served by GitHub Pages
  ├─ Links to Terminal WebSocket/API
  └─ Supplied Origin header checked by backend

Terminal Backend (Azure VM)
  ├─ REST API + WebSocket for learner code execution
  ├─ CORS middleware validates Origin header
  ├─ WebSocket upgrade checks origin before upgrade
  ├─ CSP header applied to non-WebSocket requests
  ├─ CSP violations logged to backend logs
  └─ No external origins contacted (isolated)

Data Flow:
  Frontend ←→ Approved CDNs (read-only, public resources)
  Frontend ←→ Terminal Backend (CORS validated)
  Terminal Backend ←→ Docker (isolated, no external access)
```

---

## Approval & Review Process

When adding a new external origin (new CDN, font service, analytics, etc.):

1. **Code Change:** Update HTML/CSS/JS to use new resource
2. **Allowlist:** Add to `scripts/qa-allowlist.json` with brief reason
3. **Documentation:** Add to `docs/ORIGINS.md` with:
   - Purpose
   - Data sent (none, metadata, events, etc.)
   - Security justification
   - CSP directive
4. **Testing:** Ensure `npm run qa:static` and `npm run test:smoke` pass
5. **Review:** Security team reviews privacy policy, data handling, incident response
6. **Approval:** Maintainer approves
7. **Merge:** Deploy to main (GitHub Pages) or production (backend)

**See [`ORIGINS.md#appendix-how-to-add-a-new-external-origin`](ORIGINS.md#appendix-how-to-add-a-new-external-origin) for full checklist.**

---

## Monitoring & Alerts

**Frontend:**
- ✅ QA script runs on every commit (GitHub Actions)
- ✅ Smoke tests run on every commit (GitHub Actions)
- ✅ Any unapproved origin blocks deployment

**Backend:**
- ✅ CSP violations logged with timestamp and details
- ✅ Unapproved origins marked as critical severity
- ✅ Setup alerting on critical CSP violations

---

## Incident Response

**If something goes wrong:**

1. **CSP violation in production?** → See [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md#incident-response-csp-violation-detected)
2. **New external resource appeared?** → See [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md#scenario-1-new-external-resource-appearing-in-logs)
3. **Third-party service down?** → See [`DEPLOYMENT.md#scenario-cdn-down`](DEPLOYMENT.md#scenario-3-cdn-down-jsdelivr-google-fonts-etc)
4. **CI check failing?** → See [`SECURITY_CHECKLIST.md#troubleshooting`](SECURITY_CHECKLIST.md#troubleshooting)

---

## Contact & Questions

- **Security concerns:** Create a GitHub issue or contact security team
- **Deployment questions:** See [`DEPLOYMENT.md`](DEPLOYMENT.md#deployment-checklist)
- **How to add a new origin?** See [`ORIGINS.md#appendix`](ORIGINS.md#appendix-how-to-add-a-new-external-origin)

---

**Last Updated:** 2026-08-16
