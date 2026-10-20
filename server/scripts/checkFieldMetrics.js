// scripts/checkFieldMetrics.js
//
// READ-ONLY. Reports field (real-world, human-reviewed) performance of the
// currently active flood/landslide RiskModel versions, from admin
// confirm/reject outcomes on AI-sourced Alert documents.
//
// Version attribution: Alert.modelVersion (format "<hazardType>-v<version>")
// is set once at alert creation in services/predictionEngine.js and never
// modified afterward by any other code path (confirm/reject/auto-confirm
// only update confirmedOutcome/confirmedBy/confirmedAt). Filtering on this
// field keeps metrics from being pooled across different trained versions.
//
// Post-promotion window check: RiskModel has no explicit "promotedAt" field,
// so this script verifies, rather than assumes, that a version's tagged
// alerts fall on or after that model's trainedAt, by finding the earliest
// alert tagged with the active version (not filtered by confirmedOutcome,
// since this check is about existence-before-promotion, not review status).
// Reported as one of four explicit states so "no alerts at this version
// yet" is never confused with "alerts exist but none reviewed." See the
// comment above boundaryMarkdownText() below for exactly what "confirmed"
// does and does not establish - in particular, services/alertHelpers.js's
// upsertAlert can overwrite modelVersion/confidence on an existing active
// alert when predictionEngine.js re-scores the same barangay/hazard/day,
// which this check is specifically designed to catch via createdAt.
//
// Only alerts with a human-set confirmedOutcome of true_positive or
// false_positive count toward TP/FP/precision. unconfirmed and
// expired_unconfirmed are excluded from both the counts and the
// denominator.
//
// Makes no writes to MongoDB, no retraining, no threshold or model changes.
// Writes a local Markdown report using exclusive file creation so an
// existing report for the same day can never be overwritten.
//
// Usage: node scripts/checkFieldMetrics.js [flood|landslide|both]

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import RiskModel from '../models/RiskModel.js';
import Alert from '../models/Alert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const EXPECTED_VERSION_AT_WRITING = { flood: 13, landslide: 11 };

function fmtPct(v) {
  if (v === null || v === undefined) return 'N/A';
  return (v * 100).toFixed(1) + '%';
}

async function checkOne(hazardType) {
  // RiskModelSchema only indexes {hazardType, isActive}; it does not enforce
  // uniqueness. trainRiskModel.js's promotion sequence (save the new doc as
  // active, THEN deactivate the old one) can leave more than one document
  // active for the same hazardType if the process crashes between those two
  // steps, and nothing prevents a manual DB edit from doing the same.
  // Picking one arbitrarily (findOne) would silently score against whichever
  // document Mongo happened to return first - detect and stop instead.
  const activeModels = await RiskModel.find({ hazardType: hazardType, isActive: true }).lean();
  if (activeModels.length > 1) {
    const versions = activeModels.map(function (m) { return m.version; }).join(', ');
    throw new Error(
      'Multiple active RiskModel documents found for hazardType="' + hazardType + '" ' +
      '(versions: ' + versions + '). Refusing to pick one arbitrarily - this must be resolved ' +
      '(deactivate all but one) before field metrics can be reported for this hazard.'
    );
  }
  const model = activeModels.length === 1 ? activeModels[0] : null;
  const activeVersion = model ? model.version : null;
  const activeTag = activeVersion !== null && activeVersion !== undefined
    ? hazardType + '-v' + activeVersion
    : null;
  const threshold = model ? model.operatingThreshold : null;

  const expectedVersion = EXPECTED_VERSION_AT_WRITING[hazardType];
  if (activeVersion !== expectedVersion) {
    console.warn(
      'WARNING: active ' + hazardType + ' model is v' + (activeVersion === null ? 'none' : activeVersion) +
      ', not v' + expectedVersion + ' (the version this report was originally scoped to). ' +
      'Reporting against whichever version is actually active now.'
    );
  }

  let tpActive = 0;
  let fpActive = 0;
  if (activeTag) {
    const counts = await Promise.all([
      Alert.countDocuments({ source: 'ai', type: hazardType, modelVersion: activeTag, confirmedOutcome: 'true_positive' }),
      Alert.countDocuments({ source: 'ai', type: hazardType, modelVersion: activeTag, confirmedOutcome: 'false_positive' }),
    ]);
    tpActive = counts[0];
    fpActive = counts[1];
  }
  const totalActive = tpActive + fpActive;
  const precisionActive = totalActive > 0 ? tpActive / totalActive : null;

  let boundaryStatus;
  let earliestTaggedAlertAt = null;

  if (!activeTag || !model || !model.trainedAt) {
    boundaryStatus = 'no_active_model';
  } else {
    const earliest = await Alert.findOne(
      { source: 'ai', type: hazardType, modelVersion: activeTag },
      { createdAt: 1 }
    ).sort({ createdAt: 1 }).lean();

    if (!earliest) {
      boundaryStatus = 'no_tagged_alerts';
    } else {
      earliestTaggedAlertAt = earliest.createdAt;
      const earliestMs = new Date(earliest.createdAt).getTime();
      const trainedMs = new Date(model.trainedAt).getTime();
      boundaryStatus = earliestMs >= trainedMs ? 'confirmed' : 'violated';
      if (boundaryStatus === 'violated') {
        console.warn(
          'WARNING: found a ' + activeTag + ' alert created ' + new Date(earliest.createdAt).toISOString() +
          ', before this model trainedAt (' + new Date(model.trainedAt).toISOString() + '). ' +
          'Post-promotion window assumption does not hold for ' + hazardType + '.'
        );
      }
    }
  }

  const breakdown = await Alert.aggregate([
    { $match: { source: 'ai', type: hazardType, confirmedOutcome: { $in: ['true_positive', 'false_positive'] } } },
    { $group: { _id: { modelVersion: '$modelVersion', outcome: '$confirmedOutcome' }, count: { $sum: 1 } } },
  ]);

  const byVersion = new Map();
  for (let i = 0; i < breakdown.length; i++) {
    const row = breakdown[i];
    const key = row._id.modelVersion === null || row._id.modelVersion === undefined
      ? '(unattributed)'
      : row._id.modelVersion;
    if (!byVersion.has(key)) byVersion.set(key, { tp: 0, fp: 0 });
    const bucket = byVersion.get(key);
    if (row._id.outcome === 'true_positive') bucket.tp = row.count;
    else bucket.fp = row.count;
  }

  return {
    hazardType: hazardType,
    activeVersion: activeVersion,
    activeTag: activeTag,
    threshold: threshold,
    tpActive: tpActive,
    fpActive: fpActive,
    totalActive: totalActive,
    precisionActive: precisionActive,
    byVersion: byVersion,
    trainedAt: model ? model.trainedAt : null,
    boundaryStatus: boundaryStatus,
    earliestTaggedAlertAt: earliestTaggedAlertAt,
  };
}

function boundaryConsoleText(r) {
  if (r.boundaryStatus === 'no_active_model') return 'not applicable (no active model or trainedAt)';
  if (r.boundaryStatus === 'no_tagged_alerts') return 'nothing to verify (no alerts tagged with this version yet)';
  if (r.boundaryStatus === 'confirmed') {
    return 'confirmed (see report for what this does and does not prove) - earliest tagged alert (' +
      new Date(r.earliestTaggedAlertAt).toISOString() + ') is on or after trainedAt (' +
      new Date(r.trainedAt).toISOString() + ')';
  }
  return 'NOT confirmed - see warning above';
}

// IMPORTANT - what "confirmed" does and does not establish:
//
// trainedAt is not a field explicitly named "promotedAt", but it is a tight
// proxy for it: trainRiskModel.js sets trainedAt (schema default: Date.now)
// at RiskModel.create() time, then flips isActive=true on that same document
// within the same synchronous trainOne() call - a gap of milliseconds, not a
// separately-timed event - and predictionEngine.js only ever loads models
// with isActive=true. So "createdAt >= trainedAt" for every alert currently
// tagged with a version is a real, checkable fact, not an assumption.
//
// What it rules out: during this audit, services/alertHelpers.js's
// upsertAlert was found to upsert on {_dedupeKey, isActive:true} with a $set
// that overwrites modelVersion/confidence/description/severity/expiresAt on
// an EXISTING alert document whenever predictionEngine.js re-scores the same
// barangay/hazard/day (its cron can fire many times per day), while
// preserving createdAt, _id, isActive, and any existing confirmedOutcome.
// routes/alerts.js confirm/reject and scripts/alertEngine.js's expiry
// cleanup only ever touch confirmedOutcome/confirmedBy/confirmedAt/isActive
// - never modelVersion - so the overwrite risk is specific to re-scoring,
// not to review actions. If a stale, pre-promotion document had its
// modelVersion field silently relabeled onto the current version by a
// later re-scoring cycle, its createdAt would predate trainedAt and this
// check would correctly report "violated", not "confirmed".
//
// What it does NOT establish: that the exact confidence value an admin saw
// at the moment they confirmed/rejected an alert matches what is currently
// stored (a later same-version re-scoring cycle can still update confidence
// without changing modelVersion, since the tag only changes when the active
// version itself changes) - and it does not increase the statistical power
// of a small reviewed-outcome count. "Confirmed" means the window is
// genuinely post-promotion, not that the resulting metrics are statistically
// reliable or free of review-timing noise.
function boundaryMarkdownText(r) {
  if (r.boundaryStatus === 'no_active_model') {
    return 'No active model or trainedAt available for this hazard. Post-promotion window not applicable.';
  }
  if (r.boundaryStatus === 'no_tagged_alerts') {
    return 'No alerts tagged with this model version exist yet, reviewed or unreviewed. Post-promotion window not yet checkable.';
  }
  if (r.boundaryStatus === 'confirmed') {
    return 'Confirmed post-promotion: earliest tagged alert (' + new Date(r.earliestTaggedAlertAt).toISOString() +
      ') is on or after this model trainedAt (' + new Date(r.trainedAt).toISOString() + '). ' +
      'This rules out a stale pre-promotion alert document being silently relabeled onto this version by ' +
      'a later same-day re-scoring cycle. As of the services/alertHelpers.js upsertAiAlert fix (matchExtra: ' +
      'confirmedOutcome="unconfirmed" + modelVersion), that overwrite path is now structurally closed for ' +
      'alerts created after the fix - a re-scoring cycle creates a new alert instead of overwriting an ' +
      'existing one across a version change or after review, so a "violated" finding below this point in ' +
      'time would only reflect alert documents created before the fix, not an ongoing risk. This check ' +
      'still does NOT independently confirm that the confidence value an admin reviewed matches what is ' +
      'currently stored, and it does NOT increase the statistical reliability of a small reviewed-outcome count.';
  }
  return 'Not confirmed as post-promotion: at least one alert tagged with this version was created before ' +
    'its trainedAt. These version-specific metrics cover all reviewed alerts attributed to this model ' +
    'version, and are not guaranteed to represent a strictly post-promotion prospective window.';
}

async function main() {
  const validArgs = new Set(['flood', 'landslide', 'both']);
  const rawArg = process.argv[2] ? process.argv[2].toLowerCase() : 'both';
  if (!validArgs.has(rawArg)) {
    console.error('Usage: node scripts/checkFieldMetrics.js [flood|landslide|both]');
    process.exit(1);
  }
  const hazards = rawArg === 'both' ? ['flood', 'landslide'] : [rawArg];

  const outDir = path.join(__dirname, 'output');
  const todayStr = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, 'field-metrics-' + todayStr + '.md');

  if (fs.existsSync(outPath)) {
    console.error('Refusing to overwrite existing report: ' + outPath);
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Refusing to proceed without a configured database connection.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB (read-only, no writes to models or data).');
  console.log('Metrics below cover REVIEWED alerts only, filtered to the currently active model version.');
  console.log('Unreviewed and expired-unconfirmed alerts are excluded, not treated as false positives.');
  console.log('These numbers alone do not establish real-world hazard-prediction accuracy.');

  const results = [];
  try {
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      const r = await checkOne(h);
      results.push(r);

      console.log('');
      console.log(h.toUpperCase() + ' - active model: ' + (r.activeTag ? r.activeTag : 'none') +
        (r.threshold !== null ? ' (threshold=' + r.threshold + ')' : ''));
      console.log('  Reviewed: ' + r.totalActive + ' (TP=' + r.tpActive + ', FP=' + r.fpActive + ') ' +
        '- precision: ' + fmtPct(r.precisionActive));
      console.log('  Post-promotion window: ' + boundaryConsoleText(r));
      console.log('  All-time breakdown by model version (reviewed only):');

      const entries = Array.from(r.byVersion.entries());
      for (let j = 0; j < entries.length; j++) {
        const tag = entries[j][0];
        const counts = entries[j][1];
        const total = counts.tp + counts.fp;
        const marker = tag === r.activeTag ? ' <- currently active' : '';
        console.log('    ' + tag + ': TP=' + counts.tp + ' FP=' + counts.fp +
          ' precision=' + fmtPct(total > 0 ? counts.tp / total : null) + marker);
      }
    }
  } finally {
    await mongoose.disconnect();
  }

  fs.mkdirSync(outDir, { recursive: true });

  const lines = [];
  lines.push('# AI alert field metrics - ' + todayStr);
  lines.push('');
  lines.push('Reviewed-outcomes-only report. Alerts with source "ai" and confirmedOutcome of ' +
    'true_positive or false_positive only. The primary figure per hazard is filtered to that ' +
    'hazard current active model version (Alert.modelVersion, set at creation, never altered ' +
    'afterward) and does not pool outcomes from earlier model versions. A separate breakdown ' +
    'table shows aggregate historical AI-alert metrics per version, not performance specific to ' +
    'the active version alone.');
  lines.push('');
  lines.push('Unreviewed and expired-unconfirmed alerts are excluded from both counts, not counted ' +
    'as false positives.');
  lines.push('');
  lines.push('These numbers alone do not establish real-world hazard-prediction accuracy. Review ' +
    'counts may be small, reviewer judgment may vary alert-to-alert, and a 0% or 100% precision ' +
    'reading from a handful of outcomes is a trend to watch, not a verdict. Pair with ' +
    'scripts/output/evaluation-*.md and in-sample-check-*.md for the fuller picture.');
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push('## ' + r.hazardType + ' - active: ' + (r.activeTag ? r.activeTag : 'none') +
      (r.threshold !== null ? ' (threshold=' + r.threshold + ')' : ''));
    lines.push('');
    lines.push('Active-version-specific (reviewed outcomes only):');
    lines.push('- True positives: ' + r.tpActive);
    lines.push('- False positives: ' + r.fpActive);
    lines.push('- Total reviewed: ' + r.totalActive);
    lines.push('- Field precision: ' + fmtPct(r.precisionActive));
    lines.push('- Post-promotion window: ' + boundaryMarkdownText(r));
    lines.push('');
    lines.push('All-time breakdown by model version (aggregate historical, not version-isolated):');
    lines.push('');
    lines.push('| modelVersion | TP | FP | Precision |');
    lines.push('|---|---|---|---|');
    const entries = Array.from(r.byVersion.entries());
    for (let j = 0; j < entries.length; j++) {
      const tag = entries[j][0];
      const counts = entries[j][1];
      const total = counts.tp + counts.fp;
      const label = tag === r.activeTag ? tag + ' (active)' : tag;
      lines.push('| ' + label + ' | ' + counts.tp + ' | ' + counts.fp + ' | ' +
        fmtPct(total > 0 ? counts.tp / total : null) + ' |');
    }
    lines.push('');
  }

  const md = lines.join('\n');

  try {
    fs.writeFileSync(outPath, md, { flag: 'wx' });
    console.log('Wrote: ' + outPath);
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.error('Refusing to overwrite existing report (race detected at write time): ' + outPath);
      process.exit(1);
    }
    throw err;
  }
}

export { checkOne, fmtPct, boundaryConsoleText, boundaryMarkdownText, main };

// Only auto-run when executed directly (`node scripts/checkFieldMetrics.js`),
// not when imported by a test file - same guard pattern used by
// scripts/buildTrainingSet.js and scripts/trainRiskModel.js in this repo.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(function (err) {
    console.error('Check failed:', err.message);
    process.exit(1);
  });
}
