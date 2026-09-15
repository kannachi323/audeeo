import { expect, it } from "vitest";
import capabilities from "../src-tauri/capabilities/default.json";
import configuration from "../src-tauri/tauri.conf.json";

it("allows the borderless main window to begin native move and resize drags", () => {
  expect(capabilities.windows).toContain("main");
  expect(capabilities.permissions).toEqual(expect.arrayContaining([
    "core:window:allow-start-dragging",
    "core:window:allow-start-resize-dragging",
  ]));
});

it("keeps a safe minimum width without capping desktop expansion", () => {
  const main = configuration.app.windows.find(window => window.label === "main");
  expect(main?.minWidth).toBe(480);
  expect(main).not.toHaveProperty("maxWidth");
  expect(main?.decorations).toBe(true);
  expect(main?.shadow).toBe(true);
});
