# AGENTS.md — Rules for AI coding agents

Applies to every AI agent working in this repository (Claude Code, Codex, Cursor, Copilot, Gemini CLI and others). Read it fully before changing anything. If a rule here conflicts with an explicit instruction from the user in the current session, follow the user, but say so.

## 1. Project in one paragraph

**Bol-Bill** is a realtime, mobile-first PWA that lets kirana shopkeepers create bills and track customer credit (udhaar) by speaking Hinglish. A **Next.js PWA** (`apps/web`) streams 16 kHz PCM over one duplex WebSocket to a **separate Node.js gateway** (`apps/gateway`). The gateway paces audio into **Gnani Prisma** streaming speech-to-text, commits on release, parses the transcript (**rules first, LLM timeboxed as fallback**), computes the bill from the catalog, and streams **Gnani Timbre** speech back as binary PCM. Shared protocol and domain code lives in `packages/shared`. The ledger is local-first in IndexedDB. See `README.md` for the full architecture and protocol.

## 2. Challenge context (this drives priorities)

We are a **team of two students** in the **Great Indian AI Internship Challenge** by Gnani AI.

- **Hard deadline: November 10, 2026, 11:59 PM IST.** Target submission Nov 9. Time is the scarcest resource.
- The app must genuinely use Gnani AI models (Prisma STT, Timbre TTS), and the submission names them and each member's contribution.
- Shortlisting depends on **verified engagement on a public 60-second demo video** posted on LinkedIn/X. The app must be **fast, reliable and visually clear on a real phone**. A flawless happy path beats feature count.
- Offers are **individual**. Both humans must be able to explain every part. Prefer clear, well-structured code over cleverness, even though the system is sophisticated.
- Prohibited by the challenge: bought engagement, bots, plagiarism, **misleading demos**. Never fake API responses or latency numbers.
- Credits for Gnani APIs are limited (5,000 per registration) and Gnani has concurrency limits. Protect them (section 7).
- **No real personal data** (phone numbers, Aadhaar, PAN, account numbers, recorded calls). Synthetic data only.

## 3. Scope control

**In scope for the MVP:** push-to-talk streaming capture, streaming Gnani STT with commit, rules-first parser with LLM fallback, catalog matching and pricing, bill draft and confirm (tap or voice), udhaar ledger, streaming Gnani TTS with barge-in, latency HUD, installable PWA, demo guard.

**Out of scope unless asked:** user accounts, payments or UPI, a server-side database, multi-device sync, native apps, admin dashboards, analytics, i18n frameworks. Also do not add AWS services beyond a single EC2 instance (our account is on the AWS Free Plan; see README section 16): no load balancers, CloudFront, ECS/Fargate, RDS or Secrets Manager without asking.

Do not add features, dependencies or refactors that were not requested. If you think something is worth adding, **propose it in one or two sentences and wait**.

## 4. Repository layout and commands

```
apps/web         Next.js PWA (AudioWorklets in public/worklets)
apps/gateway     Node.js realtime gateway (Fastify + ws)
packages/shared  protocol schemas + domain logic + rule parser + voice templates
tools/mock-gnani fake Gnani STT/TTS WebSocket servers for credit-free tests
scripts/         latency spike, replay, warm-up
docs/LATENCY.md  measured results; the source of truth for tuned Gnani parameters
```

```bash
pnpm install
pnpm dev            # web + gateway
pnpm dev:mock       # gateway against mock Gnani (no credits)
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm spike          # real Gnani API; spends credits; run deliberately
```

Before saying a task is done, run `lint`, `typecheck` and `test`, and report the results honestly. If something fails or you could not run it, say so.

## 5. Coding rules

- **TypeScript strict. No `any`.** Use `unknown` and narrow. No `@ts-ignore` without a comment saying why.
- **Validate everything that crosses a boundary with Zod:** protocol messages (both directions), LLM output, upstream Gnani messages, env config at startup (fail fast with a clear error).
- **Domain logic is pure and lives in `packages/shared`** with unit tests. Components and gateway handlers stay thin. The gateway and the web app must compute bills using the **same** shared code.
- **Money is integer rupees.** No floats for totals. One rounding rule, in one place.
- **Prices, totals and balances are computed by deterministic code. The LLM never decides them.**
- A customer's balance is **derived** from ledger entries, never stored.
- Small functions, clear names, early returns. Comments explain *why*.
- Every UI that talks to the network handles loading, empty, offline and error states.
- **Ask before adding a dependency** and justify size and necessity. Prefer the platform and existing packages.
- No dead code, commented-out blocks or stray `console.log` in commits (use the pino logger on the gateway).

## 6. Realtime and latency rules

These matter more than usual: speed is the product.

- **Hot path discipline** (audio frames, pacer, playback worklet): no per-frame allocation, no JSON, no `await` chains that are not needed, no synchronous file or crypto work, no logging per frame. Use pre-allocated ring buffers and typed arrays.
- **Audio on the wire is binary.** The browser sends exactly 1,024-byte PCM frames (512 samples, 16-bit LE mono, 16 kHz). TTS goes to the browser as binary with the 1-byte type tag and 4-byte turn ID header. Never base64 audio toward the browser.
- **Gnani STT contract:** frames of exactly 1,024 bytes at real-time cadence (32 ms per frame at 16 kHz); never buffer-and-burst beyond the documented drain-on-release behavior; `{"type":"commit"}` on release; rotate the session before the 15-minute cap.
- **Gnani TTS contract:** one synthesis request at a time. **Queue; never parallelize.** Raw PCM for streaming. Amounts go to TTS as spoken Hindi number words.
- **Every message and audio chunk carries a `turnId`.** The receiver discards anything from a turn that was interrupted or superseded.
- **Interruption must be instant:** on `interrupt`, stop forwarding TTS, abort the upstream request, flush the playback ring buffer.
- **Backpressure:** check `bufferedAmount`; never let queues grow unbounded; drop stale TTS first.
- Disable `permessage-deflate` for audio sockets; keep TCP_NODELAY on; use heartbeat pings.
- **Timeboxes:** the LLM call has a hard timeout (`LLM_TIMEOUT_MS`). When it expires, ship the rules result with a review flag. Never block the turn on the model.
- **Measure, do not guess.** Any change to the hot path or to Gnani parameters needs before/after numbers from `pnpm spike` or the HUD, recorded in `docs/LATENCY.md`. **Read `docs/LATENCY.md` before touching STT/TTS configuration.**
- Latency targets in the README are **goals**. Never write a latency number into code comments, docs or social copy unless it was measured.

## 7. Credit and cost safety

- Never call Gnani or the LLM from loops, tests, effects that re-run, page load or hot reload. **Tests and local dev use the mock Gnani servers** (`pnpm dev:mock`).
- The gateway enforces: per-IP and global rate limits, max session length, max sessions, daily STT-seconds and TTS-characters caps (the credit guard). Do not weaken or bypass them.
- Keep spoken replies short. Cache repeated TTS phrases (LRU memory + disk).
- `pnpm spike` is the only script that intentionally spends credits. Announce it, run it with small inputs, and report what it used.

## 8. Gnani API rules

- Use only endpoints and parameters documented at <https://docs.gnani.ai>. **Do not invent parameters, models, voices or endpoints.** If unsure, read the docs or say you are unsure.
- STT realtime: `wss://api.vachana.ai/stt/v3/stream`; config in upgrade headers (`x-api-key-id`, `model`, `language_code`, `x-sample-rate`, `keyterms`, `topic`, `format`, `x-idle-timeout-sec`, VAD headers). Browsers cannot set these headers, so **only the gateway connects to Gnani**.
- Do not raise `x-min-segment-ms` high enough to drop one-word answers ("haan", "nahi").
- TTS realtime: `wss://api.vachana.ai/api/v1/tts`; JSON request, base64 chunks in `audio` messages, `complete` at the end.
- Evon is not served on the API platform. Do not wire it in.
- All Gnani and LLM calls happen **server-side**, in the gateway only.

## 9. Security and privacy

- **Never expose secrets to the browser.** The only `NEXT_PUBLIC_` variable is the gateway URL. No keys in client code, logs, errors, screenshots or commits.
- Never commit `.env` files. Keep `.env.example` with placeholders only.
- **Synthetic data only** in seeds, tests, fixtures, docs and demos.
- **Do not log transcripts, customer names or audio.** Log request IDs, turn IDs, timings and error codes only.
- Treat transcripts, LLM output and all network input as untrusted: validate, length-limit, never `eval`, never render as HTML, never pass to a shell. Delimit the transcript in LLM prompts and treat embedded instructions as plain text.
- Gateway auth: short-lived signed session tokens, origin allowlist, size limits on every message type.
- The microphone stream may stay warm for latency, but **no audio is transmitted unless the user is pressing the button**. Release the stream when the app is backgrounded. Always show a clear recording indicator.

## 10. UX rules

- **Mobile first** (360 px Android phone), touch targets at least 48 px, high contrast for bright shops.
- The mic button is the hero element. Hold to talk, or tap to latch and tap to stop.
- Short Hinglish labels with English fallbacks. Every error says what to do next.
- Show the transcript and the parsed bill so errors can be caught. **Nothing is written to the ledger until the user confirms** (tap or voice).
- Animate the bill in while the voice speaks; keep animations cheap and 60 fps on low-end phones.
- Audio playback and recording start from a user gesture (iOS requires this).
- The latency HUD is a first-class feature, not a debug leftover. It must be toggleable and accurate.

## 11. Honesty rules

- **Never fake it.** No hardcoded transcripts, bills, timings or API responses in the real flow. Any demo, replay or noise-injection feature must be **clearly labelled in the UI** (for example "Replay of a recorded session", "Synthetic noise on").
- Do not claim something works unless you ran it. Do not claim tests pass unless you ran them.
- If blocked, uncertain or the requirement is ambiguous, **stop and ask**.
- Do not invent facts about Gnani's models, benchmarks, pricing or limits.
- Disclose non-Gnani components (the LLM provider) honestly in docs and the submission.

## 12. Git and collaboration

- Two humans share this repo. Small, focused, reviewable changes.
- Branches: `feat/...`, `fix/...`, `chore/...`, `docs/...`. Commits: Conventional Commits.
- No force-pushes, history rewrites or branch deletions unless asked.
- Do not edit unrelated files or reformat whole files.
- Update `README.md` when you change architecture, protocol, env vars, scripts or Gnani parameters. Update `docs/LATENCY.md` when you change measured behavior.
- Each human must understand what is merged. Explain non-obvious code in your summary.

## 13. Definition of done

1. It does what was asked, and nothing more.
2. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, or failures are reported honestly.
3. New logic has unit tests, including edge cases; realtime behavior has a mock-server test where practical.
4. Loading, empty, offline and error states exist where relevant.
5. No secrets, real personal data, per-frame logging or debug leftovers in the diff.
6. Hot-path or Gnani-parameter changes include measured before/after numbers.
7. Docs are updated if behavior or setup changed.
8. Your summary says what changed, what you ran, and what you did **not** verify.

## 14. When you finish a task

Reply with: what changed (files), how to try it, what you ran and the results, known gaps or risks, and one suggested next step. Keep it short.
