// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
const metadata=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:metadata.invoke}));
import {CaptureStatus,captureSourceViewportWidth} from '../src/components/CaptureStatus';
afterEach(()=>{cleanup();vi.useRealTimers();metadata.invoke.mockReset();});
it('keeps detailed device names wider than the viewport so the fade always activates',()=>{
  expect(captureSourceViewportWidth(300,260,true)).toBe(234);
  expect(captureSourceViewportWidth(180,260,true)).toBe(180);
  expect(captureSourceViewportWidth(300,260,false)).toBe(300);
});
it('scrolls all active applications together while describing the full capture scope',async()=>{
  vi.useFakeTimers();
  metadata.invoke.mockResolvedValue({microphone:'Studio microphone',applications:['Safari','Music']});
  const view=render(<CaptureStatus input="system" status="live" playing={false} platform="macos"/>);
  await act(async()=>{});
  expect(screen.getByText('Safari · Music')).toBeTruthy();
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Capturing desktop audio from active apps · Safari, Music');
  await act(async()=>{vi.advanceTimersByTime(4000);});
  expect(screen.getByText('Safari · Music')).toBeTruthy();
  view.rerender(<CaptureStatus input="system" status="idle" playing={false} platform="macos"/>);
  await act(async()=>{});
  expect(screen.queryByText('Ready')).toBeNull();
  expect(screen.getByRole('status').querySelector('svg')).toBeNull();
  expect(screen.getByText('Desktop audio (all apps)')).toBeTruthy();
  expect(screen.queryByText('Music')).toBeNull();
});
it('shows the microphone device and falls back cleanly when metadata is unavailable',async()=>{
  metadata.invoke.mockResolvedValue({microphone:'Studio microphone',applications:['Safari']});
  const view=render(<CaptureStatus input="microphone" status="live" playing={false} platform="macos"/>);
  await act(async()=>{});
  expect(screen.getByText('Studio microphone')).toBeTruthy();
  expect(screen.queryByText('Safari')).toBeNull();
  metadata.invoke.mockRejectedValue(new Error('Unavailable'));
  view.rerender(<CaptureStatus input="microphone" status="idle" playing={false} platform="macos"/>);
  await act(async()=>{});
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Ready · Microphone');
});
it('describes the desktop microphone and playback mix as one capture input',async()=>{
  metadata.invoke.mockResolvedValue({microphone:'Studio microphone',applications:['Safari','Music']});
  render(<CaptureStatus input="mixed" status="live" playing={false} platform="macos"/>);
  await act(async()=>{});
  expect(screen.getByText('Studio microphone + Safari · Music')).toBeTruthy();
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Mixing microphone and desktop audio · Studio microphone, Safari, Music');
});

it('uses native device names and overflow behavior on Windows',async()=>{
  metadata.invoke.mockResolvedValue({microphone:'Microphone Array (High Definition Audio Device)',applications:['Speakers (High Definition Audio Device)']});
  render(<CaptureStatus input="microphone" status="idle" playing={false} platform="windows"/>);
  await act(async()=>{});
  expect(metadata.invoke).toHaveBeenCalledWith('capture_sources');
  expect(screen.getByText('Microphone Array (High Definition Audio Device)')).toBeTruthy();
  expect(screen.getByRole('status').getAttribute('aria-label')).toContain('Microphone Array');
});

it('describes iOS device playback as system-picker capture',async()=>{
  metadata.invoke.mockResolvedValue({microphone:'Microphone',applications:[]});
  render(<CaptureStatus input="system" status="live" playing={false} platform="ios"/>);
  await act(async()=>{});
  expect(screen.getByText('Device playback (system picker)')).toBeTruthy();
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Capturing approved device playback · Device playback (system picker)');
});

it('does not overlap slow metadata requests or restart polling after leaving captions',async()=>{
  vi.useFakeTimers();
  let resolve!: (value: {microphone:string;applications:string[]})=>void;
  metadata.invoke.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const view=render(<CaptureStatus input="microphone" status="live" playing={false} platform="macos"/>);
  await act(async()=>{vi.advanceTimersByTime(10000);});
  expect(metadata.invoke).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async()=>{resolve({microphone:'Studio microphone',applications:[]});});
  await act(async()=>{vi.advanceTimersByTime(10000);});
  expect(metadata.invoke).toHaveBeenCalledTimes(1);
});
