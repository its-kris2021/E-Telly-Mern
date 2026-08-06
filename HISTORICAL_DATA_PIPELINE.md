# Historical Data Pipeline — Dev Notes

Companion to [`AI_HAZARD_PREDICTION.md`](./AI_HAZARD_PREDICTION.md). That doc built the risk-model
infrastructure but was explicitly cold-started — no trained model could exist without accumulated
report + weather history, and waiting for that to build up live (30-min cron, one snapshot at a
time) would take months. This pipeline seeds the same tables from an existing historical dataset
instead, so a real model can be trained immediately.

## Why two scripts, not one

`scripts/backfillWeatherSnapshots.js` (existing, from the original AI infrastructure) already looked
like it backfilled historical weather — but it only patches a `weatherSnapshot` field onto individual
report documents, a field `scripts/buildTrainingSet.js` never actually reads. Training rows come
from `models/HazardSnapshot.js`, a separate per-barangay-per-day collection, which had **no**
historical backfill path before this. Historical reports alone, however far back, were producing
zero training rows.

## The dataset

`server/data/Capstone_Antipolo-Dataset.xlsx` — situational reports compiled from 2020–2025, one
sheet per year, columns `Date | Disaster Type | Severity | Barangay | Location`. 399 raw rows.

## 1. `scripts/importHistoricalReports.js`

Loads the spreadsheet into `emergency_reports` — the same collection live mobile reports land in —
as `status: "approved"` documents, tagged `importSource: "historical_excel_import"` (kept separate
from the existing `source` field, which already means "online"/"offline" mesh-relay origin). Once
inserted, the training pipeline can't tell these apart from any other approved report.

Handling notes:
- **Disaster Type → `emergencyType`**: `Flood`/`Flashflood`/`Creek Overflow Flood` → `flood`,
  `Landslide`/`Casualty due to Landslide` → `landslide`, `Fire` → `fire` (matches the app's own
  `EmergencyType` ids in `etelly-mobile/lib/screens/report_emergency_screen.dart`). City-wide
  typhoon/storm-name rows (`"Typhoon ROLLY"`, etc.) have no barangay and aren't one of these
  categories — skipped, not misfiled as `other`.
- **Barangay resolution**: reuses `config/barangays.js`'s `resolveBarangayKey()`, plus a small local
  alias table for spellings it doesn't catch (`"Sta Cruz"` → `santacruz`). Rows listing more than one
  barangay (`"Dalig/San Jose"`) are split into one report per barangay.
- Each report is stamped with its resolved barangay's centroid as `latitude`/`longitude` (the
  dataset has no coordinates, only free-text locations).

```bash
node scripts/importHistoricalReports.js [path-to-xlsx] [--dry-run] [--force]
```
`--dry-run` parses and prints counts with no database writes. `--force` deletes a previous import
batch (matched by `importSource`) before re-importing, for a clean re-run.

**Result of the actual run**: 397 of 399 rows imported (`flood: 310, landslide: 63, fire: 24`); 6
skipped (the city-wide typhoon/storm rows, expected); 0 unresolved barangay names.

## 2. `scripts/backfillHistoricalSnapshots.js`

Fills in `HazardSnapshot` — one document per barangay per **calendar day** — across the full
historical date range, auto-detected from the just-imported reports' earliest/latest timestamp (or
pass `--start=YYYY-MM-DD --end=YYYY-MM-DD` explicitly).

Deliberately captures **every** barangay-day in range, not just days a report exists for: per
`HazardSnapshot.js`'s own comment, snapshots with no matching report are what let the model learn
what "safe" conditions look like. Skipping them would leave the training set all-positive.

Batches all 17 barangays into **one Open-Meteo archive-API call per year** (comma-separated
lat/lon, same pattern `services/openMeteoCache.js` already uses for the live forecast API) instead
of one call per barangay-day — ~6 calls total for a 2020–2025 range instead of thousands. Each
year's fetch includes a 3-day lookback buffer before its start date so `rain_72h` has full history
even on the year's first day. Idempotent — re-running skips any barangay-day that already has a
snapshot, so it's safe to re-run after a partial/failed run.

```bash
node scripts/backfillHistoricalSnapshots.js [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
```

## Full sequence, start to trained model

```bash
cd server
node scripts/importHistoricalReports.js
node scripts/backfillHistoricalSnapshots.js
node scripts/buildTrainingSet.js flood      # sanity-check row/positive/negative counts, no writes
node scripts/trainRiskModel.js              # trains flood + landslide, writes RiskModel v1
```

After this, `services/predictionEngine.js`'s next 30-min cron tick picks up the trained model
automatically — no restart needed. Toggle "AI Predictions" on in the hazard map's layer panel
(off by default) to see it.

## Ongoing learning from mobile reports

This part didn't need new scripts — it was already wired by the original AI infrastructure:
- Every approved mobile report (`POST /api/reports/create` → admin-approved) is a future label,
  the same as a historical row, via the shared `emergency_reports` collection.
- `services/weatherSnapshotService.js`'s existing 30-min cron keeps generating live `HazardSnapshot`
  negatives continuously, the same as this backfill did for the historical range.
- The only manual step is `trainRiskModel.js` itself — it is **not** on a cron yet. Retraining as
  new mobile reports accumulate requires re-running it by hand, or wiring a weekly
  `cron.schedule(...)` call into `scripts/alertEngine.js` following its existing pattern (a
  one-line addition, per `AI_HAZARD_PREDICTION.md`'s own note — not done yet, pending a decision on
  how much unattended retraining the team wants).

## Known limitations

- Severity strings in the dataset are inconsistent (free text like `"Knee deep not passable to
  light vehicles"` next to numeric depths like `"1m"`) — stored as-is on the report; not
  normalized or used as a model feature (the risk model's features are all weather/report-rate
  based, not severity-based — see `services/riskFeatures.js`).
- Report locations are free-text only; imported reports use their barangay's centroid as
  lat/lng, the same approximation the rest of the codebase already makes (no barangay boundary
  polygons exist anywhere in this repo).
- The Open-Meteo archive API's own historical accuracy/coverage is what it is — this pipeline
  doesn't validate or cross-check it against another weather source.
