import { readFile, writeFile, mkdir } from "node:fs/promises";
import { translationBody } from "../shared/translation.ts";
const fixtures = JSON.parse(
  await readFile(
    new URL("../benchmarks/fixtures.json", import.meta.url),
    "utf8",
  ),
);
const key = process.env.QWEN_API_KEY,
  base = process.env.QWEN_BASE_URL;
if (!key || !base) {
  console.error(
    "BLOCKED: set server-side QWEN_API_KEY and the verified regional QWEN_BASE_URL. No benchmark requests were made.",
  );
  process.exit(2);
}
const models = ["qwen-mt-flash", "qwen-mt-lite"];
const rates = {
  "qwen-mt-flash": { input: 0.16, output: 0.49 },
  "qwen-mt-lite": { input: 0.12, output: 0.36 },
};
const results = [];
for (let repetition = 0; repetition < 3; repetition++)
  for (const fixture of fixtures)
    for (const model of repetition % 2 ? [...models].reverse() : models) {
      const start = performance.now();
      try {
        const response = await fetch(
          `${base!.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(translationBody(fixture, [], [], "", model)),
            signal: AbortSignal.timeout(20000),
          },
        );
        const data = (await response.json()) as any;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rate = rates[model as keyof typeof rates];
        results.push({
          id: fixture.id,
          model,
          repetition,
          translationMs: performance.now() - start,
          text: data.choices?.[0]?.message?.content,
          usage: data.usage,
          costUSD: data.usage
            ? (data.usage.prompt_tokens * rate.input +
                data.usage.completion_tokens * rate.output) /
              1e6
            : null,
          qualityScore: null,
          region: base,
        });
      } catch (e) {
        results.push({ id: fixture.id, model, repetition, error: String(e) });
      }
    }
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/translation-benchmark.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      kind: "text-only API latency; not live speech latency",
      ratesBasis:
        "Singapore regular rates verified 2026-09-12; override code if deploying another scope",
      results,
    },
    null,
    2,
  ),
);
console.log(
  "Saved artifacts/translation-benchmark.json. Bilingual review required; no automated quality advantage is claimed.",
);
