/**
 * scripts/chatModerationScheduler.js
 *
 * Cron orchestrator — periodically clears expired temporary chat
 * restrictions. See runRestrictionExpiryCleanup in
 * services/chatRestrictionService.js for why this sweep has to exist as a
 * standalone job rather than relying on the lazy per-request expiry checks:
 * the mobile app reads the raw `restricted` field directly out of MongoDB
 * and never triggers those lazy paths.
 *
 * Runs regardless of local/cloud mode (see index.js) — this is a pure local
 * DB operation with no external dependency, unlike the hazard-alert cron
 * jobs in alertEngine.js which are skipped in local (offline) mode.
 */

import cron from "node-cron";
import { runRestrictionExpiryCleanup } from "../services/chatRestrictionService.js";

async function runCleanup() {
  try {
    const count = await runRestrictionExpiryCleanup();
    if (count > 0) {
      console.log(`[ChatModeration] Restriction expiry sweep — auto-unrestricted ${count} user(s).`);
    }
  } catch (err) {
    console.error("[ChatModeration] Restriction expiry sweep failed:", err.message);
  }
}

export function startChatModerationScheduler() {
  // Once shortly after startup, in case restrictions expired while the
  // server was down — then every 5 minutes, which is plenty precise for
  // restrictions measured in days.
  setTimeout(runCleanup, 3000);
  cron.schedule("*/5 * * * *", runCleanup, { scheduled: true, timezone: "Asia/Manila" });
}
