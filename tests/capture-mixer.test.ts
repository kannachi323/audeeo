import { describe, expect, it } from "vitest";
import { PcmFrameMixer } from "../src/lib/captureMixer";

describe("desktop PCM input mixing", () => {
  it("mixes microphone and playback into one 20 ms model frame", () => {
    const mixer = new PcmFrameMixer({ microphone: 0.5, system: 0.25 });
    mixer.push("microphone", new Int16Array(320).fill(8_000));
    mixer.push("system", new Int16Array(320).fill(4_000));
    expect([...mixer.renderFrame()]).toEqual(new Array(320).fill(5_000));
  });

  it("virtually mutes either input without changing the other", () => {
    const mixer = new PcmFrameMixer({ microphone: 0, system: 1 });
    mixer.push("microphone", new Int16Array(320).fill(12_000));
    mixer.push("system", new Int16Array(320).fill(-2_000));
    expect([...mixer.renderFrame()]).toEqual(new Array(320).fill(-2_000));

    mixer.setGains({ microphone: 1, system: 0 });
    mixer.push("microphone", new Int16Array(320).fill(3_000));
    mixer.push("system", new Int16Array(320).fill(20_000));
    expect([...mixer.renderFrame()]).toEqual(new Array(320).fill(3_000));
  });

  it("pads capture underruns with silence and limits summed peaks", () => {
    const mixer = new PcmFrameMixer({ microphone: 1, system: 1 });
    mixer.push("microphone", new Int16Array(160).fill(30_000));
    mixer.push("system", new Int16Array(320).fill(30_000));
    const frame = mixer.renderFrame();
    expect(frame[0]).toBe(32_767);
    expect(frame[159]).toBe(32_767);
    expect(frame[160]).toBe(16_384);
    expect(frame).toHaveLength(320);
  });
});
