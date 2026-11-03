# LATENCY.md: measured Gnani results

**Status: no real measurements yet.** The spike (`pnpm spike`) has not been run against the real Gnani API, so this file contains no numbers. The values in `.env.example` and the README (STT format, language, VAD, pre-roll, drain, TTS model, voice, sample rate) are starting points, not measured choices.

This file is overwritten by a complete real run (`pnpm spike --label <where-you-ran-it>`, all experiments A to F). A mock run or a partial `--only` run never overwrites it.

## To produce the real results

1. Record the clips described in `scripts/spike/clips/README.md` and add `clips.json`.
2. Put `GNANI_API_KEY` in `.env`.
3. `pnpm spike --dry-run` to check the plan and estimated credit use (sends nothing).
4. `pnpm spike --label laptop` (spends credits; default budget 150 s of audio and 1,500 TTS characters).
5. Later, repeat from the AWS instance with `--label ec2-mumbai` and compare.

Until then, do not quote any latency number from code comments, docs or social copy.
