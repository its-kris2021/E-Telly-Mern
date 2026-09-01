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
import { fetchWeatherSnapshotBatch, fetchRiverDischargeBatch, findCurrentHourIndex } from "./openMeteoCache.js";

const BARANGAYS = Object.entries(BARANGAY_COORDS).map(([key, coord]) => ({
  key,
  lat: coord.lat,
  lon: coord.lng,
}));

// Sums an hourly series over the last `hours` hours ending at `nowIdx` (inclusive).
function trailingSum(series, nowIdx, hours) {
  let sum = 0;
  for (let i = Math.max(0, nowIdx - hours + 1); i <= nowIdx; i++) {
    sum += series[i] ?? 0;
  }
  return sum;
}

// Finds the index of refDate's calendar day (Manila time) within a daily-
// resolution time array (e.g. the Flood API's river_discharge series) — same
// UTC-date / local-hour comparison quirk as findCurrentHourIndex, just at day
// granularity, so it stays consistent with how the rest of this file resolves
// "now" within an Open-Meteo response.
function findCurrentDayIndex(dailyTimes, refDate = new Date()) {
  const manila  = new Date(refDate.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const dateStr = manila.toISOString().slice(0, 10);
  const idx = dailyTimes.findIndex((t) => t.startsWith(dateStr));
  return idx >= 0 ? idx : dailyTimes.length - 1; // fall back to most recent known day
}

// riverDischargeRaw is the Flood API's per-location response ({ daily: { time,
// river_discharge } }), fetched separately from weatherRaw since it's a
// different host/API at daily (not hourly) resolution — see
// services/openMeteoCache.js's fetchRiverDischarge(Batch).
export function extractRiverDischargeFeature(riverDischargeRaw, refDate = new Date()) {
  const time = riverDischargeRaw?.daily?.time ?? [];
  const discharge = riverDischargeRaw?.daily?.river_discharge ?? [];
  if (time.length === 0) return 0;
  const idx = findCurrentDayIndex(time, refDate);
  return discharge[idx] ?? 0;
}

// refDate defaults to now (live 30-min capture / per-report capture); the
// backfill script passes each report's own timestamp so historical archive
// data is read at the moment the report was actually filed.
export function extractSnapshotFeatures(weatherRaw, refDate = new Date()) {
  const times     = weatherRaw?.hourly?.time ?? [];
  const precip    = weatherRaw?.hourly?.precipitation ?? [];
  const soilTop   = weatherRaw?.hourly?.soil_moisture_0_to_7cm ?? [];
  const soilDeep  = weatherRaw?.hourly?.soil_moisture_7_to_28cm ?? [];
  const windSpeed = weatherRaw?.hourly?.windspeed_10m ?? [];
  const pressure  = weatherRaw?.hourly?.surface_pressure ?? [];
  const et0       = weatherRaw?.hourly?.et0_fao_evapotranspiration ?? [];

  if (times.length === 0) {
    return {
      rain_1h: 0, rain_3h: 0, rain_6h: 0, rain_24h: 0, rain_72h: 0,
      soilTop: 0, soilDeep: 0, windSpeed10m: 0, surfacePressure: 0, et0_24h: 0,
    };
  }

  const nowIdx = findCurrentHourIndex(times, refDate);
  return {
    rain_1h:  trailingSum(precip, nowIdx, 1),
    rain_3h:  trailingSum(precip, nowIdx, 3),
    rain_6h:  trailingSum(precip, nowIdx, 6),
    rain_24h: trailingSum(precip, nowIdx, 24),
    rain_72h: trailingSum(precip, nowIdx, 72),
    soilTop:  soilTop[nowIdx]  ?? 0,
    soilDeep: soilDeep[nowIdx] ?? 0,
    windSpeed10m:    windSpeed[nowIdx] ?? 0,
    surfacePressure: pressure[nowIdx]  ?? 0,
    et0_24h:         trailingSum(et0, nowIdx, 24),
  };
}

export async function captureAllBarangaySnapshots() {
  try {
    const coordsList = BARANGAYS.map(({ lat, lon }) => ({ lat, lon }));
    const [batch, dischargeBatch] = await Promise.all([
      fetchWeatherSnapshotBatch(coordsList),
      fetchRiverDischargeBatch(coordsList),
    ]);

    if (!batch) {
      console.warn("[WeatherSnapshot] Skipped — Open-Meteo unavailable this cycle");
      return;
    }
    if (!dischargeBatch) {
      console.warn("[WeatherSnapshot] River discharge unavailable this cycle — snapshots proceed with riverDischarge=0");
    }

    const capturedAt = new Date();
    const docs = BARANGAYS.map(({ key, lat, lon }, i) => ({
      barangay: key,
      lat, lng: lon,
      capturedAt,
      ...extractSnapshotFeatures(batch.data[i]),
      riverDischarge: dischargeBatch ? extractRiverDischargeFeature(dischargeBatch.data[i]) : 0,
    }));

    await HazardSnapshot.insertMany(docs);
    console.log(`[WeatherSnapshot] Captured ${docs.length} barangay snapshots at ${capturedAt.toISOString()}`);
  } catch (err) {
    console.error("[WeatherSnapshot] Capture failed:", err.message);
  }
}
