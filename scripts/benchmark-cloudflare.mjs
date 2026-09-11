import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the account to benchmark.');
const token = process.env.CLOUDFLARE_API_TOKEN || JSON.parse(execFileSync(
  'npx', ['wrangler', 'auth', 'token', '--json'],
  { cwd: new URL('../services/session-relay/', import.meta.url), encoding: 'utf8' },
)).token;
const fixtures = JSON.parse(await readFile(new URL('../benchmarks/fixtures.json', import.meta.url), 'utf8'));
const model = '@cf/meta/m2m100-1.2b';
const results = [];
for (let repetition = 0; repetition < 3; repetition++) {
  for (const fixture of fixtures) {
    const start = performance.now();
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fixture.sourceText, source_lang: fixture.sourceLanguage, target_lang: fixture.targetLanguage }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.result?.translated_text) {
      throw new Error(`Benchmark stopped: HTTP ${response.status}: ${JSON.stringify(data.errors || [])}`);
    }
    results.push({ ...fixture, repetition, translationMs: Math.round(performance.now() - start), text: data.result.translated_text });
    console.log(`${fixture.id} run ${repetition + 1}: ${results.at(-1).translationMs} ms`);
  }
}
const times = results.map(r => r.translationMs).sort((a, b) => a - b);
const report = { date: new Date().toISOString(), model, kind: 'Text API round-trip from developer machine; excludes speech recognition and Worker overhead. Quality requires review.', p50Ms: times[Math.ceil(times.length * 0.5) - 1], p95Ms: times[Math.ceil(times.length * 0.95) - 1], results };
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/cloudflare-translation-benchmark.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(`Saved benchmark: p50 ${report.p50Ms} ms, p95 ${report.p95Ms} ms`);
