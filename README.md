# fluid-lab

Browser lab for rerunning published fluid simulation experiments. Stage 1: one paper, one reference experiment, one method.

- Experiment: lid-driven cavity, Re = 100, against Ghia, Ghia & Shin (1982) centreline profiles.
- Method: Chorin projection on a staggered grid (`src/cavity-mac.js`).
- Status: `MATCHES_UNVERIFIED_REFERENCE`. The reference values were typed from memory and have not been checked against the PDF. Treat the match as a smoke test until `data/ghia1982_re100.json` is replaced with a page-checked copy and `verification_status` is updated.

## Rerun from a clean checkout

Needs Node 20 or later. No dependencies to install.

```
npm test             # about 50 s; includes the full reproduction
npm run reproduce    # about 40 s; writes results/ghia-cavity-re100.json
npm run serve        # then open http://127.0.0.1:8080
```

## Layout

| Path | Role |
|---|---|
| `experiments/*.json` | Claim, equations, conditions, acceptance thresholds, open items |
| `data/*.json` | Reference data with provenance and verification status |
| `src/cavity-mac.js` | Method implementation (runs in Node and the browser) |
| `src/measure.js` | Shared measurements (divergence, flux, stability, centreline comparison) |
| `scripts/reproduce.js` | Runs an experiment and writes a result with pass/fail per check |
| `test/` | Includes negative tests: an unstable run and a wrong reference must be rejected |
| `web/` | Animation, controls, live checks, equations and source viewer |

## Acceptance

An implementation is accepted only if it is finite, converged, conserves mass (cell divergence and boundary flux), stays within the speed bound, and matches the reference centrelines within the manifest tolerance. Tolerances in `experiments/ghia-cavity-re100.json` are lab choices fixed before the first run; the paper states none.
