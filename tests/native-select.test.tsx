// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Select} from '../src/components/Select';
afterEach(cleanup);
HTMLElement.prototype.scrollIntoView=vi.fn();
HTMLElement.prototype.hasPointerCapture=vi.fn(()=>false);
it('opens a custom menu and sends the selected value', async()=>{
  const change=vi.fn();
  render(<Select label="Input source" value="microphone" onChange={change} options={[{value:'microphone',label:'Microphone'},{value:'system',label:'Device audio'},{value:'unavailable',label:'Unavailable',disabled:true}]}/>);
  const select=screen.getByRole('combobox',{name:'Input source'});
  expect(select.tagName).toBe('BUTTON');
  select.focus();
  await userEvent.keyboard(' ');
  expect(screen.getByRole('listbox')).toBeTruthy();
  await userEvent.click(screen.getByRole('option',{name:'Device audio'}));
  expect(change).toHaveBeenCalledWith('system');

});
it('keeps selectors disabled during an active session',async()=>{
  const change=vi.fn();
  render(<Select label="Caption mode" value="subtitles" disabled onChange={change} options={[{value:'subtitles',label:'Subtitles'},{value:'translate',label:'Translation'}]}/>);
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
