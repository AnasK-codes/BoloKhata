# Hardening report (branch `chore/hardening-pass`)

Unattended pass, 2026-11-04. Mock servers only: nothing called the real Gnani API, an LLM, or AWS. No push, no force-push.

## 1. What changed

**Phase 1, review** (`docs/REVIEW.md`): 15 findings. **Blocker 1** (fixed), **major 6** (6 fixed), **minor 8** (4 fixed, 2 deferred, 2 reviewed and not defects).
**Phase 2, fixes** (each with a test that failed before and passes after, except UI):
- R-01 demo access code: the app never sent it and had nowhere to type it. Now asks once, remembers it, and can retry from `blocked`.
- R-02/R-03 parser: a known customer at the end of an order ("... Maggi Sharma ji ke naam pe", spike clip 4) is recognised; "hata do" cancels instead of becoming an item called "2 hata".
- R-04 udhaar with no customer could be saved with no ledger entry (debt lost). Neither the gateway nor the browser now offers to save it; the voice asks whose udhaar it is.
- R-05 client IP: `TRUST_PROXY=true` trusted a forgeable header; now only a private-address proxy is trusted.
- R-06 Caddy access log redacts the WebSocket token (residual noted).
- R-07 compose: cache directory override, and `DOMAIN` / `ACME_EMAIL` added to `.env.example`.
- R-08 requests persistent storage so the browser does not evict the ledger.
**Phase 3, efficiency:** seed catalog and dev test tone load lazily (measured -2.2 KB gzip on `/`). No hot-path change: nothing measured justified one.
**Phase 4, UI** (impeccable, apple-design): light and dark themes from tokens; drawn SVG icons instead of emoji; hero mic with distinct idle, listening, processing (spinner), speaking and interrupt states; mic and Confirm/Cancel on one row with a running Total so the bill is never covered; themed focus rings, selection and placeholders. 32 screenshots in `docs/screens/` (360x800 dark, 390x844 light), captured by `scripts/screenshots.mjs`.
**Phase 5, deployment:** both images built and run, the whole compose stack run locally behind Caddy (see section 2), `docs/PRE_DEPLOY_CHECKLIST.md` written, DEPLOY.md consistent with the changes.

## 2. Commands run and results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `pnpm lint` | clean (baseline and final) |
| `pnpm typecheck` | clean |
| `pnpm test` (final) | shared 656, mock-gnani 54, scripts 22, gateway 243, web 325 (incl. 5 integration tests on the real gateway): all pass. Baseline was 646 / 54 / 22 / 239 / 322 |
| `pnpm build` | ok |
| `pnpm check:bundle` | OK: no secrets or server-only imports in the browser bundle |
| `pnpm loadtest` (20 x 50, mock servers) | 1,000/1,000 turns, 0 lost frames, 0 pacing violations, no leak, all sessions closed (exit 0) |
| `node scripts/screenshots.mjs` x2 | 16 states each, saved |
| Docker: build gateway and web images; `docker compose up` from a temp dir with fake values; `caddy validate` | images 281 MB and 290 MB; gateway and web healthy; `https://localhost/healthz` 200, `/` 200, `/ledger` 200, `/metrics` 404 publicly, HTTP redirects to HTTPS (308); a full WSS turn through Caddy returned `ready`, `transcript`, `draft`, `tts_start`, 33 binary TTS frames, `tts_end`; operator `/metrics` showed budget and runtime; web container has no secrets in its environment or files; SIGTERM drain exits 0 (previous session) |
| One integration test flaked once under parallel load, then passed 8 isolated runs | logged as R-11 |

Failures and dead ends, honestly: a numeric `trustProxy` hop count returned the socket address for everyone (replaced, D-5); the first screenshots showed a layout bug and invisible Cancel text in light mode (both fixed, R-13, R-14); the first compose attempt failed because Colima could not mount a file from `/private/tmp` (re-run from the home folder).

## 3. What I did NOT verify
- Anything with real Gnani credits: the spike has still never run, so STT/TTS accuracy and latency on the real API are unknown (`docs/LATENCY.md` real table is empty).
- A real phone: iPhone Safari and Android Chrome (audio unlock, mic re-acquire, haptics, 60 fps on a low-end phone, install, offline, mobile data). The screenshots are desktop Chrome with phone-sized viewports and a synthetic test tone.
- The service worker and PWA install (the embedded browser cannot register one; covered by sandboxed unit tests only); Lighthouse was not run.
- The real AWS console, Free Plan eligibility, EBS/Elastic IP pricing, Let's Encrypt on your domain, sslip.io.
- Bedrock (never called). The x86 image build (built on arm64 here).
- "Demo busy" and "microphone permission denied" screens were not captured (see D-11).
- The audio-quality experiment (noise suppression/auto gain): not run (`docs/TESTING.md` section 5).

## 4. Measured numbers (mock-server measurements, NOT the real API)
See the table at the end of `docs/LATENCY.md`. Final 20x50 run: release to transcript p50 121.0 ms / p95 122.2 ms against the mock's configured 120 ms; release to first TTS byte p50 152.3 ms; gateway event-loop delay p99 about 2 ms; heap floor slope -1.14 MB/min; `/` JS+CSS 283,092 B gzip (was 285,305 B).

## 5. Skills used
- `ponytail`: smallest complete change for each fix, a test per new branch, and stating what was skipped (e.g. no splitting of the realtime stack, no speculative optimisation).
- `thermo-nuclear-code-quality-review`: the severity-ranked table in REVIEW.md and the review standards (no ad-hoc conditionals, boundary cleanliness).
- `impeccable`: its `craft-floor.md` drove the UI (no emoji as icons, no eyebrow labels, declared elevation, themed browser surfaces, states and contrast checks). Its launcher was not run (D-4).
- `apple-design`: the lenses (accessibility, platform conventions, craft, interaction, writing) and its principle of following the system appearance; I did not open its HIG reference pages, so no page is cited.
- Not used: `pstack` (only an installer, `setup-pstack`, exists; D-2).

## 6. Decisions to double-check, most important first (`docs/DECISIONS.md`)
1. D-6 udhaar without a customer is no longer savable (behaviour change visible in the demo: say the customer's name with an udhaar).
2. D-5 proxy trust via named private ranges.
3. D-7 access-code form and retry-from-blocked.
4. D-8 parser additions and the deferred "named cancel".
5. D-4 impeccable's launcher was not run; D-11 screenshots from desktop Chrome in dev mode with the labelled tone.
6. D-9 no in-app theme toggle; D-10 no further bundle splitting; D-12 residual token in Caddy error logs.

## 7. Top three remaining risks and one next step
1. **No real-API run yet.** Recognition quality in noise, the real latency, and Gnani's concurrency limits are all unmeasured, and the demo claims depend on them.
2. **No real-phone test.** iOS Safari audio (first-tap unlock, background/return) and low-end Android frame rate are the most likely surprises.
3. **Deadline and capacity.** Free Plan credits, the daily caps and `MAX_SESSIONS=3` limit a public link; a busy demo must look friendly (it does) but cannot serve a crowd.

Next step: follow `docs/PRE_DEPLOY_CHECKLIST.md` sections 4 and 5 first: record the clips, run `pnpm spike --dry-run` then the real spike once, and run `docs/SMOKE_TEST.md` on your phone against a deployed or tunnelled build.
