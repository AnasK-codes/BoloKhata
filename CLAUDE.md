# CLAUDE.md

@AGENTS.md

The file above holds the shared rules for all agents. Everything below is extra context for Claude Code.

## Mission

Ship **Bol-Bill**, a realtime Hinglish voice-to-bill PWA for kirana stores, for the **Great Indian AI Internship Challenge** (Gnani AI). Two student developers, working with Claude Opus. **Deadline: Nov 10, 2026, 11:59 PM IST; target submission Nov 9.** The goal is the most efficient, lowest-latency, most impressive 60-second phone demo that is also honest and reliable.

## Why the challenge shapes decisions

- Shortlisting is driven by **engagement on a public demo video**, so the live flow (hold, speak, bill animates in while the voice reads it back, say "haan", ask for the udhaar balance, work in noise) must be flawless and visibly fast.
- Each teammate is interviewed **individually**. Sophisticated is fine, but the code must stay organized and explainable.
- The app must visibly use **Gnani Prisma (STT)** and **Gnani Timbre (TTS)**.
- Awards targeted: Mixed Vibes, Real Deal, Two-Person Army, Demo Day Drop, and Noise Canceller if the labelled Noise Lab shows strong results.
- Gnani credits and concurrency are limited. A public link can exhaust them, so the demo guard and mock servers matter.

## Architecture in five lines

```
phone: mic → capture worklet → 1,024-byte PCM frames ═ one WebSocket ═► gateway
gateway: pacer → Gnani STT (commit on release) → rules parser ─┬─► draft → browser
                                                              └─► LLM (timeboxed 1.2 s) if not confident
gateway: draft → readback text → Gnani TTS (queued) → binary PCM → browser playback worklet
phone: bill animates in, voice plays, user confirms (tap/voice), ledger saved in IndexedDB
every message and audio chunk carries a turnId; interrupt flushes everything for that turn
```

Key places: `packages/shared/src/protocol` (the contract), `packages/shared/src/domain` and `parser` (pure logic), `apps/gateway/src/gnani` (`sttLink`, `ttsLink`, `pacer`), `apps/gateway/src/session` (turn engine), `apps/web/src/lib/audio` and `public/worklets`, `docs/LATENCY.md` (measured truth).

## How to work in this repo

1. **Plan before coding** for anything touching more than two files: short plan with files, approach and risks. Wait for a go-ahead on large or ambiguous work. You may plan multi-file changes, but commit in small steps.
2. **Protocol first.** Change `packages/shared/src/protocol` and its tests before either side's implementation. Keep gateway and web in sync through the shared types.
3. **Domain logic test-first** in `packages/shared`: number words, Hindi number-to-words, matching, pricing, ledger, rule parser, protocol schemas.
4. **Use the mock Gnani servers** for anything realtime. Only `pnpm spike` touches the real API, and only deliberately.
5. **Measure before optimizing.** Add timing spans, capture numbers, record them in `docs/LATENCY.md`. Read that file before changing STT/TTS parameters.
6. **Read before editing.** Open the relevant files and tests first; follow existing patterns.
7. **Check the docs, do not guess.** For any Gnani detail, read <https://docs.gnani.ai>; if you cannot verify something, say so.
8. **Use `PROMPTS.md`** as the build order. If a prompt conflicts with `AGENTS.md`, follow `AGENTS.md` and mention the conflict.
9. **Verify on a device.** Browser audio behaves differently on iOS Safari and low-end Android. Tell the user exactly what to test by hand when you cannot.

## Things Claude should proactively do

- Point out scope creep, risky shortcuts, and anything that could break the demo or burn credits.
- Flag unverified assumptions about Gnani (billing of streaming usage, concurrency caps, region) and suggest how to verify them cheaply.
- Keep the hot path allocation-free and the logs quiet; call out any violation.
- Offer to add or update tests when logic changes.
- Remind the user to post the demo by Nov 7 and to submit by Nov 9.

## Things Claude must never do

- Put keys in client code, logs or commits, or send Gnani/LLM calls from the browser.
- Add real personal data anywhere.
- Fake STT/TTS/LLM results, transcripts, timings or "live" claims; unlabeled replay or noise injection.
- Let the LLM decide prices, totals or balances.
- Parallelize TTS requests, burst STT frames, or block a turn on the LLM.
- Add auth, payments, a database server or a native app without being asked.
- Claim something works without running it, or quote a latency number that was not measured.

## Handy commands

```bash
pnpm dev
pnpm dev:mock
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm spike
```

## Decisions already made

- Next.js PWA frontend with a **separate Node.js gateway** (not Next.js API routes).
- The LLM is optional. Amazon Bedrock is supported behind a swappable adapter, but our AWS account is on the **Free Plan** and Bedrock access is unverified, so `LLM_PROVIDER` defaults to `none` (rules-only) until the user confirms it works. Rules-only mode must always work.
- AWS deployment on the Free Plan: a single EC2 instance (a free-plan-eligible type; `t3.small` suggested) in Mumbai (`ap-south-1`) running Docker Compose with Caddy for TLS, web and gateway on one origin. No ALB, CloudFront, ECS/Fargate, RDS or Secrets Manager. Verify the region with measurements.

## Open decisions (ask the user if they come up)

- Whether Bedrock works on their free-plan account (model access, quotas, region); otherwise stay rules-only or use another provider.
- Final app name and branding (working name: Bol-Bill).
- Which stretch features to build after the MVP loop is solid (Noise Lab, share bill, replay mode, regional language).
