import {expect, it} from 'vitest';
import {SilenceGuard} from '../services/session-relay/src/silence';
it('ignores subthreshold noise and empty packets', () => {
  const guard = new SilenceGuard(0);
  guard.observe(new Int16Array(320).fill(32), 29000);
  guard.observe(new ArrayBuffer(0), 29999);
  expect(guard.expired(29999)).toBe(false);
  expect(guard.expired(30000)).toBe(true);
});
it('accepts quiet audible input at the threshold, including view offsets', () => {
  const guard = new SilenceGuard(0);
  const samples = new Int16Array(640).fill(33);
  guard.observe(samples.subarray(320), 29000);
  expect(guard.expired(30000)).toBe(false);
  expect(guard.expired(59000)).toBe(true);
});
it('does not dilute brief activity across a large packet', () => {
  const guard = new SilenceGuard(0);
  const samples = new Int16Array(16000);
  samples.fill(-100, 640, 960);
  guard.observe(samples.buffer, 29000);
  expect(guard.expired(30000)).toBe(false);
});

it('honors a custom timeout and threshold and bounds invalid settings', async () => {
  const {silenceSettings} = await import('../shared/silence');
  expect(silenceSettings({timeoutSeconds: Infinity, thresholdDbfs: NaN})).toEqual({timeoutSeconds:30,thresholdDbfs:-60});
  expect(silenceSettings({timeoutSeconds:0,thresholdDbfs:-100})).toEqual({timeoutSeconds:10,thresholdDbfs:-80});
  expect(silenceSettings({timeoutSeconds:999,thresholdDbfs:0})).toEqual({timeoutSeconds:300,thresholdDbfs:-30});
  const guard=new SilenceGuard(0,{timeoutSeconds:60,thresholdDbfs:-30});
  guard.observe(new Int16Array(320).fill(100),59000);
  expect(guard.expired(30000)).toBe(false);
  expect(guard.expired(60000)).toBe(true);
});
