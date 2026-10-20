# Active-model in-sample check — 2026-10-20

**This is NOT a holdout/generalization evaluation.** The active models were fit on 100% of historical rows (see scripts/trainRiskModel.js), so no historical period is unseen by them. This report only confirms the deployed weights/threshold behave as expected via the real production inference path. Do not use these numbers alone to justify keeping or rolling back a model. For the best available (differently-trained) honest date-holdout estimate, see scripts/output/evaluation-2026-10-19.md.

## flood (v13)

- Data scored: 36397 rows / 2141 days, 2020-11-11 to 2026-10-20
- Positives: 159
- Threshold: 0.9246231155778895
- Precision: 0.26666666666666666 | Recall: 0.1509433962264151 | F1: 0.19277108433734938 | AUC: 0.9155174681985379
- Confusion: TP=24 FP=66 FN=135 TN=36172

## landslide (v11)

- Data scored: 36397 rows / 2141 days, 2020-11-11 to 2026-10-20
- Positives: 93
- Threshold: 0.9195979899497487
- Precision: 0.14736842105263157 | Recall: 0.15053763440860216 | F1: 0.14893617021276595 | AUC: 0.9438478297957037
- Confusion: TP=14 FP=81 FN=79 TN=36223

