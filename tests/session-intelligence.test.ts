import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn(), entitlement: vi.fn(), development: vi.fn(() => false) }));
vi.mock("../services/session-relay/src/backend", () => ({
  db: mocks.db, refreshEntitlement: mocks.entitlement, isDevelopmentUser: mocks.development,
}));
import { contextFromLink, generateSummary } from "../services/session-relay/src/intelligence";

const transcriptRows = [{ id:"one",state:"complete",sequence:0,start_ms:1200,end_ms:3000,source_text:"Faith seeks understanding." }];
const modelResult = { title:"Faith",recap:"A recap",keyPoints:["One"],notableTerms:[{term:"faith",explanation:"Trust"}],actionItems:[],chapters:[{title:"Opening",startMs:1200,summary:"Start"}],quotations:[{text:"Faith seeks understanding.",startMs:999},{text:"Invented quote",startMs:1}] };

describe("session intelligence", () => {
  beforeEach(() => {
    vi.restoreAllMocks(); mocks.db.mockReset(); mocks.entitlement.mockReset(); mocks.entitlement.mockResolvedValue({active:true}); mocks.development.mockReturnValue(false);
    mocks.db.mockImplementation(async (_env:any,path:string,_body?:any,method?:string) => {
      if (path.startsWith("caption_sessions?")) return [{id:"11111111-1111-4111-8111-111111111111",target_language:"en",transcript:transcriptRows,transcript_version:3}];
      if (path === "rpc/save_caption_summary") return {..._body.p_summary,created_at:"now"};
      throw new Error(`unexpected db call ${method} ${path}`);
    });
  });
  it("ignores BYOK and uses the server key, disables OpenAI storage, validates exact quotations, and saves the owned result against the source version", async () => {
    const fetch = vi.fn(async (_url:string,options:any) => ({ok:true,json:async()=>({output_text:JSON.stringify(modelResult)})}));
    vi.stubGlobal("fetch",fetch);
    const result = await generateSummary({SUMMARY_MODEL:"gpt-5.6-luna",OPENAI_API_KEY:"server"} as any,"owner-a","11111111-1111-4111-8111-111111111111",{language:"en",instructions:"",openaiApiKey:"sk-user"});
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request).toMatchObject({model:"gpt-5.6-luna",store:false,reasoning:{effort:"low"},text:{format:{type:"json_schema",strict:true}}});
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer server");
    expect(mocks.entitlement).toHaveBeenCalled();
    expect(result.content.quotations).toEqual([{text:"Faith seeks understanding.",startMs:1200}]);
    expect(mocks.db).toHaveBeenCalledWith(expect.anything(),"rpc/save_caption_summary",expect.objectContaining({p_owner:"owner-a",p_version:3}));
    vi.unstubAllGlobals();
  });
  it("refuses server-key spending after a failed fresh entitlement check", async () => {
    mocks.entitlement.mockResolvedValue({active:false});
    await expect(generateSummary({OPENAI_API_KEY:"server"} as any,"owner-a","11111111-1111-4111-8111-111111111111",{language:"en"})).rejects.toMatchObject({status:402});
  });
  it("uses hosted web search for a public link and returns validated editable context", async () => {
    const fetch = vi.fn(async (_url:string,options:any) => ({ok:true,json:async()=>({output_text:JSON.stringify({category:"education",text:"A public lecture",terms:["eudaimonia"],translationTerms:[{source:"eudaimonia",target:"幸福生活"}]})})}));
    vi.stubGlobal("fetch",fetch);
    const result = await contextFromLink({SUMMARY_MODEL:"gpt-5.6-luna",OPENAI_API_KEY:"server"} as any,"owner-a",{url:"https://www.youtube.com/watch?v=example",targetLanguage:"zh",openaiApiKey:"sk-user"});
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request).toMatchObject({store:false,tools:[{type:"web_search"}],text:{format:{type:"json_schema",strict:true}}});
    expect(result).toMatchObject({category:"education",terms:["eudaimonia"]});
    await expect(contextFromLink({} as any,"owner-a",{url:"http://localhost/video",targetLanguage:"en",openaiApiKey:"x"})).rejects.toMatchObject({status:400});
    vi.unstubAllGlobals();
  });
});
