// @ts-check
/**
 * CTF catalog <-> terminal challenge registry consistency tests.
 *
 * Problem this guards against: HTML/CTF.html links to challenges by a
 * `?challenge=<id>` query string, and the terminal resolves that id against
 * `challengeCatalog` (populated by the terminal's own state module). Those
 * two things are maintained separately, so a stale or misspelled id on a
 * catalog card can silently fall back to whatever challenge was already
 * active instead of failing loudly (see challenges.js: loadChallenge() is a
 * no-op when `challengeCatalog[id]` is undefined).
 *
 * Approach: every card is scraped directly from CTF.html at test time, then
 * cross-checked against the terminal's live `window.challengeCatalog` /
 * `window.activeChallengeId`. There is no second, hand-maintained list of
 * challenge titles/objectives in this file -- the terminal's own registry is
 * the only source of truth being compared against.
 */
const { test, expect } = require('@playwright/test');

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
    if (url.includes('/monaco-editor@') && url.endsWith('/min/vs/loader.js')) {
      await route.fulfill({
        body: MONACO_LOADER_STUB,
        contentType: 'text/javascript',
      });
      return;
    }
    await route.continue();
  });
});

async function getCatalogChallenges(page) {
  await page.goto('/HTML/CTF.html');
  const cards = page.locator('a.course-card[href*="terminal/index.html"]');
  const count = await cards.count();
  const challenges = [];

  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const href = await card.getAttribute('href');
    const title = (await card.locator('.course-title').innerText()).trim();
    const url = new URL(href, 'https://example.invalid/HTML/CTF.html');
    const challengeId = url.searchParams.get('challenge');
    challenges.push({ challengeId, title, href });
  }

  return challenges;
}

function attachErrorCollectors(page) {
  const consoleErrors = [];
  const pageErrors = [];

  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  };
  const onPageError = (err) => {
    pageErrors.push(err.message);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return {
    consoleErrors,
    pageErrors,
    dispose() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    },
  };
}

async function waitForMockReady(page) {
  await expect(page.locator('#statusText')).toHaveText('Connected (mock)', {
    timeout: 10_000,
  });
}

function terminalMockUrl(challengeId) {
  return `/HTML/terminal/index.html?challenge=${encodeURIComponent(
    challengeId
  )}&mockTerminal=1`;
}

test.describe('CTF catalog / terminal challenge registry consistency', () => {
  test('every catalog card has a unique challenge id known to the terminal registry', async ({
    page,
  }) => {
    const catalogChallenges = await getCatalogChallenges(page);
    expect(catalogChallenges.length).toBeGreaterThan(0);

    for (const { challengeId, href } of catalogChallenges) {
      expect(
        challengeId,
        `card with href "${href}" is missing a ?challenge= id`
      ).toBeTruthy();
    }

    const ids = catalogChallenges.map((c) => c.challengeId);
    const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
    expect(
      Array.from(new Set(duplicates)),
      `duplicate challenge ids found across CTF.html cards`
    ).toEqual([]);

    await page.goto(terminalMockUrl(ids[0]));
    await waitForMockReady(page);
    const registryIds = await page.evaluate(() =>
      Object.keys(window.challengeCatalog || {})
    );
    expect(
      registryIds.length,
      'terminal challengeCatalog appears empty -- cannot validate against it'
    ).toBeGreaterThan(0);

    for (const { challengeId } of catalogChallenges) {
      expect(
        registryIds,
        `CTF.html links to unknown/misspelled challenge id "${challengeId}"`
      ).toContain(challengeId);
    }
  });

  test('each live card opens the matching challenge with no page/console errors', async ({
    page,
  }) => {
    const catalogChallenges = await getCatalogChallenges(page);

    for (const { challengeId, title } of catalogChallenges) {
      const errors = attachErrorCollectors(page);

      await page.goto(terminalMockUrl(challengeId));
      await waitForMockReady(page);
      await page.waitForFunction(
        () => !!window.__cybermindsMonacoEditor,
        null,
        { timeout: 10_000 }
      );

      const activeId = await page.evaluate(() => window.activeChallengeId);
      expect(
        activeId,
        `challenge "${challengeId}" from the catalog did not become active ` +
          `(terminal loaded "${activeId}" instead) -- likely an unknown id ` +
          `silently falling back`
      ).toBe(challengeId);

      const registryEntry = await page.evaluate(
        (id) => window.challengeCatalog[id],
        challengeId
      );
      expect(
        registryEntry,
        `no terminal registry entry for "${challengeId}"`
      ).toBeTruthy();

      await expect(page.locator('#challengeTitle')).toHaveText(
        registryEntry.title
      );
      await expect(page.locator('#challengeObjective')).toHaveText(
        registryEntry.objective
      );
      expect(
        title,
        `card title for "${challengeId}" is empty`
      ).toBeTruthy();

      expect(
        errors.consoleErrors,
        `console errors while loading "${challengeId}": ${errors.consoleErrors.join('; ')}`
      ).toEqual([]);
      expect(
        errors.pageErrors,
        `page errors while loading "${challengeId}": ${errors.pageErrors.join('; ')}`
      ).toEqual([]);

      errors.dispose();
    }
  });
});
