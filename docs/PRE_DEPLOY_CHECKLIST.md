# Pre-deploy checklist: what only you can do

Everything the repository can check is already checked (see `HARDENING_REPORT.md`). These steps need your accounts, your phone or your voice. Follow `docs/DEPLOY.md` for the commands; this is the short list of manual actions, in order.

## 1. Before you touch AWS
- [ ] Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` on your machine: all green.
- [ ] `pnpm --filter @bolbill/web build && pnpm check:bundle` prints OK.
- [ ] Decide the public address: a domain you own (best) or `<dashed-ip>.sslip.io` (third-party, see DEPLOY.md).
- [ ] Decide whether the demo needs an access code (`DEMO_ACCESS_CODE`). The app now asks visitors for it.
- [ ] Decide the caps in `.env`: `MAX_SESSIONS` (3 is a sensible start), `DAILY_STT_SECONDS_CAP`, `DAILY_TTS_CHARS_CAP`, per-IP and global session rates.

## 2. AWS console (nothing was run for you)
- [ ] Billing: create an **AWS Budget** (5 USD or less, email alerts at 50% and 100%); open **Billing, Credits** and write down the credit balance and expiry.
- [ ] EC2: create the **key pair**, the **security group** (80 and 443 open, 22 from your IP only), and the **instance** (Ubuntu 24.04, a *Free tier eligible* type with at least 2 GB RAM, 20 GiB gp3, IMDSv2). Allocate and attach an **Elastic IP**.
- [ ] DNS: add the `A` record to the Elastic IP (or use the sslip.io name).
- [ ] Optional: the Bedrock IAM role (only after you verified model access; the app works without it).
- [ ] Write down every resource you created (DEPLOY.md section 12 lists them) so you can delete all of them later.

## 3. On the instance
- [ ] Install Docker and add swap (DEPLOY.md section 4).
- [ ] `git clone`, then create `.env` from `.env.example`, `chmod 600 .env`. Put **your real Gnani key** in it yourself, set `DOMAIN`, `ACME_EMAIL`, a fresh `SESSION_TOKEN_SECRET` (`openssl rand -hex 32`; the gateway refuses a short one or the placeholder) and `METRICS_TOKEN`. Never paste the key into chat or commit it.
- [ ] `docker compose -f docker-compose.prod.yml --env-file .env up -d --build`; all three containers healthy.
- [ ] `https://YOUR.DOMAIN/healthz` answers; the padlock is valid.
- [ ] From your laptop: `pnpm smoke --url https://YOUR.DOMAIN` passes (add `SMOKE_BEARER` with a signed-in user's access token to include the token checks).
- [ ] Supabase: run the migration (safe to rerun), set the Auth Site URL to `https://YOUR.DOMAIN`, and use the same `SUPABASE_URL`/`SUPABASE_ANON_KEY` for web and gateway.
- [ ] If you use Gemini: `LLM_PROVIDER=openai-compatible`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`, optional `OPENAI_REASONING_EFFORT`, and `LLM_TIMEOUT_MS=2500`. A provider that times out three times in a row is skipped for 30 s, so rules answer at once.

## 4. Real Gnani, once, deliberately
- [ ] Record the 10 spike clips (`scripts/spike/clips/README.md`) with fictional names.
- [ ] `pnpm spike --dry-run`, then `pnpm spike --label laptop` (spends credits), and again later from the instance with `--label ec2-mumbai`. Commit the real `docs/LATENCY.md`.
- [ ] `pnpm measure-rtt --label ec2-mumbai` from the instance (no key, no credits).

## 5. Real phone, mobile data (not Wi-Fi)
- [ ] iPhone Safari **and** Android Chrome: open the live HTTPS link, allow the microphone, run `docs/SMOKE_TEST.md` end to end.
- [ ] Install the app to the home screen on both; check offline Khata and Samaan.
- [ ] Hold the mic in a noisy room with each Settings mic option; pick the best defaults and note them (`docs/TESTING.md` section 5).
- [ ] Check dark and light appearance on the phone, and bright-sunlight legibility of the bill.

## 6. Record and post (post by Nov 7, submit by Nov 9, hard deadline Nov 10 11:59 PM IST)
- [ ] Follow `docs/STORYBOARD.md` on a real phone over mobile data; only fictional names; no test-tone banner.
- [ ] Fill every `[FILL]` in `docs/SUBMISSION.md` and every `[...]` in `docs/POSTS.md` from your own measurements; confirm the `@GnaniAI` handle.
- [ ] Reconcile the team table (README section 23 names a member who is not in the git history).
- [ ] Post, then submit. Keep the instance and the Free Plan credits alive through the evaluation period.

## 7. After the challenge
- [ ] Delete every AWS resource (DEPLOY.md section 12) and rotate the Gnani key.
