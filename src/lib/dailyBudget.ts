export type DailyBudget = {day: string; usedSeconds: number; minutes: number | null; notifiedMinutes: number | null};
export const dailyBudgetKey = (owner: string) => `audeeo.daily-budget.v1.${owner}`;
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
export function normalizeDailyBudget(raw: unknown, now = new Date()): DailyBudget {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<DailyBudget>;
  const minutes = Number.isInteger(value.minutes) && value.minutes! >= 1 && value.minutes! <= 1440 ? value.minutes! : null;
  const sameDay = value.day === localDay(now);
  return {day:localDay(now), minutes, usedSeconds:sameDay && Number.isFinite(value.usedSeconds) ? Math.max(0,value.usedSeconds!) : 0,
    notifiedMinutes:sameDay && value.notifiedMinutes === minutes ? minutes : null};
}
export function readDailyBudget(storage: Pick<Storage,'getItem'>, owner: string, now = new Date()) {
  try { return normalizeDailyBudget(JSON.parse(storage.getItem(dailyBudgetKey(owner)) || 'null'),now); }
  catch { return normalizeDailyBudget(null,now); }
}
/** Local listening time, independent of billing. Split sessions at local midnight, including DST. */
export function addListeningTime(value: DailyBudget, from: number, to: number): DailyBudget {
  const end = new Date(to), next = normalizeDailyBudget(value,end);
  const midnight = new Date(end.getFullYear(),end.getMonth(),end.getDate()).getTime();
  return {...next,usedSeconds:next.usedSeconds + Math.max(0,to-Math.max(from,midnight))/1000};
}
