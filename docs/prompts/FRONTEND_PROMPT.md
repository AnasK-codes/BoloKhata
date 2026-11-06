# Prompt: frontend design, functionality, speed (apple-design + impeccable)

Paste everything below the line into a NEW Claude Code session started in this repository. Run it in its own
git worktree or branch (`feat/frontend-polish`), not on `main`.

---

You are the design lead and senior frontend engineer for **Bol-Bill**, a realtime Hinglish voice-to-bill PWA
for kirana (corner grocery) shops in India. Your job is to make `apps/web` look, feel, perform and behave like a
finished product that is safe to put in front of strangers and film for a public demo.

## 0. Read first, in this order (do not skip)

1. `AGENTS.md` and `CLAUDE.md`: the hard rules. Where this prompt conflicts with them, they win; say so.
2. `README.md` sections on UX, the protocol and the PWA; `docs/STORYBOARD.md` (the 60-second demo you must
   protect), `docs/SMOKE_TEST.md`, `docs/PRE_DEPLOY_CHECKLIST.md`, `docs/LATENCY.md`, `docs/AUTH.md`.
3. The web code: `apps/web/src/components` (VoiceScreen, BillCard, InfoCards, QuickTiles, LedgerScreen,
   CatalogScreen, BillsScreen, SettingsScreen, AccountGate, BottomNav), `apps/web/src/lib` (turn reducer and
   controller, audio, db, voice helpers), `apps/web/src/app` (routes, `globals.css`, layout), `apps/web/public`
   (`manifest.webmanifest`, `sw.js`, `offline.html`, worklets).

## 1. Who this is for (use this as the product context)

- **Users:** kirana shopkeepers and their staff, aged 20 to 60, many with limited English and low-end Android
  phones (360 px wide, 2 to 4 GB RAM, flaky 4G, cracked screens, direct sunlight, greasy hands). Some use iPhone.
- **Speech:** Hinglish; the screen mixes Roman and Devanagari text and rupee amounts.
- **Job to be done:** say a bill, glance at it, confirm in one tap or "haan", move to the next customer. Also look
  up who owes what, and keep the price list. Every second counts because a customer is waiting.
- **Mode (impeccable): Operate.** Scanability, speed, consistency and trust in the numbers beat decoration.
  Ambition shows up as precision and restraint, plus one memorable hero (the mic and the bill animating in).
- **Personality:** warm, direct, trustworthy, quick. Hinglish copy that sounds like a helpful shop assistant,
  never a bank and never a startup.
- **Anti-references:** generic SaaS dashboards, glassmorphism that tanks low-end GPUs, tiny grey text, English-only
  jargon, cartoonish "AI" gradients, anything that needs two hands or a scroll to confirm a bill.
- Working name **Bol-Bill** (branding is not final; do not invent a new name or logo).

## 2. Skills, and how to use them

1. **impeccable** (version in `~/.claude/skills/impeccable`). Follow its Setup exactly: run its `context`
   launcher once, then `init` to write `PRODUCT.md` from the context in section 1 (answer its questions from this
   prompt; ask the user only for facts that are truly missing), then `document` to write `DESIGN.md` from the
   existing code. Then use its commands, in this order, one pass each, reading each command's reference first:
   `audit`, `critique`, `shape` (only for the screens that need rethinking), `layout`, `typeset`, `colorize`,
   `clarify`, `onboard`, `harden`, `adapt`, `animate`, `optimize`, `polish`. Respect its craft floor and its
   absolute bans.
2. **apple-design.** Load its "always load" HIG pages (`accessibility`, `layout`, `typography`, `color`,
   `designing-for-ios`) plus `references/cross-platform.md` (this is a PWA, not native), then the pages for what is
   on screen (buttons, lists and tables, sheets/modality, entering data, dark mode, tab bars, toolbars, alerts,
   searching, SF-symbols-style iconography). Cite `file › heading` for every finding. Where it is your judgment, say so.
3. **How the two combine.** apple-design keeps the app honest against platform conventions and accessibility;
   impeccable keeps it distinctive and finished. **Translate HIG principles, not iOS chrome:** the primary
   audience is a 360 px Android phone, so keep clarity, hierarchy, deference, 44 to 48 pt targets, safe areas,
   Dynamic-Type-style scaling and dark-mode parity, but do not bolt iOS-only patterns or Liquid Glass effects
   onto a PWA that must hold 60 fps on weak phones. If the two skills disagree, choose what is faster for a
   shopkeeper with one free hand, and note the decision in `DESIGN.md`.

## 3. Hard constraints (from the repository; breaking any is a failure)

- Touch only `apps/web` (plus `docs/` and `PRODUCT.md`/`DESIGN.md`). **Do not change** `packages/shared/src/protocol`,
  `apps/gateway`, or any wire format. Another session is changing the backend in parallel.
- **No new dependency without asking** (justify size and need). No analytics, accounts, payments, native app,
  or server database. No new features: you polish and fix what exists. Propose ideas at the end, one or two
  sentences each, and wait.
- Never put keys in client code. Only `NEXT_PUBLIC_` variable is the gateway URL. Synthetic data only.
- Mobile first (360 px), touch targets at least 48 px, high contrast for bright shops.
- **Hot path discipline:** the audio capture and playback worklets and the per-frame code must not gain React
  renders, allocation, JSON or logging. The mic button must not cause per-frame React updates.
- Audio capture and playback must still start from a user gesture (iOS). No audio is sent unless the user is
  pressing or has latched the button, and a recording indicator is always visible.
- The latency HUD is a first-class feature: keep it toggleable and accurate. Never fake a number, transcript,
  timing or "live" claim. Any demo or replay mode stays clearly labelled.
- Every network-facing UI needs loading, empty, offline and error states, and each error says what to do next.
- Nothing is written to the ledger until the user confirms (tap or voice).
- Use `pnpm dev:mock` (mock Gnani) for all realtime work so no credits are spent. Do not run `pnpm dev` against
  real Gnani or call Gemini or Gnani from the browser.
- **Do not create accounts or type passwords.** If you hit the login wall, stop and ask the user to sign in
  inside the browser pane, then continue.

## 4. Phase A: baseline (before changing anything)

1. Run `pnpm install`, then `pnpm lint && pnpm typecheck && pnpm test` and record the result. If red, stop and report.
2. Start `pnpm dev:mock`. Using the built-in browser, capture screenshots of **every screen and state** at
   360x800, 390x844 (iPhone), 768x1024 and 1280x800, in **light and dark**: login/signup, onboarding and business
   profile, Bolo (idle, listening, transcribing, speaking, each draft type: bill, balance, payment, stock,
   add customer, add product, product list, update price, summary), Khata (list, detail, empty, reverse dialog),
   Bills, Samaan (empty, full, form), Settings, offline, error, mic-denied. Save to `docs/screens/before/`.
3. Record performance numbers with real measurements (browser tooling and the repo's own scripts): bundle size via
   `pnpm --filter @bolbill/web build && pnpm check:bundle`, LCP, INP, CLS and long tasks on `/` under 4x CPU
   throttling and slow-4G. Write them in `docs/FRONTEND_REVIEW.md` as the "before" table. Never quote a number you did not measure.
4. Known issues seen in earlier screenshots (verify, do not assume): the page heading on the Bolo screen sits
   flush against, or is clipped by, the top edge at desktop width; the helper line under it is tight against the
   card; the Samaan screen is a very empty wide canvas; confirm and cancel affordances for the newer voice drafts
   (add customer, add product, product list, rate change) must be visible and consistent with the bill's.

## 5. Phase B: audit and a ranked plan

Run impeccable `audit` and `critique`, and the apple-design review, on the Bolo screen first, then the rest.
Write `docs/FRONTEND_REVIEW.md`: a ranked list with **P0** (breaks or embarrasses the 60-second demo, loses data,
fails accessibility basics), **P1** (clearly improves daily use), **P2** (polish). Each item: screen, evidence
(screenshot path or measurement), the guideline cited, the fix, and the effort. Show the plan before the large
changes; fix P0, then P1, then P2, committing in small steps.

## 6. Phase C: what to examine and fix (checklist, not a script)

**The hero (Bolo screen)**
- One unmistakable, thumb-reachable mic control with distinct states: idle, listening (with level feedback that is
  cheap to render), latched, transcribing, speaking, error, disabled/offline. Respect `prefers-reduced-motion`.
- The transcript, parsed bill and spoken reply read as one story. The bill animates in while the voice speaks;
  animate only `transform` and `opacity`; keep 60 fps.
- A single, consistent **confirm / change / cancel** bar for every draft type, reachable one-handed, with
  "haan" and "nahi" shown as hints. Make the saved state obvious and brief.
- Quick tiles ("Jaldi chuno"): good tap targets, horizontal scroll that does not trap the page scroll, clear
  feedback on add, sensible behavior when a draft is waiting.
- Numbers: tabular figures, one rupee format everywhere, large total, udhaar visually distinct without relying
  on colour alone. Unresolved items and ambiguous customers must be impossible to miss and quick to fix.

**Other screens**
- Khata: oldest-first sort, "N din se baaki", WhatsApp reminder button states (no mobile saved, nothing owed),
  statement print, reverse flow. Bills: receipt share and print. Samaan: add/edit, stock, search, and a first-run
  empty state that teaches saying a whole list ("aata 45, cheeni 50..."). Settings: grouped, short, safe actions
  (logout, demo-data reset clearly labelled and confirmed).
- **First-run and empty states** (impeccable `onboard`): a new account starts empty. Design the first minute:
  profile, first products, first bill. The demo-data option must be explicit and labelled.

**Typography, colour, layout**
- Mixed Roman and Devanagari: pick fonts and line heights that render both well on Android (system fonts or
  already-loaded fonts only; no render-blocking webfonts), correct `lang` attributes, no clipped matras.
- Contrast: body text at least 4.5:1, key numbers aim for 7:1 for sunlight; verify in both themes with a
  contrast checker, not by eye. Dark mode is a real theme, not an inversion.
- A small, named token set in `globals.css` (colour, space, radius, type scale, motion). Remove one-off values.
- Layout: safe areas (`viewport-fit=cover`, `env(safe-area-inset-*)`), `100dvh`, keyboard not covering inputs,
  no horizontal scroll at 320 px, sensible desktop layout (the sidebar view exists; make it intentional).

**Accessibility**
- Landmarks, heading order, visible focus, labels for every control, `aria-live` regions for the transcript,
  draft and spoken reply, `role="alert"` for errors, 200% zoom without loss, colour never the only signal,
  44 to 48 px targets, screen-reader pass on the Bolo flow.

**Copy (impeccable `clarify`)**
- Short Hinglish with an English fallback where it helps. One voice. Every error says what to do next. No dead
  jargon ("draft", "snapshot") in user-facing text.

**PWA and resilience (impeccable `harden`)**
- `manifest.webmanifest` (maskable icons, theme and background colour, shortcuts, `display: standalone`),
  `apple-touch-icon` and iOS standalone meta, install prompt, service worker versioning and an in-app "new
  version, tap to refresh" path, `offline.html` that matches the design, offline Khata and Samaan, reconnect
  behavior and a clear offline state on the mic, mic-permission-denied recovery, page-hidden releases the mic.
- Failure drills in the browser: gateway down, slow gateway, mock STT error, TTS unavailable, access-code
  required, session limit, token expiry, IndexedDB blocked or full. Each must land on a clear, recoverable screen.

**Speed (impeccable `optimize`)** measure before and after each change, and revert anything that does not help.
- Bundle: do not exceed the current size, aim to shrink it; lazy-load rarely used screens (Settings, statement,
  forms); no unused icons, polyfills or duplicated helpers.
- Rendering: find avoidable re-renders in `VoiceScreen`, `BillCard` and the live queries (`useLive`); memoise
  deliberately; no work inside the 1-second mic timer beyond what it needs; `content-visibility` and list
  virtualisation only if a list is actually long.
- Targets (goals, to be verified by your measurements on a throttled mid-range profile): LCP under 2.5 s, INP
  under 200 ms, CLS near 0, no long task over 100 ms during a bill animation.
- Service worker: precache only what the shell needs, long-cache hashed assets, never cache `/api/` or audio.

## 6b. Process rules

- Work on branch `feat/frontend-polish`. Small commits, Conventional Commits. No force-push.
- Before each commit run `pnpm lint && pnpm typecheck && pnpm test`. Add or update tests for any logic you touch
  (reducer, draft edit, formatting, repo helpers). Visual work is verified by looking at the rendered result at
  the sizes it ships at; batch your checks.
- Keep `DESIGN.md`, `PRODUCT.md`, `README.md` (UX notes) and `docs/screens/` current. Save after-screenshots to
  `docs/screens/after/`.
- If a change would need a protocol or backend change, **stop and write it down for the backend session** instead
  of making it.
- Time-box: finish all P0 first and report; then P1; stop and list the rest as P2 if time runs short. Do not
  start a redesign you cannot finish: a half-applied design system is worse than the current one.
- Protect the demo: after each batch, replay `docs/STORYBOARD.md` end to end on `pnpm dev:mock`. If the happy
  path regresses, fix it before anything else.

## 7. Definition of done

1. P0 and P1 items fixed; P2 listed. Before/after screenshots and a before/after performance table exist.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm check:bundle` all pass; you report the real output.
3. Every screen has loading, empty, offline and error states; accessibility checks above pass.
4. No secrets, real personal data, per-frame logging, dead code or stray `console.log` in the diff.
5. Final report (AGENTS.md section 14): what changed (files), how to try it, what you ran and the results,
   known gaps, and one suggested next step. **List separately what you could not verify**, in particular:
   real iPhone Safari and low-end Android behavior, real-network speed, mic and audio on real hardware, and
   anything that needed a signed-in session you did not have. Give the user an exact hand-test checklist for those.
