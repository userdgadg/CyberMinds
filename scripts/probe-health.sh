#!/usr/bin/env bash
# Readiness probe for the CyberMinds terminal backend.
# Hits /health, measures latency, classifies the outcome.
#
# Output: one JSON line to stdout — {status, category, latency_ms, http_code, checked_at}
# Exit 0 = ok or degraded (high latency, still 2xx)
# Exit 1 = down (timeout, connection error, invalid response, non-2xx)
# Exit 2 = misconfigured (missing or invalid probe configuration)
#
# No credentials required. Output contains no session, learner, or infra data.

set -euo pipefail

timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

misconfigured() {
    printf '{"status":"error","category":"misconfigured","checked_at":"%s"}\n' "$(timestamp)"
    exit 2
}

HEALTH_URL="${TERMINAL_HEALTH_URL:-}"
TIMEOUT="${PROBE_TIMEOUT:-10}"
WARN_LATENCY_MS="${PROBE_WARN_LATENCY_MS:-3000}"

if [[ -z "$HEALTH_URL" || "$HEALTH_URL" == *\?* || "$HEALTH_URL" == *\#* ]]; then
    misconfigured
fi

if [[ "$HEALTH_URL" != https://* && "$HEALTH_URL" != http://* ]] \
    || ! [[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] \
    || ! [[ "$WARN_LATENCY_MS" =~ ^[0-9][0-9]*$ ]]; then
    misconfigured
fi

BASE="${HEALTH_URL%/}"
[[ "$BASE" != */health ]] && BASE="${BASE}/health"

CHECKED_AT=$(timestamp)
CURL_EC=0
CURL_META=""
RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

CURL_META=$(curl --silent --show-error --output "$RESPONSE_FILE" --max-time "$TIMEOUT" \
    --write-out '%{http_code} %{time_total}' \
    "$BASE" 2>/dev/null) || CURL_EC=$?

HTTP_CODE="${CURL_META%% *}"
CURL_TIME="${CURL_META#* }"
if ! [[ "$HTTP_CODE" =~ ^[0-9][0-9][0-9]$ ]]; then
    HTTP_CODE=0
fi
LATENCY=0
if [[ "$CURL_TIME" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    LATENCY=$(LC_ALL=C awk -v seconds="$CURL_TIME" 'BEGIN { printf "%.0f", seconds * 1000 }')
fi

if [[ "$CURL_EC" -eq 28 ]]; then
    STATUS="down"; CAT="timeout"
elif [[ "$CURL_EC" -ne 0 ]]; then
    STATUS="down"; CAT="connection_error"
elif [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    if ! python3 - "$RESPONSE_FILE" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as response:
        payload = json.load(response)
except (OSError, ValueError):
    raise SystemExit(1)

raise SystemExit(0 if isinstance(payload, dict) and payload.get("status") == "ok" else 1)
PY
    then
        STATUS="down"; CAT="invalid_response"
    elif [[ "$LATENCY" -gt "$WARN_LATENCY_MS" ]]; then
        STATUS="degraded"; CAT="high_latency"
    else
        STATUS="ok"; CAT="ok"
    fi
else
    STATUS="down"; CAT="non_2xx"
fi

printf '{"status":"%s","category":"%s","latency_ms":%d,"http_code":%d,"checked_at":"%s"}\n' \
    "$STATUS" "$CAT" "$LATENCY" "$HTTP_CODE" "$CHECKED_AT"

[[ "$STATUS" == "ok" || "$STATUS" == "degraded" ]]
