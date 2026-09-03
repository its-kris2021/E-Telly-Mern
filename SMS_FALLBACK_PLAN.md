# SMS Fallback Channel for Emergency Reports

**Status:** Proposed / not yet implemented. A prior implementation attempt
on this branch was reverted at the user's request; this file is the design to
pick back up from whenever implementation is greenlit.

## Context

E-Telly's "Local Mode" already lets a barangay hall run fully offline: the hall
laptop is both the server and a WiFi AP (`ETelly-BagongNayon`, static IP
`192.168.1.100`), and residents on that WiFi submit reports with no internet
required until the periodic cloud sync. The gap: a resident who has **no
WiFi/data at all but still has cell signal** (a realistic scenario in a
widespread Antipolo outage) currently has no way to report anything — the
existing offline queues (`useOfflineAlertQueue`, `useOfflineCache`) still
require the device to eventually get an `online` event.

The fix decided on: an SMS fallback channel built on a **local GSM gateway**
(a spare Android phone + prepaid SIM, joined to the same barangay WiFi,
running an open-source SMS-gateway app that POSTs inbound SMS to the hall
server) — not a cloud SMS API. This keeps the "no internet required" property
intact (SMS rides the gateway phone's own cellular signal; the webhook call
itself is LAN-only) and avoids an ongoing paid subscription.

## Critical design constraint found during investigation

`GET /api/reports` filters by **`reporterBarangayKey`**
(`server/index.js:213`, via `scopeToAssignedBarangay`), which today is set
*only* by looking up the submitter's registered user account by email
(`server/routes/reports.js:161-179` — comment there explicitly states the
incident's free-text/GPS barangay is "never used to decide who gets to see
the report"). An SMS sender has no account. If SMS reports went through the
normal path unmodified, they'd get `reporterBarangayKey: null` and would
**never appear on the barangay hall's own dashboard** — the one audience this
whole feature exists for. The plan below deliberately overrides
`reporterBarangayKey` with the *incident* barangay parsed from the SMS text,
for SMS-sourced reports only.

## Implementation

### 1. Extract shared insertion logic — `server/services/reportIntake.js`

Move out of `server/routes/reports.js:16-75` (`attachWeatherSnapshot`,
`autoConfirmMatchingAiAlert`, unchanged) and `:154-230` into a new exported
`createEmergencyReport(fields, { io })`:
- Same barangayKey resolution, `reportData` construction, `insertOne`,
  `io.emit("new_emergency_report", ...)`, `sendAdminNotification(...)`, and
  fire-and-forget calls to the two helpers above — moved verbatim, not
  rewritten.
- New param `reporterBarangayKeyOverride` (used verbatim in place of the
  email-lookup result when provided — even `null` is a valid override).
  Comment why: this is the SMS path's deliberate exception to the
  "reporterBarangayKey only comes from a registered account" invariant.
- New param `needsReview` (bool, default `false`) → stored on
  `reportData.needsReview`.
- Returns `{ insertedId, reportData }`; no `res.json` — callers own the HTTP
  response.

`server/routes/reports.js`'s `POST /api/reports/create` becomes a thin
wrapper: keep its existing `400` check for missing `emergencyType`/`severity`,
call `createEmergencyReport(req.body, { io: req.app.get("io") })`, respond as
today. Pure extraction — verify `server/__tests__/reportBarangayFiltering.test.js`
still passes unmodified as a regression gate.

### 2. Inbound webhook — `server/routes/sms.js`

- `POST /api/sms/inbound`, mounted in `server/index.js` next to
  `app.use("/api/sync", syncRoutes)` (`:166`) as `app.use("/api/sms", smsRoutes)`.
- Auth: shared-secret header `X-Sms-Gateway-Key` checked against
  `process.env.SMS_GATEWAY_SECRET`, mirroring `server/routes/sync.js:43-46`'s
  `X-Sync-Key`/`SYNC_SECRET` pattern (plain `===`, no JWT — a gateway app
  can't log in interactively).
- New dedicated rate limiter (mirror `publicPostLimiter`'s shape, 15min/100),
  applied only to `/api/sms/inbound` — must not touch the existing
  `publicPostLimiter` on `/api/reports/create`.
- No CORS changes needed — `server/index.js`'s CORS `origin` callback already
  allows requests with no `Origin` header, which a non-browser POST sends.

### 3. Payload adapter — `server/services/smsGatewayAdapter.js`

One function, `normalizeGatewayPayload(raw)`, isolating `routes/sms.js` from
the specific Android app's JSON shape (field names vary by app/version).
Returns `{ from, body, receivedAt } | null`; `routes/sms.js` responds `400`
and logs on `null`, never inserts garbage. Recommended app to document:
capcom6's open-source "SMS Gateway for Android™" (supports a local/self-hosted
webhook mode, no cloud relay) — but since the adapter is the only place that
knows its payload shape, swapping apps later is a one-function change.

### 4. SMS parser — `server/services/smsParser.js`

`parseSmsReport(rawText)` — **lenient keyword-scan-anywhere**, not rigid
positional parsing (a panicking resident's text won't reliably follow a
template). Reuses `resolveBarangayKey` from `server/config/barangays.js` — no
new barangay-matching logic. Keyword map for `emergencyType` (English +
Tagalog: sunog/fire, baha/flood, lindol/earthquake, guho/landslide,
bagyo/typhoon, tulong/saklolo → rescue, etc.), mapped only onto the existing
`VALID_TYPES` list (`server/index.js:336` — note it's not exported, so this
is a second literal kept in sync manually, same convention as
`__tests__/helpers/testApp.js`'s comment about mirroring `index.js`).
Severity keyword map with **default `"high"`** when unspecified (SMS is a
safety fallback — bias toward over-alerting, not under).

**Barangay matching order matters.** Try adjacent word-pairs first (covers
two-word names like "San Roque"/"Bagong Nayon" and matches them exactly via
`resolveBarangayKey`'s exact-match path). Only fall back to single words
afterward, and only ones **longer than 3 characters** — short common
Tagalog/English words ("sa", "may", "po", "ang"...) will otherwise loosely
substring-match an unrelated barangay key through `resolveBarangayKey`'s
loose-match fallback (e.g. bare `"SAN"` alone loosely matches `"sanisidro"`
before `"SAN ROQUE"` is ever tried as a pair — caught during test-writing on
the prior attempt, must not be reintroduced).

Returns `{ emergencyType, severity, barangayKey, barangayFreeText,
description, needsReview }` where `needsReview` is `true` whenever type or
barangay couldn't be confidently matched — nothing is ever silently dropped;
low-confidence parses still insert with `emergencyType: "other"` and/or
`barangayKey: null` (visible to CDRRMO but not routed to a specific
barangay).

Resident-facing format for the README/orientation material — publish a
suggested template but design the parser to work without it:
- Suggested: `TYPE BARANGAY description` (e.g. `FIRE SAN ROQUE may sunog malapit sa palengke`)
- Also fine, in their own words: `may sunog dito sa san roque, tulong po`

### 5. `routes/sms.js` handler shape

```js
const normalized = normalizeGatewayPayload(req.body);
if (!normalized) return res.status(400).json({ message: "No SMS text found in payload" });

const parsed = parseSmsReport(normalized.body);

const { insertedId } = await createEmergencyReport({
  emergencyType: parsed.emergencyType,
  severity: parsed.severity,
  description: parsed.description,
  barangay: parsed.barangayFreeText,
  phoneNumber: normalized.from,
  userName: "SMS Reporter",
  images: [],
  source: "sms",
  offlineSubmittedAt: normalized.receivedAt,
  needsReview: parsed.needsReview,
  reporterBarangayKeyOverride: parsed.barangayKey,
}, { io: req.app.get("io") });

res.json({ success: true, reportId: insertedId });
```

### 6. Client-side surfacing of `source: "sms"` / `needsReview`

- `client/src/pages/ReportPage.jsx` (~line 125): add
  `needsReview: report.needsReview || false,` next to the existing
  `source: report.source || "online",` — already spread into `<ReportTile />`,
  no other wiring needed.
- `client/src/components/admin/ReportTile.jsx`:
  - Extend the source badge ternary at line 181 from
    `source === "mesh_relay" ? "Via Mesh" : "Direct WiFi"` to also handle
    `source === "sms" ? "Via SMS" : ...`.
  - Add a `needsReview` prop; render a small badge next to the existing `NEW`
    pill (lines 170-174) when true, so ambiguous SMS reports are visibly
    flagged for manual triage.

### 7. Env var + deployment docs

- New env var `SMS_GATEWAY_SECRET` — added to `server/.env` (same untracked
  file as `SYNC_SECRET`; no `.env.example` exists in this repo, follow that
  precedent) and to `barangay-setup/start-local.bat` next to the existing
  `set SYNC_SECRET=...` line.
- `barangay-setup/README.md`: new `## SMS Gateway Setup (Optional — for
  Residents With No WiFi Signal)` section between `## WiFi Router Setup` and
  `## Troubleshooting`, matching the doc's existing terse numbered-steps tone:
  what it's for, one-time phone setup (install the app, join
  `ETelly-BagongNayon`, set webhook URL to
  `http://192.168.1.100:5000/api/sms/inbound` with header
  `X-Sms-Gateway-Key: <value>`), the resident-facing SMS format, and a note
  that ambiguous texts still come through flagged "Needs Review."
- Extend `## Troubleshooting` with an "SMS reports not appearing" entry
  (check gateway phone signal, webhook URL/IP, header key match).

## Verification (no physical gateway phone required)

1. **Unit tests** — `server/__tests__/smsParser.test.js`: table-driven over
   every keyword (English + Tagalog) and every `BARANGAY_KEYS` entry
   (imported from `config/barangays.js`, same pattern as
   `reportBarangayFiltering.test.js`), default-severity check, and a
   garbage/empty-input case asserting non-throwing + `needsReview: true`.
2. **Integration test** — `server/__tests__/smsInbound.test.js`, using the
   existing `buildTestApp()`/`startTestDb()` harness
   (`server/__tests__/helpers/testApp.js`, `testDb.js`): extend
   `buildTestApp()` to mount `smsRoutes` (and `POST /api/reports/create` if
   not already present, for the regression check). Cases: wrong/missing
   secret header → `401`, nothing inserted; clear payload → `200` with
   correct `emergencyType`/`severity`/`reporterBarangayKey`/`needsReview:
   false`; ambiguous payload → `200` with `emergencyType: "other"`,
   `reporterBarangayKey: null`, `needsReview: true`. Re-run
   `reportBarangayFiltering.test.js` unmodified as a regression gate on the
   `reportIntake.js` extraction.
3. **Manual end-to-end**, against `start-local.bat` running locally:
   ```
   curl -X POST http://192.168.1.100:5000/api/sms/inbound \
     -H "Content-Type: application/json" \
     -H "X-Sms-Gateway-Key: <SMS_GATEWAY_SECRET value>" \
     -d '{"payload": {"message": "FIRE SAN ROQUE may sunog malapit sa palengke", "phoneNumber": "+639171234567"}}'
   ```
   Confirm `200 { success, reportId }`; with the dashboard open and logged in
   as a `barangay_official` assigned to `sanroque`, confirm the report
   appears live via the `new_emergency_report` socket event tagged "Via SMS";
   repeat with an ambiguous message and confirm it does *not* appear for that
   barangay official but does for a CDRRMO login, flagged "Needs Review";
   spot-check via `mongosh` that `syncedToCloud: false` was set so it flows
   through the existing `syncToCloud.js` scheduler unmodified.

## Files touched

- `server/services/reportIntake.js` (new — extracted from `reports.js`)
- `server/routes/reports.js` (slimmed to a thin wrapper)
- `server/routes/sms.js` (new)
- `server/services/smsGatewayAdapter.js` (new)
- `server/services/smsParser.js` (new)
- `server/index.js` (mount `/api/sms`, new rate limiter)
- `client/src/pages/ReportPage.jsx`
- `client/src/components/admin/ReportTile.jsx`
- `barangay-setup/start-local.bat`
- `barangay-setup/README.md`
- `server/__tests__/smsParser.test.js` (new)
- `server/__tests__/smsInbound.test.js` (new)
- `server/__tests__/helpers/testApp.js` (mount new route for tests)
