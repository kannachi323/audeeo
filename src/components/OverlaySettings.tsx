import { Button } from "./Button";
export function OverlaySettings({
  overlayStyle,
  setOverlayStyle,
  size,
  setSize,
  showSource,
  setShowSource,
  autoHide,
  setAutoHide,
  opaque,
  setOpaque,
}: {
  overlayStyle: "transparent" | "panel";
  setOverlayStyle: (value: "transparent" | "panel") => void;
  size: number;
  setSize: (value: number) => void;
  showSource: boolean;
  setShowSource: (value: boolean) => void;
  autoHide: boolean;
  setAutoHide: (value: boolean) => void;
  opaque: boolean;
  setOpaque: (value: boolean) => void;
}) {
  return (
    <section className="settings-body" aria-label="Overlay appearance">
      <div className="setting-group">
        <h2>When captions are running</h2>
        <div
          className="overlay-options"
          role="group"
          aria-label="Overlay style"
        >
          <Button
            variant="outline"
            aria-pressed={overlayStyle === "transparent"}
            onClick={() => setOverlayStyle("transparent")}
          >
            <span
              aria-hidden="true"
              className="appearance-swatch transparent-swatch"
            >
              Aa
            </span>
            Transparent
          </Button>
          <Button
            variant="outline"
            aria-pressed={overlayStyle === "panel"}
            onClick={() => setOverlayStyle("panel")}
          >
            <span aria-hidden="true" className="appearance-swatch solid-swatch">
              Aa
            </span>
            Solid panel
          </Button>
        </div>
        <small>
          {overlayStyle === "transparent"
            ? "Only subtitles remain over your screen. Hover to reveal controls."
            : "Keep a charcoal background behind your subtitles."}
        </small>
      </div>
      <div className="setting-group">
        <div className="setting-heading">
          <label htmlFor="caption-size">Caption size</label>
          <output htmlFor="caption-size">{size}px</output>
        </div>
        <input
          id="caption-size"
          type="range"
          min="18"
          max="40"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
        <p className="size-preview" style={{ fontSize: size }}>
          Every word, clearly.
        </p>
      </div>
      <div className="setting-group">
        <label className="setting-toggle">
          <span>Show original text</span>
          <input
            type="checkbox"
            checked={showSource}
            onChange={(e) => setShowSource(e.target.checked)}
          />
        </label>
      </div>
      <div className="setting-group">
        <label className="setting-toggle">
          <span>
            Hide controls while listening
            <small>Controls return on hover or keyboard focus.</small>
          </span>
          <input
            type="checkbox"
            checked={autoHide}
            onChange={(e) => setAutoHide(e.target.checked)}
          />
        </label>
      </div>
      <div className="setting-group">
        <label className="setting-toggle">
          <span>
            Reduce transparency
            <small>
              Always use a solid background for readability. System
              accessibility settings are also respected.
            </small>
          </span>
          <input
            type="checkbox"
            checked={opaque}
            onChange={(e) => setOpaque(e.target.checked)}
          />
        </label>
      </div>
    </section>
  );
}
