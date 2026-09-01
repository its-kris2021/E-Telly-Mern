/**
 * services/openMeteoCache.js
 *
 * Shared Open-Meteo cache and fetch layer used by both hazard.js (route
 * handlers) and alertEngine.js (cron jobs).
 *
 * Previously both files maintained their own cache Maps and rate-limit
 * cooldowns independently, causing:
 *   - alertEngine making HTTP round-trips to localhost just to read cached data
 *     that was already in the same process's memory
 *   - Two cooldown timers that didn't communicate — hazard.js could be
 *     rate-limited while alertEngine kept firing requests (and vice versa)
 *   - classifyRainfallIntensity duplicated in both files with slightly
 *     different signatures
 *
 * Now both share one cache Map, one cooldown, and call fetchRainfallHourly /
 * fetchLandslideData directly — no HTTP round-trip, no duplicate upstream
 * requests, no split rate-limit state.
 */

// ── Cache singleton ───────────────────────────────────────────────────────────

const _cache    = new Map();
const _inflight = new Map(); // deduplicates concurrent fetches for the same key
let   _cooldownUntil = 0;

export const TTL = {
  RAINFALL_HOURLY: 10 * 60 * 1000,
  FLOOD_FORECAST:  10 * 60 * 1000,
  LANDSLIDE:       10 * 60 * 1000,
  TYPHOON:          5 * 60 * 1000,
  RIVER_DISCHARGE:  6 * 60 * 60 * 1000, // daily-resolution data, no need to refetch often
};

export function getCached(key) {
  const e = _cache.get(key);
  return e && Date.now() <= e.expiresAt ? e.data : null;
}

export function getCachedStale(key) {
  return _cache.get(key)?.data ?? null;
}

export function setCached(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Rate-limit cooldown ───────────────────────────────────────────────────────

export function isCoolingDown() {
  return Date.now() < _cooldownUntil;
}

export function setCooldown(minutes = 60) {
  _cooldownUntil = Date.now() + minutes * 60 * 1000;
  const at = new Date(_cooldownUntil).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" });
  console.warn(
    `⚠️ Open-Meteo rate-limited — all fetches paused ${minutes} min (resumes ~${at} Manila time)`,
  );
}

// ── Core fetch ────────────────────────────────────────────────────────────────
// Returns { data, stale: boolean } or null (rate-limited with no stale fallback).
// Concurrent calls for the same cacheKey share one in-flight promise so
// Open-Meteo is never called twice for the same data within the same tick.

export async function fetchOpenMeteo(url, cacheKey, ttlMs) {
  const fresh = getCached(cacheKey);
  if (fresh) return { data: fresh, stale: false };

  if (isCoolingDown()) {
    const stale = getCachedStale(cacheKey);
    return stale ? { data: stale, stale: true } : null;
  }

  if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);

  const promise = (async () => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || !r.ok) {
        setCooldown(60);
        const stale = getCachedStale(cacheKey);
        return stale ? { data: stale, stale: true } : null;
      }
      const data = await r.json();
      setCached(cacheKey, data, ttlMs);
      return { data, stale: false };
    } catch (err) {
      const stale = getCachedStale(cacheKey);
      if (stale) return { data: stale, stale: true };
      throw err;
    } finally {
      _inflight.delete(cacheKey);
    }
  })();

  _inflight.set(cacheKey, promise);
  return promise;
}

// ── Named fetchers ────────────────────────────────────────────────────────────
// Canonical cache keys ensure hazard.js routes and alertEngine.js cron jobs
// always read from and write to the same cache entries.

// Cache-key builders are exported so the batch fetchers below can seed the
// exact same per-coordinate cache entries a single-point fetch would use —
// e.g. the per-barangay rule engine and predictionEngine.js get cache hits
// after weatherSnapshotService's batched calls warm the cache, with no
// duplicate upstream requests.
export const rainfallCacheKey  = (lat, lon) => `rainfall_hourly_${lat}_${lon}`;
export const landslideCacheKey = (lat, lon) => `landslide_${lat}_${lon}`;

export function fetchRainfallHourly(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation,precipitation_probability,weathercode` +
    `&daily=precipitation_sum,precipitation_probability_max` +
    `&forecast_days=7&timezone=Asia%2FManila`;
  return fetchOpenMeteo(url, rainfallCacheKey(lat, lon), TTL.RAINFALL_HOURLY);
}

export function fetchLandslideData(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=precipitation_sum,precipitation_probability_max` +
    `&hourly=soil_moisture_0_to_7cm,soil_moisture_7_to_28cm` +
    `&past_days=3&forecast_days=7&timezone=Asia%2FManila`;
  return fetchOpenMeteo(url, landslideCacheKey(lat, lon), TTL.LANDSLIDE);
}

// ── Batched multi-location fetchers ─────────────────────────────────────────
// Open-Meteo accepts comma-separated latitude/longitude lists and returns one
// result object per coordinate (in the same order) instead of a single object.
// Used by weatherSnapshotService to fetch all barangays in 2 calls instead of
// (barangay count × 2) separate calls. Each result is also seeded into the
// normal per-point cache (see rainfallCacheKey/landslideCacheKey above) so
// per-barangay rule-engine/prediction-engine checks reuse this same fetch.
async function fetchOpenMeteoBatch(url, batchCacheKey, ttlMs, coordsList, perPointKeyFn) {
  const result = await fetchOpenMeteo(url, batchCacheKey, ttlMs);
  if (!result) return null;

  const dataArray = Array.isArray(result.data) ? result.data : [result.data];
  dataArray.forEach((entry, i) => {
    const point = coordsList[i];
    if (!point) return;
    setCached(perPointKeyFn(point.lat, point.lon), entry, ttlMs);
  });

  return { data: dataArray, stale: result.stale };
}

// coordsList: [{ lat, lon }, ...]. Returns { data: [...], stale } where
// data[i] corresponds to coordsList[i].
export function fetchRainfallHourlyBatch(coordsList) {
  const lats = coordsList.map((c) => c.lat).join(",");
  const lons = coordsList.map((c) => c.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&hourly=precipitation,precipitation_probability,weathercode` +
    `&daily=precipitation_sum,precipitation_probability_max` +
    `&forecast_days=7&timezone=Asia%2FManila`;
  return fetchOpenMeteoBatch(
    url, `rainfall_hourly_batch_${lats}_${lons}`, TTL.RAINFALL_HOURLY, coordsList, rainfallCacheKey,
  );
}

export function fetchLandslideDataBatch(coordsList) {
  const lats = coordsList.map((c) => c.lat).join(",");
  const lons = coordsList.map((c) => c.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&daily=precipitation_sum,precipitation_probability_max` +
    `&hourly=soil_moisture_0_to_7cm,soil_moisture_7_to_28cm` +
    `&past_days=3&forecast_days=7&timezone=Asia%2FManila`;
  return fetchOpenMeteoBatch(
    url, `landslide_batch_${lats}_${lons}`, TTL.LANDSLIDE, coordsList, landslideCacheKey,
  );
}

// ── Training-feature snapshot fetcher ───────────────────────────────────────
// Deliberately separate from fetchRainfallHourly/fetchLandslideData above,
// which back the live rule engine and must not change shape/behavior. This
// combines precipitation + soil moisture in one call with past_days=3, so
// weatherSnapshotService/reports.js can compute purely backward-looking
// ("how much has it actually rained/how wet is the soil up to right now")
// features — the same kind of feature the historical backfill script can
// also compute from Open-Meteo's archive API for past events. Forecast-peak
// features (used by the live rule engine) can't be backfilled for events
// that already happened, so training features intentionally use observed
// data only, for both live and backfilled snapshots.
export const snapshotCacheKey = (lat, lon) => `weather_snapshot_${lat}_${lon}`;

// windspeed_10m/surface_pressure (storm-intensity signals) and
// et0_fao_evapotranspiration (distinguishes transient wet soil from sustained
// saturation) supplement the original precipitation/soil-moisture pair — see
// services/riskFeatures.js for how these feed into the model.
const SNAPSHOT_HOURLY_VARS =
  "precipitation,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm," +
  "windspeed_10m,surface_pressure,et0_fao_evapotranspiration";

export function fetchWeatherSnapshot(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=${SNAPSHOT_HOURLY_VARS}` +
    `&past_days=3&forecast_days=1&timezone=Asia%2FManila`;
  return fetchOpenMeteo(url, snapshotCacheKey(lat, lon), TTL.LANDSLIDE);
}

export function fetchWeatherSnapshotBatch(coordsList) {
  const lats = coordsList.map((c) => c.lat).join(",");
  const lons = coordsList.map((c) => c.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&hourly=${SNAPSHOT_HOURLY_VARS}` +
    `&past_days=3&forecast_days=1&timezone=Asia%2FManila`;
  return fetchOpenMeteoBatch(
    url, `weather_snapshot_batch_${lats}_${lons}`, TTL.LANDSLIDE, coordsList, snapshotCacheKey,
  );
}

// ── River discharge (Flood API) ─────────────────────────────────────────────
// A separate host/API (flood-api.open-meteo.com, GloFAS v4 reanalysis+forecast)
// from the forecast/archive APIs above — daily resolution only, a direct
// hydrological flood signal distinct from the rainfall/soil-moisture proxies.
// `river_discharge` (not the _mean/_median/etc. stats, which are forecast-only)
// is used so live and historical-backfill values are computed identically.
export const riverDischargeCacheKey = (lat, lon) => `river_discharge_${lat}_${lon}`;

export function fetchRiverDischarge(lat, lon) {
  const url =
    `https://flood-api.open-meteo.com/v1/flood` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=river_discharge&past_days=2&forecast_days=1&timezone=Asia%2FManila`;
  return fetchOpenMeteo(url, riverDischargeCacheKey(lat, lon), TTL.RIVER_DISCHARGE);
}

export function fetchRiverDischargeBatch(coordsList) {
  const lats = coordsList.map((c) => c.lat).join(",");
  const lons = coordsList.map((c) => c.lon).join(",");
  const url =
    `https://flood-api.open-meteo.com/v1/flood` +
    `?latitude=${lats}&longitude=${lons}` +
    `&daily=river_discharge&past_days=2&forecast_days=1&timezone=Asia%2FManila`;
  return fetchOpenMeteoBatch(
    url, `river_discharge_batch_${lats}_${lons}`, TTL.RIVER_DISCHARGE, coordsList, riverDischargeCacheKey,
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

// Single PAGASA rainfall classifier — previously classifyPAGASA in hazard.js
// and classifyRainfallIntensity in alertEngine.js (same thresholds, alertEngine
// version just omitted the color field).
export function classifyRainfallIntensity(mmPerHour) {
  if (mmPerHour >= 60)  return { label: "Torrential", level: 5, color: "#7c3aed" };
  if (mmPerHour >= 30)  return { label: "Intense",    level: 4, color: "#dc2626" };
  if (mmPerHour >= 15)  return { label: "Heavy",      level: 3, color: "#f97316" };
  if (mmPerHour >= 7.5) return { label: "Moderate",   level: 2, color: "#f59e0b" };
  if (mmPerHour > 0)    return { label: "Light",      level: 1, color: "#3b82f6" };
  return                       { label: "None",       level: 0, color: "#9ca3af" };
}

// Find the index in Open-Meteo's hourly time array matching the given instant
// (default: now) in Manila time — used by the /rainfall-hourly route,
// alertEngine flood checks, and (with an explicit refDate) weatherSnapshotService
// to locate a specific report's timestamp within a historical/archive fetch.
export function findCurrentHourIndex(hourlyTimes, refDate = new Date()) {
  const manila      = new Date(refDate.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const dateStr     = manila.toISOString().slice(0, 10);
  const targetHour  = manila.getHours();
  const idx = hourlyTimes.findIndex(
    (t) => t.startsWith(dateStr) && parseInt(t.slice(11, 13)) === targetHour,
  );
  return idx >= 0 ? idx : 0;
}
