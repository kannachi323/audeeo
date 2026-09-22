// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {useState} from 'react';
import {emptySessionContext} from '../shared/context';
import {CaptionToolbar} from '../src/components/CaptionToolbar';
import type {ControlGroup} from '../src/components/AudioControls';

const popup=vi.hoisted(()=>({open:vi.fn()}));
vi.mock('../src/lib/controlPopup',()=>({
  supportsDetachedControls:()=>true, warmControlPopup:async()=>{},
  controlSnapshot:()=>({}), openControlPopup:popup.open,
}));
vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

function Fixture() {
  const [open,setOpen]=useState<ControlGroup|null>(null);
  const [silence,setSilence]=useState({timeoutSeconds:30,thresholdDbfs:-60});
  return <main className="subtitle-panel"><CaptionToolbar open={open} setOpen={setOpen}
    platform="macos" active={false} input="microphone" setInput={()=>{}} systemAudio applicationAudio={false}
    captureSourceId="all" setCaptureSourceId={()=>{}} inputGain translatedPlayback
    captionMode="subtitles" setCaptionMode={()=>{}} source="en" setSource={()=>{}} target="es" setTarget={()=>{}}
    silence={silence} setSilence={setSilence} translationContext={emptySessionContext()} setTranslationContext={()=>{}}
    microphoneGain={1} setMicrophoneGain={()=>{}} desktopGain={1} setDesktopGain={()=>{}} translatedVolume={1} setTranslatedVolume={()=>{}}
    microphoneMuted={false} setMicrophoneMuted={()=>{}} desktopMuted={false} setDesktopMuted={()=>{}} translatedMuted={false} setTranslatedMuted={()=>{}}/>
  </main>;
}

it('opens working controls when the native popup fails, and keeps every group available',async()=>{
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  popup.open.mockRejectedValue(new Error('Controls did not load'));
  render(<Fixture/>);
  fireEvent.click(screen.getByRole('button',{name:'Source'}));
  expect(await screen.findByRole('dialog',{name:'Source'})).toBeTruthy();
  expect(screen.getByRole('combobox',{name:'Input source'})).toBeTruthy();
  for(const name of ['Languages','Context','Volume','Auto-stop']) {
    fireEvent.click(screen.getByRole('button',{name}));
    expect(screen.getByRole('dialog',{name})).toBeTruthy();
  }
  fireEvent.change(screen.getByRole('slider',{name:'Silence timeout'}),{target:{value:'65'}});
  expect(screen.getByText('Stop after silence · 65s')).toBeTruthy();
  expect(popup.open).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Auto-stop'}));
  expect(screen.queryByRole('dialog')).toBeNull();
});
