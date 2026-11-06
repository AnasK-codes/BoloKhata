# LATENCY.md: measured Gnani results

**Status: no real measurements yet.** The spike (`pnpm spike`) has not been run against the real Gnani API, so this file contains no numbers. The values in `.env.example` and the README (STT format, language, VAD, pre-roll, drain, TTS model, voice, sample rate) are starting points, not measured choices.

This file is overwritten by a complete real run (`pnpm spike --label <where-you-ran-it>`, all experiments A to F). A mock run or a partial `--only` run never overwrites it.

## To produce the real results

1. Record the clips described in `scripts/spike/clips/README.md` and add `clips.json`.
2. Put `GNANI_API_KEY` in `.env`.
3. `pnpm spike --dry-run` to check the plan and estimated credit use (sends nothing).
4. `pnpm spike --label laptop` (spends credits; default budget 150 s of audio and 1,500 TTS characters).
5. Later, repeat from the AWS instance with `--label ec2-mumbai` and compare.

Until then, do not quote any latency number from code comments, docs or social copy.


## Mock-server measurements (NOT the real Gnani API)

These come from the hardening pass on a developer laptop with the **mock** Gnani servers (fixed delays: STT answers 120 ms after commit, TTS speaks 20 ms per character). They show what the gateway and the browser add on top of the upstream and that nothing leaks. **Do not quote them as Gnani latency.** The real-API table above is still empty until `pnpm spike` is run.

| What | Before this pass (20x120 soak) | After this pass (final 20x50 run) |
|---|---|---|
| Turns completed | 2,400 / 2,400 | 1,000 / 1,000 (105 interrupted, 33 reconnects) |
| Frames sent / received by the mock STT | 106,949 / 106,949 | 44,537 / 44,537; 0 pacing violations |
| Gateway event-loop delay p99 (median of 2 s windows; worst window) | about 1.2 ms; worst 2.1 ms | 2.0 ms; worst 9.1 ms (laptop also running the load generator and mocks) |
| Release to transcript at the client (mock STT delay is 120 ms) | p50 121.0, p95 122.0 ms | p50 121.0, p95 122.2 ms |
| Release to first TTS byte at the client | p50 151.8, p95 153.9 ms | p50 152.3, p95 154.5 ms |
| Heap floor slope | 0.06 MB/min | -1.14 MB/min (no growth) |
| Web JavaScript+CSS for `/` (gzip, 12 files) | 285,305 B | 283,092 B (seed catalog and dev tone lazy-loaded) |

The two runs have different lengths (2,400 vs 1,000 turns) and random interrupt rates, so small differences are noise: the gateway path was not changed in this pass and the numbers show no regression. The 20x120 soak is described in `docs/TESTING.md` section 1. Bundle sizes are bytes of gzip over the files listed in the built `/` HTML (`apps/web/.next/server/app/index.html`), not a transfer measurement over a network.

### Backend pass, 2026-11-06 (mock servers, NOT the real Gnani API)

Same 20x50 `pnpm loadtest` on one laptop, before and after the backend fixes (`docs/BACKEND_REVIEW.md`). No hot-path code changed; the differences are noise.

| What | Before | After |
|---|---|---|
| Turns completed | 1,000 / 1,000 | 1,000 / 1,000 |
| Frames sent / received by the mock STT | 44,391 / 44,391 | 44,236 / 44,236 |
| Gateway event-loop delay p99 (median of windows; worst) | 1.67 ms; 2.75 ms | 1.85 ms; 2.85 ms |
| Release to transcript (mock STT delay 120 ms) | p50 121.0, p95 122.3 ms | p50 121.1, p95 122.6 ms |
| Release to first TTS byte | p50 152.1, p95 154.5 ms | p50 152.2, p95 154.7 ms |
| Heap floor slope | 0.06 MB/min | -1.5 MB/min |

In-process, rules parse took p50 0.017 ms and p99 0.045 ms per utterance on the 24-sentence eval set, at most 0.44 ms on adversarial 500-character strings.

## LLM fallback (Gemini, free tier): measured 2026-11-06

Measured from one laptop on one home network, with the real Gemini API. **Not** a Gnani result: the speech-to-text and text-to-speech numbers above are unrelated. Provider: `openai-compatible` against `https://generativelanguage.googleapis.com/v1beta/openai/`, model `gemini-3.1-flash-lite`, `OPENAI_REASONING_EFFORT=low`. Only synthetic sentences were sent.

**Speed** (`pnpm --filter @bolbill/gateway llm:eval`, calls one at a time):

| What | Result |
|---|---|
| Single-call check, `gemini-3.1-flash-lite`, default thinking (5 calls) | 1.4, 1.5, 1.5, 2.6, 3.6 s |
| Same model, `reasoning_effort` `minimal` (4 calls) | 1.5, 1.6, 1.7 s and one call with no answer after 8 s |
| Same model, `reasoning_effort` `low` (4 calls) | 1.7, 1.8, 1.8, 2.0 s |
| Evaluation run 1 (28 calls) | p50 2.7 s, p95 12 s; 12 of 28 finished within 2.5 s; 2 failed |
| Evaluation run 2 (25 calls) | p50 1.8 s, p95 12 s; 17 of 25 finished within 2.5 s; 2 failed |
| `gemini-3.8-flash` | No answer after 8 s, 2 of 2 tries |
| `gemini-2.5-flash`, `gemini-2.5-flash-lite` | HTTP 404 on this endpoint |

The floor from this network is about 1.5 s, so the old 1.2 s timebox would almost always time out. The gateway now uses `LLM_TIMEOUT_MS=2500` in the local `.env`. When the model does not answer in time the turn keeps the rules result with a review flag, so the cost of a slow model is a wait of up to 2.5 s on a sentence the rules were unsure about, never a wrong price.

**Accuracy** on 24 synthetic sentences (control, Devanagari, noisy, natural, guard; `apps/gateway/src/parse/llm/evalSet.ts`), counting a sentence correct only when intent, customer, items and amounts all match:

| Reading | Run 1 (rules as they were) | Run 2 (after the rule fixes below) |
|---|---|---|
| Rules only | 20/24 | 24/24 |
| Rules, model only when unsure (gateway fallback mode) | 23/24 | 24/24 |
| Model on every sentence | 24/24 | 24/24 |

Run 1 showed four rule misses: a Devanagari payment ("रुपए" was not read as money), "के लिए" before a customer, the honorific "बहन", and fillers like "uh" and "haan". Those were fixed in the rules (with regression tests) and run 2 was measured after. **Run 2 is not a held-out result:** the rules were tuned on these same 24 sentences, so 24/24 says the four known misses are fixed, not that the rules are 100% accurate. Treat run 1 as the fairer picture of how often rules alone miss and a model can help.

In fallback mode one run-1 sentence stayed wrong because the rules were confident but incorrect, and the model is only asked when the rules are unsure. That is the main limit of fallback mode.

Across both runs, whenever the rules and the model agreed on the items the totals were identical (0 mismatches in each run), as intended: prices come from the catalog in code, never from the model.
