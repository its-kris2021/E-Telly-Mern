# AI Model Performance — Beginner's Guide

This is for you if you don't come from an ML/data science background but need to understand — and
be able to explain — how ETELLY's AI hazard-prediction feature actually works, how it "upgrades"
its version, and what precision/recall/accuracy really mean here. Written directly from the
**actual code** in this project (`server/services/logisticRegression.js`,
`server/scripts/trainRiskModel.js`, `server/models/RiskModel.js`), not generic ML theory — so if
you read it alongside those files, everything should match up.

If you want a more technical/architecture-level overview, read `AI_HAZARD_PREDICTION.md`. This
one is more of a walkthrough — **"how does this actually work and why do the numbers look like
this."**

---

## 1. The simplest possible summary

The AI here isn't a chatbot or a "big" AI — it's a **logistic regression model**, which is
basically the simplest class of machine learning. Its job: look at the weather conditions (rain,
soil, wind, etc.) in a barangay, and tell you, **"what percent chance is there of a flood or
landslide here right now?"**

It learns by looking at **past data**: "when conditions were like this in Barangay X before, was
there an actual recorded flood?" If the answer was "yes" often enough under similar conditions,
the model learns to raise its predicted risk the next time those conditions recur.

```
Weather data (right now)  →  [AI MODEL]  →  "72% chance of flooding in Barangay Mambugan"
      ↑
It learned this earlier from: past weather + real reported flood/landslide incidents
```

---

## 2. Where the data comes from (2 kinds)

### A. Training data — what the model "studied" (happens occasionally, not real-time)

| Source | What it is | How much |
|---|---|---|
| Historical import | `Capstone_Antipolo-Dataset.xlsx`, CDRRMO/city records 2020–2025 | 397 rows |
| Live/crowd-sourced reports | Real reports from residents (mobile app) or manual entry by CDRRMO/barangay officials, as long as they're **approved** or **resolved** (verified) | grows as the app keeps running |
| Weather history | `HazardSnapshot` — rainfall, soil moisture, wind, etc. per barangay per day, from Open-Meteo | one per barangay per day |

`buildTrainingSet.js` joins these: for every (barangay, day) — "what was the weather?" +
"was there a real recorded hazard?" → one **training row**.

### B. Live/inference data — what the model "reads" to actually predict right now

Every 30 minutes, the system fetches **current** weather (not historical) for all 17 barangays,
and feeds it into the model's already-saved "brain" (weights). This is where the actual
prediction you see on the Hazard Map comes from.

**Important:** the model's "brain" (the weights) comes from Part A — it does **not** change every
30 minutes. It only changes when there's a **new training run** (see Part 3 below).

---

## 3. How it "upgrades" versions (v1 → v2 → v3 → ...)

**Important to clarify up front:** there's no fixed "v1 through v9" plan — the version number is
**unbounded**, and automatically increments on every successful retrain. If the retrain has run 50
times, you'll have v1 through v50.

### When it runs

```js
// server/scripts/alertEngine.js
cron.schedule("20 3 * * *", runDailyRetrain, { timezone: "Asia/Manila" });
```

**Every day at 3:20 AM (Manila time), automatically** — no one needs to run it by hand anymore
(though it can still be triggered manually via `node scripts/trainRiskModel.js` if needed).

### What happens on each retrain

1. **All** training data is pulled again (not just "new" data — the full dataset, from the start)
2. The model is retrained from scratch (it does **not** continue from where it left off — it
   always starts from the same `defaultPriorWeights`, so results stay consistent and reproducible
   instead of drifting if one run happened to overfit)
3. Metrics are computed (precision, recall, F1, AUC — see Part 4)
4. **There's a safety check before anything gets promoted:**
   ```js
   // isValidTrainedModel() — trainRiskModel.js
   ```
   This checks whether the training run actually broke (NaN, infinity, a threshold outside the
   0–1 range, etc.)
5. If it passes: a new `RiskModel` document is created with **one higher version number**
   (`lastVersion + 1`), and it becomes the active one
6. If it doesn't pass (error, or not enough data): **no new version is created** — the previous
   version stays active. Nothing about the existing model gets broken or downgraded.

### Important: a version bump does NOT automatically mean better accuracy

Every successful retrain = a new version number, **but that's not a guarantee** the new version
is better than the last one. Metrics can go down if, for example, the incoming batch of new
reports happens to be a bit noisier. That's why the code comments describe the system as
**"calibrating," not always "improving."** This is exactly why tracking metrics history per
version matters — it's the only way to actually tell whether things are getting better over time.

---

## 4. How many reports are needed?

### Minimum just to ATTEMPT training

```js
const MIN_ROWS_TO_TRAIN = 5; // trainRiskModel.js
```

**5 labeled barangay-days** (not 5 reports — 5 **barangay+day combinations** that have weather
data) is the absolute floor before the system even attempts to train. Below that, it just skips —
no new version, and the system keeps relying on the existing rule-based alerts (not AI) in the
meantime.

**Important:** this "5" is just an **absolute floor** to keep the statistics from breaking — it
does **not** mean the model is good at 5 rows. In fact:

```js
const notes = positiveCount < 5
  ? `Only ${positiveCount} positive example(s) — treat as a lightly-calibrated prior, not a
     confident model yet.`
  : "";
```

If there are fewer than 5 **positive cases** (days where a hazard actually occurred), the system
literally flags its own model as "not confident yet."

### How much is actually "enough"

There's no exact number — but by the project's own design intent (`AI_HAZARD_PREDICTION.md`):

> "Realistic dataset size ... is tens to low hundreds of labeled report-days" — which is exactly
> why logistic regression was chosen instead of a heavier model (random forest, neural network),
> which would overfit at this scale.

In other words: this isn't "more is always better without limit" — the model was deliberately
designed for **hundreds** of rows, not thousands. What matters more is:
- Enough **positive cases** (real flood/landslide incidents) — since these are rare to begin
  with (~0.5% of barangay-days for flood, ~0.3% for landslide), real reports need to keep
  accumulating (not just "any" reports — ones that are **approved/resolved**, i.e. verified)
- Consistent weather-snapshot capture (every 30 min, already automatic) so there are also
  "negative examples" — days when nothing happened, which the model also needs to learn what
  "normal/safe" conditions look like

---

## 5. Precision, Recall, and "Accuracy" — the metrics

### The problem with "accuracy" (why it's not used here)

In ML, "accuracy" simply means: *(correct predictions) / (all predictions)*. This is
**misleading** in our case because real floods/landslides are extremely rare (~0.5%/0.3% of days).
If the model just said **"no hazard"** every single time, it would still score ~99.5% "accuracy"
— but it would be **useless**, since it would never actually catch a real hazard. That's why
"accuracy" isn't used as the headline metric here — instead, three others are used:

### Precision — "When the AI raises an alarm, how often is it right?"

```
precision = TP / (TP + FP)
```

- **TP (True Positive):** the AI said "there's risk," and it was RIGHT — a real hazard was
  recorded
- **FP (False Positive):** the AI said "there's risk," but it was WRONG — a false alarm

**Example:** the AI raised an alert 10 times, and 7 of those had a real recorded flood →
`7/10 = 70% precision`. Higher precision = fewer false alarms.

### Recall — "Of everything that really happened, how much did the AI catch?"

```
recall = TP / (TP + FN)
```

- **FN (False Negative):** a real hazard happened, but the AI did NOT predict/alert it (a miss)

**Example:** there were 10 real floods over some period, and the AI only predicted 6 of them
before/during → `6/10 = 60% recall`. Higher recall = fewer missed real hazards.

### There's a trade-off between them

If you make the AI "stricter" before it alerts (a higher threshold), precision goes up (fewer
false alarms) but recall goes down (more real hazards get missed). The opposite happens if you
make it "looser."

### F1 — the "balance" between precision and recall

```
f1 = 2 × (precision × recall) / (precision + recall)
```

This is used to pick the **best cutoff point** (`operatingThreshold`) — not a default 0.5, but
whichever threshold **maximizes F1** on this project's real data (the `findOptimalThreshold()`
function). This matters because at the default 0.5, precision/recall almost always come back
"n/a" or "0.00" (since positive cases are so rare), even when the model has genuinely learned
something — so the threshold has to be found relative to the model's own actual output
distribution.

### AUC — the metric that actually reflects model quality here

```
AUC = 0.91 (flood), 0.94 (landslide)  ← current model, offline cross-validation
```

Unlike precision/recall, which need a cutoff/threshold first, **AUC is threshold-independent** —
it measures how well the model can **separate** "high-risk" days from "low-risk" days, regardless
of whatever cutoff gets used later.

- `AUC = 0.50` → essentially random guessing, nothing learned
- `AUC = 1.00` → perfect separation
- `AUC = 0.91/0.94` (current) → far from random — the model has genuinely learned a real pattern
  connecting weather conditions to real hazards

**This is the metric to cite to a panel** when asked "how good is your AI model" — not
precision/recall (which are often n/a due to rare positives), but AUC.

### Offline metrics vs. Field metrics — these are different!

| | Offline `metrics` | `fieldMetrics` |
|---|---|---|
| What it is | Cross-validation on **historical** data (splitting the training set, testing on the "unseen" portion) | What actually happened with **real AI alerts** in the live system |
| Source | `kFoldCrossValidate()` on `buildTrainingSet.js`'s data | Admin confirm/reject of AI alerts (`routes/alerts.js`), or auto-confirm when a matching new report comes in |
| When refreshed | Every retrain | Every retrain (but these are real counts, not a simulation) |

Offline metrics answer "how good is the model based on past data," while fieldMetrics answers
**"is it actually working in the real world, not just in theory"** — that's the real proof.

---

## 6. Where to see this in the app

- `GET /api/admin/model-metrics` — endpoint that returns version history (last 20 versions per
  hazard type) + running totals of confirmed/false-positive/unconfirmed outcomes
- `client/src/components/admin/ModelPerformancePanel.jsx` — UI panel (on the Alerts page,
  admin-only) that shows this visually: the current version's precision/recall/AUC, a
  field-outcome bar (confirmed vs. false-positive), and a version history table
- On the Hazard Map: the "AI Predictions" layer (off by default) — dashed-border markers with a
  confidence % badge

---

## 7. Glossary — terms worth knowing

| Term | Meaning |
|---|---|
| **Barangay-day** | One row of training data = one barangay, on one specific day. This is the "unit" the model learns from, not each individual report. |
| **Label** | The correct answer the model is trying to learn: `1` = a real hazard happened, `0` = it didn't |
| **Feature** | One "ingredient" of weather data the model looks at: `rain_6h`, `rain_24h`, `soilTop`, `soilDeep`, `windSpeed10m`, `surfacePressure`, `et0_24h`, `riverDischarge`, `barangayReportRate30d`, `susceptibility` — 10 total |
| **Weights** | What the model "learned" — each feature has an associated number saying how much it affects risk. A bigger weight = more influence on the prediction |
| **Threshold / operatingThreshold** | The probability "cutoff" before something counts as "at risk." E.g. if the threshold is 0.15, even a 16% chance counts as "at risk" — this has to be low because real positive cases are so rare |
| **Standardization** | Putting every feature on the same scale (e.g. rain is in mm, pressure is in hPa — very different ranges) so the model judges every feature fairly |
| **Cross-validation (k-fold)** | A way of "testing" the model using the training data itself — split into 5 groups, train on 4, test on the "held-out" 1, repeated until every group has been the test set once |
| **L2 regularization** | A "restraint" that stops the model from becoming overconfident/overfit on small data — it keeps weights small unless the data provides strong evidence otherwise |
| **Prior weights** | The model's starting "guess" before it's seen any real data — mild, common-sense assumptions (e.g. "more rain = more risk") so the first predictions aren't random/nonsensical |
| **Gated against rule engine** | The AI doesn't just alert freely — it first checks whether an existing rule-based alert (the PAGASA-threshold one, not AI) of equal or greater severity already exists; if so, it skips, so the AI alert never duplicates it |

---

## 8. Quick FAQ

**Q: Why logistic regression only, why not something more advanced?**
A: The dataset is small (hundreds, not thousands) — a heavier model would overfit (essentially
"cram" on the small data instead of learning a real pattern). Bonus: it's fully auditable — you
can trace exactly which feature drove any given prediction.

**Q: How does accuracy improve over time?**
A: Through the daily retrain (3:20 AM), which reads **all** available training data (including
newly verified reports) and retrains the model from scratch. It's not "gradually learning" while
running — it's more accurate to say it "restarts from zero" on every retrain, using a larger
dataset than last time.

**Q: What happens if there are no new reports yet?**
A: No new version gets created — the same active model just keeps being used. Nothing gets
"downgraded" or broken; it's simply "no change" and that's safe.

**Q: How do you know the AI is actually "working"?**
A: Not by getting 100% correct predictions (that's not the bar) — but by: (1) running without
errors, (2) producing a model once there's enough data, (3) offline AUC being well above 0.5
(random), and (4) fieldMetrics (real confirm/false-positive counts) trending in the right
direction as more real reports accumulate.
