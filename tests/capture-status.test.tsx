// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
import {emptySessionContext} from '../shared/context';
const metadata=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:metadata.invoke}));
import {CaptureStatus} from '../src/components/CaptureStatus';
const setup = {captionMode:'translate' as const,source:'en',target:'es',translationContext:emptySessionContext(),silence:{timeoutSeconds:30,thresholdDbfs:-60},onOpen:vi.fn()};
afterEach(()=>{cleanup();vi.useRealTimers();metadata.invoke.mockReset();setup.onOpen.mockReset();});
function showField(name: string | RegExp) {
  for (let i=0;i<15;i++) {
    const match=screen.queryByRole('button',{name});
    if (match) return match;
    fireEvent.keyDown(screen.getByRole('button'),{key:'ArrowRight'});
  }
  return screen.getByRole('button',{name});
}

it('keeps the configured source visible and puts device details in its accessible name and tooltip',async()=>{
  metadata.invoke.mockResolvedValue({microphone:'Studio microphone',applications:['Safari','Music']});
  render(<CaptureStatus {...setup} input="system" status="live" playing={false} platform="macos"/>);
  await act(async()=>{});
  expect(screen.getByText('Desktop')).toBeTruthy();
  const source=screen.getByRole('button',{name:/Source: Desktop audio/});
  expect(source.title).toBe('Desktop audio (all apps) · Playing: Safari, Music');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(showField('Translate: English → Spanish')).toBeTruthy();
  expect(showField('Auto-stop: 30s of silence')).toBeTruthy();
  expect(showField('Context: General')).toBeTruthy();
  expect(showField('Silence level: -60 dBFS')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Listening');
});
it('shows a selected app without confusing it with the all-apps capture scope',async()=>{
  metadata.invoke.mockResolvedValue({microphone:'Mic',applications:['Music'],captureSources:[{id:'chrome',name:'Chrome'}]});
  const view=render(<CaptureStatus {...setup} input="system" captureSourceId="chrome" status="idle" playing={false} platform="windows"/>);
  await act(async()=>{});
  expect(screen.getByRole('button',{name:'Source: Chrome'})).toBeTruthy();
  view.rerender(<CaptureStatus {...setup} input="system" captureSourceId="missing" status="idle" playing={false} platform="windows"/>);
  await act(async()=>{});
  expect(screen.getByRole('button',{name:'Source: Selected application'})).toBeTruthy();
  expect(screen.getByText('Selected app')).toBeTruthy();
});
it('falls back to readable source labels when device metadata is unavailable',async()=>{
  metadata.invoke.mockRejectedValue(new Error('Unavailable'));
  render(<CaptureStatus {...setup} input="microphone" status="idle" playing={false} platform="macos"/>);
  await act(async()=>{});
  expect(screen.getByText('Mic')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Source: Microphone'})).toBeTruthy();
});
it('updates caption mode, languages, custom context and the timeout directly from settings',async()=>{
  const view=render(<CaptureStatus {...setup} input="microphone" status="idle" playing={false} platform="browser"/>);
  view.rerender(<CaptureStatus {...setup} captionMode="subtitles" source="auto" translationContext={{...emptySessionContext(),terms:['Audeeo']}} silence={{timeoutSeconds:60,thresholdDbfs:-50}} input="microphone" status="idle" playing={false} platform="browser"/>);
  expect(showField('Captions: Auto-detect')).toBeTruthy();
  expect(screen.queryByText('English → Spanish')).toBeNull();
  expect(showField('Context: General')).toBeTruthy();
  expect(showField('Silence level: -50 dBFS')).toBeTruthy();
  expect(showField('Terms: Audeeo')).toBeTruthy();
});
it('opens the matching dropdown for every summary item and only shows relevant mute states',()=>{
  const props={...setup,input:'microphone' as const,status:'idle' as const,playing:false,platform:'browser',inputGain:true,translatedPlayback:true,microphoneMuted:true,desktopMuted:true,translatedMuted:true,translationContext:{...emptySessionContext(),category:'education' as const}};
  const view=render(<CaptureStatus {...props}/>);
  for(const [name,group] of [['Source: Microphone','input'],['Translate: English → Spanish','languages'],['Context: Education','context'],['Auto-stop: 30s of silence','silence'],['Mic volume: 100% (muted)','audio'],['Speech volume: 100% (muted)','audio'],['Silence level: -60 dBFS','silence']]) {
    fireEvent.click(showField(name));
    expect(setup.onOpen).toHaveBeenLastCalledWith(group);
  }
  view.rerender(<CaptureStatus {...props} input="system" captionMode="subtitles"/>);
  expect(showField('Desktop volume: 100% (muted)')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Mic volume/})).toBeNull();
  expect(showField('Speech volume: 100% (off)')).toBeTruthy();
});
it('does not overlap slow metadata requests or restart polling after unmount',async()=>{
  vi.useFakeTimers();
  let resolve!: (value: {microphone:string;applications:string[]})=>void;
  metadata.invoke.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const view=render(<CaptureStatus {...setup} input="microphone" status="live" playing={false} platform="macos"/>);
  await act(async()=>{vi.advanceTimersByTime(10000);});
  expect(metadata.invoke).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async()=>{resolve({microphone:'Studio microphone',applications:[]});});
  await act(async()=>{vi.advanceTimersByTime(10000);});
  expect(metadata.invoke).toHaveBeenCalledTimes(1);
});

it('includes configured volume percentages and context details in the rotation',()=>{
  const props={...setup,input:'microphone' as const,status:'idle' as const,playing:false,platform:'browser',inputGain:true,translatedPlayback:true,
    microphoneGain:.4,desktopGain:.85,translatedVolume:.6,translationContext:{...emptySessionContext(),category:'education' as const,text:'Lecture notes',terms:['Audeeo','Soniox'],translationTerms:[{source:'hello',target:'hola'}]}};
  const view=render(<CaptureStatus {...props}/>);
  for(const name of ['Mic volume: 40%','Speech volume: 60%','Notes: Lecture notes','Terms: Audeeo, Soniox','Translations: hello → hola']) expect(showField(name)).toBeTruthy();
  view.rerender(<CaptureStatus {...props} microphoneGain={0} translatedVolume={.2}/>);
  expect(showField('Mic volume: 0%')).toBeTruthy();
  expect(showField('Speech volume: 20%')).toBeTruthy();
});

it('rolls between metadata every six seconds and pauses on hover, focus and open menus',async()=>{
  vi.useFakeTimers();
  const view=render(<CaptureStatus {...setup} input="microphone" status="idle" playing={false} platform="browser"/>);
  const button=screen.getByRole('button');
  expect(button.textContent).toBe('Source: Mic');
  await act(async()=>{vi.advanceTimersByTime(5999);});
  expect(button.textContent).toBe('Source: Mic');
  expect(button.querySelector('.is-incoming')).toBeNull();
  await act(async()=>{vi.advanceTimersByTime(1);});
  expect(screen.getByRole('button',{name:'Translate: English → Spanish'})).toBe(button);
  expect(button.querySelector('.is-outgoing')?.getAttribute('aria-hidden')).toBe('true');
  expect(button.querySelector('.is-incoming')?.textContent).toBe('Translate: English → Spanish');
  await act(async()=>{vi.advanceTimersByTime(800);});
  expect(button.querySelector('.is-outgoing')).toBeNull();
  expect(button.textContent).toBe('Translate: English → Spanish');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.mouseEnter(screen.getByRole('group',{name:'Session setup'}));
  await act(async()=>{vi.advanceTimersByTime(12000);});
  expect(button.textContent).toBe('Translate: English → Spanish');
  fireEvent.mouseLeave(screen.getByRole('group',{name:'Session setup'}));
  fireEvent.focus(button);
  await act(async()=>{vi.advanceTimersByTime(8000);});
  expect(button.textContent).toBe('Translate: English → Spanish');
  fireEvent.keyDown(button,{key:'ArrowRight'});
  expect(button.textContent).toBe('Context: General');
  fireEvent.keyDown(button,{key:'ArrowLeft'});
  expect(button.textContent).toBe('Translate: English → Spanish');
  fireEvent.blur(button);
  view.rerender(<CaptureStatus {...setup} input="microphone" status="idle" playing={false} platform="browser" paused/>);
  await act(async()=>{vi.advanceTimersByTime(8000);});
  expect(button.textContent).toBe('Translate: English → Spanish');
  view.rerender(<CaptureStatus {...setup} input="microphone" status="idle" playing={false} platform="browser"/>);
  await act(async()=>{vi.advanceTimersByTime(6000);});
  expect(screen.getByRole('button',{name:'Context: General'})).toBe(button);
});
it('handles removal of the current optional field and wraps back to Source',async()=>{
  vi.useFakeTimers();
  const view=render(<CaptureStatus {...setup} translationContext={{...emptySessionContext(),terms:['Audeeo']}} input="microphone" status="idle" playing={false} platform="browser"/>);
  showField('Terms: Audeeo');
  view.rerender(<CaptureStatus {...setup} input="microphone" status="idle" playing={false} platform="browser"/>);
  expect(screen.getByRole('button').textContent).toBe('Source: Mic');
  showField('Silence level: -60 dBFS');
  await act(async()=>{vi.advanceTimersByTime(6000);});
  expect(screen.getByRole('button',{name:'Source: Microphone'})).toBeTruthy();
});
