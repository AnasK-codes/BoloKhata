# Progress (resume from here after a reset)

Branch: `chore/hardening-pass`. Mode: unattended. Mock servers only; no real Gnani/LLM/AWS.

## Phase 0: baseline (2026-11-04)
`pnpm install --frozen-lockfile` ok; `pnpm lint` clean; `pnpm typecheck` clean; `pnpm test`: shared 646, mock-gnani 54, scripts 22, gateway 239, web 322 (incl. 4 integration) all pass; `pnpm build` ok. Nothing failing at baseline.

## Plan
1. Review (REVIEW.md) 2. Fix with tests 3. Efficiency (measured on mock) 4. UI + screenshots 5. Deploy readiness 6. Final report.
Expected files: shared parser; gateway draftBuilder, config, server; web reducer, client, AppProvider, voice UI, SW; deploy files and docs.
Risks: UI churn breaking the live flow (re-test with `?tone=1` on mock), Docker build time.

## State
Phase 1 in progress.
