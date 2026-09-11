import type { Segment, TranslationMemory } from "./pipeline";
import { languageName } from "./languages";
export const languageNames: Record<string, string> = { en: "English", zh: "Chinese" };
export function translationBody(
  segment: Pick<Segment, "sourceText" | "sourceLanguage" | "targetLanguage">,
  memory: TranslationMemory[] = [],
  terms: TranslationMemory[] = [],
  domains = "",
  model = "qwen-mt-flash",
) {
  return {
    model,
    messages: [{ role: "user", content: segment.sourceText }],
    translation_options: {
      source_lang: (languageNames[segment.sourceLanguage] ?? languageName(segment.sourceLanguage)),
      target_lang: (languageNames[segment.targetLanguage] ?? languageName(segment.targetLanguage)),
      ...(memory.length ? { tm_list: memory.slice(-4) } : {}),
      ...(terms.length ? { terms: terms.slice(0, 50) } : {}),
      ...(domains ? { domains } : {}),
    },
  };
}
