// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const statusPanel = fs.readFileSync(
  path.join(desktopRoot, 'src/components/services/StatusPanel.tsx'),
  'utf8',
);
const bridgePanel = fs.readFileSync(
  path.join(desktopRoot, 'src/components/layout/BridgeMenuPanel.tsx'),
  'utf8',
);

describe('runtime management microcopy', () => {
  it('uses product names with concise summaries and explanatory tooltips', () => {
    expect(zh['nav.status']).toBe('运行状态');
    expect(zh['svc.colName']).toBe('运行组件');
    expect(zh['proc.bridge']).toBe('本地连接');
    expect(zh['proc.conductor']).toBe('指挥家');
    expect(zh['proc.conductorSummary']).toBe('异步处理多步骤任务');
    expect(zh['proc.scheduler']).toBe('定时任务');
    expect(en['proc.bridge']).toBe('Local connection');
    expect(en['proc.conductor']).toBe('Conductor');
    expect(en['proc.scheduler']).toBe('Scheduled tasks');
  });

  it('does not expose service IDs as user-facing tooltip copy', () => {
    expect(statusPanel).not.toContain('content={record.id}');
    expect(statusPanel).toContain('t(meta.tipKey)');
    expect(bridgePanel).not.toContain("label: 'Bridge'");
    expect(bridgePanel).toContain('t(tab.labelKey)');
  });

  it('distinguishes backend controls from a webview refresh', () => {
    expect(statusPanel).toContain("t('act.disconnect')");
    expect(statusPanel).toContain("t('bridge.restart')");
    expect(bridgePanel).toContain("title={t('bridge.refresh')}");
    expect(zh['act.disconnect']).toBe('断开');
    expect(zh['bridge.restart']).toBe('重新连接');
    expect(zh['bridge.refresh']).toBe('刷新界面');
  });

  it('localizes every visible runtime table heading', () => {
    for (const key of ['svc.colName', 'svc.colStatus', 'svc.colPid', 'svc.colMemory', 'svc.colCpu', 'svc.colActions']) {
      expect(statusPanel).toContain(`t('${key}')`);
      expect(zh[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});
