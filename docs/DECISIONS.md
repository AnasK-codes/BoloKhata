# Decisions (hardening pass, unattended)

Autonomous decisions made while the owner was away. Format: what, why, alternative rejected. The report (`HARDENING_REPORT.md`) lists the ones to double-check first.

## D-1 Skills used
Loaded and followed: `ponytail` (smallest complete change, a test for every non-trivial branch, state what was skipped), `thermo-nuclear-code-quality-review` (severity-ranked finding table, no ad-hoc conditionals, file-size limit). The brief also named `pstack`, `impeccable` and "apple design": see D-2.
- Why: the brief required it. Alternative rejected: describing the style without loading the skills.

## D-2 Skills not used
`pstack` is not installed as a reviewer; the only match is `setup-pstack`, an installer, which I did not run because it changes the machine's configuration. Whatever `impeccable` / `apple-design` / `hig-*` could not be loaded in this phase is noted in Phase 4 below.
- Why: never claim a skill that was not used. Alternative rejected: running `setup-pstack` to "have used" pstack.

## D-3 Branch
All work is on `chore/hardening-pass`, off `main` at the end of the previous session. Nothing is pushed.

## D-4 Skill loading (updated)
`impeccable` and `apple-design` were loaded. impeccable's launcher (`scripts/impeccable context`) downloads a binary on first run; I did not run it unattended (downloading and executing an unreviewed binary breaks the "no untrusted downloads" rule). I followed its documented fallback: read its `craft-floor.md` and the references directly, and PRODUCT.md/DESIGN.md do not exist in this repo. From apple-design I used the principles and the lenses (accessibility, conventions, craft, interaction, writing) but loaded only the skill text, not the `references/hig` pages, so I do not cite specific HIG pages. `pstack`: see D-2.

## D-5 Proxy trust uses named private ranges, not a hop count
`TRUST_PROXY=true` now sets Fastify `trustProxy` to `['loopback','linklocal','uniquelocal']`. A numeric hop count (1) was tried first and measured: it returned the socket address for every request, which would have collapsed all clients into one rate-limit bucket. Named ranges trust only a private-address proxy (Caddy on the Docker bridge) and take the first public address from the right of `X-Forwarded-For`. Rejected: `true` (trusts the client-controlled leftmost entry) and the hop count (measured wrong). Test: `demoGuard.test.ts` "uses the address the proxy appended...".

## D-6 Udhaar with no customer is not confirmable (behaviour change)
A bill with udhaar but no customer used to be savable and wrote no ledger entry (the debt vanished). Now neither the gateway (no voice confirm, spoken ask "Udhaar kiska likhun?") nor the browser (no Confirm) offers to save it until a customer is chosen; fully paid bills with nobody named still save. Shared helper `udhaarNeedsCustomer`. No protocol change: the draft already carries `customer`, `bill` and `warnings`; only the text of a warning and reply changed. Rejected: auto-creating an "Unknown" customer (would pollute the ledger).

## D-7 Access code
Added a small entry form and `localStorage` persistence for `DEMO_ACCESS_CODE` because the gateway required it but the app could not send it. `RealtimeClient.connect()` now retries from the `blocked` state (needed to try a new code); the page-lifecycle wake-up still never retries `blocked`. No protocol change (the code was already part of `POST /session`).

## D-8 Parser changes
Trailing known-customer detection and "hata do" = cancel, both in `packages/shared`. Customers are recognised at the end of a sentence only if they match the catalog (so an item can never be taken for a customer); unknown new customers must still be named first. "Sharma ji ka bill cancel kar do" (named cancel) deferred (R-10): treating any sentence containing "cancel" as cancel risks cancelling by accident.

## D-9 Light and dark themes
All colours are CSS tokens; light follows `prefers-color-scheme`. There is no in-app toggle (Apple: follow the system). The Tailwind token is named `canvas` because `base` collided with `text-base`.

## D-10 Bundle and hot path: nothing more changed
The seed catalog and the dev test tone now load lazily (measured -2.2 KB gzip on `/`, about 0.8%). Splitting the realtime stack out of the secondary screens was rejected: it only helps routes nobody opens first and risks the live flow. No gateway hot-path change: the 20x120 mock soak showed p99 event-loop delay of about 1.2 ms and flat heap; there is nothing measured to optimise (ponytail: do not optimise without evidence).

## D-11 Screenshots without Playwright
Playwright is not a dependency and installing it downloads browsers, so `scripts/screenshots.mjs` drives the installed Chrome over the DevTools protocol with Node's built-in WebSocket (no new dependency). Run in development with `?tone=1`, so every capture carries the "SYNTHETIC TEST TONE" banner: they are documentation of the UI states against the mock servers, not marketing images. Not captured: "demo busy" and "microphone permission denied" (they need a gateway at capacity or a browser permission prompt; the states are covered by unit tests and described in `errorText.ts`).

## D-12 Caddy residual token logging
The access log redacts `?token=`, but when the gateway is down Caddy's reverse-proxy error log includes the request URI. The token is single-use and expires in 120 s, so the exposure is small; accepted and documented (R-06).

## D-13 Compose stack tested outside the repo
The production compose file was run locally (images built, Caddy on `localhost` with its internal CA, gateway pointed at the mock servers via `host.docker.internal`) from a temporary directory in the home folder with a throwaway `.env` of fake values. The repo's real `.env` was never read or used. The mock CLI got a `MOCK_HOST` option so containers can reach it.
