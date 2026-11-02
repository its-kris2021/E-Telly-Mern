# How E-Telly's AI Hazard Prediction Works (Plain-Language Guide)

This document explains the AI part of E-Telly's flood/landslide alert system
without assuming any machine-learning background. It exists so a reviewer,
panel member, or new team member can understand *what the AI does, how it
decides, and why it can be trusted* without needing to read source code or
know what a "logistic regression" or "threshold" is.

## 1. What it does, in one sentence

Every 30 minutes, the system looks at current weather and ground conditions
in each barangay and asks: *"Do these conditions look like the ones that led
to a flood or landslide in the past?"* If the answer is yes with enough
confidence, it raises a flag for a human official to check — it never sends
an evacuation order by itself.

## 2. Why have an AI on top of the existing rule-based alerts?

E-Telly already has a rule-based system: if PAGASA rainfall data or soil
moisture sensors cross a known danger line, it fires an alert automatically.
That system is reliable but rigid — it can only catch the exact conditions
it was explicitly told to watch for.

The AI's job is different: instead of a fixed line, it learned the *pattern*
of past flood/landslide days from historical data, so it can sometimes
notice a brewing risk the fixed rules would miss, a few hours or a day
before the rule-based thresholds are actually crossed. The two systems are
kept from stepping on each other — if the rule-based system has already
flagged a barangay for a hazard, the AI does not also fire a second,
possibly contradicting alert for the same spot.

## 3. What it actually looks at

The AI doesn't look at anything a trained emergency responder wouldn't also
check. It weighs ten live signals per barangay, in four natural groups:

- **Recent rainfall** — how much rain fell in the last 6 hours, and in the
  last 24 hours.
- **How wet the ground already is** — moisture near the surface, and deeper
  underground (saturated soil is far more likely to flood or slide than dry
  soil getting the same rain).
- **River conditions** — how much water is currently flowing through nearby
  rivers.
- **Storm signals and this area's own history** — wind speed, air pressure,
  evaporation (all of which shift during storm systems), how often this
  specific barangay has reported hazards in the last 30 days, and how close
  it sits to a zone officially mapped as high-hazard.

No single one of these decides anything by itself — the AI weighs all ten
together, the same way a human reading a weather report and a hazard map
side-by-side would.

## 4. How it decides when to actually speak up

The AI doesn't raise a flag every time rain picks up — if it did, it would
cry wolf constantly and officials would learn to ignore it. Instead, it only
speaks up once conditions clear a bar that was deliberately tuned against
real historical outcomes: tested against past barangay-days to find a
cutoff that catches genuine risk without firing on every ordinary rainy day.

That bar isn't fixed forever — it gets re-tuned as more real, reviewed
outcomes come in, the same way a weather forecaster recalibrates a model
after a season of results.

## 5. It never acts alone — a human always reviews it

This is the most important part: **every single AI flag is labeled as a
prediction, not a confirmed hazard**, and nothing happens automatically
beyond that. Concretely:

- The flag shows up in a review list on the CDRRMO/barangay official
  dashboard (`AiPredictionReviewPanel.jsx` in the web app), alongside the
  hazard map.
- An official reads it and either **confirms** it ("yes, this hazard
  actually happened") or **rejects** it ("false alarm") with one tap.
- If nobody reviews it within 24 hours, it automatically expires — it does
  not stay "live" forever waiting for someone to notice it.

In other words, the AI's role is to say *"a human should look at this,"*
never *"act now."* The decision always stays with a person.

## 6. Is it actually learning, or just guessing?

Short answer: it's genuinely learning from real data, and recent fixes
measurably improved it — but it is still an early-stage model trained on a
small, real-world dataset, and that shows up honestly in the numbers below.

The fairest way to test a model like this is to hide the most recent year
of real outcomes from it during training, then check whether it can tell a
true flood/landslide day apart from a normal day in that hidden year. Doing
exactly that test on E-Telly's current models:

- **Flood**: the model correctly ranks a true flood day above a normal day
  roughly **8 times out of 10**. It caught 4 of the 22 real flood days in
  the test period that the rule-based system caught *zero* of.
- **Landslide**: the model correctly ranks a true landslide day above a
  normal day roughly **9 times out of 10**. It caught 9 of the 12 real
  landslide days in the test period that the rule-based system caught *zero*
  of.

That's the headline win: on real held-out data, the AI finds genuine events
the rule-based system structurally cannot, because those events never
crossed a fixed threshold.

## 7. The honest limitations — said plainly, not buried

- **Most individual flags are still false alarms.** Real flood/landslide
  days are extremely rare — under half a percent of all barangay-days — so
  even a model that's clearly better than chance will flag many more days
  than actually flood or slide. In concrete terms, a given barangay might
  see roughly 2-3 AI flags a month that turn out to be false alarms. This is
  a known, expected tradeoff of trying to catch rare events early (the same
  tradeoff every early-warning system — medical screening, earthquake
  alerts — makes), and it is exactly *why* a human reviews every flag before
  anything is treated as confirmed, rather than the model being trusted to
  decide on its own.
- **The training data is still small.** It's built from tens to a few
  hundred confirmed hazard events across the project's history — enough to
  show the model has real signal, not enough for its accuracy to be called
  final or high-stakes-grade yet.
- **"No report" doesn't always mean "no hazard."** The model learns from
  citizen and CDRRMO reports, not from verified ground-truth sensors — a
  real small event that nobody reported looks identical to "nothing
  happened" from the model's point of view. This is a ceiling on how
  accurate it can honestly claim to be until a better ground-truth source
  exists.
- **It will keep changing as more real outcomes come in.** Every confirm/
  reject an official makes feeds back into how the model is judged and
  retrained — it's expected to keep improving (or get recalibrated) over
  time, not be a finished, static product.

## 8. Where to see it actually running

For a live demo rather than just reading about it:

- **Hazard map** — AI-predicted markers render on their own layer, visually
  distinct from rule-based alerts (`components/map/predictions/AiPredictionLayer.jsx`).
- **Alerts page** — a dedicated "AI Predictions Pending Review" list shows
  every unconfirmed AI flag with a Confirm/Reject action
  (`components/admin/AiPredictionReviewPanel.jsx`), visible to
  CDRRMO and barangay-official accounts.
