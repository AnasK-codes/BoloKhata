# Testing

What is automated, what is measured, and what only a person with a phone can check. Nothing in the automated suites calls the real Gnani API: tests use the mock Gnani servers (`tools/mock-gnani`), the gateway test configuration points at a closed local port, and a test (`apps/gateway/src/demoGuard.test.ts`) fails if a test file names the real host.

```bash
pnpm lint && pnpm typecheck && pnpm test      # everything automated, including the failure drills
pnpm loadtest                                 # 20 browsers x 50 turns on the mock servers (about 90 s)
pnpm loadtest --clients 20 --turns 120        # the soak (about 4 minutes)
pnpm --filter @bolbill/web build && pnpm check:bundle   # no secrets in the browser bundle
```

On Windows, if parallel Vitest workspaces collide in `node_modules/.vitest-cache` with `EPERM`, run `pnpm -r --workspace-concurrency=1 --if-present test`. This runs all the same suites sequentially; report the parallel-run failure separately.

### Bill workflow additions

Automated coverage: shared correction tests exercise Hinglish/Devanagari quantities, add/remove, units, payment preservation, negated/invalid/multi-item edits and cancel pass-through. Gateway mock tests exercise draft context, catalog repricing, unchanged draft ID, voice confirmation and clearing an obsolete context. Repository tests cover credit-detail enforcement, transactional reversals, duplicate/racing reversal rejection, preservation of later payments, cash bills and contact information excluded from gateway snapshots. Receipt and service-worker tests cover reversal labels and the offline `/bills` shell.

Manual/browser checks: at 360px, open Bills, search/select a saved synthetic bill, share/copy and Print / PDF; reverse it with a reason and check the derived customer balance. In Khata, reverse a standalone payment, and verify both original and reversal remain visible. For a credit draft, complete the synthetic customer's name/mobile/address, correct one item by voice, then confirm. Confirm that invalid or missing details block saving and that cash bills do not require contact details. Physical printers and native mobile share sheets still require device checks.

The integration fake speaker now mirrors `PlaybackEngine` by dropping PCM/end events for a turn invalidated by `flush()`. This corrects the former interruption-test double; the production audio path is unchanged.

## 1. Load and soak test (mock Gnani, real gateway process)

`scripts/loadtest.ts` starts the mock Gnani servers and the **real gateway as a separate process** (clean environment, so nothing from your shell or `.env` can reach it; it refuses to run if the Gnani URLs are not local). It then runs N simulated browsers, each doing M turns with real-time 32 ms frame cadence, random 30 to 60 frame utterances, interrupts during the spoken reply (about 10% of turns) and abrupt disconnects followed by a new session (about 4%). The gateway reports its own CPU, memory and event-loop delay through `/metrics` (operator token), sampled every 2 s.

Results below are from one run on a developer laptop (macOS, Apple silicon), with the mock servers and the 20 simulated browsers on the **same machine** as the gateway, so absolute CPU numbers include contention from the load generator. The mock STT answers 120 ms after the commit and the mock TTS speaks 20 ms per character; **these are not Gnani numbers and must not be quoted as such.** What they show is that the gateway adds almost nothing on top of the upstream, and that it does not leak.

**20 browsers x 120 turns (about 3.4 minutes, 2,400 turns):**

| Check | Result |
|---|---|
| Turns completed / attempted | 2,400 / 2,400 (248 interrupted during the reply, 87 abrupt reconnects, 0 failures) |
| Audio frames sent by clients / received by the mock STT | 106,949 / 106,949 (none lost) |
| Pacing violations flagged by the mock STT (wrong size or ahead of real time) | 0 |
| Sessions and upstream sockets still open afterwards | 0 / 0 |
| Gateway heap floor over the run (the lowest heap per 20 s window, after warm-up) | 25.1, 26.1, 25.3, 25.2, 24.4, 24.7, 26.7, 25.3 MB: slope 0.06 MB/min, so no leak |
| Gateway heap peak / resident memory peak | 38 MB / 136 MB (start 109 MB, end 122 MB) |
| Gateway CPU (one core, per 2 s window) | p50 7.8%, p95 13.6%, worst window 41% |
| Gateway event-loop delay (beyond the 10 ms timer resolution) | p99 about 1.2 ms per window, worst window p99 2.1 ms, worst single stall 7.1 ms |
| Release to `processing` seen by the client | p50 0.5 ms, p95 0.9 ms |
| Release to transcript (client side) | p50 121.0 ms, p95 122.0 ms (the mock STT's configured delay is 120 ms, so the gateway added about 1 ms) |
| Release to draft | p50 121.4 ms, p95 122.5 ms (transcript to draft on the gateway: about 0.3 ms, rules path) |
| Release to first TTS byte (client side) | p50 151.8 ms, p95 153.9 ms (the mock TTS's own start-up is about 30 ms) |

Gateway-side spans from its own `timing` message (milliseconds after `ptt_start`, so they include the speaking time and are not comparable across turns): `commit_sent` to `transcript` is about 120.7 ms at p50 and `transcript` to `draft` about 0.3 ms, matching the client's view.

An earlier 20 x 50 run (1,000 turns) also completed with 0 failures, 0 lost frames and 0 violations. Fixed along the way: the event-loop figure first read about 11 ms because the timer's own resolution was not subtracted (a reporting bug, not a stall), and the soak's first leak check fitted a line through a garbage-collection sawtooth and gave a false alarm (it now looks at the heap floor).

**Not covered:** these runs never exercise the real Gnani network path, TLS, mobile networks, or more than 20 concurrent sessions. No hot-path allocation or leak was found, so no gateway code was changed for performance.

### What it would catch
- A leak: heap floor rising across the run, sessions or upstream sockets left open afterwards.
- A hot-path allocation or blocking call: event-loop delay climbing with load.
- Pacing damage: the mock STT flags any frame that is not exactly 1,024 bytes or that arrives ahead of real time (`mockViolations`).
- Lost audio: frames the clients sent versus frames the mock STT received.

## 2. Failure drills

| Drill | Where it is proven | What must happen |
|---|---|---|
| Gnani STT closes mid-utterance | `gnani/sttLink.test.ts` "fails the turn in flight when the socket drops mid-utterance", "reconnects after Gnani drops the socket" | the turn fails with a coded error, the session stays open, the next turn works |
| Gnani STT returns an error | `sttLink.test.ts` "keeps working after a Gnani error mid-turn"; `session/turnEngine.test.ts` "a speech recognition error is reported and the next turn still works" | error with the turn id; next turn fine |
| STT too slow or silent | `sttLink.test.ts` "times out a very slow upstream and never lets its late answer leak into the next turn" | timeout, no stale transcript later |
| TTS stalls or fails | `gnani/ttsLink.test.ts` "times out a request that never produces audio", "turns a Gnani error into a text-only fallback"; `turnEngine.test.ts` "when speech synthesis fails the draft is still delivered, then TTS_UNAVAILABLE" | the bill still shows, the UI says "text mode" |
| LLM times out | `turnEngine.test.ts` "falls back to the rules result with a review flag and LLM_TIMEOUT" and the interrupt cases | rules result shown, never blocks past `LLM_TIMEOUT_MS` |
| Gateway restarts during a session | `apps/web/src/lib/turn/turn.integration.test.ts` "a gateway restart mid-session..." (real gateway, killed and started again on the same port) | gate closed, error shown, client reconnects by itself, next turn works |
| Client loses the network mid-turn | `turnEngine.test.ts` "a client that leaves mid-turn cancels the model call and frees the session"; `sttLink.test.ts` "discards a turn when the client disconnects mid-utterance"; web `controller.test.ts` "closes when the connection drops mid-turn" | upstream sockets closed, session slot freed, gate shut |
| 25-second utterance | `drills.e2e.test.ts` "25 seconds of speech at real-time pace..." (takes about 25 s) | transcribed, no pacing violations; over the limit: `UTTERANCE_TOO_LONG`, next turn works |
| Empty recording | `turnEngine.test.ts` "an empty transcript: NO_TRANSCRIPT..."; `sttLink.test.ts` "reports an empty transcript as NO_TRANSCRIPT" | friendly "Kuch sunai nahi diya", nothing saved |
| Double confirm taps | web `controller.test.ts` "two quick taps on Confirm save once and speak once"; `lib/voice/saveDraft.test.ts` (idempotent by draft id, tap plus "haan"); `drills.e2e.test.ts` "a second spoken haan..." | one bill, one ledger entry |
| Close 1008 (policy) | `drills.e2e.test.ts` "is closed with 1008 after too many bad messages..."; web `client.test.ts` "close codes and failed handshakes" | slot freed; client backs off then reconnects |
| Close 1001 (going away) | `session.test.ts` "graceful drain"; web `client.test.ts` (it.each 1001) | clients told, then reconnect |
| 429 on the session handshake | `demoGuard.test.ts` rate-limit tests; web `client.test.ts` "treats a rate limit the same way" | "demo busy / slow down" state, automatic retry after the hint |
| A refused WebSocket upgrade | web `client.test.ts` "a socket that closes before it ever opens..." | new token after backoff, no tight loop |

**Not automated, do by hand once on a phone** (the browser side of these cannot run in Node): switch to airplane mode in the middle of an utterance (expect the error banner, the gate closes, **Online** returns when the network does); lock the phone while holding the mic (expect the recording to be discarded); kill the gateway on the server during a turn (`docker compose ... restart gateway`) and watch the phone reconnect.

## 3. Demo-guard limits

Each limit has its own test. See `apps/gateway/src/demoGuard.test.ts` unless noted.

| Limit | Test |
|---|---|
| Per-IP session rate | "per IP: the third request in a minute is refused..." |
| Global session rate | "globally: once the whole demo hits its per-minute cap..." |
| Forged `X-Forwarded-For` ignored unless `TRUST_PROXY` | "ignores a forged X-Forwarded-For..." |
| `MAX_SESSIONS` (HTTP) | "a full demo answers POST /session with a friendly busy message and a retry time, then recovers" |
| `MAX_SESSIONS` (socket) | `session/session.test.ts` "sends a friendly limit message and closes when the demo is full" |
| `MAX_SESSION_MINUTES` | "MAX_SESSION_MINUTES ends a session with a session_expired limit message and the 4001 close" |
| Daily TTS characters | "a spent TTS-characters cap turns POST /session into a budget message..."; `gateway.e2e.test.ts` "sends a budget limit and calls no upstream once the TTS character cap is reached" |
| Daily STT seconds | "a DAILY_STT_SECONDS_CAP of 0 allows no speech at all"; `gateway.e2e.test.ts` "refuses new turns with a limit message when the STT budget is gone" and "records the audio really streamed against the credit guard" |
| Optional access code | `session/session.test.ts` "enforces the optional demo access code" |
| Origin allowlist | `session/session.test.ts` "refuses a missing or foreign origin", "refuses a browser origin that is not allowed" |
| Operator sees remaining budget; the public does not | "/metrics shows the remaining budget and process health to the operator only" |
| No test, dev or load-test run reaches the real API | "tests and dev never reach the real Gnani API"; `loadtest.ts` refuses non-local URLs |

## 4. Manual test matrix (real devices)

Use only synthetic names and amounts. For each cell write PASS/FAIL, the device, the date, and one line on what you saw. A "pass" means the bill was right (items, quantities, total), the voice read it back, and "haan" saved it.

| # | Condition | Phrase to say (Hinglish) | Devices | Result |
|---|---|---|---|---|
| 1 | Quiet room | "Sharma ji ko do kilo aata aur ek Maggi, teen sau ka udhaar likh do" | iPhone Safari, Android Chrome | |
| 2 | Fan noise (fan on high, 1 m away) | same | both | |
| 3 | Street noise (open window or outside, traffic) | same | both | |
| 4 | Fast speech | "Verma ji ko teen kilo cheeni, do litre tel, ek packet chai patti, paanch sau udhaar" | both | |
| 5 | Slow, deliberate speech | "Gupta ji ko... dedh kilo... chawal" | both | |
| 6 | Hindi-heavy | "शर्मा जी को ढाई किलो आटा लिखो" (or the same in Latin script) | both | |
| 7 | English-heavy | "Add two kilos of sugar and one Maggi for Sharma ji on credit" | both | |
| 8 | Strong regional accent (ask someone whose accent differs from yours) | any of the above | both | |
| 9 | One-word answers | "haan", "nahi" (a pending bill exists) | both | |
| 10 | Balance question | "Sharma ji ka kitna udhaar hai" | both | |
| 11 | Payment | "Verma ji ne do sau de diye" | both | |
| 12 | Installed PWA (home-screen icon) | the happy path | both | |
| 13 | Airplane mode in the middle of an utterance | start speaking, switch to airplane mode, release | both | |
| 14 | Airplane mode, then ledger and catalog | open Khata and Samaan | both | |
| 15 | iPhone Safari specifics | first-tap audio unlock, silent switch on, lock screen mid-hold, return to the app (mic re-acquire), hold gesture with no text selection or menu | iPhone | |
| 16 | Android Chrome on a low-end phone | 60 fps of the level ring and the bill animation (Chrome's FPS meter), no gaps in the voice | Android | |
| 17 | Low battery / battery saver mode | the happy path; watch for throttled timers or audio gaps | both | |
| 18 | Mobile data, not Wi-Fi | the happy path against the deployed HTTPS link | both | |
| 19 | Barge-in | press the mic while the voice is speaking | both | |
| 20 | Demo busy | open the link from a second device while `MAX_SESSIONS` is reached | any | |

**Audio processing options** (Settings, "Mic processing"): in rows 2 and 3, repeat with *noise suppression* and *auto gain* on and off, same phrase, three tries each, and record how many were fully correct. Defaults today are echo cancellation **on**, noise suppression **off**, auto gain **off**: those are a guess, not a measured choice (section 5).

## 5. Audio quality experiment (noise suppression and auto gain): status

**Not run.** The brief asks for a small real-API experiment on the spike's noisy clips. Two things stand in the way: the spike clips have not been recorded yet (`scripts/spike/clips/` holds only the guide; the `.wav` files are yours to record, and the spike has never been run, so `docs/LATENCY.md` has no real numbers), and noise suppression and auto gain are **browser** processing that happens before our code sees the audio, so they cannot be switched on and off from a Node script: a fair comparison needs the same phrases recorded through the real browser with each setting, then sent through the real STT.

How to run it when you are ready (about 2 minutes of audio, a few credits):
1. Record the clips in `scripts/spike/clips/README.md` once.
2. In the deployed app on your phone, for each of the four settings combinations (suppression on/off x gain on/off), say clips 9 and 10 (noisy order and balance) five times each, with the HUD open. Count turns whose bill was fully correct, and write the transcript word errors you see.
3. Put the table in `docs/LATENCY.md` under a heading "Mic processing" with the device, the noise, and the counts, and set the defaults in `apps/web/src/lib/audio/micCapture.ts` (`DEFAULT_MIC_SETTINGS`) to the winner.

Until then, do not claim that noise suppression helps or hurts.
