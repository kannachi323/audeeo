import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const capture = vi.hoisted(() => ({callbacks:new Map<string,(pcm:Int16Array)=>void>(), stops:vi.fn()}));
vi.mock('../src/lib/platform', () => ({NativeCapture:class {
  constructor(private input:string) {}
  async start(onChunk:(pcm:Int16Array)=>void) { capture.callbacks.set(this.input,onChunk); }
  async stop() { capture.stops(); }
}}));
import {DesktopCapture} from '../src/lib/desktopCapture';
beforeEach(() => { vi.useFakeTimers(); capture.callbacks.clear(); capture.stops.mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['system','microphone'] as const)('sends %s PCM immediately at its capture rate, with live gain changes', async input => {
  const output:Int16Array[]=[];
  const mixer=new DesktopCapture(input,'all',{system:.5,microphone:.5});
  await mixer.start(pcm=>output.push(pcm),vi.fn());
  expect([...capture.callbacks.keys()]).toEqual([input]);
  capture.callbacks.get(input)!(new Int16Array(800).fill(4000));
  expect(output.flatMap(pcm=>[...pcm])).toEqual(new Array(800).fill(2000));
  mixer.setGains({system:0,microphone:0});
  capture.callbacks.get(input)!(new Int16Array(320).fill(4000));
  expect(output.at(-1)).toEqual(new Int16Array(320));
  expect(vi.getTimerCount()).toBe(0);
  await mixer.stop();
  capture.callbacks.get(input)!(new Int16Array(320));
  expect(output).toHaveLength(2);
});
