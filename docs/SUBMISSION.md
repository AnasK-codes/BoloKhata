# Submission: Bol-Bill

Every statement below is true of this repository today, or is a marked placeholder you must fill from a real measurement before submitting. **Search this file for `[FILL` before you submit: nothing may remain.** The storyboard is in `STORYBOARD.md` and the post drafts in `POSTS.md`.

## Title and one-line pitch

**Bol-Bill** — a kirana shopkeeper holds a button, says the order in Hinglish, and the bill appears while the app reads it back.

## The problem and the users

Small shops in India (kirana stores) bill customers and track *udhaar* (credit) by hand or with typing-heavy apps, while their hands are busy at the counter. They speak Hinglish, not clean English or clean Hindi, and they say quantities the way people do ("dedh kilo", "dhai kilo", "teen sau ka udhaar"). A form-based billing app is slow at exactly the moment the customer is waiting. Bol-Bill makes speaking the interface, and keeps the credit ledger honest (balances are always computed from entries, never typed in).

## What we built (about 200 words)

Bol-Bill is a mobile-first, installable web app (PWA) with a separate realtime Node.js gateway. The shopkeeper holds the mic (or taps to latch) and speaks. The phone streams 16 kHz audio over one WebSocket to our gateway, which paces it into Gnani Prisma's realtime speech-to-text and sends a commit the instant the button is released. The transcript goes to a rule-based Hinglish parser; an optional language model is tried only when the rules are not confident, under a hard timeout, and never prices anything. Items are matched to the shop's catalog and priced by deterministic shared code. The bill draft is shown on screen immediately and, at the same time, Gnani Timbre streams a spoken readback that plays through a gapless audio worklet. The shopkeeper confirms with a tap or by saying "haan"; the bill and the udhaar entry are saved in an on-device database (IndexedDB), so the ledger works offline. They can ask "Sharma ji ka kitna udhaar hai?" and hear the answer, interrupt the voice by pressing the mic again, correct items on the card, and watch a latency HUD that shows the measured time of each stage of the turn. A demo guard (rate limits, session and daily caps, optional access code) protects our limited Gnani credits.

## Gnani models used, and exactly where

| Model | Where | How |
|---|---|---|
| **Prisma** (realtime STT, `wss://api.vachana.ai/stt/v3/stream`) | `apps/gateway/src/gnani/sttLink.ts`, `pacer.ts` | Only the gateway connects (browsers cannot send the required headers, and the key must stay server-side). Frames of exactly 1,024 bytes at real-time cadence; `{"type":"commit"}` on release instead of waiting for silence; catalog and customer names sent as `keyterms` and a shopkeeping `topic` (Prisma v3.0); VAD settings kept low so one-word answers ("haan", "nahi") are not dropped; session rotated before the 15-minute cap. |
| **Timbre** (realtime TTS, `wss://api.vachana.ai/api/v1/tts`) | `apps/gateway/src/gnani/ttsLink.ts`, `phraseCache.ts`, `packages/shared/src/voice` | One synthesis request at a time (queued, never parallel); raw PCM streamed to the browser as binary as it arrives; amounts converted to spoken Hindi number words before synthesis (Gnani's formatting guidance); short replies of at most two sentences; fixed phrases cached. |

**Status of the real-API checks:** the integration against both services is covered by tests against our own mock servers that enforce Gnani's documented frame and cadence rules. The latency spike against the real API (`pnpm spike`) **has not been run yet**, so `docs/LATENCY.md` contains no real numbers. [FILL after running the spike: date, where it ran, and the one-line result.]

## Technical highlights

- **Separate realtime gateway** (Fastify + `ws`), not serverless functions: long-lived sockets, pre-warmed upstream connections, pacing timers.
- **Paced 1,024-byte frames** from a pre-allocated ring buffer, so network jitter does not reach Gnani as bursts.
- **Commit on release:** the end of the utterance is known at the moment the button is released.
- **Rules-first parsing with a timeboxed LLM:** a deterministic Hinglish parser (number words, "aadha", "dedh", "dhai", fuzzy catalog matching) answers the common sentences in milliseconds; the model is optional and cannot decide a price, total or balance. The whole app works with `LLM_PROVIDER=none` (the default).
- **Speak while drawing:** the draft is sent to the screen and to TTS together; rows animate in while the voice reads.
- **Barge-in:** pressing the mic stops the voice at once (the playback worklet is flushed and the gateway aborts the synthesis); turn IDs on every message make late audio from an interrupted turn impossible to play.
- **Gapless playback worklet:** ring buffer with a short prefill, underrun counter, resampling to the device rate.
- **Local-first ledger:** IndexedDB (Dexie); balances derived from entries; saving a bill and its ledger entry is one transaction, idempotent by draft ID so a tap and a spoken "haan" cannot double-save.
- **Demo guard:** per-IP and global rate limits, maximum sessions, session length cap, daily STT-seconds and TTS-characters caps, optional access code; operators read the remaining budget from a token-protected `/metrics`.
- **Honest measurement:** the HUD records spans with `performance.now()` and merges the gateway's own timings; it exports JSON; it never shows an estimate.
- **Verified resilience** (see `docs/TESTING.md`): a 20-browser load test and soak against the real gateway process on mock Gnani servers, and automated failure drills.

## Disclosure of components that are not Gnani

- **Language model (optional):** Amazon Bedrock or any OpenAI-compatible endpoint, behind a swappable adapter (`apps/gateway/src/parse/llm`). It is only called when the rule parser is not confident, receives the transcript (and catalog names) to extract intent, and is time-limited to `LLM_TIMEOUT_MS` (default 1,200 ms). **The submitted demo runs with:** [FILL: `none` (rules only) or the provider and model name]. **The rules parser works without it**, and this is tested (`pnpm test` runs with no model).
- Speech-to-text and text-to-speech are Gnani only; there is no other speech model.
- Other software: Next.js, React, Zustand, Dexie, Fastify, `ws`, Zod, Caddy (TLS proxy), Docker. AI coding assistance (Claude Code) was used to write much of the code, and the two of us reviewed and can explain it.
- Hosting: [FILL: one AWS EC2 instance in the region you used, or the platform you actually used].

## Team and contributions

Pre-filled only from the git history of this repository (`git shortlog -sne`: 27 commits at the time of writing, 15 by `umang`, 12 by `AnasK-codes`). The human descriptions are yours to write; the "from the history" column is checkable.

| Member | From the git history (checkable) | In your own words |
|---|---|---|
| umang (`umangjain2805`) | Monorepo scaffold; shared protocol schemas and binary framing; Hinglish number words and spoken Hindi numbers; catalog matching and keyterms; pricing and ledger; rule-based parser and utterance test set; mock Gnani servers; the latency spike; the gateway: server, sessions, auth and guards, pacer and STT link, TTS link and phrase cache, LLM adapters, parse orchestrator, turn engine | [FILL] |
| AnasK-codes | Browser audio layer (capture and playback worklets, DSP); realtime client; turn state machine; hold-or-latch gesture; voice screen, ledger, catalog and settings UI; local database and context sync; PWA | [FILL] |
| Both | [FILL: deployment, demo recording, testing on phones, anything that is not in commits] | [FILL] |

Note: `README.md` section 23 still names a different team member ("Jayesh Malviya") from the commit authors above. Make the README, this table and your registration agree before submitting.

## Honest limitations

- **No real-API measurements yet.** Until `pnpm spike` runs and `docs/LATENCY.md` is filled, we cannot state any latency, accuracy or cost figure for Gnani. All timings in the repository so far come from mock servers.
- **Not yet tested on real phones.** The browser audio paths were tested in desktop browsers and unit tests; iPhone Safari and low-end Android checks are listed in `docs/TESTING.md` for you to run.
- **Speech accuracy is unmeasured.** The rule parser's golden test set (`tests/utterances.json`) tests text, not audio; recognition quality in noise is not yet measured (`docs/TESTING.md` section 5).
- **Single device, no accounts.** Data lives in the phone's IndexedDB; there is no sync, backup, login or multi-shop support.
- **Fixed catalog vocabulary.** Unknown items are shown for correction rather than guessed; a new product must be added in Samaan.
- **Demo data is synthetic** and the demo build is capped (a few concurrent sessions, daily credit limits).
- **No LLM re-parse button.** Correcting a transcript re-runs the local rules only.
- **Not built:** a Noise Lab, share-bill, replay mode, regional-language toggle (listed as stretch in the README).

## Compliance checklist (Great Indian AI Internship Challenge)

- [ ] Synthetic data only: no real names, phone numbers, Aadhaar, PAN or account numbers appear in the repo, the demo or the video (seed data is fictional: `data/seed-catalog.json`).
- [ ] The demo is genuine: every transcript, bill, timing and voice in the video came from the running app; no hard-coded results, no unlabelled replay, no unlabelled synthetic noise. (The dev-only `?tone=1` test tone is never used in the video.)
- [ ] If a replay or a noise test is ever shown, it is labelled on screen ("Replay of a recorded session", "Synthetic noise on").
- [ ] No bought engagement, bots, paid promotion or engagement swaps.
- [ ] The post tags Gnani AI and has `#GreatIndianAIInternshipChallenge` and `#GnaniAI`, and is live before the submission.
- [ ] The explanation names Prisma and Timbre and each member's contribution.
- [ ] Both members registered and eligible (students in India, 18+).
- [ ] Deadline: **November 10, 2026, 11:59 PM IST.** Target submission **November 9**; post the video by **November 7**.
- [ ] The live app (or the repository) link works from a phone on mobile data.
