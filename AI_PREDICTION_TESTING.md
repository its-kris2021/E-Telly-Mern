# Testing the AI Prediction Feature

How to verify the hazard-prediction pipeline (`AI_HAZARD_PREDICTION.md`) is actually working, end
to end, without waiting on 30-minute crons or months of live data. Read `AI_HAZARD_PREDICTION.md`
first if you haven't — this doc assumes you know the phases (weather snapshots → training set →
`RiskModel` → `predictionEngine.js` → `source:"ai"` alerts → feedback loop) and just walks through
checking each one.

If you haven't run the historical seed yet, do that first — see
[`HISTORICAL_DATA_PIPELINE.md`](./HISTORICAL_DATA_PIPELINE.md). Without it there's no training
data, and "nothing happens" is correct behavior, not a bug (see
[Troubleshooting](#troubleshooting) below).

## Quick smoke test (5 minutes)

```bash
cd server
node --check services/predictionEngine.js services/logisticRegression.js services/riskFeatures.js
node scripts/buildTrainingSet.js flood        # prints row/positive/negative counts, no DB writes
node scripts/trainRiskModel.js                # trains + writes RiskModel docs, needs MONGO_URI
```

If `trainRiskModel.js` logs `Trained v1 — rows=... positives=... precision=... recall=... auc=...`
for both `flood` and `landslide`, a model exists. If it logs "skipping — not enough data", you
need more labeled rows first (see Phase 2 below).

## Phase 1 — is there training data?

The model can't do anything without labeled `(barangay, day)` rows joining `HazardSnapshot`
(weather) with approved reports.

```bash
cd server
node scripts/buildTrainingSet.js flood
node scripts/buildTrainingSet.js landslide
```

**Pass:** prints a row count, positive count, negative count for each hazard type, no DB writes.
**Fail:** 0 rows → either `HazardSnapshot` is empty (weather-snapshot cron hasn't run yet, or you
skipped the historical backfill) or there are no approved reports of that type. Check counts
directly:

```js
// mongosh, or a one-off node script
db.hazardsnapshots.countDocuments()
db.emergency_reports.countDocuments({ status: "approved" })
```

## Phase 2 — does training produce a model?

```bash
cd server
node scripts/trainRiskModel.js
```

**Pass:** logs a version, row/positive counts, and precision/recall/f1/auc for each hazard type,
then a `RiskModel` doc exists:

```js
db.riskmodels.find({ isActive: true }).pretty()
```

You should see one active doc per `hazardType` (`flood`, `landslide`) with `weights`, `bias`,
`featureMeans`, `featureStds`, and a `metrics` object.

**Fail:** "skipping — not enough data" means fewer than `MIN_ROWS_TO_TRAIN` (5) labeled rows for
that hazard type — go back to Phase 1. A crash here (not a skip) is a real bug, not a data
problem.

## Phase 3 — does the prediction engine score correctly?

`predictionEngine.js` only runs on a 30-min cron via `alertEngine.js`. To test it immediately
instead of waiting, call it directly:

```bash
cd server
node -e "
import('./services/predictionEngine.js').then(async ({ runPredictionChecks }) => {
  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(process.env.MONGO_URI || require('dotenv').config().parsed.MONGO_URI);
  console.log('Connected — running prediction checks...');
  await runPredictionChecks();
  console.log('Done.');
  await mongoose.disconnect();
  process.exit(0);
});
"
```

(Simplest reliable version: copy `scripts/trainRiskModel.js`'s CLI block — connect via
`mongoose.connect(process.env.MONGO_URI)`, `await runPredictionChecks()`, disconnect — into a
throwaway script if the inline `node -e` above fights with your shell's quoting.)

Watch the console for one line per barangay/hazard pair that crosses the confidence threshold:

```
[PredictionEngine] flood/mambugan — probability=0.72 severity=warning
```

**Pass:** at least the log line appears (or, on a quiet weather day, *no* lines — that's correct if
no barangay currently crosses 0.6 probability, not a failure). Check what actually got written:

```js
db.alerts.find({ source: "ai", isActive: true }).pretty()
```

**Fail modes that are working-as-intended, not bugs:**
- No `source:"ai"` alerts and no log lines: current weather conditions genuinely don't cross the
  0.6 probability threshold anywhere. Try again during/after real rainfall, or temporarily lower
  `CONFIDENCE_THRESHOLD` in `predictionEngine.js` locally to confirm the scoring path itself works.
- A barangay you expected an AI alert for has none: check whether a `source:"system"` (rule-based)
  alert of equal-or-higher severity already exists for that barangay/type —
  `ruleEngineAlreadyCovers()` deliberately suppresses the AI alert in that case (see
  `AI_HAZARD_PREDICTION.md` §4).

## Phase 4 — does it show up on the map?

1. Log in to the client, open the hazard map.
2. Open the layer control panel, toggle **AI Predictions** on (it's off by default).
3. If Phase 3 produced any `source:"ai"` alerts, you should see **dashed-border** markers
   (distinct from the solid rule-based ones) with a confidence % badge and "not yet confirmed"
   label.
4. If logged in as an admin, the popup should show **Confirm** / **Mark false positive** buttons.

**Pass:** dashed markers render with the right confidence %. **Fail:** if `GET /api/alerts`
(check via browser devtools Network tab) already returns the `source:"ai"` alert but nothing
renders, it's a frontend layer bug (`AiPredictionLayer.jsx`), not a prediction-engine bug — isolate
which side is broken before debugging further.

## Phase 5 — does the feedback loop work?

Four independent things to check:

**a. Manual admin confirm/reject** (needs an admin JWT):
```bash
curl -X PATCH http://localhost:5000/api/alerts/<alertId>/confirm \
  -H "Authorization: Bearer <admin-token>"
curl -X PATCH http://localhost:5000/api/alerts/<alertId>/reject \
  -H "Authorization: Bearer <admin-token>"
```
**Pass:** `confirmedOutcome` flips to `true_positive`/`false_positive`, `confirmedBy` is set to the
admin's name, and the map/UI update live (socket `alert_updated` event).

**b. Auto-confirm from a matching report** — submit a new report (`POST /api/reports/create`) of
the same `emergencyType` and barangay as an existing unconfirmed AI alert.
**Pass:** the AI alert's `confirmedOutcome` becomes `true_positive` with
`confirmedBy: "auto:linked_report"`, with no admin action needed.

**c. Auto-false-positive on expiry** — let an unconfirmed AI alert's `expiresAt` (6h after
creation) pass, then wait for the next system-checks cron tick (or call `runExpiryCleanup()`
directly the same way as Phase 3).
**Pass:** `confirmedOutcome` becomes `false_positive`, `confirmedBy: "auto:expired_unconfirmed"`.

**d. Metrics reflect outcomes** — after (a)/(b)/(c), hit the admin metrics endpoint:
```bash
curl http://localhost:5000/api/admin/model-metrics -H "Authorization: Bearer <admin-token>"
```
**Pass:** `currentOutcomes.truePositives`/`falsePositives`/`unconfirmed` counts match what you just
did. In the client, the same numbers should appear in `ModelPerformancePanel.jsx` on the Alerts
page (admin only).

## Writing an automated test

There's no AI-specific automated test yet. The repo already has a Jest + `mongodb-memory-server`
pattern for other features (`server/__tests__/chatModeration.test.js`,
`server/__tests__/helpers/testDb.js`) — follow that shape:

```js
import { startTestDb, stopTestDb, clearTestDb } from "./helpers/testDb.js";
import RiskModel from "../models/RiskModel.js";
import HazardSnapshot from "../models/HazardSnapshot.js";
import { runPredictionChecks } from "../services/predictionEngine.js";
import Alert from "../models/Alert.js";

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearTestDb);

test("creates an AI alert when probability crosses threshold", async () => {
  await RiskModel.create({ hazardType: "flood", version: 1, isActive: true, weights: [...], bias: 0, featureMeans: [...], featureStds: [...] });
  // seed a HazardSnapshot / mock fetchWeatherSnapshotBatch that yields high-rain features
  await runPredictionChecks();
  const alerts = await Alert.find({ source: "ai" });
  expect(alerts.length).toBeGreaterThan(0);
});
```

The realistic seam to mock is `fetchWeatherSnapshotBatch` in `services/openMeteoCache.js` (avoid a
real Open-Meteo call in tests) — everything downstream (`riskFeatures.js`,
`logisticRegression.js`, `predictionEngine.js`) is pure/deterministic given a fixed weather input
and model weights, so it's straightforward to assert against.

Run with:
```bash
cd server
npm test
```

## Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| `buildTrainingSet.js` prints 0 rows | No `HazardSnapshot` docs, or no approved reports | Run the historical backfill (`HISTORICAL_DATA_PIPELINE.md`), or let the live 30-min snapshot cron accumulate data |
| `trainRiskModel.js` says "skipping — not enough data" | Fewer than 5 labeled barangay-days | Same as above — this is the correct cold-start behavior, not a bug |
| No `source:"ai"` alerts ever appear | Current conditions don't cross 0.6 probability anywhere, or a rule-based alert already covers every risky barangay | Temporarily lower `CONFIDENCE_THRESHOLD` in `predictionEngine.js` locally to confirm the pipeline itself fires |
| AI alerts exist in the DB but nothing renders on the map | Frontend layer issue, not a backend one | Check `GET /api/alerts` response directly, then check `AiPredictionLayer.jsx` and that the "AI Predictions" layer toggle is on |
| Confirm/reject requests 403 | Role/barangay scoping | `confirm`/`reject` require `cdrrmo` or `barangay_official`; a `barangay_official` can only act on alerts inside `req.user.assignedBarangay` |
| `predictionEngine.js` throws instead of logging and returning | Actual bug — the whole file is supposed to fail soft | Check the specific per-barangay try/catch in `runPredictionChecks()`; it should log and continue, never propagate |

## What "working" means at this project's scale

A precise probability isn't the bar — there's realistically only tens to low-hundreds of labeled
rows (see `AI_HAZARD_PREDICTION.md`'s rationale for a hand-rolled logistic regression over a real
ML stack). "Working" means: the pipeline runs without throwing, produces a model when there's
enough data, that model's offline `metrics` (precision/recall/AUC, visible in
`ModelPerformancePanel.jsx`) are meaningfully above chance, and confirmed vs. false-positive field
outcomes trend in the right direction as more reports come in — not that every prediction is
correct.
