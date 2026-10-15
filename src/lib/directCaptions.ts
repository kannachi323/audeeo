import NativeSocket, { type Message } from '@tauri-apps/plugin-websocket';
import { DirectCaptionClient as CoreDirectCaptionClient } from '../../packages/core/src';
import { formatChineseSegment, isChineseScriptConversion } from '../../shared/chinese';
import { defaultSilence, type SilenceSettings } from '../../shared/silence';
import type { Language, Segment } from '../../shared/pipeline';
import { hasSessionContext, sonioxContext, type SessionContext } from '../../shared/context';
import type { SessionBillingOptions } from '../../shared/minutePacks';
import type { CaptionConnection, RelayEvent } from './realtime';
import type { ProviderId } from './providers';

export interface ProviderSocket {
  addListener(callback:(message:Message)=>void):()=>void;
  send(data:string|number[]):Promise<void>;
  disconnect():Promise<void>;
}
export type SocketFactory = (url:string,config?:{headers?:Record<string,string>})=>Promise<ProviderSocket>;

const nativeSocket:SocketFactory=(url,config)=>NativeSocket.connect(url,{...config,writeBufferSize:0,maxWriteBufferSize:256000,maxMessageSize:2*1024*1024});

/** Desktop-only BYOK. The socket connects to the provider, never Audeeo's relay. */
export class DirectCaptionClient extends CoreDirectCaptionClient implements CaptionConnection {
  private relayEmit:(event:RelayEvent)=>void;
  constructor(provider:ProviderId,key:string,emit:(event:RelayEvent)=>void,connectSocket:SocketFactory=nativeSocket) {
    super(provider,key,emit,connectSocket as never);
    this.relayEmit=emit;
  }
  async connect(_token:string,source:Language,target:Language,silence:SilenceSettings=defaultSilence,billing?:SessionBillingOptions,context?:SessionContext) {
    await this.start(source,target,{
      silence,voice:!!billing?.voiceEnabled,
      context:context&&hasSessionContext(context)?sonioxContext(context):undefined,
      translates:(s,t)=>s!==t&&!isChineseScriptConversion(s,t),
      format:segment=>formatChineseSegment(segment as Segment),
    });
  }
  control(message:{type:'voice';enabled:boolean}|{type:'use_packs'}) {
    if(message.type!=='voice')return;
    const voiceEnabled=this.setVoice(message.enabled);
    // BYOK has no Audeeo allowance or metering; this acknowledges a playback change only.
    this.relayEmit({type:'billing',voiceEnabled,rate:1,paused:false,allowPurchasedMinutes:false});
  }
}
