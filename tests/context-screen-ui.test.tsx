// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ContextSettings} from '../src/components/ContextSettings';
import {emptySessionContext} from '../shared/context';
import {useState} from 'react';
import {NativeSelectProvider} from '../src/components/Select';
afterEach(cleanup);
it('reveals and retains the custom category when switching categories',async()=>{
  function Form(){
    const [value,setValue]=useState(emptySessionContext());
    return <NativeSelectProvider><ContextSettings value={value} onChange={setValue} active={false}/></NativeSelectProvider>;
  }
  render(<Form/>);
  const user=userEvent.setup();
  expect(screen.queryByLabelText('Custom category')).toBeNull();
  await user.selectOptions(screen.getByLabelText('Context category'),'custom');
  await user.type(screen.getByLabelText('Custom category'),'Game design');
  expect((screen.getByLabelText('Custom category') as HTMLInputElement).value).toBe('Game design');
  await user.selectOptions(screen.getByLabelText('Context category'),'science');
  expect(screen.queryByLabelText('Custom category')).toBeNull();
  await user.selectOptions(screen.getByLabelText('Context category'),'custom');
  expect((screen.getByLabelText('Custom category') as HTMLInputElement).value).toBe('Game design');
});
it('starts a screen fill with one click and no helper paragraph',async()=>{
  const capture=vi.fn();
  render(<ContextSettings value={emptySessionContext()} onChange={()=>{}} active={false} onFillFromScreen={capture}/>);
  expect(screen.queryByPlaceholderText('YouTube or public link')).toBeNull();
  expect(screen.queryByText(/sends it to OpenAI/)).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:'Fill from screen'}));
  expect(capture).toHaveBeenCalledOnce();
});

it('offers session refill through the detached native dropdown and blocks it while active',async()=>{
  const refill=vi.fn();
  const props={value:emptySessionContext(),onChange:vi.fn(),active:false,onRefillContextFromSession:refill,refillContextSessions:[{id:'session-1',label:'Physics lecture'},{id:'blank',label:'Old meeting (blank)',disabled:true}]};
  const view=render(<NativeSelectProvider><ContextSettings {...props}/></NativeSelectProvider>);
  expect((screen.getByRole('option',{name:'Old meeting (blank)'}) as HTMLOptionElement).disabled).toBe(true);
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Refill from session'}),'session-1');
  expect(refill).toHaveBeenCalledWith('session-1');
  view.rerender(<NativeSelectProvider><ContextSettings {...props} active/></NativeSelectProvider>);
  expect((screen.getByRole('combobox',{name:'Refill from session'}) as HTMLSelectElement).disabled).toBe(true);
});
it('prevents duplicate capture and manual overwrites while reading, then keeps fields editable on failure',async()=>{
  const capture=vi.fn(),change=vi.fn();
  const props={value:{...emptySessionContext(),text:'Keep this context'},onChange:change,active:false,onFillFromScreen:capture};
  const view=render(<ContextSettings {...props} screenCapturePending/>);
  await userEvent.click(screen.getByRole('button',{name:'Reading screen…'}));
  expect(capture).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Additional context') as HTMLTextAreaElement).disabled).toBe(true);
  view.rerender(<ContextSettings {...props} screenCaptureIssue="Screen capture was denied."/>);
  expect(screen.getByRole('alert').textContent).toContain('denied');
  expect((screen.getByLabelText('Additional context') as HTMLTextAreaElement).value).toBe('Keep this context');
  expect((screen.getByLabelText('Additional context') as HTMLTextAreaElement).disabled).toBe(false);
});
