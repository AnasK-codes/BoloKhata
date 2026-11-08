# Bol-Bill — Realtime Hinglish Voice Billing for Kirana Stores

> Hold the mic, speak your order, hear the bill read back in under two seconds. No typing.

Bol-Bill is a mobile-first Progressive Web App (PWA) that lets a kirana (neighbourhood grocery) shopkeeper create bills and manage customer credit (**udhaar**) by talking in Hinglish:

> *"Sharma ji ko do kilo aata, ek Maggi, aur teen sau ka udhaar likh do."*

The app streams the shopkeeper's voice to a low-latency Node.js gateway, which streams it to Gnani AI's speech-to-text, understands the order, calculates prices from explicit spoken quotes or the shop's catalog, and **streams the spoken answer back while the bill is still animating onto the screen**.

Built for the **Great Indian AI Internship Challenge** by [Gnani AI](https://www.gnani.ai/internship) on Gnani's Prisma (speech-to-text) and Timbre (text-to-speech) models.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [The solution](#2-the-solution)
3. [Features](#3-features)
4. [Life of a turn](#4-life-of-a-turn)
5. [Architecture](#5-architecture)
6. [Realtime protocol (browser ↔ gateway)](#6-realtime-protocol-browser--gateway)
7. [Gnani AI integration](#7-gnani-ai-integration)
8. [Latency design and budget](#8-latency-design-and-budget)
9. [Voice understanding](#9-voice-understanding)
10. [Data model and sync](#10-data-model-and-sync)
11. [Tech stack](#11-tech-stack)
12. [Repository structure](#12-repository-structure)
13. [Getting started](#13-getting-started)
14. [Environment variables](#14-environment-variables)
15. [Testing and measurement](#15-testing-and-measurement)
16. [Deployment on AWS](#16-deployment-on-aws)
17. [Demo guard and cost control](#17-demo-guard-and-cost-control)
18. [Privacy](#18-privacy)
19. [Challenge context and compliance](#19-challenge-context-and-compliance)
20. [Seven-day plan](#20-seven-day-plan)
21. [Demo script and what makes it impressive](#21-demo-script-and-what-makes-it-impressive)
22. [Limitations and roadmap](#22-limitations-and-roadmap)
23. [Team](#23-team)
24. [Working with AI coding agents](#24-working-with-ai-coding-agents)

---

## 1. The problem

India has millions of kirana stores. Most shopkeepers:

- Work with both hands busy, so typing is slow and awkward.
- Speak Hinglish or a regional language, while most billing apps expect typed English.
- Track **udhaar** (credit) in paper notebooks or memory, which causes disputes and lost money.
- Work in noisy places: traffic, fans, customers talking.

Existing ledger apps are built around forms. Voice is an afterthought, and generic speech systems stumble on code-mixed Indian speech, Indian names and lakh/crore number styles.

## 2. The solution

Bol-Bill makes **realtime voice the primary interface**:

1. Hold the big mic button and speak one order in natural Hinglish.
2. Audio streams live over a single WebSocket to our Node.js gateway, then on to Gnani's streaming speech-to-text.
3. The moment you release, the gateway commits the utterance (no waiting for silence), gets the transcript, and parses it, **rules first, language model only when needed**.
4. An explicitly spoken item price is used for that bill; otherwise a known item's catalog rate is used. Shared code calculates every total. The language model never chooses a price.
5. The bill appears on screen and the assistant starts reading it back while audio is still streaming in.
6. You confirm by tapping or saying "haan"; the udhaar ledger updates instantly.
7. Ask "Sharma ji ka kitna udhaar hai?" and hear the answer.

A built-in **latency HUD** shows the real measured timings of each turn, which makes the speed visible in the demo.

## 3. Features

**Accounts and business setup:** real Supabase email/password signup/login, email confirmation, refresh and logout; a business profile is required before billing. Settings edits business details and one simple receipt template. New receipts snapshot those details. See [docs/AUTH.md](docs/AUTH.md) for SQL and environment setup. Account/profile data is cloud-backed; bills and khata stay local and separate per account. Connect the Supabase project before login can work; no fake/local-login fallback is provided.

### MVP (must ship by Nov 9)

- [ ] Hold-to-talk and tap-to-toggle recording, streamed live as 16 kHz mono PCM
- [ ] Single duplex WebSocket to a separate Node.js gateway
- [ ] Streaming Hinglish speech-to-text (Gnani Prisma) with catalog-based keyterm boosting
- [ ] Immediate utterance commit on release
- [ ] Rules-first intent parser with a language-model fallback: **create bill**, **record payment**, **check balance**, **confirm**, **cancel**
- [ ] Catalog with Hinglish aliases and fuzzy matching, Hinglish number words
- [ ] Bill draft appears within about a second of release
- [ ] Streaming text-to-speech (Gnani Timbre) with gapless playback and instant interruption (barge-in)
- [ ] Voice confirm ("haan" / "nahi") as well as a tap button
- [ ] Udhaar ledger per customer, derived balances, history
- [ ] Live latency HUD
- [ ] Installable PWA with an offline app shell
- [ ] Demo guard: rate limits, daily credit caps, friendly "demo busy" state

### Stretch (pick by impact on the demo)

- [ ] **Noise Lab:** clearly labelled synthetic noise injected into the mic stream to demonstrate robustness
- [x] Share saved bills as text through the system share sheet, with copy fallback
- [ ] Hands-free confirm window after the readback
- [ ] Recorded-session replay (labelled as a replay) for when the live demo budget is used up
- [ ] Regional language toggle

### Implemented bill workflow additions

- **Speak item prices without setting up a catalog:** "Do kilo chawal ₹110 ke, do Maggi ke packets ₹28 ke" creates two lines, ₹110 and ₹28, for a ₹138 total even with an empty catalog. "Do kilo chawal ₹55 per kilo" uses a unit rate and totals ₹110. Hindi/Devanagari number words, rupee symbols/words, and "110 ke" forms are supported. A price without "per/each/prati" or an adjacent rate unit is the total for that line. Explicit prices override catalog rates for this bill only; no product or saved catalog rate is automatically added/changed. Unknown items with no price, invalid whole-rupee amounts and incompatible units still require review. Quantity edits preserve the quoted price basis, using the same half-up whole-rupee rounding rule. Bills still need confirmation.
- **Protocol v2:** `BillItem.spokenPrice?` records the original amount, basis, quantity and unit. `unitPrice` may be null when a whole-rupee unit rate cannot be derived exactly (3 packets for ₹50 remains exactly ₹50). Web/gateway must be updated together; reload existing browser tabs. Legacy saved bills with numeric rates remain valid. The service-worker shell is version v4.

- **Voice draft corrections:** while a bill is unsaved, say "Aata teen kilo karo", "Aata do nahi teen kilo karo", "Maggi hata do", or "Ek Maggi aur jodo". One product per correction; ambiguous products, invalid quantities and incompatible units leave the bill unchanged and ask for review. Catalog lines use catalog rates and spoken-price lines retain their quoted price basis, with the same draft ID and a new turn ID. Fully paid drafts remain fully paid; credit drafts retain their paid amount, capped at the new total. Corrected bills still require confirmation.
- **Saved bills:** the Bills tab (`/bills`) lists cash and credit bills, searches customer/date/ID, and opens the saved receipt. Share uses the system share sheet; unsupported or failed sharing falls back to copy/selectable text. Mobile and address are omitted from receipts.
- **Thermal receipt (58 mm):** a saved bill is shown and printed as a 32-column monospace receipt (`apps/web/src/lib/thermalReceipt.ts`; amounts print as "Rs" because thermal fonts often lack the rupee sign). **Print (58 mm)** opens the browser print dialog, so a printer already paired with the OS works; choose paper size 58 mm there. Share / Copy still sends a plain-text version. Direct Bluetooth/USB (ESC/POS) printing is not included, and the print CSS has not been checked on a real printer yet.
- **Reversals:** Bills → open bill → reverse with a reason. Khata → customer → reverse an incorrect standalone payment/opening entry with a reason. Original records remain; one linked opposite ledger entry restores the balance. Duplicate reversals and reversing a reversal are rejected. Bill-linked entries must be reversed through the whole bill. Reversing a bill preserves later payments, which can leave a customer advance; cash refunds are manual.
- **Mandatory credit details:** before saving any new udhaar bill, the customer must have a name, a ten-digit Indian mobile number and an address (5–300 characters). Fill these on the draft or in Khata → customer → Badlo. Contact details stay in IndexedDB; only a `creditReady` boolean is sent with the existing customer snapshot. Existing customers/balances are preserved and missing details must be completed before new credit is saved. Development, fixtures and demos use synthetic details only.

- **Discount, GST and round-off by voice:** "do kilo aata paanch rupaye kam", "10 percent discount", "5 percent GST", "round off", or set them on the bill card. Order: subtotal, minus discount, plus GST on the discounted amount, then round-off to the nearest ₹5 (`packages/shared/src/domain/adjustments.ts`, the only place that does this arithmetic). "GST ke saath" with no rate is not guessed: the draft warns and asks for a rate. Rules-only: a model never supplies these. `bill.total` is the payable amount; `bill.adjust` holds the inputs.
- **Shop questions:** "aaj kitni bikri hui?" and "kul udhaar kitna baaki hai?" (no customer named) are answered from numbers the device sends in `hello`/`context_update` (`catalog.shop`: today's sales, today's bill count, total udhaar). Reversed bills are excluded.
- **Stock (optional per product):** set a count in Samaan; saving a bill reduces it, reversing the bill puts it back, and "aata khatam ho gaya" (then "haan") sets it to 0. Low/out badges show in Samaan. Stock stays on the device and is not sent to the gateway.
- **Learning the shop's words:** picking a product or customer for an unrecognised spoken word saves that word as an alias (never one that already names something else).
- **Interface language:** Hinglish, हिन्दी (beta, pending native review) and English. Pick from the globe button on the home screen or Settings → App language; it switches instantly, offline, and is saved on the device (`localStorage`). The first launch picks from the browser language (Hindi browser → हिन्दी, other Indian locales → Hinglish, English elsewhere). This changes only on-screen text: what you speak (STT) and the spoken reply (TTS) are separate and unchanged, and item names, customer names and amounts are never translated. Typed dictionaries live in `apps/web/src/lib/i18n/locales`; see [docs/I18N.md](docs/I18N.md) to add a language.
- **Backup / export:** Settings → JSON backup, Bills CSV, Khata CSV. There is no restore button yet. Customer statement: Khata → customer → **Statement print / PDF** (A4, via the print dialog).

These additions use existing dependencies. Optional data fields do not require resetting the local database; the service-worker shell now includes `/bills`.

## 4. Life of a turn

```
 t=0        user presses mic ──► capture worklet starts sending 32 ms PCM frames
            gateway pre-warmed Gnani STT link receives paced frames
 ...        (user speaks; frames flow in real time)
 t=release  ptt_end ──► gateway sends {"type":"commit"} to Gnani immediately
 +~300-400  Gnani returns final transcript for the segment
 +~5 ms     rule-based parser + catalog match + pricing  ──► `draft` event to the browser
            (if rules are not confident: language model, hard-timeboxed to ~1.2 s)
 +~0 ms     gateway composes the spoken readback and starts streaming TTS
 +first     first PCM chunk reaches the browser ──► playback worklet plays it
            bill card is already on screen, animating in
 later      user taps Confirm or says "haan" ──► ledger saved in IndexedDB,
            short "bill save ho gaya" spoken confirmation
```

The numbers in this document are **targets to measure**, not claims. See [section 8](#8-latency-design-and-budget).

## 5. Architecture

```
┌──────────────────── Phone (PWA, Next.js) ─────────────────────┐
│  UI (React)  ·  Zustand turn state machine  ·  Latency HUD     │
│                                                                │
│  Capture AudioWorklet ──► 16 kHz Int16 frames (1,024 B)        │
│  Playback AudioWorklet ◄── ring buffer of PCM from gateway     │
│  Shared domain code (pricing, matching, ledger) for edits      │
│  IndexedDB (Dexie): products, customers, bills, ledger         │
│  Service worker: offline app shell                             │
└───────────────────────┬────────────────────────────────────────┘
                        │ one duplex WebSocket (WSS)
                        │  ↑ binary PCM + JSON control   ↓ JSON events + binary TTS PCM
┌───────────────────────▼────────────────────────────────────────┐
│          Gateway (Node.js, Fastify + ws) — long-lived          │
│                                                                │
│  Session manager ─ auth, limits, heartbeats, per-turn timing   │
│  STT link   : re-framer + real-time pacer ─► Gnani STT WS      │
│  Turn engine: transcript ─► rules parser ─┬─► draft            │
│                                           └─► LLM (timeboxed)  │
│  TTS link   : request queue ─► Gnani TTS WS ─► binary PCM out  │
│  Phrase cache (LRU + disk), credit guard, metrics              │
└───────────────┬───────────────────────────┬────────────────────┘
                │                           │
        Gnani AI (Prisma, Timbre)     LLM provider (optional, e.g. Bedrock)
```

### Key design decisions

| Decision | Why |
|---|---|
| **Separate Node.js gateway, not Next.js API routes** | Realtime audio needs long-lived WebSockets, pacing timers and connection reuse. These do not fit serverless request handlers. The gateway can also keep Gnani connections warm. |
| **One duplex WebSocket per browser session** | One connection, no per-request handshake, ordered delivery, easy interruption. |
| **Binary audio on the wire, no base64 toward the browser** | Gnani's TTS sends base64 inside JSON; the gateway decodes once and forwards raw binary, saving about a third of the bytes and the client-side decoding. |
| **Push-to-talk plus `commit`** | The end of speech is known the instant the user releases. Skips the server's silence timer (500 ms by default). |
| **Gateway paces audio at real-time cadence** | Gnani expects exact 1,024-byte frames at real-time cadence, not bursts. The gateway re-frames and paces so network jitter does not hurt recognition. |
| **Rules first, LLM only if needed** | A deterministic parser answers in milliseconds for common sentences. The LLM is a timeboxed fallback, never on the critical path for confident parses. |
| **Prices and totals come from code, never the LLM** | Models can hallucinate numbers. They only extract *what was said*. |
| **Gateway builds the draft; the browser can recompute on edits** | Both sides use the same `shared` package, so a bill is identical wherever it is computed. |
| **Streaming TTS into a worklet ring buffer** | Gapless playback, instant flush on interruption, no per-chunk node allocation. |
| **Local-first ledger (IndexedDB)** | Instant UI, offline viewing, no database to run, and customer data stays on the device. |
| **Turn IDs on everything** | Stale audio or events from an interrupted turn can be discarded safely. |

## 6. Realtime protocol (browser ↔ gateway)

Defined once in `packages/shared/src/protocol` with Zod schemas, and used by both sides. Protocol version `1`.

**Connection:** `POST /session` returns a short-lived signed token (origin allowlist, rate limited), then the browser opens `wss://<gateway>/ws?token=...`.

### Browser → gateway

| Message | Kind | Purpose |
|---|---|---|
| `hello` | JSON | `{v, clientTime, lang, catalog:{version, products[], customers[]}}`. Products carry price and unit; customers carry balances. Sent once per session. |
| `context_update` | JSON | New customer balances or catalog changes after a save or edit. |
| `ptt_start` | JSON | `{turnId, draftContext?}`. Current unsaved draft enables rules-only corrections; `null` clears obsolete state. Shared code recalculates catalog lines and validated spoken-price quotes. The gateway readies the STT link. Maximum 33 KiB. |
| audio frame | **binary** | Exactly 1,024 bytes: 512 samples of 16-bit little-endian mono PCM at 16 kHz. No header. |
| `ptt_end` | JSON | `{turnId}`. The gateway drains and sends `commit`. |
| `interrupt` | JSON | `{turnId}`. Stops TTS, cancels pending work for that turn. |
| `speak` | JSON | `{turnId, text}` for client-initiated speech (for example after saving). Length-limited. |
| `ping` | JSON | Keepalive and RTT measurement. |

### Gateway → browser

| Message | Kind | Purpose |
|---|---|---|
| `ready` | JSON | `{v, sessionId, limits:{maxSessionMinutes, maxUtteranceSeconds}, audio:{inputSampleRate, inputFrameBytes}}`: session accepted, with limits and the expected microphone format. |
| `speech_start`, `processing` | JSON | Pass-through of Gnani's speech and end-of-speech signals for instant UI feedback. |
| `transcript` | JSON | `{turnId, text, language, sttMs}` |
| `draft` | JSON | `{turnId, draftId, intent, source:'rules'\|'llm', confidence, customer?, bill?, payment?, balance?, unresolved[], warnings[], replyText}`. `draftId` is the idempotency key for saving once; `replyText` is 1 to 2 short sentences. For a spoken "haan" or "nahi" the gateway sends a `draft` with `intent` `confirm` or `cancel` and the **pending draft's `draftId`**: the browser performs the save or discard, the gateway only names the draft and speaks the short reply. With nothing pending, yes/no comes back as `unknown`. |
| `tts_start` / `tts_end` | JSON | `{turnId, sampleRate, format:'pcm_s16le'}` |
| TTS audio | **binary** | 1 byte type tag (`0x01`), 4-byte turn ID, then raw PCM. |
| `timing` | JSON | Per-turn spans for the latency HUD. |
| `error` | JSON | `{turnId?, code, message, retryable}`. `LLM_TIMEOUT` and `TTS_UNAVAILABLE` are not fatal: a `draft` was already sent, so show it (with a review banner) and ignore the error otherwise. |
| `limit` | JSON | Demo busy or budget reached, with a reset time if known. |
| `pong` | JSON | `{t}`: reply to the client's `ping`, echoing its timestamp so the browser can measure RTT. |

Binary TTS frames put a 5-byte header in front of the PCM, so the PCM view starts at an odd byte offset: read it with a `DataView` or copy it rather than wrapping it in an `Int16Array`.

Rules: every JSON message is validated with Zod on receipt; unknown types are ignored and logged; binary frames of the wrong length are dropped and counted.

## 7. Gnani AI integration

The challenge requires every project to use at least one Gnani AI model or API and to name each member's contribution.

### Speech-to-text: Prisma (realtime WebSocket)

- Endpoint: `wss://api.vachana.ai/stt/v3/stream`. Configuration is sent as **upgrade headers**, which browsers cannot set, so the gateway holds the connection.
- Audio: raw PCM, 16-bit mono, **exactly 1,024 bytes per frame** (512 samples), sent at real-time cadence (32 ms per frame at 16 kHz). Never buffer-and-burst.
- Server-side voice activity detection returns **one final transcript per speech segment**, with `latency` in milliseconds and a `detected_language_code` on Prisma v3.0. There are no word-by-word partials; our UI uses the `speech_start` and `processing` events for instant feedback instead.
- A `{"type":"commit"}` text frame closes the open utterance immediately.
- Sessions last up to 15 minutes; idle timeout is configurable (`x-idle-timeout-sec`, 5 to 900). Concurrent sessions are capped per organization.
- Prisma v3.0 extras we use: `keyterms` (up to 200 words or phrases, JSON-escaped for non-ASCII) loaded from the catalog and customer names, `topic` ("Hinglish kirana shop billing: grocery items, quantities, udhaar"), and the `format` options.
- VAD headers worth tuning: `x-vad-threshold`, `x-min-silence-ms`, `x-min-speech-ms`, `x-min-segment-ms`. **Do not raise `x-min-segment-ms` too far**: it silently drops one-word answers such as "haan" and "nahi", which our voice-confirm flow needs.

### Text-to-speech: Timbre (realtime WebSocket)

- Endpoint: `wss://api.vachana.ai/api/v1/tts`, header `X-API-Key-ID`. Send a JSON request (`text`, `voice`, `model`, `language`, `speed`, `audio_config`) and receive `start`, then `audio` messages with base64 chunks, then `complete`.
- Models: `timbre-v2.5` and `timbre-v3.0`. Each has its own voices. `language` accepts `hi-IN`, `auto` and `hi-en` (Hinglish), among others.
- For streaming we request **raw PCM** (`container: raw`, `encoding: linear_pcm`) at a lower sample rate such as 24,000 Hz to cut bytes. OGG is delivered as a single chunk, so it cannot stream.
- **One synthesis request at a time** per connection. The SSE docs also show a 429 for more than one active request. The gateway queues requests; it never parallelizes TTS.
- Gnani's input-formatting guide says numbers and currency should be passed as **spoken words**. So `packages/shared` converts amounts into Hindi number words before synthesis.

### Parameters to settle with measurements, not guesses

These are decided by the **latency spike** (Prompt 2 in `PROMPTS.md`) and recorded in `docs/LATENCY.md`, which is the source of truth afterwards:

| Question | Options to compare |
|---|---|
| STT output style | `verbatim`, `transcribe`, `codemix`, `transliterate` on our golden utterances |
| STT language | `indic-auto` vs `hi-IN,en-IN` |
| STT connection reuse | One persistent socket per session across presses vs a warm spare per press |
| Pre-roll on press | 0 ms vs about 150 ms |
| TTS model and voice | `timbre-v2.5` vs `timbre-v3.0`, a few voices |
| TTS language and text | `hi-IN` with Devanagari vs `hi-en` with Latin Hinglish |
| TTS chunk format | Confirm that raw chunks have no per-chunk header |
| Region | Round-trip time to `api.vachana.ai` from candidate AWS regions |

Always confirm API details in <https://docs.gnani.ai>. Do not invent parameters.

## 8. Latency design and budget

### Techniques

1. **Stream from the first millisecond.** A warm microphone stream and capture worklet mean pressing the button starts sending immediately.
2. **Commit on release.** No waiting for the server's silence timer.
3. **Pre-warmed Gnani links.** The gateway keeps the STT and TTS WebSockets open and ready. A fresh session also opens them as soon as `hello` arrives.
4. **Real-time pacer.** A drift-corrected timer forwards 1,024-byte frames at the right cadence from a pre-allocated ring buffer. No per-frame allocation in the hot path.
5. **Rules-first parsing.** Confident parses never wait for a model. When rules are not confident, the LLM call is timeboxed (about 1.2 s); on timeout the rules result is shown for review.
6. **Speak while drawing.** The gateway starts TTS as soon as the draft exists; the bill animates in at the same time.
7. **Short spoken replies**, split into at most two short sentences, queued back to back. First chunk is played as soon as it arrives.
8. **Gapless playback worklet** with a small jitter buffer (about 60 to 120 ms prefill), underrun counters, and an instant flush on interruption.
9. **No `permessage-deflate`** on audio; **TCP_NODELAY** on sockets; keep-alive HTTP agents to the LLM provider; a prompt-cache-friendly static system prompt.
10. **Phrase cache** (LRU in memory plus disk) for repeated spoken phrases, with a warm-up script.
11. **Region choice.** Run the gateway in the AWS region with the lowest measured round trip to Gnani and to typical users (Mumbai, `ap-south-1`, is the starting candidate).
12. **Resilience over cleverness.** Heartbeats, exponential-backoff reconnects, rotation of the Gnani STT session before the 15-minute cap, and graceful degradation (rules-only, text-only).

### Targets (goals to measure, not promises)

| Span | Target (p50) |
|---|---|
| Release → `processing` ack on screen | under 150 ms |
| Release → transcript | under 600 ms |
| Transcript → draft (rules path) | under 20 ms |
| Transcript → draft (LLM path) | under 1.3 s |
| Release → bill visible (rules path) | under 800 ms |
| Release → first audible TTS sample | under 1.3 s |

### How we measure

Every turn carries timestamps from the browser (press, release, first frame sent, first audio played using the audio clock plus the browser's reported output latency) and from the gateway (commit sent, transcript received, parse done, TTS first byte, first chunk forwarded). The gateway returns a `timing` event; the browser shows it in the **latency HUD** and logs aggregates. **Only publish numbers we measured on a real phone**, with the conditions stated.

## 9. Voice understanding

### Intents

| Intent | Example | Effect |
|---|---|---|
| `create_bill` | "Sharma ji ko do kilo aata, ek Maggi, teen sau udhaar" | Draft bill, optional udhaar |
| `record_payment` | "Sharma ji ne do sau de diye" | Draft payment |
| `query_balance` | "Sharma ji ka kitna udhaar hai?" | Answered immediately, spoken |
| `query_summary` | "Aaj kitni bikri hui?" | Today's sales and total udhaar, spoken (rules only) |
| `out_of_stock` | "Aata khatam ho gaya" | Draft; "haan" sets that product's stock to 0 (rules only) |
| `add_customer` | "Ramesh Kumar ko customer mein add karo" | Draft; "haan" creates the customer on the device, name only (rules only). An existing name is not offered again |
| `add_product` | "Samaan mein Maida 35 rupaye kilo add karo" | Draft with the spoken rate per unit; "haan" adds it to Samaan (rules only). With no unit spoken it shows "piece"; a count above one or an existing product is not offered |
| `add_products` | "Samaan mein jodo aata 45 kilo, cheeni 50 kilo, Maggi 14 packet" | Two or more name + price rows; one "haan" adds every new one, existing products are skipped (rules only). A row with no price is not understood |
| `update_price` | "Chawal ka rate 45 karo" | Draft showing the old and new rate; "haan" changes only that product's rate (rules only). Unknown products, a rate for a different unit, and an unchanged rate are not offered |
| `confirm` | "haan", "theek hai", "kar do" | Saves the pending draft |
| `cancel` | "nahi", "rehne do", "cancel" | Discards the pending draft |
| `unknown` | anything else | Friendly retry prompt |

**Also on the device (no microphone needed):** the home screen shows the shop's most-sold products as one-tap **quick tiles** that start or extend a cash bill; the Khata screen can sort by **oldest unpaid udhaar** (shown as "N din se baaki") and opens a **WhatsApp reminder** (a `wa.me` link with a prefilled message; nothing is sent by the app, the shopkeeper taps send).

Two manual scripts call the real LLM, one request at a time, and are never run by tests: `pnpm --filter @bolbill/gateway llm:check` (one call) and `pnpm --filter @bolbill/gateway llm:eval` (rules vs model on a small synthetic set, `apps/gateway/src/parse/llm/evalSet.ts`).

### Structured output

```json
{
  "intent": "create_bill",
  "customer": "Sharma ji",
  "items": [
    { "name": "aata", "quantity": 2, "unit": "kg" },
    { "name": "Maggi", "quantity": 1, "unit": "piece" }
  ],
  "amount_paid": null,
  "udhaar_amount": 300,
  "confidence": 0.86
}
```

- The LLM schema never accepts prices. The deterministic rule parser may attach literal spoken-price quotes; shared `pricing.ts` computes totals from those or from the catalog. A turn containing an explicit quote stays rules-only, including under `LLM_MODE=always`; invalid quotes are flagged instead of handed to a model.
- Unresolved or ambiguous items are returned with candidate suggestions and flagged for review instead of being guessed.

### Rules first, LLM as a timeboxed fallback

`packages/shared/src/parser/ruleBased.ts` handles the common sentence shapes with keyword patterns, Hinglish number words, unit normalization and catalog matching. If its confidence is high and every item resolves, the draft is sent immediately. Otherwise the gateway calls the LLM (Amazon Bedrock if it works on your AWS plan; the adapter is swappable and `none` is a valid setting), validates the answer with Zod, and sends the improved draft. If the LLM is slow or fails, the rules result is shown with a review banner. The transcript is untrusted input and is delimited in the prompt.

### Spoken replies

Replies are short templated Hinglish sentences from `packages/shared/src/voice/responses.ts`. Amounts are converted to spoken Hindi number words (`hindiNumbers.ts`) before synthesis, as Gnani's formatting guide recommends.

## 10. Data model and sync

Stored locally in IndexedDB (Dexie). The gateway keeps only a **per-session, in-memory snapshot** sent in `hello` and `context_update`; it persists nothing.

```ts
Product      { id, name, aliases: string[], unit, pricePerUnit, category? }
Customer     { id, name, aliases: string[], createdAt, mobile?, address? }
Bill         { id, customerId?, items: BillItem[], total, paid, udhaar, createdAt, reversedAt?, reversalReason?, business?: ReceiptBusiness }
BillItem     { productId, name, quantity, unit, unitPrice, lineTotal }
LedgerEntry  { id, customerId, type: 'udhaar' | 'payment', amount, billId?, note?, createdAt, reversesEntryId? }
```

Customer balance = sum(udhaar) − sum(payments), always **derived**. Money is stored in integer rupees. A seed file (`data/seed-catalog.json`) holds about 40 synthetic products and 8 synthetic customers.

Reversed bills retain their items/payment split and add `reversedAt` and `reversalReason`. Their linked ledger reversals are written atomically with the bill status. Contact details are local only and never included in gateway snapshots, LLM prompts or receipts.

## 11. Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces (`apps/web`, `apps/gateway`, `packages/shared`) |
| Frontend | Next.js (App Router), React, TypeScript strict, Tailwind CSS, Zustand |
| Audio (browser) | `getUserMedia`, `AudioContext`, two `AudioWorklet`s (capture, playback ring buffer) |
| PWA | Web App Manifest, hand-written service worker |
| Local data | IndexedDB through Dexie |
| Gateway | Node.js 20+ (TypeScript strict), Fastify, `@fastify/websocket` (built on `ws`), `ws` client for Gnani |
| Validation | Zod (protocol, LLM output, upstream responses) |
| Speech | Gnani Prisma STT and Timbre TTS over WebSocket |
| LLM (optional) | Amazon Bedrock (Converse API, a small fast model) if available on your AWS plan, behind a provider interface; OpenAI-compatible adapter optional; `none` means rules only |
| Logging and metrics | pino (no transcripts or names), in-process histograms, `/metrics` |
| Tests | Vitest, a **mock Gnani server** for credit-free realtime tests, Playwright smoke test (optional) |
| Build | tsx for dev, tsup for the gateway, Docker for deployment |

## 12. Repository structure

```
bol-bill/
├── README.md  AGENTS.md  CLAUDE.md  PROMPTS.md
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  .env.example
├── apps/
│   ├── web/                         # Next.js PWA
│   │   ├── public/
│   │   │   ├── manifest.webmanifest  sw.js  icons/
│   │   │   ├── worklets/{capture.js, playback.js}   # generated by scripts/build-worklets.mjs, not committed
│   │   │   └── noise/               # license-clean noise samples (stretch)
│   │   └── src/
│   │       ├── app/                 # / (voice), /ledger, /catalog
│   │       ├── components/          # MicButton, BillCard, LatencyHud, ...
│   │       └── lib/{audio, realtime, turn, gesture, session, db}/   # audio: worklet DSP; turn: reducer + controller
│   └── gateway/                     # Node.js realtime gateway
│       └── src/
│           ├── server.ts  config.ts
│           ├── session/             # SessionManager, Turn engine
│           ├── gnani/               # sttLink.ts, ttsLink.ts, pacer.ts
│           ├── parse/               # orchestrator, llm/{bedrock,openai}.ts
│           ├── guard/               # auth, rate limits, credit caps
│           └── metrics/
├── packages/
│   └── shared/                      # protocol + domain, used by both apps
│       └── src/{protocol, domain, parser, voice}/
├── tools/mock-gnani/                # fake Gnani STT and TTS WebSocket servers
├── scripts/                         # latency spike, utterance replay, phrase warm-up
├── data/seed-catalog.json
├── tests/utterances.json
└── docs/{LATENCY.md, TESTING.md, SMOKE_TEST.md, SUBMISSION.md, DEPLOY.md}
```

## 13. Getting started

### Prerequisites

- Node.js 20 or newer, pnpm
- A Gnani API key from <https://app.gnani.ai/voice>
- AWS credentials with Bedrock access (or another LLM provider key), optional because the rules parser works without it
- A phone, or Chrome DevTools device mode, for the mic

### Run locally

```bash
git clone <your-repo-url> bol-bill && cd bol-bill
pnpm install
cp .env.example .env            # fill in keys (gateway) and the gateway URL (web)
cp apps/web/.env.example apps/web/.env.local  # configure Supabase; follow docs/AUTH.md's SQL setup
pnpm dev                        # runs web (3000) and gateway (8080) together
```

Run only one dev stack at a time: stop `pnpm dev:mock` before starting `pnpm dev` (or vice versa). Both use ports 3000/8080; mock mode also needs its STT/TTS servers on 9101/9102. The root dev scripts stop their other processes when a service command exits with an error, so a failed mock-server startup does not leave a gateway connected to missing mocks. If the UI says online but speech fails, check which mode owns port 8080; online means the browser is connected to the gateway, not that the speech provider is healthy.

`pnpm dev` and `pnpm build` in `apps/web` first compile the audio worklets (`src/lib/audio/worklets/*.worklet.ts`) into `public/worklets/` with esbuild; `pnpm --filter @bolbill/web worklets` does it by hand. Dev-only pages `/dev/audio` (audio layer) and `/dev/turn` (a whole turn against the gateway; its test-tone microphone is labelled as synthetic) are not served in production builds.

**PWA:** `public/manifest.webmanifest`, `public/sw.js` (versioned cache; never touches the gateway: no POST, no WebSocket, no `/session`, no cross-origin) and `public/offline.html`. It registers in production builds only. The placeholder icons in `public/icons/` come from `node apps/web/scripts/make-icons.mjs`; to use your own artwork, replace `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (keep the subject inside the centre 80%) and `apple-touch-icon.png` (180 px) with the same names. Bump `VERSION` in `sw.js` when the shell changes in a way network-first fetching would not pick up. Local data (products, customers, bills, ledger) lives in IndexedDB through Dexie (`apps/web/src/lib/db`); the dev query `?tone=1` (development builds only) swaps the microphone for a labelled synthetic tone.

Microphone access needs HTTPS except on `localhost`. To test on a phone, deploy a preview or use a TLS tunnel, and use `wss://` for the gateway.

| Script | Purpose |
|---|---|
| `pnpm dev` | Web and gateway in watch mode |
| `pnpm dev:mock` | Gateway against the mock Gnani servers (no credits spent) |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates |
| `pnpm build` | Build everything |
| `pnpm spike` | Latency spike against the real Gnani API (spends a few credits) |
| `pnpm warm-phrases --dry-run` | Lists the fixed spoken phrases and the characters a warm-up would spend; without `--dry-run` it fills the TTS phrase cache (spends TTS credits unless pointed at the mock). `--budget N` caps characters |

## 14. Environment variables

Defined in `.env.example`. **Never commit `.env`.** Only `NEXT_PUBLIC_GATEWAY_URL` may reach the browser.

| Variable | Used by | Description |
|---|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | web | `https://` base URL of the gateway (public, not a secret) |
| `GNANI_API_KEY` | gateway | Gnani key |
| `GNANI_STT_URL`, `GNANI_TTS_URL` | gateway | Gnani WebSocket endpoints. Default to the real API; `pnpm dev:mock` points them at `tools/mock-gnani` through `apps/gateway/mock.env` |
| `GNANI_STT_MODEL`, `GNANI_STT_LANGUAGE`, `GNANI_STT_FORMAT` | gateway | Defaults `prisma-v3.0`, `indic-auto`, chosen by the spike |
| `GNANI_STT_VAD_THRESHOLD`, `GNANI_STT_MIN_SILENCE_MS`, `GNANI_STT_MIN_SPEECH_MS`, `GNANI_STT_MIN_SEGMENT_MS` | gateway | VAD tuning |
| `GNANI_STT_STRATEGY`, `GNANI_STT_IDLE_TIMEOUT_SEC`, `GNANI_STT_ROTATE_AFTER_MIN` | gateway | STT connection: `persistent` (default) or `spare`; idle timeout 5 to 900 s (default 900); rotation before the 15 min cap (default 13 min). Unmeasured until the spike runs |
| `STT_DRAIN`, `MAX_UTTERANCE_SECONDS` | gateway | `paced` (default) or `burst` drain of the audio backlog on release; per-press audio cap (default 30) |
| `GNANI_TTS_MODEL`, `GNANI_TTS_VOICE`, `GNANI_TTS_LANGUAGE`, `GNANI_TTS_SAMPLE_RATE` | gateway | Defaults `timbre-v2.5`, `Nalini`, `hi-IN`, `24000`, chosen by the spike |
| `GNANI_TTS_CACHE_DIR`, `TTS_CACHE_MEMORY_MB` | gateway | Phrase cache location (default `.tts-cache`, git-ignored) and in-memory LRU size (default 16 MB) |
| `LLM_PROVIDER` | gateway | `bedrock`, `openai-compatible` or `none`. **Default `none`** until Bedrock access is verified on your account |
| `AWS_REGION`, `BEDROCK_MODEL_ID` | gateway | Use a small fast model your account has access to; check the console for the exact ID or inference profile |
| `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` | gateway | Only for `LLM_PROVIDER=openai-compatible` (any `POST {base}/chat/completions` server); the key is optional. How to verify a provider by hand: [docs/LLM.md](docs/LLM.md) |
| `OPENAI_REASONING_EFFORT` | gateway | Optional `none` / `minimal` / `low` / `medium` / `high`, sent as `reasoning_effort` (Gemini's compatibility API). Lower thinks less. Measured results: [docs/LATENCY.md](docs/LATENCY.md) |
| `LLM_TIMEOUT_MS` | gateway | Default `1200` |
| `ALLOWED_ORIGINS`, `SESSION_TOKEN_SECRET`, `DEMO_ACCESS_CODE` | gateway | Origin allowlist, token signing, optional demo gate |
| `MAX_SESSIONS`, `MAX_SESSION_MINUTES` | gateway | Concurrency and session length caps |
| `SESSION_RATE_PER_IP_PER_MIN`, `SESSION_RATE_GLOBAL_PER_MIN` | gateway | Rate limits on `POST /session` (defaults 10 and 60) |
| `METRICS_TOKEN` | gateway | Bearer token for `GET /metrics`; the endpoint is disabled when unset |
| `PARSER_MODE` | gateway | `rules_ai` (default: rules first, model only when unsure) or `ai_only` (the model calls tools for every sentence; needs `LLM_PROVIDER` other than `none`; see docs/LLM.md) |
| `CREDIT_USAGE_FILE` | gateway | JSON file holding today's credit usage so a restart does not reset the daily caps; blank keeps it in memory (tests). Compose sets it on the cache volume |
| `TRUST_PROXY`, `DRAIN_TIMEOUT_MS` | gateway | Trust `X-Forwarded-For` (set `true` behind Caddy); how long SIGTERM waits for sessions to finish (default 10 s) |
| `DAILY_STT_SECONDS_CAP`, `DAILY_TTS_CHARS_CAP` | gateway | Credit guard |
| `PORT`, `LOG_LEVEL` | gateway | Server settings |

## 15. Testing and measurement

- **Unit tests (shared):** number words, Hindi number-to-words, catalog matching, pricing, ledger, rule-based parser, protocol schemas. Pure functions, fast and reliable.
- **Mock Gnani server (`tools/mock-gnani`):** a fake STT WebSocket that enforces 1,024-byte frames and cadence and returns scripted transcripts, and a fake TTS WebSocket that streams scripted PCM. It lets us test pacing, commit, interruption, reconnects and rotation **without spending credits**.
- **Golden utterances:** `tests/utterances.json` with 45+ Hinglish sentences and expected structured output.
- **Latency spike and HUD data:** `pnpm spike` and the in-app HUD write results into `docs/LATENCY.md`.
- **Manual device tests:** Android Chrome and iPhone Safari; quiet room, fan noise, street noise, fast and slow speech, installed PWA mode, flaky network, airplane mode mid-turn.
- **Failure drills:** gateway restart mid-session, Gnani error, LLM timeout, 25-second utterance, double confirm tap.

## 16. Deployment on AWS

Our AWS account is on the **Free Plan** (new accounts get $100 in credits plus up to $100 more for onboarding activities; the plan ends after 6 months or when the credits run out, whichever comes first, and some services are restricted). So we use **as few AWS services as possible**, and only ones AWS describes as usable with free-plan credits.

### Minimal setup (recommended): one EC2 instance running Docker Compose

| Need | Choice | Notes |
|---|---|---|
| Compute | **Amazon EC2**, one instance in Mumbai (`ap-south-1`) | On accounts created on or after July 15, 2025, the free-plan-eligible types are `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `c7i-flex.large` and `m7i-flex.large`. `t3.small` (2 GB RAM, x86) is a comfortable cheap pick; the larger flex types are steadier but use credits faster. Look for the "Free tier eligible" label in the launch wizard, or list them with `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true`. Not every type is offered in every region. |
| Disk | EBS `gp3`, about 20 GB | |
| Public address | Elastic IP (or the instance's public IPv4) | Public IPv4 addresses can use a little credit. |
| TLS and routing | **Caddy** container on the same instance (automatic Let's Encrypt certificates) | Needs a domain name (yours, or a free subdomain service). Serves `https://<domain>` to the Next.js app and `wss://<domain>/ws` to the gateway on **one origin**, so no CORS. No load balancer or CloudFront needed. |
| Frontend | Next.js container (`output: 'standalone'`) on the same instance | Alternative: AWS Amplify Hosting, which AWS lists as usable with free-tier credits. |
| Secrets | A `.env` file on the instance (`chmod 600`), or Systems Manager Parameter Store (standard parameters) | Avoid Secrets Manager (a monthly fee per secret). |
| Logs | Docker logs with rotation | CloudWatch is optional; keep volumes small. |
| Alerts | **AWS Budgets** | Set it up on day one. It is also one of the credit-earning onboarding activities. |
| LLM (optional) | **Amazon Bedrock** | See the note below. Verify before relying on it. |

**Deliberately not used:** Application Load Balancer, CloudFront, ACM, ECS/Fargate, RDS, Secrets Manager. AWS lists load balancers as usable with credits, but they use credits every hour and add a network hop; one instance with Caddy is cheaper and has lower latency. Do not add AWS services without a reason and a quick cost check.

### Free Plan caveats

- The plan ends after 6 months or when credits are used up, and then the account closes unless you upgrade. AWS's billing docs say you can upgrade to a Paid plan within 90 days to keep access; remaining credits then apply to future bills until they expire 12 months after sign-up. Keep the instance running through the challenge's evaluation period.
- Credits are $100 at sign-up plus up to $100 more for five onboarding activities (launch an EC2 instance, create an RDS database, create a Lambda function with a function URL, run a Bedrock text prompt, set an AWS Budget). If you do the RDS activity, delete the database right after.
- AWS says Free Plan accounts should not be used for sensitive data. We use synthetic data only.
- AWS sends warnings when 50%, 25% and 10% of credits remain. Check **Billing and Cost Management** weekly.
- I could not retrieve AWS's exact list of restricted services. The EC2 launch wizard and the console will tell you what is blocked.

### Bedrock (optional)

AWS counts a Bedrock text prompt as a credit-earning activity, so it is usable with free-plan credits, but model access, regional availability and quotas vary, and at least one user reports zero quotas on a free-plan account. **Verify in the Bedrock console first** (model access, quotas, region). If it is blocked or slow, keep `LLM_PROVIDER=none` (rules-only; the app still works) or point the OpenAI-compatible adapter at another provider. Calling a model in a distant region adds latency. If you use Bedrock from the instance, attach an IAM role with the minimum `bedrock:InvokeModel` permission and no static keys.

### Region and latency

Start with Mumbai (`ap-south-1`) and verify with `scripts/measure-rtt.ts` (connection times to `api.vachana.ai`). Gnani's hosting region is not stated in its docs.

### Deploy outline

1. Launch the instance with a security group that allows 80 and 443 from anywhere and SSH only from your IP; attach an Elastic IP.
2. Install Docker, copy the repo (or pull images), create the `.env` file (`chmod 600`).
3. Point your domain's A record at the Elastic IP.
4. `docker compose -f docker-compose.prod.yml up -d` (Caddy, gateway, web).
5. Check `https://<domain>/healthz`, then a full turn on a real phone over mobile data (WSS from an HTTPS page).
6. Keep heartbeats flowing so WebSockets stay open. Do not print secrets in logs.
7. When the challenge is over, stop or delete every resource you created (the Prompt 8 step asks the agent to list them all).

> Step-by-step instructions for this plan, with the Dockerfiles, `docker-compose.prod.yml` and `deploy/Caddyfile`, are in [`docs/DEPLOY.md`](docs/DEPLOY.md). Test results and the manual device matrix are in [`docs/TESTING.md`](docs/TESTING.md); the submission pack is [`docs/SUBMISSION.md`](docs/SUBMISSION.md).

## 17. Demo guard and cost control

Gnani credits are limited, and their API has concurrency limits (per-organization STT session cap; one active TTS request recommended at a time). A public link could exhaust both.

- **Per-IP and global rate limits**, a maximum session length, a daily STT seconds cap and a daily TTS character cap.
- **Single-lane demo:** if concurrent capacity is reached the app shows a friendly "demo is busy" state (a queue or retry), never an error wall.
- **Optional access code** (`DEMO_ACCESS_CODE`) shared in the post comments or README.
- **The video is the primary artifact.** Engagement is counted on the post, not on app usage. The live link is a bonus.
- **Replay mode (stretch):** a clearly labelled recording of a real session, for when the live budget is used up. Never presented as live.
- Tests and development use the **mock Gnani servers** by default.

## 18. Privacy

- **Synthetic data only** in development, screenshots and the demo video. No real phone numbers, Aadhaar, PAN, account numbers or recorded calls.
- Audio is streamed to Gnani only while the button is held, and nothing is stored by the gateway. Review each provider's data policy before any real-world use.
- Transcripts go to the LLM provider only when rules are not confident.
- The microphone stream stays warm while the screen is open for low latency but **transmits nothing unless the button is pressed**; it is released when the app is backgrounded. The UI shows a clear recording indicator.
- Logs contain timings and error codes only: no transcripts, names or audio.

## 19. Challenge context and compliance

**Great Indian AI Internship Challenge** by Gnani AI:

- Open to enrolled students in India aged 18+; solo or a team of two.
- Open brief: build a working app on Gnani AI's models or APIs.
- **Deadline: November 10, 2026, 11:59 PM IST.** We target Nov 9.
- Submission: demo video, written explanation, Gnani models used, one nominated post link per platform.
- The demo post must be live **before** submitting, on LinkedIn and/or X, tagging Gnani AI with `#GreatIndianAIInternshipChallenge` and `#GnaniAI`.
- Shortlisting uses verified engagement on the post, then eligibility checks. Interviews and offers are individual.
- Prohibited: bought engagement, bots, paid promotion, engagement swaps, plagiarism, misleading demos.

**Awards we are aiming for:** Mixed Vibes (code-mixed speech), Real Deal (real-world impact), Two-Person Army, Demo Day Drop (60-second video), and Noise Canceller if the labelled Noise Lab shows strong results.

### Submission checklist

- [ ] Both teammates registered and eligible
- [ ] Gateway and web deployed over HTTPS/WSS, tested on Android and iPhone
- [ ] Latency numbers in the post come from `docs/LATENCY.md` (measured, with conditions)
- [ ] 60-second demo recorded on a real phone with only synthetic data
- [ ] Post live on LinkedIn and/or X with the hashtags and tags
- [ ] Explanation names Prisma and Timbre and each member's contribution
- [ ] Any non-Gnani component (the LLM) is disclosed honestly; we confirmed the rules allow it on Gnani's Discord
- [ ] Submitted before the deadline

## 20. Seven-day plan

| Date | Goal |
|---|---|
| Nov 3 | Scaffold the monorepo; run the **latency spike** on the real API to settle the open parameters; Person B starts the shared domain code in parallel |
| Nov 4 | Mock Gnani server; gateway STT link with pacer and commit; TTS link with streaming; web capture and playback worklets |
| Nov 5 | Full loop working end to end: press, stream, transcript, draft, spoken readback, interruption |
| Nov 6 | Ledger and voice confirm; UI polish; latency HUD; demo guard; noise tests |
| Nov 7 | Record the demo and **publish the post** so engagement accumulates |
| Nov 8 | Bug fixes, device testing, deployment hardening |
| Nov 9 | Final checks and **submit** |
| Nov 10 | Deadline, 11:59 PM IST |

## 21. Demo script and what makes it impressive

**Why it will land on LinkedIn:** it is visibly fast (the HUD shows real timings), it speaks the way the user speaks (Hinglish), it solves a real problem (udhaar), it works on a phone you can install from a link, and it stays honest (labelled noise lab, measured numbers).

**60-second script**

1. **0–6 s, problem:** hands busy at the counter, typing is slow.
2. **6–25 s, the bill:** hold the mic, speak a Hinglish order; the bill animates in while the voice reads it back; show the latency HUD.
3. **25–35 s, confirm by voice:** say "haan"; the ledger updates.
4. **35–48 s, the udhaar question:** ask "Sharma ji ka kitna udhaar hai?" and hear the answer.
5. **48–56 s, noise:** repeat an order with the labelled Noise Lab on (or a real fan), and show it still works.
6. **56–60 s, close:** "Built on Gnani Prisma and Timbre", the link, the hashtags.

Film on a real phone with captions. Use only synthetic data. State the conditions for any latency number you show.

## 22. Limitations and roadmap

**Limitations**

- Data lives on one device; no sync or backup.
- Gnani returns segment-level transcripts, not word-by-word partials.
- The public demo serves limited concurrency because of Gnani's limits and our credit caps.
- Text-to-speech is in Beta, and streaming usage may consume credits differently from file requests; we measure it in the spike.
- Prices must be set by the shopkeeper.

**Roadmap:** Capacitor Android app and Play Store release, offline-first billing with sync, Bluetooth thermal printing, WhatsApp bill and reminder sharing, regional language packs, per-shop vocabulary learning, optional cloud backup with authentication.

## 23. Team

| Member | Primary areas |
|---|---|
| Jayesh Malviya | _fill in your contribution_ |
| _Teammate name_ | _fill in your contribution_ |

> Offers are individual, so keep this honest and specific, and make sure both members understand the whole system.

## 24. Working with AI coding agents

- [`AGENTS.md`](AGENTS.md): shared rules for any AI coding agent
- [`CLAUDE.md`](CLAUDE.md): Claude Code specific context
- [`PROMPTS.md`](PROMPTS.md): ordered build prompts

Humans stay accountable for every line merged. Review and understand all AI-generated code before committing.

## License

MIT (update if you choose otherwise).
