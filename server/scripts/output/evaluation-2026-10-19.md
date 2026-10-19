# Risk model evaluation — 2026-10-19

Time-based holdout (no shuffling): test = most recent 12 months, validation = the 6 months before that, train = everything older. Threshold chosen on validation only (F1-argmax), applied fixed to test.

## flood

Split: train=27540, val=3111, test=5729 (val starts 2025-04-19, test starts 2025-10-19)

| Variant | N | Pos | ROC-AUC | PR-AUC | Threshold | Precision | Recall | F1 | FP/barangay/mo |
|---|---|---|---|---|---|---|---|---|---|
| Model (all features) | 5729 | 22 | 0.794 | 0.138 | 0.593 | 0.009 | 0.182 | 0.018 | 2.20 |
| Model (no reportRate30d) | 5729 | 22 | 0.794 | 0.138 | 0.593 | 0.009 | 0.182 | 0.018 | 2.22 |
| Rule baseline (approximated) | 5729 | 22 | n/a | n/a | n/a | 0.000 | 0.000 | n/a | 0.05 |
| Always-no baseline | 5729 | 22 | n/a | n/a | n/a | n/a | 0.000 | n/a | 0.00 |

Overlap: model catches 4 test positive(s) the rule baseline misses; rule baseline catches 0 the model misses.

## landslide

Split: train=27540, val=3111, test=5729 (val starts 2025-04-19, test starts 2025-10-19)

| Variant | N | Pos | ROC-AUC | PR-AUC | Threshold | Precision | Recall | F1 | FP/barangay/mo |
|---|---|---|---|---|---|---|---|---|---|
| Model (all features) | 5729 | 12 | 0.896 | 0.102 | 0.500 | 0.015 | 0.750 | 0.029 | 3.13 |
| Model (no reportRate30d) | 5729 | 12 | 0.889 | 0.101 | 0.500 | 0.013 | 0.667 | 0.026 | 3.16 |
| Rule baseline (approximated) | 5729 | 12 | n/a | n/a | n/a | 0.000 | 0.000 | n/a | 0.05 |
| Always-no baseline | 5729 | 12 | n/a | n/a | n/a | n/a | 0.000 | n/a | 0.00 |

Overlap: model catches 9 test positive(s) the rule baseline misses; rule baseline catches 0 the model misses.

## Limitations

- Small number of positives per hazard (see "Pos" column) — recall/PR-AUC estimates rest on a handful of events and should be read as rough, not precise.
- Labels come from citizen/CDRRMO reports, not ground-truth hazard occurrence — "no report" may mean "no event" or may mean "an event happened and nobody reported it."
- The rule baseline uses OBSERVED trailing rain_1h as a stand-in for the live system's FORECAST peak-intensity windows (0-1h/1-3h/3-6h/6-12h ahead) — it approximates whether rule thresholds would have been crossed, it does not replay the live alert engine.
- Test-set size (see split above) is bounded by how much historical data exists; the most recent 12 months may not be representative of a full multi-year rainy/dry season cycle.
