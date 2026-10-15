import { describe, expect, it } from "vitest";
import { SonioxCaptions, sonioxConfig, Transcript, type Segment } from "../src/index.js";

const result = (tokens: unknown[]) => ({ tokens }) as Parameters<SonioxCaptions["ingest"]>[0];

describe("soniox segments with speakers", () => {
  it("opts into diarization and passes context through", () => {
    const config = sonioxConfig("auto", "auto", { diarization: true, context: { terms: ["Misty"] } });
    expect(config).toMatchObject({ enable_speaker_diarization: true, context: { terms: ["Misty"] } });
    expect(config).not.toHaveProperty("translation");
    expect(sonioxConfig("en", "en")).not.toHaveProperty("enable_speaker_diarization");
    expect(sonioxConfig("en", "en", { context: {} })).not.toHaveProperty("context");
  });

  it("starts a new segment when a final token comes from another speaker", () => {
    const events: Segment[] = [];
    const captions = new SonioxCaptions("s", "en", "en", (s) => events.push(s), { channel: "system" });
    captions.ingest(result([
      { text: "Hi", is_final: true, speaker: 1, start_ms: 0, end_ms: 200 },
      { text: " there", is_final: true, speaker: 1, start_ms: 200, end_ms: 400 },
      { text: " Hello", is_final: true, speaker: 2, start_ms: 600, end_ms: 800 },
      { text: " back", is_final: false, speaker: 2 },
    ]), 900);
    const first = events.find((e) => e.final)!;
    expect(first).toMatchObject({ sourceText: "Hi there", speaker: "1", channel: "system", state: "complete" });
    expect(first.words).toEqual([
      { text: "Hi", t0: 0, t1: 200, speaker: "1" },
      { text: "there", t0: 200, t1: 400, speaker: "1" },
    ]);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ sourceText: " Hello back", speaker: "2", final: false });
    expect(last.id).not.toBe(first.id);
    expect(last.sequence).toBe(first.sequence + 1);
  });

  it("joins sub-word tokens into words and revises in order", () => {
    const events: Segment[] = [];
    const captions = new SonioxCaptions("s", "en", "en", (s) => events.push(s));
    captions.ingest(result([{ text: "Mis", is_final: true, speaker: "1", start_ms: 0, end_ms: 100 }]), 100);
    captions.ingest(result([{ text: "ty", is_final: true, speaker: "1", start_ms: 100, end_ms: 180 }]), 200);
    captions.flush();
    const final = events.at(-1)!;
    expect(final.words).toEqual([{ text: "Misty", t0: 0, t1: 180, speaker: "1" }]);
    expect(events.map((e) => e.revision)).toEqual([1, 2, 3]);
  });

  it("drops translation output for transcribe-only sessions", () => {
    const events: Segment[] = [];
    const captions = new SonioxCaptions("s", "en", "es", (s) => events.push(s), { noTranslation: true });
    captions.ingest(result([{ text: "Hola", is_final: true, translation_status: "translation" }]), 0);
    expect(events).toEqual([]);
  });
});

describe("transcript revisions", () => {
  const segment = (id: string, revision: number, text: string, extra: Partial<Segment> = {}): Segment => ({
    id, sessionId: "s", sequence: Number(id.at(-1)), revision, startMs: Number(id.at(-1)) * 1000, endMs: 0,
    sourceLanguage: "en", targetLanguage: "en", sourceText: text, translatedText: "",
    final: false, state: "provisional", ...extra,
  });

  it("keeps the newest revision and never replaces a final one", () => {
    const transcript = new Transcript();
    expect(transcript.accept(segment("a1", 2, "two"))).toBe(true);
    expect(transcript.accept(segment("a1", 1, "one"))).toBe(false);
    expect(transcript.accept(segment("a1", 3, "three", { final: true, state: "complete" }))).toBe(true);
    expect(transcript.accept(segment("a1", 4, "changed"))).toBe(false);
    expect(transcript.segments().map((s) => s.sourceText)).toEqual(["three"]);
  });

  it("groups consecutive speakers into turns and keeps channels apart", () => {
    const transcript = new Transcript();
    transcript.accept(segment("a1", 1, "Hello", { channel: "mic" }));
    transcript.accept(segment("a2", 1, "Hi", { channel: "system", speaker: "1" }));
    transcript.accept(segment("a3", 1, "how are you", { channel: "system", speaker: "1" }));
    transcript.accept(segment("a4", 1, "Fine", { channel: "system", speaker: "2" }));
    expect(transcript.turns().map((t) => [t.speaker, t.text])).toEqual([
      ["you", "Hello"],
      ["system:1", "Hi how are you"],
      ["system:2", "Fine"],
    ]);
    const names: Record<string, string> = { you: "You", "system:1": "Ana" };
    expect(transcript.text((s) => names[s] ?? "Speaker")).toBe("You: Hello\nAna: Hi how are you\nSpeaker: Fine");
  });
});
