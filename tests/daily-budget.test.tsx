// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook} from '@testing-library/react';
import {addListeningTime,dailyBudgetKey,normalizeDailyBudget,readDailyBudget} from '../src/lib/dailyBudget';
import {useDailyBudget} from '../src/lib/useDailyBudget';
beforeEach(()=>{localStorage.clear();vi.useFakeTimers();vi.setSystemTime(new Date(2026,8,15,12));});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('splits an active session at local midnight and preserves the configured budget',()=>{
  const before=new Date(2026,8,15,23,59,50),after=new Date(2026,8,16,0,0,15);
  const initial={...normalizeDailyBudget(null,before),usedSeconds:3000,minutes:60,notifiedMinutes:60};
  expect(addListeningTime(initial,before.getTime(),after.getTime())).toMatchObject({day:'2026-09-16',usedSeconds:15,minutes:60,notifiedMinutes:null});
});
it('recovers from malformed storage, rejects invalid budgets and isolates accounts',()=>{
  localStorage.setItem(dailyBudgetKey('a'),'broken');
  expect(readDailyBudget(localStorage,'a').minutes).toBeNull();
  localStorage.setItem(dailyBudgetKey('a'),JSON.stringify({...normalizeDailyBudget(null),minutes:60,usedSeconds:45}));
  expect(readDailyBudget(localStorage,'a').usedSeconds).toBe(45);
  expect(readDailyBudget(localStorage,'b').usedSeconds).toBe(0);
  expect(normalizeDailyBudget({minutes:Infinity}).minutes).toBeNull();
  expect(normalizeDailyBudget({minutes:0}).minutes).toBeNull();
});
it('counts only live listening, survives reload, and reminds once without stopping tracking',()=>{
  const {result,rerender,unmount}=renderHook(({live})=>useDailyBudget('a',live),{initialProps:{live:false}});
  act(()=>{result.current.setMinutes(1);vi.advanceTimersByTime(30000);});
  expect(result.current.value.usedSeconds).toBe(0);
  rerender({live:true});
  act(()=>vi.advanceTimersByTime(60000));
  expect(result.current.reminder?.minutes).toBe(1);
  act(()=>{result.current.dismiss();vi.advanceTimersByTime(30000);});
  expect(result.current.value.usedSeconds).toBe(90);
  expect(result.current.reminder).toBeNull();
  rerender({live:false});
  act(()=>vi.advanceTimersByTime(30000));
  expect(result.current.value.usedSeconds).toBe(90);
  unmount();
  const again=renderHook(()=>useDailyBudget('a',false));
  act(()=>vi.advanceTimersByTime(10000));
  expect(again.result.current.value.usedSeconds).toBe(90);
  expect(again.result.current.reminder).toBeNull();
});
it('switches owners without copying usage and can disable reminders',()=>{
  const {result,rerender}=renderHook(({owner,live})=>useDailyBudget(owner,live),{initialProps:{owner:'a',live:true}});
  act(()=>{result.current.setMinutes(1);vi.advanceTimersByTime(30000);});
  rerender({owner:'b',live:false});
  expect(result.current.value.usedSeconds).toBe(0);
  expect(result.current.value.minutes).toBeNull();
  rerender({owner:'a',live:true});
  expect(result.current.value.usedSeconds).toBe(30);
  act(()=>{result.current.setMinutes(null);vi.advanceTimersByTime(60000);});
  expect(result.current.reminder).toBeNull();
  expect(result.current.value.usedSeconds).toBe(90);
});
it('rolls over an idle day without carrying a previous reminder forward',()=>{
  const {result}=renderHook(()=>useDailyBudget('a',true));
  act(()=>{result.current.setMinutes(1);vi.advanceTimersByTime(60000);});
  expect(result.current.reminder).not.toBeNull();
  vi.setSystemTime(new Date(2026,8,16,0,0,0));
  act(()=>vi.advanceTimersByTime(5000));
  expect(result.current.value.usedSeconds).toBe(5);
  expect(result.current.reminder).toBeNull();
});
