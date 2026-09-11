import { afterEach, expect, it, vi } from 'vitest';
import { connectUpstream } from '../services/session-relay/src/connect';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('does not abort an upgraded connection after the handshake deadline', async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    signal = options.signal;
    return { status: 101 };
  }));
  await connectUpstream('https://provider.test', 'test');
  await vi.advanceTimersByTimeAsync(60000);
  expect(signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('still aborts a stalled handshake', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  })));
  const result = expect(connectUpstream('https://provider.test', 'test')).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(10000);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
