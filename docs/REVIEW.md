# Review findings

Severity: **blocker** (breaks the demo or leaks something), **major** (wrong behaviour or real risk), **minor**. Status: fixed / deferred / n-a. Driven by: P = ponytail, T = thermo-nuclear review, M = my own probing (parser probe, grep, reading).

| id | sev | where | what is wrong | how it fails | status | by |
|---|---|---|---|---|---|---|
| R-01 | blocker | `apps/web/src/lib/session/createSession.ts`, `realtime/client.ts` | The web app never sends `DEMO_ACCESS_CODE` and has no place to type it | with the code set (README section 17), every visitor is blocked ("access code required") with no way forward | open | M |
| R-02 | major | `packages/shared/src/parser/ruleBased.ts` | A known customer at the END of an order was not recognised ("Dhai kilo aata aur ek Maggi Sharma ji ke naam pe", spike clip 4) | name glued onto the last item, item unresolved, bill wrong | fixed | M |
| R-03 | minor | same | "hata do" parsed as an item called "2 hata" | nonsense unresolved item instead of cancel | fixed | M |
| R-04 | major | `reducer.ts isConfirmable`, `gateway draftBuilder.ts` | A bill with udhaar but no customer is confirmable; `applyBill` writes no ledger entry without a customer | the udhaar is silently lost; a spoken "haan" says saved | open | M |
| R-05 | major | `apps/gateway/src/server.ts` | `TRUST_PROXY=true` trusts the leftmost `X-Forwarded-For`, which a client can forge | per-IP rate limit bypass if the proxy ever forwards a client-supplied header | open | M |
| R-06 | minor | `deploy/Caddyfile` | Caddy's access log records the full URI including `?token=` of the WebSocket | single-use tokens in logs (expire in 120 s, but still hygiene) | open | M |
| R-07 | major | `docker-compose.prod.yml`, `.env.example` | `.env.example` sets `GNANI_TTS_CACHE_DIR=.tts-cache` (relative, in a root-owned `/app`), overriding the volume path; `DOMAIN` and `ACME_EMAIL` are missing from `.env.example` | phrase cache cannot be written in the container; compose refuses to start with a confusing error | open | M |
| R-08 | major | `apps/web/src/components/AppProvider.tsx` | Persistent storage is never requested | iOS Safari (in a browser tab) and Chrome under storage pressure may evict IndexedDB: ledger lost | open | M |
| R-09 | minor | `gateway server.ts` | The origin allowlist only constrains browsers; a script can send any `Origin` | not a security boundary; the rate limits, caps and optional access code are | n-a (documented) | M |
| R-10 | minor | `ruleBased.ts` | "Sharma ji ka bill cancel kar do" (customer-named cancel) parses as unknown | user must say "nahi"; the card stays | deferred | M |
