import {ProviderIcon} from "./components/ProviderIcon";
import {CaptureStatus} from "./components/CaptureStatus";
import {languageName, isTranslationSource, isTranscriptionLanguage, isTranslationTarget} from "../shared/languages";
import { Subscriptions } from "./components/Subscriptions";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useEffect, useRef, useState, useReducer, type CSSProperties } from "react";
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
  KeyRound,
  Sparkles,
  Play,
  Square,
  LoaderCircle,
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
  type InputMode,
} from "./lib/platform";
import { DesktopCaptureMixer } from "./lib/captureMixer";
import {
  RealtimeTranslationClient,
  NativeRelayClient,
  type CaptionConnection,
  type RelayEvent,
} from "./lib/realtime";
import { ProviderSettings } from "./components/ProviderSettings";
import { SessionIntelligence } from "./components/SessionIntelligence";
import { emptySessionContext, type SessionContext } from "../shared/context";
import { loadSessionContext, saveSessionContext } from "./lib/contextStorage";
import {
  emptyProviderKeys,
  providerCredentials,
  type ProviderId,
  type ProviderMode,
} from "./lib/providers";
import {
  supabase,
  signIn,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  listenForAuth,
  historyRemote,
  listHistory,
  relayURL,
  accountRequest,
  contextFromLink as generateContextFromLink,
  type HistorySession,
} from "./lib/account";
import type { SavedSessionSummary } from "../shared/intelligence";
import { HistoryOutbox } from "../shared/history";
import type { Language, Segment } from "../shared/pipeline";
import { startNativePip } from "./lib/pip";

import { BrowserPlayback } from "./lib/playback";
import { LiveCaptions } from "./components/LiveCaptions";
import { MobileSessionGuide } from "./components/MobileSessionGuide";
import { DesktopOnboarding } from "./components/DesktopOnboarding";
import { initialPresentation, presentationReducer, isOverlay, type Page, type SessionPhase as Status } from "./lib/presentation";
import { classifyMobileError, initialMobileLiveState, mobileLiveReducer } from "./lib/mobileSession";
import { colorWithOpacity, loadOverlayAppearance, overlayFontStacks } from "./lib/overlayAppearance";
const messages = {
  idle: "Ready to listen",
  connecting: "Connecting…",
  live: "Listening",
  stopping: "Finishing captions…",
};
const resizeDirections = ["North", "NorthEast", "East", "SouthEast", "South", "SouthWest", "West", "NorthWest"] as const;
const desktopOnboardingKey = (owner: string) => `audeeo.onboarding.desktop.${owner}`;
export default function App() {
  const [silence, setSilence] = useState(() => {
    try { return silenceSettings(JSON.parse(localStorage.getItem("audeeo.silence") || "null")); }
    catch { return silenceSettings(null); }
  });
  useEffect(() => { localStorage.setItem("audeeo.silence", JSON.stringify(silence)); }, [silence]);
  const [captionMode, setCaptionMode] = useState<"subtitles" | "translate">("subtitles");
  const [presentation, dispatch] = useReducer(presentationReducer, initialPresentation);
  const [mobileSession, dispatchMobile] = useReducer(mobileLiveReducer, initialMobileLiveState);
  const {phase: status, page: view, playing} = presentation;
  const setStatus = (value: Status) => dispatch({type: 'phase', value});
  const setView = (value: Page) => dispatch({type: 'page', value});
  const overlay = isOverlay(presentation);
  const browserPlayback = useRef<BrowserPlayback | undefined>(undefined);
  browserPlayback.current ??= new BrowserPlayback(value=>dispatch({type:"playing",value}));
  const [audioOpen, setAudioOpen] = useState<ControlGroup | null>(null);
  const [desktopGain, setDesktopGain] = useState(1);
  const [microphoneGain, setMicrophoneGain] = useState(1);
  const [translatedVolume, setTranslatedVolume] = useState(1);
  const [desktopMuted, setDesktopMuted] = useState(false);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [translatedMuted, setTranslatedMuted] = useState(false);
  const expanded = view !== "captions";
  const [appearance, setAppearance] = useState(() => loadOverlayAppearance(localStorage));
  const [showSource, setShowSource] = useState(
    () => localStorage.getItem("audeeo.show-source") !== "false",
  );
  const [autoHide, setAutoHide] = useState(
    () => localStorage.getItem("audeeo.auto-hide") !== "false",
  );
  const [authPending, setAuthPending] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [capsReady, setCapsReady] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
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
    applicationAudio: false,
    inputMix: false,
    translatedPlayback: false,
  });
  const [input, setInput] = useState<InputMode>("microphone"),
    [source, updateSource] = useState<Language>("zh");
  const [captureSourceId, setCaptureSourceId] = useState("all");
  const [translationTarget, setTarget] = useState<Language>("en");
  const setSource = (value: Language) => {
    updateSource(value);
    if (value === translationTarget) setTarget(value === "en" ? "zh" : "en");
  };
  useEffect(() => {
    if (!(captionMode === "translate" ? isTranslationSource(source) : isTranscriptionLanguage(source))) updateSource("auto");
  }, [captionMode, source]);
  const [save, setSave] = useState(true);
  const [opaque, setOpaque] = useState(
    () => localStorage.getItem("audeeo.opaque") === "true",
  );
  const [segments, setSegments] = useState<Segment[]>([]),
    [history, setHistory] = useState<HistorySession[]>([]),
    [syncState, setSyncState] = useState("");
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [billingPending, setBillingPending] = useState(false);
  const [providerMode, setProviderMode] = useState<ProviderMode>("audeeo");
  const [providerKeys, setProviderKeys] = useState(emptyProviderKeys);
  const [translationContext, setTranslationContext] = useState<SessionContext>(emptySessionContext);
  const [contextReady, setContextReady] = useState(false);
  const [intelligenceSession, setIntelligenceSession] = useState<HistorySession | null>(null);
  const owner = useRef<string | undefined>(undefined),
    onboardingOwner = useRef<string | undefined>(undefined),
    outbox = useRef<HistoryOutbox | undefined>(undefined);
  const client = useRef<CaptionConnection | undefined>(undefined),
    capture = useRef<AudioInput | undefined>(undefined),
    generation = useRef(0),
    mobileFailed = useRef(false);
  const active = status !== "idle" || playing,
    target: Language = captionMode === "subtitles" ? source : translationTarget;
  const mobile = caps.platform === "ios" || caps.platform === "android";
  const desktop = caps.platform === "macos" || caps.platform === "windows";
  const rememberedAudeeoSetup = session
    ? localStorage.getItem(desktopOnboardingKey(session.user.id)) === "audeeo"
    : false;
  const onboardingVisible = capsReady && authReady && desktop &&
    (!session || (!onboardingComplete && !rememberedAudeeoSetup));
  const panelExpanded = expanded || onboardingVisible;
  const inputMix = caps.inputMix ?? desktop;
  const applicationAudio = caps.applicationAudio ??
    ["macos", "windows", "android"].includes(caps.platform);
  const translatedPlayback = caps.translatedPlayback ??
    (caps.platform !== "android");
  const latest = segments.at(-1);
  const translated = [...segments]
    .reverse()
    .find((s) => !!s.translatedText);
  useEffect(()=>{
    let mounted=true;
    void loadSessionContext().then(value=>{if(mounted){setTranslationContext(value);setContextReady(true);}});
    return ()=>{mounted=false;};
  },[]);
  useEffect(()=>{
    if(!contextReady) return;
    const timer=setTimeout(()=>void saveSessionContext(translationContext).catch(error=>setIssue(String(error))),250);
    return ()=>clearTimeout(timer);
  },[translationContext,contextReady]);
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
      .then((next) => {
        setCaps(next);
        if ((next.platform === "android" || next.platform === "ios") && next.systemAudio) setInput("system");
        if ((next.platform === "macos" || next.platform === "windows") && next.systemAudio) setInput("mixed");
      })
      .catch(() =>
        setIssue("Native capabilities could not be loaded. Restart Audeeo."),
      )
      .finally(() => setCapsReady(true));
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
      setAuthReady(true);
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
    if (!supabase) setAuthReady(true);
    else void supabase.auth.getSession().then(({ data, error }) => {
      if (error) { setIssue(error.message); setAuthReady(true); return; }
      update(data.session);
    }).catch(error => {
      setIssue(error instanceof Error ? error.message : String(error));
      setAuthReady(true);
    });
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
    if (!capsReady || !authReady || !desktop) return;
    const nextOwner = session?.user.id;
    if (!nextOwner) {
      onboardingOwner.current = undefined;
      setOnboardingComplete(false);
      return;
    }
    if (onboardingOwner.current === nextOwner) return;
    onboardingOwner.current = nextOwner;
    const saved = localStorage.getItem(desktopOnboardingKey(nextOwner));
    if (saved === "audeeo" || saved === "openai" || saved === "soniox") setProviderMode(saved);
    setOnboardingComplete(saved === "audeeo");
  }, [capsReady, authReady, desktop, session?.user.id]);
  useEffect(() => {
    localStorage.setItem("audeeo.overlay-appearance", JSON.stringify(appearance));
    localStorage.setItem("audeeo.opaque", String(opaque));
    localStorage.setItem("audeeo.show-source", String(showSource));
    localStorage.setItem("audeeo.auto-hide", String(autoHide));
    if (caps.nativePip)
      void invoke("update_overlay", {
        source: latest?.sourceText || (captionMode === "translate" ? "" : "Ready to listen"),
        translation: translated?.translatedText || "",
        size: appearance.fontSize,
        opaque,
        recording: status === "live",
        preferences: {
          appearance,
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
    appearance,
    opaque,
    caps.globalOverlay,
    caps.nativePip,
    status,
    showSource,
    autoHide,
    source,
    target,
    captionMode,
    issue,
    session,
  ]);
  useEffect(() => {
    if (desktop)
      void invoke("resize_main_window", {
        height: onboardingVisible ? 680 : expanded ? 500 : 224,
      }).catch(() =>
        setIssue("The window couldn’t resize. You can resize it from an edge."),
      );
  }, [expanded, onboardingVisible, desktop]);
  useEffect(() => {
    if (panelExpanded || caps.platform === "browser") return;
    void invoke("resize_overlay_width", {width: appearance.panelWidth}).catch(() =>
      setIssue("The overlay width couldn’t be changed. You can still resize it from an edge."),
    );
  }, [panelExpanded, appearance.panelWidth, caps.platform]);
  useEffect(() => {
    if (caps.platform !== 'macos' && caps.platform !== 'windows') return;
    void invoke('set_window_mode', {overlay, clear: overlay && !panelExpanded && !opaque && (appearance.backgroundOpacity < 1 || appearance.overlayOpacity < 1)});
  }, [overlay, panelExpanded, appearance.backgroundOpacity, appearance.overlayOpacity, opaque, caps.platform]);
  useEffect(() => {
    if (!translatedPlayback) { dispatch({type:'playing', value:false}); return; }
    if (!['macos','ios','android'].includes(caps.platform)) { browserPlayback.current?.setVolume(translatedMuted ? 0 : translatedVolume); return; }
    void invoke('audio_output', {command: {volume: translatedMuted ? 0 : translatedVolume}}).catch(()=>undefined);
  }, [translatedVolume, translatedMuted, caps.platform, translatedPlayback]);
  useEffect(() => {
    capture.current?.setGains?.({
      microphone: microphoneMuted ? 0 : microphoneGain,
      system: desktopMuted ? 0 : desktopGain,
    });
  }, [microphoneGain, microphoneMuted, desktopGain, desktopMuted]);
  useEffect(() => {
    if (caps.platform !== 'macos' && caps.platform !== 'ios') return;
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
      if (caps.platform === 'macos' || caps.platform === 'ios') await invoke('audio_output', {command:{stop:true}});
      else browserPlayback.current?.stop();
      return;
    }
    const work = (async () => {
    if (status === "connecting") generation.current++;
    setStatus("stopping");
    if (mobile) dispatchMobile({type:"stopping"});
    try { await capture.current?.stop(); }
    finally {
      capture.current = undefined;
      try { await client.current?.finish(); }
      finally { client.current = undefined; setStatus("idle"); if (mobile) dispatchMobile({type:"idle"}); }
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
    mobileFailed.current = false;
    setSegments([]);
    setStatus("connecting");
    if (mobile) dispatchMobile({type: input === "system" ? "permission" : "model"});
    const event = (e: RelayEvent) => {
      if (run !== generation.current) return;
      if (e.type === "segment") {
        if (mobile) dispatchMobile({type:"translation"});
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
      if (e.type === "status" && mobile) dispatchMobile({type:"native", state:e.state, message:e.message});
      if (e.type === 'audio' && translatedPlayback && caps.platform !== 'macos' && !caps.nativeSession) {
        try { browserPlayback.current?.enqueue(e.pcm); } catch (error) { setIssue(String(error)); browserPlayback.current?.stop(); void stopCurrent.current(); }
      }
      if (e.type === "audio" && translatedPlayback && caps.platform === 'macos') {
        dispatch({type:'playing', value:true});
        void invoke('audio_output', {command:{pcm:e.pcm}}).catch(() => { setIssue('Audio playback unavailable.'); dispatch({type:'playing',value:false}); void stopCurrent.current(); });
      }
      if (e.type === "error") {
        mobileFailed.current = true;
        setIssue(e.message);
        if (mobile) dispatchMobile({type:"failed", error:classifyMobileError(e.message), message:e.message});
        void capture.current?.stop();
      }
      if (e.type === "finished") {
        if (e.reason === "silence timeout") setIssue("Stopped after silence to save usage. Press Start to resume.");
        client.current = undefined;
        void capture.current?.stop();
        capture.current = undefined;
        setStatus("idle");
        if (mobile && !mobileFailed.current) dispatchMobile({type:"idle"});
        void sync();
      }
    };
    try {
      if (caps.nativeSession) {
        if (caps.platform === "ios" || caps.platform === "android") await invoke("audio_output", {command:{reset:true}});
      } else if (caps.platform !== "macos") {
        await browserPlayback.current?.prepare();
      } else {
        await invoke("audio_output", {command:{reset:true}});
      }
      const token = (await supabase!.auth.getSession()).data.session
        ?.access_token;
      if (!token) throw new Error("Sign in again to continue.");
      const mobileInput = input === "mixed" ? "system" : input;
      const relay = caps.nativeSession
        ? new NativeRelayClient(relayURL, event, session.user.id, save, mobileInput, captureSourceId)
        : new RealtimeTranslationClient(relayURL, event);
      client.current = relay;
      const credentials = providerCredentials(providerMode, providerKeys);
      await relay.connect(token, source, target, silence, credentials ?? undefined, translationContext);
      if (run !== generation.current) {
        await relay.finish();
        return;
      }
      if (caps.nativeSession) {
        setStatus("live");
        if (mobile) dispatchMobile({type:"waiting"});
        return;
      }
      const audio = desktop
        ? new DesktopCaptureMixer(input, captureSourceId, {
            microphone: microphoneMuted ? 0 : microphoneGain,
            system: desktopMuted ? 0 : desktopGain,
          })
        : input === "system"
          ? new NativeCapture(input, captureSourceId)
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
      if (mobile) dispatchMobile({type:"waiting"});
    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : "Could not start. Retry.";
      setIssue(message);
      if (mobile) dispatchMobile({type:"failed", error:classifyMobileError(message), message});
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
  async function authenticateEmail(email: string, password: string) {
    setAuthPending(true);
    setIssue("");
    try {
      await signInWithEmailPassword(email, password);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "Sign-in failed. Try again.");
      throw error;
    } finally {
      setAuthPending(false);
    }
  }
  async function createEmailAccount(email: string, password: string) {
    setAuthPending(true);
    setIssue("");
    try {
      return await signUpWithEmailPassword(email, password);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "Account creation failed. Try again.");
      throw error;
    } finally {
      setAuthPending(false);
    }
  }
  async function signOut() {
    setIssue("");
    try {
      if (!supabase) throw new Error("Sign-out is unavailable in this build.");
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "Sign-out failed. Try again.");
    }
  }
  const panelStyle = {
    "--overlay-width": `${appearance.panelWidth}px`,
    ...(overlay && !expanded ? {
    "--overlay-background": opaque ? "#191919" : colorWithOpacity(appearance.backgroundColor, appearance.backgroundOpacity),
    "--overlay-border": colorWithOpacity(appearance.borderColor, appearance.borderOpacity),
    "--overlay-border-width": `${appearance.borderWidth}px`,
    "--overlay-radius": `${appearance.borderRadius}px`,
    "--overlay-text": appearance.textColor,
    "--overlay-source-text": appearance.sourceTextColor,
    "--overlay-text-opacity": String(appearance.textOpacity),
    "--overlay-font": overlayFontStacks[appearance.fontFamily],
    "--overlay-font-weight": String(appearance.fontWeight),
    "--overlay-controls-opacity": String(appearance.controlsOpacity),
    "--overlay-opacity": String(opaque ? 1 : appearance.overlayOpacity),
    } : {}),
  } as CSSProperties;
  return (
    <>
      {caps.platform === "windows" && resizeDirections.map(direction => (
        <div
          key={direction}
          aria-hidden="true"
          className={`window-resize-handle resize-${direction.toLowerCase()}`}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            void getCurrentWindow().startResizeDragging(direction).catch(() =>
              setIssue("The window couldn’t begin resizing. Try again from another edge."),
            );
          }}
        />
      ))}
      {intelligenceSession && session && <SessionIntelligence
        row={intelligenceSession}
        session={session}
        openaiKey={providerKeys.openai.trim() || undefined}
        onClose={()=>setIntelligenceSession(null)}
        onProviders={()=>{setIntelligenceSession(null);openPage("providers");}}
        onSubscription={()=>{setIntelligenceSession(null);openPage("account");}}
        onSaved={(summary: SavedSessionSummary)=>{
          setHistory(rows=>rows.map(row=>row.id===intelligenceSession.id?{...row,session_summaries:[summary]}:row));
          setIntelligenceSession(row=>row?{...row,session_summaries:[summary]}:row);
        }}
      />}
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
    {onboardingVisible ? <DesktopOnboarding
      key={session?.user.id || "signed-out"}
      session={session}
      platform={caps.platform}
      configured={Boolean(supabase)}
      authPending={authPending}
      error={issue}
      initialMode={providerMode}
      keys={providerKeys}
      onSocialSignIn={provider => void authenticate(provider)}
      onEmailSignIn={authenticateEmail}
      onEmailSignUp={createEmailAccount}
      onSignOut={signOut}
      onResetAuth={() => { setAuthPending(false); setIssue(""); }}
      onMode={setProviderMode}
      onKey={(provider, key) => setProviderKeys(current => ({...current, [provider]: key}))}
      onComplete={mode => {
        if (!session) return;
        setProviderMode(mode);
        localStorage.setItem(desktopOnboardingKey(session.user.id), mode);
        setOnboardingComplete(true);
        setView("captions");
      }}
    /> : (
    <main
      data-platform={caps.platform}
      className={`subtitle-panel ${expanded ? "expanded" : ""} ${mobile ? "mobile-panel" : ""} ${caps.platform === "browser" ? "browser-panel" : ""} ${overlay && !expanded ? "custom-overlay" : ""} ${autoHide ? "auto-hide" : ""} ${audioOpen && !expanded ? "popover-open" : ""}`}
      style={panelStyle}
    >
      <header className={`panel-header${expanded ? " settings-header" : ""}`}>
        <div className="header-leading">
        {expanded ? (
          <div className="page-title">
            {view !== "settings" && <Button ref={settingsBack} className="settings-back" aria-label="Back to Settings" onClick={() => {setDeleteAccount(false); openPage("settings");}}><ArrowLeft/><span>Settings</span></Button>}
            {view === "settings" && <h1 ref={pageHeading} tabIndex={-1}>Settings</h1>}
          </div>
        ) : (
          <CaptureStatus input={input} status={status} playing={playing} platform={caps.platform} captureSourceId={captureSourceId}/>
        )}
        </div>
          <div className="header-actions">
            {mobile && caps.nativePip && status === "live" && <Button
              className="icon-button mobile-presenter-button"
              aria-label={caps.platform === "android" ? "Show floating captions" : "Start Picture in Picture"}
              title={caps.platform === "android" ? "Float captions over other apps" : "Picture in Picture"}
              onClick={()=>void startNativePip().catch(e=>setIssue(String(e)))}
            ><PictureInPicture2 /></Button>}
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
          {view === "overlay" ? "Overlay" : view === "configuration" ? "Audio & languages" : view === "history" ? "History" : view === "providers" ? "Providers" : "Account"}
        </h1>}
        {!expanded && mobile && <MobileSessionGuide platform={caps.platform} input={input === 'mixed' ? 'system' : input} state={mobileSession}/>}
        {!expanded && <LiveCaptions source={captionMode === 'subtitles' || showSource ? segments.map(s => s.sourceText).join(' ') : ''} translation={captionMode === 'translate' ? segments.map(s => s.translatedText).join('') : ''} sourceLanguage={source} targetLanguage={target} size={appearance.fontSize}/>}
        {!expanded && <Button
          className={`content-session-toggle${status === "idle" && !playing ? " is-start" : ""}${active ? " is-stop" : ""}${status === "connecting" || status === "stopping" ? " is-busy" : ""}`}
          aria-label={status === "connecting" ? "Connecting" : status === "stopping" ? "Finishing captions" : active ? "Stop captions" : "Start captions"}
          title={status === "connecting" ? "Connecting" : status === "stopping" ? "Finishing captions" : active ? "Stop captions" : "Start captions"}
          disabled={status === "connecting" || status === "stopping" || (!!session && !caps.microphone && input === "microphone")}
          onClick={()=>{setAudioOpen(null);void(active ? stop() : start());}}
        >{status === "connecting" || status === "stopping" ? <LoaderCircle className="busy-icon"/> : active ? <Square/> : <Play/>}<span>{status === "connecting" ? "Starting…" : status === "stopping" ? "Finishing…" : active ? "Stop captions" : "Start captions"}</span></Button>}
        {view === "settings" && (
          <section className="settings-menu" aria-label="Settings">

            <Button
              aria-label="Overlay settings"
              onClick={() => openPage("overlay")}
            >
              <PictureInPicture2 />
              <span>Overlay</span>
              <ChevronDown />
            </Button>
            <Button onClick={() => void showHistory()}>
              <History />
              <span>History</span>
              <ChevronDown />
            </Button>
            <Button onClick={() => openPage("providers")}>
              <KeyRound />
              <span>Providers</span>
              <ChevronDown />
            </Button>
            <Button onClick={() => openPage("account")}>
              <UserRound />
              <span>Account</span>
              <ChevronDown />
            </Button>
          </section>
        )}
        {view === "overlay" && (
          <><OverlaySettings
            appearance={appearance}
            setAppearance={setAppearance}
            showSource={showSource}
            setShowSource={setShowSource}
            autoHide={autoHide}
            setAutoHide={setAutoHide}
            opaque={opaque}
            setOpaque={setOpaque}
          />
          {caps.nativePip && status === "live" && <Button className="native-presenter-action" onClick={()=>void startNativePip().catch(e=>setIssue(String(e)))}><PictureInPicture2/>{caps.platform === "android" ? "Show floating captions" : "Picture in Picture"}</Button>}
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
                  <strong>{row.session_summaries?.[0]?.content.title || new Date(row.started_at).toLocaleString()}</strong>
                  <p>
                    {row.session_summaries?.[0] ? new Date(row.started_at).toLocaleString() : [...(row.segments || [])].sort(
                      (a, b) => a.sequence - b.sequence,
                    )[0]?.source_text || "Caption session"}
                  </p>
                </div>
                <Button
                  aria-label="Summarize session"
                  title={row.session_summaries?.length ? "Open session summary" : "Summarize session"}
                  onClick={() => setIntelligenceSession(row)}
                >
                  <Sparkles />
                </Button>
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
        {view === "providers" && (
          <ProviderSettings
            mode={providerMode}
            keys={providerKeys}
            active={active}
            onMode={setProviderMode}
            onKey={(provider: ProviderId, key: string) =>
              setProviderKeys((current) => ({ ...current, [provider]: key }))
            }
            onSubscription={() => openPage("account")}
          />
        )}
        {view === "account" && (
          <section className="account-section" aria-label="Account settings">
            {session ? (
              <>
                <div className="account-profile"><UserRound aria-hidden="true"/><span>{session.user.email || "Signed in"}</span>
                <Button
                  disabled={active || billingPending}
                  className="icon-button" aria-label="Sign out" title="Sign out"
                  onClick={() => void signOut()}
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
      {!expanded && <CaptionToolbar
        {...{silence,setSilence,input,setInput,active,captureSourceId,setCaptureSourceId,captionMode,setCaptionMode,source,setSource,target,setTarget,microphoneGain,setMicrophoneGain,microphoneMuted,setMicrophoneMuted,desktopGain,setDesktopGain,desktopMuted,setDesktopMuted,translatedVolume,setTranslatedVolume,translatedMuted,setTranslatedMuted,translationContext,setTranslationContext}}
        onFillContextFromLink={session ? (url:string)=>generateContextFromLink(session,url,isTranslationTarget(target)?target:"en",providerKeys.openai.trim()||undefined) : undefined}
        open={audioOpen}
        setOpen={setAudioOpen}
        systemAudio={caps.systemAudio}
        applicationAudio={applicationAudio}
        platform={caps.platform}
        inputMix={inputMix}
        translatedPlayback={translatedPlayback}
      />}
    </main>
    )}
    </>
  );
}
