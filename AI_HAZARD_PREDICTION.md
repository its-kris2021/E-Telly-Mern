# AI Hazard Prediction — Dev Notes

Turns the hazard map from purely reactive (rule-based alerts triggered by live PAGASA rainfall
thresholds + Open-Meteo soil moisture) into a system that also **learns from accumulated citizen
reports** and predicts elevated flood/landslide risk per barangay before a rule threshold fires.

Status: infrastructure is fully built and wired in. It will do nothing useful yet — there isn't
enough report + weather history for a trained model to exist. See [Cold start](#cold-start--whats-needed-before-this-does-anything) below.

## TL;DR for reviewers

- Nothing existing was removed or renamed in a way that breaks callers. `services/floodAlerts.js`
  and `services/landslideAlerts.js` changed from checking one city-wide point to checking all 17
  barangays — everything else is additive (new files, new optional fields, new routes).
- The "AI" is an L2-regularized logistic regression (`server/services/logisticRegression.js`),
  trained with `@tensorflow/tfjs` (pure-JS backend, no native compilation, no Python, no separate
  model service) — a single dense sigmoid unit is mathematically exactly logistic regression, just
  fit with TensorFlow's SGD optimizer and binary cross-entropy loss instead of a hand-rolled
  gradient descent loop. Live inference (`predictProba` in the same file) stays plain
  arithmetic on stored weight arrays — no tfjs tensors on the hot path, since that runs for
  17 barangays × 2 hazard types every 30 minutes.
- Everything server-side is guarded to fail soft: if Open-Meteo is rate-limited, if there's no
  trained model yet, if a report has no usable location — the code logs and returns early. It
  never throws in a way that breaks report submission or the existing alert cron jobs.

## Why logistic regression, not a heavier model

The realistic dataset size for this deployment (a capstone project, one city) is tens to low
hundreds of labeled report-days — not enough to justify a random forest, gradient boosting, or a
deeper neural network, all of which would overfit at this scale without adding accuracy. A small,
L2-regularized linear model, seeded with a physically-informed prior and retrained on real
reports, is both the right complexity for the data and fully auditable — every prediction can be
traced to specific feature weights, which matters for a disaster-alerting feature.

It's trained with TensorFlow.js rather than a Python/scikit-learn service so the whole system stays
one deployable Node process — no second runtime, no cross-service network calls on the prediction
path — while still using an established, widely-used ML library instead of hand-rolled gradient
descent math.

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────────┐
│  Open-Meteo (rainfall forecast + soil moisture + historical archive)│
└───────────────┬───────────────────────────────┬─────────────────────┘
                 │                               │
     every 15 min│ (existing)         every 30 min│ (new)
                 ▼                               ▼
    ┌────────────────────────┐      ┌──────────────────────────────┐
    │ floodAlerts.js          │      │ weatherSnapshotService.js     │
    │ landslideAlerts.js      │      │ → HazardSnapshot (per         │
    │ (per-barangay now)      │      │   barangay, every 30 min)     │
    │ → Alert (source:system) │      └───────────────┬────────────────┘
    └────────────────────────┘                       │
                 ▲                                    │
                 │ gates against                       ▼
                 │                          scripts/buildTrainingSet.js
    ┌────────────┴─────────────┐           joins HazardSnapshot + reports
    │ predictionEngine.js       │◄──────────  scripts/trainRiskModel.js
    │ (every 30 min)            │              trains logisticRegression.js
    │ → Alert (source:ai)       │              → RiskModel (versioned)
    └────────────┬──────────────┘
                 │
                 ▼
       GET /api/alerts (existing route, unchanged)
                 │
                 ▼
   client: AiPredictionLayer.jsx  (new map layer, off by default)
```

Citizen reports (mobile app → `POST /api/reports/create`) feed two things: a `weatherSnapshot`
attached to the report itself (for training), and — going the other direction — an automatic
confirm of any AI prediction that matches (see [feedback loop](#6-feedback-loop)).

## What was built, phase by phase

### 0. Shared barangay config
`server/config/barangays.js` (new) — the 17 barangay centroids, previously private to
`routes/evacuation.js`, now shared. Also adds `resolveBarangayKey()` (normalizes free-text
barangay names from reports), `nearestBarangayKey()` (lat/lng fallback), `barangayLabel()`
(display names), and `HIGH_SUSCEPTIBILITY_BARANGAYS` (Calawis, Dalig, San Jose, Mambugan — MGB
geohazard-documented slope areas, used both in landslide alert copy and as a model feature).
`routes/evacuation.js` now imports from here instead of declaring its own copy.

### 1. Weather-snapshot data pipeline
Training data has to exist before any model can be trained — this is the highest-priority piece.

- **`server/models/HazardSnapshot.js`** (new) — one doc per barangay per capture: rainfall
  accumulated over the past 1/3/6/24/72h and soil moisture (top/deep), all **observed**, not
  forecast (see note below on why).
- **`server/services/weatherSnapshotService.js`** (new) — `captureAllBarangaySnapshots()`, run by
  cron every 30 min for all 17 barangays in **2** Open-Meteo calls (batched), not 34.
- **`server/services/openMeteoCache.js`** (modified) — added `fetchWeatherSnapshot(Batch)`
  (combined precipitation + soil moisture, `past_days=3`), plus `fetchRainfallHourlyBatch` /
  `fetchLandslideDataBatch` for Phase 2's per-barangay rule engine. The *existing*
  `fetchRainfallHourly`/`fetchLandslideData` functions and their cache keys are untouched —
  nothing that already depended on them changed shape.
- **`server/routes/reports.js`** (modified) — after `POST /create` inserts a report and the
  response is already sent, `attachWeatherSnapshot()` fetches conditions at that barangay and
  patches `weatherSnapshot` onto the report doc. Fire-and-forget — errors are logged, never
  surfaced to the submitter.
- **`server/scripts/backfillWeatherSnapshots.js`** (new, run manually) — same idea but for
  reports that already exist, using Open-Meteo's **historical archive API**
  (`archive-api.open-meteo.com`) instead of the forecast API, so existing reports get labeled data
  immediately instead of waiting weeks for live capture to accumulate.

  ```bash
  node scripts/backfillWeatherSnapshots.js
  ```

**Why observed rainfall, not forecast peaks:** the existing rule engine's features are forecast
peaks ("30mm/hr expected in the next hour") — that's right for live alerting lead time, but you
can't ask "what was forecast" for a report from two months ago; Open-Meteo's archive API only has
what actually happened. So all model-training features are backward-looking/observed, computed
identically whether it's a live 30-min snapshot or a historical backfill. See the comment block at
the top of `weatherSnapshotService.js`.

### 2. Spatial rule engine
`server/services/floodAlerts.js` and `server/services/landslideAlerts.js` (both modified) — the
PAGASA-threshold + soil-moisture logic is unchanged, but it now runs **once per barangay** (17
loops) instead of once for the city centroid. Alert `_dedupeKey`/`barangays`/`location` are now
barangay-scoped. This is a real, immediate improvement independent of anything AI — previously a
resident in a barangay with zero rain got the same city-wide alert as one being flooded.

No frontend changes needed here — `FloodAlertsLayer.jsx`/`LandslideAlertsLayer.jsx` already render
one marker per alert and already display `alert.barangays`, so multiple per-barangay alerts just
render as multiple markers automatically.

### 3. Feature vector + training
- **`server/services/riskFeatures.js`** (new) — the single definition of the model's feature
  vector, used identically by training and live inference so they can never drift apart:
  `[rain_6h, rain_24h, soilTop, soilDeep, barangayReportRate30d, susceptibility, windSpeed10m,
  surfacePressure, et0_24h, riverDischarge]`. The last four (wind speed, surface pressure,
  evapotranspiration from the forecast/archive API's hourly variables; river discharge from
  Open-Meteo's separate Flood API, GloFAS v4) supplement the original rain/soil-moisture pair —
  river discharge in particular is a direct hydrological flood signal rather than a rainfall
  proxy. Existing `HazardSnapshot` rows predate these fields and default them to 0 until
  re-backfilled (`scripts/backfillHistoricalSnapshots.js`) or naturally refreshed by the live
  30-min capture cron.
  `barangayReportRate30d` is a **30-day rolling report count**, deliberately not a short window —
  reports can arrive hours late via offline mesh relay (see `etelly-mobile/OFFLINE_IMPLEMENTATION.md`),
  and a 30-day window is insensitive to that delay in a way a "reports in the last hour" feature
  would not be.
- **`server/services/logisticRegression.js`** (new) — `fitStandardization`,
  `trainLogisticRegression` (TensorFlow.js, L2-regularized), `predictProba`, `kFoldCrossValidate`,
  `computeMetrics` (precision/recall/F1/AUC). `defaultPriorWeights()` seeds training with small
  positive weights on every hazard-associated feature so day-one output (before any real training
  data) isn't nonsense — every retrain then adjusts these from real reports.

  **Class imbalance and the operating threshold**: on the real historical dataset, flood/landslide
  positives are ~0.5%/0.3% of labeled barangay-days. Predicted probabilities for even the riskiest
  days stay well under the conventional 0.5 cutoff, so precision/recall computed at 0.5 come back
  as `n/a`/`0.00` even when the model has learned real structure (AUC — threshold-independent — was
  0.91/0.94 on real data). `findOptimalThreshold()` scans the model's pooled cross-validation
  predictions and picks the threshold that maximizes F1; that value is stored per model as
  `RiskModel.operatingThreshold` and is what `predictionEngine.js` actually gates live alerts on
  (see Phase 4), not a fixed constant. `trainRiskModel.js` reports metrics at both 0.5 (for
  comparability across training runs) and at this operating threshold (the metrics that reflect
  real usable performance). Note this is an F1-optimal point, not a business-tuned one — it treats
  a missed hazard and a false alarm as equally costly, which may not match how a disaster-alerting
  system should actually weigh those two failure modes; revisit if false-alarm rate in the field
  metrics (Phase 6) turns out to be a problem.
- **`server/models/RiskModel.js`** (new) — one **versioned** Mongoose doc per (hazardType, train
  run): weights, bias, standardization params, offline CV `metrics`, and live `fieldMetrics`
  (see Phase 6). Stored in Mongo, not a file on disk, since the deploy target may not have
  persistent disk across restarts.
- **`server/scripts/buildTrainingSet.js`** (new) — joins `HazardSnapshot` with approved reports
  into labeled `(barangay, day)` rows. **Labels are day-granularity, not minute-level** — same
  offline-delay reasoning as above; a report is treated as confirming a hazard on the day it was
  filed *or the following day*.
- **`server/scripts/trainRiskModel.js`** (new, run manually or on a cron you add) — builds the
  training set, cross-validates, trains final weights on the full dataset, writes a new
  `RiskModel` version, deactivates the previous one. Trains one model each for `flood` and
  `landslide` (separate models — a barangay can be flood-risky without being landslide-risky).

  ```bash
  node scripts/trainRiskModel.js
  ```

  Below `MIN_ROWS_TO_TRAIN = 5` labeled rows it logs and skips — no garbage model gets deployed
  off a near-empty dataset.

### 4. Prediction engine
**`server/services/predictionEngine.js`** (new), `runPredictionChecks()`, cron every 30 min:

1. Loads the active `RiskModel` for `flood` and `landslide` (if neither exists, does nothing).
2. Per barangay: computes the same feature vector as training, scores it (`predictProba`).
3. **Gates against the rule engine** — only creates an AI alert if the probability crosses that
   model's own `operatingThreshold` (see Phase 3's class-imbalance note — a fixed 0.6 would almost
   never fire given how rare positives are) *and* there isn't already an active `source:"system"`
   alert of equal-or-higher severity for that barangay/type. The AI layer is meant to surface risk
   the physics-based rules miss, not duplicate or contradict them on the map. Severity bands
   (`watch`/`warning`/`critical`) are likewise scaled relative to the operating threshold, not fixed
   absolute probabilities, for the same reason.
4. Upserts an `Alert` with `source: "ai"`, `confidence`, `modelVersion`.

`server/models/Alert.js` (modified) — added `"ai"` to the `source` enum, plus `confidence`,
`modelVersion`, `confirmedOutcome` (`unconfirmed`/`true_positive`/`false_positive`),
`confirmedBy`, `confirmedAt`. `server/services/alertHelpers.js` (modified) — added
`upsertAiAlert()` (deliberately not marked `urgent` in push notifications, softer copy — an
unconfirmed prediction should never carry the same implied authority as a threshold-triggered
evacuation alert).

### 5. Frontend map layer
**`client/src/components/map/predictions/AiPredictionLayer.jsx`** (new) — same layer-group/fetch
pattern as `FloodAlertsLayer.jsx`. Renders `source:"ai"` alerts as **dashed-border** markers
(visually distinct from solid rule-based markers) with a confidence % badge and "not yet
confirmed" label. Off by default (`INITIAL_LAYERS.aiPredictions = false` in `HazardMapPage.jsx`) —
opt-in until there's real confidence in the model's output. Wired into
`LayerControlPanel.jsx` and `HazardLegend.jsx` (new `aiPredictions` entries).

If a valid auth token is in `localStorage`, the popup also shows **Confirm / Mark false positive**
buttons (admin moderation, see Phase 6).

### 6. Feedback loop
- **`server/routes/alerts.js`** (modified) — `PATCH /api/alerts/:id/confirm` and
  `PATCH /api/alerts/:id/reject`, scoped to `source:"ai"` alerts, admin-authenticated.
- **`server/routes/reports.js`** (modified) — `autoConfirmMatchingAiAlert()`: a new report that
  matches an unconfirmed AI alert (same type + barangay) auto-confirms it
  (`confirmedBy: "auto:linked_report"`) — a real report is strong evidence the prediction was
  right, without waiting on an admin to click a button.
- **`server/scripts/alertEngine.js`** (modified) — `runExpiryCleanup()` now also auto-marks any
  `source:"ai"` alert that expires still `unconfirmed` as `false_positive`
  (`confirmedBy: "auto:expired_unconfirmed"`) — nothing ever came in to back it up.
- **`server/scripts/trainRiskModel.js`** computes `fieldMetrics` (confirmed vs. false-positive
  counts) on every retrain — real-world outcomes, distinct from the offline cross-validation
  `metrics`, so the team can show whether predictions are actually panning out, not just how the
  model scored on a historical split.
- **`server/routes/adminMetrics.js`** (new) — `GET /api/admin/model-metrics`, admin/barangay-role
  gated, returns version history + live confusion-matrix counts per hazard type.
- **`client/src/components/admin/ModelPerformancePanel.jsx`** (new) — collapsible panel added to
  `AlertsPage.jsx` (admin-only), shows current model version's precision/recall/AUC, a field-outcome
  bar (confirmed/false-positive/unconfirmed), and a version history table.

## Files touched

<details>
<summary>Server — new files</summary>

```
server/config/barangays.js
server/models/HazardSnapshot.js
server/models/RiskModel.js
server/services/weatherSnapshotService.js
server/services/riskFeatures.js
server/services/logisticRegression.js
server/services/predictionEngine.js
server/scripts/buildTrainingSet.js
server/scripts/trainRiskModel.js
server/scripts/backfillWeatherSnapshots.js
server/routes/adminMetrics.js
```
</details>

<details>
<summary>Server — modified files</summary>

```
server/routes/evacuation.js       import BARANGAY_COORDS from shared config instead of local copy
server/services/openMeteoCache.js added batched + snapshot fetchers, generalized findCurrentHourIndex
server/services/floodAlerts.js    single city point → loop over 17 barangays
server/services/landslideAlerts.js single city point → loop over 17 barangays
server/models/Alert.js            + source:"ai", confidence, modelVersion, confirmedOutcome/By/At
server/services/alertHelpers.js   + upsertAiAlert(), setDefaultsOnInsert fix
server/routes/reports.js          + attachWeatherSnapshot, autoConfirmMatchingAiAlert
server/routes/alerts.js           + PATCH :id/confirm, PATCH :id/reject
server/scripts/alertEngine.js     + snapshot/prediction cron jobs, expiry cleanup auto-labels
server/index.js                   + mount /api/admin
```
</details>

<details>
<summary>Client — new files</summary>

```
client/src/components/map/predictions/AiPredictionLayer.jsx
client/src/components/admin/ModelPerformancePanel.jsx
```
</details>

<details>
<summary>Client — modified files</summary>

```
client/src/pages/HazardMapPage.jsx              + AiPredictionLayer, aiPredictions layer key
client/src/components/map/core/LayerControlPanel.jsx  + AI Predictions toggle
client/src/components/map/ui/HazardLegend.jsx         + AI Predictions legend
client/src/pages/AlertsPage.jsx                        + ModelPerformancePanel (admin only)
```
</details>

## New/changed API endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `PATCH` | `/api/alerts/:id/confirm` | admin | source:"ai" alerts only |
| `PATCH` | `/api/alerts/:id/reject` | admin | source:"ai" alerts only |
| `GET` | `/api/admin/model-metrics` | admin/barangay_official | version history + outcome counts |
| `GET` | `/api/alerts` | — (unchanged) | now also returns `source:"ai"` alerts, no client-visible change needed |

## Cold start — what's needed before this does anything

> **Update:** cold start is resolved via a historical dataset instead of waiting on live data to
> accumulate — see [`HISTORICAL_DATA_PIPELINE.md`](./HISTORICAL_DATA_PIPELINE.md). The manual
> steps below still apply; that doc covers the extra steps that seed history before them.

Right now `predictionEngine.js` will run every 30 min, find no active `RiskModel` for either
hazard type, log nothing useful, and return. That's correct/expected behavior, not a bug. To get
a real model:

1. Let `weatherSnapshotService` run for a while (it's already wired into `alertEngine.js`'s cron),
   **or** run `node scripts/backfillWeatherSnapshots.js` once against production data to backfill
   existing reports.
2. Run `node scripts/trainRiskModel.js`. If it logs "skipping — not enough data," that's expected
   until there are `MIN_ROWS_TO_TRAIN` (5) labeled barangay-days for a given hazard type.
3. Once a model exists, `predictionEngine.js`'s next cron tick will start using it automatically —
   no restart needed.
4. Toggle "AI Predictions" on in the hazard map's layer panel to see it.

## Known limitations / explicit non-goals

- No real barangay boundary polygons — only centroids exist in this codebase (or anywhere in the
  repo). Point-radius is a stated approximation, not a bug.
- Single unified logistic regression per hazard type, not per-barangay models — barangay identity
  only enters via the static susceptibility feature and the rolling report-rate feature, not a
  separate model per area. Revisit if per-barangay behavior turns out to diverge a lot.
- No Python/scikit-learn service, deliberately — see [Why logistic regression, not a heavier model](#why-logistic-regression-not-a-heavier-model).
  If the labeled dataset eventually grows into the thousands, a heavier model architecture (not
  necessarily a Python service — tfjs supports deeper networks too) is the first thing to revisit.
- `trainRiskModel.js` is not on a cron yet — it's meant to be run manually (or you can add a
  `cron.schedule(...)` call in `alertEngine.js` following the existing pattern once the team is
  comfortable with unattended retraining).

## How to sanity-check locally

```bash
cd server
node --check <any file>          # all files pass; no new syntax errors introduced
node scripts/buildTrainingSet.js flood      # prints row/positive/negative counts, no DB writes
node scripts/trainRiskModel.js              # trains + writes RiskModel docs (needs MONGO_URI)
```

```bash
cd client
npx vite build                    # full production build passes with these changes
```
