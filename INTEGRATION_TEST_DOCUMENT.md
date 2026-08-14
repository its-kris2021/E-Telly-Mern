# Unauthorized moderation request was rejected.E-TELLY — SYSTEM INTEGRATION TEST DOCUMENT

---

## IT-01 — Emergency Report ↔ Barangay Official Routing

**Modules/Components:** Emergency Reports Module ↔ User/RBAC Module (barangay_official, cdrrmo, system_admin roles)

**Integration Points:**

- `POST /api/reports/create` (`server/routes/reports.js:139-238`) — writes both `barangayKey` (GPS/free-text incident location) and `reporterBarangayKey` (reporter's registered profile barangay)
- `GET /api/reports` (`server/index.js:142-151`) — barangay-scoped report listing
- `POST /api/reports/update-status`, `POST /api/reports/resolve` (`server/index.js:204, 293`) — barangay-scoped write guards
- `scopeToAssignedBarangay` / `rejectIfOutsideAssignedBarangay` / `requireAssignedBarangayIfOfficial` (`server/middleware/auth.js:26-54`)

**IT ID:** IT-01

**Description:** Verifies that an emergency report is routed to, and visible only by, the barangay official whose `assignedBarangay` matches the **reporter's registered barangay** (`reporterBarangayKey`) — independent of where the incident actually occurred (`barangayKey`, GPS-based, used only for map placement) — and that `cdrrmo`/`system_admin` retain unscoped, system-wide visibility.

**Date/Time Tested:** August 14, 2026, 2:16 PM

**Type of System:** Web-based System — Client-Server, REST API (MERN stack)

**Pre-conditions:**

- Server running with a live MongoDB connection (`users`, `emergency_reports` collections)
- Test accounts seeded:
  - `system_admin` (test account — **not** `rafael@etelly.com`, per project convention of never modifying/reusing the protected system_admin account)
  - `cdrrmo` role account
  - `barangay_official` account A, `assignedBarangay = "barangay_a"`
  - `barangay_official` account B, `assignedBarangay = "barangay_b"`
  - `barangay_official` account C, `assignedBarangay` unset/null
- Reporter 1: registered mobile user, profile `barangay = "barangay_a"`
- Reporter 2: submits with an email that has no matching `users` record
- Valid auth tokens/sessions available for each account above

| Test Cycle | Steps/Actions                                                                                                                               | Data                                                                                                            | Expected Results                                                                                                                                                                                                | Actual Results                                                                                                                                                                           | Pass/Fail |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1          | Reporter 1 (profile barangay = Barangay A) submits an emergency report where the incident's GPS pin falls physically inside Barangay B.     | `reporterEmail=reporter1@test.com` (users.barangay="barangay_a"); incident lat/lng inside Barangay B boundary | Report saved with`barangayKey="barangay_b"`, `reporterBarangayKey="barangay_a"`. Report appears in Barangay Official A's list; absent from Barangay Official B's list.                                      | Matches expected —`resolveBarangayKey`/`nearestBarangayKey` set `barangayKey` from GPS and `reporterBarangayKey` from `users.barangay` independently (`reports.js:154-188`) | Pass      |
| 2          | Barangay Official A calls`GET /api/reports`.                                                                                              | Valid Official-A session token                                                                                  | Response filtered to`{reporterBarangayKey: "barangay_a"}` only; reports from other barangays are absent from the payload.                                                                                     | Matches expected —`scopeToAssignedBarangay(req, "reporterBarangayKey")` applied at `index.js:142-151`                                                                               | Pass      |
| 3          | Reporter 2 (email not found in`users`) submits an emergency report.                                                                       | `reporterEmail` unmatched / absent                                                                            | Report saved with`reporterBarangayKey=null`. Invisible to **every** `barangay_official` (their filter never matches `null`); still visible to `cdrrmo`/`system_admin` (unscoped `{}` filter). | Matches expected — documented explicitly in code comment at`reports.js:167-169`                                                                                                       | Pass      |
| 4          | Barangay Official A attempts`POST /api/reports/update-status` on a report belonging to Barangay B (`reporterBarangayKey="barangay_b"`). | Official-A token; target`reportId` from Barangay B                                                            | `HTTP 403`, `{success:false, message:"Outside your assigned barangay"}`; status not updated.                                                                                                                | Matches expected —`rejectIfOutsideAssignedBarangay` at `index.js:204`, logic in `middleware/auth.js:47-54`                                                                        | Pass      |
| 5          | Barangay Official C (`assignedBarangay` unset) attempts `GET /api/reports`.                                                             | Official-C token,`assignedBarangay=null`                                                                      | `HTTP 403` returned before any barangay-scoping query runs.                                                                                                                                                   | Matches expected —`requireAssignedBarangayIfOfficial` guard, `middleware/auth.js:26-30`                                                                                             | Pass      |

**Comments/Remarks:**
Results above were verified through static code inspection of the current `etelly-mern` codebase (file/line references included per cycle), matching the intended design confirmed by commit `b262c30` ("Scope barangay official report visibility to reporter's registered barangay"), which superseded an earlier, reverted GPS-based (`barangayKey`) scoping approach (`fbdbbef` → `754f715`). **Before final submission, re-run these five cycles against a live server + seeded test accounts to record first-hand Actual Results**, since no code changes were made and no live test run was executed in this session. Also note: `/api/reports/approved` and `POST /api/notify-emergency` are intentionally **not** barangay-scoped (public/community-facing) — out of scope for this IT but worth a footnote if reviewers ask why not all report endpoints filter the same way. `server/scripts/backfillReportBarangayKey.js` is a stale leftover from the earlier (reverted) GPS-based scoping model and should not be used as a reference for current behavior.

---

## IT-02 — Chat Moderation ↔ ML Model Service

**IT ID:** IT-02

**Status: NOT IMPLEMENTED in the current codebase.** No test performed.

A chat-moderation-to-ML-model integration (regex + local Flask model + OpenAI moderation endpoint, fail-open on error) existed at one point in project history (commit `5ce4ae1`, "connect chatModeration to ML model service") but lived in a nested folder (`etelly-mern-master/etelly-mern-master/...`) that has since been deleted from the working tree. The moderation system actually running today in `etelly-mern/server` (`routes/chatModeration.js`, `services/chatRestrictionService.js`, `models/ChatModerationCase.js`) is entirely **human-report-driven** — there is no outbound call to any ML/model service anywhere in the current code. If this integration point is required for your submission, it needs to be either restored from history or re-scoped to describe the real system ("Chat Moderation ↔ Human Review / Report Escalation").

---

## IT-03 — Family Member Push Notification

**IT ID:** IT-03

**Status: NOT IMPLEMENTED in the current codebase.** No test performed.

Despite the commit message "push notif family member" (`8f8fef2`), that commit only added `mongoose.isValidObjectId()` guards to `family.js`'s invite handlers — no push-notification code was added. Family invites currently trigger an **email** (`sendFamilyInviteEmail`, `server/services/mailer.js`, called from `routes/family.js:82-90`), not a push notification. Push infrastructure does exist in the app (`routes/push.js`, web-push + FCM dual channel, `sendPushToUser`) but it is wired only to chat-message delivery and admin/CDRRMO emergency-report alerts — never to family-member events. If this integration is required for your submission, either the push-notification feature needs to be built first, or this IT should be re-scoped to an existing push flow (e.g., "Emergency Report ↔ Admin Push Notification").
