export const contextCategories = [
  "general", "business", "education", "technology", "science", "medical",
  "legal", "finance", "news-politics", "religious-spiritual", "philosophy",
  "entertainment", "sports", "travel", "custom",
] as const;

export type ContextCategory = typeof contextCategories[number];
export type TranslationTerm = { source: string; target: string };
export type SessionContext = {
  category: ContextCategory;
  text: string;
  terms: string[];
  translationTerms: TranslationTerm[];
};

export const contextCategoryOptions: readonly {value: ContextCategory; label: string}[] = [
  {value:"general",label:"General"},{value:"business",label:"Business"},
  {value:"education",label:"Education"},{value:"technology",label:"Technology"},
  {value:"science",label:"Science"},{value:"medical",label:"Medical"},
  {value:"legal",label:"Legal"},{value:"finance",label:"Finance"},
  {value:"news-politics",label:"News & Politics"},
  {value:"religious-spiritual",label:"Religious & Spiritual"},
  {value:"philosophy",label:"Philosophy"},{value:"entertainment",label:"Entertainment"},
  {value:"sports",label:"Sports"},{value:"travel",label:"Travel"},
  {value:"custom",label:"Custom"},
];

export const emptySessionContext = (): SessionContext => ({category:"general",text:"",terms:[],translationTerms:[]});
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function sessionContext(value: unknown): SessionContext {
  if (!value || typeof value !== "object") return emptySessionContext();
  const raw = value as Partial<SessionContext>;
  if (!contextCategories.includes(raw.category as ContextCategory)) throw new Error("Choose a supported context category.");
  if (!Array.isArray(raw.terms) || !Array.isArray(raw.translationTerms)) throw new Error("Context terms are invalid.");
  if (typeof raw.text !== "string" || raw.text.length > 10000 || raw.terms.length > 100 || raw.translationTerms.length > 100 ||
      raw.terms.some(term=>typeof term !== "string" || !term.trim() || term.trim().length > 160) ||
      raw.translationTerms.some(term=>!term || typeof term.source !== "string" || typeof term.target !== "string" || !term.source.trim() || !term.target.trim() || term.source.trim().length > 160 || term.target.trim().length > 160))
    throw new Error("Context terms are malformed or too long.");
  const result: SessionContext = {
    category: raw.category as ContextCategory,
    text: raw.text.trim(),
    terms: raw.terms.map(term=>clean(term)),
    translationTerms: raw.translationTerms.map(term=>({ source: clean(term.source), target: clean(term.target) })),
  };
  if (contextSize(result) > 10000) throw new Error("Context is too long. Keep it under 10,000 characters.");
  return result;
}

export function contextSize(value: SessionContext) {
  const preset = value.category === "general" || value.category === "custom" ? "" : contextCategoryOptions.find(option=>option.value===value.category)?.label || "";
  return preset.length + value.text.length + value.terms.reduce((n,term)=>n+term.length,0)
    + value.translationTerms.reduce((n,term)=>n+term.source.length+term.target.length,0);
}

export function parseTerms(value: string) {
  return [...new Set(value.split(/[\n,]/).map(term=>term.trim()).filter(Boolean))].slice(0,100);
}

export function parseTranslationTerms(value: string): TranslationTerm[] {
  return value.split("\n").map(line=>{
    const parts = line.split(/\s*(?:=>|=|→)\s*/);
    return {source:(parts.shift()||"").trim(),target:parts.join(" = ").trim()};
  }).filter(term=>term.source && term.target).slice(0,100);
}

export function formatTranslationTerms(terms: TranslationTerm[]) {
  return terms.map(term=>`${term.source} = ${term.target}`).join("\n");
}

export function sonioxContext(value: SessionContext) {
  const category = contextCategoryOptions.find(option=>option.value===value.category)?.label;
  return {
    ...(value.category === "general" || value.category === "custom" ? {} : {general:[{key:"domain",value:category!}]}),
    ...(value.text ? {text:value.text} : {}),
    ...(value.terms.length ? {terms:value.terms} : {}),
    ...(value.translationTerms.length ? {translation_terms:value.translationTerms.map(term=>({...term}))} : {}),
  };
}

export const hasSessionContext = (value: SessionContext) =>
  value.category !== "general" || !!value.text || !!value.terms.length || !!value.translationTerms.length;
