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

  it('reads explicit supported and unsupported data backup capabilities', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ dataBackup: true }),
    });
    await expect(supportsDataBackupApi()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:14168/services/capabilities',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ dataBackup: false }),
    });
    await expect(supportsDataBackupApi()).resolves.toBe(false);
  });

  it('treats only an explicit 404 as unsupported', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(supportsDataBackupApi()).resolves.toBe(false);

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(supportsDataBackupApi()).resolves.toBeNull();

    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(supportsDataBackupApi()).resolves.toBeNull();
  });

  it('keeps backup availability unknown for transport and response failures', async () => {
    mockFetch.mockRejectedValueOnce(new Error('bridge unavailable'));
    await expect(supportsDataBackupApi()).resolves.toBeNull();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('invalid JSON')),
    });
    await expect(supportsDataBackupApi()).resolves.toBeNull();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ anotherCapability: true }),
    });
    await expect(supportsDataBackupApi()).resolves.toBeNull();
  });

  it('keeps backup availability unknown when capability discovery times out', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      (options?.signal as AbortSignal).addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));
    try {
      const availability = supportsDataBackupApi();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(availability).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
