// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  contextStore: null as string | null,
  listHistory: vi.fn(),
  getHistorySettings: vi.fn(),
  setHistorySettings: vi.fn(),
  relayEvent: undefined as any,
  playbackEvent: undefined as any,
  captureStop: vi.fn(),
  finish: vi.fn(),
  connect: vi.fn(),
  contextFromScreenshot: vi.fn(),
  destroy: vi.fn(),
  session: null as any,
  authChanged: undefined as any,
  overlayAction: undefined as any,
  close: undefined as
    undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  platform: "macos",
  realAIConsent: false,
  startResizeDragging: vi.fn(),
  captureGains: vi.fn(),
}));
vi.mock("../src/components/AIConsent",async original=>{
  const actual=await original<typeof import('../src/components/AIConsent')>();
  return {...actual,useAIConsent:(owner?:string)=>native.realAIConsent ? actual.useAIConsent(owner) : {requestConsent:async()=>true,accepted:true,screenAllowed:true}};
});
vi.mock("../src/lib/contextScreenshot",()=>({prepareContextScreenshot:async(image:string)=>image}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, fn: any) => {
    if (name === "playback-state") native.playbackEvent = fn;
    if (name === "overlay-action") native.overlayAction = fn;
    return () => {};
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (callback: typeof native.close) => {
      native.close = callback;
      return () => {};
    },
    destroy: native.destroy,
    startResizeDragging: native.startResizeDragging,
  }),
}));
vi.mock("../src/lib/account", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: native.session } }),
      onAuthStateChange: (callback: any) => {
        native.authChanged = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => {
        native.session = null;
        native.authChanged("SIGNED_OUT", null);
      },
    },
  },
  signIn: vi.fn(),
  signInWithEmailPassword: vi.fn(),
  signUpWithEmailPassword: vi.fn(),
  listenForAuth: async () => () => {},
  historyRemote: { write: vi.fn(), delete: vi.fn() },
  listHistory: native.listHistory,
  getSessionHistorySettings: native.getHistorySettings,
  setSessionHistorySettings: native.setHistorySettings,
  relayURL: "http://localhost:8787",
  accountRequest: vi.fn(),
  nativePurchase: vi.fn(),
  contextFromScreenshot: native.contextFromScreenshot,
}));
vi.mock('../src/lib/directCaptions',()=>({DirectCaptionClient:class {
 constructor(_provider:string,_key:string,event:any){native.relayEvent=event;}
 async connect(...args:any[]){native.connect(...args);native.relayEvent({type:'ready',sessionId:'local-session'});}
 sendAudio(){}
 finish=native.finish;
}}));
vi.mock('../src/lib/realtime',()=>({
  RealtimeTranslationClient: class {
    constructor(_endpoint: string, event: any) { native.relayEvent=event; }
    async connect(...args: any[]) { native.connect(...args); native.relayEvent({type:'ready',sessionId:'test-session'}); }
    sendAudio() {}
    finish=native.finish;
  },
}));
vi.mock('../src/lib/platform', async importOriginal => ({
  ...await importOriginal<any>(),
  NativeCapture: class { async start() {} stop=native.captureStop; },
}));
vi.mock('../src/lib/playback', () => ({
  BrowserPlayback: class {
    async prepare() {}
    enqueue() {}
    setVolume() {}
    stop() {}
    dispose() {}
  },
}));
vi.mock('../src/lib/desktopCapture',()=>({
  DesktopCapture: class {
    setGains=native.captureGains;
    async start() {}
    stop=native.captureStop;
  },
}));
vi.mock('../src/lib/controlPopup', async original => ({...await original<any>(), supportsDetachedControls:()=>false}));
import App from "../src/App";
import { emptySessionContext } from '../shared/context';
beforeEach(() => {
  localStorage.setItem("audeeo.connection-mode", "audeeo");
  native.realAIConsent = false;
  native.getHistorySettings.mockReset().mockResolvedValue({saveSessions:true,generation:1,retentionDays:30});
  native.setHistorySettings.mockReset().mockImplementation(async (_owner,enabled)=>({saveSessions:enabled,generation:2,retentionDays:30}));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
  native.contextStore = null;
  native.listHistory.mockReset().mockResolvedValue([]);
  native.connect.mockReset();
  native.contextFromScreenshot.mockReset().mockResolvedValue({category:'education',text:'Screen lecture',terms:['eudaimonia'],translationTerms:[]});
  native.captureStop.mockReset().mockResolvedValue(undefined);
  native.finish.mockReset().mockImplementation(async()=>native.relayEvent?.({type:"finished",reason:"finished"}));
  native.session = {
    user: { id: "test-owner", email: "caption-test@example.test" },
    access_token: "test-only-token",
  };
  localStorage.setItem("audeeo.onboarding.desktop.test-owner", "audeeo");
  native.invoke.mockReset().mockImplementation(async (command: string, args?: any) => {
    if(command === 'context_storage_get') return native.contextStore;
    if(command === 'context_storage_set') { native.contextStore=args.value; return; }
    return command === "platform_capabilities"
      ? {
          platform: native.platform,
          microphone: true,
          systemAudio: true,
          globalOverlay: true,
        }
      : command === "capture_context_screenshot" ? "data:image/jpeg;base64,/9j/AA==" : undefined;
  });
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.startResizeDragging.mockReset().mockResolvedValue(undefined);
  native.captureGains.mockReset();
  native.platform = "macos";
  native.close = undefined;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("uses one normal caption window after authentication", async () => {
  render(<App />);
  const start = await screen.findByRole('button', {name:'Start captions'});
  expect(start.closest('.page-content')).toBeTruthy();
  expect(start.closest('[role="toolbar"]')).toBeNull();
  expect(screen.getByLabelText('Live captions')).toBeTruthy();
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('set_window_mode', {overlay:false,clear:false}));
  expect(native.invoke).not.toHaveBeenCalledWith('set_overlay_visible', expect.anything());
});
it("uses native window chrome while idle and custom resize handles only during a session", async () => {
  native.platform = "windows";
  const user = userEvent.setup();
  const {container} = render(<App />);
  await screen.findByRole('button', {name:'Start captions'});
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('set_window_mode', {overlay:false,clear:false}));
  expect(container.querySelector('.window-resize-handle')).toBeNull();
  expect(container.querySelector('.window-drag-grip')).toBeNull();
  await user.click(screen.getByRole('button', {name:'Start captions'}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('set_window_mode', {overlay:true,clear:true}));
  const corner = container.querySelector('.resize-southeast');
  expect(corner).toBeTruthy();
  fireEvent.pointerDown(corner!, {button: 0});
  expect(native.startResizeDragging).toHaveBeenCalledWith('SouthEast');
  await user.click(screen.getByRole('button', {name:'Stop captions'}));
  await waitFor(()=>expect(container.querySelector('.window-resize-handle')).toBeNull());
  expect(container.querySelector('.window-drag-grip')).toBeNull();
});
it("puts independent audio controls in the panel and returns from Settings", async () => {
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', {name:'Source'}));
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Input source'}).textContent).toBe('Desktop audio'));
  await user.click(screen.getByRole('combobox',{name:'Input source'}));
  expect(screen.getAllByRole('option').map(option=>option.textContent)).toEqual(['Microphone (your input)','Desktop audio']);
  await user.click(screen.getByRole('option',{name:'Microphone (your input)',exact:true}));
  await user.click(screen.getByRole('button',{name:'Languages'}));
  await user.click(screen.getByRole('combobox',{name:'Caption mode'}));
  await user.click(screen.getByRole('option',{name:'Translation',exact:true}));
  await user.click(screen.getByRole('combobox',{name:'Source language'}));
  await user.click(screen.getByRole('option',{name:'English',exact:true}));
  expect(screen.getByRole('combobox',{name:'Target language'}).textContent).toBe('Chinese (Traditional)');
  await user.click(screen.getByRole('combobox',{name:'Target language'}));
  await user.click(screen.getByRole('option',{name:'Japanese',exact:true}));
  expect(screen.getByRole('combobox',{name:'Source language'}).textContent).toBe('English');
  await user.click(screen.getByRole('button',{name:'Volume'}));
  await user.click(screen.getByRole('button', {name:'Mute microphone input'}));
  expect(screen.getByRole('button', {name:'Mute microphone input'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', {name:'Mute desktop audio input'})).toBeNull();
  await user.click(screen.getByRole('button', {name:'Mute translated audio'}));
  expect(native.invoke).toHaveBeenLastCalledWith('audio_output', {command:{volume:0}});
  await user.click(screen.getByRole('button', {name:'Open settings'}));
  expect(screen.getByRole('heading', {name:'Settings'})).toBeTruthy();
  await user.click(screen.getByRole('button', {name:'Overlay settings'}));
  expect(screen.getByRole('heading', {name:'Panel'})).toBeTruthy();
  expect(screen.getByText('Every word, clearly.').closest('.overlay-preview-group')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Window width', {selector:'#panel-width'}), {target:{value:'840'}});
  expect(screen.getByLabelText('Background opacity')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Width', {selector:'#border-width'}), {target:{value:'0'}});
  expect(JSON.parse(localStorage.getItem('audeeo.overlay-appearance')!)).toMatchObject({panelWidth:840,borderWidth:0});
  const originalLanguage = screen.getByRole('checkbox', {name:/Show original language/}) as HTMLInputElement;
  expect(originalLanguage.checked).toBe(true);
  await user.click(originalLanguage);
  expect(originalLanguage.checked).toBe(false);
  expect(localStorage.getItem('audeeo.show-source')).toBe('false');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', {name:'Start captions'})).toBeTruthy();
  expect(native.invoke).not.toHaveBeenCalledWith('resize_overlay_width', {width:840});
  await user.click(screen.getByRole('button', {name:'Start captions'}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('resize_overlay_width', {width:840}));
  expect(native.invoke).not.toHaveBeenCalledWith('hide_settings_window');
});
it("toggles a caption dropdown closed from its active trigger", async () => {
  const user = userEvent.setup(); render(<App />);
  const context = await screen.findByRole('button', {name:'Context'});
  await user.click(context);
  expect(screen.getByRole('dialog', {name:'Context'})).toBeTruthy();
  expect(context.getAttribute('aria-expanded')).toBe('true');
  await user.click(context);
  expect(screen.queryByRole('dialog', {name:'Context'})).toBeNull();
  expect(context.getAttribute('aria-expanded')).toBe('false');
});
it("controls the selected Windows input without changing OS volume", async () => {
  native.platform = "windows";
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button',{name:'Volume'}));
  await waitFor(()=>expect(screen.getByLabelText('Desktop audio input gain')).toBeTruthy());
  expect(screen.queryByLabelText('Microphone input gain')).toBeNull();
  expect((screen.getByLabelText('Desktop audio input gain') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('Translated audio volume') as HTMLInputElement).disabled).toBe(false);
  expect(screen.queryByText('Input volume affects only the audio sent to captions. It does not change what you hear.')).toBeNull();
  await user.click(screen.getByRole('button',{name:'Mute desktop audio input'}));
  expect(native.invoke.mock.calls.some(([,payload])=>payload?.command?.sourceVolume !== undefined)).toBe(false);
});
it("applies gain and mute to a live desktop capture", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button',{name:'Start captions'}));
  await screen.findByRole('button',{name:'Stop captions'});
  await user.click(screen.getByRole('button',{name:'Volume'}));
  await user.click(screen.getByRole('button',{name:'Mute desktop audio input'}));
  await waitFor(()=>expect(native.captureGains).toHaveBeenLastCalledWith({microphone:1,system:0}));
  await user.click(screen.getByRole('button',{name:'Mute desktop audio input'}));
  fireEvent.change(screen.getByLabelText('Desktop audio input gain'),{target:{value:'0.4'}});
  await waitFor(()=>expect(native.captureGains).toHaveBeenLastCalledWith({microphone:1,system:0.4}));
});
it("cleans up playback before closing the sole window", async () => {
  render(<App />);
  await waitFor(()=>expect(native.close).toBeTypeOf('function'));
  await act(async()=>{await native.close!({preventDefault:vi.fn()});});
  expect(native.invoke).toHaveBeenCalledWith('audio_output', {command:{stop:true}});
  expect(native.destroy).toHaveBeenCalledOnce();
});
it("returns to the required account gate after sign-out", async () => {
  render(<App />); await screen.findByRole('button', {name:'Start captions'});
  await act(async()=>{native.session=null;native.authChanged('SIGNED_OUT',null)});
  expect(screen.getByRole('heading', {name:'Welcome to Audeeo'})).toBeTruthy();
  expect(screen.queryByLabelText('Live captions')).toBeNull();
});

it('restores normal window chrome in Settings without stopping capture or playback', async()=>{
  const user=userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('set_window_mode',{overlay:true,clear:true}));
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
  expect(native.captureStop).not.toHaveBeenCalled();expect(native.finish).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.filter(([name])=>name==='set_window_mode').at(-1)?.[1]).toEqual({overlay:false,clear:false});
  await user.click(screen.getByRole('button', {name:'Show audio overlay'}));
  expect(native.invoke.mock.calls.filter(([name])=>name==='set_window_mode').at(-1)?.[1]).toEqual({overlay:true,clear:true});
  await user.click(screen.getByRole('button', {name:'Open settings'}));
  await act(async()=>{native.relayEvent({type:'audio',pcm:'AAA=',sampleRate:24000});native.relayEvent({type:'finished',reason:'finished'});});
  expect(native.captureStop).toHaveBeenCalled();
  expect(native.invoke).toHaveBeenCalledWith('audio_output',{command:{pcm:'AAA='}});
  expect(native.invoke.mock.calls.filter(([name])=>name==='set_window_mode').at(-1)?.[1]).toEqual({overlay:false,clear:false});
  await act(async()=>native.playbackEvent({payload:0}));
  expect(native.invoke).toHaveBeenCalledWith('set_window_mode',{overlay:false,clear:false});
  expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
});

it('persists silence controls and sends the selection while keeping the same panel on Start', async () => {
  const user=userEvent.setup(); const view=render(<App/>);
  await user.click(screen.getByRole('button',{name:'Auto-stop'}));
  fireEvent.change(screen.getByLabelText('Silence timeout'),{target:{value:'60'}});
  fireEvent.change(screen.getByLabelText('Silence threshold'),{target:{value:'-50'}});
  expect(JSON.parse(localStorage.getItem('audeeo.silence')!)).toEqual({timeoutSeconds:60,thresholdDbfs:-50});
  view.unmount(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Auto-stop'}));
  expect((screen.getByLabelText('Silence timeout') as HTMLInputElement).value).toBe('60');
  const panel=screen.getByLabelText('Live captions');
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','zh','zh',{timeoutSeconds:60,thresholdDbfs:-50},{voiceEnabled:false,allowPurchasedMinutes:false},expect.objectContaining({category:'general'})));
  expect(screen.getByLabelText('Live captions')).toBe(panel);
  await user.click(screen.getByRole('button',{name:'Auto-stop'}));
  expect((screen.getByLabelText('Silence timeout') as HTMLInputElement).disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Stop captions'}));
  expect(screen.getByLabelText('Live captions')).toBe(panel);
  await user.click(screen.getByRole('button',{name:'Auto-stop'}));
  expect((screen.getByLabelText('Silence timeout') as HTMLInputElement).disabled).toBe(false);
});

it('returns from History to the audio overlay icon without starting a session', async () => {
  const user=userEvent.setup(); render(<App/>);
  const historyButton=await screen.findByRole('button',{name:'Open history'});
  expect(historyButton.nextElementSibling).toBe(screen.getByRole('button',{name:'Open settings'}));
  await user.click(historyButton);
  expect(document.activeElement).toBe(screen.getByRole('heading',{name:'History'}));
  expect(historyButton.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button',{name:'Open settings'}).getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('button',{name:'Back to Settings'})).toBeNull();
  expect(screen.getByRole('checkbox',{name:'Save sessions'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Back to captions'})).toBeNull();
  await user.click(screen.getByRole('button',{name:'Show audio overlay'}));
  expect(screen.getByLabelText('Live captions')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Show audio overlay'}).getAttribute('aria-pressed')).toBe('true');
  expect(native.connect).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Start captions'})).toBeTruthy();
});

it('keeps one window size while switching popovers and restores focus on Escape', async () => {
  const user=userEvent.setup(); render(<App/>);
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('resize_main_window',{height:224}));

  const input=screen.getByRole('button',{name:'Source'});
  await user.click(input);
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window')).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByRole('dialog',{name:'Source'}));
  await user.keyboard('{Tab}');
  expect(document.activeElement).toBe(screen.getByRole('combobox',{name:'Input source'}));
  await user.keyboard(' ');
  expect(screen.getByRole('listbox')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.getByRole('dialog',{name:'Source'})).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(input);
  await user.click(input);
  const drawerCalls=native.invoke.mock.calls.filter(([name])=>name==='set_controls_open').length;
  await user.click(screen.getByRole('button',{name:'Languages'}));
  expect(native.invoke.mock.calls.filter(([name])=>name==='set_controls_open')).toHaveLength(drawerCalls);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.pointerDown(screen.getByLabelText('Live captions'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window')).toHaveLength(1);
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window').at(-1)?.[1]).toEqual({height:224});
  expect(screen.queryByText('Ready to listen')).toBeNull();
  expect(screen.queryByText('Manual direction')).toBeNull();
  expect(screen.getByRole('toolbar',{name:'Caption controls'}).textContent).toBe('SourceLanguagesContextVolumeAuto-stop');
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  await user.click(screen.getByRole('button',{name:/Account/}));
  expect(screen.getByRole('heading',{name:'Account'})).toBeTruthy();
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window').every(([,args])=>args.height<=720)).toBe(true);
});

it('returns each Settings subpage to Settings using its header button', async () => {
  const user=userEvent.setup(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  expect(screen.queryByRole('button',{name:'Back to Settings'})).toBeNull();
  expect(screen.getByRole('region',{name:'Settings'}).textContent).not.toContain('History');
  for (const name of ['Overlay settings', /Account/]) {
    await user.click(screen.getByRole('button',{name}));
    const back=screen.getByRole('button',{name:'Back to Settings'});
    expect(document.activeElement).toBe(back);
    await user.click(back);
    expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Back to Settings'})).toBeNull();
  }
  expect(native.connect).not.toHaveBeenCalled();
});

it('sends independent non-bilingual languages to the relay', async () => {
  const user=userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Languages'}));
  for (const [label,option] of [['Caption mode','Translation'],['Source language','Arabic'],['Target language','Japanese']]) {
    await user.click(screen.getByRole('combobox',{name:label}));
    await user.click(screen.getByRole('option',{name:option,exact:true}));
  }
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','ar','ja',expect.any(Object),{voiceEnabled:false,allowPurchasedMinutes:false},expect.objectContaining({category:'general'})));
  await user.click(screen.getByRole('button',{name:'Stop captions'}));
});

it('opens the Settings overview from its subpages and the standalone History page', async()=>{
  const user=userEvent.setup(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  expect(screen.queryByRole('checkbox',{name:'Save sessions'})).toBeNull();
  for (const [button,heading] of [['Overlay settings','Overlay'],['Open history','History'],['Account','Account']]) {
    await user.click(screen.getByRole('button',{name:new RegExp(button)}));
    expect(screen.getByRole('heading',{name:heading})).toBeTruthy();
    if (heading === 'History') expect(screen.getByRole('checkbox',{name:'Save sessions'})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Open settings'}));
    expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
  }
  await user.click(screen.getByRole('button',{name:'Show audio overlay'}));
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
});
it("edits translation context from the bottom toolbar popover", async () => {
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button',{name:'Context'}));
  await user.click(screen.getByRole('button',{name:'Fill from screen'}));
  await waitFor(()=>expect(native.contextFromScreenshot).toHaveBeenCalledWith(expect.anything(),'data:image/jpeg;base64,/9j/AA==','zh'));
  expect(native.invoke).toHaveBeenCalledWith('capture_context_screenshot');
  expect((screen.getByRole('textbox',{name:'Additional context'}) as HTMLTextAreaElement).value).toBe('Screen lecture');
  expect(JSON.stringify(localStorage)).not.toContain('data:image');
  await user.click(screen.getByRole('combobox',{name:'Context category'}));
  await user.click(screen.getByRole('option',{name:'Philosophy'}));
  expect(screen.queryByRole('heading',{name:'Context'})).toBeNull();
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','zh','zh',expect.any(Object),{voiceEnabled:false,allowPurchasedMinutes:false},expect.objectContaining({category:'philosophy',terms:['eudaimonia']})));
});

it('offers both Chinese scripts in translation source and target menus',async()=>{
  const user=userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Languages'}));
  await user.click(screen.getByRole('combobox',{name:'Caption mode'}));
  await user.click(screen.getByRole('option',{name:'Translation',exact:true}));
  for(const name of ['Source language','Target language']) {
    await user.click(screen.getByRole('combobox',{name}));
    expect(screen.getByRole('option',{name:'Chinese (Traditional)',exact:true})).toBeTruthy();
    expect(screen.getByRole('option',{name:'Chinese (Simplified)',exact:true})).toBeTruthy();
    await user.click(screen.getByRole('option',{name:name==='Source language' ? 'English' : 'Chinese (Simplified)',exact:true}));
  }
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','en','zh-cn',expect.anything(),{voiceEnabled:false,allowPurchasedMinutes:false},expect.anything()));
});

it('refills context from a saved session after stop and app reload',async()=>{
  const user=userEvent.setup(); const view=render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Context'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Additional context'}),{target:{value:'Workshop context'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Names and terms'}),{target:{value:'Entropy'}});
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await screen.findByRole('button',{name:'Stop captions'});
  act(()=>native.relayEvent({type:'segment',segment:{id:'segment-1',sessionId:'session-context-test',sequence:0,revision:1,startMs:0,endMs:1000,sourceLanguage:'zh',targetLanguage:'zh',sourceText:'課程內容',translatedText:'',final:true,state:'complete'}}));
  await user.click(screen.getByRole('button',{name:'Stop captions'}));
  await waitFor(()=>expect(JSON.parse(native.contextStore!).text).toBe(''));
  expect(JSON.parse(native.contextStore!).savedContexts[0].context.text).toBe('Workshop context');
  native.listHistory.mockResolvedValue([{id:'session-context-test',started_at:'2026-09-15T22:00:00Z',summary_title:'Thermodynamics workshop',source_language:'zh',target_language:'zh',segments:[],session_summaries:[]}]);
  view.unmount(); render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Context'}));
  expect((screen.getByRole('textbox',{name:'Additional context'}) as HTMLTextAreaElement).value).toBe('');
  await user.click(screen.getByRole('combobox',{name:'Refill from session'}));
  await user.click(await screen.findByRole('option',{name:'Thermodynamics workshop'}));
  expect((screen.getByRole('textbox',{name:'Additional context'}) as HTMLTextAreaElement).value).toBe('Workshop context');
  expect((screen.getByRole('textbox',{name:'Names and terms'}) as HTMLTextAreaElement).value).toBe('Entropy');
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect.mock.calls.at(-1)?.[5]).toMatchObject({text:'Workshop context',terms:['Entropy']}));
});

it('loads all history with titles or readable fallbacks instead of dates',async()=>{
  native.listHistory.mockResolvedValue([
    {id:'older-1',started_at:'2026-09-14T12:00:00Z',summary_title:'Yesterday’s lecture',segments:[],session_summaries:[]},
    {id:'older-2',started_at:'2026-09-13T12:00:00Z',summary_title:'Weekly meeting',segments:[],session_summaries:[]},
    {id:'older-3',started_at:'2026-09-12T12:00:00Z',summary_title:' ',preview:'Discussing the product launch',segments:[],session_summaries:[]},
    {id:'older-4',started_at:'2026-09-11T12:00:00Z',segments:[],session_summaries:[]},
  ]);
  const user=userEvent.setup();render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Context'}));
  await waitFor(()=>expect(native.listHistory).toHaveBeenCalledWith('test-owner',{all:true}));
  await user.click(screen.getByRole('combobox',{name:'Refill from session'}));
  for(const name of ['Yesterday’s lecture (blank)','Weekly meeting (blank)','Discussing the product launch (blank)','Untitled session (blank)']) {
    const option=await screen.findByRole('option',{name});
    expect(option.getAttribute('aria-disabled')).toBe('true');
  }
  expect(screen.queryByText('No saved session context yet')).toBeNull();
});

it('distinguishes a history fetch failure from an empty history and retries on reopen',async()=>{
  native.listHistory.mockRejectedValueOnce(new Error('Network unavailable'));
  const user=userEvent.setup();render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Context'}));
  await user.click(screen.getByRole('combobox',{name:'Refill from session'}));
  await screen.findByRole('option',{name:'Could not load sessions — reopen to retry'});
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button',{name:'Context'}));
  await user.click(screen.getByRole('button',{name:'Context'}));
  await user.click(screen.getByRole('combobox',{name:'Refill from session'}));
  await screen.findByRole('option',{name:'No history sessions yet'});
  expect(native.listHistory).toHaveBeenCalledTimes(2);
});

it.each(['manual', 'silence timeout', 'provider closed', 'stop failure', 'window close'])(
  'clears context and its saved copy when a session ends: %s', async reason => {
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button',{name:'Context'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Additional context'}),{target:{value:'Only for this session'}});
    await user.click(screen.getByRole('button',{name:'Start captions'}));
    await screen.findByRole('button',{name:'Stop captions'});
    expect(native.connect.mock.calls.at(-1)?.[5].text).toBe('Only for this session');
    if (reason === 'window close') {
      await act(async()=>native.close?.({preventDefault:vi.fn()}));
      expect(native.destroy).toHaveBeenCalled();
    } else if (reason === 'manual' || reason === 'stop failure') {
      if (reason === 'stop failure') native.finish.mockRejectedValueOnce(new Error('Disconnected'));
      await user.click(screen.getByRole('button',{name:'Stop captions'}));
    } else {
      act(()=>native.relayEvent({type:'finished',reason}));
    }
    await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('context_storage_set',{value:JSON.stringify(emptySessionContext())}));
    // The next session must not resend the previous session's context.
    await user.click(screen.getByRole('button',{name:'Start captions'}));
    await waitFor(()=>expect(native.connect.mock.calls.at(-1)?.[5]).toEqual(emptySessionContext()));
  },
);

it('removes personal-key settings',async()=>{
 const user=userEvent.setup();render(<App/>);
 await user.click(screen.getByRole('button',{name:'Open settings'}));
 expect(screen.queryByRole('button',{name:/Providers/})).toBeNull();
});

it('applies customized appearance to one full-width live overlay surface', async()=>{
  const user=userEvent.setup(); const {container}=render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  await user.click(screen.getByRole('button',{name:'Overlay settings'}));
  fireEvent.change(container.querySelector('#panel-color')!,{target:{value:'#123456'}});
  fireEvent.change(container.querySelector('#panel-opacity')!,{target:{value:'25'}});
  fireEvent.change(container.querySelector('#overlay-opacity')!,{target:{value:'70'}});
  fireEvent.change(container.querySelector('#border-width')!,{target:{value:'3'}});
  fireEvent.change(container.querySelector('#controls-opacity')!,{target:{value:'60'}});
  await user.click(screen.getByRole('button',{name:'Show audio overlay'}));
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  const panel=container.querySelector('.subtitle-panel') as HTMLElement;
  await waitFor(()=>expect(panel.classList.contains('custom-overlay')).toBe(true));
  expect(panel.style.getPropertyValue('--overlay-background')).toBe('#12345640');
  expect(panel.style.getPropertyValue('--overlay-border-width')).toBe('3px');
  expect(panel.style.getPropertyValue('--overlay-controls-opacity')).toBe('0.6');
  expect(panel.style.getPropertyValue('--overlay-control-background')).toBe('');
  expect(panel.style.getPropertyValue('--overlay-opacity')).toBe('0.7');
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('update_overlay', expect.objectContaining({
    preferences:expect.objectContaining({appearance:expect.objectContaining({backgroundColor:'#123456',backgroundOpacity:.25,overlayOpacity:.7,borderWidth:3,controlsOpacity:.6})})
  })));
});

it('opens settings from the setup summary and reflects changes in the header', async () => {
  const user = userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button', {name:/^Source:/}));
  expect(screen.getByRole('dialog', {name:'Source'})).toBeTruthy();
  const summary=screen.getByRole('group',{name:'Session setup'}).querySelector('button')!;
  fireEvent.keyDown(summary,{key:'ArrowRight'});
  await user.click(screen.getByRole('button', {name:/^Captions:/}));
  expect(screen.getByRole('dialog', {name:'Languages'})).toBeTruthy();
  await user.click(screen.getByRole('combobox', {name:'Caption mode'}));
  await user.click(screen.getByRole('option', {name:'Translation',exact:true}));
  fireEvent.keyDown(summary,{key:'ArrowRight'});
  expect(screen.getByRole('button', {name:/^Translate:/})).toBeTruthy();
  expect(screen.queryByRole('button', {name:/^Captions:/})).toBeNull();
  for(let i=0;i<10&&!screen.queryByRole('button',{name:'Auto-stop: 30s of silence'});i++) fireEvent.keyDown(summary,{key:'ArrowRight'});
  await user.click(screen.getByRole('button', {name:'Auto-stop: 30s of silence'}));
  expect(screen.getByRole('dialog', {name:'Auto-stop'})).toBeTruthy();
  fireEvent.change(screen.getByRole('slider', {name:'Silence timeout'}), {target:{value:'60'}});
  expect(screen.getByRole('button', {name:'Auto-stop: 60s of silence'})).toBeTruthy();
});

it('toggles a dropdown repeatedly without dismissing its parent popover', async () => {
  const user = userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button', {name:'Source'}));
  const trigger = screen.getByRole('combobox', {name:'Input source'});
  for (let i = 0; i < 3; i++) {
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', {name:'Source'})).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  }
  fireEvent.pointerDown(screen.getByLabelText('Live captions'));
  expect(screen.queryByRole('dialog')).toBeNull();
});


it('keeps the context and restores the popover when automatic capture fails',async()=>{
  const prior=native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async(command:string,...args:any[])=>{
    if(command==='capture_context_screenshot') throw new Error('Screen recording access is required.');
    return prior(command,...args);
  });
  const user=userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Context'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Additional context'}),{target:{value:'Keep this context'}});
  await user.click(screen.getByRole('button',{name:'Fill from screen'}));
  await screen.findByText('Screen recording access is required.');
  expect(native.contextFromScreenshot).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox',{name:'Additional context'}) as HTMLTextAreaElement).value).toBe('Keep this context');
  expect((screen.getByRole('button',{name:'Start captions'}) as HTMLButtonElement).disabled).toBe(false);
});

it('confirms before turning off Save sessions and clears history only after the server accepts', async()=>{
  native.listHistory.mockResolvedValue([{id:'saved-session',started_at:new Date().toISOString(),summary_title:'Saved lecture',preview:'Saved words'}]);
  const user=userEvent.setup();render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Open history'}));
  await screen.findByText('Saved lecture');
  const toggle=screen.getByRole('checkbox',{name:'Save sessions'}) as HTMLInputElement;
  await user.click(toggle);
  expect(screen.getByRole('dialog',{name:'Turn off Save sessions?'})).toBeTruthy();
  expect(screen.getByText(/will immediately delete your saved sessions/)).toBeTruthy();
  expect(toggle.checked).toBe(true);
  await user.click(screen.getByRole('button',{name:'Cancel'}));
  expect(native.setHistorySettings).not.toHaveBeenCalled();
  expect(screen.getByText('Saved lecture')).toBeTruthy();
  let finish!:(value:any)=>void;
  native.setHistorySettings.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await user.click(toggle);
  await user.click(screen.getByRole('button',{name:'Delete history and turn off'}));
  expect(native.setHistorySettings).toHaveBeenCalledWith('test-owner',false);
  expect(toggle.checked).toBe(true);
  expect(screen.getByText('Saved lecture')).toBeTruthy();
  await act(async()=>finish({saveSessions:false,generation:2,retentionDays:30}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(toggle.checked).toBe(false);
  expect(screen.queryByText('Saved lecture')).toBeNull();
  expect(JSON.parse(native.contextStore!).savedContexts).toBeUndefined();
});
it('shows the 30-day policy when enabling the persisted off setting and keeps it off after a failed request',async()=>{
  native.getHistorySettings.mockResolvedValue({saveSessions:false,generation:2,retentionDays:30});
  const user=userEvent.setup();render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Open history'}));
  const toggle=await screen.findByRole('checkbox',{name:'Save sessions'}) as HTMLInputElement;
  await waitFor(()=>expect(toggle.disabled).toBe(false));
  expect(toggle.checked).toBe(false);
  await user.click(toggle);
  expect(screen.getByText('Sessions are saved for 30 days, then automatically deleted.')).toBeTruthy();
  native.setHistorySettings.mockRejectedValueOnce(new Error('Offline'));
  await user.click(screen.getByRole('button',{name:'Enable Save sessions'}));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(toggle.checked).toBe(false);
  await user.click(screen.getByRole('button',{name:'Enable Save sessions'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(native.setHistorySettings).toHaveBeenLastCalledWith('test-owner',true);
  expect(toggle.checked).toBe(true);
});
it('keeps saving enabled when the deletion request fails',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Open history'}));
  const toggle=screen.getByRole('checkbox',{name:'Save sessions'}) as HTMLInputElement;
  await waitFor(()=>expect(toggle.disabled).toBe(false));
  await user.click(toggle);
  native.setHistorySettings.mockRejectedValueOnce(new Error('Offline'));
  await user.click(screen.getByRole('button',{name:'Delete history and turn off'}));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(toggle.checked).toBe(true);
});

it('requires AI setup for returning users without offering a permission withdrawal control',async()=>{
  native.realAIConsent=true;
  const user=userEvent.setup();
  render(<App/>);
  await screen.findByRole('main',{name:'AI setup'});
  expect(screen.queryByRole('button',{name:'Start captions'})).toBeNull();
  const agreement=screen.getByRole('region',{name:'AI data use and terms'});
  Object.defineProperties(agreement,{clientHeight:{value:240},scrollHeight:{value:600},scrollTop:{value:360}});
  fireEvent.scroll(agreement);
  await user.click(screen.getByRole('button',{name:'Agree and continue'}));
  await screen.findByRole('button',{name:'Start captions'});
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  await user.click(screen.getByRole('button',{name:'Account',exact:true}));
  expect(await screen.findByRole('button',{name:'Delete account',exact:true})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Withdraw permission'})).toBeNull();
});

it('routes native overlay controls and partial captions through the current session', async()=>{
  const user=userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Start captions'}));
  await screen.findByRole('button',{name:'Stop captions'});
  act(()=>native.overlayAction({payload:'audio'}));
  expect(screen.getByRole('dialog',{name:'Volume'})).toBeTruthy();
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('update_overlay',expect.objectContaining({preferences:expect.objectContaining({controlsOpen:true})})));
  act(()=>native.relayEvent({type:'segment',segment:{id:'partial',sessionId:'native-overlay-check',sequence:0,revision:1,startMs:0,endMs:100,sourceLanguage:'zh',targetLanguage:'zh',sourceText:'即時字幕',translatedText:'',final:false,state:'draft'}}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('update_overlay',expect.objectContaining({source:'即時字幕'})));
  act(()=>native.overlayAction({payload:'settings'}));
  expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
  await waitFor(()=>expect(native.invoke.mock.calls.filter(([name])=>name==='set_window_mode').at(-1)?.[1]).toEqual({overlay:false,clear:false}));
});

it('offers personal keys before account onboarding on a fresh desktop install',async()=>{
  localStorage.removeItem('audeeo.connection-mode');
  render(<App/>);
  expect(await screen.findByRole('heading',{name:'Caption service'})).toBeTruthy();
  expect(screen.getByLabelText('Soniox API key')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Use Audeeo account'})).toBeTruthy();
});

it('starts BYOK with no Audeeo account or token',async()=>{
 native.session=null;localStorage.setItem('audeeo.connection-mode','soniox');
 const base=native.invoke.getMockImplementation()!;
 native.invoke.mockImplementation(async(command:string,args?:any)=>command==='auth_storage_get'?JSON.stringify({soniox:'fixture-key',openai:''}):base(command,args));
 const user=userEvent.setup();render(<App/>);
 await user.click(await screen.findByRole('button',{name:'Start captions'}));
 await screen.findByRole('button',{name:'Stop captions'});
 expect(native.connect.mock.calls[0][0]).toBe('');
 expect(native.getHistorySettings).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Stop captions'}));
});
