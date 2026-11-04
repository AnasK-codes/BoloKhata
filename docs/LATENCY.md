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


## Mock-server measurements (NOT the real Gnani API)

These come from the hardening pass on a developer laptop with the **mock** Gnani servers (fixed delays: STT answers 120 ms after commit, TTS speaks 20 ms per character). They show what the gateway and the browser add on top of the upstream and that nothing leaks. **Do not quote them as Gnani latency.** The real-API table above is still empty until `pnpm spike` is run.

| What | Before this pass | After this pass |
|---|---|---|
| 20 browsers x 120 turns: turns completed | 2,400 / 2,400 | not re-measured at the very end unless stated in HARDENING_REPORT.md |
| Gateway event-loop delay p99 (window) | about 1.2 ms | see HARDENING_REPORT.md |
| Gateway release to transcript overhead over the mock's 120 ms | about 1 ms | see HARDENING_REPORT.md |
| Web JavaScript+CSS for `/` (gzip, `.next` build, 12 files) | 285,305 B | 283,092 B (seed catalog and dev tone lazy-loaded) |

The 20x120 soak is described in `docs/TESTING.md` section 1. Bundle sizes are bytes of gzip over the files listed in the built `/` HTML (`apps/web/.next/server/app/index.html`), not a transfer measurement over a network.
