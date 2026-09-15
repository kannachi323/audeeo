import { MonitorUp, ShieldCheck } from "lucide-react";
import type { MobileLiveState } from "../lib/mobileSession";

export function MobileSessionGuide({platform, input, state}: {
  platform: string;
  input: "microphone" | "system";
  state: MobileLiveState;
}) {
  const devicePlayback = input === "system";
  return <section className={`mobile-session-guide ${state.phase}`} aria-label="Mobile live translation status">
    <div className="mobile-session-heading">
      <span className="mobile-session-icon" aria-hidden="true">{devicePlayback ? <MonitorUp/> : <ShieldCheck/>}</span>
      <div>
        <strong>{state.message}</strong>
        <span>{devicePlayback ? "Device playback" : "Microphone"}</span>
      </div>
      <i aria-hidden="true" />
    </div>
    {state.phase === "idle" && <p>
      {platform === "android"
        ? "Start captions, approve Android’s capture prompt, then open the app you want to listen to."
        : devicePlayback
          ? "Start captions, approve Apple’s sharing picker, then turn on Picture in Picture before leaving Audeeo."
          : "Start captions, then turn on Picture in Picture before leaving Audeeo."}
    </p>}
    {state.phase === "error" && <p>{state.error === "NoAudio"
      ? "Play capturable media and keep this session open. Protected or opted-out audio stays private."
      : "Open Audeeo to review the message and try again."}</p>}
  </section>;
}
