# Frontend review (branch `feat/frontend-polish`)

Status: Phase A partly done, Phase B plan drafted. **No UI code has been changed yet.** Everything below marked "verified" was seen in the running app (`pnpm dev:mock`, built-in browser, 360x800); everything marked "from code" was read in source and still needs a look.

## Baseline

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | all pass (web: 33 files, 433 tests) |
| `pnpm --filter @bolbill/web build` | succeeds |
| `pnpm check:bundle` | passes, but it only scans for leaked secrets, not size |
| Client JS size (`.next/static/chunks`, all chunks) | 321,269 bytes gzip (1,028,496 raw). Largest chunk 71.8 KB gzip |
| FCP / LCP / CLS on `/` | 84 ms / 84 ms / 0.034. **Dev server, unthrottled, warm.** Not a valid LCP/INP/CLS baseline. Redo on a prod build with 4x CPU and slow-4G before quoting. Throttling is not available from the in-app browser tools, so this needs Chrome DevTools or Lighthouse run by you |
| Long tasks on load | none observed (same caveat) |
| Horizontal overflow at 360 px | none (`scrollWidth` 360) |

### Screens captured so far (`docs/screens/before/`)
360x800 light: Bolo idle, Khata (empty), Samaan (empty), Bills (empty), Settings; plus Bolo with dark colour-scheme emulation.
**Not captured, and why:** the draft states (bill, balance, payment, stock, add customer/product, product list, price update, summary), listening/transcribing/speaking, Khata detail and reverse dialog, Samaan full and form. The in-app browser blocks microphone access, so no voice turn can be run in it; the account is also empty. Needs either a dev harness (`/dev/turn` exists, not yet inspected) or your phone/Chrome. 390, 768 and 1280 widths and the login/onboarding screens are also not captured yet.

## Findings

### P0: breaks or embarrasses the demo, or basic accessibility
1. **The mic is below the fold and covered by the nav on first open** (verified, `360x800-light-bolo-idle.jpg`). The heading, helper text and welcome block push "Mic chalu karo" to y≈650 of 800, where the floating nav sits on top of it. A shopkeeper has to scroll to start. Fix: put the mic control in a fixed thumb-zone dock above the nav on mobile, shrink the heading block. Effort M. Guideline: apple-design › layout (primary action in reach), › accessibility (targets not obscured).
2. **No dark theme exists** (verified: dark emulation renders identical light UI; `color-scheme: light` only, `themeColor` is a single value). The brief asks for a real dark theme. Fix: token set with light/dark values. Effort L. apple-design › dark mode, › color.
3. **Invisible text on the payment card** (from code, [InfoCards.tsx](../apps/web/src/components/voice/InfoCards.tsx) `PaymentCard`): "Ab baaki udhaar" amount uses `text-white` on a white `bg-card`. The balance after a payment, the most important number on that card, is unreadable. Fix: ink token. Effort S.
4. **Confirm/cancel affordances are inconsistent across draft types** (from code, `VoiceScreen`): only Confirm/Cancel buttons exist, in the control dock; no "haan"/"nahi" hint, no "Change" action for non-bill drafts, and the add-customer/add-product/product-list/price-update cards explain it only in body prose. Fix: one shared action bar with hints. Effort M.
5. **Misleading overrides in CSS** (from code): `.bg-lime-300` is remapped to near-black, so ~10 "lime" buttons render dark and `text-stone-950` on top of them is dark-on-dark where the override doesn't apply the white text. Verify on the pick-item and customer-picker buttons. Fix: replace with a named `btn-primary` token. Effort S.

### P1: clearly better daily use
6. Page heading + helper take ~500 px of a 800 px phone; the eyebrow, "VOICE WORKSPACE" pill and welcome emblem repeat the same message (verified). Compact on mobile. Effort S.
7. Loading states are bare text ("Account khul raha hai…", "Shuru ho raha hai…") with no spinner or shell (verified). Effort S.
8. Hard-coded hex values and one-off radii throughout `globals.css` (28+ literal colours); no spacing/type/motion tokens. Needed for the dark theme. Effort M.
9. Mixed Roman/Devanagari: font stack is `system-ui, … 'Noto Sans Devanagari'`; `<html lang="en">` only. Check matra clipping with tight `line-height` on headings (1.12). Effort S.
10. Quick tiles: horizontal `overflow-x-auto` row inside a vertically scrolling page; no scroll affordance; `active:scale-95`. Check pull-through on touch. Effort S.
11. Khata and Samaan empty states do not teach the voice phrase ("aata 45, cheeni 50…"). Effort S.
12. Latency/online pill uses colour and text, fine; but `setInterval(…, 300)` polls connection state on the Bolo screen forever. Replace with a subscription if the client exposes one (needs a look; may need a web-side-only change). Effort S.
13. `useLive` re-renders and `VoiceScreen` subscribes to 11 store slices; profile with React tooling before changing. Effort M, measure first.
14. PWA: manifest has no `shortcuts`, no dark `theme_color`; no in-app "new version, tap to refresh" path seen yet (need to read `sw.js`/`PwaRegister`). Effort M.

### P2: polish
15. Desktop: sidebar nav exists; Bolo page uses two columns at 1120 px; Samaan/Khata are narrow centred columns on a wide canvas. Intentional layout pass.
16. Icon set is inline SVG paths in `BottomNav` plus unicode glyphs (▤ ▦ ↗) in the shortcut tiles; unify.
17. Settings is long; group and shorten.
18. Statement/receipt print styles: verify on real device.

## Cannot be verified here (needs you or a device)
Real mic and TTS, iPhone Safari standalone, low-end Android, real-network speed, throttled Core Web Vitals, VoiceOver/TalkBack.

## Proposed order of work
1. **Token foundation** (colour/space/radius/type/motion in `globals.css`, light + dark, remove the `bg-lime-300` override). Fixes P0 #2, #5, #8 and unblocks everything.
2. **Bolo hero layout**: thumb-zone dock for mic + one shared confirm/change/cancel bar with "haan/nahi" hints; compact heading. P0 #1, #4, #6.
3. **PaymentCard contrast** and a contrast check of all numbers in both themes. P0 #3.
4. P1 copy/empty/loading states, PWA update path, manifest, then P2.

Each step: lint + typecheck + test, then replay `docs/STORYBOARD.md` on `pnpm dev:mock`.
