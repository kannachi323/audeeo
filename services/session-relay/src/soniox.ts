import { RealtimeSttSession } from '@soniox/node';
import type { Language, Segment } from '../../../shared/pipeline';
import type { SessionContext } from '../../../shared/context';
import { SonioxCaptions, sonioxConfig } from '../../../shared/sonioxCaptions';
export { SonioxCaptions, sonioxConfig } from '../../../shared/sonioxCaptions';

export class SonioxBackend {
  private session: RealtimeSttSession;
  readonly captions: SonioxCaptions;
  constructor(key: string, sessionId: string, source: Language, target: Language,
    emit: (s: Segment) => void, onError: (message: string) => void, onFinished: () => void,
    model?: string, context?: SessionContext) {
    this.captions = new SonioxCaptions(sessionId, source, target, emit);
    this.session = new RealtimeSttSession(key, 'wss://stt-rt.soniox.com/transcribe-websocket',
      sonioxConfig(source, target, model, context), {connect_timeout_ms: 10000});
    this.session.on('result', result => this.captions.ingest(result, result.total_audio_proc_ms));
    this.session.on('endpoint', () => this.captions.flush());
    this.session.on('finished', onFinished);
    // Do not forward SDK exceptions, which can contain raw provider responses.
    this.session.on('error', () => onError('Soniox session failed. Check the server key, credits, model and language support.'));
  }
  async connect() {
    try { await this.session.connect(); }
    catch { throw new Error('Soniox could not connect. Check the server key and network.'); }
  }
  sendAudio(audio: ArrayBuffer | ArrayBufferView) {
    this.session.sendAudio(ArrayBuffer.isView(audio)
      ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) : new Uint8Array(audio));
  }
  finish() { return this.session.finish(); }
  close() { this.session.close(); }
}
