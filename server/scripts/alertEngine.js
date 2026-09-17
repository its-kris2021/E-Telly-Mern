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
  // Wrapped like runDailyRetrain/runExpiryCleanup below — an upstream
  // Open-Meteo outage/timeout must not crash the whole process (this runs
  // from a bare setTimeout/cron.schedule callback with no caller to catch
  // it), just get logged and wait for the next scheduled tick.
  try {
    await runFloodEvacuationCheck(); // warms rainfall-hourly + landslide cache
    await runHeavyRainfallCheck();   // reuses warm cache
    await runLandslideCheck();       // reuses warm cache from flood check above
  } catch (err) {
    console.error("[AlertEngine] System checks failed:", err.message);
  }
}

async function runAgencyChecks() {
  console.log("[AlertEngine] Running agency checks…", new Date().toISOString());
  await Promise.allSettled([
    runEarthquakeCheck(),
    runTyphoonCheck(),
    runGDACSCheck(),
  ]);
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
  // The daily flood/landslide risk-model retrain used to run in-process
  // here (cron.schedule("20 3 * * *", ...)). It's now a Heroku Scheduler
  // one-off job (`node server/scripts/trainRiskModel.js`, 19:20 UTC = 3:20am
  // Manila) instead: the retrain briefly needs enough memory to load the
  // full snapshot history, and running it as a throwaway dyno means an OOM
  // there (see buildTrainingSet.js's loadBarangayDaySnapshots header) can
  // never take down the always-on API-serving web dyno the way it used to.
}
