import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatPage } from '../../pages/ChatPage';
import { loadE2EContext } from '../../harness/context';

const chat = new ChatPage();
const context = loadE2EContext();

interface GeometryEvidence {
  controlCenterY: number;
  controlLeftX: number;
  trafficLightCenterY: number;
  trafficLightRightX: number;
  measuredCenterY: number | null;
  measuredRightX: number | null;
}

async function readGeometry(): Promise<GeometryEvidence | null> {
  return browser.execute(async () => {
    const invoke = (window as any).__TAURI__?.core?.invoke;
    const controls = document.querySelector<HTMLElement>('[data-testid="titlebar-controls"]');
    if (!invoke || !controls) return null;
    const metrics = await invoke('get_macos_titlebar_metrics') as {
      trafficLightCenterY: number;
      trafficLightRightX: number;
    } | null;
    if (!metrics) return null;
    const rect = controls.getBoundingClientRect();
    const measuredCenterY = Number(controls.dataset.trafficLightCenterY);
    const measuredRightX = Number(controls.dataset.trafficLightRightX);
    return {
      controlCenterY: rect.top + rect.height / 2,
      controlLeftX: rect.left,
      trafficLightCenterY: metrics.trafficLightCenterY,
      trafficLightRightX: metrics.trafficLightRightX,
      measuredCenterY: Number.isFinite(measuredCenterY) ? measuredCenterY : null,
      measuredRightX: Number.isFinite(measuredRightX) ? measuredRightX : null,
    };
  });
}

async function assertAligned(label: string): Promise<GeometryEvidence> {
  await browser.waitUntil(async () => {
    const current = await readGeometry();
    if (!current) return false;
    return current.controlCenterY >= 0
      && current.controlCenterY <= 38
      && current.trafficLightCenterY >= 0
      && current.trafficLightCenterY <= 38
      && Math.abs(current.controlCenterY - current.trafficLightCenterY) <= 1
      && Math.abs(current.controlLeftX - current.trafficLightRightX - 10) <= 1
      && Math.abs((current.measuredCenterY ?? -1000) - current.trafficLightCenterY) <= 0.01
      && Math.abs((current.measuredRightX ?? -1000) - current.trafficLightRightX) <= 0.01;
  }, {
    timeout: 15_000,
    interval: 100,
    timeoutMsg: `${label} controls did not align with native traffic-light metrics`,
  });
  const evidence = await readGeometry();
  assert.ok(evidence, `${label} geometry evidence is missing`);
  assert.ok(
    evidence.controlCenterY >= 0 && evidence.controlCenterY <= 38,
    `${label} controls escaped the top 38 CSS px titlebar: ${JSON.stringify(evidence)}`,
  );
  assert.ok(
    evidence.trafficLightCenterY >= 0 && evidence.trafficLightCenterY <= 38,
    `${label} native metrics escaped the top 38 CSS px titlebar: ${JSON.stringify(evidence)}`,
  );
  assert.ok(
    Math.abs(evidence.controlCenterY - evidence.trafficLightCenterY) <= 1,
    `${label} vertical center delta exceeded 1 CSS px: ${JSON.stringify(evidence)}`,
  );
  assert.ok(
    Math.abs(evidence.controlLeftX - evidence.trafficLightRightX - 10) <= 1,
    `${label} horizontal gap was not 10 ± 1 CSS px: ${JSON.stringify(evidence)}`,
  );
  return evidence;
}

async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  const button = await $('[data-testid="titlebar-controls"] button');
  const currentCollapsed = (await button.getAttribute('aria-label')) === '显示侧边栏';
  if (currentCollapsed !== collapsed) await button.click();
  await browser.waitUntil(async () => (
    ((await button.getAttribute('aria-label')) === '显示侧边栏') === collapsed
  ), { timeout: 5_000, timeoutMsg: `sidebar did not become ${collapsed ? 'collapsed' : 'expanded'}` });
}

async function captureWindow(name: string): Promise<void> {
  await mkdir(context.reports, { recursive: true });
  const target = join(context.reports, `${name}.png`);
  const captured = await browser.execute(async (path) => {
    const invoke = (window as any).__TAURI__?.core?.invoke;
    if (!invoke) return false;
    await invoke('capture_macos_window_screenshot', { path });
    return true;
  }, target);
  assert.equal(captured, true, `${name} native window capture was unavailable`);
  const screenshot = await stat(target);
  assert.ok(screenshot.size > 0, `${name} full-window screenshot is empty`);
}

describe('GenericAgent native macOS titlebar geometry', () => {
  it('aligns React controls after sidebar, resize, and scale-factor changes', async () => {
    assert.equal(process.platform, 'darwin', 'macOS chrome E2E must only run on macOS');
    await chat.switchToMainAndWait();

    await setSidebarCollapsed(false);
    await assertAligned('expanded sidebar');
    await captureWindow('macos-titlebar-expanded');

    await setSidebarCollapsed(true);
    await assertAligned('collapsed sidebar');
    await captureWindow('macos-titlebar-collapsed');

    const size = await browser.getWindowSize();
    await browser.setWindowSize(size.width + 120, size.height + 80);
    await assertAligned('resized window');
    await captureWindow('macos-titlebar-resized');

    await browser.execute(async () => {
      await (window as any).__TAURI__?.event?.emit?.('tauri://scale-change', {
        scaleFactor: window.devicePixelRatio,
        size: { width: window.innerWidth, height: window.innerHeight },
      });
    });
    await assertAligned('scale-factor notification');
    await captureWindow('macos-titlebar-scale-change');
  });
});
