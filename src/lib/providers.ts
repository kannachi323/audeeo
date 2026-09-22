import { invoke, isTauri } from '@tauri-apps/api/core';

export type ProviderId = 'soniox' | 'openai';
export type ProviderMode = 'audeeo' | ProviderId;
export type ProviderKeys = Record<ProviderId, string>;
const storageKey = '__audeeo_provider_keys_v1';
export const emptyProviderKeys = (): ProviderKeys => ({soniox:'',openai:''});
export const providerName = (provider: ProviderId) => provider === 'soniox' ? 'Soniox' : 'OpenAI';
export function connectionMode(storage: Pick<Storage,'getItem'>): ProviderMode {
  const mode = storage.getItem('audeeo.connection-mode');
  return mode === 'soniox' || mode === 'openai' ? mode : 'audeeo';
}
function parseKeys(raw: string | null | undefined): ProviderKeys {
  if (!raw) return emptyProviderKeys();
  const value = JSON.parse(raw);
  return {soniox: typeof value.soniox === 'string' ? value.soniox : '', openai: typeof value.openai === 'string' ? value.openai : ''};
}
export async function loadProviderKeys(): Promise<ProviderKeys> {
  if (!isTauri()) return emptyProviderKeys();
  // Existing native credential storage: user-only file permissions on desktop,
  // Never use browser localStorage for keys.
  return parseKeys(await invoke<string | null>('auth_storage_get', {key:storageKey}));
}
export async function saveProviderKeys(keys: ProviderKeys): Promise<void> {
  if (!isTauri()) return; // Browser development keeps supplied keys in memory only.
  await invoke('auth_storage_set', {key:storageKey,value:JSON.stringify(keys)});
}
export function personalKey(mode: ProviderId, keys: ProviderKeys): string {
  const key = keys[mode].trim();
  if (!key || key.length > 4096 || /\s/.test(key)) throw new Error(`Enter a valid ${providerName(mode)} API key.`);
  return key;
}
