// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


const api = vi.hoisted(() => ({
  fetchConductorModel: vi.fn(),
  saveConductorModel: vi.fn(),
}));
vi.mock('../services/services-api', () => api);


class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  send() {}
  close() {}
}


describe('Conductor model store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    api.fetchConductorModel.mockResolvedValue({
      configured: null,
      effective: 1,
      fallbackReason: 'ui_default',
    });
    api.saveConductorModel.mockResolvedValue({
      configured: 2,
      effective: 2,
      fallbackReason: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps persisted config separate from the running model received over WS', async () => {
    const { useConductorStore } = await import('../stores/conductor');
    const ws = FakeWebSocket.instances[0];
    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.();
    await Promise.resolve();
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'hello',
        chat: [],
        subagents: [],
        running: true,
        model: {
          configured: 1,
          effective: 1,
          fallbackReason: null,
          current: 'model-one',
          running: true,
        },
      }),
    });

    expect(useConductorStore.getState().modelConfig?.effective).toBe(1);
    expect(useConductorStore.getState().runtimeModel?.current).toBe('model-one');
    expect(useConductorStore.getState().runtimeModel?.running).toBe(true);

    await useConductorStore.getState().selectModel(2);

    expect(api.saveConductorModel).toHaveBeenCalledWith(2);
    expect(useConductorStore.getState().modelConfig?.configured).toBe(2);
    expect(useConductorStore.getState().runtimeModel?.effective).toBe(1);
    useConductorStore.getState().disconnect();
  });

  it('updates runtime state from model events', async () => {
    const { useConductorStore } = await import('../stores/conductor');
    const ws = FakeWebSocket.instances[0];
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'model',
        model: {
          configured: 2,
          effective: 2,
          fallbackReason: null,
          current: 'model-two',
          running: false,
        },
      }),
    });

    expect(useConductorStore.getState().runtimeModel?.effective).toBe(2);
    expect(useConductorStore.getState().runtimeModel?.running).toBe(false);
    useConductorStore.getState().disconnect();
  });

  it('rolls back a failed model selection without leaking a rejected promise', async () => {
    api.saveConductorModel.mockRejectedValueOnce(new Error('offline'));
    const { useConductorStore } = await import('../stores/conductor');
    useConductorStore.setState({
      modelConfig: { configured: 1, effective: 1, fallbackReason: null },
    });

    await expect(useConductorStore.getState().selectModel(2)).resolves.toBeUndefined();

    expect(useConductorStore.getState().modelConfig?.configured).toBe(1);
    useConductorStore.getState().disconnect();
  });

  it('rejects worker termination when the conductor returns an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const { useConductorStore } = await import('../stores/conductor');

    await expect(useConductorStore.getState().killWorker('worker-1')).rejects.toThrow(
      'Failed to terminate worker (503)',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8900/subagent/worker-1',
      expect.objectContaining({ method: 'POST' }),
    );
    useConductorStore.getState().disconnect();
  });
});
