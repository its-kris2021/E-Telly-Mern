# Risk model evaluation — 2026-10-14

Time-based holdout (no shuffling): test = most recent 12 months, validation = the 6 months before that, train = everything older. Threshold chosen on validation only (recall target 0.5), applied fixed to test.

## flood

Split: train=27455, val=3111, test=1598 (val starts 2025-04-14, test starts 2025-10-14)

| Variant | N | Pos | ROC-AUC | PR-AUC | Threshold | Precision | Recall | F1 | FP/barangay/mo |
|---|---|---|---|---|---|---|---|---|---|
| Model (all features) | 1598 | 22 | 0.405 | 0.011 | 0.382 | 0.014 | 0.636 | 0.028 | 18.02 |
| Model (no reportRate30d) | 1598 | 22 | 0.406 | 0.011 | 0.387 | 0.015 | 0.636 | 0.028 | 17.83 |
| Rule baseline (approximated) | 1598 | 22 | n/a | n/a | n/a | 0.000 | 0.000 | n/a | 0.17 |
| Always-no baseline | 1598 | 22 | n/a | n/a | n/a | n/a | 0.000 | n/a | 0.00 |

Overlap: model catches 14 test positive(s) the rule baseline misses; rule baseline catches 0 the model misses.

## landslide

Split: train=27455, val=3111, test=1598 (val starts 2025-04-14, test starts 2025-10-14)

| Variant | N | Pos | ROC-AUC | PR-AUC | Threshold | Precision | Recall | F1 | FP/barangay/mo |
|---|---|---|---|---|---|---|---|---|---|
| Model (all features) | 1598 | 12 | 0.550 | 0.008 | 0.500 | 0.012 | 0.750 | 0.024 | 13.44 |
| Model (no reportRate30d) | 1598 | 12 | 0.549 | 0.008 | 0.500 | 0.011 | 0.667 | 0.022 | 13.27 |
| Rule baseline (approximated) | 1598 | 12 | n/a | n/a | n/a | 0.000 | 0.000 | n/a | 0.17 |
| Always-no baseline | 1598 | 12 | n/a | n/a | n/a | n/a | 0.000 | n/a | 0.00 |

Overlap: model catches 9 test positive(s) the rule baseline misses; rule baseline catches 0 the model misses.

## Limitations

- Small number of positives per hazard (see "Pos" column) — recall/PR-AUC estimates rest on a handful of events and should be read as rough, not precise.
- Labels come from citizen/CDRRMO reports, not ground-truth hazard occurrence — "no report" may mean "no event" or may mean "an event happened and nobody reported it."
- The rule baseline uses OBSERVED trailing rain_1h as a stand-in for the live system's FORECAST peak-intensity windows (0-1h/1-3h/3-6h/6-12h ahead) — it approximates whether rule thresholds would have been crossed, it does not replay the live alert engine.
- Test-set size (see split above) is bounded by how much historical data exists; the most recent 12 months may not be representative of a full multi-year rainy/dry season cycle.
