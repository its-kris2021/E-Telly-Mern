/**
 * services/weatherSnapshotService.js
 *
 * Captures a per-barangay weather snapshot every 30 minutes, independent of
 * whether any citizen report was filed. This is the data feed the risk model
 * (services/predictionEngine.js, scripts/trainRiskModel.js) trains and
 * predicts from — snapshots with no matching report become negative training
 * examples, snapshots that coincide with an approved report become positive
 * ones (see scripts/buildTrainingSet.js).
 *
 * All features here are backward-looking (observed, not forecast) as of the
 * snapshot time: rainfall accumulated over the past 1/3/6/24/72 hours, and
 * soil moisture at the current hour. This is deliberate — the same feature
 * definitions have to work for a live 30-min snapshot AND for backfilling
 * historical reports (scripts/backfillWeatherSnapshots.js), and there's no
 * way to know "what was forecast" for an event that already happened months
 * ago, only what actually occurred. See openMeteoCache.js's
 * fetchWeatherSnapshot for the shared fetch this relies on.
 */

import HazardSnapshot from "../models/HazardSnapshot.js";
import { BARANGAY_COORDS } from "../config/barangays.js";
import { fetchWeatherSnapshotBatch, findCurrentHourIndex } from "./openMeteoCache.js";

const BARANGAYS = Object.entries(BARANGAY_COORDS).map(([key, coord]) => ({
  key,
  lat: coord.lat,
  lon: coord.lng,
}));

// Sums hourly precipitation over the last `hours` hours ending at `nowIdx` (inclusive).
function trailingRainSum(precip, nowIdx, hours) {
  let sum = 0;
  for (let i = Math.max(0, nowIdx - hours + 1); i <= nowIdx; i++) {
    sum += precip[i] ?? 0;
  }
  return sum;
}

// refDate defaults to now (live 30-min capture / per-report capture); the
// backfill script passes each report's own timestamp so historical archive
// data is read at the moment the report was actually filed.
export function extractSnapshotFeatures(weatherRaw, refDate = new Date()) {
  const times    = weatherRaw?.hourly?.time ?? [];
  const precip   = weatherRaw?.hourly?.precipitation ?? [];
  const soilTop  = weatherRaw?.hourly?.soil_moisture_0_to_7cm ?? [];
  const soilDeep = weatherRaw?.hourly?.soil_moisture_7_to_28cm ?? [];

  if (times.length === 0) {
    return { rain_1h: 0, rain_3h: 0, rain_6h: 0, rain_24h: 0, rain_72h: 0, soilTop: 0, soilDeep: 0 };
  }

  const nowIdx = findCurrentHourIndex(times, refDate);
  return {
    rain_1h:  trailingRainSum(precip, nowIdx, 1),
    rain_3h:  trailingRainSum(precip, nowIdx, 3),
    rain_6h:  trailingRainSum(precip, nowIdx, 6),
    rain_24h: trailingRainSum(precip, nowIdx, 24),
    rain_72h: trailingRainSum(precip, nowIdx, 72),
    soilTop:  soilTop[nowIdx]  ?? 0,
    soilDeep: soilDeep[nowIdx] ?? 0,
  };
}

export async function captureAllBarangaySnapshots() {
  try {
    const coordsList = BARANGAYS.map(({ lat, lon }) => ({ lat, lon }));
    const batch = await fetchWeatherSnapshotBatch(coordsList);

    if (!batch) {
      console.warn("[WeatherSnapshot] Skipped — Open-Meteo unavailable this cycle");
      return;
    }

    const capturedAt = new Date();
    const docs = BARANGAYS.map(({ key, lat, lon }, i) => ({
      barangay: key,
      lat, lng: lon,
      capturedAt,
      ...extractSnapshotFeatures(batch.data[i]),
    }));

    await HazardSnapshot.insertMany(docs);
    console.log(`[WeatherSnapshot] Captured ${docs.length} barangay snapshots at ${capturedAt.toISOString()}`);
  } catch (err) {
    console.error("[WeatherSnapshot] Capture failed:", err.message);
  }
}
