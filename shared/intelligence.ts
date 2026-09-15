export type NotableTerm = { term: string; explanation: string };
export type SessionChapter = { title: string; startMs: number; summary: string };
export type SessionQuote = { text: string; startMs: number };
export type SessionSummaryContent = {
  title: string;
  recap: string;
  keyPoints: string[];
  notableTerms: NotableTerm[];
  actionItems: string[];
  chapters: SessionChapter[];
  quotations: SessionQuote[];
};
export type SavedSessionSummary = {
  session_id: string;
  language: string;
  content: SessionSummaryContent;
  model: string;
  created_at: string;
  updated_at: string;
};

const strings = (value: unknown, maxItems: number, maxLength: number) => Array.isArray(value)
  ? value.filter(item=>typeof item === "string").slice(0,maxItems).map(item=>item.trim().slice(0,maxLength)).filter(Boolean) : [];
export function summaryContent(value: unknown): SessionSummaryContent {
  if (!value || typeof value !== "object") throw new Error("Invalid summary response.");
  const v = value as any;
  const recap = typeof v.recap === "string" ? v.recap.trim().slice(0,8000) : "";
  if (!recap) throw new Error("Invalid summary response.");
  return {
    title: typeof v.title === "string" ? v.title.trim().slice(0,160) : "",
    recap,
    keyPoints: strings(v.keyPoints,20,1000),
    notableTerms: Array.isArray(v.notableTerms) ? v.notableTerms.slice(0,30).map((item:any)=>({term:String(item?.term||"").trim().slice(0,160),explanation:String(item?.explanation||"").trim().slice(0,1000)})).filter((item:NotableTerm)=>item.term&&item.explanation) : [],
    actionItems: strings(v.actionItems,20,1000),
    chapters: Array.isArray(v.chapters) ? v.chapters.slice(0,30).map((item:any)=>({title:String(item?.title||"").trim().slice(0,160),startMs:Number(item?.startMs),summary:String(item?.summary||"").trim().slice(0,1000)})).filter((item:SessionChapter)=>item.title&&Number.isInteger(item.startMs)&&item.startMs>=0&&item.summary) : [],
    quotations: Array.isArray(v.quotations) ? v.quotations.slice(0,20).map((item:any)=>({text:String(item?.text||"").trim().slice(0,1000),startMs:Number(item?.startMs)})).filter((item:SessionQuote)=>item.text&&Number.isInteger(item.startMs)&&item.startMs>=0) : [],
  };
}
