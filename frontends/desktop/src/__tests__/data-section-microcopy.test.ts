// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

const dataCopy = (copy: Record<string, string>) => Object.entries(copy)
  .filter(([key]) => key.startsWith('data.'))
  .map(([, value]) => value)
  .join('\n');

describe('DataSection user-facing copy', () => {
  it('uses distinct user concepts for data folders, storage locations, and repositories', () => {
    expect(zh['data.title']).toBe('数据维护');
    expect(zh['data.importDataBtn']).toBe('选择文件夹');
    expect(zh['data.move']).toBe('移动本地数据');
    expect(zh['data.moveBtn']).toBe('选择新位置');
    expect(zh['data.localRepo']).toBe('连接本地仓库');

    expect(en['data.title']).toBe('Data management');
    expect(en['data.importData']).toBe('Import memory and sessions');
    expect(en['data.importDataBtn']).toBe('Pick folder');
    expect(en['data.move']).toBe('Move local data');
    expect(en['data.moveBtn']).toBe('Choose new location');
    expect(en['data.localRepo']).toBe('Connect local repository');
  });

  it('does not expose implementation vocabulary in the data-maintenance flow', () => {
    expect(dataCopy(zh)).not.toMatch(/\bGA\b|mykey|agentmain|Desktop 2\.0|运行时|后端|桌面壳|核心/i);
    expect(dataCopy(en)).not.toMatch(/\bGA\b|mykey|agentmain|Desktop 2\.0|runtime|backend|desktop shell|\bcore\b/i);
  });
});
