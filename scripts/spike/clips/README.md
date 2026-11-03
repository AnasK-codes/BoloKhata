# Spike clips: what to record

`pnpm spike` needs **10 short clips** of you speaking Hinglish, plus a `clips.json` describing them. Use **made-up names and amounts only**. No real customers, phone numbers or account numbers. The `.wav` files are git-ignored.

## How to record

- Phone voice recorder, held like you would at a shop counter, ~20 cm from your mouth.
- 3 to 6 seconds each. Start speaking within half a second, stop, then stay quiet for about a second.
- Clips 1 to 6 in a **quiet** room. Clips 7 to 10 with **background noise** (a fan, a TV, a street through an open window, or someone talking nearby).

## What to say

Say each line naturally, the way a shopkeeper would. The text must match `clips.json` (it is the reference for the word error rate).

| # | File | Noisy? | Say |
|---|---|---|---|
| 1 | `01-order-basic.wav` | no | Sharma ji ko do kilo aata aur ek Maggi, teen sau ka udhaar likh do |
| 2 | `02-aadha.wav` | no | Verma ji ko aadha kilo cheeni aur ek packet chai patti |
| 3 | `03-dedh.wav` | no | Gupta ji ko dedh kilo chawal aur do litre tel |
| 4 | `04-dhai.wav` | no | Dhai kilo aata aur ek Maggi Sharma ji ke naam pe |
| 5 | `05-balance.wav` | no | Sharma ji ka kitna udhaar hai |
| 6 | `06-payment.wav` | no | Verma ji ne do sau rupaye de diye |
| 7 | `07-haan.wav` | yes | haan |
| 8 | `08-nahi.wav` | yes | nahi |
| 9 | `09-order-noisy.wav` | yes | Gupta ji ko teen kilo cheeni aur ek Maggi, paanch sau ka udhaar likh do |
| 10 | `10-balance-noisy.wav` | yes | Verma ji ka kitna udhaar baaki hai |

Clips 7 and 8 are on purpose one word long: Gnani must not drop short answers.

## Convert to the format the spike needs

16 kHz, mono, 16-bit PCM WAV:

```bash
ffmpeg -i input.m4a -ar 16000 -ac 1 -c:a pcm_s16le 01-order-basic.wav
```

Do it for all ten (for example `for f in *.m4a; do ffmpeg -i "$f" -ar 16000 -ac 1 -c:a pcm_s16le "${f%.m4a}.wav"; done`, after naming the `.m4a` files to match the table). The spike refuses any other format.

## clips.json

Put this next to the `.wav` files. `text` is what you actually said; change it if you said something different. `keyterms` is optional: it feeds the keyterms experiment (otherwise names from `data/seed-catalog.json` are used if that file exists, or a short built-in list).

```json
{
  "keyterms": ["udhaar", "aadha", "dedh", "dhai", "Sharma", "Verma", "Gupta", "Maggi", "aata", "cheeni", "chawal"],
  "clips": [
    { "file": "01-order-basic.wav", "text": "Sharma ji ko do kilo aata aur ek Maggi, teen sau ka udhaar likh do" },
    { "file": "02-aadha.wav", "text": "Verma ji ko aadha kilo cheeni aur ek packet chai patti" },
    { "file": "03-dedh.wav", "text": "Gupta ji ko dedh kilo chawal aur do litre tel" },
    { "file": "04-dhai.wav", "text": "Dhai kilo aata aur ek Maggi Sharma ji ke naam pe" },
    { "file": "05-balance.wav", "text": "Sharma ji ka kitna udhaar hai" },
    { "file": "06-payment.wav", "text": "Verma ji ne do sau rupaye de diye" },
    { "file": "07-haan.wav", "text": "haan", "noisy": true },
    { "file": "08-nahi.wav", "text": "nahi", "noisy": true },
    { "file": "09-order-noisy.wav", "text": "Gupta ji ko teen kilo cheeni aur ek Maggi, paanch sau ka udhaar likh do", "noisy": true },
    { "file": "10-balance-noisy.wav", "text": "Verma ji ka kitna udhaar baaki hai", "noisy": true }
  ]
}
```

## Then

```bash
pnpm spike --dry-run            # check the plan and the estimated credit use; sends nothing
pnpm spike --label laptop       # the real run (needs GNANI_API_KEY in .env)
pnpm spike --label ec2-mumbai   # later, from the AWS instance
```

Useful flags: `--only A,D` (some experiments; clips are only needed for B and C), `--max-audio-seconds`, `--max-tts-chars`, `--subset`, `--repeats`, `--skip-long-idle`. Check the Gnani dashboard before and after the run and compare with the "Credit accounting" table.
