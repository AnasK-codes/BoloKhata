# Prompt: backend bugs, speed, deployment readiness (ponytail)

Paste everything below the line into a NEW Claude Code session started in this repository. Run it in its own
git worktree or branch (`fix/backend-hardening`), not on `main`.

---

/ponytail full

You are the lazy senior backend engineer for **Bol-Bill**, a realtime Hinglish voice-to-bill app for kirana
shops. Your job: find real bugs in the backend, fix each at its root with the smallest complete change, make it
faster where measurements say so, and leave the repository ready to deploy to one EC2 instance. **The best code
is the code never written**: prefer deleting, reusing and one-line fixes. No refactors for taste, no new
abstractions, no new dependencies, no "for later" code.

## 0. Read first, in this order

1. `AGENTS.md` and `CLAUDE.md` (hard rules; they win over this prompt).
2. `docs/HARDENING_REPORT.md`, `docs/REVIEW.md`, `docs/DEPLOY.md`, `docs/PRE_DEPLOY_CHECKLIST.md`,
   `docs/TESTING.md`, `docs/LATENCY.md`, `docs/LLM.md`, `docs/AUTH.md`, `docs/SMOKE_TEST.md`. A hardening pass
   already happened; **do not redo it**. Find what changed *after* it.
3. `git log --stat` since the hardening report. The newest, least-tested code is your first suspect:
   the Supabase account broker and gateway account enforcement, the Gemini/OpenAI-compatible LLM path and
   `OPENAI_REASONING_EFFORT`, the new intents (`add_customer`, `add_product`, `add_products`, `update_price`) in
   `apps/gateway/src/session/draftBuilder.ts` and `turnEngine.ts`, the Devanagari folding in
   `packages/shared/src/parser`, the draft context (`ptt_start.draftContext`) handling, and `docker-compose.prod.yml`.
4. The code: `apps/gateway/src` (`server.ts`, `main.ts`, `config.ts`, `session/*`, `gnani/*`, `guard/*`, `parse/*`,
   `metrics.ts`, `timing.ts`), `packages/shared/src` (protocol, domain, parser, voice), `tools/mock-gnani`,
   `scripts/`, `deploy/Caddyfile`, `docker-compose.prod.yml`, both Dockerfiles, `.github/workflows/ci.yml`, `supabase/`.

## 1. Ponytail rules for this task (follow them literally)

- **Evidence before edit.** For every suspected bug: reproduce it, write a **failing test**, then make the
  smallest root-cause fix in shared code. Before editing a function, grep **every caller** and fix once there.
  If you cannot reproduce it, log it as "suspected" and **do not change the code**.
- **Smallest complete change.** Reuse what exists, then the standard library, then an installed dependency.
  Deletion beats addition. A shortcut with a known limit gets a one-line comment `shortcut: <limit>, <when to upgrade>`.
- New non-trivial logic (a branch, a parser, money, security) leaves one small test. Trivial changes need none.
- **Never cut:** validation at trust boundaries, error handling that prevents data loss, security, accessibility,
  anything the user asked for. Code you move keeps its error handling.
- Be lazy about the solution, never about completeness: update callers, tests, fixtures, config, `.env.example`
  and docs for every change.
- End every report with one or two lines: what you skipped or did not check, and any risk the user must know.

## 2. Hard constraints (from the repository)

- Touch `apps/gateway`, `packages/shared` (non-UI), `tools/mock-gnani`, `scripts`, `deploy`, compose, Dockerfiles,
  CI, `supabase/` and `docs/`. **Do not touch `apps/web`.** A frontend session runs in parallel.
- **Protocol is frozen.** Do not rename, remove or reshape any message field. An additive optional field is
  allowed only if a bug cannot be fixed otherwise: write it down for the frontend session first.
- Never call real Gnani or Gemini from tests, loops or hot reload. Use the mock Gnani servers (`pnpm dev:mock`).
  Real calls only through the manual scripts (`pnpm spike`, `llm:check`, `llm:eval`) and **only after asking the
  user** (they spend credits). Announce the call, keep inputs tiny, and report what was used.
- Do not weaken the credit guard, rate limits, origin allowlist or session tokens. Do not add auth, payments, a
  server database, or any AWS service beyond one EC2 instance (no ALB, CloudFront, ECS, RDS, Secrets Manager).
- Never log transcripts, customer names, audio or keys. Synthetic data only. Never commit `.env`.
- Hot path rules stand: no per-frame allocation, JSON, logging or needless `await`; audio is binary; one TTS
  request at a time (queue, never parallelise); STT frames at real-time cadence; every message carries a turnId;
  interrupts flush everything for that turn.
- No new dependency. If you believe one is needed, stop and ask with the size and why.

## 3. Phase A: baseline

1. `pnpm install`, then `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Record the real output.
2. Record baselines with the repo's own tooling against the mock servers: `pnpm loadtest` (gateway event-loop
   delay p99, release-to-transcript, release-to-first-TTS-byte, heap slope, frames sent vs received), parse time
   per utterance (rules parser over the whole utterance set, p50 and p99), memory per session, and the size of
   `ptt_start` and catalog messages. Write them in `docs/BACKEND_REVIEW.md` as the "before" table.

## 4. Phase B: bug hunt (reproduce, test, minimal fix)

Keep a table in `docs/BACKEND_REVIEW.md`: id, severity (critical/high/medium/low), evidence, root cause, fix,
test. Work critical and high first. Concrete suspects (confirm each; drop the ones that are fine):

**Turn engine and state**
- The "can this draft be confirmed by voice" decision is spread over several places (`onPttStart` eligibility,
  the correction path that sets `pending`, and `draftBuilder`'s `pendingChange`). Check they agree for **every**
  intent, including the four new ones, after a reconnect, after an edit in the browser, and for a stale
  `draftContext`. A mismatch lets "haan" confirm something that is not confirmable, or fail to confirm something that is.
- Races between interrupt, a late STT transcript, a late LLM answer and a late TTS chunk. Anything from a
  superseded turn must be discarded; the LLM `fetch` must be aborted; timers cleared; queues bounded.
- Session lifecycle: persistent STT session idle timeout and rotation before the 15-minute cap, reconnect storms,
  commit-on-release drain, heartbeat, socket close codes, and **graceful shutdown on SIGTERM** (docker stop):
  drain or close sessions cleanly, flush metrics, exit within the compose stop grace period.
- Memory: any `Map`, timer, listener or buffer keyed by session or turn that is not cleaned on close or error.
  Unhandled promise rejections and uncaught exceptions: define and test the policy.

**Security (assume a hostile public client)**
- Session tokens: expiry, single use, replay, constant-time comparison, binding to account and origin. Origin
  allowlist behind Caddy. How the client IP is derived behind the proxy: `X-Forwarded-For` spoofing must not
  defeat per-IP limits.
- Size and shape limits on **every** inbound message, including the larger new ones (`draftContext` with
  `products` arrays on each press), binary frame headers and malformed frames (bounds, wrong length, wrong type
  tag). Add a small fuzz test (random bytes and JSON) that must never throw out of the handler or hang.
- Credit guard persistence: if the daily STT-seconds and TTS-characters caps live only in memory, a restart
  resets them. Decide whether to persist (a tiny file is fine) and test it.
- `/metrics` and `/healthz`: nothing sensitive, not exposed publicly beyond what is needed; errors sanitised.
- Supabase broker and gateway account checks: cookies, CSRF/origin check on mutations, the gateway verifying the
  account itself rather than trusting the web tier, behavior when Supabase is slow or down (must fail closed
  without hanging a session), and secrets never in logs or error bodies.
- LLM path: validate output with Zod; transcript and catalog names are untrusted (injection text in a customer
  name must stay data); `OPENAI_BASE_URL` is env-only; a failing or rate-limited provider must degrade to rules.
- `supabase/migrations`: row-level security is owner-only, anon has no access, constraints and indexes are sound,
  the migration is safe to run twice. You cannot run it live: review it and say so.

**Correctness**
- Money: integer rupees, one rounding rule in one place. Add property-style tests for pricing, adjustments (discount,
  GST, round-off), spoken-price basis, payments, reversals and `oldestUnpaidSince` with random sequences. NaN,
  negative, huge and fractional inputs must never produce a wrong total or throw.
- Parser: the new Devanagari folding regexes (`MEDIAL_SCHWA`, `FINAL_YE`) and `INJECTION` must have no
  catastrophic backtracking on a `maxTranscriptLength` string. Fuzz `parseUtterance` with random Unicode: never
  throws, always bounded time, always valid schema output. Check the new intent rules cannot steal an ordinary bill.
- Protocol schemas: unknown keys, version handling, replies of `[]`, `replyText` length limits, `turnId` wrap.

## 5. Phase C: speed (measure, change, measure; revert what does not help)

Only touch what a measurement points at. Targets are goals; never write a latency number you did not measure.
- Hot path: per-frame allocation in the pacer and binary forwarding; per-message `JSON.stringify` and Zod cost,
  in particular re-validating a large `draftContext` on every press; event-loop delay p99 under `pnpm loadtest`.
- Parse: `fold` and `normalize` per token; cache folded keyword sets; confirm the rules parse stays well under 1 ms.
- Catalog sync: do not resend an unchanged snapshot; check the version handshake; cap sizes.
- TTS: phrase cache hit rate (memory LRU plus disk), pre-warm the common phrases (`scripts/warm-phrases.ts`),
  first-byte time, no head-of-line blocking, stale-drop policy.
- **LLM (the largest unexplored win):** (1) send only the few closest candidate product and customer names, not up
  to 120 and 60 names: less latency, fewer tokens, and far less customer data leaves the server; (2) reuse the
  HTTP connection (keep-alive) to the provider and measure whether it lowers the 1.5 s floor; (3) a small
  circuit breaker: after N consecutive timeouts or errors skip the model for a short cooldown, so a sick provider
  never adds its timebox to every unsure sentence; (4) honour provider rate-limit responses with a back-off, since
  the free Gemini tier is limited; (5) keep the system prompt static so provider caching can work. Re-run
  `llm:eval` (ask first) to prove accuracy did not drop and prices never changed. Remember the eval set was used
  to tune the rules, so do not present a rules score on it as held-out.
- Record every before/after in `docs/LATENCY.md` and `docs/BACKEND_REVIEW.md`.

## 6. Phase D: deployment readiness (one EC2 instance, Docker Compose, Caddy)

The goal is that the user can follow `docs/DEPLOY.md` and get a working HTTPS app without surprises.
- **Config parity.** Compare `.env.example`, `apps/gateway/src/config.ts`, `docker-compose.prod.yml` and
  `docs/DEPLOY.md` line by line. Every variable the code reads must be documented and passed through compose
  (Supabase URL and anon key to both web and gateway, `ACCOUNT_AUTH_REQUIRED`, `APP_ORIGIN`,
  `GATEWAY_INTERNAL_URL`, `ALLOWED_ORIGINS`, `SESSION_TOKEN_SECRET`, `DEMO_ACCESS_CODE`, caps, `LLM_*`,
  `OPENAI_*` including `OPENAI_REASONING_EFFORT`). Production must **fail fast** with a clear message on: a short
  or default secret, a non-HTTPS origin, auth required without Supabase settings, missing Gnani key.
- **Compose and images:** health checks, restart policy, memory limits sized for a 2 GB instance, Node heap flag,
  non-root user, multi-stage slim builds, `.dockerignore`, log rotation, stop grace period matching your shutdown,
  and an ordering that starts the gateway before Caddy routes to it.
- **Caddy:** WebSocket proxying works with no idle timeout that kills a held mic, no compression on the audio
  socket, correct `X-Forwarded-*`, HSTS, gzip/br for static files, long immutable cache for hashed assets and
  **no-cache for `sw.js` and the manifest**, request body limits.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, test, build and `pnpm check:bundle`; a `docker compose
  config` validation; a build of both images; `pnpm audit --prod` reported (do not auto-fix by adding packages).
  Reuse the existing scripts; add no new framework.
- **Smoke test:** make `docs/SMOKE_TEST.md` runnable as one script that checks `/healthz`, a WebSocket handshake
  with a valid token against the mock stack, and rejection of a bad origin, a bad token and an oversize message.
- If Docker is available locally, build and run the production compose against mock Gnani and run the smoke
  script. If not, say plainly that it was not run.
- Refresh `docs/DEPLOY.md` and `docs/PRE_DEPLOY_CHECKLIST.md` for auth and LLM variables, and add a short rollback
  and "what to check if the mic does nothing" section.

## 7. Real Gnani (deliberate, ask first)

`docs/LATENCY.md` still has only mock-server numbers for Gnani. Real results are required for the submission.
Do **not** run `pnpm spike` on your own. Prepare it: check `scripts/spike` and its clip README, run
`pnpm spike --dry-run`, state the expected credit use, then **ask the user** for approval and a credit budget.
If they approve, run it once with small inputs, report exactly what was used, and record the real numbers.

## 8. Process and definition of done

- Branch `fix/backend-hardening`. Small Conventional Commits, one root-cause fix per commit with its test. No force-push.
- After each fix run the affected package's tests; before each commit run `pnpm lint && pnpm typecheck && pnpm test`.
- If a fix needs a protocol or frontend change, stop and write it down for the other session.
- Done means: no open critical or high item; every fix has a failing-then-passing test; baseline and after
  numbers are recorded; config parity is clean; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass;
  docs are current; the final report follows AGENTS.md section 14 and ends with the ponytail lines
  (skipped, unverified, risks). **List separately what you could not verify**: the live Supabase migration, real
  Gnani latency, behavior on the real EC2 instance and over mobile data, real iPhone and Android devices.
