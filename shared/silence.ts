export type SilenceSettings = { timeoutSeconds: number; thresholdDbfs: number };
export const defaultSilence: SilenceSettings = { timeoutSeconds: 30, thresholdDbfs: -60 };
/** Same bounds for saved preferences and untrusted relay requests. */
export function silenceSettings(value: unknown): SilenceSettings {
  const v = value as Partial<SilenceSettings> | null;
  const bounded = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
  return {
    timeoutSeconds: bounded(v?.timeoutSeconds, 10, 300, defaultSilence.timeoutSeconds),
    thresholdDbfs: bounded(v?.thresholdDbfs, -80, -30, defaultSilence.thresholdDbfs),
  };
}
