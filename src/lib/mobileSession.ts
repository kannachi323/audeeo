export type MobileLivePhase =
  | "idle"
  | "requestingPermission"
  | "startingCapture"
  | "connectingModel"
  | "waitingForAudio"
  | "audioDetected"
  | "translating"
  | "stopping"
  | "error";

export type MobileLiveError =
  | "PermissionDenied"
  | "CaptureUnavailable"
  | "ProtectedContent"
  | "NoAudio"
  | "NetworkError"
  | "ModelError"
  | "CaptureEnded";

export type MobileLiveState = {
  phase: MobileLivePhase;
  message: string;
  error?: MobileLiveError;
};

export type MobileLiveAction =
  | { type: "permission" }
  | { type: "capture" }
  | { type: "model" }
  | { type: "waiting" }
  | { type: "audio" }
  | { type: "translation" }
  | { type: "stopping" }
  | { type: "idle" }
  | { type: "native"; state: string; message: string }
  | { type: "failed"; error: MobileLiveError; message: string };

export const initialMobileLiveState: MobileLiveState = {
  phase: "idle",
  message: "Not capturing",
};

const nativePhases: Record<string, MobileLiveState> = {
  waitingForAudio: { phase: "waitingForAudio", message: "Waiting for device audio" },
  audioDetected: { phase: "audioDetected", message: "Device audio detected" },
  noAudio: { phase: "error", error: "NoAudio", message: "No capturable audio" },
  stopping: { phase: "stopping", message: "Finishing captions" },
};

export function mobileLiveReducer(_state: MobileLiveState, action: MobileLiveAction): MobileLiveState {
  switch (action.type) {
    case "permission": return { phase: "requestingPermission", message: "Waiting for permission" };
    case "capture": return { phase: "startingCapture", message: "Starting device capture" };
    case "model": return { phase: "connectingModel", message: "Connecting translation" };
    case "waiting": return { phase: "waitingForAudio", message: "Waiting for audio" };
    case "audio": return { phase: "audioDetected", message: "Audio detected" };
    case "translation": return { phase: "translating", message: "Translating live" };
    case "stopping": return { phase: "stopping", message: "Finishing captions" };
    case "idle": return initialMobileLiveState;
    case "native": return nativePhases[action.state] ?? { phase: "waitingForAudio", message: action.message };
    case "failed": return { phase: "error", error: action.error, message: action.message };
  }
}

export function classifyMobileError(message: string): MobileLiveError {
  const value = message.toLowerCase();
  if (value.includes("permission") || value.includes("authorized") || value.includes("allow ")) return "PermissionDenied";
  if (value.includes("protected") || value.includes("opted out")) return "ProtectedContent";
  if (value.includes("network") || value.includes("connection") || value.includes("upload")) return "NetworkError";
  if (value.includes("ended") || value.includes("interrupted")) return "CaptureEnded";
  if (value.includes("audio") || value.includes("capture")) return "CaptureUnavailable";
  return "ModelError";
}
