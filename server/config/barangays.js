// Shared per-barangay spatial anchors for Antipolo City, Rizal.
//
// This is the only spatial anchor set in the codebase (no barangay boundary
// polygons exist anywhere) — used as the fallback centroid whenever an exact
// evacuation-center coordinate isn't available, and as the set of points the
// hazard rule engine (services/floodAlerts.js, services/landslideAlerts.js)
// and the AI prediction engine (services/predictionEngine.js) iterate over.
//
// Previously this table lived only in routes/evacuation.js; it's shared here
// so weather-snapshot capture, the rule engine, and the risk model can all
// agree on the same barangay keys and centroids.

export const BARANGAY_COORDS = {
  bagongnayon:  { lat: 14.6261, lng: 121.1687 },
  beverlyhills: { lat: 14.5843, lng: 121.1582 },
  calawis:      { lat: 14.6731, lng: 121.2423 },
  cupang:       { lat: 14.6360, lng: 121.1239 },
  dalig:        { lat: 14.5763, lng: 121.1820 },
  delapaz:      { lat: 14.5901, lng: 121.1703 },
  inarawan:     { lat: 14.6248, lng: 121.1950 },
  mambugan:     { lat: 14.6206, lng: 121.1416 },
  mayamot:      { lat: 14.6247, lng: 121.1233 },
  muntindilaw:  { lat: 14.5989, lng: 121.1301 },
  private:      { lat: 14.5973, lng: 121.1836 },
  sanisidro:    { lat: 14.5916, lng: 121.1838 },
  sanjose:      { lat: 14.6236, lng: 121.2598 },
  sanjuan:      { lat: 14.6278, lng: 121.1770 },
  sanluis:      { lat: 14.6043, lng: 121.1981 },
  sanroque:     { lat: 14.5832, lng: 121.1719 },
  santacruz:    { lat: 14.6157, lng: 121.1694 },
};

export const BARANGAY_KEYS = Object.keys(BARANGAY_COORDS);

// Human-readable labels for alert titles/descriptions and UI display.
export const BARANGAY_LABELS = {
  bagongnayon:  "Bagong Nayon",
  beverlyhills: "Beverly Hills",
  calawis:      "Calawis",
  cupang:       "Cupang",
  dalig:        "Dalig",
  delapaz:      "Dela Paz",
  inarawan:     "Inarawan",
  mambugan:     "Mambugan",
  mayamot:      "Mayamot",
  muntindilaw:  "Muntindilaw",
  private:      "Private Subdivision",
  sanisidro:    "San Isidro",
  sanjose:      "San Jose",
  sanjuan:      "San Juan",
  sanluis:      "San Luis",
  sanroque:     "San Roque",
  santacruz:    "Santa Cruz",
};

export function barangayLabel(key) {
  return BARANGAY_LABELS[key] ?? key;
}

// MGB-documented high-susceptibility barangays (eastern Antipolo / Sierra
// Madre foothills). Used both in landslide alert copy (services/landslideAlerts.js)
// and as a static feature in the risk model's feature vector
// (services/riskFeatures.js) — a genuinely useful signal that requires zero
// accumulated report data.
export const HIGH_SUSCEPTIBILITY_BARANGAYS = ["calawis", "dalig", "sanjose", "mambugan"];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fallback when a report has coordinates but no usable free-text barangay
// name: finds the closest BARANGAY_COORDS centroid. Used by routes/reports.js
// and scripts/backfillWeatherSnapshots.js.
export function nearestBarangayKey(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  let best = null;
  let bestDist = Infinity;
  for (const [key, coord] of Object.entries(BARANGAY_COORDS)) {
    const dist = haversineKm(lat, lng, coord.lat, coord.lng);
    if (dist < bestDist) { bestDist = dist; best = key; }
  }
  return best;
}

// Normalizes free-text barangay names ("San Roque", "SAN ROQUE", "Brgy. San Roque")
// to a canonical key ("sanroque"). Citizen reports carry free-text barangay
// strings (see routes/reports.js) so this is the single place that reconciles
// them against BARANGAY_COORDS.
export function resolveBarangayKey(input) {
  if (!input || typeof input !== "string") return null;
  const normalized = input
    .toLowerCase()
    .replace(/^brgy\.?\s*/, "")
    .replace(/^barangay\s*/, "")
    .replace(/[^a-z0-9]/g, "");
  if (BARANGAY_COORDS[normalized]) return normalized;

  // Loose match: normalized input contains or is contained by a known key
  // (handles things like "sanjosea" typos or partial names).
  const match = BARANGAY_KEYS.find(
    (key) => normalized.includes(key) || key.includes(normalized),
  );
  return match ?? null;
}
