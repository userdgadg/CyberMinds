// @ts-check
/**
 * Frontend smoke tests for the CyberMinds student learning flow.
 *
 * These tests run against a local static server (no backend, Docker, or Go).
 * Mock-terminal mode (?mockTerminal=1) replaces all WebSocket/backend calls
 * with in-memory fixture data so every flow is self-contained.
 *
 * Flows covered:
 *   1. Home page renders and exposes the Get Started link.
 *   2. Home → Course Catalog navigation.
 *   3. CTF Catalog loads challenge cards and links to the terminal.
 *   4. CTF Catalog → Terminal page navigation.
 *   5. Mock terminal initialises without any backend connection.
 *   6. Challenge panel populates once the editor (Monaco CDN) has loaded.
 *   7. Completing a mock challenge updates the progress chip and shows a toast.
 */
const { test, expect } = require('@playwright/test');

// ─── helpers ────────────────────────────────────────────────────────────────

const TERMINAL_MOCK_URL =
  '/HTML/terminal/index.html?challenge=linux-basics&mockTerminal=1';

const XTERM_STUB = `
window.Terminal = class Terminal {
  constructor(options = {}) {
    this.options = options;
    this.cols = 80;
    this.rows = 24;
    this.element = null;
    this.dataHandlers = [];
  }
  loadAddon() {}
  open(element) {
    this.element = element;
    if (this.element) this.element.textContent = '';
  }
  write(text) {
    if (!this.element) return;
    this.element.textContent += String(text).replace(/\\x1b\\[[0-9;]*m/g, '');
  }
  clear() {
    if (this.element) this.element.textContent = '';
  }
  onData(handler) {
    this.dataHandlers.push(handler);
    return { dispose() {} };
  }
  onResize() {
    return { dispose() {} };
  }
};
`;

const FIT_ADDON_STUB = `
window.FitAddon = {
  FitAddon: class FitAddon {
    fit() {}
  },
};
`;

const MONACO_LOADER_STUB = `
window.monaco = {
  editor: {
    defineTheme() {},
    setTheme() {},
    setModelLanguage(model, language) {
      if (model) model.language = language;
    },
    create(element, options = {}) {
      let value = String(options.value || '');
      const model = { language: options.language || 'plaintext' };
      const listeners = [];
      if (element) element.textContent = value;
      const editor = {
        getValue: () => value,
        setValue(nextValue) {
          value = String(nextValue || '');
          if (element) element.textContent = value;
          listeners.forEach((listener) => listener());
        },
        getModel: () => model,
        onDidChangeModelContent(listener) {
          listeners.push(listener);
          return { dispose() {} };
        },
      };
      window.__cybermindsMonacoEditor = editor;
      return editor;
    },
  },
};
window.require = function require(modules, callback) {
  if (Array.isArray(modules) && typeof callback === 'function') {
    window.setTimeout(callback, 0);
  }
};
window.require.config = function config() {};
`;

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/@xterm/xterm@') && url.endsWith('/css/xterm.min.css')) {
      await route.fulfill({ body: '', contentType: 'text/css' });
      return;
    }

    if (url.includes('/@xterm/xterm@') && url.endsWith('/lib/xterm.min.js')) {
      await route.fulfill({ body: XTERM_STUB, contentType: 'text/javascript' });
      return;
    }

    if (
      url.includes('/@xterm/addon-fit@') &&
      url.endsWith('/lib/addon-fit.min.js')
    ) {
      await route.fulfill({
        body: FIT_ADDON_STUB,
        contentType: 'text/javascript',
      });
      return;
    }

    if (
      url.includes('/monaco-editor@') &&
      url.endsWith('/min/vs/loader.js')
    ) {
      await route.fulfill({
        body: MONACO_LOADER_STUB,
        contentType: 'text/javascript',
      });
      return;
    }

    await route.continue();
  });
});

/** Wait for the mock session to report "Connected (mock)" in the status bar. */
async function waitForMockReady(page) {
  await expect(page.locator('#statusText')).toHaveText('Connected (mock)', {
    timeout: 10_000,
  });
}

async function tabUntilFocused(page, selector, { reverse = false } = {}) {
  const target = page.locator(selector).first();
  for (let index = 0; index < 100; index += 1) {
    const isFocused = await target.evaluate((element) => element === document.activeElement);
    if (isFocused) {
      return target;
    }
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Unable to focus ${selector}`);
}

// ─── Home page ───────────────────────────────────────────────────────────────

test.describe('Home page', () => {
  test('loads with site title and Get Started link', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/CyberMinds/);
    await expect(
      page.getByRole('link', { name: /get started/i })
    ).toBeVisible();
  });
});

// ─── Navigation ──────────────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test('home → course catalog', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /get started/i }).click();
    await expect(page).toHaveURL(/course_Contents\.html/);
    await expect(page.locator('.page-title')).toContainText('Courses');
  });

  test('CTF catalog shows challenge cards', async ({ page }) => {
    await page.goto('/HTML/CTF.html');
    await expect(page.locator('.page-title')).toContainText('CTFs');

    const cards = page.locator('a.course-card[href*="terminal/index.html"]');
    await expect(cards.first()).toBeVisible();

    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('CTF catalog → terminal page', async ({ page }) => {
    await page.goto('/HTML/CTF.html');
    await page.locator('a[href*="challenge=linux-basics"]').click();
    await expect(page).toHaveURL(/terminal\/index\.html/);
    await expect(page).toHaveTitle('CyberMinds Terminal');
  });

  test('keyboard-only navigation reaches course and CTF links in reading order', async ({
    page,
  }) => {
    await page.goto('/HTML/course_Contents.html');

    const firstCourseCard = await tabUntilFocused(page, '.course-card');
    await expect(firstCourseCard).toBeFocused();
    await expect(firstCourseCard).toHaveCSS('outline-style', 'solid');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/Introductioncourse1\.html/);

    await page.goto('/HTML/CTF.html');
    const firstCtfCard = await tabUntilFocused(page, 'a.course-card');
    await expect(firstCtfCard).toBeFocused();
    await expect(firstCtfCard).toHaveCSS('outline-style', 'solid');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/terminal\/index\.html\?challenge=linux-basics/);
  });

  test('command palette and draft recovery overlays restore focus after Escape', async ({
    page,
  }) => {
    await page.goto(TERMINAL_MOCK_URL);
    await waitForMockReady(page);
    await page.waitForFunction(() => !!window.__cybermindsMonacoEditor, null, {
      timeout: 10_000,
    });

    const trigger = page.locator('#loadStarterBtn');
    await trigger.focus();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Control+KeyK');
    const palette = page.locator('#commandPaletteOverlay');
    await expect(palette).toBeVisible();
    await expect(page.locator('#commandPaletteInput')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.evaluate(() => {
      window.__cybermindsMonacoEditor.setValue(
        '# saved draft\nprint("keep")\n'
      );
    });

    await page.waitForFunction(() => {
      const saved = window.localStorage.getItem(
        'cm_terminal_draft_v1:linux-basics:template:python'
      );
      return !!saved && saved.includes('saved draft');
    });
    await page.evaluate(() => {
      window.localStorage.setItem(
        'cm_terminal_draft_v1:linux-basics:template:javascript',
        '// second saved draft\nconsole.log("keep");\n'
      );
    });

    await page.reload();
    await waitForMockReady(page);
    await page.waitForFunction(() => !!window.__cybermindsMonacoEditor, null, {
      timeout: 10_000,
    });

    const banner = page.locator('#draftRecoveryBanner');
    await expect(banner).toBeVisible();

    const browseButton = await tabUntilFocused(page, '#draftBrowseBtn');
    await page.keyboard.press('Space');
    const draftOverlay = page.locator('#draftBrowseOverlay');
    await expect(draftOverlay).toBeVisible();
    await expect(page.locator('#draftBrowseCloseBtn')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(draftOverlay).toHaveCount(0);
    await expect(browseButton).toBeFocused();

    const dismissButton = await tabUntilFocused(page, '#draftDismissBtn');
    await expect(dismissButton).toBeFocused();
    await page.keyboard.press('Space');
    await expect(banner).toHaveCount(0);
  });

  test('terminal challenge navigation and hidden controls stay out of tab order', async ({
    page,
  }) => {
    await page.goto(TERMINAL_MOCK_URL);
    await waitForMockReady(page);
    await page.waitForFunction(() => !!window.__cybermindsMonacoEditor, null, {
      timeout: 10_000,
    });

    const firstNavButton = await tabUntilFocused(page, '#challengeNav button');
    await expect(firstNavButton).toBeFocused();
    await expect(firstNavButton).toHaveCSS('outline-style', 'solid');

    await page.keyboard.press('Enter');
    await expect(page.locator('#challengeTitle')).toContainText(/Linux Basics Warmup|Web Recon|Log Hunt/i);

    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press('Tab');
      const focusedControlIsOperable = await page.evaluate(() => {
        const focused = document.activeElement;
        return (
          focused instanceof HTMLElement &&
          !focused.hidden &&
          !focused.hasAttribute('disabled') &&
          !focused.closest('[hidden]')
        );
      });
      expect(focusedControlIsOperable).toBe(true);
    }
  });
});

test.describe('Content pages', () => {
  test('Live Help hides fallback after load and shows it when chat fails', async ({ page }) => {
    await page.goto('/HTML/LiveHelp.html');
    await expect(page.locator('#chatIframe')).toBeVisible();
    await expect(page.locator('#chatFallback')).toBeHidden();

    await page.evaluate(() => window.handleIframeError());
    await expect(page.locator('#chatIframe')).toBeHidden();
    await expect(page.locator('#chatFallback')).toBeVisible();
  });

  test('mission page exposes a clear h1 and responsive content cards', async ({
    page,
  }) => {
    await page.goto('/HTML/mission.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Our Mission'
    );

    const overflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflowing).toBe(false);
  });

  test('more info page uses semantic headings and visible contact link', async ({
    page,
  }) => {
    await page.goto('/HTML/moreinfo.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'More Info'
    );
    await expect(
      page.getByRole('link', { name: /CYBER-MINDS@outlook\.com/i })
    ).toBeVisible();
  });
});

// ─── Learner progress ───────────────────────────────────────────────────────

test.describe('Learner progress dashboard', () => {
  test('visiting a course page records last visited lesson', async ({ page }) => {
    await page.goto(
      '/HTML/Courses and Activities/Course 3/SocialEngineeringcourse3.html'
    );
    await page.goto('/HTML/course_Contents.html');

    await expect(page.locator('#continueLearningLastVisited')).toContainText(
      'Course 3 - Social Engineering'
    );
    await expect(page.locator('#continueLearningLink')).toHaveAttribute(
      'href',
      /SocialEngineeringcourse3\.html/
    );
  });

  test('course catalog shows local progress, recommendation, and reset flow', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'cm_learning_progress_v1',
        JSON.stringify({
          lastVisited: {
            id: 'course-3-social-engineering',
            title: 'Course 3 - Social Engineering',
            href: '/HTML/Courses and Activities/Course 3/SocialEngineeringcourse3.html',
            type: 'course-page',
            visitedAt: '2026-06-21T12:00:00.000Z',
          },
          visitedPages: {
            'course-3-introduction': {
              id: 'course-3-introduction',
              title: 'Course 3 - Introduction',
              href: '/HTML/Courses and Activities/Course 3/Introductioncourse3.html',
              type: 'course-page',
              visitedAt: '2026-06-21T11:00:00.000Z',
            },
          },
          completedQuizzes: {
            'course-3-threat-actors-social-engineering': {
              score: 4,
              totalQuestions: 4,
              completedAt: '2026-06-21T12:05:00.000Z',
            },
          },
        })
      );
      window.localStorage.setItem(
        'cm_ctf_progress_v1',
        JSON.stringify({
          'linux-basics': {
            passed: true,
            passedAt: '2026-06-21T12:10:00.000Z',
          },
        })
      );
    });

    await page.goto('/HTML/course_Contents.html');

    await expect(page.locator('#continueLearningPanel')).toBeVisible();
    await expect(page.locator('#continueLearningLastVisited')).toContainText(
      'Course 3 - Social Engineering'
    );
    await expect(page.locator('#continueLearningQuizCount')).toContainText('1');
    await expect(page.locator('#continueLearningCtfCount')).toContainText('1');
    await expect(page.locator('#continueLearningLink')).toHaveAttribute(
      'href',
      /SocialEngineeringcourse3\.html/
    );
    await expect(page.locator('#continueLearningRecommendation')).toContainText(
      /Threat Actors and Social Engineering Quiz|resume/i
    );

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#progressResetBtn').click();

    await expect(page.locator('#continueLearningQuizCount')).toContainText('0');
    await expect(page.locator('#continueLearningCtfCount')).toContainText('0');
    await expect(page.locator('#continueLearningLastVisited')).toContainText(
      /No course progress yet/i
    );
  });

  test('course catalog ignores unsafe persisted resume links', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'cm_learning_progress_v1',
        JSON.stringify({
          lastVisited: {
            id: 'bad-link',
            title: 'Injected link',
            href: 'javascript:alert(1)',
            type: 'course-page',
            visitedAt: '2026-06-21T12:00:00.000Z',
          },
          visitedPages: {},
          completedQuizzes: {},
        })
      );
    });

    await page.goto('/HTML/course_Contents.html');

    await expect(page.locator('#continueLearningLink')).toHaveAttribute(
      'href',
      /Introductioncourse1\.html/
    );
  });

  test('progress links resolve correctly for project pages paths', async ({
    page,
  }) => {
    await page.goto('/HTML/course_Contents.html');

    const resolved = await page.evaluate(() =>
      window.CyberMindsProgress.resolveSitePath(
        '/HTML/Courses and Activities/Course 1/Introductioncourse1.html',
        '/CyberMinds/HTML/course_Contents.html'
      )
    );

    expect(decodeURIComponent(resolved)).toBe(
      '/CyberMinds/HTML/Courses and Activities/Course 1/Introductioncourse1.html'
    );
  });

  test('progress links keep project-site paths and challenge query strings', async ({
    page,
  }) => {
    await page.goto('/HTML/course_Contents.html');

    const resolvedCourse = await page.evaluate(() =>
      window.CyberMindsProgress.resolveSitePath(
        '/CyberMinds/HTML/Courses%20and%20Activities/Course%203/SocialEngineeringcourse3.html',
        '/CyberMinds/HTML/course_Contents.html'
      )
    );
    const resolvedChallenge = await page.evaluate(() =>
      window.CyberMindsProgress.resolveSitePath(
        '/CyberMinds/HTML/terminal/index.html?challenge=linux-basics',
        '/CyberMinds/HTML/course_Contents.html'
      )
    );

    expect(decodeURIComponent(resolvedCourse)).toBe(
      '/CyberMinds/HTML/Courses and Activities/Course 3/SocialEngineeringcourse3.html'
    );
    expect(resolvedChallenge).toBe(
      '/CyberMinds/HTML/terminal/index.html?challenge=linux-basics'
    );
  });
});

// ─── Shared quiz engine ─────────────────────────────────────────────────────

test.describe('Shared quiz engine', () => {
  test('migrated quiz shows explanations, score, and saves completion locally', async ({
    page,
  }) => {
    await page.goto(
      '/HTML/Courses and Activities/Course 3/TAandSEquizcourse3.html'
    );

    await page.locator('label[for="q1-ES"]').click();
    await page.locator('label[for="q2-ignore"]').click();
    await page.locator('label[for="q3-a1"]').click();
    await page.locator('label[for="q4-phishing"]').click();
    await page.getByRole('button', { name: /submit quiz/i }).click();

    await expect(page.locator('#result')).toContainText('4/4');
    await expect(page.locator('#q1-ES-detail')).toBeVisible();
    await expect(page.locator('#q1-SW-detail')).toBeVisible();

    const saved = await page.evaluate(() => {
      const raw = window.localStorage.getItem('cm_learning_progress_v1');
      return raw ? JSON.parse(raw) : null;
    });

    expect(saved.completedQuizzes).toHaveProperty(
      'course-3-threat-actors-social-engineering'
    );
    expect(
      saved.completedQuizzes['course-3-threat-actors-social-engineering'].score
    ).toBe(4);
  });

  test('second migrated quiz supports alternate correct answer and retry', async ({
    page,
  }) => {
    await page.goto(
      '/HTML/Courses and Activities/Course 4/TechnicalDefenseQUIZ.html'
    );

    await page.locator('label[for="q1-ES"]').click();
    await page.locator('label[for="q2-ignore"]').click();
    await page.locator('label[for="q3-false"]').click();
    await page.locator('label[for="q4-phishing"]').click();
    await page.getByRole('button', { name: /submit quiz/i }).click();

    await expect(page.locator('#result')).toContainText('4/4');

    const saved = await page.evaluate(() => {
      const raw = window.localStorage.getItem('cm_learning_progress_v1');
      return raw ? JSON.parse(raw) : null;
    });

    expect(saved.completedQuizzes).toHaveProperty(
      'course-4-technical-measures-quiz'
    );

    await page.getByRole('button', { name: /retry quiz/i }).click();
    await expect(page.locator('#result')).toHaveText('');
    await expect(page.locator('#retryQuizBtn')).toBeHidden();
  });
});

test.describe('Legacy quiz progress', () => {
  test('legacy quiz submission updates local progress dashboard', async ({
    page,
  }) => {
    await page.goto(
      '/HTML/Courses and Activities/Course 6/QuizLinuxcourse6.html'
    );

    await page.locator('label[for="q1-VS"]').first().click();
    await page.locator('label[for="q2-ignore"]').first().click();
    await page.locator('label[for="q4-phishing"]').first().click();
    await page.getByRole('button', { name: /submit quiz/i }).click();
    await expect(page.locator('#result')).toContainText('/4');

    await page.goto('/HTML/course_Contents.html');
    await expect(page.locator('#continueLearningQuizCount')).toContainText('1');
  });
});

// ─── Mock terminal ───────────────────────────────────────────────────────────

test.describe('Mock terminal', () => {
  test('initialises without backend connection', async ({ page }) => {
    await page.goto(TERMINAL_MOCK_URL);

    // Status bar must flip to "Connected (mock)" — this confirms that
    // isMockTerminal=true was detected and the fake ws object is in place.
    await waitForMockReady(page);

    // Loading skeleton must be hidden once mock init completes.
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
  });

  test('challenge panel populates after editor loads', async ({ page }) => {
    await page.goto(TERMINAL_MOCK_URL);

    // loadChallenge() runs inside the Monaco require() callback, so we allow
    // extra time for the CDN script to arrive and execute.
    await expect(page.locator('#challengeTitle')).toHaveText(
      'Linux Basics Warmup',
      { timeout: 30_000 }
    );
    await expect(page.locator('#challengeObjective')).not.toBeEmpty();
    await expect(page.locator('#challengeSteps li').first()).toBeVisible();
  });

  test('completing challenge updates progress chip and shows toast', async ({
    page,
  }) => {
    await page.goto(TERMINAL_MOCK_URL);
    await waitForMockReady(page);

    // Seed a passing answer directly via the mock file API.
    // setMockFile() is a global function declared in mock.js (non-module
    // sloppy-mode script), so it is accessible on window.
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      window.setMockFile(
        'report.txt',
        'owner: cyberminds, group: staff, perms: 0755\n'
      );
    });

    await page.locator('#checkSolutionBtn').click();

    // Progress chip should immediately reflect the first completed challenge.
    await expect(page.locator('#progressChip')).toContainText('1/');

    // Toast text persists in the DOM even after the visible class is removed,
    // so toContainText() matches reliably within the retry window.
    await expect(page.locator('#toast')).toContainText(/completed/i);
  });

  test('completed mock challenge appears in learner progress dashboard', async ({
    page,
  }) => {
    await page.goto(TERMINAL_MOCK_URL);
    await waitForMockReady(page);

    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      window.setMockFile(
        'report.txt',
        'owner: cyberminds, group: staff, perms: 0755\n'
      );
    });

    await page.locator('#checkSolutionBtn').click();
    await expect(page.locator('#progressChip')).toContainText('1/');

    await page.goto('/HTML/course_Contents.html');
    await expect(page.locator('#continueLearningCtfCount')).toContainText('1');
  });

  test('phishing-header challenge loads mock email and passes checker with valid findings', async ({
    page,
  }) => {
    await page.goto(
      '/HTML/terminal/index.html?challenge=phishing-header&mockTerminal=1'
    );
    await waitForMockReady(page);

    await expect(page.locator('#challengeTitle')).toHaveText(
      'Phishing Header Analysis',
      { timeout: 30_000 }
    );

    // Confirm the mock .eml file was seeded
    const emlContent = await page.evaluate(
      () => window.getMockFile('phishing.eml') || ''
    );
    expect(emlContent).toContain('Return-Path');
    expect(emlContent).toContain('phish-mailer.invalid');
    expect(emlContent).toContain('spf=fail');
    expect(emlContent).toContain('dkim=fail');

    // Seed a passing findings file
    await page.evaluate(() => {
      window.setMockFile(
        'phishing-findings.txt',
        [
          'Impersonated domain: corporate-alerts.example.com (Security Team)',
          'Return-Path mismatch: envelope sender is bounces@phish-mailer.invalid',
          'SPF fail: 203.0.113.99 is not a permitted sender for corporate-alerts.example.com',
          'DKIM fail: signature verification failed for corporate-alerts.example.com',
          'Suspicious Received chain: mail relayed through phish-mailer.invalid',
        ].join('\n')
      );
    });

    await page.locator('#checkSolutionBtn').click();
    await expect(page.locator('#progressChip')).toContainText('1/');
    await expect(page.locator('#toast')).toContainText(/completed/i);
  });

  test('iam-least-privilege challenge seeds policy files and passes checker with scoped policy', async ({
    page,
  }) => {
    await page.goto(
      '/HTML/terminal/index.html?challenge=iam-least-privilege&mockTerminal=1'
    );
    await waitForMockReady(page);

    await expect(page.locator('#challengeTitle')).toHaveText(
      'IAM Least Privilege',
      { timeout: 30_000 }
    );

    // Confirm mock files were seeded
    const policyContent = await page.evaluate(
      () => window.getMockFile('policy.json') || ''
    );
    expect(policyContent).toContain('"Action": "*"');
    expect(policyContent).toContain('"Resource": "*"');

    const reqs = await page.evaluate(
      () => window.getMockFile('requirements.txt') || ''
    );
    expect(reqs).toContain('cm-backup-data-123456789012');
    expect(reqs).toContain('s3:GetObject');

    // Seed a passing least-privilege policy
    await page.evaluate(() => {
      const passing = JSON.stringify(
        {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'S3BackupRead',
              Effect: 'Allow',
              Action: ['s3:GetObject', 's3:ListBucket'],
              Resource: [
                'arn:aws:s3:::cm-backup-data-123456789012/prod/daily/*',
                'arn:aws:s3:::cm-backup-data-123456789012',
              ],
            },
            {
              Sid: 'CWLWrite',
              Effect: 'Allow',
              Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              Resource: [
                'arn:aws:logs:us-east-1:123456789012:log-group:/backup/cm-agent:*',
              ],
            },
          ],
        },
        null,
        2
      );
      window.setMockFile('policy.json', passing);
    });

    await page.locator('#checkSolutionBtn').click();
    await expect(page.locator('#progressChip')).toContainText('1/');
    await expect(page.locator('#toast')).toContainText(/completed/i);
  });

  test('draft autosaves before a fast reload and restores the edit', async ({
    page,
  }) => {
    await page.goto(TERMINAL_MOCK_URL);
    await waitForMockReady(page);
    await page.waitForFunction(
      () => !!window.__cybermindsMonacoEditor,
      null,
      { timeout: 10_000 }
    );

    await page.evaluate(() => {
      window.__cybermindsMonacoEditor.setValue(
        '# recovered draft\nprint("keep this after reload")\n'
      );
    });

    const savedDraftKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith('cm_terminal_draft_v1')
      )
    );

    expect(savedDraftKeys).toContain(
      'cm_terminal_draft_v1:linux-basics:template:python'
    );

    await page.reload();
    await waitForMockReady(page);
    await page.waitForFunction(
      () => !!window.__cybermindsMonacoEditor,
      null,
      { timeout: 10_000 }
    );

    const restoredDraft = await page.evaluate(() =>
      window.localStorage.getItem(
        'cm_terminal_draft_v1:linux-basics:template:python'
      )
    );

    expect(restoredDraft).toContain('keep this after reload');
    await expect(page.locator('#draftRecoveryBanner')).toHaveCount(1);

    await expect(page.locator('#editor')).toContainText(
      'keep this after reload'
    );

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#draftDiscardBtn').click();

    const clearedDraft = await page.evaluate(() =>
      window.localStorage.getItem(
        'cm_terminal_draft_v1:linux-basics:template:python'
      )
    );
    expect(clearedDraft).toBeNull();

    await expect(page.locator('#editor')).toContainText(
      'Linux Basics Warmup'
    );

    await page.reload();
    await waitForMockReady(page);
    await page.waitForFunction(
      () => !!window.__cybermindsMonacoEditor,
      null,
      { timeout: 10_000 }
    );

    await expect(page.locator('#draftRecoveryBanner')).toHaveCount(0);
    await expect(page.locator('#editor')).not.toContainText(
      'keep this after reload'
    );
  });
});
