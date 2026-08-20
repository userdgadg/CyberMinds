#!/usr/bin/env bash
# End-to-end tests for every CTF challenge's setup and check scripts.
# Each case runs in an isolated Docker container with no network access.
# Usage: bash scripts/ctf-challenge-tests.sh
# Requires: docker, python:3.11-slim available (pulled in CI before this runs).

set -euo pipefail

IMAGE="${CTF_TEST_IMAGE:-python:3.11-slim}"
TIMEOUT_SECS=90
pass=0
fail=0

# trun LABEL WANT_PASS(1|0) SCRIPT
trun() {
    local label="$1" want="$2" body="$3"
    local out ec=0
    out=$(timeout "$TIMEOUT_SECS" docker run --rm --network none \
        --memory 192m --cpus 0.5 --security-opt no-new-privileges \
        "$IMAGE" bash -c "$body" 2>&1) || ec=$?
    local ok=false
    { [[ "$want" -eq 1 ]] && [[ "$ec" -eq 0 ]]; } && ok=true
    { [[ "$want" -eq 0 ]] && [[ "$ec" -ne 0 ]]; } && ok=true
    if $ok; then
        printf 'ok   %s\n' "$label"
        pass=$((pass + 1))
    else
        printf 'FAIL %s  (exit=%d want_pass=%d)\n' "$label" "$ec" "$want"
        printf '%s\n' "$out" | head -5 | sed 's/^/     /'
        fail=$((fail + 1))
    fi
}

printf '=== CTF challenge script tests  image=%s ===\n\n' "$IMAGE"

# ---------------------------------------------------------------------------
# linux-basics
# Check: set -e; test -f report.txt; test -s report.txt; grep -Eqi pattern
# ---------------------------------------------------------------------------
echo '--- linux-basics ---'
trun 'linux-basics: valid report' 1 '
mkdir -p /workspace
echo "owner: root, group: staff, permissions: drwxr-xr-x" > /workspace/report.txt
cd /workspace
set -e
test -f report.txt
test -s report.txt
grep -Eqi "(owner|permission|user|group)" report.txt
echo PASS
'

trun 'linux-basics: empty report fails' 0 '
mkdir -p /workspace
> /workspace/report.txt
cd /workspace
set -e
test -s report.txt
'

trun 'linux-basics: wrong keyword fails' 0 '
mkdir -p /workspace
echo "hello world" > /workspace/report.txt
cd /workspace
grep -Eqi "(owner|permission|user|group)" report.txt
'

# ---------------------------------------------------------------------------
# web-recon
# Check: grep for port 9090, php 7, internal portal, server/status header
# ---------------------------------------------------------------------------
echo '--- web-recon ---'
trun 'web-recon: valid notes' 1 '
mkdir -p /workspace
cat > /workspace/recon-notes.txt << '"'"'NOTES'"'"'
Status: 200 OK
Server: nginx/1.18.0
Content-Type: text/html
Port: 9090
X-Powered-By: PHP/7.4.3
X-Application: InternalPortal/2.1
NOTES
cd /workspace
set -e
test -f recon-notes.txt && test -s recon-notes.txt
grep -Eqi "(server|content-type|status|header)" recon-notes.txt
grep -Eq "(^|[^0-9])9090([^0-9]|$)" recon-notes.txt
grep -Eqi "php[/ ]?7" recon-notes.txt
grep -Eqi "internal.?portal" recon-notes.txt
echo PASS
'

trun 'web-recon: missing port 9090 fails' 0 '
mkdir -p /workspace
printf "Status: 200\nServer: nginx\nContent-Type: text/html\n" > /workspace/recon-notes.txt
grep -Eq "(^|[^0-9])9090([^0-9]|$)" /workspace/recon-notes.txt
'

trun 'web-recon: missing PHP version fails' 0 '
mkdir -p /workspace
printf "Status: 200\nPort: 9090\nX-Application: InternalPortal\n" > /workspace/recon-notes.txt
grep -Eqi "php[/ ]?7" /workspace/recon-notes.txt
'

# ---------------------------------------------------------------------------
# log-hunt
# Check (Python): findings.txt contains IP, count >= 10, attack keyword
# ---------------------------------------------------------------------------
echo '--- log-hunt ---'
trun 'log-hunt: valid findings' 1 '
mkdir -p /workspace
cat > /workspace/findings.txt << '"'"'FINDINGS'"'"'
12  192.168.1.45  brute force auth spike detected
 3  10.0.0.12
 3  172.16.0.99
FINDINGS
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/findings.txt").read()
if not content.strip(): sys.exit(1)
if "192.168.1.45" not in content: sys.exit(1)
m = re.search(r"(\d+)\s+192\.168\.1\.45", content)
if not m or int(m.group(1)) < 10: sys.exit(1)
if not re.search(r"failed|attempt|auth|spike|brute", content, re.I): sys.exit(1)
print("PASS")
PYEOF
'

trun 'log-hunt: wrong IP fails' 0 '
mkdir -p /workspace
echo "12  10.0.0.1  auth spike" > /workspace/findings.txt
python3 - << '"'"'PYEOF'"'"'
import sys
content = open("/workspace/findings.txt").read()
if "192.168.1.45" not in content: sys.exit(1)
print("PASS")
PYEOF
'

trun 'log-hunt: count below 10 fails' 0 '
mkdir -p /workspace
echo "5  192.168.1.45  brute force" > /workspace/findings.txt
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/findings.txt").read()
if "192.168.1.45" not in content: sys.exit(1)
m = re.search(r"(\d+)\s+192\.168\.1\.45", content)
if not m or int(m.group(1)) < 10: sys.exit(1)
print("PASS")
PYEOF
'

# ---------------------------------------------------------------------------
# priv-esc
# Check (Python): report mentions jsmith, timestamp 02:11, su/escalat
# The image bakes auth.log/sudo.log; tests inline the checker logic.
# ---------------------------------------------------------------------------
echo '--- priv-esc ---'
trun 'priv-esc: valid report' 1 '
mkdir -p /workspace
cat > /workspace/priv-esc-report.txt << '"'"'RPT'"'"'
User jsmith authenticated via SSH from 10.0.0.45 at 02:09.
At 02:11 jsmith ran su to escalate privileges to root.
Escalation method confirmed: su command in interactive sudo session.
RPT
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/priv-esc-report.txt").read()
if not content.strip(): sys.exit(1)
for pattern, msg in [
    (r"\bjsmith\b", "must mention user jsmith"),
    (r"02:11",      "must include timestamp 02:11"),
    (r"\bsu\b|escalat", "must reference su or escalation"),
]:
    if not re.search(pattern, content, re.IGNORECASE):
        print(f"FAIL: {msg}"); sys.exit(1)
print("PASS")
PYEOF
'

trun 'priv-esc: missing timestamp fails' 0 '
mkdir -p /workspace
echo "jsmith used su to escalate to root." > /workspace/priv-esc-report.txt
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/priv-esc-report.txt").read()
if not re.search(r"02:11", content): sys.exit(1)
print("PASS")
PYEOF
'

trun 'priv-esc: missing username fails' 0 '
mkdir -p /workspace
echo "At 02:11 the attacker escalated via su." > /workspace/priv-esc-report.txt
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/priv-esc-report.txt").read()
if not re.search(r"\bjsmith\b", content, re.IGNORECASE): sys.exit(1)
print("PASS")
PYEOF
'

# ---------------------------------------------------------------------------
# incident-timeline
# Check (bash): 8+ sorted unique HH:MM:SS entries, ssh keyword, http keyword
# ---------------------------------------------------------------------------
echo '--- incident-timeline ---'
trun 'incident-timeline: valid timeline' 1 '
mkdir -p /workspace
cat > /workspace/timeline.txt << '"'"'TL'"'"'
03:10:14 SSH Failed password for admin from 192.168.50.22
03:10:29 SSH Failed password for admin from 192.168.50.22
03:10:47 SSH Accepted password for admin from 192.168.50.22
03:10:48 SSH session opened for user admin
03:10:50 HTTP GET /login 200
03:11:02 HTTP POST /login 302
03:11:05 HTTP GET /admin 200
03:12:05 SSH session closed for user admin
TL
cd /workspace
set -e
test -f timeline.txt && test -s timeline.txt
awk '"'"'NF{print $1}'"'"' timeline.txt > /tmp/ts.txt
test "$(wc -l < /tmp/ts.txt)" -ge 8
if grep -Evq '"'"'^[0-9]{2}:[0-9]{2}:[0-9]{2}$'"'"' /tmp/ts.txt; then echo "FAIL: bad timestamp format"; exit 1; fi
sort /tmp/ts.txt | uniq > /tmp/ts_sorted.txt
cmp -s /tmp/ts.txt /tmp/ts_sorted.txt
grep -Eqi '"'"'(ssh|login|accept)'"'"' timeline.txt
grep -Eqi '"'"'(http|get|post|request)'"'"' timeline.txt
echo PASS
'

trun 'incident-timeline: too few entries fails' 0 '
mkdir -p /workspace
printf "%s\n" "03:10:14 SSH login" "03:10:29 SSH failed" "03:11:00 HTTP GET" > /workspace/timeline.txt
awk '"'"'NF{print $1}'"'"' /workspace/timeline.txt > /tmp/ts.txt
test "$(wc -l < /tmp/ts.txt)" -ge 8
'

trun 'incident-timeline: unsorted timestamps fails' 0 '
mkdir -p /workspace
cat > /workspace/timeline.txt << '"'"'TL'"'"'
03:12:00 SSH session closed
03:10:00 SSH login attempt
03:10:01 SSH login attempt
03:10:02 SSH login attempt
03:10:03 SSH login accepted
03:10:04 HTTP GET /admin
03:10:05 HTTP POST /login
03:11:00 HTTP GET /logout
TL
awk '"'"'NF{print $1}'"'"' /workspace/timeline.txt > /tmp/ts.txt
sort /tmp/ts.txt | uniq > /tmp/ts_sorted.txt
cmp -s /tmp/ts.txt /tmp/ts_sorted.txt
'

# ---------------------------------------------------------------------------
# suspicious-beaconing
# Check (Python): beacon-report.txt has IP, UA string, interval/pattern
# ---------------------------------------------------------------------------
echo '--- suspicious-beaconing ---'
trun 'suspicious-beaconing: valid report' 1 '
mkdir -p /workspace
cat > /workspace/beacon-report.txt << '"'"'RPT'"'"'
IP: 192.0.2.10  UA: Mozilla/5.0 (Windows NT 10.0)  interval: 30s  path: /ping
IP: 203.0.113.77  UA: python-requests/2.28.0  interval: 30s  path: /login
Pattern: periodic callback every 30 seconds — suspected beaconing
RPT
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/beacon-report.txt").read(65536)
if not content.strip(): sys.exit(1)
if not re.search(r"192\.0\.2\.10|203\.0\.113\.77", content): sys.exit(1)
if not re.search(r"(user.?agent|ua|Mozilla|python.requests)", content, re.I): sys.exit(1)
if not re.search(r"(interval|period|every|beacon|repeat|callback|pattern|30s|30 sec)", content, re.I): sys.exit(1)
print("PASS: beacon-report.txt is valid.")
PYEOF
'

trun 'suspicious-beaconing: no IP fails' 0 '
mkdir -p /workspace
echo "UA: python-requests/2.28.0  interval: 30s beaconing pattern" > /workspace/beacon-report.txt
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/beacon-report.txt").read()
if not re.search(r"192\.0\.2\.10|203\.0\.113\.77", content): sys.exit(1)
print("PASS")
PYEOF
'

trun 'suspicious-beaconing: no interval fails' 0 '
mkdir -p /workspace
echo "IP: 192.0.2.10  UA: Mozilla/5.0 suspicious activity" > /workspace/beacon-report.txt
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/beacon-report.txt").read()
if not re.search(r"192\.0\.2\.10|203\.0\.113\.77", content): sys.exit(1)
if not re.search(r"(interval|period|every|beacon|repeat|callback|pattern|30s|30 sec)", content, re.I): sys.exit(1)
print("PASS")
PYEOF
'

# ---------------------------------------------------------------------------
# phishing-header
# Check (Python): findings name the impersonated domain + 3 of 4 indicators
# ---------------------------------------------------------------------------
echo '--- phishing-header ---'
trun 'phishing-header: four indicators' 1 '
mkdir -p /workspace
cat > /workspace/phishing-findings.txt << '"'"'FINDINGS'"'"'
Impersonated domain: corporate-alerts.example.com (Security Team)
Return-Path mismatch: envelope sender is bounces@phish-mailer.invalid
SPF fail: 203.0.113.99 is not a permitted sender for corporate-alerts.example.com
DKIM fail: signature verification failed for corporate-alerts.example.com
Suspicious Received chain: mail relayed through phish-mailer.invalid
FINDINGS
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/phishing-findings.txt").read(10000)
if not content.strip(): sys.exit(1)
if not re.search(r"corporate.alerts|security.team|noreply@|impersonat|spoof", content, re.I): sys.exit(1)
indicators = [
    bool(re.search(r"return.path|phish.mailer|mismatch|envelope", content, re.I)),
    bool(re.search(r"spf.*fail|fail.*spf|spf=fail", content, re.I)),
    bool(re.search(r"dkim.*fail|fail.*dkim|dkim=fail|signature.*fail", content, re.I)),
    bool(re.search(r"received|relay|hop|chain", content, re.I)),
]
if sum(indicators) < 3: sys.exit(1)
print("PASS: phishing-findings.txt is valid.")
PYEOF
'

trun 'phishing-header: three indicators (minimum)' 1 '
mkdir -p /workspace
cat > /workspace/phishing-findings.txt << '"'"'FINDINGS'"'"'
Impersonated domain: corporate-alerts.example.com
Return-Path mismatch: bounces@phish-mailer.invalid
SPF fail: sender not authorised
Received chain: relayed through phish-mailer.invalid
FINDINGS
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/phishing-findings.txt").read(10000)
if not re.search(r"corporate.alerts|security.team|noreply@|impersonat|spoof", content, re.I): sys.exit(1)
indicators = [
    bool(re.search(r"return.path|phish.mailer|mismatch|envelope", content, re.I)),
    bool(re.search(r"spf.*fail|fail.*spf|spf=fail", content, re.I)),
    bool(re.search(r"dkim.*fail|fail.*dkim|dkim=fail|signature.*fail", content, re.I)),
    bool(re.search(r"received|relay|hop|chain", content, re.I)),
]
if sum(indicators) < 3: sys.exit(1)
print("PASS")
PYEOF
'

trun 'phishing-header: missing domain fails' 0 '
mkdir -p /workspace
cat > /workspace/phishing-findings.txt << '"'"'FINDINGS'"'"'
SPF fail: sender not authorised
DKIM fail: signature invalid
Received chain: suspicious relay
FINDINGS
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/phishing-findings.txt").read()
if not re.search(r"corporate.alerts|security.team|noreply@|impersonat|spoof", content, re.I): sys.exit(1)
print("PASS")
PYEOF
'

trun 'phishing-header: only 2 indicators fails' 0 '
mkdir -p /workspace
cat > /workspace/phishing-findings.txt << '"'"'FINDINGS'"'"'
Impersonated domain: corporate-alerts.example.com
SPF fail: sender not permitted for this domain
FINDINGS
python3 - << '"'"'PYEOF'"'"'
import re, sys
content = open("/workspace/phishing-findings.txt").read()
if not re.search(r"corporate.alerts|security.team|noreply@|impersonat|spoof", content, re.I): sys.exit(1)
indicators = [
    bool(re.search(r"return.path|phish.mailer|mismatch|envelope", content, re.I)),
    bool(re.search(r"spf.*fail|fail.*spf|spf=fail", content, re.I)),
    bool(re.search(r"dkim.*fail|fail.*dkim|dkim=fail|signature.*fail", content, re.I)),
    bool(re.search(r"received|relay|hop|chain", content, re.I)),
]
if sum(indicators) < 3: sys.exit(1)
print("PASS")
PYEOF
'

# ---------------------------------------------------------------------------
# iam-least-privilege
# Check (Python): policy.json has no wildcards, has the 4 required actions,
# S3 resource references the correct bucket.
# ---------------------------------------------------------------------------
echo '--- iam-least-privilege ---'

# Shared checker body used by multiple cases below
IAM_CHECKER='
python3 - << '"'"'PYEOF'"'"'
import json, sys
raw = open("/workspace/policy.json").read(50000)
try:
    policy = json.loads(raw)
except Exception as e:
    print(f"FAIL: invalid JSON — {e}"); sys.exit(1)
stmts = policy.get("Statement", [])
if not stmts:
    print("FAIL: no Statement"); sys.exit(1)
actions = set()
resources = set()
for i, stmt in enumerate(stmts):
    p = stmt.get("Principal")
    if stmt.get("Effect") == "Allow" and p is not None:
        if p == "*" or (isinstance(p, dict) and p.get("AWS") == "*"):
            print("FAIL: public principal"); sys.exit(1)
    if stmt.get("Effect") != "Allow":
        continue
    aa = stmt.get("Action", [])
    rr = stmt.get("Resource", [])
    if isinstance(aa, str): aa = [aa]
    if isinstance(rr, str): rr = [rr]
    for a in aa:
        if a == "*" or a.endswith(":*"):
            print(f"FAIL: wildcard action {a!r}"); sys.exit(1)
        actions.add(a.lower())
    for r in rr:
        if r == "*":
            print("FAIL: wildcard resource"); sys.exit(1)
        resources.add(r.lower())
for required in ("s3:getobject", "s3:listbucket", "logs:putlogevents"):
    if required not in actions:
        print(f"FAIL: missing {required}"); sys.exit(1)
if not any("cm-backup-data-123456789012" in r for r in resources):
    print("FAIL: S3 resource must reference cm-backup-data-123456789012"); sys.exit(1)
print("PASS: policy uses least-privilege permissions.")
PYEOF
'

trun 'iam-least-privilege: scoped policy passes' 1 '
mkdir -p /workspace
python3 -c "
import json
p = {
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Sid\": \"S3Read\", \"Effect\": \"Allow\",
     \"Action\": [\"s3:GetObject\", \"s3:ListBucket\"],
     \"Resource\": [\"arn:aws:s3:::cm-backup-data-123456789012/prod/daily/*\",
                   \"arn:aws:s3:::cm-backup-data-123456789012\"]},
    {\"Sid\": \"CWLWrite\", \"Effect\": \"Allow\",
     \"Action\": [\"logs:CreateLogStream\", \"logs:PutLogEvents\"],
     \"Resource\": [\"arn:aws:logs:us-east-1:123456789012:log-group:/backup/cm-agent:*\"]}
  ]
}
open(\"/workspace/policy.json\",\"w\").write(json.dumps(p, indent=2))
"
'"$IAM_CHECKER"'
'

trun 'iam-least-privilege: wildcard action fails' 0 '
mkdir -p /workspace
echo '"'"'{"Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}'"'"' > /workspace/policy.json
'"$IAM_CHECKER"'
'

trun 'iam-least-privilege: wildcard service action fails' 0 '
mkdir -p /workspace
python3 -c "
import json
p = {\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:*\",\"Resource\":\"arn:aws:s3:::cm-backup-data-123456789012\"}]}
open(\"/workspace/policy.json\",\"w\").write(json.dumps(p))
"
'"$IAM_CHECKER"'
'

trun 'iam-least-privilege: missing s3:GetObject fails' 0 '
mkdir -p /workspace
python3 -c "
import json
p = {\"Statement\":[{\"Effect\":\"Allow\",
  \"Action\":[\"s3:ListBucket\",\"logs:CreateLogStream\",\"logs:PutLogEvents\"],
  \"Resource\":[\"arn:aws:s3:::cm-backup-data-123456789012\"]}]}
open(\"/workspace/policy.json\",\"w\").write(json.dumps(p))
"
'"$IAM_CHECKER"'
'

trun 'iam-least-privilege: wrong bucket ARN fails' 0 '
mkdir -p /workspace
python3 -c "
import json
p = {\"Statement\":[{\"Effect\":\"Allow\",
  \"Action\":[\"s3:GetObject\",\"s3:ListBucket\",\"logs:CreateLogStream\",\"logs:PutLogEvents\"],
  \"Resource\":[\"arn:aws:s3:::some-other-bucket\"]}]}
open(\"/workspace/policy.json\",\"w\").write(json.dumps(p))
"
'"$IAM_CHECKER"'
'

trun 'iam-least-privilege: public principal fails' 0 '
mkdir -p /workspace
python3 -c "
import json
p = {\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",
  \"Action\":[\"s3:GetObject\",\"s3:ListBucket\"],
  \"Resource\":[\"arn:aws:s3:::cm-backup-data-123456789012\"]}]}
open(\"/workspace/policy.json\",\"w\").write(json.dumps(p))
"
'"$IAM_CHECKER"'
'

trun 'iam-least-privilege: malformed JSON fails' 0 '
mkdir -p /workspace
echo '"'"'not-json'"'"' > /workspace/policy.json
'"$IAM_CHECKER"'
'

# ---------------------------------------------------------------------------
printf '\n=== Results: %d passed, %d failed ===\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]