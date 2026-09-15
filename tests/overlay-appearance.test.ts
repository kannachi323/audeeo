import { describe, expect, it } from "vitest";
import { defaultOverlayAppearance, loadOverlayAppearance } from "../src/lib/overlayAppearance";

function storage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
  } as Storage;
}

describe("overlay appearance preferences", () => {
  it("defaults to a genuinely borderless transparent overlay", () => {
    expect(loadOverlayAppearance(storage())).toMatchObject({
      panelWidth: 720,
      backgroundOpacity: 0,
      borderOpacity: 0,
      borderWidth: 0,
    });
  });

  it("migrates the old solid mode and caption size", () => {
    expect(loadOverlayAppearance(storage({
      "audeeo.overlay-style": "panel",
      "audeeo.caption-size": "32",
    }))).toMatchObject({backgroundOpacity: 1, borderOpacity: 1, borderWidth: 1, fontSize: 32});
  });

  it("sanitizes malformed and out-of-range saved values", () => {
    const result = loadOverlayAppearance(storage({
      "audeeo.overlay-appearance": JSON.stringify({
        backgroundColor: "not-a-color", panelWidth: 9999, borderWidth: 99, overlayOpacity: -2,
        fontSize: "large", fontFamily: "fantasy",
      }),
    }));
    expect(result.backgroundColor).toBe(defaultOverlayAppearance.backgroundColor);
    expect(result.panelWidth).toBe(3840);
    expect(result.borderWidth).toBe(8);
    expect(result.overlayOpacity).toBe(0);
    expect(result.fontSize).toBe(24);
    expect(result.fontFamily).toBe("system");
  });

  it("never requests a width below the native desktop minimum", () => {
    const result = loadOverlayAppearance(storage({
      "audeeo.overlay-appearance": JSON.stringify({panelWidth: 320}),
    }));
    expect(result.panelWidth).toBe(480);
  });
});
