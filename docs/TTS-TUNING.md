# TTS tuning: pronunciation of nasal words

**Status (2026-11-08): clips made, not yet judged by ear.** No spelling has been changed in the app. Winners go into `PRONUNCIATION_OVERRIDES` in `packages/shared/src/tts/prepareSpeechText.ts` only after a person listens, and each one is recorded in the table below.

## The problem

We send romanised Hinglish to Timbre ("Save kar dun?"). In Hindi, दूँ, हाँ, हैं and में end in a **nasal vowel**, which our Latin spelling writes as a trailing "n". Two were heard as a hard "n" consonant (confirmed by ear, 2026-11-08):

| spelling sent | heard | should be |
| :- | :- | :- |
| `kar dun` ("Save kar dun?") | "kardunn", a hard n at the end | a soft nasal "kar dū̃" |
| `haan` ("Haan bolo ...") | हान (hān), a hard n consonant | हाँ, a nasal vowel |

## Known bad spellings (do not reintroduce)

- `kar dun` in Latin script: hard trailing n.
- `haan` in Latin script: heard as हान.

Both are listed in `KNOWN_BAD_SPELLINGS`; a test fails if either is neither fixed by an override nor listed as awaiting listening.

## What the Gnani docs say (read 2026-11-08)

Sources: [Text Normalization Guide](https://docs.gnani.ai/api/TTS/tts-input-formating.md), [Realtime TTS](https://docs.gnani.ai/api/TTS/tts-websocket.md), [Voices](https://docs.gnani.ai/api/TTS/available-voices.md), [Audio tags](https://docs.gnani.ai/api/TTS/tts-audio-tags.md).

- **Script.** With `language: auto`, the dominant script picks the normalisation profile: Devanagari resolves to Hindi, Devanagari mixed with Latin to "Hinglish (code-mixed)", and text with no Indic script to English. We send `hi-IN` explicitly, so this rule does not decide our case. **How Timbre pronounces Latin-script Hindi under `hi-IN` is not documented.**
- **Anusvara, chandrabindu, nukta, virama.** Nothing documented. There is no pronunciation, phoneme or SSML control.
- **Controls that exist.** `speed` from 0.85 to 1.15. On Timbre v3.0, inline audio tags such as `<pauses>` and `<slow>`. Our sanitiser strips angle-bracket text, so tags cannot come from user data.
- **Voices.** v3.0 has 13 voices and every one speaks all 10 languages (we use Devansh). v2.5 voices each have one preferred language; Hindi has 13 voices, and **Poorvi is the one voice listed for Hinglish (`hi-en`)**. That is worth an A/B if Devanagari does not fix things.
- **Numbers and currency.** Normalised automatically (`₹599`, `2,40,000` in lakh grouping). Units such as `kg` are always read in English. We already send amounts as spoken Hindi words; that stays, because a Latin-only "42" would be read in English under `auto`.
- **Language code mismatch.** The normalisation page lists `hi`; the websocket page lists `hi-IN`. We send `hi-IN`, and it works.
- **Not documented, observed:** every request ends with **two** `complete` messages (one with `chunk_index` N, one with `chunk_index: null`). This broke sequential requests (fixed in `ttsLink` and the spike client; see the commit "fix(tts): Gnani sends complete twice").

## How the clips were made

`pnpm spike --only P --label tts-ab` (opt-in; a full spike run never includes it). It uses the gateway's settings (`timbre-v3.0`, `Devansh`, `hi-IN`, 24 kHz raw PCM saved as WAV) and sends one request at a time on one socket. The output is in `scripts/spike/results/<run>/pronunciation/` (gitignored): `LISTENING.md` and `LISTENING.html` (a player per clip) next to the WAV files. Clip A is always today's spelling.

| run | characters sent | clips | result |
| :- | :- | :- | :- |
| 2026-11-08 14:18 UTC | 1,110 | 36 of 72 | **Discarded.** The duplicate `complete` shifted every clip by one, so the files were mislabelled. Deleted. |
| 2026-11-08 (diagnostic) | 4 | 2 | Logged the raw message sequence and found the duplicate `complete`. |
| 2026-11-08 14:22 UTC | 1,110 | 72 of 72 | Valid. Durations track text length (one-word clips about 0.6–1.3 s, the readback about 2.8 s). **Waiting for a person to listen.** |

That is about 2,224 characters in total. How Gnani turns characters into credits is not documented; compare with the dashboard.

## Words checked

`allSpokenStrings()` enumerates every template reply (1,988 sentences with synthetic names and amounts 0 to 25 lakh). A test flags any word that looks nasal; each flagged word is in the table below, in `REAL_CONSONANT_TOKENS` (checked: a real न or म, such as teen, naam, kaun, samaan, or an English word), or in `COVERED_BY` (the same sound as a listed entry: saintis, taintis and chauntis go with paintis; saintalis and taintalis with paintalis; painsath with chaunsath). Words like kahan, yahan, hoon and main are never spoken by the app, so they are not tested.

| # | word (today) | Hindi | kind | clip | candidate sent | what we heard | winner |
| :- | :- | :- | :- | :- | :- | :- | :- |
| 1 | haan | हाँ | nasal | 01-haan-A | Haan bolo. | not yet heard | pending |
|  |  |  |  | 01-haan-B | हाँ बोलो। | not yet heard | pending |
|  |  |  |  | 01-haan-C | हां बोलो। | not yet heard | pending |
|  |  |  |  | 01-haan-D | हा बोलो। | not yet heard | pending |
|  |  |  |  | 01-haan-E | Haa bolo. | not yet heard | pending |
|  |  |  |  | 01-haan-F | Han bolo. | not yet heard | pending |
|  |  |  |  | 01-haan-G | हाँ जी बोलो। | not yet heard | pending |
| 2 | kar dun | कर दूँ | nasal | 02-kar-dun-A | Save kar dun? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-B | Save कर दूँ? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-C | सेव कर दूँ? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-D | सेव कर दूं? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-E | सेव कर दू? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-F | Save kar du? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-G | Save kar doon? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-H | सेव कर दूँ क्या? | not yet heard | pending |
|  |  |  |  | 02-kar-dun-I | जोड़ दूँ? | not yet heard | pending |
| 3 | likh dun | लिख दूँ | nasal | 03-likh-dun-A | Aata khatam, likh dun? | not yet heard | pending |
|  |  |  |  | 03-likh-dun-B | आटा खत्म, लिख दूँ? | not yet heard | pending |
|  |  |  |  | 03-likh-dun-C | आटा खत्म, लिख दूं? | not yet heard | pending |
|  |  |  |  | 03-likh-dun-D | Aata khatam, likh du? | not yet heard | pending |
| 4 | jodun | जोड़ूँ | nasal | 04-jodun-A | Samaan mein jodun? | not yet heard | pending |
|  |  |  |  | 04-jodun-B | सामान में जोड़ूँ? | not yet heard | pending |
|  |  |  |  | 04-jodun-C | सामान में जोड़ूं? | not yet heard | pending |
|  |  |  |  | 04-jodun-D | Samaan mein jodu? | not yet heard | pending |
| 5 | likhun | लिखूँ | nasal | 05-likhun-A | Udhaar kiska likhun? | not yet heard | pending |
|  |  |  |  | 05-likhun-B | उधार किसका लिखूँ? | not yet heard | pending |
|  |  |  |  | 05-likhun-C | उधार किसका लिखूं? | not yet heard | pending |
|  |  |  |  | 05-likhun-D | Udhaar kiska likhu? | not yet heard | pending |
| 6 | karun | करूँ | nasal | 06-karun-A | Save karun? | not yet heard | pending |
|  |  |  |  | 06-karun-B | सेव करूँ? | not yet heard | pending |
|  |  |  |  | 06-karun-C | सेव करूं? | not yet heard | pending |
|  |  |  |  | 06-karun-D | Save karu? | not yet heard | pending |
| 7 | dunga | दूँगा | nasal | 07-dunga-A | Unhe chhod dunga. | not yet heard | pending |
|  |  |  |  | 07-dunga-B | उन्हें छोड़ दूँगा। | not yet heard | pending |
|  |  |  |  | 07-dunga-C | उन्हें छोड़ दूंगा। | not yet heard | pending |
|  |  |  |  | 07-dunga-D | Unhe chhod doonga. | not yet heard | pending |
| 8 | hain | हैं | nasal | 08-hain-A | Pehle se hain. | not yet heard | pending |
|  |  |  |  | 08-hain-B | पहले से हैं। | not yet heard | pending |
|  |  |  |  | 08-hain-C | पहले से हैं | not yet heard | pending |
|  |  |  |  | 08-hain-D | Pehle se hai. | not yet heard | pending |
| 9 | mein | में | nasal | 09-mein-A | List mein nahi mila. | not yet heard | pending |
|  |  |  |  | 09-mein-B | लिस्ट में नहीं मिला। | not yet heard | pending |
|  |  |  |  | 09-mein-C | List me nahi mila. | not yet heard | pending |
|  |  |  |  | 09-mein-D | List mai nahi mila. | not yet heard | pending |
| 10 | nahi | नहीं | nasal | 10-nahi-A | Samajh nahi aaya. | not yet heard | pending |
|  |  |  |  | 10-nahi-B | समझ नहीं आया। | not yet heard | pending |
|  |  |  |  | 10-nahi-C | Samajh nahin aaya. | not yet heard | pending |
|  |  |  |  | 10-nahi-D | समझ नही आया। | not yet heard | pending |
| 11 | paanch | पाँच | nasal | 11-paanch-A | Paanch rupaye. | not yet heard | pending |
|  |  |  |  | 11-paanch-B | पाँच रुपये। | not yet heard | pending |
|  |  |  |  | 11-paanch-C | पांच रुपये। | not yet heard | pending |
|  |  |  |  | 11-paanch-D | Panch rupaye. | not yet heard | pending |
| 12 | paintis | पैंतीस | nasal | 12-paintis-A | Paintis rupaye. | not yet heard | pending |
|  |  |  |  | 12-paintis-B | पैंतीस रुपये। | not yet heard | pending |
|  |  |  |  | 12-paintis-C | Paintees rupaye. | not yet heard | pending |
| 13 | paintalis | पैंतालीस | nasal | 13-paintalis-A | Paintalis rupaye. | not yet heard | pending |
|  |  |  |  | 13-paintalis-B | पैंतालीस रुपये। | not yet heard | pending |
|  |  |  |  | 13-paintalis-C | Paintaalees rupaye. | not yet heard | pending |
| 14 | chaunsath | चौंसठ | nasal | 14-chaunsath-A | Chaunsath rupaye. | not yet heard | pending |
|  |  |  |  | 14-chaunsath-B | चौंसठ रुपये। | not yet heard | pending |
| 15 | pandrah | पंद्रह | nasal | 15-pandrah-A | Pandrah rupaye. | not yet heard | pending |
|  |  |  |  | 15-pandrah-B | पंद्रह रुपये। | not yet heard | pending |
| 16 | teen | तीन | consonant | 16-teen-A | Teen sau rupaye. | not yet heard | pending |
|  |  |  |  | 16-teen-B | तीन सौ रुपये। | not yet heard | pending |
| 17 | naam | नाम | consonant | 17-naam-A | Grahak ka naam batao. | not yet heard | pending |
|  |  |  |  | 17-naam-B | ग्राहक का नाम बताओ। | not yet heard | pending |
| 18 | kaunsa | कौनसा | consonant | 18-kaun-A | Kaunsa customer hai? | not yet heard | pending |
|  |  |  |  | 18-kaun-B | कौनसा कस्टमर है? | not yet heard | pending |
| 19 | pachpan | पचपन | consonant | 19-pachpan-A | Pachpan rupaye. | not yet heard | pending |
|  |  |  |  | 19-pachpan-B | पचपन रुपये। | not yet heard | pending |
| 20 | readback | बिल … सेव कर दूँ? | nasal | 20-readback-A | Bill do sau pachas rupaye ka hai. Save kar dun? | not yet heard | pending |
|  |  |  |  | 20-readback-B | बिल दो सौ पचास रुपये का है। सेव कर दूँ? | not yet heard | pending |

## Reported 2026-11-09 (heard by a person, fixed in the app)

Two more words were heard wrong in the app, both written in Latin script. The person also said what they should sound like, so these are the first entries in `PRONUNCIATION_OVERRIDES`:

| spelling sent | heard | should be | now sent |
| :- | :- | :- | :- |
| `jodun` ("Samaan mein jodun?") | जोडून: a retroflex ड and a hard n | जोड़ूँ | `जोड़ूँ` |
| `dabao` ("... confirm dabao.") | डबाओ: a retroflex ड | दबाओ (dental द) | `दबाओ` |

**Update, later on 2026-11-09:** `haan` was reported again (still heard as हान). It now goes out as `हाँ` too. `kar dun` is the only known-bad word still waiting for a listening result.

Both are in `KNOWN_BAD_SPELLINGS`, and a test proves no template reply sends either Latin spelling any more. **Not yet confirmed by ear:** the Devanagari versions were chosen from what the person said it should be, not from listening. `pnpm spike --only P --entries jodun,dabao` made 9 clips (186 characters, one request at a time) in `scripts/spike/results/tts-check-2026-11-09T08-18-00-974Z/pronunciation/` (`LISTENING.html` has a player for each). Clip 05-jodun-E and 21-dabao-B are exactly what the app now sends. If either still sounds wrong, pick a better one from the other clips and change the override.

The new `--entries` flag runs only the named corpus entries, so a re-check costs a few hundred characters instead of 1,100. Total spent so far: about 2,410 TTS characters.

Words with the same shape that are **still Latin** and unconfirmed: `kar dun`, `likh dun`, `likhun`, `karun`, `dunga`. They are likely to have the same problem; they stay as they are until someone listens, as before.

## How to record a result

1. Open `LISTENING.html` from the newest `scripts/spike/results/tts-ab-*/pronunciation/` folder in a browser (double-click it in Finder), with headphones.
2. For each word, fill "what we heard" for every clip and mark one winner. A nasal word should end softly (हाँ, दूँ); a consonant control must keep its n or m.
3. Add each winner to `PRONUNCIATION_OVERRIDES` (`from`: today's word, `to`: the winning spelling, `evidence`: "TTS-TUNING.md #<row>"), remove it from `AWAITING_LISTENING`, and add the losers to "Known bad spellings" above.
4. If the whole-sentence Devanagari clip (#20 B) wins clearly, the better fix is to write the templates in Devanagari rather than adding many word overrides. Decide that from the clips, not from this note.
