import {ProviderSetup} from "./components/ProviderSetup";
import {connectionMode,emptyProviderKeys,loadProviderKeys,personalKey,type ProviderKeys,type ProviderMode} from "./lib/providers";
import {DirectCaptionClient} from "./lib/directCaptions";
import {localHistory,saveLocalSegment,deleteLocalSession,clearLocalHistory} from "./lib/localHistory";
import {AccountProfile} from "./components/AccountProfile";
import {useDailyBudget} from "./lib/useDailyBudget";
import {AIConsentSetup, useAIConsent, withdrawAIConsent} from "./components/AIConsent";
import {LegalFooter} from "./components/LegalLinks";
import {config} from "./lib/config";
import { prepareContextScreenshot } from "./lib/contextScreenshot";
import {contextRefillOptions} from './lib/contextRefill';
import {HistoryRows} from "./components/HistoryRows";
import {SaveSessionsDialog} from './components/SaveSessionsDialog';
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
  History,
  Settings2,
  PictureInPicture2,
  X,
  UserRound,
  GripHorizontal,
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
import { DesktopCapture } from "./lib/desktopCapture";
import {
  RealtimeTranslationClient,
  type CaptionConnection,
  type RelayEvent,
} from "./lib/realtime";
import { SessionIntelligence } from "./components/SessionIntelligence";
import { emptySessionContext, hasSessionContext, type SessionContext } from "../shared/context";
import { loadSessionContext, saveSessionContext, loadContextSessions, saveContextSession, removeContextSessions, pruneContextSessions, refillSessionContext, type ContextSession } from "./lib/contextStorage";
import {
  supabase,
  signIn,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  listenForAuth,
  historyRemote,
  listHistory,
  getHistorySession,
  relayURL,
  accountRequest,
  contextFromScreenshot as generateContextFromScreenshot,
  type HistorySession,
  getSessionHistorySettings,
  setSessionHistorySettings,
  type SessionHistorySettings,
} from "./lib/account";
import type { SavedSessionSummary } from "../shared/intelligence";
import { HistoryOutbox } from "../shared/history";
import type { Language, Segment } from "../shared/pipeline";

import { BrowserPlayback } from "./lib/playback";
import { LiveCaptions } from "./components/LiveCaptions";
import { DesktopOnboarding } from "./components/DesktopOnboarding";
import { initialPresentation, presentationReducer, isOverlay, type Page, type SessionPhase as Status } from "./lib/presentation";
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
  const [providerMode,setProviderMode]=useState<ProviderMode>(()=>connectionMode(localStorage));
  const byok=providerMode!=='audeeo';
  const modeRef=useRef(providerMode);modeRef.current=providerMode;
  const [providerKeys,setProviderKeys]=useState<ProviderKeys>(emptyProviderKeys);
  const [keysReady,setKeysReady]=useState(false);
  const [providerSetupRequested,setProviderSetupRequested]=useState(()=>!localStorage.getItem('audeeo.connection-mode'));
  const [localSave,setLocalSave]=useState(()=>localStorage.getItem('audeeo.byok-save')==='true');
  useEffect(()=>{let mounted=true;void loadProviderKeys().then(keys=>{if(mounted)setProviderKeys(keys);}).catch(()=>{if(mounted){setIssue('Saved API keys could not load. Open Caption service to retry.');setProviderSetupRequested(true);}}).finally(()=>{if(mounted)setKeysReady(true);});return()=>{mounted=false;};},[]);
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
  const [desktopGain, setDesktopGain] = useState(1);
  const [microphoneGain, setMicrophoneGain] = useState(1);
  const [spokenTranslation,setSpokenTranslation]=useState(false);
  const [voicePending,setVoicePending]=useState(false);
  const captureBillingPaused=useRef(false);
  const resumeCapture=useRef<(()=>Promise<void>)|undefined>(undefined);
  const captureTransition=useRef<Promise<void>>(Promise.resolve());
  const [packConsent,setPackConsent]=useState(false);
  const [usagePaused,setUsagePaused]=useState(false);
  function changeSpokenTranslation(value:boolean) {
    if(status==='live' && client.current){setVoicePending(true);client.current.control({type:'voice',enabled:value});}
    else setSpokenTranslation(value);
  }
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
    inputGain: false,
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
  const [save, setSave] = useState(false);
  const [saveReady,setSaveReady]=useState(false);
  const [saveConfirmation,setSaveConfirmation]=useState<boolean|null>(null);
  const [savePending,setSavePending]=useState(false);
  const [saveIssue,setSaveIssue]=useState('');
  const historySettings=useRef<(SessionHistorySettings & {owner:string})|undefined>(undefined);
  const historyPaused=useRef(false);
  const clearedHistory=useRef('');
  const [opaque, setOpaque] = useState(
    () => localStorage.getItem("audeeo.opaque") === "true",
  );
  const [segments, setSegments] = useState<Segment[]>([]),
    [history, setHistory] = useState<HistorySession[]>([]),
    [syncState, setSyncState] = useState("");
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [billingPending, setBillingPending] = useState(false);
  const [translationContext, setTranslationContext] = useState<SessionContext>(emptySessionContext);
  const [contextSessions,setContextSessions] = useState<ContextSession[]>([]);
  const [refillHistory,setRefillHistory] = useState<{owner:string;rows:HistorySession[];status:'loading'|'ready'|'error'}>({owner:'',rows:[],status:'loading'});
  const [screenCapturePending, setScreenCapturePending] = useState(false);
  const [screenCaptureIssue, setScreenCaptureIssue] = useState("");
  const screenCaptureRunning = useRef(false);
  const [contextReady, setContextReady] = useState(false);
  const contextSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {requestConsent, accepted:aiConsentAccepted} = useAIConsent(session?.user.id);
  const [aiSetupRequested,setAISetupRequested] = useState(false);
  async function clearSessionContext() {
    clearTimeout(contextSaveTimer.current);
    const empty = emptySessionContext();
    setTranslationContext(empty);
    setScreenCaptureIssue("");
    try { await saveSessionContext(empty); }
    catch (error) { setIssue(String(error)); }
  }
  const [intelligenceSession, setIntelligenceSession] = useState<HistorySession | null>(null);
  const owner = useRef<string | undefined>(undefined),
    onboardingOwner = useRef<string | undefined>(undefined),
    outbox = useRef<HistoryOutbox | undefined>(undefined);
  const client = useRef<CaptionConnection | undefined>(undefined),
    capture = useRef<AudioInput | undefined>(undefined),
    generation = useRef(0);
  const active = status !== "idle" || playing,
    target: Language = captionMode === "subtitles" ? source : translationTarget;
  const dailyBudget = useDailyBudget(byok ? undefined : session?.user.id,status === "live");
  const desktop = caps.platform === "macos" || caps.platform === "windows";
  const rememberedAudeeoSetup = session
    ? localStorage.getItem(desktopOnboardingKey(session.user.id)) === "audeeo"
    : false;
  const providerSetupVisible = capsReady && authReady && keysReady && desktop && (providerSetupRequested || view === "providers");
  const aiSetupVisible = !byok && !providerSetupVisible && !!session && (aiSetupRequested || (!aiConsentAccepted && view !== 'account'));
  const onboardingVisible = !byok && !providerSetupVisible && keysReady && capsReady && authReady && desktop && !aiSetupVisible && !(session && !aiConsentAccepted && view === 'account') &&
    (!session || (!onboardingComplete && !rememberedAudeeoSetup));
  const panelExpanded = expanded || onboardingVisible || aiSetupVisible || providerSetupVisible;
  const overlaySurface = overlay && !panelExpanded;
  const inputGain = caps.inputGain ?? desktop;
  const applicationAudio = caps.applicationAudio ??
    ["macos", "windows"].includes(caps.platform);
  const translatedPlayback = (!byok || providerMode === "openai") && (caps.translatedPlayback ?? true);
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
    contextSaveTimer.current=timer;
    return ()=>clearTimeout(timer);
  },[translationContext,contextReady]);
  useEffect(()=>{
    if(byok || audioOpen!=='context' || !session) return;
    let cancelled=false;
    const requestedOwner=session.user.id;
    setRefillHistory({owner:requestedOwner,rows:[],status:'loading'});
    void (async()=>{
      await sync();
      const [rows,snapshots]=await Promise.all([listHistory(requestedOwner,{all:true}),loadContextSessions(requestedOwner)]);
      if(!cancelled && owner.current===requestedOwner) {
        setContextSessions(snapshots);
        setRefillHistory({owner:requestedOwner,rows,status:'ready'});
      }
    })().catch(()=>{
      if(!cancelled && owner.current===requestedOwner) setRefillHistory({owner:requestedOwner,rows:[],status:'error'});
    });
    return()=>{cancelled=true;};
  },[audioOpen,session?.user.id,byok]);
  const recordingHistory = useRef(false);
  const historyStartedAt = useRef<string | undefined>(undefined);
  const historySync = useRef<Promise<void> | undefined>(undefined);
  async function clearSavedHistory(requestedOwner: string, clearDraft = true) {
    if(outbox.current?.owner===requestedOwner)outbox.current.clear();
    await removeContextSessions(requestedOwner);
    if(owner.current===requestedOwner) {
      setHistory([]);setContextSessions([]);setIntelligenceSession(null);
      if(!recordingHistory.current)setSegments([]);
      setRefillHistory({owner:requestedOwner,rows:[],status:'ready'});
      if(clearDraft && !recordingHistory.current)await clearSessionContext();
    }
  }
  const sync = () => {
    if(modeRef.current!=="audeeo" || historyPaused.current)return Promise.resolve();
    if (historySync.current) return historySync.current;
    const work = (async () => {
    try {
      const box = outbox.current;
      if(!box)return;
      const settings=await getSessionHistorySettings(box.owner);
      if(owner.current!==box.owner)return;
      historySettings.current={...settings,owner:box.owner};
      setSave(settings.saveSessions);setSaveReady(true);
      if(!settings.saveSessions) {
        const marker=`${box.owner}:${settings.generation}`;
        await clearSavedHistory(box.owner,clearedHistory.current!==marker);
        clearedHistory.current=marker;
        setSyncState('Session saving is off');
        return;
      }
      const contexts=await pruneContextSessions(box.owner,settings.generation);
      if(owner.current!==box.owner)return;
      setContextSessions(contexts);

      box.prune(settings.generation);
      if (!recordingHistory.current) box?.completeSessions();
      await box?.flush();
      setSyncState(
        outbox.current?.pending ? "Waiting to sync" : "History synced",
      );
    } catch {
      if(!historySettings.current)setIssue('Save sessions settings could not load. Reconnect and reopen History to retry.');
      setSyncState("Saved on this device · waiting to sync");
    }
    })();
    historySync.current = work.finally(() => { historySync.current = undefined; });
    return historySync.current;
  };
  useEffect(() => {
    // Remove the prototype's consumer credential storage without reading or exposing its value.
    localStorage.removeItem("audeeo_api_key");
    void capabilities()
      .then((next) => {
        setCaps(next);
        if ((next.platform === "macos" || next.platform === "windows") && next.systemAudio) setInput("system");
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
        recordingHistory.current = false;
        outbox.current?.completeSessions();
        generation.current++;
        setSegments([]);
        setHistory([]);
        historySettings.current=undefined;setSave(false);setSaveReady(false);setSaveConfirmation(null);
        setContextSessions([]);
        setRefillHistory({owner:'',rows:[],status:'loading'});
        setStatus("idle");resumeCapture.current=undefined;captureBillingPaused.current=false;setUsagePaused(false);setPackConsent(false);setVoicePending(false);
        void clearSessionContext();
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
        ? outbox.current?.owner === next.user.id ? outbox.current : new HistoryOutbox(
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
    setOnboardingComplete(saved === "audeeo");
  }, [capsReady, authReady, desktop, session?.user.id]);
  useEffect(() => {
    localStorage.setItem("audeeo.overlay-appearance", JSON.stringify(appearance));
    localStorage.setItem("audeeo.opaque", String(opaque));
    localStorage.setItem("audeeo.show-source", String(showSource));
    localStorage.setItem("audeeo.auto-hide", String(autoHide));
    if (caps.platform === "macos")
      void invoke("update_overlay", {
        source: captionMode === "subtitles" || showSource ? segments.map(segment => segment.sourceText).join(" ").slice(-4096) : "",
        translation: captionMode === "translate" ? segments.map(segment => segment.translatedText).join("").slice(-4096) : "",
        size: appearance.fontSize,
        opaque,
        recording: status === "live",
        preferences: {
          appearance,
          controlsOpen: !!audioOpen,
          showSource: captionMode === "subtitles" || showSource,
          autoHide,
          status,
          direction:
            captionMode === "subtitles" ? `${languageName(source)} captions` : `${languageName(source)} → ${languageName(target)}`,
          message: issue,
          authenticated: !!session || byok,
        },
      });
  }, [
    latest,
    translated,
    segments,
    audioOpen,
    caps.platform,
    appearance,
    opaque,
    caps.globalOverlay,
    status,
    showSource,
    autoHide,
    source,
    target,
    captionMode,
    issue,
    session, byok,
  ]);
  useEffect(() => {
    if (desktop)
      void invoke("resize_main_window", {
        // Keep room for two caption lines while the setup summary stays on one line.
        height: onboardingVisible || aiSetupVisible || providerSetupVisible ? 800 : expanded ? 500 : Math.max(224, Math.ceil(appearance.fontSize * 2.7) + 159),
        ...(onboardingVisible || aiSetupVisible || providerSetupVisible ? { onboarding: true } : {}),
      }).catch(() =>
        setIssue("The window couldn’t resize. You can resize it from an edge."),
      );
  }, [expanded, onboardingVisible, aiSetupVisible, providerSetupVisible, desktop, appearance.fontSize]);
  useEffect(() => {
    if (!desktop || !overlaySurface) return;
    void invoke("resize_overlay_width", {width: appearance.panelWidth}).catch(() =>
      setIssue("The overlay width couldn’t be changed. You can still resize it from an edge."),
    );
  }, [desktop, overlaySurface, appearance.panelWidth]);
  useEffect(() => {
    if (caps.platform !== 'macos' && caps.platform !== 'windows') return;
    void invoke('set_window_mode', {overlay: overlaySurface, clear: overlaySurface && !opaque && (appearance.backgroundOpacity < 1 || appearance.overlayOpacity < 1)})
      .catch(() => setIssue("The window appearance couldn’t be changed. Please restart Audeeo."));
  }, [overlaySurface, appearance.backgroundOpacity, appearance.overlayOpacity, opaque, caps.platform]);
  useEffect(() => {
    if (!translatedPlayback) { dispatch({type:'playing', value:false}); return; }
    if (caps.platform !== 'macos') { browserPlayback.current?.setVolume(translatedMuted ? 0 : translatedVolume); return; }
    void invoke('audio_output', {command: {volume: translatedMuted ? 0 : translatedVolume}}).catch(()=>undefined);
  }, [translatedVolume, translatedMuted, caps.platform, translatedPlayback]);
  useEffect(() => {
    capture.current?.setGains?.({
      microphone: microphoneMuted ? 0 : microphoneGain,
      system: desktopMuted ? 0 : desktopGain,
    });
  }, [microphoneGain, microphoneMuted, desktopGain, desktopMuted]);
  useEffect(() => {
    if (caps.platform !== 'macos') return;
    let disposed = false, unlisten: (() => void) | undefined;
    void listen<number>('playback-state', ({payload}) => {
      dispatch({type: 'playing', value: payload > 0});
      if (payload < 0) { setIssue('Audio playback stopped after a device change or buffer overflow. Restart captions.'); void stopCurrent.current(); }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; unlisten?.(); void invoke('audio_output', {command:{stop:true}}); };
  }, [caps.platform]);
  useEffect(() => {
    if (expanded) {
      if (view === "settings" || view === "history") pageHeading.current?.focus();
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
      if (caps.platform === 'macos') await invoke('audio_output', {command:{stop:true}});
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
      finally {
        recordingHistory.current = false; client.current = undefined; setStatus("idle");
        await clearSessionContext(); }
    }
    await sync();
    })();
    stopInProgress.current = work;
    try { await work; } catch (error) { setIssue(error instanceof Error ? error.message : String(error)); } finally { stopInProgress.current = undefined; }
  }
  const stopCurrent = useRef(stop);
  stopCurrent.current = stop;
  useEffect(()=>{
    if (!byok && !aiConsentAccepted && active) void stopCurrent.current();
  },[byok,aiConsentAccepted,active]);
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
    if (screenCaptureRunning.current || savePending || (!byok && session && !saveReady)) return;
    if (!byok && !session) { openPage("account"); return; }
    if (byok && (!desktop || !keysReady)) {setIssue('Personal keys are available in the desktop app.');return;}
    if (byok) {try {personalKey(providerMode,providerKeys);}catch(error){setIssue(String(error));setProviderSetupRequested(true);return;}}
    const consentOwner = session?.user.id;
    if (!byok && (!await requestConsent('captions') || owner.current !== consentOwner)) return;
    const run = ++generation.current;
    const shouldSave = !byok && (historySettings.current?.saveSessions ?? false);
    const saveGeneration = historySettings.current?.generation;
    const contextOwner = session?.user.id ?? "local";
    let contextArchived = false;
    const sessionOutbox = outbox.current;
    recordingHistory.current = true;
    historyStartedAt.current = new Date().toISOString();
    setIssue("");

    setSegments([]);
    setStatus("connecting");

    const event = (e: RelayEvent) => {
      if (run !== generation.current) return;
      if(e.type==='billing') {captureBillingPaused.current=e.paused;captureTransition.current=captureTransition.current.then(async()=>{if(run!==generation.current)return;if(captureBillingPaused.current)await capture.current?.stop();else await resumeCapture.current?.();}).catch(()=>{setIssue('Capture could not resume. Restart the session.');void stopCurrent.current();});setSpokenTranslation(e.voiceEnabled);setVoicePending(false);setUsagePaused(e.paused);if(!e.paused)setPackConsent(false);if(e.message)setIssue(e.message);}
      if(e.type==='pack_consent_required'){setPackConsent(true);setUsagePaused(true);}
      if(e.type==='status' && (e.state==='voice_failed'||e.state==='control_failed')){setVoicePending(false);setIssue(e.message);}
      if(e.type==='audio_reset'){browserPlayback.current?.stop();if(caps.platform === 'macos')void invoke('audio_output',{command:{reset:true}});}
      if (e.type === "segment") {

        setSegments((previous) => {
          const existing = previous.find((s) => s.id === e.segment.id);
          if (existing && existing.revision > e.segment.revision)
            return previous;
          return [...previous.filter((s) => s.id !== e.segment.id), e.segment]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-128);
        });
        if (byok && localSave && e.segment.final) {
          try {saveLocalSegment(localStorage,e.segment,historyStartedAt.current!);}
          catch {setIssue('Local history could not be saved. Export your transcript and free up storage.');void stopCurrent.current();}
        }
        if (shouldSave && e.segment.final) {
          try {
            sessionOutbox?.enqueue(e.segment, historyStartedAt.current,saveGeneration);
            if (!contextArchived && hasSessionContext(translationContext) && (e.segment.sourceText || e.segment.translatedText)) {
              contextArchived = true;
              void saveContextSession({owner:contextOwner,id:e.segment.sessionId,startedAt:historyStartedAt.current!,source,target,historyGeneration:e.segment.historyGeneration ?? saveGeneration,
                label:(translationContext.text || translationContext.terms.join(', ') || e.segment.sourceText || e.segment.translatedText).replace(/\s+/g,' ').slice(0,80),context:translationContext})
                .then(items=>{if(owner.current===contextOwner)setContextSessions(items);})
                .catch(()=>{contextArchived=false;if(owner.current===contextOwner)setIssue('Session context could not be saved for refill.');});
            }
            setSyncState("Saving on this device");
          } catch (err) {
            setIssue(String(err));
            void stop();
          }
        }
      }
      if (e.type === 'audio' && translatedPlayback && caps.platform !== 'macos') {
        try { browserPlayback.current?.enqueue(e.pcm); } catch (error) { setIssue('Spoken translation playback failed. Captions continue; retry voice.'); browserPlayback.current?.stop();client.current?.control({type:'voice',enabled:false}); }
      }
      if (e.type === "audio" && translatedPlayback && caps.platform === 'macos') {
        dispatch({type:'playing', value:true});
        void invoke('audio_output', {command:{pcm:e.pcm}}).catch(() => { setIssue('Spoken translation playback failed. Captions continue; retry voice.'); dispatch({type:'playing',value:false});client.current?.control({type:'voice',enabled:false}); });
      }
      if (e.type === "error") {

        setIssue(e.message);

        void capture.current?.stop();
      }
      if (e.type === "finished") {
        recordingHistory.current = false;
        if (e.reason === "silence timeout") setIssue("Stopped after silence to save usage. Press Start to resume.");
        client.current = undefined;
        void capture.current?.stop();
        capture.current = undefined;
        setStatus("idle");resumeCapture.current=undefined;captureBillingPaused.current=false;setUsagePaused(false);setPackConsent(false);setVoicePending(false);
        void clearSessionContext();
        void sync();
      }
    };
    try {
      if (caps.platform !== "macos") {
        await browserPlayback.current?.prepare();
      } else {
        await invoke("audio_output", {command:{reset:true}});
      }
      const token = byok ? '' : (await supabase!.auth.getSession()).data.session?.access_token;
      if (!byok && !token) throw new Error("Sign in again to continue.");
      const relay = byok
        ? new DirectCaptionClient(providerMode,personalKey(providerMode,providerKeys),event)
        : new RealtimeTranslationClient(relayURL,event);
      client.current = relay;
      await relay.connect(token ?? "", source, target, silence, {voiceEnabled: spokenTranslation && translatedPlayback, allowPurchasedMinutes: false}, translationContext);
      if (run !== generation.current) {
        await relay.finish();
        return;
      }
      const audio = desktop
        ? new DesktopCapture(input, captureSourceId, {
            microphone: microphoneMuted ? 0 : microphoneGain,
            system: desktopMuted ? 0 : desktopGain,
          })
        : input === "system"
          ? new NativeCapture(input, captureSourceId)
          : new BrowserMicrophone();
      capture.current = audio;
      let audioStarted=false;
      const originalStop=audio.stop.bind(audio);audio.stop=async()=>{audioStarted=false;await originalStop();};
      resumeCapture.current=async()=>{if(audioStarted||run!==generation.current||captureBillingPaused.current)return;audioStarted=true;await audio.start(
        (pcm) => relay.sendAudio(pcm),
        (error) => {
          setIssue(error);
          void stop();
        },
      );
      };
      await captureTransition.current;
      await resumeCapture.current();
      if (run !== generation.current) {
        await audio.stop();
        return;
      }
      setStatus("live");

    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : "Could not start. Retry.";
      setIssue(message);

      try { await capture.current?.stop(); }
      finally {
        capture.current = undefined;
        try { await client.current?.finish(); }
        finally { client.current = undefined; recordingHistory.current = false; setStatus("idle"); await clearSessionContext(); void sync(); }
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
        if (document.querySelector('dialog[open]')) return;
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
      if (payload === "history") void showHistory();
      if (["input", "languages", "context", "audio", "silence"].includes(payload)) {
        setAudioOpen(current => current === payload ? null : payload as ControlGroup);
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
      if (byok) setHistory(localHistory(localStorage));
      else if (session) { await sync(); setHistory(await listHistory(session.user.id)); }
    } catch {
      setIssue("History could not load. Reconnect and try again.");
    }
  }
  async function removeHistory(id: string) {
    try {
      if(byok){deleteLocalSession(localStorage,id);setHistory(localHistory(localStorage));return;}
      outbox.current?.deleteSession(id);
      setHistory((rows) => rows.filter((row) => row.id !== id));
      setRefillHistory(current=>({...current,rows:current.rows.filter(row=>row.id!==id)}));
      if(session) {
        const requestedOwner=session.user.id;
        const items=await removeContextSessions(requestedOwner,id);
        if(owner.current===requestedOwner)setContextSessions(items);
      }
      await sync();
    } catch (e) {
      setIssue(String(e));
    }
  }
  async function openSessionSummary(row: HistorySession) {
    if (!session) return;
    const requestedOwner = session.user.id;
    try {
      const detail = await getHistorySession(requestedOwner, row.id);
      if (owner.current === requestedOwner) setIntelligenceSession(detail);
    } catch { setIssue("Session could not load. Reconnect and try again."); }
  }
  async function exportHistory(row: HistorySession) {
    if (!byok && !session) return;
    const requestedOwner = session?.user.id;
    try {
      if(!byok) row = await getHistorySession(requestedOwner!, row.id);
    } catch { setIssue("Session could not load. Reconnect and try again."); return; }
    if (owner.current !== requestedOwner) return;
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
  async function deleteCurrentAccount() {
    if (!session || billingPending) return;
    const deletingOwner = session.user.id;
    setBillingPending(true);setIssue("");
    try {
      await accountRequest("/v1/account", "DELETE", session, {appleRefreshToken:session.provider_refresh_token || undefined}, 75000);
      const cleanup = await Promise.allSettled([
        removeContextSessions(deletingOwner),
      ]);
      setContextSessions([]);outbox.current?.clear();withdrawAIConsent(deletingOwner);
      setDeleteAccount(false);
      await supabase?.auth.signOut({scope:"local"});
      if (cleanup.some(result=>result.status === "rejected")) setIssue("Account deleted. Some local history could not be cleared; remove Audeeo’s local app data on this device.");
    } catch (error) {setIssue(error instanceof Error ? error.message : "Account deletion failed. Retry.");}
    finally {setBillingPending(false);}
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
  async function fillContextFromScreen() {
    if (byok || !session || active || screenCaptureRunning.current) return;
    const consentOwner = session.user.id;
    if (!await requestConsent('screenshot')) { setAudioOpen(null);setAISetupRequested(true);return; }
    if (owner.current !== consentOwner || screenCaptureRunning.current) return;
    screenCaptureRunning.current = true;
    const captureOwner = session.user.id;
    setScreenCapturePending(true);
    setScreenCaptureIssue("");
    setAudioOpen(null);
    try {
      const raw = await invoke<string>("capture_context_screenshot");
      if (owner.current !== captureOwner) return;
      setAudioOpen("context");
      const image = await prepareContextScreenshot(raw);
      if (!await requestConsent('screenshot') || owner.current !== captureOwner) return;
      const next = await generateContextFromScreenshot(session, image,
        isTranslationTarget(target) ? target : "en");
      if (owner.current === captureOwner) setTranslationContext(next);
    } catch (error) {
      if (owner.current === captureOwner) {
        setScreenCaptureIssue(error instanceof Error ? error.message : String(error));
        setAudioOpen("context");
      }
    } finally {
      screenCaptureRunning.current = false;
      setScreenCapturePending(false);
    }
  }
  function refillContextFromSession(id: string) {
    if(active || screenCaptureRunning.current || !session || refillHistory.owner!==session.user.id || refillHistory.status!=='ready' || !refillHistory.rows.some(row=>row.id===id)) return;
    const snapshot=contextSessions.find(item=>item.id===id && item.owner===session.user.id);
    if(!snapshot) return;
    setTranslationContext(refillSessionContext(snapshot,source,target));
    setScreenCaptureIssue('');
  }
  async function confirmSaveSessions() {
    if(byok && saveConfirmation!==null) {
      try {if(!saveConfirmation)clearLocalHistory(localStorage);localStorage.setItem('audeeo.byok-save',String(saveConfirmation));setLocalSave(saveConfirmation);setHistory(localHistory(localStorage));setSaveConfirmation(null);}
      catch {setSaveIssue('Could not update local history.');}
      return;
    }
    if(saveConfirmation===null || !session || active || historyPaused.current)return;
    const requestedOwner=session.user.id, enabled=saveConfirmation;
    historyPaused.current=true;setSavePending(true);setSaveIssue('');
    try {
      await historySync.current;
      const settings=await setSessionHistorySettings(requestedOwner,enabled);
      if(owner.current!==requestedOwner)return;
      historySettings.current={...settings,owner:requestedOwner};
      setSave(settings.saveSessions);setSaveReady(true);
      if(!settings.saveSessions) {
        await clearSavedHistory(requestedOwner);
        clearedHistory.current=`${requestedOwner}:${settings.generation}`;
      }
      setSyncState(settings.saveSessions ? 'Sessions saved for 30 days' : 'Session saving is off');
      setSaveConfirmation(null);
    } catch {
      setSaveIssue('Could not finish updating Save sessions. Check your connection and try again.');
    } finally {historyPaused.current=false;setSavePending(false);}
  }
  const panelStyle = {
    "--overlay-width": `${appearance.panelWidth}px`,
    ...(overlaySurface ? {
    "--overlay-background": colorWithOpacity(appearance.backgroundColor, opaque ? 1 : appearance.backgroundOpacity),
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
      {saveConfirmation!==null && <SaveSessionsDialog enabled={saveConfirmation} pending={savePending} issue={saveIssue} onCancel={()=>{if(!savePending)setSaveConfirmation(null);}} onConfirm={()=>void confirmSaveSessions()}/>}
      {caps.platform === "windows" && overlaySurface && resizeDirections.map(direction => (
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
      {intelligenceSession && session && aiConsentAccepted && !aiSetupVisible && <SessionIntelligence
        row={intelligenceSession}
        session={session}
        onClose={()=>setIntelligenceSession(null)}
        onSubscription={()=>{setIntelligenceSession(null);openPage("account");}}
        onSaved={(summary: SavedSessionSummary)=>{
          setHistory(rows=>rows.map(row=>row.id===intelligenceSession.id?{...row,summary_title:summary.content.title,session_summaries:[summary]}:row));
          setIntelligenceSession(row=>row?{...row,summary_title:summary.content.title,session_summaries:[summary]}:row);
        }}
      />}
      {caps.platform === "windows" && overlaySurface && (
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
    {providerSetupVisible ? <ProviderSetup keys={providerKeys} mode={providerMode} disabled={active} onBack={view==='providers'?()=>setView('settings'):undefined} onChange={(mode,keys)=>{
      localStorage.setItem('audeeo.connection-mode',mode);setProviderMode(mode);modeRef.current=mode;setProviderKeys(keys);setProviderSetupRequested(false);setSegments([]);setHistory([]);setSpokenTranslation(false);setIssue('');setView('captions');
      if(mode==='audeeo')void sync();
    }}/> : aiSetupVisible && session ? <AIConsentSetup key={session.user.id} owner={session.user.id} user={session.user}
      onAccount={()=>{setAISetupRequested(false);openPage('account');}}
      onContinue={()=>{setAISetupRequested(false);setIssue('');setView('captions');}}
      onBack={view === 'account' ? ()=>setAISetupRequested(false) : undefined}
      onSignOut={()=>{setAISetupRequested(false);void signOut();}}
    /> : onboardingVisible ? <DesktopOnboarding
      key={session?.user.id || "signed-out"}
      session={session}
      platform={caps.platform}
      configured={Boolean(supabase)}
      authPending={authPending}
      error={issue}
      onSocialSignIn={provider => void authenticate(provider)}
      onEmailSignIn={authenticateEmail}
      onEmailSignUp={createEmailAccount}
      onSignOut={signOut}
      onResetAuth={() => { setAuthPending(false); setIssue(""); }}
      onUsePersonalKey={()=>setProviderSetupRequested(true)}
      onComplete={mode => {
        if (!session) return;
        localStorage.setItem(desktopOnboardingKey(session.user.id), mode);
        setOnboardingComplete(true);
        setView("captions");
      }}
    /> : (
    <main
      data-platform={caps.platform}
      className={`subtitle-panel ${expanded ? "expanded settings-surface" : ""} ${caps.platform === "browser" ? "browser-panel" : ""} ${overlaySurface ? "custom-overlay" : ""} ${autoHide && status === "live" ? "auto-hide" : ""} ${audioOpen && !expanded ? "popover-open" : ""}`}
      style={panelStyle}
    >
      <header className={`panel-header${expanded ? " settings-header" : ""}`}>
        <div className="header-leading">
        {expanded ? (
          <div className="page-title">
            {view !== "settings" && view !== "history" && <Button ref={settingsBack} className="settings-back" aria-label="Back to Settings" onClick={() => {setDeleteAccount(false); openPage("settings");}}><ArrowLeft/><span>Settings</span></Button>}
            {(view === "settings" || view === "history") && <h1 ref={pageHeading} tabIndex={-1} className="visually-hidden">{view === "history" ? "History" : "Settings"}</h1>}
          </div>
        ) : (
          <CaptureStatus {...{input,status,playing,captureSourceId,captionMode,source,target,translationContext,silence,microphoneMuted,desktopMuted,translatedMuted}}
            platform={caps.platform} inputGain={inputGain} translatedPlayback={translatedPlayback}
            {...{microphoneGain,desktopGain,translatedVolume}}
            onOpen={setAudioOpen} paused={audioOpen !== null}/>
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
              aria-label="Open history"
              title="History"
              aria-pressed={view === "history"}
              onClick={() => void showHistory()}
            >
              <History />
            </Button>
            <Button
              className="icon-button"
              aria-label="Open settings"
              title="Caption settings"
              aria-pressed={expanded && view !== "history"}
              onClick={() => openPage("settings")}
            >
              <Settings2 />
            </Button>

          </div>
      </header>
      <div className="page-content" key={view}>
        {expanded && view !== "settings" && view !== "history" && <h1 ref={pageHeading} tabIndex={-1} className="settings-section-title">
          {view === "overlay" ? "Overlay" : view === "configuration" ? "Audio & languages" : "Account"}
        </h1>}
        {!expanded && <LiveCaptions source={captionMode === 'subtitles' || showSource ? segments.map(s => s.sourceText).join(' ') : ''} translation={captionMode === 'translate' ? segments.map(s => s.translatedText).join('') : ''} sourceLanguage={source} targetLanguage={target} size={appearance.fontSize}/>}
        {!expanded && <Button
          className={`content-session-toggle${status === "idle" && !playing ? " is-start" : ""}${active ? " is-stop" : ""}${status === "connecting" || status === "stopping" ? " is-busy" : ""}`}
          aria-label={status === "connecting" ? "Connecting" : status === "stopping" ? "Finishing captions" : active ? "Stop captions" : "Start captions"}
          title={status === "connecting" ? "Connecting" : status === "stopping" ? "Finishing captions" : active ? "Stop captions" : "Start captions"}
          disabled={screenCapturePending || savePending || (!byok && !!session && !saveReady) || status === "connecting" || status === "stopping" || (!!session && !caps.microphone && input === "microphone")}
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
            </Button>

            {desktop && <Button disabled={active} onClick={()=>openPage('providers')}><Settings2/><span>Caption service</span></Button>}
            <Button onClick={() => openPage("account")}>
              <UserRound />
              <span>Account</span>
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
          </>
        )}
        {view === "history" && (
          <section className="history-list" aria-label="Saved history">
            <section className="history-group" aria-labelledby="history-saving-heading">
              <h2 id="history-saving-heading">Preferences</h2>
              <div className="settings-panel history-preferences">
            <label className="setting-toggle"><span>Save sessions</span><input type="checkbox" checked={byok?localSave:save} disabled={active||savePending||(!byok&&(!saveReady||!session))} onChange={e=>{setSaveIssue('');setSaveConfirmation(e.target.checked);}}/></label>
              </div>
            </section>
            <section className="history-group" aria-labelledby="history-sessions-heading">
              <div className="history-section-heading">
                <h2 id="history-sessions-heading">Sessions</h2>
                {(byok||session) && <p className="history-sync-status" role="status">{byok?"Stored on this device":syncState || "Saved text"} · Latest 100</p>}
              </div>
              <div className="settings-panel history-sessions">
            {!byok && !session && (
              <>
              <p className="empty-history">Sign in to see your history.</p>
              <Button variant="outline" onClick={() => openPage("account")}>
                Go to account
              </Button>
              </>
            )}
            {(byok||session) && !history.length && (
              <p className="empty-history">No saved sessions yet.</p>
            )}
            <HistoryRows rows={history} onSummary={byok?undefined:row=>void openSessionSummary(row)} onExport={row=>void exportHistory(row)} onDelete={id=>void removeHistory(id)}/>
              </div>
            </section>
          </section>
        )}
        {view === "account" && (
          <section className="account-section" aria-label="Account settings">
            {session ? (
              <>
                <AccountProfile user={session.user} disabled={active || billingPending} onSignOut={()=>void signOut()}/>
                <Subscriptions
                  key={session.user.id}
                  session={session}
                  platform={caps.platform}
                  disabled={active}
                  onBusy={setBillingPending}
                  dailyBudget={dailyBudget.value}
                  onDailyBudgetChange={dailyBudget.setMinutes}
                />
                {dailyBudget.storageIssue && <p role="status">{dailyBudget.storageIssue}</p>}
                <section className="account-group" aria-label="Account controls">
                  <h2>Account controls</h2>
                  <div className="settings-panel account-controls">
                    <div><h3>Delete account</h3><Button disabled={active || billingPending} className="account-delete" onClick={()=>setDeleteAccount(true)}>Delete account</Button></div>
                  </div>
                </section>
                {deleteAccount && (
                  <div className="delete-confirmation" role="alert">
                    <p>
                      Delete your account and synchronized history? This cannot
                      be undone. Cancel any subscription separately using Manage
                      subscription before deleting your account.
                    </p>
                    {session.user.identities?.some(identity=>identity.provider === "apple") && <Button disabled={authPending || billingPending} onClick={()=>void authenticate("apple")}>Reconnect with Apple</Button>}
                    <Button
                      variant="outline"
                      onClick={() => setDeleteAccount(false)}
                    >
                      Keep account
                    </Button>
                    <Button
                      disabled={billingPending}
                      onClick={() => void deleteCurrentAccount()}
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
      {usagePaused && <div className="notice" role="status">Session paused · No usage charged<Button onClick={()=>setPackConsent(true)}>Continue with purchased minutes</Button></div>}
      {packConsent && <div className="dialog-backdrop"><section className="intelligence-dialog" role="dialog" aria-modal="true" aria-label="Use purchased minutes?">
        <h2>Use purchased minutes?</h2><p>Your included minutes are used up. Continue using purchased minutes for this session?</p>
        <p>{spokenTranslation ? 'Spoken translation uses 3 usage minutes per minute.' : 'Captions use 1 usage minute per minute.'} Paused time uses no minutes.</p>
        <Button onClick={()=>{setPackConsent(false);client.current?.control({type:'use_packs'});}}>Use purchased minutes</Button>
        <Button variant="outline" onClick={()=>{setPackConsent(false);void stop();}}>Stop session</Button>
      </section></div>}
      {dailyBudget.reminder && <div className="notice daily-budget-notice" role="status"><span>Daily reminder: you’ve used {dailyBudget.reminder.minutes} minutes today. You can keep listening.</span><Button aria-label="Dismiss daily reminder" onClick={dailyBudget.dismiss}><X aria-hidden="true"/></Button></div>}
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
        {...{spokenTranslation,voicePending,setSpokenTranslation:changeSpokenTranslation,silence,setSilence,input,setInput,active,captureSourceId,setCaptureSourceId,captionMode,setCaptionMode,source,setSource,target,setTarget,microphoneGain,setMicrophoneGain,microphoneMuted,setMicrophoneMuted,desktopGain,setDesktopGain,desktopMuted,setDesktopMuted,translatedVolume,setTranslatedVolume,translatedMuted,setTranslatedMuted,translationContext,setTranslationContext}}
        onFillContextFromScreen={!byok && session && isTauri() && ["macos","windows"].includes(caps.platform) ? ()=>void fillContextFromScreen() : undefined}
        screenCapturePending={screenCapturePending}
        screenCaptureIssue={screenCaptureIssue}
        refillContextSessions={refillHistory.owner===session?.user.id ? contextRefillOptions(refillHistory.rows,contextSessions,session.user.id) : []}
        refillContextStatus={refillHistory.owner===session?.user.id ? refillHistory.status : 'loading'}
        onRefillContextFromSession={session ? refillContextFromSession : undefined}
        open={audioOpen}
        setOpen={setAudioOpen}
        systemAudio={caps.systemAudio}
        applicationAudio={applicationAudio}
        platform={caps.platform}
        inputGain={inputGain}
        translatedPlayback={translatedPlayback}
      />}
      {(view === "settings" || view === "account") && <LegalFooter build={view === "account" ? {platform:caps.platform,distribution:config.distribution} : undefined}/>}
    </main>
    )}
    </>
  );
}
