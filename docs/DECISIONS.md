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
