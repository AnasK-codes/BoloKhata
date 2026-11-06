# Deploying Bol-Bill on one small AWS instance

This guide is written for someone who has never deployed a server. You will create **one virtual machine (EC2)**, run **three Docker containers** on it, and point a web address at it. Nothing here has been run on your AWS account yet, and AWS prices and Free Plan rules change: wherever this guide quotes an AWS limit, confirm it in the console first. Items marked **(verify)** are the ones I could not check for you.

```
phone ──HTTPS/WSS──►  Caddy :443 (TLS)  ──/ws /session /healthz──►  gateway :8080 ──► Gnani (Prisma, Timbre)
                                        └─everything else────────►  web :3000
```

Same origin: the app is `https://YOUR.DOMAIN`, the realtime socket is `wss://YOUR.DOMAIN/ws`. Account tokens use Secure, HttpOnly cookies on the web server; the browser requests `/api/account/gateway-session` before connecting directly to `/ws`. The gateway still checks `ALLOWED_ORIGINS` and independently verifies the Supabase account/business profile. Complete [AUTH.md](AUTH.md) before deployment and set `ACCOUNT_AUTH_REQUIRED=true`. The web container receives only Supabase settings, while Gnani/LLM keys remain gateway-only.

## 0. What you need first

- An AWS account on the Free Plan, with a user you can sign in with (not for daily use as root: use the root user only to create your own admin user if you have not yet).
- Your Gnani API key (never paste it into chat, a screenshot or the repo).
- A web address pointing at the instance. Two options:
  - **A domain you own** (best). You will add one DNS "A record".
  - **No domain:** use `<ip-with-dashes>.sslip.io`, for example `13-233-1-2.sslip.io` for IP `13.233.1.2`. It is a free third-party service that resolves such names to that IP, and Let's Encrypt will issue a certificate for it **(verify: sslip.io is shared, so Let's Encrypt rate limits can occasionally block you; a domain you own avoids this)**.
- Your own public IP, for the SSH rule (search "what is my ip").

## 1. Choose the instance (Mumbai)

- **Region:** Asia Pacific (Mumbai) `ap-south-1`, top right of the console. This is a starting point, not a measured choice: run `pnpm measure-rtt` (section 11) from the instance before the demo and compare with other regions if you can.
- **Type:** `t3.small` (2 vCPU, 2 GB RAM, x86_64). On the Free Plan only some types are allowed **(verify)**: in the launch wizard, choose a type that is labelled **Free tier eligible**. If `t3.small` is not labelled, take the eligible type with at least 2 GB RAM. `t3.micro` (1 GB) is too small to build the web image without a lot of swap.
- Want a cheaper ARM instance (`t4g.small`, arm64)? The same Dockerfiles work: build on the instance itself (section 6) and choose an **arm64** Ubuntu AMI. Do not mix: images built on x86 do not run on arm.

## 2. Create everything in the console

Resources you will create (you will delete exactly these at the end, section 12): **1 EC2 instance, 1 EBS volume (comes with the instance), 1 security group, 1 key pair, 1 Elastic IP, 1 budget (and optionally 1 IAM role + instance profile for Bedrock, and 1 SSM parameter).**

1. **Key pair.** EC2, Key pairs, Create key pair: name `bolbill`, type ED25519, `.pem`. It downloads once. On your computer: `chmod 400 ~/Downloads/bolbill.pem`.
2. **Security group.** EC2, Security groups, Create:
   - Name `bolbill-sg`, in the default VPC.
   - Inbound rules: **HTTP 80** from `0.0.0.0/0`; **HTTPS 443** from `0.0.0.0/0`; **Custom UDP 443** from `0.0.0.0/0` (HTTP/3, optional); **SSH 22** from **My IP** only.
   - Outbound: leave the default (all). The gateway needs to reach `api.vachana.ai` over 443.
   - Do **not** open 8080 or 3000. Only Caddy faces the internet.
3. **Launch the instance.** EC2, Launch instance:
   - Name `bolbill`. AMI: **Ubuntu Server 24.04 LTS**, 64-bit (x86). Type: from section 1. Key pair `bolbill`. Security group `bolbill-sg`.
   - Storage: **20 GiB gp3** (the Next build and Docker images need room; 8 GiB is too tight). The Free Plan covers a limited amount of EBS **(verify)**.
   - Advanced details: **Metadata version: V2 only**. If you will use Bedrock (section 9), set **Metadata response hop limit: 2** here (containers need the extra hop to reach the instance role).
4. **Elastic IP** (so the address survives a restart). EC2, Elastic IPs, Allocate, then Associate with the instance. Public IPv4 addresses are billed hourly, in use or not **(verify current price; the Free Plan credits are meant to cover it)**. Write the IP down.
5. **Point your address at it.** With a domain: add an `A` record `YOUR.DOMAIN -> the Elastic IP` at your DNS provider (TTL 300). With sslip.io: nothing to configure; use the dashed IP name.

## 3. Budget alarm (do this before anything else costs money)

Billing and Cost Management, Budgets, Create budget, **Zero spend** or **Monthly cost** budget: set `5 USD` (or less), add your email, alert at 50% and 100%. Also bookmark **Billing, Credits** to watch the Free Plan credit balance, and **Billing, Free Tier** for usage. Remember: **the Free Plan ends after 6 months or when the credits run out, whichever is first.** The instance must keep running through the challenge's evaluation period (after the Nov 10, 2026 deadline): check the credit balance on the day you submit and set a calendar reminder for the end date. If the account closes to paid, the instance stops and the live link dies.

## 4. Connect and install Docker

```bash
ssh -i ~/Downloads/bolbill.pem ubuntu@YOUR.ELASTIC.IP
```

On the instance:

```bash
# Docker Engine + the compose plugin, from Docker's official convenience script
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
docker --version && docker compose version

# 2 GB of swap: the Next.js build can run out of memory on a 2 GB machine
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Get the code and create the `.env`

```bash
git clone https://github.com/umangjain2805/BoloKhata.git bolbill && cd bolbill
cp .env.example .env
chmod 600 .env
nano .env
```

Set these (everything else can stay at the defaults):

| Variable | Value |
|---|---|
| `DOMAIN` | `YOUR.DOMAIN` (no `https://`) |
| `ACME_EMAIL` | your email (Let's Encrypt expiry notices) |
| `GNANI_API_KEY` | your key. Only the gateway receives it; the web container receives only the explicitly listed Supabase settings |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | the same configured project for web and gateway; run the SQL in AUTH.md first; never use a service-role key |
| `ACCOUNT_AUTH_REQUIRED` | `true` for deployment |
| `GNANI_STT_URL`, `GNANI_TTS_URL` | leave the real defaults from `.env.example` |
| `SESSION_TOKEN_SECRET` | a long random string: `openssl rand -hex 32` |
| `METRICS_TOKEN` | another random string (lets you read `/metrics` from the instance) |
| `DEMO_ACCESS_CODE` | optional; shown to people you invite |
| `MAX_SESSIONS`, `DAILY_STT_SECONDS_CAP`, `DAILY_TTS_CHARS_CAP` | your credit protection. Start small |
| `LLM_PROVIDER` | `none` (the app works fully without a model). For Gemini: `openai-compatible` with `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY` and optionally `OPENAI_REASONING_EFFORT` (`docs/LLM.md`, measured numbers in `docs/LATENCY.md`) |
| `LLM_TIMEOUT_MS` | `1200` by default; the Gemini free tier measured a floor of about 1.5 s from a laptop, so `2500` if you use it |

`ALLOWED_ORIGINS`, `PORT`, `TRUST_PROXY`, `GNANI_TTS_CACHE_DIR` and `CREDIT_USAGE_FILE` are set for you by `docker-compose.prod.yml`. The daily credit counters are kept in `/data/tts-cache/credit-usage.json` on the cache volume, so a restart or redeploy does **not** reset the caps (`docker compose down -v` deletes the volume and does).

The images run with `NODE_ENV=production`, and the gateway refuses to start (with a message naming the variable) on: a `SESSION_TOKEN_SECRET` shorter than 32 characters or still the `replace-...` placeholder, the `replace-me` Gnani key, an `ALLOWED_ORIGINS` entry that is not `https://`, `ACCOUNT_AUTH_REQUIRED=true` without both Supabase settings. `docker compose logs gateway` shows which. `NEXT_PUBLIC_GATEWAY_URL` is also set by it (to `https://$DOMAIN`) when it builds the web image.

**Prefer not to keep the key in a file?** Store it in SSM Parameter Store (Standard tier is free): Systems Manager, Parameter Store, Create parameter, name `/bolbill/GNANI_API_KEY`, type `SecureString`. Give the instance a role with `ssm:GetParameter` on that name and `kms:Decrypt` for the default key, and write `.env` at boot from it: `aws ssm get-parameter --name /bolbill/GNANI_API_KEY --with-decryption --query Parameter.Value --output text`. This adds an IAM role, so do it only if you want it; `chmod 600 .env` on an instance only you can SSH into is acceptable for this project.

## 6. Start it

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

The first build takes several minutes. Then:

```bash
docker compose -f docker-compose.prod.yml ps          # all three: running / healthy
curl -s https://YOUR.DOMAIN/healthz                    # {"ok":true,"version":"..."}
```

Caddy needs ports 80 and 443 reachable and your DNS record to be live to get the certificate (a minute or two). If `ps` shows Caddy restarting or the browser warns about the certificate, read the Caddy logs (section 8).

## 7. Verify like a user

1. On the instance: `curl -s -o /dev/null -w '%{http_code}\n' https://YOUR.DOMAIN/` should print `200`.
2. On your computer: open `https://YOUR.DOMAIN` in Chrome. The pill should say **Online**.
3. **On a real phone, over mobile data (not Wi-Fi):** open the address, allow the microphone, hold the mic and say "Sharma ji ko do kilo aata, udhaar likh do". You should see the bill and hear the reply. This proves WSS from an HTTPS page works end to end. (A WebSocket that works on Wi-Fi but not on mobile data usually means a carrier proxy: tell me the symptom.)
4. Install it: Chrome menu, "Install app" (Android), or Share, "Add to Home Screen" (iPhone).
5. Operator view of credits and health (the public never sees this; `/metrics` is not routed by Caddy, so you read it from inside the gateway container):
   ```bash
   docker compose -f docker-compose.prod.yml exec gateway node -e \
     "fetch('http://127.0.0.1:8080/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
   ```
   Look at `credits.stt_seconds_remaining`, `credits.tts_chars_remaining`, `activeSessions` and `runtime`.
6. Server smoke test from your laptop (no audio, no credits): `pnpm smoke --url https://YOUR.DOMAIN`. With account auth on, the token checks need a signed-in user's access token in `SMOKE_BEARER` (never commit it); without it they are reported as skipped and the rest still runs.
7. Run the pre-submission checklist in `docs/SMOKE_TEST.md`.

## 8. Everyday operations

```bash
cd ~/bolbill
docker compose -f docker-compose.prod.yml logs -f --tail=100 gateway   # gateway (timings and error codes only; no transcripts)
docker compose -f docker-compose.prod.yml logs --tail=100 caddy        # certificate and proxy problems
docker compose -f docker-compose.prod.yml logs --tail=100 web
docker stats --no-stream                                               # CPU and memory per container
docker compose -f docker-compose.prod.yml restart gateway              # graceful: clients are told, then reconnect
```

Logs rotate automatically (10 MB x 3 files per container).

**Update to a new version**

```bash
cd ~/bolbill
git pull
git log --oneline -3                       # note the commit you are leaving, in case you need to roll back
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

`up -d` replaces each changed container; the gateway gets `SIGTERM` and has up to 30 s to drain, telling connected phones to reconnect (they do, within seconds). Changed `NEXT_PUBLIC_GATEWAY_URL` or `DOMAIN`? That needs the same command (the web image is rebuilt).

**If the mic does nothing**

Check in this order; each step names what it rules out.
1. The pill says **Online**? If not, `curl -s https://YOUR.DOMAIN/healthz`; if that fails, `docker compose -f docker-compose.prod.yml ps` and the Caddy logs (certificate, DNS, ports 80/443).
2. The browser asked for the microphone? It only does on HTTPS. On iPhone: Settings, Safari, Microphone; on Android: the site settings. A denied permission shows "Mic ready nahi hai".
3. A "busy", "budget" or "rate limited" message? Read `/metrics` (section 7, step 5): `activeSessions` against `MAX_SESSIONS`, and `credits.*_remaining`. The caps reset at midnight IST.
4. A "login" or "business profile" error? The account check failed: `docker compose logs gateway` shows `account_service_unavailable` when Supabase is slow or down, and the web and gateway `SUPABASE_*` values must be the same project.
5. Online, no error, but no transcript? `docker compose logs gateway | grep -i stt` for an upstream error code (wrong key, Gnani down, concurrency limit). `pnpm measure-rtt --label ec2-mumbai` checks the network to Gnani without spending credits.
6. Transcript but no voice? Tap once on the page first (iOS starts audio only after a gesture), check the phone is not on silent, and look for `TTS_UNAVAILABLE` in the gateway logs.

**Roll back**

```bash
cd ~/bolbill
git log --oneline -5                       # pick the last good commit
git checkout <good-commit>
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

(`git checkout main` later to get back on the latest.) The `.env` is not in git, so it is untouched.

## 9. Optional: Bedrock for the language-model fallback

The app works fully with `LLM_PROVIDER=none`. Only do this if you want the model fallback and you have verified Bedrock works for your account (`docs/LLM.md`: model access, region, quotas; I have not verified any of it).

1. IAM, Roles, Create role, **AWS service: EC2**. Attach **no** managed policy yet. Name `bolbill-bedrock`.
2. Add an inline policy (replace the ARN with the exact model or inference profile you chose in the Bedrock console):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "bedrock:InvokeModel",
       "Resource": "arn:aws:bedrock:ap-south-1::foundation-model/YOUR-MODEL-ID"
     }]
   }
   ```
   (For an inference profile, the resource is the profile's ARN, and the underlying model ARNs may also be needed: copy what the console shows.)
3. EC2, Instances, select, Actions, Security, **Modify IAM role**, choose `bolbill-bedrock`. No access keys are ever created or stored.
4. The instance metadata hop limit must be **2** (section 2, step 3), or containers cannot read the role's credentials. For an existing instance: `aws ec2 modify-instance-metadata-options --instance-id i-... --http-put-response-hop-limit 2 --http-tokens required`.
5. In `.env`: `LLM_PROVIDER=bedrock`, `AWS_REGION=ap-south-1`, `BEDROCK_MODEL_ID=...`. Then `docker compose ... up -d`. Check with `docker compose -f docker-compose.prod.yml exec gateway node -e "..."` or simply say something unusual and watch for `source: llm` in the HUD.

## 10. Stop everything to save credits

- **Pause (keeps your data and Elastic IP):** EC2, Instances, Instance state, **Stop**. A stopped instance does not bill for compute; the volume and the Elastic IP may still use credits **(verify)**. Start it again when needed; containers restart by themselves (`restart: unless-stopped`).
- **Pause just the app:** `docker compose -f docker-compose.prod.yml down` (keeps volumes), `up -d` to resume.

## 11. Measure the network to Gnani from here

```bash
# on the instance, inside the repo (needs Node 22 + pnpm; or run it on your laptop for comparison)
pnpm install && pnpm measure-rtt --label ec2-mumbai --samples 15
```

It measures DNS, TCP connect, TLS and first byte to `api.vachana.ai` with **no API key and no credits**. Compare `tcpConnectMs` p50 between your laptop and the instance (and another region if you try one). Do not write a latency claim anywhere until you have measured it.

## 12. When the challenge is over: delete everything

1. EC2, Instances: **Terminate** `bolbill` (this deletes its EBS volume).
2. EC2, Elastic IPs: **Disassociate** then **Release** the address (an unattached Elastic IP keeps billing).
3. EC2, Security groups: delete `bolbill-sg`. EC2, Key pairs: delete `bolbill`.
4. IAM (if you made it): detach the role from the instance first, then delete role `bolbill-bedrock` and its instance profile.
5. Systems Manager (if you made it): delete parameter `/bolbill/GNANI_API_KEY`.
6. Budgets: delete the budget (or keep it as a safety net).
7. DNS: delete the `A` record at your DNS provider. **Rotate your Gnani API key** if it was ever on a shared screen.

## 13. Pre-deploy checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass; `pnpm build` passes.
- [ ] `pnpm --filter @bolbill/web build && pnpm check:bundle` prints OK (no secrets or server-only imports in the browser bundle; only `NEXT_PUBLIC_GATEWAY_URL` is public).
- [ ] `.env` is `chmod 600`, not in git (`git status` is clean of it), and contains a fresh `SESSION_TOKEN_SECRET`.
- [ ] `ALLOWED_ORIGINS` is not edited by hand (compose sets it to `https://$DOMAIN`).
- [ ] Caps in `.env` are small enough that a public link cannot burn your credits (`MAX_SESSIONS`, `DAILY_*`, rate limits).
- [ ] Section 7 passed on a real phone over mobile data, on Android and iPhone.
- [ ] Budget alarm exists; credit balance noted; evaluation-period end date in your calendar.

## What you must do by hand in the AWS console

1. Create the key pair, security group (80/443 open, SSH from your IP), instance (Ubuntu 24.04, free-tier-eligible type, 20 GiB gp3, IMDSv2), and Elastic IP.
2. Create the budget and look at the Credits page.
3. Add the DNS record (or choose sslip.io).
4. Optional: the Bedrock role and the instance-metadata hop limit.
5. Everything else is commands on the instance, in this file.
