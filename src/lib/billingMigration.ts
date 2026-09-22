/** Retire only Audeeo-owned personal key preferences. Authentication stays intact. */
export function clearPersonalKeys(storage: Pick<Storage,'removeItem'>) {
 for(const key of ['audeeo.openai-key','audeeo.soniox-key','audeeo.provider-keys'])storage.removeItem(key);
}
