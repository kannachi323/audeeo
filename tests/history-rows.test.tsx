// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {HistoryRows} from '../src/components/HistoryRows';
const rows=['First session','Second session','Third session'].map((title,i)=>({id:String(i),summary_title:title,started_at:'2026-09-15T12:00:00Z',source_language:'en',target_language:'zh',segments:[],session_summaries:[]}));
afterEach(cleanup);
const setup=()=>{
  const handlers={onSummary:vi.fn(),onExport:vi.fn(),onDelete:vi.fn()};
  render(<div><button>Outside history</button><HistoryRows rows={rows} {...handlers}/></div>);
  return {...handlers,articles:screen.getAllByRole('article')};
};
it('mounts all three icons for exactly one row and removes them immediately on leave',()=>{
  const {articles}=setup();
  expect(screen.queryByRole('button',{name:'Export session'})).toBeNull();
  fireEvent.pointerEnter(articles[0]);
  expect(articles[0].querySelectorAll('button')).toHaveLength(3);
  fireEvent.pointerEnter(articles[1]);
  expect(articles[0].querySelectorAll('button')).toHaveLength(0);
  expect(articles[1].querySelectorAll('button')).toHaveLength(3);
  // A delayed leave from the old row must not clear the newly active one.
  fireEvent.pointerLeave(articles[0]);
  expect(screen.getAllByRole('button',{name:'Export session'})).toHaveLength(1);
  fireEvent.pointerLeave(articles[1]);
  expect(screen.queryByRole('button',{name:'Export session'})).toBeNull();
});
it('uses the same active row for keyboard focus and pointer movement',async()=>{
  const {articles,onExport}=setup();const user=userEvent.setup();
  await user.tab();await user.tab();
  expect(document.activeElement).toBe(articles[0]);
  await user.tab();await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Export session'}));
  await user.keyboard('{Enter}');expect(onExport).toHaveBeenCalledWith(rows[0]);
  fireEvent.pointerEnter(articles[2]);
  expect(articles[0].querySelector('button')).toBeNull();
  expect(articles[2].querySelectorAll('button')).toHaveLength(3);
  act(()=>articles[1].focus());
  expect(articles[2].querySelector('button')).toBeNull();
  expect(articles[1].querySelectorAll('button')).toHaveLength(3);
  fireEvent.keyDown(articles[1],{key:'Escape'});
  expect(screen.queryByRole('button',{name:'Export session'})).toBeNull();
});
it('clears stale actions on scroll, window blur, and outside taps',()=>{
  const {articles}=setup();
  fireEvent.pointerDown(articles[0]);
  fireEvent.scroll(document);
  expect(screen.queryByRole('button',{name:'Delete session'})).toBeNull();
  fireEvent.pointerMove(articles[1]);
  expect(articles[1].querySelectorAll('button')).toHaveLength(3);
  fireEvent.blur(window);
  expect(screen.queryByRole('button',{name:'Delete session'})).toBeNull();
  fireEvent.pointerDown(articles[0]);fireEvent.pointerDown(articles[2]);
  expect(articles[0].querySelector('button')).toBeNull();
  expect(articles[2].querySelectorAll('button')).toHaveLength(3);
  fireEvent.pointerDown(screen.getByRole('button',{name:'Outside history'}));
  expect(screen.queryByRole('button',{name:'Delete session'})).toBeNull();
});
it('invokes every action with the active session',()=>{
  const {articles,onSummary,onExport,onDelete}=setup();
  fireEvent.pointerEnter(articles[1]);
  fireEvent.click(screen.getByRole('button',{name:'Summarize session'}));
  fireEvent.click(screen.getByRole('button',{name:'Export session'}));
  fireEvent.click(screen.getByRole('button',{name:'Delete session'}));
  expect(onSummary).toHaveBeenCalledExactlyOnceWith(rows[1]);
  expect(onExport).toHaveBeenCalledExactlyOnceWith(rows[1]);
  expect(onDelete).toHaveBeenCalledExactlyOnceWith('1');
});
