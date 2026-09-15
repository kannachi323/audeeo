// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  relayEvent: undefined as any,
  playbackEvent: undefined as any,
  captureStop: vi.fn(),
  finish: vi.fn(),
  connect: vi.fn(),
  contextFromLink: vi.fn(),
  destroy: vi.fn(),
  session: null as any,
  authChanged: undefined as any,
  overlayAction: undefined as any,
  close: undefined as
    undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  platform: "macos",
  startResizeDragging: vi.fn(),
  captureGains: vi.fn(),
}));
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
  listHistory: async () => [],
  relayURL: "http://localhost:8787",
  accountRequest: vi.fn(),
  nativePurchase: vi.fn(),
  contextFromLink: native.contextFromLink,
}));
vi.mock('../src/lib/realtime',()=>({
  RealtimeTranslationClient: class {
    constructor(_endpoint: string, event: any) { native.relayEvent=event; }
    async connect(...args: any[]) { native.connect(...args); native.relayEvent({type:'ready',sessionId:'test-session'}); }
    sendAudio() {}
    finish=native.finish;
  }, NativeRelayClient: class {
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
vi.mock('../src/lib/captureMixer',()=>({
  DesktopCaptureMixer: class {
    setGains=native.captureGains;
    async start() {}
    stop=native.captureStop;
  },
}));
vi.mock('../src/lib/controlPopup', async original => ({...await original<any>(), supportsDetachedControls:()=>false}));
import App from "../src/App";
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
  native.connect.mockReset();
  native.contextFromLink.mockReset().mockResolvedValue({category:'education',text:'Linked lecture',terms:['eudaimonia'],translationTerms:[]});
  native.captureStop.mockReset().mockResolvedValue(undefined);
  native.finish.mockReset().mockImplementation(async()=>native.relayEvent?.({type:"finished",reason:"finished"}));
  native.session = {
    user: { id: "test-owner", email: "caption-test@example.test" },
    access_token: "test-only-token",
  };
  localStorage.setItem("audeeo.onboarding.desktop.test-owner", "audeeo");
  native.invoke.mockReset().mockImplementation(async (command: string) =>
    command === "platform_capabilities"
      ? {
          platform: native.platform,
          microphone: true,
          systemAudio: true,
          globalOverlay: true,
        }
      : command === "native_history_get"
        ? "[]"
        : undefined,
  );
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
  await user.click(await screen.findByRole('button', {name:'Input source'}));
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'Input source'}).textContent).toBe('Microphone + desktop audio'));
  await user.click(screen.getByRole('button',{name:'Languages & caption mode'}));
  await user.click(screen.getByRole('combobox',{name:'Caption mode'}));
  await user.click(screen.getByRole('option',{name:'Translation',exact:true}));
  await user.click(screen.getByRole('combobox',{name:'Source language'}));
  await user.click(screen.getByRole('option',{name:'English',exact:true}));
  expect(screen.getByRole('combobox',{name:'Target language'}).textContent).toBe('Chinese (Mandarin)');
  await user.click(screen.getByRole('combobox',{name:'Target language'}));
  await user.click(screen.getByRole('option',{name:'Japanese',exact:true}));
  expect(screen.getByRole('combobox',{name:'Source language'}).textContent).toBe('English');
  await user.click(screen.getByRole('button',{name:'Audio mix'}));
  await user.click(screen.getByRole('button', {name:'Mute microphone input'}));
  expect(screen.getByRole('button', {name:'Mute microphone input'}).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', {name:'Mute desktop audio input'}));
  expect(screen.getByRole('button', {name:'Mute desktop audio input'}).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', {name:'Mute translated audio'}));
  expect(native.invoke).toHaveBeenLastCalledWith('audio_output', {command:{volume:0}});
  await user.click(screen.getByRole('button', {name:'Open settings'}));
  expect(screen.getByRole('heading', {name:'Settings'})).toBeTruthy();
  await user.click(screen.getByRole('button', {name:'Overlay settings'}));
  expect(screen.getByRole('heading', {name:'Panel'})).toBeTruthy();
  expect(screen.getByText('Every word, clearly.').closest('.overlay-preview-group')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Window width', {selector:'#panel-width'}), {target:{value:'840'}});
  fireEvent.change(screen.getByLabelText('Background opacity'), {target:{value:'65'}});
  fireEvent.change(screen.getByLabelText('Width', {selector:'#border-width'}), {target:{value:'0'}});
  expect(JSON.parse(localStorage.getItem('audeeo.overlay-appearance')!)).toMatchObject({panelWidth:840,backgroundOpacity:.65,borderWidth:0});
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
  const context = await screen.findByRole('button', {name:'Translation context'});
  await user.click(context);
  expect(screen.getByRole('dialog', {name:'Translation context'})).toBeTruthy();
  expect(context.getAttribute('aria-expanded')).toBe('true');
  await user.click(context);
  expect(screen.queryByRole('dialog', {name:'Translation context'})).toBeNull();
  expect(context.getAttribute('aria-expanded')).toBe('false');
});
it("controls the Windows model-input mix without claiming OS volume", async () => {
  native.platform = "windows";
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button',{name:'Audio mix'}));
  await waitFor(()=>expect((screen.getByLabelText('Microphone input gain') as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByLabelText('Desktop audio input gain') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('Translated audio volume') as HTMLInputElement).disabled).toBe(false);
  expect(screen.getByText('Microphone and desktop levels affect only the audio frames sent to captions. They do not change what you hear.')).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Mute desktop audio input'}));
  expect(native.invoke.mock.calls.some(([,payload])=>payload?.command?.sourceVolume !== undefined)).toBe(false);
});
it("applies microphone and desktop gains to a live desktop capture", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button',{name:'Start captions'}));
  await screen.findByRole('button',{name:'Stop captions'});
  await user.click(screen.getByRole('button',{name:'Audio mix'}));
  await user.click(screen.getByRole('button',{name:'Mute microphone input'}));
  await waitFor(()=>expect(native.captureGains).toHaveBeenLastCalledWith({microphone:0,system:1}));
  fireEvent.change(screen.getByLabelText('Desktop audio input gain'),{target:{value:'0.4'}});
  await waitFor(()=>expect(native.captureGains).toHaveBeenLastCalledWith({microphone:0,system:0.4}));
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
  await user.click(screen.getByRole('button',{name:'Silence protection'}));
  fireEvent.change(screen.getByLabelText('Silence timeout'),{target:{value:'60'}});
  fireEvent.change(screen.getByLabelText('Silence threshold'),{target:{value:'-50'}});
  expect(JSON.parse(localStorage.getItem('audeeo.silence')!)).toEqual({timeoutSeconds:60,thresholdDbfs:-50});
  view.unmount(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Silence protection'}));
  expect((screen.getByLabelText('Silence timeout') as HTMLInputElement).value).toBe('60');
  const panel=screen.getByLabelText('Live captions');
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','zh','zh',{timeoutSeconds:60,thresholdDbfs:-50},undefined,expect.objectContaining({category:'general'})));
  expect(screen.getByLabelText('Live captions')).toBe(panel);
  await user.click(screen.getByRole('button',{name:'Silence protection'}));
  expect((screen.getByLabelText('Silence timeout') as HTMLInputElement).disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Stop captions'}));
  expect(screen.getByLabelText('Live captions')).toBe(panel);
  await user.click(screen.getByRole('button',{name:'Silence protection'}));
  expect((screen.getByLabelText('Silence timeout') as HTMLInputElement).disabled).toBe(false);
});

it('returns from History to the audio overlay icon without starting a session', async () => {
  const user=userEvent.setup(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  await user.click(screen.getByRole('button',{name:/History/}));
  expect(screen.getByRole('heading',{name:'History'})).toBeTruthy();
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

  const input=screen.getByRole('button',{name:'Input source'});
  await user.click(input);
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window')).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByRole('dialog',{name:'Input source'}));
  await user.keyboard('{Tab}');
  expect(document.activeElement).toBe(screen.getByRole('combobox',{name:'Input source'}));
  await user.keyboard(' ');
  expect(screen.getByRole('listbox')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.getByRole('dialog',{name:'Input source'})).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(input);
  await user.click(input);
  const drawerCalls=native.invoke.mock.calls.filter(([name])=>name==='set_controls_open').length;
  await user.click(screen.getByRole('button',{name:'Languages & caption mode'}));
  expect(native.invoke.mock.calls.filter(([name])=>name==='set_controls_open')).toHaveLength(drawerCalls);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.pointerDown(screen.getByLabelText('Live captions'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window')).toHaveLength(1);
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window').at(-1)?.[1]).toEqual({height:224});
  expect(screen.queryByText('Ready to listen')).toBeNull();
  expect(screen.queryByText('Manual direction')).toBeNull();
  expect(screen.getByRole('toolbar',{name:'Caption controls'}).textContent).toBe('ContextInputLanguageAudioSilence');
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  await user.click(screen.getByRole('button',{name:/Account/}));
  expect(screen.getByRole('heading',{name:'Account'})).toBeTruthy();
  expect(native.invoke.mock.calls.filter(([name])=>name==='resize_main_window').every(([,args])=>args.height<=720)).toBe(true);
});

it('returns each Settings subpage to Settings using its header button', async () => {
  const user=userEvent.setup(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  expect(screen.queryByRole('button',{name:'Back to Settings'})).toBeNull();
  for (const name of ['Overlay settings', /History/, /Providers/, /Account/]) {
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
  await user.click(await screen.findByRole('button',{name:'Languages & caption mode'}));
  for (const [label,option] of [['Caption mode','Translation'],['Source language','Arabic'],['Target language','Japanese']]) {
    await user.click(screen.getByRole('combobox',{name:label}));
    await user.click(screen.getByRole('option',{name:option,exact:true}));
  }
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','ar','ja',expect.any(Object),undefined,expect.objectContaining({category:'general'})));
  await user.click(screen.getByRole('button',{name:'Stop captions'}));
});

it('opens the Settings overview from every subpage and keeps history preferences in History', async()=>{
  const user=userEvent.setup(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  expect(screen.queryByRole('checkbox',{name:'Save text history'})).toBeNull();
  for (const [button,heading] of [['Overlay settings','Overlay'],['History','History'],['Providers','Providers'],['Account','Account']]) {
    await user.click(screen.getByRole('button',{name:new RegExp(button)}));
    expect(screen.getByRole('heading',{name:heading})).toBeTruthy();
    if (heading === 'History') expect(screen.getByRole('checkbox',{name:'Save text history'})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Open settings'}));
    expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
  }
  await user.click(screen.getByRole('button',{name:'Show audio overlay'}));
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  expect(screen.getByRole('heading',{name:'Settings'})).toBeTruthy();
});
it("defaults iOS 27 sessions to device playback while keeping microphone optional", async () => {
  native.platform = "ios";
  render(<App />);
  await waitFor(() => expect(screen.getByText("Device playback (system picker)")).toBeTruthy());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", {name:"Input source"}));
  expect(screen.getByRole("combobox", {name:"Input source"}).textContent).toBe("Device playback");
  await user.click(screen.getByRole("combobox", {name:"Input source"}));
  expect(screen.getByRole("option", {name:"Microphone (your input)"})).toBeTruthy();
});
it("edits translation context from the bottom toolbar popover", async () => {
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button',{name:'Translation context'}));
  await user.type(screen.getByRole('textbox',{name:'Link for translation context'}),'https://youtube.com/watch?v=test');
  await user.click(screen.getByRole('button',{name:'Fill context from link'}));
  await waitFor(()=>expect(native.contextFromLink).toHaveBeenCalledWith(expect.anything(),'https://youtube.com/watch?v=test','zh',undefined));
  expect((screen.getByRole('textbox',{name:'Additional context'}) as HTMLTextAreaElement).value).toBe('Linked lecture');
  await user.click(screen.getByRole('combobox',{name:'Context category'}));
  await user.click(screen.getByRole('option',{name:'Philosophy'}));
  expect(screen.queryByRole('heading',{name:'Context'})).toBeNull();
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','zh','zh',expect.any(Object),undefined,expect.objectContaining({category:'philosophy',terms:['eudaimonia']})));
});

it('uses a session-only personal provider key without putting it in local storage', async()=>{
  const user=userEvent.setup(); render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  await user.click(screen.getByRole('button',{name:/Providers/}));
  expect(document.querySelectorAll('[data-provider-logo="audeeo"]')).toHaveLength(1);
  expect(screen.queryByLabelText('OpenAI API key')).toBeNull();
  expect(screen.getByRole('button',{name:'View subscription'})).toBeTruthy();
  await user.click(screen.getByRole('combobox',{name:'Caption provider'}));
  expect(document.querySelector('[data-provider-logo="openai"]')).toBeTruthy();
  expect(document.querySelector('[data-provider-logo="soniox"]')).toBeTruthy();
  await user.click(screen.getByRole('option',{name:/OpenAI/}));
  expect(screen.queryByText('View subscription')).toBeNull();
  expect(screen.queryByLabelText('Soniox API key')).toBeNull();
  await user.type(screen.getByLabelText('OpenAI API key'),'sk-user-test');
  expect(JSON.stringify(localStorage)).not.toContain('sk-user-test');
  await user.click(screen.getByRole('button',{name:'Show audio overlay'}));
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  await waitFor(()=>expect(native.connect).toHaveBeenCalledWith('test-only-token','zh','zh',expect.any(Object),{provider:'openai',apiKey:'sk-user-test'},expect.objectContaining({category:'general'})));
});

it('applies customized appearance to one full-width live overlay surface', async()=>{
  const user=userEvent.setup(); const {container}=render(<App/>);
  await user.click(screen.getByRole('button',{name:'Open settings'}));
  await user.click(screen.getByRole('button',{name:'Overlay settings'}));
  fireEvent.change(container.querySelector('#panel-color')!,{target:{value:'#123456'}});
  fireEvent.change(container.querySelector('#panel-opacity')!,{target:{value:'40'}});
  fireEvent.change(container.querySelector('#border-width')!,{target:{value:'3'}});
  fireEvent.change(container.querySelector('#controls-opacity')!,{target:{value:'60'}});
  await user.click(screen.getByRole('button',{name:'Show audio overlay'}));
  await user.click(screen.getByRole('button',{name:'Start captions'}));
  const panel=container.querySelector('.subtitle-panel') as HTMLElement;
  await waitFor(()=>expect(panel.classList.contains('custom-overlay')).toBe(true));
  expect(panel.style.getPropertyValue('--overlay-background')).toBe('#12345666');
  expect(panel.style.getPropertyValue('--overlay-border-width')).toBe('3px');
  expect(panel.style.getPropertyValue('--overlay-controls-opacity')).toBe('0.6');
  expect(panel.style.getPropertyValue('--overlay-control-background')).toBe('');
});

it('toggles a dropdown repeatedly without dismissing its parent popover', async () => {
  const user = userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button', {name:'Input source'}));
  const trigger = screen.getByRole('combobox', {name:'Input source'});
  for (let i = 0; i < 3; i++) {
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', {name:'Input source'})).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  }
  fireEvent.pointerDown(screen.getByLabelText('Live captions'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
