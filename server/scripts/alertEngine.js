/**
 * scripts/alertEngine.js
 *
 * Cron orchestrator — schedules and sequences all hazard checks.
 *
 *  System checks (every 15 min):  flood evacuation → heavy rainfall → landslide
 *  Agency checks (every 30 min):  earthquake + typhoon + GDACS (run in parallel)
 *
 * Each check lives in its own service module under server/services/.
 * Open-Meteo calls share the cache in openMeteoCache.js — no duplicate fetches.
 */

import cron from "node-cron";
import Alert from "../models/Alert.js";
import { runFloodEvacuationCheck, runHeavyRainfallCheck } from "../services/floodAlerts.js";
import { runLandslideCheck }       from "../services/landslideAlerts.js";
import { runEarthquakeCheck }      from "../services/earthquakeAlerts.js";
import { runTyphoonCheck }         from "../services/typhoonAlerts.js";
import { runGDACSCheck }           from "../services/gdacsAlerts.js";
import { captureAllBarangaySnapshots } from "../services/weatherSnapshotService.js";
import { runPredictionChecks }     from "../services/predictionEngine.js";
import { trainRiskModels }         from "./trainRiskModel.js";

async function runExpiryCleanup() {
  try {
    const expiring = await Alert.find(
      { isActive: true, expiresAt: { $lt: new Date() } },
      { _id: 1, source: 1, confirmedOutcome: 1 },
    ).lean();
    if (expiring.length === 0) return;

    const ids = expiring.map((a) => a._id);
    await Alert.updateMany(
      { _id: { $in: ids } },
      { $set: { isActive: false, updatedAt: new Date() } },
    );

    // Unconfirmed AI predictions that expired with no report ever backing
    // them up — treat as a false positive. predictionEngine.js's own gating
    // against active rule-based alerts already prevents the "AI just
    // duplicated a real alert" case from reaching here.
    const aiUnconfirmedIds = expiring
      .filter((a) => a.source === "ai" && a.confirmedOutcome === "unconfirmed")
      .map((a) => a._id);
    if (aiUnconfirmedIds.length > 0) {
      await Alert.updateMany(
        { _id: { $in: aiUnconfirmedIds } },
        {
          $set: {
            confirmedOutcome: "false_positive",
            confirmedBy: "auto:expired_unconfirmed",
            confirmedAt: new Date(),
          },
        },
      );
    }

    console.log(
      `[AlertEngine] Expiry cleanup — deactivated ${expiring.length} expired alert(s)` +
      (aiUnconfirmedIds.length > 0 ? `, ${aiUnconfirmedIds.length} unconfirmed AI prediction(s) auto-marked false positive` : ""),
    );
  } catch (err) {
    console.error("[AlertEngine] Expiry cleanup failed:", err.message);
  }
}

async function runSystemChecks() {
  console.log("[AlertEngine] Running system checks…", new Date().toISOString());
  // Expiry cleanup runs first so stale alerts are gone before new ones are scored.
  await runExpiryCleanup();
  await runFloodEvacuationCheck(); // warms rainfall-hourly + landslide cache
  await runHeavyRainfallCheck();   // reuses warm cache
  await runLandslideCheck();       // reuses warm cache from flood check above
}

async function runAgencyChecks() {
  console.log("[AlertEngine] Running agency checks…", new Date().toISOString());
  await Promise.allSettled([
    runEarthquakeCheck(),
    runTyphoonCheck(),
    runGDACSCheck(),
  ]);
}

// Retrains the flood/landslide risk models against whatever reports +
// weather history have accumulated since the last run. Wrapped the same way
// every other scheduled job here is — a thrown error must not take down the
// cron scheduler, just get logged and wait for tomorrow's run. The actual
// promotion safety (only activate a new version if training succeeded and
// its metrics pass sanity checks; otherwise keep serving the previous
// version) lives in trainRiskModel.js's trainOne() — this wrapper only has
// to make sure a failure here can't crash the process or block the 30-min
// prediction/snapshot crons below.
async function runDailyRetrain() {
  console.log("[AlertEngine] Running daily risk-model retrain…", new Date().toISOString());
  try {
    const { flood, landslide } = await trainRiskModels();
    if (flood.status !== "promoted" || landslide.status !== "promoted") {
      console.log(
        `[AlertEngine] Daily retrain: not every model was promoted this run ` +
        `(flood: ${flood.status}, landslide: ${landslide.status}) — previous active version(s) ` +
        `for any non-promoted hazard type keep serving live predictions unchanged.`,
      );
    }
  } catch (err) {
    console.error("[AlertEngine] Daily retrain failed:", err.message);
  }
}

export function startAlertEngine() {
  // Short startup delays let Express finish binding before the first upstream fetch.
  setTimeout(runSystemChecks, 2000);              // cache-backed — safe on startup
  setTimeout(runAgencyChecks, 7000);               // staggered so cache is warm first
  setTimeout(captureAllBarangaySnapshots, 12000);  // training-data capture, runs last on startup
  setTimeout(runPredictionChecks, 17000);          // AI layer — after rule-based alerts + snapshot exist

  cron.schedule("*/15 * * * *", runSystemChecks,              { scheduled: true, timezone: "Asia/Manila" });
  cron.schedule("*/30 * * * *", runAgencyChecks,               { scheduled: true, timezone: "Asia/Manila" });
  // Own cache namespace (fetchWeatherSnapshotBatch, see openMeteoCache.js) —
  // offset by 5 min from the other jobs purely to spread upstream Open-Meteo
  // load, not because it shares a cache entry with them.
  cron.schedule("5,35 * * * *", captureAllBarangaySnapshots, { scheduled: true, timezone: "Asia/Manila" });
  // Runs 2 min after captureAllBarangaySnapshots so its weather-snapshot cache
  // is warm, and well after runSystemChecks so it sees this cycle's rule-based
  // alerts when deciding whether the rule engine already covers a barangay.
  cron.schedule("7,37 * * * *", runPredictionChecks,         { scheduled: true, timezone: "Asia/Manila" });
  // Daily retrain, off-peak (3:20am Manila). Minute 20 falls on none of the
  // */15, */30, "5,35", or "7,37" marks used above, so it never starts on
  // the exact same tick as another job — though at ~5 minutes of real
  // training time it can still run alongside a 3:30am tick; that's fine,
  // since trainOne() (trainRiskModel.js) never leaves predictionEngine.js
  // without an active model to read even if a retrain is mid-flight. Not on
  // startup: retraining every deploy/restart would waste time re-fitting on
  // data that likely hasn't changed since the last run.
  cron.schedule("20 3 * * *", runDailyRetrain,                { scheduled: true, timezone: "Asia/Manila" });
}
