import { expect, it, vi } from 'vitest';
import { guardEventCleanup } from '../src/lib/eventCleanup';

it('allows native cleanup to proceed when Tauri has no JS listener entry', () => {
  const host = { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: vi.fn(() => {
    throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')");
  }) } };
  guardEventCleanup(host);
  expect(() => host.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('audio', 1)).not.toThrow();
});

it('does not hide unrelated event failures', () => {
  const host = { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => { throw new Error('different failure'); } } };
  guardEventCleanup(host);
  expect(() => host.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('audio', 1)).toThrow('different failure');
});
