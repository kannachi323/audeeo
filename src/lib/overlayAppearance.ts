export type OverlayFont = "system" | "sans" | "serif" | "mono";

export type OverlayAppearance = {
  panelWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
  borderColor: string;
  borderOpacity: number;
  borderWidth: number;
  borderRadius: number;
  textColor: string;
  sourceTextColor: string;
  textOpacity: number;
  fontFamily: OverlayFont;
  fontSize: number;
  fontWeight: number;
  controlsOpacity: number;
  overlayOpacity: number;
};

export const MIN_OVERLAY_WIDTH = 480;
export const MAX_OVERLAY_WIDTH = 3840;

export const defaultOverlayAppearance: OverlayAppearance = {
  panelWidth: 720,
  backgroundColor: "#191919",
  backgroundOpacity: 0,
  borderColor: "#3b3b3b",
  borderOpacity: 0,
  borderWidth: 0,
  borderRadius: 20,
  textColor: "#f1f1f1",
  sourceTextColor: "#adadad",
  textOpacity: 1,
  fontFamily: "system",
  fontSize: 24,
  fontWeight: 400,
  controlsOpacity: 1,
  overlayOpacity: 1,
};

const limits: Partial<Record<keyof OverlayAppearance, [number, number]>> = {
  panelWidth: [MIN_OVERLAY_WIDTH, MAX_OVERLAY_WIDTH],
  backgroundOpacity: [0, 1], borderOpacity: [0, 1], borderWidth: [0, 8],
  borderRadius: [0, 40], textOpacity: [0, 1], fontSize: [18, 48],
  fontWeight: [300, 800], controlsOpacity: [0, 1], overlayOpacity: [0, 1],
};

const color = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export function loadOverlayAppearance(storage: Storage): OverlayAppearance {
  const legacyPanel = storage.getItem("audeeo.overlay-style") === "panel";
  const legacySize = Number(storage.getItem("audeeo.caption-size"));
  const fallback: OverlayAppearance = {
    ...defaultOverlayAppearance,
    backgroundOpacity: legacyPanel ? 1 : 0,
    borderOpacity: legacyPanel ? 1 : 0,
    borderWidth: legacyPanel ? 1 : 0,
    fontSize: Number.isFinite(legacySize) && legacySize > 0 ? legacySize : 24,
  };
  let saved: Partial<OverlayAppearance> = {};
  try { saved = JSON.parse(storage.getItem("audeeo.overlay-appearance") || "{}"); }
  catch { /* Ignore corrupt preferences and keep usable defaults. */ }
  const result = {...fallback, ...saved};
  for (const [key, [min, max]] of Object.entries(limits) as [keyof OverlayAppearance, [number, number]][]) {
    const value = Number(result[key]);
    (result as unknown as Record<keyof OverlayAppearance, unknown>)[key] = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback[key];
  }
  result.backgroundColor = color(result.backgroundColor, fallback.backgroundColor);
  result.borderColor = color(result.borderColor, fallback.borderColor);
  result.textColor = color(result.textColor, fallback.textColor);
  result.sourceTextColor = color(result.sourceTextColor, fallback.sourceTextColor);
  if (!["system", "sans", "serif", "mono"].includes(result.fontFamily)) result.fontFamily = "system";
  return result;
}

export const overlayFontStacks: Record<OverlayFont, string> = {
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  sans: "Arial, Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Consolas, monospace",
};

export function colorWithOpacity(hex: string, opacity: number) {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0");
  return `${hex}${alpha}`;
}
