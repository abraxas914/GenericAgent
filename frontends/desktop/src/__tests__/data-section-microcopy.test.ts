// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

const flowCopy = (copy: Record<string, string>, omit: string[] = []) => Object.entries(copy)
  .filter(([key]) => (key.startsWith('data.') || key.startsWith('connection.')) && !omit.includes(key))
  .map(([, value]) => value)
  .join('\n');

describe('DataSection user-facing copy', () => {
  it('presents exactly four symmetric data-maintenance operations', () => {
    expect(zh['data.title']).toBe('数据维护');
    expect([
      zh['data.importKey'], zh['data.exportKey'], zh['data.importData'], zh['data.exportData'],
    ]).toEqual(['导入密钥配置', '导出密钥配置', '导入记忆与会话', '导出记忆与会话']);

    expect(en['data.title']).toBe('Data management');
    expect([
      en['data.importKey'], en['data.exportKey'], en['data.importData'], en['data.exportData'],
    ]).toEqual([
      'Import key config', 'Export key config', 'Import memory and sessions',
      'Export memory and sessions',
    ]);
    expect(Object.keys(zh).filter((key) => key.startsWith('data.move'))).toEqual([]);
    expect(Object.keys(en).filter((key) => key.startsWith('data.move'))).toEqual([]);
  });

  it('offers only the two confirmed connection modes', () => {
    expect([zh['connection.included'], zh['connection.local']]).toEqual(['内置运行环境', '本地仓库']);
    expect([en['connection.included'], en['connection.local']]).toEqual(['Included environment', 'Local repository']);
    expect(zh['connection.apply']).toBe('应用并连接');
    expect(en['connection.apply']).toBe('Apply and connect');
    expect(zh['connection.includedDescription'])
      .toContain('本桌面应用内置的运行环境');
    expect(zh['connection.description'])
      .toContain('本桌面应用内置的运行环境');
    expect(zh['connection.localDescription'])
      .toContain('在使用桌面版之前已经拥有的本地仓库');
    expect(zh['connection.sectionTip']).toContain('不会复制、移动或合并');
    expect(en['connection.sectionTip']).toContain('does not copy, move, or merge');
  });

  it('explains data operations and their consequences in tooltips', () => {
    expect(zh['data.importKeyTip']).toContain('替换当前密钥配置');
    expect(zh['data.exportKeyTip']).toContain('敏感信息');
    expect(zh['data.importDataTip']).toContain('密钥配置不受影响');
    expect(zh['data.exportDataTip']).toContain('不会移动或删除原数据');
    expect(en['data.exportDataTip']).toContain('original data stays in place');
  });

  it('keeps implementation vocabulary out of both settings flows', () => {
    expect(flowCopy(zh)).not.toMatch(/\bGA\b|mykey|agentmain|Desktop 2\.0|运行时|后端|桌面壳|核心/i);
    expect(flowCopy(en, ['connection.status', 'connection.viewStatus']))
      .not.toMatch(/\bGA\b|mykey|agentmain|Desktop 2\.0|runtime|backend|desktop shell|\bcore\b/i);
    expect([en['connection.status'], en['connection.viewStatus']])
      .toEqual(['Runtime status', 'View runtime status']);
  });

  it('keeps the retained detailed page in the runtime-status layer', () => {
    expect(zh['page.services.title']).toBe('运行状态');
    expect(zh['page.services.sub']).not.toMatch(/后台|hub\.pyw|GA/i);
    expect(en['page.services.title']).toBe('Runtime status');
    expect(en['page.services.sub']).not.toMatch(/background|hub\.pyw|\bGA\b/i);
  });
});
