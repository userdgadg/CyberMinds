/**
 * @file Challenge navigation and validation flow.
 */
function queueAnalyticsEvent(eventName, payload) {
  var queueKey = '__cybermindsAnalyticsQueue';
  var queue = window[queueKey];
  if (!Array.isArray(queue)) {
    queue = [];
    window[queueKey] = queue;
  }
  queue.push({ eventName, payload: payload || {} });
}

function loadChallenge(challengeId, updateUrl = true) {
  let resolvedChallengeId = challengeId;

  if (
    completedChallenges[resolvedChallengeId] &&
    resolvedChallengeId !== activeChallengeId
  ) {
    const nextOpen = getFirstIncompleteChallengeId();
    if (nextOpen && nextOpen !== resolvedChallengeId) {
      showToast('Completed challenges are locked. Continue forward.');
      resolvedChallengeId = nextOpen;
    }
  }

  const challenge = challengeCatalog[resolvedChallengeId];
  if (!challenge) {
    return;
  }

  if (editor) {
    persistActiveDraft();
  }

  activeChallengeId = resolvedChallengeId;
  currentLang = challenge.starterLang;
  codeSamples[currentLang] = challenge.starterCode;

  if (editor) {
    switchLanguage(currentLang, { persistCurrent: false });
  }

  document.getElementById('challengeTitle').textContent = challenge.title;
  document.getElementById('challengeDifficulty').textContent =
    challenge.difficulty;
  document.getElementById('challengeDescription').textContent =
    challenge.description;
  document.getElementById('challengeObjective').textContent =
    challenge.objective;

  const stepList = document.getElementById('challengeSteps');
  stepList.innerHTML = '';
  challenge.steps.forEach((step) => {
    const li = document.createElement('li');
    li.textContent = step;
    stepList.appendChild(li);
  });

  document.querySelectorAll('.challenge-link').forEach((button) => {
    button.classList.toggle(
      'active',
      button.dataset.challenge === resolvedChallengeId
    );
  });

  if (updateUrl) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('challenge', resolvedChallengeId);
    history.replaceState({}, '', nextUrl.toString());
  }

  renderProgressTimeline();

  if (window.innerWidth <= 980) {
    setMobileView('editor');
  }

  // Track challenge start in analytics (queue if analytics loads later)
  if (typeof trackChallengeStart === 'function') {
    trackChallengeStart(resolvedChallengeId);
  } else {
    queueAnalyticsEvent('challenge_start', { challenge: resolvedChallengeId });
  }

  ensureChallengeWorkspace(challenge);
}

function ensureChallengeWorkspace(challenge) {
  if (!challenge || !challenge.setupScript) {
    return;
  }

  if (isMockTerminal) {
    if (activeChallengeId === 'log-hunt') {
      setMockFile('sample.log', `${logHuntSampleLog}\n`);
    }
    if (activeChallengeId === 'suspicious-beaconing') {
      setMockFile('access.log', `${beaconAccessLog}\n`);
    }
    if (activeChallengeId === 'idor-triage') {
      setMockFile('requests.log', `${idorRequestLog}\n`);
    }
    if (activeChallengeId === 'phishing-header') {
      setMockFile('phishing.eml', `${phishingEmlContent}\n`);
    }
    if (activeChallengeId === 'iam-least-privilege') {
      setMockFile('policy.json', `${iamPolicyContent}\n`);
      setMockFile('requirements.txt', `${iamRequirementsContent}\n`);
    }
    syncWorkspaceFiles();
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(`bash -lc ${shellQuote(challenge.setupScript)}\n`);
  syncWorkspaceFiles();
}

function renderChallengeNav() {
  const container = document.querySelector('.challenge-nav-list') || document.getElementById('challengeNav');
  if (!container) return;

  container.innerHTML = '';
  const renderedGroups = new Set();

  challengeOrder.forEach((id) => {
    const challenge = challengeCatalog[id];
    const isCompleted = !!completedChallenges[id];
    const isActive = activeChallengeId === id;

    // Check if this challenge belongs to a group (e.g., Log Hunt)
    if (challenge.groupId) {
      if (!renderedGroups.has(challenge.groupId)) {
        renderedGroups.add(challenge.groupId);

        // Create the Dropdown (details/summary)
        const details = document.createElement('details');
        details.className = 'challenge-group-wrapper';
        // Auto-open the dropdown if the active challenge is inside it
        if (activeChallengeId.startsWith(id.split('-')[0])) {
          details.open = true;
        }

        const summary = document.createElement('summary');
        summary.className = 'challenge-nav-group-header';
        summary.textContent = challenge.groupTitle || 'Group';

        details.appendChild(summary);
        container.appendChild(details);
      }

      // Add the task button inside the existing details element
      const parentDetails = container.lastChild;
      const btn = document.createElement('button');
      btn.className = `challenge-nav-item sub-task ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;
      btn.innerHTML = `
        <span class="status-dot"></span>
        <span class="title">${challenge.title}</span>
      `;
      btn.onclick = () => {
        const currentIndex = getChallengeIndex(activeChallengeId);
        const targetIndex = getChallengeIndex(id);
        if (targetIndex > currentIndex && !completedChallenges[activeChallengeId]) {
          showToast('Finish the current challenge first!');
          return;
        }
        loadChallenge(id);
      };
      parentDetails.appendChild(btn);

    } else {
      // Standard rendering for standalone challenges
      const btn = document.createElement('button');
      btn.className = `challenge-nav-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;
      btn.innerHTML = `
        <span class="status-dot"></span>
        <span class="title">${challenge.title}</span>
      `;
      btn.onclick = () => {
        const currentIndex = getChallengeIndex(activeChallengeId);
        const targetIndex = getChallengeIndex(id);
        if (targetIndex > currentIndex && !completedChallenges[activeChallengeId]) {
          showToast('Finish the current challenge first!');
          return;
        }
        loadChallenge(id);
      };
      container.appendChild(btn);
    }
  });
}

function applyChallengeStarter(userTriggered = false) {
  const challenge = challengeCatalog[activeChallengeId];
  if (!challenge || !editor) {
    return;
  }

  currentLang = challenge.starterLang;
  codeSamples[currentLang] = challenge.starterCode;

  if (userTriggered) {
    switchLanguage(currentLang);
    editor.setValue(challenge.starterCode);
    persistActiveDraft();
    showToast('Starter code loaded');
  } else {
    switchLanguage(currentLang, { persistCurrent: false });
  }
}

function copyFirstCommand() {
  const challenge = challengeCatalog[activeChallengeId];
  if (!challenge) {
    return;
  }

  if (!navigator.clipboard) {
    showToast('Clipboard is not available in this browser');
    return;
  }

  navigator.clipboard
    .writeText(challenge.firstCommand)
    .then(() => {
      showToast('First command copied');
    })
    .catch(() => {
      showToast('Failed to copy command');
      console.warn('Failed to copy first command');
    });
}

/**
 * Execute challenge validator script in container and parse pass/fail.
 * Uses unique markers so output parsing is deterministic.
 */
function checkChallengeSolution() {
  const challenge = challengeCatalog[activeChallengeId];
  if (!challenge || !ws || ws.readyState !== WebSocket.OPEN) {
    showToast('Terminal not connected');
    return;
  }
  if (!challenge.checkScript) {
    showToast('No checker configured for this challenge');
    return;
  }

  if (isMockTerminal) {
    const report = getMockFile('report.txt') || '';
    const recon = getMockFile('recon-notes.txt') || '';
    const sampleLog = getMockFile('sample.log') || '';
    const privEscReport = getMockFile('priv-esc-report.txt') || '';
    const timeline = getMockFile('timeline.txt') || '';
    const idorReport = getMockFile('idor-report.txt') || '';
    const checksByChallenge = {
      'linux-basics':
        report.trim().length > 0 &&
        /(owner|permission|user|group)/i.test(report),
      'web-recon':
        recon.trim().length > 0 &&
        /(server|content-type|status|header)/i.test(recon) &&
        /\b9090\b/.test(recon) &&
        /php[/ ]?7/i.test(recon) &&
        /internal.?portal/i.test(recon),
      'log-hunt': (() => {
        const findings = getMockFile('findings.txt') || '';
        if (!findings.trim()) return false;
        if (!findings.includes('192.168.1.45')) return false;
        const m = /(\d+)\s+192\.168\.1\.45/.exec(findings);
        if (!m || parseInt(m[1], 10) < 10) return false;
        return /(failed|attempt|auth|spike|brute)/i.test(findings);
      })(),
      'priv-esc':
        privEscReport.trim().length > 0 &&
        /\bjsmith\b/i.test(privEscReport) &&
        /02:11/.test(privEscReport) &&
        /\bsu\b|escalat/i.test(privEscReport),
      'incident-timeline': (() => {
        const lines = timeline.split('\n').filter((l) => l.trim());
        if (lines.length < 8) return false;
        const tsRe = /\b(\d{2}:\d{2}:\d{2})\b/;
        const timestamps = lines.map((l) => { const m = tsRe.exec(l); return m ? m[1] : null; });
        if (timestamps.some((t) => t === null)) return false;
        const sorted = [...timestamps].sort();
        if (JSON.stringify(timestamps) !== JSON.stringify(sorted)) return false;
        if (new Set(timestamps).size !== timestamps.length) return false;
        const joined = lines.join('\n');
        return /(ssh|login|accept)/i.test(joined) && /(http|get|post|request)/i.test(joined);
      })(),
      'suspicious-beaconing': (() => {
        const beacon = getMockFile('beacon-report.txt') || '';
        return (
          beacon.trim().length > 0 &&
          /(192\.0\.2\.10|203\.0\.113\.77)/.test(beacon) &&
          /(user.?agent|ua|Mozilla|python.requests)/i.test(beacon) &&
          /(interval|period|every|beacon|repeat|callback|pattern|30s|30 sec)/i.test(beacon)
        );
      })(),
      'idor-triage': (() => {
        if (!idorReport.trim()) return false;
        if (!/\/api\/users|endpoint|path/i.test(idorReport)) return false;
        if (!/idor|insecure.{0,20}direct|object.{0,20}ref|sequential|enumerat|unauthori/i.test(idorReport)) return false;
        return /(authoriz|least.{0,10}priv|ownership|permission|access.{0,10}control|object.{0,10}level)/i.test(idorReport);
      })(),
      'phishing-header': (() => {
        const findings = getMockFile('phishing-findings.txt') || '';
        if (!findings.trim()) return false;
        if (!/corporate.alerts|security.team|noreply@|impersonat|spoof/i.test(findings)) return false;
        const indicators = [
          /return.path|phish.mailer|mismatch|envelope/i.test(findings),
          /spf.*fail|fail.*spf|spf=fail/i.test(findings),
          /dkim.*fail|fail.*dkim|dkim=fail|signature.*fail/i.test(findings),
          /received|relay|hop|chain/i.test(findings),
        ];
        return indicators.filter(Boolean).length >= 3;
      })(),
      'iam-least-privilege': (() => {
        const raw = getMockFile('policy.json') || '';
        if (!raw.trim()) return false;
        let policy;
        try { policy = JSON.parse(raw); } catch { return false; }
        const stmts = policy.Statement || [];
        if (!stmts.length) return false;
        const allowedActions = new Set();
        const allowedResources = new Set();
        for (const stmt of stmts) {
          if (stmt.Effect !== 'Allow') continue;
          const principal = stmt.Principal;
          if (principal === '*' || (principal && principal.AWS === '*')) return false;
          let actions = stmt.Action || [];
          let resources = stmt.Resource || [];
          if (typeof actions === 'string') actions = [actions];
          if (typeof resources === 'string') resources = [resources];
          for (const a of actions) {
            if (a === '*' || a.endsWith(':*')) return false;
            allowedActions.add(a.toLowerCase());
          }
          for (const r of resources) {
            if (r === '*') return false;
            allowedResources.add(r.toLowerCase());
          }
        }
        if (!allowedActions.has('s3:getobject')) return false;
        if (!allowedActions.has('s3:listbucket')) return false;
        if (!allowedActions.has('logs:putlogevents')) return false;
        if (![...allowedResources].some((r) => r.includes('cm-backup-data-123456789012'))) return false;
        return true;
      })(),
    };
    const passed = !!checksByChallenge[activeChallengeId];

    mockWriteLine(`--- Checking ${challenge.title} ---`);
    if (passed) {
      completedChallenges[activeChallengeId] = {
        passed: true,
        passedAt: new Date().toISOString(),
      };
      saveProgress();
      renderChallengeNav();
      mockWriteLine('PASS: challenge checks passed.');
      const nextChallengeId = getNextChallengeId(activeChallengeId);
      if (nextChallengeId) {
        mockWriteLine(
          `Moving to next challenge: ${challengeCatalog[nextChallengeId].title}`
        );
        loadChallenge(nextChallengeId);
        applyChallengeStarter(true);
        showToast('Challenge completed. Moved to next.');
      } else {
        renderProgressTimeline();
        showToast('All challenges completed.');
      }
      return;
    }

    mockWriteLine('FAIL: challenge checks did not pass yet.');
    return;
  }

  const checkId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const startMarker = `__CM_CHECK_START_${checkId}__`;
  const resultMarker = `__CM_CHECK_RESULT_${checkId}__`;
  const endMarker = `__CM_CHECK_END_${checkId}__`;
  pendingCheck = {
    challengeId: activeChallengeId,
    startMarker,
    resultMarker,
    endMarker,
    buffer: '',
    started: false,
    finished: false,
  };

  ws.send(`echo "\\n--- Checking ${challenge.title} ---"\n`);
  if (challenge.setupScript) {
    ws.send(`bash -lc ${shellQuote(challenge.setupScript)}\n`);
  }
  ws.send(`printf '%s\\n' '${startMarker}'\n`);
  ws.send(`bash -lc ${shellQuote(challenge.checkScript)}\n`);
  ws.send(`printf '%s:%s\\n' '${resultMarker}' \"$?\"\n`);
  ws.send(`printf '%s\\n' '${endMarker}'\n`);
}

/**
 * Parse checker output markers from terminal stream.
 * Marks challenge passed and updates local progress.
 * Also syncs completion to the server for server-side enforcement.
 * @param {string} chunk
 */
function handleCheckOutput(chunk) {
  if (!pendingCheck || pendingCheck.finished) {
    return;
  }

  pendingCheck.buffer += chunk;
  if (
    !pendingCheck.started &&
    pendingCheck.buffer.includes(pendingCheck.startMarker)
  ) {
    pendingCheck.started = true;
  }

  if (!pendingCheck.started) {
    return;
  }

  const resultRegex = new RegExp(`${pendingCheck.resultMarker}:(\\d+)`);
  const resultMatch = pendingCheck.buffer.match(resultRegex);
  const hasEnd = pendingCheck.buffer.includes(pendingCheck.endMarker);
  if (!resultMatch || !hasEnd) {
    return;
  }

  const exitCode = Number(resultMatch[1]);
  const passed = exitCode === 0;
  const challengeId = pendingCheck.challengeId;
  pendingCheck.finished = true;
  pendingCheck = null;

  if (passed) {
    completedChallenges[challengeId] = {
      passed: true,
      passedAt: new Date().toISOString(),
    };
    saveProgress();
    renderChallengeNav();

    // Sync completion to server-side progression enforcement.
    // This prevents localStorage bypass — the backend is the source of truth.
    if (sessionId) {
      const progressUrl = `${apiOrigin}/api/session/${encodeURIComponent(
        sessionId
      )}/progress/${encodeURIComponent(challengeId)}`;
      fetch(progressUrl, { method: 'POST' }).catch((err) =>
        console.warn('Failed to sync progress to server:', err)
      );
    }

    // Track challenge completion in analytics (queue if analytics loads later)
    if (typeof trackChallengeComplete === 'function') {
      trackChallengeComplete(challengeId);
    } else {
      queueAnalyticsEvent('challenge_complete', { challenge: challengeId });
    }

    ws.send(`echo "PASS: challenge checks passed."\n`);
    const nextChallengeId = getNextChallengeId(challengeId);
    if (nextChallengeId) {
      ws.send(
        `echo "Moving to next challenge: ${challengeCatalog[nextChallengeId].title}"\n`
      );
      loadChallenge(nextChallengeId);
      applyChallengeStarter(true);
      showToast('Challenge completed. Moved to next.');
    } else {
      renderProgressTimeline();
      showToast('All challenges completed.');
    }
    return;
  }

  ws.send(`echo "FAIL: challenge checks did not pass yet."\n`);
}
