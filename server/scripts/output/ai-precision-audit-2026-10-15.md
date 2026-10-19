# AI flood/landslide precision — what was done (2026-10-15)

## Goal

Reduce false-positive AI flood/landslide alerts while keeping recall. Audit
the existing pipeline first, get explicit approval before touching anything
that affects live predictions.

## 1. Threshold revert (earlier in the day, separate request)

Reverted `findOptimalThreshold` (`server/services/logisticRegression.js`)
back to pure F1-argmax, removing the `minRecall` option added the previous
day. Also removed the now-unused `OPERATING_THRESHOLD_MIN_RECALL` constant
from `server/scripts/trainRiskModel.js` and `RECALL_TARGET` from
`server/scripts/evaluateRiskModel.js`. User was warned this reinstates the
"AI alerts silently rare" failure mode from the prior day's fix, and
confirmed the revert anyway.

## 2. Audit of the existing AI pipeline

Read through the full pipeline: `riskFeatures.js` (10 features — rainfall at
multiple windows, soil moisture, static susceptibility, 30-day report rate,
wind/pressure/evapotranspiration/river discharge), `logisticRegression.js`
(L2-regularized single-unit logistic regression via TensorFlow.js, already
uses sklearn-style balanced class weights), `buildTrainingSet.js` (labels
barangay-days from citizen/CDRRMO reports), `trainRiskModel.js` (promotion
safety gate — new version validated and activated before the old one is
deactivated), `predictionEngine.js` (live scoring, gated against the
rule-based alert engine to avoid duplicate alerts), and `evaluateRiskModel.js`
(an already-existing honest evaluation harness — date-based holdout, not
shuffled CV, with bootstrap confidence intervals and a rule-baseline
comparison). Conclusion: the infrastructure was already fairly mature: class
weighting, threshold search, and a proper evaluation harness all existed
before today.

## 3. Ran the honest evaluation — found the real problem

`node scripts/evaluateRiskModel.js both`, read-only, against the live
database:

| | Flood | Landslide |
|---|---|---|
| Test rows (most recent 12 months) | 1,598 | 1,598 |
| Test positives | 22 | 12 |
| **ROC-AUC** | **0.405** | **0.552** |
| ROC-AUC 95% CI (bootstrap) | [0.16, 0.56] | [0.39, 0.69] |
| Precision @ threshold | 0.008 | 0.012 |
| FP/barangay/month | 13.80 | 13.44 |

Both CIs span 0.5 — statistically indistinguishable from a coin flip. This
contradicts the ~0.91/0.94 AUC `trainRiskModel.js` reports at training time,
because that number comes from shuffled-row cross-validation, which leaks
information across correlated nearby days; the date-based holdout here is the
honest version of the same question.

## 4. Found the root cause — a real data defect, not just noise

Queried the raw `HazardSnapshot` collection directly (not the aggregated
training view) and found:

- **25,602 docs (2026-08-02 .. 2026-09-01) were missing `windSpeed10m`,
  `surfacePressure`, `et0_24h`, `riverDischarge` entirely** — not zeroed,
  genuinely absent from the stored document. Root cause: these fields were
  added to the live capture code (`services/weatherSnapshotService.js`)
  partway through that window, so older docs in it simply predate them.
  Confirmed live (curl to `archive-api.open-meteo.com` /
  `api.open-meteo.com`) that the same Open-Meteo variable names return real
  data today — this is a historical gap, not an ongoing outage.
- **Dec 2025 – Jul 2026 had zero `HazardSnapshot` rows at all.** The live
  30-minute capture cron only started running in Aug 2026; all data before
  that point was historical backfill (`backfillHistoricalSnapshots.js`) that
  stopped short of this window.
- Feature-vs-label Pearson correlation (all 32,181 rows, pre-repair):
  `rain_24h` r=0.22 (flood) / 0.20 (landslide), `rain_6h` r=0.16/0.11,
  `windSpeed10m` r=0.12/0.09, `riverDischarge` r=0.08/0.11 — all meaningful
  given the ~0.3-0.5% base rate. `surfacePressure` (r≈0.005-0.007) and
  `susceptibility` (r≈-0.001-0.008) showed almost no univariate signal —
  flagged for a future ablation pass, not yet acted on.

User chose "fix data/signal first, threshold second" over going straight to
threshold tuning on an unverified model.

## 5. Repaired the data

**a) `server/scripts/repairSnapshotFeatureGap.js`** (new script, kept in the
repo): dry-run by default, backs up every affected doc to a local JSON file
before writing, re-fetches the 4 missing fields from Open-Meteo's archive API
for the exact affected window, and `$set`s only those fields by `_id` —
`rain_*`/`soilTop`/`soilDeep` never touched. Ran dry-run first, reviewed the
sample output, then ran `--apply`. **Result: all 25,602 docs repaired, 0
left missing afterward.** Pre-repair backup at
`etelly-mern/_backups/hazardsnapshot-repair-backup-1792070438740.json`
(8.9MB, gitignored, not committed).

**b) Existing `backfillHistoricalSnapshots.js`**, run with explicit
`--start=2025-12-01 --end=2026-07-31` (no code change needed — it already
supports this and only inserts where no doc exists). **Result: 4,131 new
barangay-day snapshots inserted, 0 collisions.** No new positive labels
recovered in that window (still 159 flood / 93 landslide positives
system-wide) — this only added negative/safe-condition training diversity.

Training set grew from 32,181 → 36,312 rows.

## 6. Re-ran the honest evaluation — real improvement, with caveats

| | Flood before | Flood after | Landslide before | Landslide after |
|---|---|---|---|---|
| Test rows | 1,598 | 5,729 | 1,598 | 5,729 |
| **ROC-AUC** | 0.405 | **0.793** | 0.552 | **0.895** |
| ROC-AUC 95% CI | [0.16, 0.56] | **[0.59, 0.91]** | [0.39, 0.69] | **[0.81, 0.96]** |
| PR-AUC | 0.011 | 0.138 | 0.008 | 0.102 |
| Precision @ threshold | 0.008 | 0.009 | 0.012 | 0.015 |
| Recall @ threshold | 0.273 | 0.273 | 0.750 | 0.750 |
| FP (absolute) | 735 | 644 | 716 | 596 |
| FP/barangay/month | 13.80 | 3.37 | 13.44 | 3.12 |

**Honest read**: ROC-AUC moved from statistically-chance to confidently above
chance for both hazards — that was the real blocker, and it's fixed.
Precision-as-a-fraction barely moved, by construction (same model, same
threshold, same 22/12 positives — TP count didn't change). The 4x drop in
FP/barangay/month is mostly a measurement artifact (test window went from
~94 real days to ~337, so the same FP count divides into a much larger,
more honest denominator), not the model behaving better — though the
absolute FP count did drop modestly for real (735→644, 716→596).

## 7. Threshold tradeoff curve (read-only, no retrain)

Scanned thresholds 0.30–0.90 on the repaired data to answer "will precision
go up if we tune the threshold":

- **Flood**: precision 0.009 (@0.50) → 0.20 (@0.90), but recall caps at
  0.182 (4/22 positives) for any threshold ≥0.55 — those 4 are high-confidence
  hits, the other 18 are never flagged regardless of threshold.
- **Landslide**: precision 0.015 (@0.50) → 0.10 (@0.90), recall drops more
  smoothly from 0.75 to 0.167 as threshold rises — no free plateau here.

Conclusion: precision can rise substantially, but only by accepting a real
recall cost — a policy decision, not a free fix. Not yet acted on.

## 8. Checked the live dashboard — confirms the problem is real in the field

Active models (v11 flood / v9 landslide, both trained Oct 14, **before**
today's fixes and before the earlier threshold revert): CV-reported
precision 4% (flood) / 3% (landslide), recall 73%/82%. **Field outcomes
(all-time): 0 confirmed / 4 false-positive (flood), 0 confirmed / 9
false-positive (landslide)** — every admin-reviewed AI alert so far has been
rejected. This matches the offline audit and is independent real-world
confirmation.

## 9. What was explicitly NOT done

- **No retrain was run.** The live active models (v11/v9) are unchanged and
  still reflect pre-repair data and the old threshold logic — today's data
  fix has zero effect on live predictions until a retrain is run.
- **No model promotion, no changes to `predictionEngine.js` or
  `trainRiskModel.js`'s promotion gate.**
- **Threshold policy for Step 5 (recall-constrained search vs. a fixed higher
  threshold) was not decided.** Paused here at the user's request.

## 10. Git state

Two commits made (not yet pushed — repo is 73 commits ahead of
`origin/master`, including unrelated prior work):
- Threshold revert (`logisticRegression.js`, `trainRiskModel.js`,
  `evaluateRiskModel.js`)
- Data repair (`repairSnapshotFeatureGap.js` + both
  `evaluation-2026-10-15.{json,md}` reports)

`_backups/` left untracked/gitignored — not committed.

## If resuming this later

1. Decide the threshold policy (pure F1-argmax vs. a fixed higher threshold
   vs. reinstating a tunable recall-constrained search).
2. Run `node scripts/trainRiskModel.js` — this **will** create and
   auto-promote a new live model version (v12 flood / v10 landslide) per the
   existing safety gate. Needs explicit go-ahead first.
3. Re-check the live dashboard's field outcomes after a few weeks — real
   events are rare (~0.3-0.5% of days), so statistically meaningful field
   confirmation takes longer than the offline backtest.
4. Consider the deferred feature-ablation pass (drop/keep `surfacePressure`,
   `susceptibility`) via `evaluateRiskModel.js`'s existing ablation pattern.
