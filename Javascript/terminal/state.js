/**
 * @file Shared runtime state and static configuration for the terminal frontend.
 *
 * Defines mutable UI/session state, API origin resolution, starter templates,
 * and challenge metadata used by `mock.js` and `app.js`.
 */
let editor;
let terminal;
let fitAddon;
let ws;
let sessionId;
let currentLang = 'python';
let workspaceFiles = [];
let workspaceSyncTimer = null;
let pendingCheck = null;
let completedChallenges = {};
let autoSaveTimer = null;
let currentTheme = 'dark';
let activeMobileView = 'terminal';
let isCommandPaletteOpen = false;
let commandPaletteItems = [];
let commandPaletteSelectedIndex = 0;
let activeEditorFile = {
  kind: 'template',
  lang: 'python',
  filename: 'hello.py',
  path: '',
};
let isInitialLoad = true;
const PROGRESS_STORAGE_KEY = 'cm_ctf_progress_v1';
const THEME_STORAGE_KEY = 'cm_terminal_theme_v1';
const DRAFT_STORAGE_PREFIX = 'cm_terminal_draft_v1';
const MAX_WORKSPACE_FILE_TABS = 200;

const query = new URLSearchParams(window.location.search);
// Two-deployment setup:
// - Terminal UI is served by main website deployment.
// - Terminal backend is served by dedicated API domain.
// Localhost is kept for local development convenience.
const isLocalHost = ['localhost', '127.0.0.1'].includes(
  window.location.hostname
);
const defaultApiOrigin = isLocalHost
  ? window.location.origin
  : 'https://cyberminds-terminal-20260621-ncus.northcentralus.cloudapp.azure.com';
const configuredApiOrigin = query.get('apiOrigin') || defaultApiOrigin;
const apiOrigin = (() => {
  try {
    return new URL(configuredApiOrigin).origin;
  } catch {
    return defaultApiOrigin;
  }
})();

function getWsOrigin(origin) {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.origin;
}

const isMockTerminal = query.get('mockTerminal') === '1';
const codeSamples = {
  python: `# Python starter\nprint("CyberMinds terminal ready")\n`,
  javascript: `// JavaScript starter\nconsole.log("CyberMinds terminal ready");\n`,
  java: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("CyberMinds terminal ready");\n    }\n}\n`,
  go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("CyberMinds terminal ready")\n}\n`,
};

const runCommands = {
  python: 'python3 hello.py',
  javascript: 'node hello.js',
  java: 'javac Hello.java && java Hello',
  go: 'go run hello.go',
};

const templateFilenames = {
  python: 'hello.py',
  javascript: 'hello.js',
  java: 'Hello.java',
  go: 'hello.go',
};

const logHuntSampleLog = [
  '# SYNTHETIC DATA - NOT FROM A REAL INCIDENT',
  'Jan 20 14:00:01 server sshd[1101]: Failed password for root from 192.168.1.45 port 51001 ssh2',
  'Jan 20 14:00:05 server sshd[1102]: Failed password for admin from 192.168.1.45 port 51002 ssh2',
  'Jan 20 14:00:09 server sshd[1103]: Failed password for ubuntu from 192.168.1.45 port 51003 ssh2',
  'Jan 20 14:00:14 server sshd[1104]: Failed password for root from 192.168.1.45 port 51004 ssh2',
  'Jan 20 14:00:18 server sshd[1105]: Failed password for pi from 192.168.1.45 port 51005 ssh2',
  'Jan 20 14:00:22 server sshd[1106]: Failed password for test from 192.168.1.45 port 51006 ssh2',
  'Jan 20 14:00:26 server sshd[1107]: Failed password for guest from 192.168.1.45 port 51007 ssh2',
  'Jan 20 14:00:31 server sshd[1108]: Failed password for user from 192.168.1.45 port 51008 ssh2',
  'Jan 20 14:00:35 server sshd[1109]: Failed password for admin from 192.168.1.45 port 51009 ssh2',
  'Jan 20 14:00:39 server sshd[1110]: Failed password for root from 192.168.1.45 port 51010 ssh2',
  'Jan 20 14:00:43 server sshd[1111]: Failed password for deploy from 192.168.1.45 port 51011 ssh2',
  'Jan 20 14:00:47 server sshd[1112]: Failed password for root from 192.168.1.45 port 51012 ssh2',
  'Jan 20 14:01:05 server sshd[1201]: Failed password for root from 10.0.0.12 port 52001 ssh2',
  'Jan 20 14:01:33 server sshd[1202]: Failed password for admin from 10.0.0.12 port 52002 ssh2',
  'Jan 20 14:02:07 server sshd[1203]: Failed password for ubuntu from 10.0.0.12 port 52003 ssh2',
  'Jan 20 14:02:41 server sshd[1204]: Failed password for root from 10.0.0.12 port 52004 ssh2',
  'Jan 20 14:03:10 server sshd[1205]: Failed password for test from 10.0.0.12 port 52005 ssh2',
  'Jan 20 14:03:22 server sshd[1206]: Failed password for pi from 10.0.0.12 port 52006 ssh2',
  'Jan 20 14:05:10 server sshd[1301]: Failed password for root from 172.16.0.99 port 53001 ssh2',
  'Jan 20 14:05:45 server sshd[1302]: Failed password for admin from 172.16.0.99 port 53002 ssh2',
  'Jan 20 14:06:03 server sshd[1303]: Failed password for ubuntu from 172.16.0.99 port 53003 ssh2',
  'Jan 20 14:10:00 server sshd[1401]: Accepted password for deploy from 10.0.50.1 port 43210 ssh2',
].join('\n');

const logHuntSetupScript = [
  "cat > /workspace/sample.log <<'CM_LOG_HUNT_SAMPLE'",
  logHuntSampleLog,
  'CM_LOG_HUNT_SAMPLE',
].join('\n');

const logHuntCheckScript = [
  "python3 - <<'CM_LOG_HUNT_CHECK'",
  'import re, sys',
  'try:',
  '    with open("/workspace/findings.txt") as f:',
  '        content = f.read()',
  'except Exception:',
  '    print("FAIL: cannot read findings.txt")',
  '    sys.exit(1)',
  'if not content.strip():',
  '    print("FAIL: findings.txt is empty")',
  '    sys.exit(1)',
  'if "192.168.1.45" not in content:',
  '    print("FAIL: top offending IP 192.168.1.45 not identified")',
  '    sys.exit(1)',
  'm = re.search(r"(\\d+)\\s+192\\.168\\.1\\.45", content)',
  'if not m or int(m.group(1)) < 10:',
  '    print("FAIL: include the attempt count for 192.168.1.45")',
  '    sys.exit(1)',
  'if not re.search(r"failed|attempt|auth|spike|brute", content, re.I):',
  '    print("FAIL: add an incident summary mentioning the attack type")',
  '    sys.exit(1)',
  'print("PASS")',
  'CM_LOG_HUNT_CHECK',
].join('\n');

const beaconAccessLog = [
  '# SYNTHETIC DATA - NOT FROM A REAL INCIDENT',
  '192.0.2.10 - - [20/Jan/2026:09:00:00 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '192.0.2.10 - - [20/Jan/2026:09:00:30 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '192.0.2.10 - - [20/Jan/2026:09:01:00 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '192.0.2.10 - - [20/Jan/2026:09:01:30 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '192.0.2.10 - - [20/Jan/2026:09:02:00 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '192.0.2.10 - - [20/Jan/2026:09:02:30 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '192.0.2.10 - - [20/Jan/2026:09:03:00 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '192.0.2.10 - - [20/Jan/2026:09:03:30 +0000] "GET /ping HTTP/1.1" 200 12 "-" "Mozilla/5.0 (Windows NT 10.0)"',
  '198.51.100.5 - - [20/Jan/2026:09:00:05 +0000] "GET /index.html HTTP/1.1" 200 512 "-" "curl/7.68.0"',
  '198.51.100.5 - - [20/Jan/2026:09:05:22 +0000] "GET /about.html HTTP/1.1" 200 340 "-" "curl/7.68.0"',
  '203.0.113.77 - - [20/Jan/2026:09:00:15 +0000] "GET /login HTTP/1.1" 200 800 "-" "python-requests/2.28.0"',
  '203.0.113.77 - - [20/Jan/2026:09:00:45 +0000] "GET /login HTTP/1.1" 200 800 "-" "python-requests/2.28.0"',
  '203.0.113.77 - - [20/Jan/2026:09:01:15 +0000] "GET /login HTTP/1.1" 200 800 "-" "python-requests/2.28.0"',
  '203.0.113.77 - - [20/Jan/2026:09:01:45 +0000] "GET /login HTTP/1.1" 200 800 "-" "python-requests/2.28.0"',
  '203.0.113.77 - - [20/Jan/2026:09:02:15 +0000] "GET /login HTTP/1.1" 200 800 "-" "python-requests/2.28.0"',
  '203.0.113.77 - - [20/Jan/2026:09:02:45 +0000] "GET /login HTTP/1.1" 200 800 "-" "python-requests/2.28.0"',
  '10.0.0.88 - - [20/Jan/2026:09:10:00 +0000] "GET /home HTTP/1.1" 200 1024 "-" "Mozilla/5.0 (Macintosh)"',
  '10.0.0.88 - - [20/Jan/2026:09:15:33 +0000] "POST /api/data HTTP/1.1" 201 256 "-" "Mozilla/5.0 (Macintosh)"',
].join('\n');
 
const beaconSetupScript = [
  "cat > /workspace/access.log <<'CM_BEACON_LOG'",
  beaconAccessLog,
  'CM_BEACON_LOG',
].join('\n');
 
const beaconCheckScript = [
  "python3 - <<'CM_BEACON_CHECK'",
  'import re, sys',
  '# Safety: cap input size to prevent ReDoS-style hangs',
  'try:',
  '    with open("/workspace/beacon-report.txt") as f:',
  '        raw = f.read(65536)',
  'except Exception:',
  '    print("FAIL: cannot read beacon-report.txt")',
  '    sys.exit(1)',
  'content = raw[:65536]',
  'if not content.strip():',
  '    print("FAIL: beacon-report.txt is empty")',
  '    sys.exit(1)',
  '# Must identify at least one beaconing IP',
  'if not re.search(r"192\\.0\\.2\\.10|203\\.0\\.113\\.77", content):',
  '    print("FAIL: suspected beacon source IP not found (192.0.2.10 or 203.0.113.77)")',
  '    sys.exit(1)',
  '# Must mention the user-agent',
  'if not re.search(r"(user.?agent|ua|Mozilla|python.requests)", content, re.I):',
  '    print("FAIL: include the suspicious user-agent string in your report")',
  '    sys.exit(1)',
  '# Must mention interval or pattern analysis',
  'if not re.search(r"(interval|period|every|beacon|repeat|callback|pattern|30s|30 sec)", content, re.I):',
  '    print("FAIL: describe the beaconing interval or pattern in your report")',
  '    sys.exit(1)',
  'print("PASS: beacon-report.txt is valid.")',
  'CM_BEACON_CHECK',
].join('\n');

const idorRequestLog = [
  '# SYNTHETIC DATA - NOT FROM A REAL INCIDENT',
  '192.168.1.77 - user1042 [20/Jan/2026:09:14:01 +0000] "GET /api/users/1042 HTTP/1.1" 200 312 "-" "Mozilla/5.0" "session=abc123xyz"',
  '192.168.1.77 - user1042 [20/Jan/2026:09:14:03 +0000] "GET /api/users/1041 HTTP/1.1" 200 309 "-" "Mozilla/5.0" "session=abc123xyz"',
  '192.168.1.77 - user1042 [20/Jan/2026:09:14:05 +0000] "GET /api/users/1043 HTTP/1.1" 200 315 "-" "Mozilla/5.0" "session=abc123xyz"',
  '192.168.1.77 - user1042 [20/Jan/2026:09:14:06 +0000] "GET /api/users/1040 HTTP/1.1" 200 301 "-" "Mozilla/5.0" "session=abc123xyz"',
  '192.168.1.77 - user1042 [20/Jan/2026:09:14:08 +0000] "GET /api/users/1039 HTTP/1.1" 404 54 "-" "Mozilla/5.0" "session=abc123xyz"',
  '10.0.0.1 - admin [20/Jan/2026:09:15:20 +0000] "GET /api/users/1042 HTTP/1.1" 200 312 "-" "Mozilla/5.0" "session=adminXXX"',
].join('\n');

const idorSetupScript = [
  "cat > /workspace/requests.log <<'CM_IDOR_REQUESTS'",
  idorRequestLog,
  'CM_IDOR_REQUESTS',
].join('\n');

const idorCheckScript = [
  "python3 - <<'CM_IDOR_CHECK'",
  'import re, sys',
  'MAX_BYTES = 10_000',
  'try:',
  '    with open("/workspace/idor-report.txt") as f:',
  '        content = f.read(MAX_BYTES)',
  'except Exception:',
  '    print("FAIL: cannot read idor-report.txt")',
  '    sys.exit(1)',
  'if not content.strip():',
  '    print("FAIL: idor-report.txt is empty")',
  '    sys.exit(1)',
  'if not re.search(r"/api/users|endpoint|path", content, re.I):',
  '    print("FAIL: vulnerable endpoint /api/users not identified")',
  '    sys.exit(1)',
  'if not re.search(r"idor|insecure.{0,20}direct|object.{0,20}ref|sequential|enumerat|unauthori", content, re.I):',
  '    print("FAIL: IDOR vulnerability pattern not named")',
  '    sys.exit(1)',
  'if not re.search(r"authoriz|least.{0,10}priv|ownership|permission|access.{0,10}control|object.{0,10}level", content, re.I):',
  '    print("FAIL: report must recommend a mitigation or control")',
  '    sys.exit(1)',
  'print("PASS")',
  'CM_IDOR_CHECK',
].join('\n');

const iamPolicyContent = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'BackupJobFull',
        Effect: 'Allow',
        Action: '*',
        Resource: '*',
      },
    ],
  },
  null,
  2
);

const iamRequirementsContent = [
  '# SYNTHETIC DATA — NOT FROM A REAL WORKLOAD',
  '# =============================================',
  '# Workload : cm-backup-agent',
  '# Account  : 123456789012  (fictional)',
  '#',
  '# WHAT THE JOB ACTUALLY DOES',
  '#   1. Lists and reads objects under prefix  prod/daily/',
  '#      in bucket:  cm-backup-data-123456789012',
  '#   2. Writes log events to CloudWatch Logs group:',
  '#      /backup/cm-agent  (account 123456789012, region us-east-1)',
  '#',
  '# MINIMUM REQUIRED ACTIONS',
  '#   S3 read',
  '#     s3:GetObject   — on  arn:aws:s3:::cm-backup-data-123456789012/prod/daily/*',
  '#     s3:ListBucket  — on  arn:aws:s3:::cm-backup-data-123456789012',
  '#',
  '#   CloudWatch Logs write',
  '#     logs:CreateLogStream  — on  arn:aws:logs:us-east-1:123456789012:log-group:/backup/cm-agent:*',
  '#     logs:PutLogEvents     — on  arn:aws:logs:us-east-1:123456789012:log-group:/backup/cm-agent:*',
  '#',
  '# NO OTHER SERVICES OR ACTIONS ARE NEEDED.',
].join('\n');

const iamSetupScript = [
  "cat > /workspace/policy.json <<'CM_IAM_POLICY'",
  iamPolicyContent,
  'CM_IAM_POLICY',
  "cat > /workspace/requirements.txt <<'CM_IAM_REQS'",
  iamRequirementsContent,
  'CM_IAM_REQS',
].join('\n');

const iamCheckScript = [
  "python3 - <<'CM_IAM_CHECK'",
  'import json, sys',
  'MAX_BYTES = 50_000',
  'try:',
  '    with open("/workspace/policy.json") as f:',
  '        raw = f.read(MAX_BYTES)',
  'except Exception:',
  '    print("FAIL: cannot read policy.json")',
  '    sys.exit(1)',
  'try:',
  '    policy = json.loads(raw)',
  'except json.JSONDecodeError as e:',
  '    print(f"FAIL: policy.json is not valid JSON — {e}")',
  '    sys.exit(1)',
  'stmts = policy.get("Statement", [])',
  'if not stmts:',
  '    print("FAIL: policy has no Statement array")',
  '    sys.exit(1)',
  'allowed_actions = set()',
  'allowed_resources = set()',
  'for i, stmt in enumerate(stmts):',
  '    effect = stmt.get("Effect", "")',
  '    principal = stmt.get("Principal", None)',
  '    actions = stmt.get("Action", [])',
  '    resources = stmt.get("Resource", [])',
  '    if isinstance(actions, str): actions = [actions]',
  '    if isinstance(resources, str): resources = [resources]',
  '    if effect == "Allow" and principal is not None:',
  '        if principal == "*" or (isinstance(principal, dict) and principal.get("AWS") == "*"):',
  '            print(f"FAIL: statement {i+1} grants public access (Principal: *)")',
  '            sys.exit(1)',
  '    if effect != "Allow": continue',
  '    for a in actions:',
  '        if a == "*" or a.endswith(":*"):',
  '            print(f"FAIL: statement {i+1} uses wildcard action \'{a}\' — use specific actions")',
  '            sys.exit(1)',
  '        allowed_actions.add(a.lower())',
  '    for r in resources:',
  '        if r == "*":',
  '            print(f"FAIL: statement {i+1} uses wildcard resource \'*\' — scope to specific ARNs")',
  '            sys.exit(1)',
  '        allowed_resources.add(r.lower())',
  'if "s3:getobject" not in allowed_actions:',
  '    print("FAIL: s3:GetObject is required to read backup objects")',
  '    sys.exit(1)',
  'if "s3:listbucket" not in allowed_actions:',
  '    print("FAIL: s3:ListBucket is required to list the prefix")',
  '    sys.exit(1)',
  'if "logs:putlogevents" not in allowed_actions:',
  '    print("FAIL: logs:PutLogEvents is required to write log events")',
  '    sys.exit(1)',
  'if not any("cm-backup-data-123456789012" in r for r in allowed_resources):',
  '    print("FAIL: S3 resource must reference cm-backup-data-123456789012")',
  '    sys.exit(1)',
  'print("PASS: policy uses least-privilege permissions.")',
  'CM_IAM_CHECK',
].join('\n');

const phishingEmlContent = [
  '# SYNTHETIC DATA — NOT A REAL EMAIL',
  'Delivered-To: analyst@infosec-lab.invalid',
  'Received: from mail.phish-mailer.invalid (mail.phish-mailer.invalid [203.0.113.99])',
  '        by mx.infosec-lab.invalid with ESMTP id a1b2c3d4',
  '        for <analyst@infosec-lab.invalid>; Wed, 15 Jan 2026 10:33:12 +0000 (UTC)',
  'Received: from [10.10.10.200] (unknown [10.10.10.200])',
  '        by mail.phish-mailer.invalid with SMTP id e5f6a7b8',
  '        for <analyst@infosec-lab.invalid>; Wed, 15 Jan 2026 10:33:08 +0000 (UTC)',
  'Authentication-Results: mx.infosec-lab.invalid;',
  '        spf=fail (corporate-alerts.example.com does not designate 203.0.113.99 as permitted sender)',
  '        smtp.mailfrom=bounces@phish-mailer.invalid;',
  '        dkim=fail header.d=corporate-alerts.example.com header.s=default',
  '        reason="signature verification failed";',
  '        dmarc=fail action=none header.from=corporate-alerts.example.com',
  'Return-Path: <bounces@phish-mailer.invalid>',
  'From: "Security Team" <noreply@corporate-alerts.example.com>',
  'To: analyst@infosec-lab.invalid',
  'Subject: [ACTION REQUIRED] Your account password expires in 24 hours',
  'Date: Wed, 15 Jan 2026 10:33:06 +0000',
  'Message-ID: <550e8400-e29b-41d4-a716-446655440000@phish-mailer.invalid>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'X-Mailer: PhishKit/2.1',
  '',
  'Your password expires in 24 hours. Reset it now:',
  '  https://corporate-alerts.example.com.phish-mailer.invalid/reset?token=a1b2c3d4',
  '',
  'This is an automated security alert.',
].join('\n');

const phishingSetupScript = [
  "cat > /workspace/phishing.eml <<'CM_PHISH_EMAIL'",
  phishingEmlContent,
  'CM_PHISH_EMAIL',
].join('\n');

const phishingCheckScript = [
  "python3 - <<'CM_PHISH_CHECK'",
  'import re, sys',
  'MAX_BYTES = 10_000',
  'try:',
  '    with open("/workspace/phishing-findings.txt") as f:',
  '        content = f.read(MAX_BYTES)',
  'except Exception:',
  '    print("FAIL: cannot read phishing-findings.txt")',
  '    sys.exit(1)',
  'if not content.strip():',
  '    print("FAIL: phishing-findings.txt is empty")',
  '    sys.exit(1)',
  'if not re.search(r"corporate.alerts|security.team|noreply@|impersonat|spoof", content, re.I):',
  '    print("FAIL: identify the impersonated sender domain (corporate-alerts.example.com)")',
  '    sys.exit(1)',
  'indicators = [',
  '    bool(re.search(r"return.path|phish.mailer|mismatch|envelope", content, re.I)),',
  '    bool(re.search(r"spf.*fail|fail.*spf|spf=fail", content, re.I)),',
  '    bool(re.search(r"dkim.*fail|fail.*dkim|dkim=fail|signature.*fail", content, re.I)),',
  '    bool(re.search(r"received|relay|hop|chain", content, re.I)),',
  ']',
  'if sum(indicators) < 3:',
  '    print("FAIL: report at least 3 of: Return-Path mismatch, SPF fail, DKIM fail, suspicious Received chain")',
  '    sys.exit(1)',
  'print("PASS: phishing-findings.txt is valid.")',
  'CM_PHISH_CHECK',
].join('\n');

const challengeCatalog = {
  'linux-basics': {
    title: 'Linux Basics Warmup',
    difficulty: 'Beginner',
    description: 'Get comfortable with directories, files, and basic shell commands before timed CTF tasks.',
    objective: 'Run pwd, whoami, and ls -la. Then create report.txt with a one-line ownership summary of the current directory.',
    steps: [
      'Run pwd to print your current working directory.',
      'Run whoami to confirm your current user.',
      'Run ls -la to list all files with permissions and ownership.',
      'Create report.txt and write one line summarising the owner/group/permissions you observed.',
      'Click Check Solution to validate.',
    ],
    firstCommand: 'pwd',
    checkScript: 'set -e; test -f report.txt; test -s report.txt; grep -Eqi "(owner|permission|user|group)" report.txt',
    starterLang: 'python',
    starterCode: [
      '# Linux Basics Warmup — starter',
      '# Run the commands below in the terminal, then write your findings to report.txt.',
      '#',
      '# STEP 1: Run these in the terminal panel:',
      '#   pwd',
      '#   whoami',
      '#   ls -la',
      '#',
      '# STEP 2: Write your summary to report.txt. Examples:',
      '#',
      '#   VALID (passes the checker):',
      '#     echo "owner: cyberminds, group: staff, perms: 0755" > report.txt',
      '#     echo "user is cyberminds, group is root" > report.txt',
      '#     echo "permission: drwxr-xr-x, owner: root" > report.txt',
      '#',
      '#   INVALID (will fail the checker):',
      '#     echo "hello world" > report.txt        <- no ownership keyword',
      '#     echo "the directory exists" > report.txt  <- no ownership keyword',
      '#',
      '# STEP 3: Click Check Solution to validate.',
      '',
      'import os, pwd, grp, stat',
      '',
      'cwd   = os.getcwd()',
      'info  = os.stat(cwd)',
      'owner = pwd.getpwuid(info.st_uid).pw_name',
      'group = grp.getgrgid(info.st_gid).gr_name',
      'perms = oct(stat.S_IMODE(info.st_mode))',
      '',
      'print(f"Directory  : {cwd}")',
      'print(f"Owner      : {owner}")',
      'print(f"Group      : {group}")',
      'print(f"Permissions: {perms}")',
      'print()',
      'print("Now write this to report.txt in the terminal:")',
      'print(f\'echo "owner: {owner}, group: {group}, perms: {perms}" > report.txt\')',
    ].join('\n'),
  },
  'web-recon': {
    title: 'Web Recon Starter',
    difficulty: 'Beginner',
    description: 'Practice recon workflows: check open ports and inspect HTTP response headers safely.',
    objective: 'Identify the local nginx service on port 9090, capture its response headers (including X-Powered-By and X-Application), and record findings in recon-notes.txt.',
    steps: [
      'Run ss -tulpen to inspect listening services.',
      'Run curl -I http://localhost:9090 and observe the response headers.',
      'Note the PHP version from X-Powered-By and the app name from X-Application.',
      'Record the port, at least one standard header, the PHP version, and the portal name in recon-notes.txt.',
    ],
    firstCommand: 'ss -tulpen',
    checkScript: [
      'set -e',
      'test -f recon-notes.txt',
      'test -s recon-notes.txt',
      'grep -Eqi "(server|content-type|status|header)" recon-notes.txt',
      'grep -Eq "(^|[^0-9])9090([^0-9]|$)" recon-notes.txt',
      'grep -Eqi "php[/ ]?7" recon-notes.txt',
      'grep -Eqi "internal.?portal" recon-notes.txt',
    ].join('; '),
    starterLang: 'javascript',
    starterCode: `const http = require('http');\n\nhttp.get('http://localhost:9090', (res) => {\n  console.log('Status:', res.statusCode);\n  console.log('Headers:', res.headers);\n});\n`,
  },
  'log-hunt': {
    title: 'Log Hunt: Failed Auth Spike',
    difficulty: 'Intermediate',
    description: 'Analyse a server authentication log to identify a brute-force spike and rank the top offending source IPs.',
    objective: 'Use grep, sort, and uniq to extract and rank offending IPs from /workspace/sample.log. Record the ranked IP list and a one-line incident summary in findings.txt.',
    steps: [
      'Run grep "Failed" /workspace/sample.log | awk \'{print $11}\' | sort | uniq -c | sort -rn to rank IPs by attempt count.',
      'Identify the top offending IP and confirm its attempt count.',
      'Write the ranked IP list to findings.txt.',
      'Add a one-line incident summary describing the attack (e.g. brute-force, auth spike).',
      'Click Check Solution to validate.',
    ],
    firstCommand: 'grep "Failed" /workspace/sample.log | wc -l',
    setupScript: logHuntSetupScript,
    checkScript: logHuntCheckScript,
    starterLang: 'python',
    starterCode: `# Log Hunt: Failed Auth Spike — starter\nfrom collections import Counter\n\nwith open('/workspace/sample.log') as f:\n    lines = [l for l in f if 'Failed' in l and not l.startswith('#')]\n\nips = []\nfor line in lines:\n    parts = line.split()\n    try:\n        idx = parts.index('from')\n        ips.append(parts[idx + 1])\n    except (ValueError, IndexError):\n        pass\n\nfor ip, count in Counter(ips).most_common():\n    print(f'{count:4d}  {ip}')\n\n# Write to findings.txt when ready:\n# with open('/workspace/findings.txt', 'w') as out:\n#     for ip, count in Counter(ips).most_common():\n#         out.write(f'{count:4d}  {ip}\\n')\n#     out.write('Summary: brute-force auth spike from 192.168.1.45\\n')\n`,
  },
  'priv-esc': {
    title: 'Privilege Escalation Trace',
    difficulty: 'Intermediate',
    description: 'Analyse authentication and sudo logs to trace how an attacker moved from a low-privilege SSH session to root.',
    objective: 'Identify the escalating user, the exact timestamp of privilege escalation, and the escalation method (su). Record findings in priv-esc-report.txt.',
    steps: [
      'Read /workspace/auth.log to find the SSH login event for the attacker.',
      'Read /workspace/sudo.log to find the privilege escalation event.',
      'Identify the username, the timestamp (HH:MM), and the escalation method (su).',
      'Write a summary to priv-esc-report.txt including all three findings.',
      'Click Check Solution to validate.',
    ],
    firstCommand: 'cat /workspace/auth.log',
    checkScript: 'python3 /workspace/check-priv-esc.py',
    starterLang: 'python',
    starterCode: `# Read and analyse the auth log\nwith open('/workspace/auth.log') as f:\n    for line in f:\n        if 'Accepted' in line or 'su for root' in line:\n            print(line.strip())\n`,
  },
  'incident-timeline': {
    title: 'Incident Timeline Reconstruction',
    difficulty: 'Intermediate',
    description: 'Correlate SSH, HTTP access, and syslog events to reconstruct the full timeline of a simulated intrusion.',
    objective: 'Use provided synthetic event data to produce a chronological timeline in timeline.txt with at least 8 entries (HH:MM:SS format, ascending, no duplicates).',
    steps: [
      'Run the starter script to inspect synthetic SSH/HTTP/syslog events.',
      'Correlate events across sources by timestamp.',
      'Write a chronological timeline to timeline.txt — one event per line, each starting with HH:MM:SS.',
      'Include at least 8 events covering both SSH and HTTP activity.',
      'Click Check Solution to validate.',
    ],
    firstCommand: 'python3 hello.py',
    checkScript: [
      'set -e',
      'test -f timeline.txt',
      'test -s timeline.txt',
      "awk 'NF{print $1}' timeline.txt > /tmp/cm_timestamps.txt",
      'test "$(wc -l < /tmp/cm_timestamps.txt)" -ge 8',
      "if grep -Evq '^[0-9]{2}:[0-9]{2}:[0-9]{2}$' /tmp/cm_timestamps.txt; then echo 'FAIL: invalid timestamp format'; exit 1; fi",
      'sort /tmp/cm_timestamps.txt | uniq > /tmp/cm_timestamps_sorted.txt',
      'cmp -s /tmp/cm_timestamps.txt /tmp/cm_timestamps_sorted.txt',
      "grep -Eqi '(ssh|login|accept)' timeline.txt",
      "grep -Eqi '(http|get|post|request)' timeline.txt",
    ].join('; '),
    starterLang: 'python',
    starterCode: `import re\n\nDATASETS = {\n    'auth': [\n        'Jan 20 03:10:14 sshd: Failed password for admin from 192.168.50.22',\n        'Jan 20 03:10:29 sshd: Failed password for admin from 192.168.50.22',\n        'Jan 20 03:10:47 sshd: Accepted password for admin from 192.168.50.22',\n        'Jan 20 03:10:48 sshd: session opened for user admin',\n        'Jan 20 03:12:05 sshd: session closed for user admin',\n    ],\n    'access': [\n        '03:10:50 GET /login HTTP/1.1 200',\n        '03:11:02 POST /login HTTP/1.1 302',\n        '03:11:05 GET /admin HTTP/1.1 200',\n        '03:11:33 GET /admin/export HTTP/1.1 200',\n        '03:12:01 GET /logout HTTP/1.1 200',\n    ],\n    'syslog': [\n        'Jan 20 03:10:47 audit: user admin logged in from 192.168.50.22',\n        'Jan 20 03:11:33 audit: file /var/data/export.csv accessed by admin',\n        'Jan 20 03:11:34 audit: 20480 bytes read from /var/data/export.csv',\n        'Jan 20 03:12:05 audit: user admin session terminated',\n    ],\n}\n\nTS_RE = re.compile(r'\\b(\\d{2}:\\d{2}:\\d{2})\\b')\nevents = []\nfor lines in DATASETS.values():\n    for line in lines:\n        m = TS_RE.search(line)\n        if m:\n            events.append((m.group(1), line))\n\nfor ts, event in sorted(events):\n    print(f'{ts} {event}')\n`,
  },
  'suspicious-beaconing': {
    title: 'Log Hunt: Suspicious User-Agent Beaconing',
    difficulty: 'Intermediate',
    description: 'Detect a periodic callback pattern in an HTTP access log by analysing user-agent strings and request intervals.',
    objective: 'Identify which IPs and user-agents are beaconing, determine the callback interval, and record your findings in beacon-report.txt.',
    steps: [
      'Run cat /workspace/access.log to read the fixture log.',
      'Use grep and awk to extract unique user-agents: grep -oP \'"[^"]+"\' access.log | sort | uniq -c | sort -rn',
      'For each suspicious user-agent, extract its request timestamps and calculate the interval.',
      'List suspected beacon source IPs, their user-agent, and interval in beacon-report.txt.',
      'Click Check Solution to validate.',
    ],
    firstCommand: 'cat /workspace/access.log',
    setupScript: beaconSetupScript,
    checkScript: beaconCheckScript,
    starterLang: 'python',
    starterCode: [
      '# CTF-04: Suspicious User-Agent Beaconing — starter',
      '# STEP 1: Read the access log',
      '# STEP 2: Extract user-agents and count requests per UA',
      '# STEP 3: For suspicious UAs, extract timestamps and check interval',
      '# STEP 4: Write findings to beacon-report.txt',
      '#',
      '# VALID beacon-report.txt example (passes checker):',
      '#   IP: 192.0.2.10  UA: Mozilla/5.0 (Windows NT 10.0)  interval: 30s  path: /ping',
      '#   IP: 203.0.113.77  UA: python-requests/2.28.0  interval: 30s  path: /login',
      '#   Pattern: periodic callback every 30 seconds — suspected beaconing',
      '#',
      '# INVALID example (fails checker):',
      '#   There are some requests in the log.  <- no IP, no UA, no interval',
      '',
      'import re',
      'from collections import defaultdict',
      '',
      'entries = []',
      "with open('/workspace/access.log') as f:",
      '    for line in f:',
      "        if line.startswith('#'): continue",
      "        m = re.match(r'(\\S+).*\\[(.*?)\\].*\"\\S+ (\\S+).*?\"(\\S.*?)\"$', line)",
      '        if m:',
      "            ip, ts, path, ua = m.group(1), m.group(2), m.group(3), m.group(4).strip('\"')",
      '            entries.append((ip, ts, path, ua))',
      '',
      '# Group by user-agent',
      'by_ua = defaultdict(list)',
      'for ip, ts, path, ua in entries:',
      '    by_ua[ua].append((ip, ts, path))',
      '',
      'for ua, hits in sorted(by_ua.items(), key=lambda x: -len(x[1])):',
      "    print(f'UA: {ua}  count: {len(hits)}')",
      '    for ip, ts, path in hits[:3]:',
      "        print(f'  {ip}  {ts}  {path}')",
    ].join('\n'),
  },

  'phishing-header': {
    title: 'Phishing Header Analysis',
    difficulty: 'Intermediate',
    description:
      'Examine synthetic email headers containing a display-name lure and authentication failures that indicate sender spoofing.',
    objective:
      'Identify at least 3 spoofing indicators from phishing.eml (Return-Path mismatch, SPF failure, DKIM failure, suspicious Received chain) and write your findings to phishing-findings.txt.',
    steps: [
      'Read the raw email headers: cat /workspace/phishing.eml',
      'Note the From display address vs the actual Return-Path envelope sender',
      'Check Authentication-Results for spf=, dkim=, and dmarc= outcomes',
      'Trace the Received headers to spot unexpected relay hops',
      'Write phishing-findings.txt: name the impersonated domain and at least 3 indicators',
      'Run the checker: check',
    ],
    firstCommand: 'cat /workspace/phishing.eml',
    setupScript: phishingSetupScript,
    checkScript: phishingCheckScript,
    starterLang: 'python',
    starterCode: [
      '# Inspect email headers to find spoofing indicators.',
      '# Save this file, then run: python3 /workspace/inspect.py',
      '',
      "with open('/workspace/phishing.eml') as f:",
      '    raw = f.read()',
      '',
      '# Headers end at the first blank line',
      "header_section = raw.split('\\n\\n')[0]",
      '',
      'key_headers = ["From", "Return-Path", "Authentication-Results", "Received", "X-Mailer"]',
      'for line in header_section.split("\\n"):',
      '    if any(line.startswith(h) for h in key_headers) or line.startswith("        "):',
      '        print(line)',
    ].join('\n'),
  },

  'iam-least-privilege': {
    title: 'IAM Least Privilege',
    difficulty: 'Intermediate',
    description:
      'A synthetic backup job was deployed with an over-permissive IAM policy granting Action:* on Resource:*. Repair it to the minimum required permissions without breaking the workload.',
    objective:
      'Edit /workspace/policy.json so it allows only the four actions the backup job needs (s3:GetObject, s3:ListBucket, logs:CreateLogStream, logs:PutLogEvents) on the exact ARNs in requirements.txt — no wildcards, no unrelated actions.',
    steps: [
      'Read the current policy: cat /workspace/policy.json',
      'Review what the job actually needs: cat /workspace/requirements.txt',
      'Edit policy.json to use specific Actions instead of "*"',
      'Scope each Resource to the exact ARN from requirements.txt',
      'Validate your JSON is well-formed: python3 -c "import json,sys; json.load(open(\'/workspace/policy.json\')); print(\'JSON OK\')"',
      'Run the checker: check',
    ],
    firstCommand: 'cat /workspace/policy.json',
    setupScript: iamSetupScript,
    checkScript: iamCheckScript,
    starterLang: 'python',
    starterCode: [
      '# Build a least-privilege IAM policy as a Python dict, then write it to policy.json.',
      '# Run: python3 /workspace/policy.py',
      '',
      'import json',
      '',
      'policy = {',
      '    "Version": "2012-10-17",',
      '    "Statement": [',
      '        {',
      '            "Sid": "S3BackupRead",',
      '            "Effect": "Allow",',
      '            "Action": [',
      '                # TODO: add only the S3 actions the job needs',
      '            ],',
      '            "Resource": [',
      '                # TODO: scope to the exact bucket ARN from requirements.txt',
      '            ],',
      '        },',
      '        {',
      '            "Sid": "CloudWatchLogsWrite",',
      '            "Effect": "Allow",',
      '            "Action": [',
      '                # TODO: add only the CloudWatch Logs actions the job needs',
      '            ],',
      '            "Resource": [',
      '                # TODO: scope to the exact log group ARN from requirements.txt',
      '            ],',
      '        },',
      '    ],',
      '}',
      '',
      "with open('/workspace/policy.json', 'w') as f:",
      '    json.dump(policy, f, indent=2)',
      "print('policy.json written')",
    ].join('\n'),
  },
};

// Re-calculate order and set active challenge
const challengeOrder = Object.keys(challengeCatalog);
let activeChallengeId = query.get('challenge') || challengeOrder[0];

if (!challengeCatalog[activeChallengeId]) {
  activeChallengeId = challengeOrder[0];
}
