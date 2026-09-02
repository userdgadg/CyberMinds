# Deploy `/terminal` (Production)

This runbook is the current production hosting plan for the terminal backend API.

## Hosting Plan

- Public API URL: `https://terminal.egeuysal.com`
- Runtime stack: Docker Compose + Caddy reverse proxy
- Provider model: self-managed host maintained by project owner
- Primary backend contact: `hi@egeuysal.com`

Operational note:

- The terminal backend is maintained by `egeuysal` at API URL `terminal.egeuysal.com`.
- If it is down, notify Ege at `hi@egeuysal.com`.

## 1. Prepare Environment

Create `terminal/.env`:

```env
PORT=3000
ENVIRONMENT=production
APP_DOMAIN=terminal.egeuysal.com
CADDY_HTTP_PORT=18080
ALLOWED_ORIGINS=https://cyber-minds.github.io
MAX_ACTIVE_SESSIONS=30
SESSION_CREATE_RATE_LIMIT_PER_MINUTE=12
```

Notes:

- `ALLOWED_ORIGINS` must be the exact origin serving the terminal UI page.
- Canonical UI page is `HTML/terminal/index.html` on the main site deployment.

## 2. Build and Start Stack

```bash
docker compose -f terminal/docker-compose.prod.yml --env-file terminal/.env up -d --build
```

## 3. Public Caddy Route

Ensure public Caddy (bound to `:443`) can route `terminal.egeuysal.com` to the terminal Caddy service.

```caddy
terminal.egeuysal.com {
  reverse_proxy terminal-caddy-1:80
}
```

Reload Caddy after updating config.

## 4. Rollout Verification

```bash
curl -sS -i https://terminal.egeuysal.com/health
```

Expected:

- HTTP `200 OK`
- JSON body includes `"status":"ok"` and no Docker or session-count fields

## 5. API Smoke Tests

```bash
# create
curl -sS -X POST https://terminal.egeuysal.com/api/session

# list files
curl -sS https://terminal.egeuysal.com/api/session/<sessionId>/files

# read one file
curl -sS "https://terminal.egeuysal.com/api/session/<sessionId>/file?path=<urlencoded-path>"

# delete
curl -sS -X DELETE https://terminal.egeuysal.com/api/session/<sessionId>
```

## 6. End-to-End Terminal Check

Validate a full terminal cycle using WebSocket:

- Create session
- Connect to `wss://terminal.egeuysal.com/api/terminal/{sessionId}`
- Run a command (for example `echo CYBERMINDS_OK`)
- Confirm output is returned
- Delete session

If session creation fails, check Docker daemon access and image `terminal-base:latest`.
