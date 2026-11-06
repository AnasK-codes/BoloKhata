# Product

<!-- impeccable:product-schema 1 -->

> Source: the user's frontend-polish brief (docs/prompts/FRONTEND_PROMPT.md) plus AGENTS.md and README.md. Nothing here was invented; open decisions are marked.

## Platform

web

## Users
Kirana (corner grocery) shopkeepers and their staff in India, aged 20 to 60. Many have limited English and low-end Android phones (360 px wide, 2 to 4 GB RAM, flaky 4G, cracked screens, direct sunlight, greasy hands). Some use iPhone. A customer is usually waiting at the counter.

Job to be done: say a bill in Hinglish, glance at it, confirm in one tap or "haan", move to the next customer. Also look up who owes what (udhaar) and keep the price list.

## Product Purpose
Bol-Bill is a realtime Hinglish voice-to-bill PWA. Hold the mic and speak; the bill animates in while a Gnani Timbre voice reads it back; the shopkeeper confirms; the ledger is saved locally. Success is a bill confirmed in seconds with numbers the shopkeeper trusts. Built for the Great Indian AI Internship Challenge (Gnani AI); the public 60-second demo video drives shortlisting.

## Positioning
Voice-first billing and udhaar tracking in the shopkeeper's own mixed Hindi-English speech, local-first and usable offline for the ledger. Prices, totals and balances are computed by deterministic code, never by the model.

## Operating Context
Shop counter, bright light, one free hand, noisy surroundings, mobile data. Installable PWA. Screens: Bolo (voice), Khata (customer ledger), Bills, Samaan (catalog), Settings. Text mixes Roman and Devanagari and rupee amounts.

## Capabilities and Constraints
- Gateway-only calls to Gnani Prisma (STT) and Timbre (TTS); browser never holds keys.
- Nothing is written to the ledger until the user confirms (tap or voice).
- Mic audio only sent while pressing or latched; recording indicator always visible.
- Latency HUD is a first-class, toggleable feature; no faked numbers; any demo/replay mode is labelled.
- Money is integer rupees. Mobile first at 360 px, touch targets at least 48 px, high contrast.
- Working name Bol-Bill; final branding is undecided (open decision).

## Brand Commitments
Name Bol-Bill (working). Voice: warm, direct, trustworthy, quick; Hinglish that sounds like a helpful shop assistant, never a bank and never a startup.

## Evidence on Hand
Synthetic seed data only (Sharma ji, Verma ji). No testimonials, user counts or benchmarks exist; do not fabricate any. Measured latency lives in docs/LATENCY.md.

## Product Principles
1. The numbers are the product: total, udhaar and balance must be unmissable and unambiguous.
2. One hand, one tap: every draft type has the same confirm / change / cancel bar within thumb reach.
3. Speed is felt: cheap animation (transform and opacity), no per-frame React work.
4. Honest by default: nothing fake, nothing saved unconfirmed, errors always say what to do next.
5. Restraint over decoration: no glass, no gradients that tax weak GPUs.

## Accessibility & Inclusion
Body text at least 4.5:1, key numbers aim for 7:1 for sunlight. Targets 44 to 48 px. Prefers-reduced-motion respected. Colour never the only signal. Roman plus Devanagari must render without clipped matras. Screen-reader friendly Bolo flow with aria-live regions.
