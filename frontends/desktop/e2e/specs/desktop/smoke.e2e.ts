import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { ChatPage } from '../../pages/ChatPage';
import { UsagePage } from '../../pages/UsagePage';
import { RecoveryPage } from '../../pages/RecoveryPage';
import { controlRequest, loadE2EContext } from '../../harness/context';

const chat = new ChatPage();
const usage = new UsagePage();
const recovery = new RecoveryPage();
const context = loadE2EContext();

describe('GenericAgent native Tauri smoke', () => {
  it('boots in the isolated sandbox and completes chat plus usage UI', async () => {
    await chat.waitUntilReady();
    // Pin the window after the renderer is ready. The service's title-based
    // auto-focus can otherwise race loading.html -> index.html on macOS.
    await browser.tauri.switchWindow('main');
    const identity = await (await fetch(`${context.bridgeBase}/services/identity`)).json() as { ga_root: string };
    assert.equal(realpathSync(identity.ga_root), realpathSync(context.sandboxRoot));
    await chat.waitForBridgeReady();
    await chat.startNewChat();
    await chat.send('[E2E:normal] native smoke');
    await chat.waitForAssistantText('Harness reply', 60_000);
    await usage.open();
    await usage.waitForTotal('107', 30_000);

    await controlRequest('/bridge/kill-external', { method: 'POST', body: '{}' });
    await chat.startNewChat();
    await recovery.waitForOffline();
    await recovery.recoverFromServices();
    await browser.waitUntil(async () => {
      try {
        return (await fetch(`${context.bridgeBase}/services/identity`)).ok;
      } catch {
        return false;
      }
    }, { timeout: 30_000, interval: 250, timeoutMsg: 'Bridge did not restart through the native UI' });
    await chat.startNewChat();
    await chat.waitForBridgeReady();
  });
});
