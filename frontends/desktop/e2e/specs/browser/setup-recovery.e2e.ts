import assert from 'node:assert/strict';

const snapshot = {
  seq: 7,
  mode: 'cold_start',
  phase: 'failed',
  stage: null,
  progress: 0,
  failure: { code: 'spawn_failed', detail: 'secret already redacted by bootstrap service' },
  diagnostics: {
    buildId: 'e2e-build',
    platform: 'darwin',
    projectDir: '/tmp/genericagent',
    pythonPath: '/tmp/genericagent/.venv/bin/python',
    recentLogs: ['spawn failed'],
    portState: 'free',
    bridgeIdentity: null,
  },
};

async function renderWithTauriMock(path: string, blockSetupModule = false, legacyMode = false) {
  await browser.url('/');
  await browser.execute(async (documentPath, initialSnapshot, blockModule, useLegacyCommands) => {
    let html = await fetch(documentPath).then((response) => response.text());
    if (blockModule) html = html.replace('/src/setup.tsx', '/src/setup-blocked.tsx');
    const mockSource = `
      const snapshot = ${JSON.stringify(initialSnapshot)};
      const state = { calls: [] };
      Object.defineProperty(window, '__GA_E2E_TAURI__', { configurable: true, value: state });
      Object.defineProperty(window, '__TAURI__', {
        configurable: true,
        value: {
          core: {
            invoke: async (command, args) => {
              state.calls.push({ command, args });
              if (command === 'get_config') return [snapshot.diagnostics.pythonPath, snapshot.diagnostics.projectDir];
              if (command === 'get_bootstrap_snapshot') {
                if (${JSON.stringify(useLegacyCommands)}) throw new Error('Command get_bootstrap_snapshot not found');
                return snapshot;
              }
              if (command === 'get_prepare_error') return 'legacy offline preparation failed';
              if (command === 'retry_bootstrap') return null;
              if (command === 'start_bridge_with_config') return null;
              throw new Error('Unexpected command: ' + command);
            }
          },
          event: {
            listen: async (_name, listener) => {
              state.listener = listener;
              return () => { state.listener = undefined; };
            }
          }
        }
      });`;
    html = html.replace('<head>', `<head><script>${mockSource}<\/script>`);
    document.open();
    document.write(html);
    document.close();
  }, path, snapshot, blockSetupModule, legacyMode);
}

async function renderLegacyLoading() {
  await browser.url('/');
  await browser.execute(async () => {
    const html = await fetch('/loading.html').then((response) => response.text());
    const mockSource = `
      Object.defineProperty(window, '__TAURI__', {
        configurable: true,
        value: {
          core: { invoke: async () => { throw new Error('Command get_bootstrap_snapshot not found'); } },
          event: { listen: async () => () => {} }
        }
      });`;
    document.open();
    document.write(html.replace('<head>', `<head><script>${mockSource}<\/script>`));
    document.close();
  });
}

describe('bootstrap recovery rescue chain', () => {
  it('renders the React/Semi setup UI and invokes retry with configured paths', async () => {
    await renderWithTauriMock('/setup.html');

    const title = await $('#ga-setup-title');
    await title.waitForDisplayed();
    assert.equal(await $('.ga-setup-banner').isDisplayed(), true);
    await $('.ga-setup-diagnostics .semi-collapse-header').click();
    const diagnostics = await $('#diagnostics');
    await diagnostics.waitForExist();
    const diagnosticsText = await browser.execute(() => document.getElementById('diagnostics')?.textContent ?? '');
    assert.match(diagnosticsText, /failure_code: spawn_failed/);

    await $('.ga-setup-retry').click();
    await browser.waitUntil(async () => {
      const calls = await browser.execute(() => (
        (window as typeof window & { __GA_E2E_TAURI__?: { calls: Array<{ command: string }> } })
          .__GA_E2E_TAURI__?.calls ?? []
      ));
      return calls.some((call) => call.command === 'retry_bootstrap');
    });
  });

  it('renders upstream v1 progress updates in the React loading page', async () => {
    await renderLegacyLoading();
    await $('#loading-root').waitForExist();
    await browser.execute(() => {
      (window as typeof window & { gaProgress?: (pct: number, key: string) => void })
        .gaProgress?.(45, 'deps');
    });

    await browser.waitUntil(async () => (
      await $('main[data-route="progress"]').isExisting()
    ));
    assert.equal(await $('.semi-progress').isDisplayed(), true);
  });

  it('uses upstream v1 commands from the React/Semi setup UI', async () => {
    await renderWithTauriMock('/setup.html', false, true);

    await $('#ga-setup-title').waitForDisplayed();
    assert.equal(await $('.ga-setup-banner').isDisplayed(), true);
    await $('.ga-setup-retry').click();
    await browser.waitUntil(async () => {
      const calls = await browser.execute(() => (
        (window as typeof window & { __GA_E2E_TAURI__?: { calls: Array<{ command: string }> } })
          .__GA_E2E_TAURI__?.calls ?? []
      ));
      return calls.some((call) => call.command === 'start_bridge_with_config');
    });
  });

  it('redirects to standalone fallback when the setup module is blocked', async () => {
    await renderWithTauriMock('/setup.html', true);
    await browser.waitUntil(async () => (await browser.getUrl()).includes('/fallback.html'));
    assert.equal(await $('h1').isDisplayed(), true);
    const guardReason = await browser.execute(() => document.getElementById('copy-status')?.textContent ?? '');
    assert.match(guardReason, /setup_module_unavailable/);
  });

  it('shows backend-redacted diagnostics in the standalone fallback', async () => {
    await renderWithTauriMock('/fallback.html');
    const diagnostics = await $('#diagnostics');
    await diagnostics.waitForExist();
    const diagnosticsText = await browser.execute(() => document.getElementById('diagnostics')?.textContent ?? '');
    assert.match(diagnosticsText, /failure_code: spawn_failed/);
    assert.match(diagnosticsText, /recent_logs:\nspawn failed/);
  });

  it('uses upstream v1 commands from the standalone fallback', async () => {
    await renderWithTauriMock('/fallback.html', false, true);
    await $('#retry').waitForDisplayed();
    await $('#retry').click();

    await browser.waitUntil(async () => {
      const calls = await browser.execute(() => (
        (window as typeof window & { __GA_E2E_TAURI__?: { calls: Array<{ command: string }> } })
          .__GA_E2E_TAURI__?.calls ?? []
      ));
      return calls.some((call) => call.command === 'start_bridge_with_config');
    });
  });
});
