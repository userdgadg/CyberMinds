#!/usr/bin/env bash
# Readiness probe for the CyberMinds terminal backend.
# Hits /health, measures latency, classifies the outcome.
#
# Output: one JSON line to stdout — {status, category, latency_ms, http_code, checked_at}
# Exit 0 = ok or degraded (high latency, still 2xx)
# Exit 1 = down (timeout, connection error, non-2xx)
# Exit 2 = misconfigured (TERMINAL_HEALTH_URL not set)
#
# No credentials required. Output contains no session, learner, or infra data.

set -euo pipefail

HEALTH_URL="${TERMINAL_HEALTH_URL:-}"
TIMEOUT="${PROBE_TIMEOUT:-10}"
WARN_LATENCY_MS="${PROBE_WARN_LATENCY_MS:-3000}"

if [[ -z "$HEALTH_URL" ]]; then
    printf '{"status":"error","category":"misconfigured","checked_at":"%s"}\n' \
        "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >&2
    exit 2
fi

BASE="${HEALTH_URL%/}"
[[ "$BASE" != */health ]] && BASE="${BASE}/health"

CHECKED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
T0=$(date +%s%3N)
CURL_EC=0
RAW=""

RAW=$(curl --silent --show-error --max-time "$TIMEOUT" \
    --write-out '\n__CODE__%{http_code}' \
    "$BASE" 2>&1) || CURL_EC=$?

T1=$(date +%s%3N)
LATENCY=$(( T1 - T0 ))

HTTP_CODE=0
if [[ "$RAW" =~ __CODE__([0-9]+)$ ]]; then
    HTTP_CODE="${BASH_REMATCH[1]}"
    RAW="${RAW%$'\n'__CODE__*}"
fi

if [[ "$CURL_EC" -eq 28 ]]; then
    STATUS="down"; CAT="timeout"
elif [[ "$CURL_EC" -ne 0 ]]; then
    STATUS="down"; CAT="connection_error"
elif [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    if [[ "$LATENCY" -gt "$WARN_LATENCY_MS" ]]; then
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
