# Madhya Pradesh dialects: what is supported

**Short version:** Bol-Bill understands Hindi and Hinglish through Gnani Prisma. For Malwi, Nimadi, Bundeli and Bagheli it adds a small regional word list at the parser layer. **None of that list has been checked by a native speaker yet.** Bhili/Bhilodi is not supported.

## What Gnani supports (docs read 2026-11-08)

- **Prisma (STT)** v2.5 and v3.0 support 10 languages: Hindi (`hi-IN`), English, Bengali, Gujarati, Kannada, Malayalam, Marathi, Punjabi, Tamil and Telugu. v3.0 also takes `indic-auto` or a list of up to 4 codes, and it handles code-mixed speech. **There is no dialect code or dialect model** for Malwi, Nimadi, Bundeli, Bagheli or Bhili. Source: [Supported languages](https://docs.gnani.ai/api/STT/languages.md), [Prisma v3.0](https://docs.gnani.ai/api/STT/models/prisma-v3.md).
- **Timbre (TTS)** speaks the same 10 languages. Replies stay in clear standard Hindi/Hinglish and go through `prepareSpeechText` (see `docs/TTS-TUNING.md`).
- We send `language_code=indic-auto` (from `.env.example`). Whether `hi-IN` alone transcribes MP speech better is **not measured**; `pnpm spike` with MP voice clips would answer it.

## Support levels in the app (Settings → Boli)

| setting | level | what it does |
| :- | :- | :- |
| Auto (default) | full | Gnani Hindi/Hinglish. Only **verified** regional words are added (none yet). |
| Hindi / Hinglish | full | Gnani Hindi/Hinglish, with no regional word list. |
| Malwi | word list, unverified | Hindi model plus the Malwi rows of the lexicon. |
| Nimadi | word list, unverified | Hindi model only for now: no Nimadi rows yet. |
| Bundeli | word list, unverified | Hindi model plus the Bundeli rows. |
| Bagheli | word list, unverified | Hindi model plus the Bagheli rows. |
| Bhili / Bhilodi | not supported | Said plainly in Settings. |

## How it works

`packages/shared/src/dialect/lexicon.ts` is a data table: spoken forms, canonical word, dialects, meaning, `status` and a `note` on where each row came from. On the gateway, `applyDialect(transcript, dialect)` rewrites regional words to the canonical Hinglish before the rule parser and the clarification dialogue see the transcript. The user still sees the words as heard. One spelling slip is tolerated in words of four letters or more (after the same phonetic folding the catalog matcher uses), so STT variants still match. Common Hindi words are never rewritten.

**Safety rule:** an unverified row applies only when the shopkeeper picks that dialect, never on Auto. A wrong row that maps to "haan" could otherwise confirm a bill nobody meant to confirm.

## Current rows (all unverified)

| spoken | canonical | dialects | why it is there |
| :- | :- | :- | :- |
| hau, hao, haau, हौ, हओ | haan | Bundeli, Bagheli, Malwi | Widely reported regional "yes"; not checked for shop use. |
| naiyan, naiya, नइयाँ | nahi | Bundeli | Bundeli "is not"; needs a check that it is used as a plain "no". |

## What we need from you

For each dialect, 10 to 20 real phrases a shopkeeper would say, with the Hindi meaning, or a native speaker to review the rows above. Most useful: "give me / add", "how much", half, one and a half, a quarter, yes, no, udhaar/khata, and common grocery names. Synthetic or self-recorded samples only, never real customers. Each confirmed row gets `status: 'verified'` and a note naming the check (no personal data).
