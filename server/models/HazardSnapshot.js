// models/HazardSnapshot.js
//
// A periodic (every 30 min) weather snapshot per barangay, captured whether
// or not any report was filed. This is what makes negative training examples
// possible for the risk model ("these conditions occurred here and nobody
// reported a hazard") — without it, the training set would only ever contain
// positive examples and couldn't learn what "safe" looks like.
import mongoose from "mongoose";

const HazardSnapshotSchema = new mongoose.Schema({
  barangay:  { type: String, required: true, index: true },
  lat:       { type: Number, required: true },
  lng:       { type: Number, required: true },
  capturedAt: { type: Date, required: true, default: Date.now, index: true },

  // Observed rainfall (mm) accumulated over the trailing window ending at
  // capturedAt — not a forecast. Same definition used for live snapshots and
  // for backfilled historical reports (scripts/backfillWeatherSnapshots.js).
  rain_1h:   { type: Number, default: 0 },
  rain_3h:   { type: Number, default: 0 },
  rain_6h:   { type: Number, default: 0 },
  rain_24h:  { type: Number, default: 0 },
  rain_72h:  { type: Number, default: 0 },

  // Open-Meteo soil moisture at capturedAt (m3/m3 fraction, ~0-0.5 range).
  soilTop:   { type: Number, default: 0 },
  soilDeep:  { type: Number, default: 0 },

  // Point-in-time wind speed (km/h) and surface pressure (hPa) at capturedAt —
  // storm-intensity signals distinct from rainfall/soil alone.
  windSpeed10m:    { type: Number, default: 0 },
  surfacePressure: { type: Number, default: 0 },

  // Reference evapotranspiration (mm) accumulated over the trailing 24h —
  // helps distinguish transient wet soil (rain just fell) from sustained
  // saturation (rain exceeding evapotranspiration over time), relevant to
  // landslide risk specifically.
  et0_24h: { type: Number, default: 0 },

  // GloFAS river discharge (m3/s) for capturedAt's calendar day — Open-Meteo's
  // Flood API, a direct hydrological flood signal distinct from local
  // rainfall/soil-moisture proxies. Daily resolution (see services/openMeteoCache.js).
  riverDischarge: { type: Number, default: 0 },
});

HazardSnapshotSchema.index({ barangay: 1, capturedAt: -1 });

export default mongoose.model("HazardSnapshot", HazardSnapshotSchema);
