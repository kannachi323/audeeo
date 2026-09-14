import {ProviderIcon} from "./components/ProviderIcon";
import {CaptureStatus} from "./components/CaptureStatus";
import {languageName, isTranslationSource, isTranscriptionLanguage} from "../shared/languages";
import { Subscriptions } from "./components/Subscriptions";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useEffect, useRef, useState, useReducer } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AudioLines,
  ArrowLeft,
  ChevronDown,
  History,
  Settings2,
  Download,
  Trash2,
  PictureInPicture2,
  X,
  UserRound,
  LogOut,
  GripHorizontal,
} from "lucide-react";
import { Button } from "./components/Button";
import { silenceSettings } from "../shared/silence";
import type { ControlGroup } from "./components/AudioControls";
import { CaptionToolbar } from "./components/CaptionToolbar";
import { OverlaySettings } from "./components/OverlaySettings";
import {
  BrowserMicrophone,
  NativeCapture,
  capabilities,
  type AudioInput,
  type Capabilities,
} from "./lib/platform";
import {
  RealtimeTranslationClient,
  NativeRelayClient,
  type CaptionConnection,
  type ProviderCredentials,
  type RelayEvent,
} from "./lib/realtime";
import {
  supabase,
  signIn,
  listenForAuth,
  historyRemote,
  listHistory,
  relayURL,
  accountRequest,
} from "./lib/account";
import { HistoryOutbox } from "../shared/history";
import type { Language, Segment } from "../shared/pipeline";
import { startNativePip } from "./lib/pip";

import { BrowserPlayback } from "./lib/playback";
import { LiveCaptions } from "./components/LiveCaptions";
import { initialPresentation, presentationReducer, isOverlay, type Page, type SessionPhase as Status } from "./lib/presentation";
const messages = {
  idle: "Ready to listen",
  connecting: "Connecting…",
  live: "Listening",
  stopping: "Finishing captions…",
};
export default function App() {
  const [silence, setSilence] = useState(() => {
    try { return silenceSettings(JSON.parse(localStorage.getItem("audeeo.silence") || "null")); }
    catch { return silenceSettings(null); }
  });
  useEffect(() => { localStorage.setItem("audeeo.silence", JSON.stringify(silence)); }, [silence]);
  const [captionMode, setCaptionMode] = useState<"subtitles" | "translate">("subtitles");
  const [presentation, dispatch] = useReducer(presentationReducer, initialPresentation);
  const {phase: status, page: view, playing} = presentation;
  const setStatus = (value: Status) => dispatch({type: 'phase', value});
  const setView = (value: Page) => dispatch({type: 'page', value});
  const overlay = isOverlay(presentation);
  const browserPlayback = useRef<BrowserPlayback | undefined>(undefined);
  browserPlayback.current ??= new BrowserPlayback(value=>dispatch({type:"playing",value}));
  const [audioOpen, setAudioOpen] = useState<ControlGroup | null>(null);
  const [sourceVolume, setSourceVolume] = useState(1);
  const [translatedVolume, setTranslatedVolume] = useState(1);
  const [sourceMuted, setSourceMuted] = useState(false);
  const [translatedMuted, setTranslatedMuted] = useState(false);
  const expanded = view !== "captions";
  const [overlayStyle, setOverlayStyle] = useState<"transparent" | "panel">(
    () =>
      localStorage.getItem("audeeo.overlay-style") === "panel"
        ? "panel"
        : "transparent",
  );
  const [showSource, setShowSource] = useState(
    () => localStorage.getItem("audeeo.show-source") !== "false",
  );
  const [autoHide, setAutoHide] = useState(
    () => localStorage.getItem("audeeo.auto-hide") !== "false",
  );
  const [authPending, setAuthPending] = useState(false);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const pageHeading = useRef<HTMLHeadingElement | null>(null);
  const settingsBack = useRef<HTMLButtonElement | null>(null);
  const [session, setSession] = useState<Session | null>(null),
    [issue, setIssue] = useState("");
  const [caps, setCaps] = useState<Capabilities>({
    platform: "browser",
    microphone: false,
    systemAudio: false,
    globalOverlay: false,
  });
  const [input, setInput] = useState<"microphone" | "system">("microphone"),
    [source, updateSource] = useState<Language>("zh");
  const [translationTarget, setTarget] = useState<Language>("en");
  const setSource = (value: Language) => {
    updateSource(value);
    if (value === translationTarget) setTarget(value === "en" ? "zh" : "en");
  };
  useEffect(() => {
    if (!(captionMode === "translate" ? isTranslationSource(source) : isTranscriptionLanguage(source))) updateSource("auto");
  }, [captionMode, source]);
  const [save, setSave] = useState(true),
    [size, setSize] = useState(() =>
      Math.max(
        18,
        Math.min(40, Number(localStorage.getItem("audeeo.caption-size")) || 24),
      ),
    );
  const [opaque, setOpaque] = useState(
    () => localStorage.getItem("audeeo.opaque") === "true",
  );
  const [segments, setSegments] = useState<Segment[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [syncState, setSyncState] = useState("");
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [billingPending, setBillingPending] = useState(false);
  const [ownProvider, setOwnProvider] = useState<ProviderCredentials["provider"]>("openai");
  const [ownProviderKey, setOwnProviderKey] = useState("");
  const owner = useRef<string | undefined>(undefined),
    outbox = useRef<HistoryOutbox | undefined>(undefined);
  const client = useRef<CaptionConnection | undefined>(undefined),
    capture = useRef<AudioInput | undefined>(undefined),
    generation = useRef(0);
  const active = status !== "idle" || playing,
    target: Language = captionMode === "subtitles" ? source : translationTarget;
  const latest = segments.at(-1);
  const translated = [...segments]
    .reverse()
    .find((s) => !!s.translatedText);
  const sync = async () => {
    try {
      const box = outbox.current;
      if (isTauri() && box) {
        const snapshots = await invoke<string>("native_history_get", {
          owner: box.owner,
        });
        for (const segment of JSON.parse(snapshots) as Segment[])
          box.enqueue(segment);
        await invoke("native_history_ack", { owner: box.owner, snapshots });
      }
      await box?.flush();
      setSyncState(
        outbox.current?.pending ? "Waiting to sync" : "History synced",
      );
    } catch {
      setSyncState("Saved on this device · waiting to sync");
    }
  };
  useEffect(() => {
    // Remove the prototype's consumer credential storage without reading or exposing its value.
    localStorage.removeItem("audeeo_api_key");
    void capabilities()
      .then(setCaps)
      .catch(() =>
        setIssue("Native capabilities could not be loaded. Restart Audeeo."),
      );
    let unlisten: undefined | (() => void);
    void listenForAuth((error) => {
      setAuthPending(false);
      if (error) setIssue(error);
    }).then((f) => {
      unlisten = f;
    });
    const update = (next: Session | null) => {
      if (owner.current && owner.current !== next?.user.id) {
        void capture.current?.stop();
        void client.current?.finish();
        generation.current++;
        setSegments([]);
        setHistory([]);
        setStatus("idle");
      }
      owner.current = next?.user.id;
      setSession(next);
      setAuthPending(false);
      if (!next && isTauri()) {
        void invoke("audio_output", {command:{stop:true}}).catch(()=>undefined);
        dispatch({type:"playing",value:false});
      }
      outbox.current = next
        ? new HistoryOutbox(
            next.user.id,
            localStorage,
            historyRemote,
            () => owner.current,
          )
        : undefined;
      // Supabase auth callbacks run under an auth lock; sync reads the session.
      setTimeout(() => void sync(), 0);
    };
    void supabase?.auth.getSession().then(({ data, error }) => {
      if (error) { setIssue(error.message); return; }
      update(data.session);
    }).catch(error => setIssue(error instanceof Error ? error.message : String(error)));
    const subscription = supabase?.auth.onAuthStateChange((_event, s) =>
      update(s),
    );
    const online = () => void sync();
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", online);
    return () => {
      unlisten?.();
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", online);
      void capture.current?.stop();
      void client.current?.finish();
      browserPlayback.current?.dispose();
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("audeeo.caption-size", String(size));
    localStorage.setItem("audeeo.opaque", String(opaque));
    localStorage.setItem("audeeo.overlay-style", overlayStyle);
    localStorage.setItem("audeeo.show-source", String(showSource));
    localStorage.setItem("audeeo.auto-hide", String(autoHide));
    if (caps.nativePip)
      void invoke("update_overlay", {
        source: latest?.sourceText || (captionMode === "translate" ? "" : "Ready to listen"),
        translation: translated?.translatedText || "",
        size,
        opaque,
        recording: status === "live",
        preferences: {
          style: overlayStyle,
          showSource: captionMode === "subtitles" || showSource,
          autoHide,
          status,
          direction:
            captionMode === "subtitles" ? `${languageName(source)} subtitles` : `${languageName(source)} → ${languageName(target)}`,
          message: issue,
          authenticated: !!session,
        },
      });
  }, [
    latest,
    translated,
    size,
    opaque,
    caps.globalOverlay,
    caps.nativePip,
    status,
    overlayStyle,
    showSource,
    autoHide,
    source,
    target,
    captionMode,
    issue,
    session,
  ]);
  useEffect(() => {
    if (caps.platform === "macos")
      void invoke("resize_main_window", {
        height: expanded ? 500 : 224,
      }).catch(() =>
        setIssue("The window couldn’t resize. You can resize it from an edge."),
      );
  }, [expanded, caps.platform]);
  useEffect(() => {
    if (caps.platform !== 'macos') return;
    void invoke('set_window_mode', {overlay, clear: overlay && !expanded && overlayStyle === 'transparent' && !opaque});
  }, [overlay, expanded, overlayStyle, opaque, caps.platform]);
  useEffect(() => {
    if (caps.platform !== 'macos' && !caps.nativeSession) { browserPlayback.current?.setVolume(translatedMuted ? 0 : translatedVolume); return; }
    void invoke('audio_output', {command: {sourceVolume: sourceMuted ? 0 : sourceVolume, volume: translatedMuted ? 0 : translatedVolume}});
  }, [sourceVolume, translatedVolume, sourceMuted, translatedMuted, caps.platform]);
  useEffect(() => {
    if (caps.platform !== 'macos' && !caps.nativeSession) return;
    let disposed = false, unlisten: (() => void) | undefined;
    void listen<number>('playback-state', ({payload}) => {
      dispatch({type: 'playing', value: payload > 0});
      if (payload < 0) { setIssue('Audio playback stopped after a device change or buffer overflow. Restart captions.'); void stopCurrent.current(); }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; unlisten?.(); void invoke('audio_output', {command:{stop:true}}); };
  }, [caps.platform]);
  useEffect(() => {
    if (expanded) {
      if (view === "settings") pageHeading.current?.focus();
      else settingsBack.current?.focus();
    }
  }, [view]);
  function openPage(
    next: Exclude<Page, 'captions'>,
  ) {
    setAudioOpen(null);
    if (!expanded)
      returnFocus.current = document.activeElement as HTMLButtonElement;
    setView(next);
  }
  function backToCaptions() {
    setView("captions");
    setAudioOpen(null);
    setDeleteAccount(false);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }
  const stopInProgress = useRef<Promise<void> | undefined>(undefined);
  async function stop() {
    if (stopInProgress.current) return stopInProgress.current;
    if (status === 'idle' && playing) {
      if (caps.platform === 'macos' || caps.nativeSession) await invoke('audio_output', {command:{stop:true}});
      else browserPlayback.current?.stop();
      return;
    }
    const work = (async () => {
    if (status === "connecting") generation.current++;
    setStatus("stopping");
    try { await capture.current?.stop(); }
    finally {
      capture.current = undefined;
      try { await client.current?.finish(); }
      finally { client.current = undefined; setStatus("idle"); }
    }
    await sync();
    })();
    stopInProgress.current = work;
    try { await work; } catch (error) { setIssue(error instanceof Error ? error.message : String(error)); } finally { stopInProgress.current = undefined; }
  }
  const stopCurrent = useRef(stop);
  stopCurrent.current = stop;
  useEffect(() => {
    if (caps.platform !== "macos") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let closing = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          await stopCurrent.current();
          await invoke("audio_output", {command:{stop:true}});
          await getCurrentWindow().destroy();
        } catch {
          closing = false;
          setIssue(
            "Couldn’t finish the session. Stop captions and close again.",
          );
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [caps.platform]);
  async function start() {
    if (!session) {
      openPage("account");
      return;
    }
    const run = ++generation.current;
    const shouldSave = save;
    const sessionOutbox = outbox.current;
    setIssue("");
    setSegments([]);
    setStatus("connecting");
    const event = (e: RelayEvent) => {
      if (run !== generation.current) return;
      if (e.type === "segment") {
        setSegments((previous) => {
          const existing = previous.find((s) => s.id === e.segment.id);
          if (existing && existing.revision > e.segment.revision)
            return previous;
          return [...previous.filter((s) => s.id !== e.segment.id), e.segment]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-128);
        });
        if (shouldSave && e.segment.final) {
          try {
            sessionOutbox?.enqueue(e.segment);
            void sync();
          } catch (err) {
            setIssue(String(err));
            void stop();
          }
        }
      }
      if (e.type === 'audio' && caps.platform !== 'macos' && !caps.nativeSession) {
        try { browserPlayback.current?.enqueue(e.pcm); } catch (error) { setIssue(String(error)); browserPlayback.current?.stop(); void stopCurrent.current(); }
      }
      if (e.type === "audio" && caps.platform === 'macos') {
        dispatch({type:'playing', value:true});
        void invoke('audio_output', {command:{pcm:e.pcm}}).catch(() => { setIssue('Audio playback unavailable.'); dispatch({type:'playing',value:false}); void stopCurrent.current(); });
      }
      if (e.type === "error") { setIssue(e.message); void capture.current?.stop(); }
      if (e.type === "finished") {
        if (e.reason === "silence timeout") setIssue("Stopped after silence to save usage. Press Start to resume.");
        client.current = undefined;
        void capture.current?.stop();
        capture.current = undefined;
        setStatus("idle");
        void sync();
      }
    };
    try {
      if (caps.platform !== "macos" && !caps.nativeSession) await browserPlayback.current?.prepare();
      else await invoke("audio_output", {command:{reset:true}});
      const token = (await supabase!.auth.getSession()).data.session
        ?.access_token;
      if (!token) throw new Error("Sign in again to continue.");
      const relay = caps.nativeSession
        ? new NativeRelayClient(relayURL, event, session.user.id, save)
        : new RealtimeTranslationClient(relayURL, event);
      client.current = relay;
      const providerKey = ownProviderKey.trim();
      if (providerKey) await relay.connect(token, source, target, silence, {provider: ownProvider, apiKey: providerKey});
      else await relay.connect(token, source, target, silence);
      if (run !== generation.current) {
        await relay.finish();
        return;
      }
      if (caps.nativeSession) {
        setStatus("live");
        return;
      }
      const audio =
        caps.platform === "macos" || input === "system"
          ? new NativeCapture(input)
          : new BrowserMicrophone();
      capture.current = audio;
      await audio.start(
        (pcm) => relay.sendAudio(pcm),
        (error) => {
          setIssue(error);
          void stop();
        },
      );
      if (run !== generation.current) {
        await audio.stop();
        return;
      }
      setStatus("live");
    } catch (error) {
      setIssue(
        error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : "Could not start. Retry.",
      );
      try { await capture.current?.stop(); }
      finally {
        capture.current = undefined;
        try { await client.current?.finish(); }
        finally { client.current = undefined; setStatus("idle"); }
      }
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        caps.platform === "macos" &&
        e.metaKey &&
        e.altKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 40 : 10;
        void invoke("nudge_main_window", {
          dx: e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
          dy: e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0,
        }).catch(() =>
          setIssue(
            "Couldn’t move the window. Drag the grip at the top of the panel to reposition it.",
          ),
        );
        return;
      }
      if (e.key === "Escape") {
        backToCaptions();
        return;
      }
      if (
        (e.target as HTMLElement).closest(
          "input,select,textarea,button,[contenteditable]",
        )
      )
        return;
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        if (status === "live") void stop();
        else if (status === "idle") void start();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    if (!caps.globalOverlay) return;
    let dispose: (() => void) | undefined,
      cancelled = false;
    void listen<string>("overlay-action", ({ payload }) => {
      if (payload === "settings" || payload === "account") {
        openPage(payload);
      }
      if (payload === "toggle") {
        if (status === "live") void stop();
        else if (status === "idle") void start();
      }
    }).then((fn) => {
      if (cancelled) fn();
      else dispose = fn;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  });
  async function showHistory() {
    openPage("history");
    try {
      if (session) {
        await sync();
        setHistory(await listHistory(session.user.id));
      }
    } catch {
      setIssue("History could not load. Reconnect and try again.");
    }
  }
  async function removeHistory(id: string) {
    try {
      outbox.current?.deleteSession(id);
      setHistory((rows) => rows.filter((row) => row.id !== id));
      await sync();
    } catch (e) {
      setIssue(String(e));
    }
  }
  function exportHistory(row: any) {
    const content = [...(row.segments || [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => `${s.source_text}\n${s.translated_text}`)
      .join("\n\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `audeeo-${row.id}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function authenticate(provider: "apple" | "google") {
    setAuthPending(true);
    setIssue("");
    try {
      await signIn(provider);
    } catch (e) {
      setIssue(e instanceof Error ? e.message : "Sign-in failed. Try again.");
      setAuthPending(false);
    }
  }
  return (
    <>
      {caps.platform === "windows" && (
        <button
          type="button"
          className="window-drag-grip"
          aria-label="Drag to move Audeeo"
          title="Drag to move"
          onPointerDown={(event) => {
            if (event.button === 0) void getCurrentWindow().startDragging();
          }}
        >
          <span className="window-drag-grip-pill" aria-hidden="true">
            <GripHorizontal />
          </span>
        </button>
      )}
    <main
      className={`subtitle-panel ${expanded ? "expanded" : ""} ${overlay && !expanded && overlayStyle === "transparent" && !opaque ? "clear-overlay" : ""} ${autoHide ? "auto-hide" : ""} ${audioOpen && !expanded ? "popover-open" : ""}`}
    >
      <header className={`panel-header${expanded ? " settings-header" : ""}`}>
        <div className="header-leading">
        {expanded ? (
          <div className="page-title">
            {view !== "settings" && <Button ref={settingsBack} className="settings-back" aria-label="Back to Settings" onClick={() => {setDeleteAccount(false); openPage("settings");}}><ArrowLeft/><span>Settings</span></Button>}
            {view === "settings" && <h1 ref={pageHeading} tabIndex={-1}>Settings</h1>}
          </div>
        ) : (
          <CaptureStatus input={input} status={status} playing={playing} platform={caps.platform}/>
        )}
        </div>
          <div className="header-actions">
            <Button
              className="icon-button"
              aria-label="Show audio overlay"
              title="Audio overlay"
              aria-pressed={view === "captions"}
              onClick={backToCaptions}
            >
              <AudioLines />
            </Button>
            <Button
              className="icon-button"
              aria-label="Open settings"
              title="Caption settings"
              aria-pressed={view === "settings"}
              onClick={() => openPage("settings")}
            >
              <Settings2 />
            </Button>

          </div>
      </header>
      <div className="page-content" key={view}>
        {expanded && view !== "settings" && <h1 ref={pageHeading} tabIndex={-1} className="settings-section-title">
          {view === "overlay" ? "Overlay" : view === "configuration" ? "Audio & languages" : view === "history" ? "History" : "Account"}
        </h1>}
        {!expanded && <LiveCaptions source={captionMode === 'subtitles' || showSource ? segments.map(s => s.sourceText).join(' ') : ''} translation={captionMode === 'translate' ? segments.map(s => s.translatedText).join('') : ''} sourceLanguage={source} targetLanguage={target} size={size}/>}
        {view === "settings" && (
          <section className="settings-menu" aria-label="Settings">

            <Button
              aria-label="Overlay settings"
              onClick={() => openPage("overlay")}
            >
              <PictureInPicture2 />
              <span>
                Overlay
                <small>
                  {overlayStyle === "transparent"
                    ? "Transparent while listening"
                    : "Solid panel"}
                </small>
              </span>
              <ChevronDown />
            </Button>
            <Button onClick={() => void showHistory()}>
              <History />
              <span>
                History<small>Your saved captions</small>
              </span>
              <ChevronDown />
            </Button>
            <Button onClick={() => openPage("account")}>
              <UserRound />
              <span>
                Account<small>Sign-in and subscription</small>
              </span>
              <ChevronDown />
            </Button>
          </section>
        )}
        {view === "overlay" && (
          <><OverlaySettings
            overlayStyle={overlayStyle}
            setOverlayStyle={setOverlayStyle}
            size={size}
            setSize={setSize}
            showSource={showSource}
            setShowSource={setShowSource}
            autoHide={autoHide}
            setAutoHide={setAutoHide}
            opaque={opaque}
            setOpaque={setOpaque}
          />
          {caps.nativePip && status === "live" && <Button onClick={()=>void startNativePip().catch(e=>setIssue(String(e)))}><PictureInPicture2/>Picture in Picture</Button>}
          </>
        )}
        {view === "history" && (
          <section className="history-list" aria-label="Saved history">
            <label className="setting-toggle"><span>Save text history</span><input type="checkbox" checked={save} disabled={active} onChange={e=>setSave(e.target.checked)}/></label>
            <p className="hint">
              {session
                ? `${syncState || "Saved text"} · Most recent 100 sessions`
                : "Sign in to see your history."}
            </p>
            {!session && (
              <Button variant="outline" onClick={() => openPage("account")}>
                Go to account
              </Button>
            )}
            {session && !history.length && (
              <p className="empty-history">No saved sessions yet.</p>
            )}
            {history.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{new Date(row.started_at).toLocaleString()}</strong>
                  <p>
                    {[...(row.segments || [])].sort(
                      (a, b) => a.sequence - b.sequence,
                    )[0]?.source_text || "Caption session"}
                  </p>
                </div>
                <Button
                  aria-label="Export session"
                  title="Export text"
                  onClick={() => exportHistory(row)}
                >
                  <Download />
                </Button>
                <Button
                  aria-label="Delete session"
                  title="Delete session"
                  onClick={() => void removeHistory(row.id)}
                >
                  <Trash2 />
                </Button>
              </article>
            ))}
          </section>
        )}
        {view === "account" && (
          <section className="account-section" aria-label="Account settings">
            {session ? (
              <>
                <div className="account-profile"><UserRound aria-hidden="true"/><span>{session.user.email || "Signed in"}</span>
                <Button
                  disabled={active || billingPending}
                  className="icon-button" aria-label="Sign out" title="Sign out"
                  onClick={() => void supabase?.auth.signOut()}
                >
                  <LogOut aria-hidden="true"/>
                </Button></div>
                <Subscriptions
                  key={session.user.id}
                  session={session}
                  platform={caps.platform}
                  disabled={active}
                  onBusy={setBillingPending}
                />
                {!caps.nativeSession && <section className="provider-key-settings" aria-label="Bring your own provider key">
                  <h2>Use your own provider key</h2>
                  <small>Sessions started with this key do not use your Audeeo allowance. The key stays in memory only and is cleared when Audeeo closes.</small>
                  <label>
                    <span>Provider</span>
                    <select value={ownProvider} disabled={active} onChange={event => setOwnProvider(event.target.value as ProviderCredentials["provider"])}>
                      <option value="openai">OpenAI</option>
                      <option value="soniox">Soniox</option>
                    </select>
                  </label>
                  <label>
                    <span>API key</span>
                    <input type="password" value={ownProviderKey} disabled={active} autoComplete="off" spellCheck={false}
                      placeholder="Leave blank to use Audeeo allowance" onChange={event => setOwnProviderKey(event.target.value)} />
                  </label>
                  {ownProviderKey && <Button variant="outline" disabled={active} onClick={() => setOwnProviderKey("")}>Clear key</Button>}
                </section>}
                <Button
                  disabled={active || billingPending}
                  className="account-delete"
                  onClick={() => setDeleteAccount(true)}
                >
                  <Trash2 aria-hidden="true"/><span>Delete account</span>
                </Button>
                {deleteAccount && (
                  <div className="delete-confirmation" role="alert">
                    <p>
                      Delete your account and synchronized history? This cannot
                      be undone. Cancel any subscription separately using Manage
                      subscription before deleting your account.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setDeleteAccount(false)}
                    >
                      Keep account
                    </Button>
                    <Button
                      disabled={billingPending}
                      onClick={() =>
                        void accountRequest("/v1/account", "DELETE", session)
                          .then(async () => {
                            if (isTauri())
                              await invoke("native_history_delete", {
                                owner: session.user.id,
                              });
                            outbox.current?.clear();
                            await supabase?.auth.signOut();
                            setDeleteAccount(false);
                          })
                          .catch((e) => setIssue(e.message))
                      }
                    >
                      Delete permanently
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="hint">
                  Sign in for captions and synced history.
                </p>
                <div className="sign-in-actions">
                  <Button
                    variant="outline"
                    disabled={!supabase || authPending}
                    onClick={() => void authenticate("apple")}
                  >
                    <ProviderIcon provider="apple"/><span>Continue with Apple</span>
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!supabase || authPending}
                    onClick={() => void authenticate("google")}
                  >
                    <ProviderIcon provider="google"/><span>Continue with Google</span>
                  </Button>
                </div>
                {!supabase && (
                  <p className="hint">
                    Sign-in is currently unavailable.
                  </p>
                )}
              </>
            )}
            {authPending && (
              <p className="hint" role="status">
                Complete sign-in in your browser, then return to Audeeo.
                <Button onClick={() => setAuthPending(false)}>Try again</Button>
              </p>
            )}
          </section>
        )}
      </div>
      {issue && (
        <div className="notice" role="alert">
          <span>{issue}</span>
          {(issue.includes("Keychain") || issue.includes("Configuration storage")) && isTauri() && <Button onClick={() => { void invoke("auth_storage_retry").then(async () => {
            const result = await supabase?.auth.getSession();
            if (result?.error) throw result.error;
            setSession(result?.data.session ?? null); setIssue("");
          }).catch(error => setIssue(String(error))); }}>Retry storage</Button>}
          <Button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setIssue("")}
          >
            <X />
          </Button>
        </div>
      )}
      {!expanded && <CaptionToolbar {...{silence,setSilence,input,setInput,active,captionMode,setCaptionMode,source,setSource,target,setTarget,sourceVolume,setSourceVolume,sourceMuted,setSourceMuted,translatedVolume,setTranslatedVolume,translatedMuted,setTranslatedMuted,status,playing}} detached={false} open={audioOpen} setOpen={setAudioOpen} systemAudio={caps.systemAudio} startDisabled={!!session && !caps.microphone && input === "microphone"} onToggle={()=>void(active ? stop() : start())}/>}
    </main>
    </>
  );
}
