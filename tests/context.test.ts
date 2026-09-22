import { describe, expect, it } from "vitest";
import { contextSize, parseTranslationTerms, sessionContext, sonioxContext } from "../shared/context";

describe("translation context", () => {
  it("parses mappings and rejects malformed categories", () => {
    expect(parseTranslationTerms("logos = Logos\nempty\n仁 => benevolence")).toEqual([
      { source: "logos", target: "Logos" }, { source: "仁", target: "benevolence" },
    ]);
    expect(() => sessionContext({category:"unknown",text:"",terms:[],translationTerms:[]})).toThrow();
    expect(() => sessionContext({category:"general",text:"",terms:[],translationTerms:[{source:"missing target"}]})).toThrow();
  });
  it("maps presets and structured fields to Soniox", () => {
    expect(sonioxContext(sessionContext({category:"philosophy",text:"Aristotle",terms:["eudaimonia"],translationTerms:[{source:"λόγος",target:"logos"}]}))).toEqual({
      general:[{key:"domain",value:"Philosophy"}], text:"Aristotle", terms:["eudaimonia"], translation_terms:[{source:"λόγος",target:"logos"}],
    });
  });
  it("enforces the combined 10,000 character limit", () => {
    expect(contextSize(sessionContext({category:"custom",text:"x".repeat(9999),terms:["y"],translationTerms:[]}))).toBe(10000);
    expect(() => sessionContext({category:"custom",text:"x".repeat(10000),terms:["y"],translationTerms:[]})).toThrow();
  });
  it("preserves a custom category and uses it only when Custom is selected", () => {
    const value = sessionContext({category:"custom",customCategory:" Architecture ",text:"",terms:[],translationTerms:[]});
    expect(value.customCategory).toBe("Architecture");
    expect(sessionContext(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(sonioxContext(value)).toEqual({general:[{key:"domain",value:"Architecture"}]});
    expect(sonioxContext({...value,category:"general"})).toEqual({});
    expect(sonioxContext({...value,category:"science"})).toEqual({general:[{key:"domain",value:"Science"}]});
    expect(contextSize(value)).toBe(12);
    expect(() => sessionContext({...value,customCategory:"x".repeat(161)})).toThrow();
    expect(() => sessionContext({...value,text:"x".repeat(9990)})).toThrow();
  });
});
