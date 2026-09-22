// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AIConsentSetup,useAIConsent,withdrawAIConsent,grantAIConsent} from '../src/components/AIConsent';
const upload = vi.fn();
function Feature({owner='one',purpose='captions'}:{owner?:string;purpose?:'captions'|'analysis'|'screenshot'}) {
  const {requestConsent,accepted}=useAIConsent(owner);
  return <><span>{accepted ? 'Enabled' : 'Permission required'}</span><button onClick={async()=>{if(await requestConsent(purpose))upload(owner);}}>Process</button></>;
}
function Setup() {return <AIConsentSetup owner="one" onContinue={()=>{}} onSignOut={()=>{}}/>;}
function scrollAgreement(scrollTop=360) {
  const box=screen.getByRole('region',{name:'AI data use and terms'});
  Object.defineProperties(box,{clientHeight:{configurable:true,value:240},scrollHeight:{configurable:true,value:600},scrollTop:{configurable:true,value:scrollTop}});
  fireEvent.scroll(box);
}
beforeEach(()=>{localStorage.clear();upload.mockClear();});
afterEach(cleanup);
it('requires explicit onboarding permission before audio or analysis can be sent',async()=>{
  render(<><Setup/><Feature/></>);
  await userEvent.click(screen.getByText('Process'));
  expect(upload).not.toHaveBeenCalled();
  expect(screen.getByText(/Soniox for captions, translations, and optional spoken translation/)).toBeTruthy();
  expect(screen.getByText(/transcript, instructions, and questions to OpenAI/)).toBeTruthy();
  scrollAgreement();
  await userEvent.click(screen.getByText('Agree and continue'));
  await userEvent.click(screen.getByText('Process'));
  expect(upload).toHaveBeenCalledOnce();
});
it('includes screen context in the main agreement and waits for an explicit capture action',async()=>{
  render(<><Setup/><Feature purpose="screenshot"/></>);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText(/Screen context is included in this agreement/)).toBeTruthy();
  await userEvent.click(screen.getByText('Process'));
  expect(upload).not.toHaveBeenCalled();
  scrollAgreement();
  await userEvent.click(screen.getByText('Agree and continue'));
  expect(upload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('Process'));
  await userEvent.click(screen.getByText('Process'));
  expect(upload).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('withdrawal immediately updates every consumer and blocks further processing',async()=>{
  grantAIConsent('one');
  const view=render(<Feature/>);
  await userEvent.click(screen.getByText('Process'));expect(upload).toHaveBeenCalledOnce();
  act(()=>withdrawAIConsent('one'));
  expect(screen.getByText('Permission required')).toBeTruthy();
  for (const purpose of ['captions','analysis','screenshot'] as const) {
    view.rerender(<Feature purpose={purpose}/>);
    await userEvent.click(screen.getByText('Process'));
  }
  expect(upload).toHaveBeenCalledOnce();
});
it('does not reuse another account’s permission or silently upgrade legacy consent',async()=>{
  localStorage.setItem('audeeo.ai-consent.v1.two.captions','accepted');
  grantAIConsent('one');
  const view=render(<Feature/>);
  view.rerender(<Feature owner="two"/>);
  expect(screen.getByText('Permission required')).toBeTruthy();
  await userEvent.click(screen.getByText('Process'));expect(upload).not.toHaveBeenCalled();
});
it.each(['core','core+screen'])('requires renewed agreement for previous v2 permission (%s)',async value=>{
  localStorage.setItem('audeeo.ai-consent.v2.one',value);
  const view=render(<Feature/>);
  for (const purpose of ['captions','analysis','screenshot'] as const) {
    view.rerender(<Feature purpose={purpose}/>);
    expect(screen.getByText('Permission required')).toBeTruthy();
    await userEvent.click(screen.getByText('Process'));
  }
  expect(upload).not.toHaveBeenCalled();
});
it('fails closed if permission cannot be saved',async()=>{
  const saved=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('unavailable');});
  try {
    render(<><Setup/><Feature/></>);
    scrollAgreement();
  await userEvent.click(screen.getByText('Agree and continue'));
    expect(screen.getByRole('alert').textContent).toContain('Could not save');
    await userEvent.click(screen.getByText('Process'));expect(upload).not.toHaveBeenCalled();
  } finally {saved.mockRestore();}
});

it('requires reaching the end once, keeps approval explicit, and puts policy links last',async()=>{
  render(<><Setup/><Feature/></>);
  const agree=screen.getByRole('button',{name:'Agree and continue'}) as HTMLButtonElement;
  expect(agree.disabled).toBe(true);
  scrollAgreement(100);expect(agree.disabled).toBe(true);
  await userEvent.click(agree);expect(screen.getByText('Permission required')).toBeTruthy();
  scrollAgreement();expect(agree.disabled).toBe(false);
  expect(screen.getByText('Permission required')).toBeTruthy();
  scrollAgreement(0);expect(agree.disabled).toBe(false);
  expect(screen.queryByRole('button',{name:'Manage account'})).toBeNull();
  const links=screen.getByRole('navigation',{name:'Legal and support'});
  expect(links.parentElement?.lastElementChild).toBe(links);
  await userEvent.click(agree);expect(screen.getByText('Enabled')).toBeTruthy();
});
it('allows account and billing access without granting AI processing consent',async()=>{
 const account=vi.fn();render(<><AIConsentSetup owner="one" onContinue={()=>{}} onSignOut={()=>{}} onAccount={account}/><Feature/></>);
 await userEvent.click(screen.getByRole('button',{name:'Account & billing'}));
 expect(account).toHaveBeenCalledOnce();expect(screen.getByText('Permission required')).toBeTruthy();
 await userEvent.click(screen.getByText('Process'));expect(upload).not.toHaveBeenCalled();
});
