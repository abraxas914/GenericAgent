// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupFilename,
  DataBackupError,
  exportData,
  importData,
  inspectDataImport,
  supportsDataBackupApi,
} from '../services/dataBackup';

describe('desktop data backup service', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('builds locale-aware, second-precision backup filenames', () => {
    const date = new Date(2026, 7, 22, 9, 4, 7);
    expect(backupFilename('zh', date)).toBe('GenericAgent-数据备份-2026-08-22-090407.zip');
    expect(backupFilename('en', date)).toBe('GenericAgent-data-backup-2026-08-22-090407.zip');
  });

  it('detects whether the connected core exposes advanced data backup routes', async () => {
    mockFetch.mockResolvedValueOnce({ status: 405 });
    await expect(supportsDataBackupApi()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:14168/memory/import/inspect',
      { method: 'HEAD' },
    );

    mockFetch.mockResolvedValueOnce({ status: 404 });
    await expect(supportsDataBackupApi()).resolves.toBe(false);

    mockFetch.mockRejectedValueOnce(new Error('bridge unavailable'));
    await expect(supportsDataBackupApi()).resolves.toBe(false);
  });

  it('inspects a backup before import and sends only its selected path', async () => {
    const inspection = {
      sourceType: 'backupZip',
      formatVersion: 1,
      exportedAt: '2026-08-22T01:04:07Z',
      sourceMode: 'included',
      content: { memory: 2, responses: 3, sessions: 4 },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(inspection),
    });

    await expect(inspectDataImport('/Users/test/data.zip')).resolves.toEqual(inspection);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:14168/memory/import/inspect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sourcePath: '/Users/test/data.zip' }),
      }),
    );
  });

  it('imports through the source-wins memory and add-only history endpoint', async () => {
    const result = {
      memoryCopied: 3,
      memorySkipped: 2,
      responsesCopied: 4,
      responsesSkipped: 1,
      sessionsAdded: 5,
      sessionsSkipped: 2,
      sessionsFileFound: true,
      backupDir: '/Users/test/temp/memory_import_backup_20260823_120000',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(result),
    });

    await expect(importData('/Users/test/data.zip')).resolves.toEqual(result);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:14168/memory/import',
      expect.objectContaining({ body: JSON.stringify({ sourcePath: '/Users/test/data.zip' }) }),
    );
  });

  it('exports the selected connection mode without exposing its repository path', async () => {
    const result = {
      path: '/Users/test/GenericAgent-data-backup.zip',
      exportedAt: '2026-08-22T01:04:07Z',
      sourceMode: 'localRepository',
      content: { memory: 1, responses: 2, sessions: 3 },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(result),
    });

    await expect(exportData(result.path, 'localRepository')).resolves.toEqual(result);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:14168/memory/export',
      expect.objectContaining({
        body: JSON.stringify({
          destinationPath: result.path,
          sourceMode: 'localRepository',
        }),
      }),
    );
  });

  it('surfaces bridge errors to the localized UI boundary', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'backup format is not supported' }),
    });

    await expect(inspectDataImport('/Users/test/bad.zip'))
      .rejects.toThrow('backup format is not supported');
  });

  it('preserves maintenance conflict details for the UI', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({
        error: 'stop running sessions and managed services before data maintenance',
        code: 'maintenance_conflict',
        runningSessions: ['sess-running'],
        runningExtras: ['reflect/scheduler.py'],
      }),
    });

    const error = await importData('/Users/test/data.zip').catch((value) => value);
    expect(error).toBeInstanceOf(DataBackupError);
    expect(error).toMatchObject({
      code: 'maintenance_conflict',
      runningSessions: ['sess-running'],
      runningExtras: ['reflect/scheduler.py'],
    });
  });
});
