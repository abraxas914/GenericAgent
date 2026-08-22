// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

const flowCopy = (copy: Record<string, string>) => Object.entries(copy)
  .filter(([key]) => key.startsWith('data.') || key.startsWith('connection.'))
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
    expect([zh['connection.included'], zh['connection.local']]).toEqual(['内置模式', '本地仓库']);
    expect([en['connection.included'], en['connection.local']]).toEqual(['Included mode', 'Local repository']);
  });

  it('keeps implementation vocabulary out of both settings flows', () => {
    expect(flowCopy(zh)).not.toMatch(/\bGA\b|mykey|agentmain|Desktop 2\.0|运行时|后端|桌面壳|核心/i);
    expect(flowCopy(en)).not.toMatch(/\bGA\b|mykey|agentmain|Desktop 2\.0|runtime|backend|desktop shell|\bcore\b/i);
  });

  it('uses the connection mental model on the retained detailed page', () => {
    expect(zh['page.services.title']).toBe('连接与服务');
    expect(zh['page.services.sub']).not.toMatch(/后台|hub\.pyw|GA/i);
    expect(en['page.services.title']).toBe('Connections & services');
    expect(en['page.services.sub']).not.toMatch(/background|hub\.pyw|\bGA\b/i);
  });
});
