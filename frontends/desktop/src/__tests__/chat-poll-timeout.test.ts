// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { pollMessages } from '../services/chat';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('aborts a stuck poll so a later request can recover', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_MOCK', 'false');
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })));
  const pending = expect(pollMessages('session')).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(15_000);
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});

it('clears the deadline after a successful response', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_MOCK', 'false');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ messages: [], status: 'idle' }) }));
  expect((await pollMessages('session')).status).toBe('idle');
  expect(vi.getTimerCount()).toBe(0);
});
