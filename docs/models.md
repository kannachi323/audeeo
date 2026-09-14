# Provider verification — 2026-09-12

No live model quality or latency measurement has been made in this implementation session.

| Component | Verified contract / release choice |
|---|---|
| Recognition | Deepgram Nova-3, streaming `/v1/listen`, mono linear16 at 16 kHz, interim results and endpointing. Explicit `en` or `zh`. US `api.deepgram.com` or EU `api.eu.deepgram.com`. |
| Translation | Qwen-MT-Flash, one user message at the compatible `/chat/completions` endpoint. Use `translation_options` with named source/target languages, `terms`, `domains` and `tm_list`. |
| Benchmark | Qwen-MT-Lite runs only in the benchmark harness, with the same fixtures. No automatic fallback. |
| Speech candidate | Qwen3-TTS-Flash-Realtime first. Documented Chinese/English synthesis; Cherry supports both. WebSocket PCM deltas at 24 kHz with explicit text commit. |

Nova-3 standalone Mandarin support does **not** extend its ten-language multilingual mode to Mandarin. Forced Chinese/English recognition is not language identification. Manual direction is implemented. A separate audio-language-identification stage needs recorded switching fixtures and confidence/abstention validation before automatic direction can be offered. Running two forced-language recognizers and guessing from the resulting text is not a validated replacement. [Deepgram model/language matrix](https://developers.deepgram.com/docs/models-languages-overview), [Mandarin addition](https://developers.deepgram.com/changelog/2026/3/31).

Qwen-MT's September 11 documentation lists Flash at 92 languages and Lite at 31; older localized pages disagree on Lite's count. The app currently exposes only the verified Chinese/English pair. Singapore examples now use a workspace-specific `*.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` base. Configure the actual workspace endpoint; do not silently move data across regions. [Qwen-MT guide](https://www.alibabacloud.com/help/en/model-studio/machine-translation), [API contract](https://www.alibabacloud.com/help/en/model-studio/qwen-mt-api).

## Regular rates, excluding credits and promotional discounts

| Service | Rate used for costing |
|---|---|
| Nova-3 monolingual streaming PAYG | $0.0077/min regular rate (promotional rate is lower) |
| Qwen-MT-Flash Singapore international | $0.16 input / $0.49 output per million tokens |
| Qwen-MT-Lite Singapore international | $0.12 input / $0.36 output per million tokens |
| Qwen3-TTS-Flash-Realtime Singapore international | $0.13 per 10,000 input characters |

Qwen also lists Beijing mainland, Frankfurt global, and Virginia global translation deployments with different prices; these scopes do not imply local-only processing. TTS Singapore and Beijing use different regional keys and WebSocket endpoints. [Deepgram pricing](https://deepgram.com/pricing), [Alibaba pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [Qwen streaming TTS](https://www.alibabacloud.com/help/en/model-studio/realtime-tts-user-guide), [voice languages](https://help.aliyun.com/en/model-studio/qwen-tts-voice-list), [TTS events](https://www.alibabacloud.com/help/en/model-studio/qwen-tts-realtime-client-events).

Qwen is the first speech candidate because its documented contract covers this pair and streaming. No measured comparison with ElevenLabs or Cartesia is available, so no quality or latency winner is asserted. Deepgram recognition languages are not evidence of Deepgram voice support.

## Benchmark method

`npm run benchmark` runs Flash and Lite against identical bilingual fixtures three times with alternating model order. It records API completion latency, returned token usage, actual billed-token cost at the regional rate, outputs and errors. Names, numbers, negation, sentence pauses and mixed-language text are included. A bilingual evaluator must score critical semantic errors and names/numbers preservation blind to model identity. Text-only results cannot establish recognition, acoustic switching, accent or fast-speech performance.

Record consented audio fixtures for Mandarin, English, accented speakers, rapid speech, long pauses, and turn/code switching. Timestamp capture start, speech onset, first source caption, first useful translation and first audible playback using the same monotonic clock. Run each fixture identically for both translation models. Capture p50/p95 latency, critical error counts, dropped/unsynthesized captions, input/output tokens, TTS characters, recognition billable seconds and infrastructure costs. Use `benchmarks/session-metrics.example.json`; null means unmeasured.

`python3 scripts/costs.py METRICS --included-minutes N --store-fee F --target-margin M --overhead-per-subscriber C` calculates a sustainable monthly floor from measured costs. It refuses the unmeasured example. No final price, included minutes, or speech policy has been invented or activated.

## Dedicated language identification investigation

SpeechBrain's VoxLingua107 ECAPA-TDNN is a concrete audio-only LID candidate: its model card includes English and Mandarin and accepts 16 kHz mono utterances. It predicts from audio, independently of forced-language ASR. The authors explicitly report accent and demographic limitations; its published aggregate error rate is not evidence for Audeeo's short bilingual turns. Qualification should test confidence calibration, abstention on mixed/short/noisy segments, language-switch delay, battery/CPU cost and native packaging (or the latency/privacy/cost of a separate service). No automatic mode is enabled based on this candidate. [Primary model card](https://huggingface.co/speechbrain/lang-id-voxlingua107-ecapa).
