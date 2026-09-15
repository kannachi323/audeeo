import {invoke, isTauri} from "@tauri-apps/api/core";
export const supportsDetachedControls = (platform: string) =>
  isTauri() && (platform === 'windows' || platform === 'macos');
import {WebviewWindow} from '@tauri-apps/api/webviewWindow';
import {type BackgroundThrottlingPolicy, getCurrentWindow} from '@tauri-apps/api/window';
import type {ComponentProps} from 'react';
import {emitTo, listen} from '@tauri-apps/api/event';
import type {AudioControls} from '../components/AudioControls';
export function controlSnapshot(props: ComponentProps<typeof AudioControls>) {
  return Object.fromEntries(Object.entries(props).filter(([,value])=>typeof value!=='function'));
}
let serial=0;
let warm: Promise<WebviewWindow> | undefined;
export function warmControlPopup(platform?: string) {
  if (warm) return warm;
  warm=(async()=>{
    let resolve!:()=>void, reject!:(error:unknown)=>void;
    const ready=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    const unlisten=await listen<{label:string}>('controls-ready',({payload})=>{if(payload.label==='controls-popup')resolve();});
    const popup=new WebviewWindow('controls-popup',{url:'index.html?controls',title:'Audeeo controls',width:310,height:300,decorations:false,resizable:false,skipTaskbar:true,backgroundThrottling:'disabled' as BackgroundThrottlingPolicy,visible:false,focus:false,theme:'dark',backgroundColor:'#232323',
      // An owned popup follows the main window's minimize and z-order state on
      // Windows instead of becoming an unrelated globally-topmost window.
      ...(platform === 'windows' ? {parent:'main'} : {})});
    const timeout=setTimeout(()=>reject(new Error('Controls did not load')),15000);
    void popup.once('tauri://error',reject);
    try { await ready; return popup; }
    catch(error){void popup.destroy();warm=undefined;throw error;}
    finally{clearTimeout(timeout);unlisten();}
  })();
  return warm;
}
export async function openControlPopup(anchor:DOMRect, getProps:()=>ComponentProps<typeof AudioControls>, dismiss:()=>void, signal?:AbortSignal) {
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
    cleanup.push(await listen<{label:string;key:string;value:unknown}>('controls-change',({payload})=>{
      if(payload.label!==label||closed)return;
      const props=getProps();
      const allowed=['input','captureSourceId','captionMode','source','target','silence','microphoneGain','desktopGain','translatedVolume','microphoneMuted','desktopMuted','translatedMuted'];
      if(!allowed.includes(payload.key))return;
      if(props.active&&['input','captionMode','source','target','silence'].includes(payload.key))return;
      const setter=props[('set'+payload.key[0].toUpperCase()+payload.key.slice(1)) as keyof typeof props];
      if(typeof setter==='function') (setter as (value:unknown)=>void)(payload.value);
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
    // AppKit presents only after the controls webview has committed its React tree.
    let lastContentHeight:number|undefined;
    cleanup.push(await listen<{presentation:number;contentHeight:number}>('controls-rendered',({payload})=>{
      if(payload.presentation!==presentation||closed||signal?.aborted)return;
      const contentHeight=Math.max(80,Math.min(600,payload.contentHeight || 300));
      if(contentHeight===lastContentHeight)return;
      lastContentHeight=contentHeight;
      void invoke('show_controls_popover', {presentation,x:anchor.left,y:anchor.top,width:anchor.width,height:anchor.height,
        contentHeight});
    }));
    await send();
    cleanup.push(await main.onMoved(()=>dismiss()));
    cleanup.push(await main.onResized(()=>dismiss()));
    return {dispose,send};
  } catch(error){dispose();throw error;}
}
