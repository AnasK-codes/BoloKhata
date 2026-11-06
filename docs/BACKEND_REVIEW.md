# Backend review (branch `fix/backend-hardening`), 2026-11-06

Scope: `apps/gateway`, `packages/shared` (non-UI), `tools/mock-gnani`, `scripts`, `deploy`, compose, Dockerfiles, CI, `supabase/`, `docs/`. `apps/web` was not touched (a frontend session runs in parallel; see the last section). Mock Gnani servers only: no real Gnani, LLM or AWS call was made. The protocol is unchanged.

## 1. Baseline and after (mock servers, one laptop, NOT the real Gnani API)

`pnpm loadtest` = 20 clients x 50 turns against a real gateway process and the mock Gnani servers (STT answers 120 ms after commit, TTS 20 ms per character). Micro-benchmarks ran in-process with `tsx` over the 24 synthetic sentences of `apps/gateway/src/parse/llm/evalSet.ts` and the seed catalog (`data/seed-catalog.json`, 43 products, 8 customers).

| What | Before | After |
|---|---|---|
| Turns completed | 1,000 / 1,000 (100 interrupted, 41 reconnects) | 1,000 / 1,000 (108 interrupted, 30 reconnects) |
| Frames sent / received by the mock STT | 44,391 / 44,391; 0 pacing violations | 44,236 / 44,236; 0 pacing violations |
| Gateway event-loop delay p99 (median of windows; worst window) | 1.67 ms; worst 2.75 ms | 1.85 ms; worst 2.85 ms |
| Release to transcript at the client | p50 121.0, p95 122.3 ms | p50 121.1, p95 122.6 ms |
| Release to first TTS byte at the client | p50 152.1, p95 154.5 ms | p50 152.2, p95 154.7 ms |
| Heap floor slope | 0.06 MB/min | -1.5 MB/min (no growth) |
| Gateway RSS start / peak / end | 129 / 148 / 114 MB (20 sessions) | 123 / 149 / 117 MB |
| (Before and after differ only by noise: the runs have random interrupt rates, and no hot-path code changed.) | | |
| Rules parse per utterance (4,800 parses) | p50 0.017 ms, p99 0.045 ms, max 0.17 ms | not re-measured (parser code unchanged) |
| Rules parse, worst 500-character strings (random Devanagari, Latin, repeated words) | at most 0.44 ms | covered by the new fuzz test (bound 50 ms for CI) |
| `ptt_start` size and validation (Zod) | null context 51 B / 0.001 ms; 3-item bill 658 B / 0.008 ms; 40-item bill 4,458 B / 0.026 ms (p50) | unchanged |
| `hello` size and validation | seed catalog 6,238 B; 500 products x 12 aliases + 500 customers 157,343 B / 0.96 ms | unchanged |
| Catalog index rebuild (`context_update`) | seed 0.15 ms; 500/500 8.7 ms | unchanged |
| Memory per 500/500 catalog index | about 2.6 MB | unchanged |
| LLM prompt | system 3,433 chars (static); user block 658 chars (seed), 3,337 chars (500/500) | unchanged |

**Speed conclusion.** Nothing on the hot path or the parse path is worth changing: rules parse in microseconds, the largest realistic `ptt_start` validates in 26 µs, and loop delay stays near 2 ms under 20 sessions. The one speed change is the LLM circuit breaker (B-06), which removes up to `LLM_TIMEOUT_MS` from every unsure sentence while a provider is failing. It is a behaviour change proven by tests, not a measured latency gain; no real LLM call was made to measure it.

## 2. Findings

Severity: critical / high / medium / low. Every "fixed" row has a test that failed before the fix and passes after (except B-11, a header checked by `curl` through Caddy).

| id | sev | evidence | root cause | fix | test |
|---|---|---|---|---|---|
| B-01 | high | `cp .env.example .env` then start: `OPENAI_REASONING_EFFORT: Invalid option` and the gateway exits | the new enum did not treat a blank value as unset, unlike every other optional | blank means unset | `config.test.ts` "starts from a copy of .env.example" |
| B-02 | high | production accepted `SESSION_TOKEN_SECRET=replace-with-a-long-random-string` (33 chars passes `min(16)`), `GNANI_API_KEY=replace-me` and `http://` origins | no production-only checks | with `NODE_ENV=production` (set by the images): secret at least 32 chars and not a placeholder, key not a placeholder, origins `https://` | `config.test.ts` "in production" |
| B-03 | medium | 3 wrong access codes from one IP with a per-IP limit of 2: all answered 403, then the right code got 200 | the access code was checked before the rate limit, so guesses were free | rate limit first | `demoGuard.test.ts` "counts wrong access codes" |
| B-04 | high | daily STT/TTS caps lived in a `Map`; `restart: unless-stopped`, a crash or a redeploy resets them | no persistent store (the interface anticipated one) | `FileCreditStore`: today's counters in a JSON file (async tmp+rename, coalesced, per turn not per frame); compose puts it on the cache volume via `CREDIT_USAGE_FILE`; unset = memory (tests) | `guard.test.ts` "file credit store"; also checked in the real container: 1.28 STT s before and after `docker compose restart gateway` |
| B-05 | medium | draft context = a payment from an unknown customer, then "haan": gateway answered `intent: confirm` ("saved"), the browser refuses to save it | "can this be confirmed" was written three times (`onPttStart`, the correction path, the browser's `isConfirmable`) and the gateway copy ignored the customer for payments | one `isConfirmable` in `packages/shared/src/domain/confirm.ts` (the browser's rule, unchanged), used by both gateway paths; drafts with no confirmable intent no longer become a pending bill | `turnEngine.test.ts` "a draft the browser cannot save"; `confirm.test.ts` for every intent |
| B-06 | medium | a provider that times out costs `LLM_TIMEOUT_MS` (2.5 s with the Gemini setting) on every unsure sentence, and the free tier rate-limits | no memory of provider health | circuit breaker in the Orchestrator: 3 consecutive timeouts/errors or one 429/`ThrottlingException` skip the model for 30 s; off for `llm:eval` | `orchestrator.test.ts` "circuit breaker" |
| B-07 | medium | `verifyAccount` used `AbortSignal.timeout(8000)` per call, two calls: up to 16 s, while the web broker gives up at 8 s | per-call timeouts | one 5 s deadline for both calls, fails closed (503) | `account.test.ts` "one deadline" |
| B-08 | medium | `oldestUnpaidSince`: a payment larger than the balance (an advance) did not settle the next udhaar, and a reversed udhaar kept the payment that had settled it, so a customer with balance 0 or below could show an unpaid date (shown in Khata) | FIFO lots without an advance pool; reversal only zeroed the lot | advances carry forward; a reversed udhaar and its reversal are removed together | `overdue.test.ts` property test (500 random ledgers: date is null exactly when balance is not positive) |
| B-09 | medium | catalog line with quantity 1e15 kg gave a line total of 4.5e16 (not a safe integer); the outbound draft schema would drop the message and the turn would go silent | the catalog path had no quantity bound (the spoken-price path did) | same 1,000,000-unit bound and a safe-integer check; such a line becomes unresolved. The duplicate half-up helper in pricing was removed (one rounding rule, in `adjustments.ts`) | `money.property.test.ts` (2,000 random bills incl. NaN, negative, fractional, 1e300) |
| B-10 | low | migration failed on a second run (`policy ... already exists`); `authenticated` kept Supabase's default ALL grant, and `TRUNCATE` (which RLS does not cover) emptied every user's profile on a local Postgres | `create policy` without `drop if exists`; grants added, never narrowed | drop-if-exists policies; revoke all, grant select/insert/update | run twice on local Postgres 18 with an `auth` shim: both runs ok, owner sees 1 row, another user 0, anon/delete/truncate denied; before the fix, truncate succeeded |
| B-11 | low | `curl -I https://localhost/sw.js` through Caddy: two `Cache-Control` headers (`no-cache` and Next's `max-age=0`) | `header` adds before the proxied response | deferred replace (`>Cache-Control`), also for the manifest | `curl` through the compose stack: one header |
| B-12 | high, **open** | `apps/web/src/lib/auth/server.ts` calls the gateway's `/session` without `X-Forwarded-For`, so the gateway sees the web container's address for every user | the broker does not pass on the client address | needs a frontend change (section 5). Until then, every visitor shares `SESSION_RATE_PER_IP_PER_MIN` (default 10 sessions a minute for the whole app) | not fixable here; the gateway side is tested ("uses the address the proxy appended") |
| B-13 | low, suspected | a frame over the 257 KB `maxPayload` logs one level-50 error with a stack per attempt | logged by the websocket library | not changed (log rotation caps it at 30 MB) | - |
| B-14 | low, no impact | the parser fuzz found the rules can emit `quantity: 0` or an invalid-quote marker on garbage text | intended "needs review" markers | not changed: pricing turns them into unresolved items (asserted by the fuzz test) | `parser/fuzz.test.ts` |

Reviewed, no defect found: token HMAC with constant-time compare, single use and 120 s expiry (also through Caddy with the smoke script); origin allowlist on `/session` and `/ws`; per-IP derivation behind a private-address proxy; interrupt and superseded turns (late transcript, late model answer, late TTS are discarded; the model `fetch` is aborted); heartbeat; graceful SIGTERM drain (`docker compose stop` exits 0 well inside the 30 s grace period); `/metrics` 404 publicly; transcript and catalog names reach the model only fenced and stripped of `<>`; `OPENAI_BASE_URL` is env-only; a failing provider degrades to rules; containers run as a non-root user; `pnpm audit --prod` reports no known vulnerabilities.

The new fuzz test sends 720 random frames and messages (random bytes, broken UTF-8, valid messages with mutated fields and unknown keys) over 6 sessions: no throw, no hang, and a fresh session completes a turn afterwards.

**Unhandled errors policy.** There is no `unhandledRejection` handler, so Node's default applies: the process exits and Docker restarts it (`restart: unless-stopped`). With B-04 the caps survive that. This was reasoned through, not tested by forcing a crash.

## 3. Deployment

- Config parity: every variable `config.ts` reads is in `.env.example` (except `NODE_ENV`, set by the images) and documented; compose passes the Supabase URL/key, `APP_ORIGIN` and `GATEWAY_INTERNAL_URL` to web and everything else to the gateway through `env_file`. New: `CREDIT_USAGE_FILE`.
- Compose: memory limits for a 2 GB instance (caddy 256 MB, gateway 512 MB with a 384 MB heap, web 768 MB with a 512 MB heap). Health checks, restart policy, log rotation, non-root images, the 30 s stop grace period and gateway-before-Caddy ordering were already there.
- Caddy: open WebSockets survive a config reload for 5 minutes (`stream_close_delay`); 1 MB body limit on the web app; one `no-cache` for `sw.js` and the manifest. Caddy sets no idle timeout on upgraded WebSockets and the gateway pings every 15 s. Next already sends an immutable `Cache-Control` for `/_next/static`.
- CI: adds `pnpm check:bundle`, `pnpm audit --prod` (reported, not enforced), `docker compose config`, `caddy validate`, and builds of both images.
- `pnpm smoke --url ...`: `/healthz`, foreign origin, bad token, valid token, single-use token, `hello`/`ready`, oversize message. **Run locally:** the full production compose (images built here, arm64) against mock Gnani, behind Caddy on `https://localhost`: all 8 checks passed, `/metrics` 404, HTTP to HTTPS 308. The smoke stack used its own env file and an override that kept the repository's `.env` (and any real key) out of the containers, and ran without account auth (no Supabase project).

## 4. Real Gnani spike: prepared, not run

`pnpm spike --dry-run` (sends nothing): key present, experiments A to F, budget 150 s of audio and 1,500 TTS characters, estimated 1,236 TTS characters. **Clips: not ready** (no `clips.json`; the 10 clips in `scripts/spike/clips/README.md` must be recorded by a person). `docs/LATENCY.md` still has no real Gnani numbers. Experiment E deliberately sends one concurrent TTS request to probe the limit; that is existing spike design.

## 5. For the frontend session (no protocol change)

1. **B-12:** in `apps/web/src/lib/auth/server.ts`, forward the incoming `x-forwarded-for` header unchanged on the `fetch` to `${gatewayUrl}/session`. The gateway trusts only private-address proxies and reads the address Caddy appended, so a forged prefix cannot dodge the limit. Until this ships, consider setting `SESSION_RATE_PER_IP_PER_MIN` equal to `SESSION_RATE_GLOBAL_PER_MIN` so one busy visitor cannot lock out others.
2. Replace `isConfirmable` in `apps/web/src/lib/turn/reducer.ts` with the shared `isConfirmable` from `@bolbill/shared` (same rule, now the one the gateway uses).
3. Khata's "oldest unpaid" date (`oldestUnpaidSince`, used in `apps/web/src/lib/db/repo.ts`) now accounts for advances and reversed udhaar (B-08); a customer with a zero or negative balance no longer shows a date.

## 6. Not verified

A live Supabase project (the migration ran only on local Postgres with a stand-in `auth` schema); real Gnani latency and recognition (no clips, no spike run); the real EC2 instance, its x86 build, Let's Encrypt on a real domain, and mobile data; real iPhone and Android devices; any real LLM call (`llm:eval` was not re-run: nothing changed what the model sees).
