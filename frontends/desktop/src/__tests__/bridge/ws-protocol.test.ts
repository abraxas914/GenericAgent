// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bridge from '../../services/ws';

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = Socket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.readyState = Socket.OPEN; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  message(data: string) { this.onmessage?.({ data }); }
}

let cleanups: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  cleanups = [];
  vi.stubGlobal('WebSocket', Socket);
});
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  bridge.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const latest = () => Socket.instances[Socket.instances.length - 1];

describe('production WebSocket lifecycle', () => {
  it('does not connect when a store subscribes; repeated starts share one socket', () => {
    cleanups.push(bridge.subscribe('partial-update', vi.fn()));
    expect(Socket.instances).toHaveLength(0);
    bridge.start();
    bridge.start();
    expect(Socket.instances).toHaveLength(1);
    expect(bridge.getBridgeStatus()).toBe('connecting');
    latest().open();
    expect(bridge.getBridgeStatus()).toBe('ready');
  });

  it('dispatches valid payloads through actual subscriptions and tolerates invalid JSON', () => {
    const handler = vi.fn();
    const unsubscribe = bridge.subscribe('partial-update', handler);
    cleanups.push(unsubscribe);
    bridge.start();
    latest().open();
    latest().message('invalid');
    latest().message('{}');
    latest().message(JSON.stringify({ type: 'partial-update', sessionId: 'A', content: 'chunk' }));
    expect(handler).toHaveBeenCalledExactlyOnceWith({ type: 'partial-update', sessionId: 'A', content: 'chunk' });
    unsubscribe();
    latest().message(JSON.stringify({ type: 'partial-update' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('backs off failed connections, caps the delay and resets after open', () => {
    bridge.start();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      latest().close();
      const count = Socket.instances.length;
      vi.advanceTimersByTime(delay - 1);
      expect(Socket.instances).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(Socket.instances).toHaveLength(count + 1);
    }
    latest().open();
    latest().close();
    const count = Socket.instances.length;
    vi.advanceTimersByTime(1000);
    expect(Socket.instances).toHaveLength(count + 1);
  });

  it('does not reconnect after explicit disconnect or accept late events from an old socket', () => {
    bridge.start();
    const old = latest();
    old.open();
    bridge.disconnect();
    expect(bridge.getBridgeStatus()).toBe('offline');
    old.onopen?.();
    old.onclose?.();
    vi.advanceTimersByTime(60000);
    expect(Socket.instances).toHaveLength(1);
    expect(bridge.getBridgeStatus()).toBe('offline');
    bridge.start();
    latest().open();
    old.onerror?.();
    old.onclose?.();
    expect(bridge.getBridgeStatus()).toBe('ready');
    expect(latest().readyState).toBe(Socket.OPEN);
  });

  it('cancels a queued reconnect and notifies status changes only once', () => {
    const statuses = vi.fn();
    cleanups.push(bridge.onBridgeStatusChange(statuses));
    bridge.start();
    latest().open();
    latest().open();
    latest().close();
    bridge.disconnect();
    vi.advanceTimersByTime(60000);
    expect(Socket.instances).toHaveLength(1);
    expect(statuses.mock.calls.flat()).toEqual(['connecting', 'ready', 'connecting', 'offline']);
  });
});
