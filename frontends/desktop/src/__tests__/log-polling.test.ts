// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLogPolling } from '../hooks/useLogPolling';

function deferred() {
  let resolve!: (value: string[]) => void;
  const promise = new Promise<string[]>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('does not overwrite the current service with a late response from the previous service', async () => {
  const old = deferred();
  const read = vi.fn((id: string) => id === 'A' ? old.promise : Promise.resolve(['B']));
  const { result, rerender } = renderHook(({ id }) => useLogPolling(id, read), { initialProps: { id: 'A' } });
  rerender({ id: 'B' });
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toEqual(['B']);
  await act(async () => { old.resolve(['A']); });
  expect(result.current).toEqual(['B']);
});

it('skips overlapping reads and stops polling after unmount', async () => {
  const pending = deferred();
  const read = vi.fn(() => pending.promise);
  const { unmount } = renderHook(() => useLogPolling('A', read));
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(read).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { pending.resolve(['A']); await vi.advanceTimersByTimeAsync(9000); });
  expect(read).toHaveBeenCalledTimes(1);
});
