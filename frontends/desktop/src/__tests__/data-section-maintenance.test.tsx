// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  modalConfirm: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  tauriInvoke: vi.fn(),
  supportsDataBackupApi: vi.fn(),
  inspectDataImport: vi.fn(),
  importData: vi.fn(),
  exportData: vi.fn(),
  loadSessions: vi.fn(),
  fetchServices: vi.fn(),
  chatState: {
    runningSessions: new Set<string>(),
    status: 'idle',
    sessions: [] as Array<{ id: string; title: string; untitled: boolean; status?: string }>,
  },
  servicesState: {
    services: [] as Array<{ id: string; managed: boolean; running: boolean }>,
  },
}));

vi.mock('@douyinfe/semi-ui', () => {
  const Modal = Object.assign(
    ({ visible, title, children, footer }: any) => visible
      ? <div role="dialog"><h2>{title}</h2>{children}{footer}</div>
      : null,
    { confirm: mocks.modalConfirm },
  );
  return {
    Button: ({ children, type: _type, ...props }: any) => <button {...props}>{children}</button>,
    Modal,
    Toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
      warning: mocks.toastWarning,
    },
    Tooltip: ({ children }: any) => children,
  };
});

vi.mock('../utils/tauri', () => ({ isTauri: () => true }));
vi.mock('../services/bridge', () => ({
  tauriInvoke: mocks.tauriInvoke,
  saveMykeyContent: vi.fn(),
  getMykeyContent: vi.fn(),
}));
vi.mock('../services/dataBackup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/dataBackup')>();
  return {
    ...actual,
    supportsDataBackupApi: mocks.supportsDataBackupApi,
    inspectDataImport: mocks.inspectDataImport,
    importData: mocks.importData,
    exportData: mocks.exportData,
  };
});
vi.mock('../stores/chat', () => {
  const useChatStore = (selector: (state: typeof mocks.chatState) => unknown) => (
    selector(mocks.chatState)
  );
  useChatStore.getState = () => ({ loadSessions: mocks.loadSessions });
  return { useChatStore };
});
vi.mock('../stores/services', () => {
  const currentState = () => ({ ...mocks.servicesState, fetchServices: mocks.fetchServices });
  const useServicesStore = (selector: (value: ReturnType<typeof currentState>) => unknown) => (
    selector(currentState())
  );
  useServicesStore.getState = currentState;
  return { useServicesStore };
});
vi.mock('../stores/settings', () => ({
  useSettingsStore: { getState: () => ({ loadFromBridge: vi.fn() }) },
}));
vi.mock('../i18n', () => ({
  useI18n: () => ({
    lang: 'en',
    t: (key: string, params?: Record<string, string | number>) => Object.entries(params || {})
      .reduce((text, [name, value]) => `${text} ${name}=${value}`, key),
  }),
}));

import { DataSection } from '../components/settings/DataSection';


describe('DataSection maintenance boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatState.runningSessions = new Set();
    mocks.chatState.status = 'idle';
    mocks.chatState.sessions = [];
    mocks.servicesState.services = [];
    mocks.supportsDataBackupApi.mockResolvedValue(true);
    mocks.fetchServices.mockResolvedValue(undefined);
  });

  it('disables import and export when a session or managed service is running', async () => {
    mocks.chatState.sessions = [
      { id: 'sess-running', title: 'Running', untitled: false, status: 'running' },
    ];
    mocks.servicesState.services = [
      { id: 'reflect/scheduler.py', managed: true, running: true },
      { id: '__bridge__', managed: false, running: true },
    ];

    render(<DataSection />);

    expect((await screen.findByRole('button', { name: 'data.importDataBtn' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'data.exportDataBtn' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('sessions=1');
    expect(screen.getByRole('status').textContent).toContain('services=1');
    expect(mocks.fetchServices).toHaveBeenCalledOnce();
  });

  it('shows exact result statistics, backup path, and recovery guidance', async () => {
    const result = {
      memoryCopied: 3,
      memorySkipped: 0,
      responsesCopied: 4,
      responsesSkipped: 2,
      sessionsAdded: 5,
      sessionsSkipped: 1,
      sessionsFileFound: true,
      backupDir: '/data/temp/memory_import_backup_20260823_120000',
    };
    mocks.tauriInvoke.mockResolvedValue('/data/source.zip');
    mocks.inspectDataImport.mockResolvedValue({
      sourceType: 'backupZip',
      formatVersion: 1,
      exportedAt: '2026-08-23T00:00:00Z',
      sourceMode: 'included',
      content: { memory: 3, responses: 6, sessions: 6 },
    });
    mocks.importData.mockResolvedValue(result);

    render(<DataSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'data.importDataBtn' }));
    fireEvent.click(screen.getByRole('button', { name: 'data.importBackupBtn' }));
    await waitFor(() => expect(mocks.modalConfirm).toHaveBeenCalledOnce());

    await act(async () => {
      await mocks.modalConfirm.mock.calls[0][0].onOk();
    });

    expect(await screen.findByText(result.backupDir)).toBeTruthy();
    expect(screen.getByText(/data.importResultMemoryValue count=3/)).toBeTruthy();
    expect(screen.getByText(/data.importResultAddSkipValue added=4 skipped=2/)).toBeTruthy();
    expect(screen.getByText(/data.importResultAddSkipValue added=5 skipped=1/)).toBeTruthy();
    expect(screen.getByText('data.importRestoreHint')).toBeTruthy();
    expect(mocks.loadSessions).toHaveBeenCalledOnce();
  });
});
