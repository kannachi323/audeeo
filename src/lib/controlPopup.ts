import {sessionContext} from "../../shared/context";
import {invoke, isTauri} from "@tauri-apps/api/core";
export const supportsDetachedControls = (platform: string) =>
  isTauri() && (platform === 'windows' || platform === 'macos');
import {WebviewWindow} from '@tauri-apps/api/webviewWindow';
import {type BackgroundThrottlingPolicy, getCurrentWindow} from '@tauri-apps/api/window';
import type {ComponentProps} from 'react';
import {emitTo, listen} from '@tauri-apps/api/event';
import type {AudioControls} from '../components/AudioControls';
export function controlSnapshot(props: ComponentProps<typeof AudioControls>) {
  return {...Object.fromEntries(Object.entries(props).filter(([,value])=>typeof value!=='function')),canCaptureContext:!!props.onFillContextFromScreen,canRefillContext:!!props.onRefillContextFromSession};
}
let serial=Date.now();
let warm: Promise<WebviewWindow> | undefined;
export function warmControlPopup(platform?: string) {
  if (warm) return warm;
  warm=(async()=>{
    let resolve!:()=>void, reject!:(error:unknown)=>void;
    const ready=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    const unlisten=await listen<{label:string}>('controls-ready',({payload})=>{if(payload.label==='controls-popup')resolve();});
    let popup:WebviewWindow|undefined;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try {
      const existing=await WebviewWindow.getByLabel('controls-popup');
      popup=existing ?? new WebviewWindow('controls-popup',{url:'index.html?controls',title:'Audeeo controls',width:310,height:300,decorations:false,resizable:false,skipTaskbar:true,backgroundThrottling:'disabled' as BackgroundThrottlingPolicy,visible:false,focus:false,theme:'dark',backgroundColor:'#232323',
        // An owned popup follows the main window's minimize and z-order state on
        // Windows instead of becoming an unrelated globally-topmost window.
        ...(platform === 'windows' ? {parent:'main'} : {})});
      timeout=setTimeout(()=>reject(new Error('Controls did not load')),3000);
      if(existing) void emitTo('controls-popup','controls-ping',{}).catch(reject);
      else void popup.once('tauri://error',reject).catch(reject);
      await ready; return popup;
    } finally {clearTimeout(timeout);unlisten();}
  })().catch(error=>{warm=undefined;throw error;});
  return warm;
}
export async function openControlPopup(anchor:DOMRect, getProps:()=>ComponentProps<typeof AudioControls>, dismiss:()=>void, signal?:AbortSignal, onError:(error:unknown)=>void = console.error) {
  const main=getCurrentWindow(),label='controls-popup',presentation=++serial;
  const cleanup:(()=>void)[]=[];
  let popup:WebviewWindow|undefined,closed=false;
  const send=()=>closed||signal?.aborted||presentation!==serial ? Promise.resolve() : emitTo(label,'controls-state',{...controlSnapshot(getProps()),_presentation:presentation});
  const dispose=()=>{if(closed)return;closed=true;cleanup.forEach(fn=>fn());
    // React cleans up the previous group before opening the next one. Deferring
    // the hide by one microtask lets that next presentation supersede it, so a
    // toolbar-to-toolbar switch updates the existing surface without flashing.
    queueMicrotask(()=>{if(presentation===serial)void invoke('close_controls_popover');});
  };
  try {
    cleanup.push(await listen<number>('controls-popover-closed',({payload})=>{if(payload===presentation&&!closed&&presentation===serial)dismiss();}));
    cleanup.push(await listen<{label:string;presentation:number}>('controls-dismiss',({payload})=>{if(payload.label===label&&payload.presentation===presentation&&!closed)dismiss();}));
    cleanup.push(await listen<{label:string;presentation:number;key:string;value:unknown}>('controls-change',({payload})=>{
      if(payload.label!==label||closed||payload.presentation!==presentation)return;
      const props=getProps();
      const allowed=['spokenTranslation','input','captureSourceId','captionMode','source','target','silence','microphoneGain','desktopGain','translatedVolume','microphoneMuted','desktopMuted','translatedMuted','translationContext'];
      if(!allowed.includes(payload.key))return;
      if(payload.key==='translationContext') {
        if(props.screenCapturePending)return;
        try { payload.value=sessionContext(payload.value); } catch { return; }
      }
      if(props.active&&['input','captionMode','source','target','silence','translationContext'].includes(payload.key))return;
      const setter=props[('set'+payload.key[0].toUpperCase()+payload.key.slice(1)) as keyof typeof props];
      if(typeof setter==='function') (setter as (value:unknown)=>void)(payload.value);
    }));
    cleanup.push(await listen<{label:string;presentation:number}>('controls-context-capture',({payload})=>{
      if(payload.label!==label || payload.presentation!==presentation || closed) return;
      const props=getProps();
      if(!props.active && !props.screenCapturePending) props.onFillContextFromScreen?.();
    }));
    cleanup.push(await listen<{label:string;presentation:number;id:string}>('controls-context-refill',({payload})=>{
      if(payload.label!==label || payload.presentation!==presentation || closed) return;
      const props=getProps();
      if(!props.active && !props.screenCapturePending && (props.refillContextStatus ?? 'ready')==='ready' && props.refillContextSessions?.some(item=>item.id===payload.id && !item.disabled)) props.onRefillContextFromSession?.(payload.id);
    }));
    popup=await warmControlPopup(getProps().platform);
    if(signal?.aborted||presentation!==serial){dispose();return {dispose,send};}
    let receivedFocus=false;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    cleanup.push(()=>clearTimeout(blurTimer));
    cleanup.push(await popup.onFocusChanged(({payload})=>{
      if(payload) {
        receivedFocus=true;
        clearTimeout(blurTimer);
      } else if(receivedFocus&&!closed&&presentation===serial) {
        // A toolbar click blurs the detached window before React receives the
        // click. Defer dismissal so clicking the active trigger can close it
        // instead of racing into an immediate reopen.
        blurTimer=setTimeout(()=>{if(!closed&&presentation===serial)dismiss();},0);
      }
    }));
    const failed=(error:unknown)=>{if(!closed && !signal?.aborted && presentation===serial){dispose();onError(error);}};
    let rendered=false;
    // A hidden or reloaded document can miss the first state event. Retry until
    // it acknowledges rendering; never leave a trigger open with no visible UI.
    const retry=setInterval(()=>{if(!rendered)void send().catch(failed);},300);
    const renderTimeout=setTimeout(()=>failed(new Error('Controls did not render')),3000);
    cleanup.push(()=>{clearInterval(retry);clearTimeout(renderTimeout);});
    // AppKit presents only after the controls webview has committed its React tree.
    let lastContentHeight:number|undefined;
    cleanup.push(await listen<{presentation:number;contentHeight:number}>('controls-rendered',({payload})=>{
      if(payload.presentation!==presentation||closed||signal?.aborted)return;
      rendered=true;clearInterval(retry);clearTimeout(renderTimeout);
      const contentHeight=Math.max(80,Math.min(600,payload.contentHeight || 300));
      if(contentHeight===lastContentHeight)return;
      lastContentHeight=contentHeight;
      void invoke('show_controls_popover', {presentation,x:anchor.left,y:anchor.top,width:anchor.width,height:anchor.height,
        contentHeight}).catch(failed);
    }));
    // A controls document can reload independently (including during HMR).
    // Replay state after it registers its fresh listeners instead of leaving an
    // already-visible native popover with an empty React root.
    cleanup.push(await listen<{label:string}>('controls-ready',({payload})=>{
      if(payload.label===label) void send().catch(()=>{});
    }));
    await send();
    cleanup.push(await main.onMoved(()=>dismiss()));
    cleanup.push(await main.onResized(()=>dismiss()));
    return {dispose,send};
  } catch(error){dispose();throw error;}
}
