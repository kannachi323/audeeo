import { describe, expect, it } from "vitest";
import { classifyMobileError, initialMobileLiveState, mobileLiveReducer } from "../src/lib/mobileSession";

describe("mobile live session state", () => {
  it("exposes permission, audio, translation, and stopping states", () => {
    let state = mobileLiveReducer(initialMobileLiveState, { type: "permission" });
    expect(state.phase).toBe("requestingPermission");
    state = mobileLiveReducer(state, { type: "native", state: "waitingForAudio", message: "waiting" });
    expect(state.phase).toBe("waitingForAudio");
    state = mobileLiveReducer(state, { type: "translation" });
    expect(state.message).toBe("Translating live");
    expect(mobileLiveReducer(state, { type: "stopping" }).phase).toBe("stopping");
  });

  it("classifies permission, source-policy, network, and capture failures", () => {
    expect(classifyMobileError("Capture was not authorized")).toBe("PermissionDenied");
    expect(classifyMobileError("Source opted out")).toBe("ProtectedContent");
    expect(classifyMobileError("Network connection ended")).toBe("NetworkError");
    expect(classifyMobileError("Audio route interrupted")).toBe("CaptureEnded");
  });
});
