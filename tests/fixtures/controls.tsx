// Visual QA for narrow detached popovers and the floating toolbar. No backend.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AudioControls, type ControlGroup} from '../../src/components/AudioControls';
import {CaptionToolbar} from '../../src/components/CaptionToolbar';
import {NativeSelectProvider} from '../../src/components/Select';
import {emptySessionContext} from '../../shared/context';
import '../../src/styles.css';
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [group,setGroup]=useState<ControlGroup|null>((params.get('group') as ControlGroup) || null);
  const [translationContext,setTranslationContext]=useState(emptySessionContext);
  const [input,setInput]=useState<'microphone'|'system'|'mixed'>('mixed');
  const [captionMode,setCaptionMode]=useState<'subtitles'|'translate'>('translate');
  const [source,setSource]=useState('en'),[target,setTarget]=useState('zh');
  const [silence,setSilence]=useState({timeoutSeconds:105,thresholdDbfs:-71});
  const [microphoneGain,setMicrophoneGain]=useState(1),[desktopGain,setDesktopGain]=useState(1),[translatedVolume,setTranslatedVolume]=useState(1);
  const [microphoneMuted,setMicrophoneMuted]=useState(false),[desktopMuted,setDesktopMuted]=useState(false),[translatedMuted,setTranslatedMuted]=useState(false);
  const props={input,setInput,captionMode,setCaptionMode,source,setSource,target,setTarget,silence,setSilence,microphoneGain,setMicrophoneGain,desktopGain,setDesktopGain,translatedVolume,setTranslatedVolume,microphoneMuted,setMicrophoneMuted,desktopMuted,setDesktopMuted,translatedMuted,setTranslatedMuted,translationContext,setTranslationContext,active:false,systemAudio:true,applicationAudio:false,platform:'browser',captureSourceId:'all',setCaptureSourceId:()=>{},inputMix:true,translatedPlayback:true};
  if(params.has('detached')) return <NativeSelectProvider><main className="detached-controls" style={{width:Number(params.get('width'))||310,height:360}}><AudioControls {...props} group={group||'context'}/></main></NativeSelectProvider>;
  return <main className={`subtitle-panel ${params.has('mobile')?'mobile-panel':''}`} style={{width:Number(params.get('width'))||760,height:500}}><header className="panel-header">Audeeo</header><div className="page-content"><div className="captions"><p className="translated-caption">Live captions appear here.</p></div></div><CaptionToolbar {...props} open={group} setOpen={setGroup} detached={false}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
