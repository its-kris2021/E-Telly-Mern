# Hazard Prediction Architecture — Flood & Landslide

E-Telly runs **two independent prediction paths** for "where/when will a flood
or landslide happen," not one. They are complementary, not duplicates: the
system deliberately suppresses an AI alert wherever the rule engine already
covers the same barangay/hazard at an equal-or-higher severity (see
`predictionEngine.js`'s `ruleEngineAlreadyCovers`), so the map never shows two
conflicting markers for the same place.

| | Path 1: Rule-based physics engine | Path 2: ML risk model ("AI") |
|---|---|---|
| Files | `services/floodAlerts.js`, `services/landslideAlerts.js` | `services/predictionEngine.js`, `services/logisticRegression.js` |
| Alert `source` | `"system"` | `"ai"` |
| What it predicts | Whether forecast rainfall + current soil moisture will physically exceed an established hazard threshold, per barangay | The probability that a barangay will produce an *approved citizen report* of the hazard, per barangay |
| Ground truth basis | PAGASA Color-Coded Rainfall Advisory thresholds + MGB (DENR, 2014) geohazard/soil-moisture criteria — published physical thresholds, not trained on local history | Logistic regression trained on historical `HazardSnapshot` + `emergency_reports` data |
| Depends on citizen reports? | **No** — zero report data in the decision logic | **Yes** — both the training label *and* one input feature (`barangayReportRate30d`) are derived from report history |
| Granularity | Per barangay (17 fixed centroids, `config/barangays.js`), live weather/soil pulled per barangay | Per barangay, same centroid set |

## Why two paths, not one

A physics-based threshold model (Path 1) is the defensible, zero-training-data
way to answer "where is a flood/landslide physically likely right now" — it's
literally the same class of model PAGASA/MGB publish thresholds for. It cannot
be customized to local history, though: it treats every barangay the same way
once rainfall/soil numbers are in.

Path 2 exists to catch patterns Path 1's fixed thresholds miss — e.g. a
barangay that historically floods at lower rainfall than the PAGASA cutoff
would suggest. Because Antipolo has no independently verified
flood/landslide-occurrence registry (no MGB/NDRRMC incident log was available
at project time — see dataset-scope note below), the model was trained with
**approved citizen reports as the ground-truth label** — a standard proxy in
disaster-ML literature when no verified incident registry exists, but a proxy
nonetheless, not a direct measurement of occurrence.

## What this means when asked "does the AI predict hazards or reports?"

Literally: Path 2's output is "probability of a report," not "probability of
a landslide." It is a reasonable proxy (real events usually generate reports)
but not equivalent — a landslide with no report is an uncaptured false
negative, and a barangay that over-reports minor events gets inflated
predicted risk. Path 1 is the component that predicts physical hazard
likelihood independent of reporting behavior, and should be cited as such
when the claim "the system predicts hazards, not just displays data" needs to
be demonstrated without the reports caveat.

## Update 2026-10-19: susceptibility feature is now shapefile-grounded, not a hand-picked list

Path 2's `susceptibility` feature previously came from `HIGH_SUSCEPTIBILITY_BARANGAYS`
— a hardcoded 4-barangay list, reused identically for both flood and landslide.
It is now `1 / (1 + distanceKm)`, where `distanceKm` is the real distance from
each barangay centroid to the nearest "High" hazard-class polygon in official
NOAH/MGB-style shapefiles for Rizal province (`Rizal_LandslideHazards.shp` /
`Rizal_Flood_25year.shp`) — a different, hazard-specific table for flood vs.
landslide (`server/config/barangays.js`: `LANDSLIDE_HAZARD_DISTANCE_KM`,
`FLOOD_HAZARD_DISTANCE_KM`; methodology in `server/scripts/computeHazardDistances.py`).

This feature is independent of both citizen reports and of any threshold we
authored — it's third-party geological/hydrological hazard classification.
It does not fix the training-label limitation above (the label is still
"report filed"), but it meaningfully strengthens one input to Path 2 beyond
the report-history feature, and is a defensible answer if asked "is any part
of the AI model independent of citizen reports?"

Point-in-polygon containment (rather than distance) was tried first and
rejected: most of the 17 barangay centroids fell in gaps between the mapped
hazard polygons (which delineate specific susceptible patches, not the whole
province), including barangays on MGB's own high-susceptibility list. No
barangay boundary polygons exist in this codebase for a proper area-overlap
join, so distance-to-nearest-High-zone was used instead.

**Action required, not yet done:** `scripts/trainRiskModel.js` must be re-run
against the live database to retrain both RiskModel docs with this new
feature — the old trained weights/standardization stats were fit against the
binary 0/1 signal, not this continuous one.

## Known data-scope caveat

`floodAlerts.js`'s daily-accumulation thresholds (p95/p99, supplementing the
PAGASA hourly tiers) are calibrated against a 2011–2025 daily rainfall record
for **Tanay, Rizal** (`Tanay Daily Data.csv`), a neighboring municipality in
the same Sierra Madre/Marikina watershed — used only as a reference
distribution because no equivalent long-run daily series for Antipolo itself
was available. This is disclosed in-code and should be disclosed the same way
in the manuscript; it does not affect Path 1's PAGASA hourly-intensity tiers
or Path 2's model, both of which use live Antipolo-coordinate data.

## Source citations (carried into every alert description)

- Open-Meteo forecast/historical API — Zippenfenig, P. (2023). doi:10.5281/zenodo.7970649
- PAGASA Color-Coded Rainfall Advisory System
- MGB Geohazard Assessment criteria (MGB, DENR, 2014)
