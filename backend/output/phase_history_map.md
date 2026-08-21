# History purge map — 2026-08-05 (approved by owner)

Purged: data/raw/krwswapdata.xlsx (company Infomax export; entered
history at the 7e3d899 baseline commit, removed from ALL trees via
git-filter-repo --invert-paths). Backup: ..igfoot_prepurge.bundle
(contains the pre-purge history INCLUDING the file — owner may delete
once satisfied). Verification: rev-list object paths contain no
krwswapdata/xlsx match; content grep for export-distinctive strings
across all revs returns nothing.

| old (reports/memory) | new | subject |
|---|---|---|
| 9aa3727 | 6d15f38 | debug log: 5b close + open item (history purge pending owner decision) |
| de719c0 | bc53dce | Phase 5b: swap-spread satellite + IRS curve assembler (v1.5-irs) |
| 8bb8cac | 5af4981 | Phase 5a: policy->CD transmission event study + adapter (v1.4-cd) |
| a723b20 | b4584e4 | Phase 4.8 (FINAL tp/sync round): imposed-shock IRF-B, beta_sync 1.05 ( |
| 8fd22ec | 47e7117 | Phase 4.7: tp_us FIR kernel fitted to pyfrbus, holdout-validated (v1.2 |
| c85470b | 6035a0d | Phase 4.6: two-moment tp_us recalibration — STOP, both forms rejected |
| 25d4e73 | 71ae309 | Phase 4.5: tp_us process + beta_sync interior re-pin 0.55 (v1.1-tpus) |
| b68437a | 35e1bcf | Phase 4 Step 3 + housekeeping: HFL conditional forecast deliverable |
| a3f9dc0 | b199647 | Phase 4 Steps 1-2: residual infrastructure + Appendix-B inversion engi |
| 88d1e0f | 465ab09 | Phase 3.1 close-out: v1-waiver per the pre-declared tag rule |
| a2bf827 | 0a927a0 | Step 3: FORM_A1_EC — photographed A.1 explicit EC form, toggleable |
| a49111f | 6270c9f | Step 1: exact A.11-A.16 PAC d-weights (RESOLVED_A13) |
| 7e3d899 | 6532de4 | Baseline: Phase 3 state before A.11-A.16 exact PAC weights (12/13, PRO |

| tag | old target | new target |
|---|---|---|
| v1-waiver | 88d1e0f | 465ab09 |
| v1.1-tpus | 25d4e73 | 71ae309 |
| v1.2-tpus | 8fd22ec | 47e7117 |
| v1.3-sync | a723b20 | b4584e4 |
| v1.4-cd | 8bb8cac | 5af4981 |
| v1.5-irs | de719c0 | bc53dce |
