/** Browser fallback; macOS source capture and both Mac outputs remain native. */
export class BrowserPlayback {
  private context?: AudioContext;
  private gain?: GainNode;
  private tail = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private volume = 1;
  constructor(private activity: (value: boolean) => void) {}
  async prepare() {
    if (!this.context) { this.context = new AudioContext({sampleRate:24000}); this.gain=this.context.createGain(); this.gain.gain.value=this.volume; this.gain.connect(this.context.destination); }
    await this.context.resume();
  }
  setVolume(value: number) { this.volume=value; if(this.gain)this.gain.gain.value=value; }
  enqueue(base64: string) {
    const context=this.context;if(!context||!this.gain)throw new Error('Audio playback is unavailable. Start the session again.');
    const bytes=Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
    if(bytes.length%2)throw new Error('Invalid PCM audio');
    const frames=bytes.length/2;
    if(Math.max(context.currentTime,this.tail)+frames/24000-context.currentTime>60)throw new Error('Translated audio buffer is full. Restart the session.');
    const buffer=context.createBuffer(1,frames,24000), samples=buffer.getChannelData(0), view=new DataView(bytes.buffer);
    for(let i=0;i<frames;i++)samples[i]=view.getInt16(i*2,true)/32768;
    const node=context.createBufferSource();node.buffer=buffer;node.connect(this.gain);
    node.onended=()=>{node.disconnect();this.nodes.delete(node);if(!this.nodes.size)this.activity(false)};
    this.nodes.add(node);const start=Math.max(this.tail,context.currentTime);this.tail=start+buffer.duration;node.start(start);this.activity(true);
  }
  stop() { for(const node of this.nodes){node.onended=null;node.stop();node.disconnect()}this.nodes.clear();this.tail=0;this.activity(false); }
  dispose() { this.stop();void this.context?.close();this.context=undefined;this.gain=undefined; }
}
