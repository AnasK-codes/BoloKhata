# Review findings

Severity: **blocker** (breaks the demo or leaks something), **major** (wrong behaviour or real risk), **minor**. Status: fixed / deferred / n-a. Driven by: P = ponytail, T = thermo-nuclear review, M = my own probing (parser probe, grep, reading).

| id | sev | where | what is wrong | how it fails | status | by |
|---|---|---|---|---|---|---|
| R-01 | blocker | `apps/web/src/lib/session/createSession.ts`, `realtime/client.ts` | The web app never sends `DEMO_ACCESS_CODE` and has no place to type it | with the code set (README section 17), every visitor is blocked ("access code required") with no way forward | fixed | M |
| R-02 | major | `packages/shared/src/parser/ruleBased.ts` | A known customer at the END of an order was not recognised ("Dhai kilo aata aur ek Maggi Sharma ji ke naam pe", spike clip 4) | name glued onto the last item, item unresolved, bill wrong | fixed | M |
| R-03 | minor | same | "hata do" parsed as an item called "2 hata" | nonsense unresolved item instead of cancel | fixed | M |
| R-04 | major | `reducer.ts isConfirmable`, `gateway draftBuilder.ts` | A bill with udhaar but no customer is confirmable; `applyBill` writes no ledger entry without a customer | the udhaar is silently lost; a spoken "haan" says saved | fixed | M |
| R-05 | major | `apps/gateway/src/server.ts` | `TRUST_PROXY=true` trusts the leftmost `X-Forwarded-For`, which a client can forge | per-IP rate limit bypass if the proxy ever forwards a client-supplied header | fixed | M |
| R-06 | minor | `deploy/Caddyfile` | Caddy's access log records the full URI including `?token=` of the WebSocket | single-use tokens in logs (expire in 120 s, but still hygiene) | fixed (access log); residual: reverse-proxy error logs during a gateway outage can still contain an expired single-use token | M |
| R-07 | major | `docker-compose.prod.yml`, `.env.example` | `.env.example` sets `GNANI_TTS_CACHE_DIR=.tts-cache` (relative, in a root-owned `/app`), overriding the volume path; `DOMAIN` and `ACME_EMAIL` are missing from `.env.example` | phrase cache cannot be written in the container; compose refuses to start with a confusing error | fixed | M |
| R-08 | major | `apps/web/src/components/AppProvider.tsx` | Persistent storage is never requested | iOS Safari (in a browser tab) and Chrome under storage pressure may evict IndexedDB: ledger lost | fixed | M |
| R-09 | minor | `gateway server.ts` | The origin allowlist only constrains browsers; a script can send any `Origin` | not a security boundary; the rate limits, caps and optional access code are | n-a (documented) | M |
| R-10 | minor | `ruleBased.ts` | "Sharma ji ka bill cancel kar do" (customer-named cancel) parses as unknown | user must say "nahi"; the card stays | deferred | M |
| R-11 | minor | `apps/web/src/lib/turn/turn.integration.test.ts` | One integration test ("interrupts the spoken reply") failed once when all test projects ran in parallel, and passed in 8 isolated runs | timing-sensitive under CPU contention (real gateway, real timers) | deferred (not reproduced; if it recurs, widen its `until` timeouts) | M |
| R-12 | minor | `apps/web/src/components`, `app/` | Icons were emoji and glyphs (🎤 👤 🔊 ⚠ ✓ ⚡); colours were dark-only and hard-coded | inconsistent rendering across phones; no light mode for bright shops | fixed (drawn SVG icons, tokens for light and dark) | impeccable, apple-design |
| R-13 | major | `VoiceScreen.tsx` | The sticky confirm/mic bar covered the bill's rows and total on a 360x800 screen | the key number was hidden during the demo | fixed (mic and Confirm/Cancel on one row, running Total in the bar) | impeccable |
| R-14 | minor | `components/*` | A theme token named `base` collided with Tailwind's `text-base` font-size utility, turning some text the page-background colour | invisible text on the Cancel button in light mode | fixed (token renamed `canvas`) | found by screenshots |
| R-15 | minor | `packages/shared`, `apps/gateway` | No known gaps found in: pacer drift, frame size/byte order, commit/drain race, interrupt/turnId handling, TTS queue ordering, backpressure, timer/listener cleanup, rotation, heartbeat, graceful shutdown | existing tests cover each (see docs/TESTING.md) and the 20x120 soak showed no leak | n-a (reviewed, no defect) | thermo, P |

## Summary

Counts by severity (R-01 to R-15): blocker 1 (fixed), major 6 (6 fixed), minor 8 (5 fixed, 2 deferred, 1 documented/not-a-defect... see table). Fixed means a test fails before and passes after, except UI findings (R-12 to R-14), which were verified in screenshots (`docs/screens/`).

How the review was done: `thermo-nuclear-code-quality-review` (severity-ranked table, no ad-hoc conditionals, boundary cleanliness) and `ponytail` (smallest change that fully fixes it, a test for each new branch) for code; probes of the rule parser with 30 Hinglish sentences (found R-02, R-03); reading the realtime paths against their existing tests; grep for `any`, `ts-ignore`, `console.*`, secrets and unused dependencies (clean); `impeccable` and `apple-design` references for the UI.
