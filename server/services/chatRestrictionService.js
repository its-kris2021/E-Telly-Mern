import ChatUserModerationProfile from "../models/ChatUserModerationProfile.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Escalation ladder. Index = violation number (1-based); every violation
// past the 4th repeats the 7-day tier automatically — "permanent" is
// deliberately never reached automatically, it's an admin-only manual action
// (see applyManualRestriction) for severe or repeated violations.
const RESTRICTION_TIERS = {
  1: { type: "warning", durationMs: null, label: "warning only" },
  2: { type: "temporary", durationMs: DAY_MS, label: "24 hours" },
  3: { type: "temporary", durationMs: 3 * DAY_MS, label: "3 days" },
  4: { type: "temporary", durationMs: 7 * DAY_MS, label: "7 days" },
};

export function tierForViolationNumber(violationNumber) {
  return RESTRICTION_TIERS[violationNumber] || RESTRICTION_TIERS[4];
}

// Loads a user's cross-case moderation profile, creating an empty one on
// first touch. Used by write paths (warn, manual restriction) that need a
// profile to exist. Read-only checks should use findProfile instead so a
// user who has never violated anything doesn't get a row created just by
// being looked up (e.g. every message sender, via the change-stream guard).
export async function getOrCreateProfile(userId) {
  return ChatUserModerationProfile.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        warningCount: 0,
        restricted: false,
        restrictedAt: null,
        restrictionType: "none",
        restrictionStartAt: null,
        restrictionEndAt: null,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
}

export async function findProfile(userId) {
  return ChatUserModerationProfile.findOne({ userId });
}

// Read paths that display restriction state to staff (case list, case
// detail, user violation summary) must not trust the raw stored fields —
// without this, an expired temporary restriction keeps showing as "active"
// in the admin UI until the resident happens to hit /status or send a
// message, since those are the only paths that otherwise apply refreshExpiry.
// These wrap findProfile/find with the same lazy-expiry-then-persist logic.
export async function findProfileWithExpiryApplied(userId) {
  const profile = await findProfile(userId);
  if (!profile) return null;
  if (refreshExpiry(profile)) await profile.save();
  return profile;
}

export async function findProfilesWithExpiryApplied(userIds) {
  if (!userIds.length) return [];
  const profiles = await ChatUserModerationProfile.find({ userId: { $in: userIds } });
  await Promise.all(profiles.filter((p) => refreshExpiry(p)).map((p) => p.save()));
  return profiles;
}

// Lazily clears an expired temporary restriction so access is regained
// automatically without any admin action. Mutates `profile` in place and
// returns true if it changed something the caller must persist — this
// function never calls .save() itself so it composes with callers that are
// already mid-way through their own mutation (e.g. the warn flow).
export function refreshExpiry(profile, now = new Date()) {
  if (
    profile.restricted &&
    profile.restrictionType === "temporary" &&
    profile.restrictionEndAt &&
    profile.restrictionEndAt <= now
  ) {
    profile.restricted = false;
    profile.restrictionType = "none";
    profile.restrictionStartAt = null;
    profile.restrictionEndAt = null;
    profile.history.push({
      action: "restriction_expired",
      at: now,
      note: "Restriction automatically expired",
    });
    return true;
  }
  return false;
}

function formatDateTime(date) {
  return new Date(date).toLocaleString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatUserMessage(profile) {
  if (!profile.restricted) return null;
  if (profile.restrictionType === "permanent") {
    return "Your chat access has been permanently restricted due to repeated or severe violations. Please contact an administrator if you believe this was a mistake.";
  }
  return `Your chat access is temporarily restricted due to repeated violations. You can send messages again on ${formatDateTime(profile.restrictionEndAt)}.`;
}

export function computeStatus(profile) {
  return {
    warningCount: profile.warningCount,
    restricted: profile.restricted,
    permanent: profile.restrictionType === "permanent",
    restrictionType: profile.restrictionType,
    restrictionStartAt: profile.restrictionStartAt,
    restrictionEndAt: profile.restrictionEndAt,
    message: formatUserMessage(profile),
  };
}

// Read-only status check with lazy expiry, for both the resident-facing
// /api/chat-restriction/status endpoint and the messages change-stream
// enforcement guard in index.js. Never creates a profile — a user with no
// moderation history simply isn't restricted.
export async function getRestrictionStatus(userId) {
  const profile = await findProfile(userId);
  if (!profile) {
    return {
      warningCount: 0,
      restricted: false,
      permanent: false,
      restrictionType: "none",
      restrictionStartAt: null,
      restrictionEndAt: null,
      message: null,
    };
  }
  if (refreshExpiry(profile)) await profile.save();
  return computeStatus(profile);
}

// Admin manual action — applies a restriction independent of the case/warn
// flow (e.g. a severe single incident, or escalating past the automatic
// ladder to a permanent ban). type is "temporary" (durationMs required) or
// "permanent" (durationMs ignored, no expiry).
export async function applyManualRestriction({ userId, type, durationMs, actorId, actorName, actorRole, note }) {
  const profile = await getOrCreateProfile(userId);
  const now = new Date();
  profile.restricted = true;
  profile.restrictedAt = now;
  profile.restrictionType = type;
  profile.restrictionStartAt = now;
  profile.restrictionEndAt = type === "permanent" ? null : new Date(now.getTime() + durationMs);
  profile.history.push({
    action: "restriction_applied",
    byId: actorId,
    byName: actorName,
    byRole: actorRole,
    at: now,
    note: note || `Manually applied — ${type} restriction`,
  });
  await profile.save();
  return profile;
}

// Admin manual action — clears whatever restriction is currently active
// (temporary or permanent). Does not touch warningCount/history of past
// violations, only the live restriction state.
export async function clearRestriction({ userId, actorId, actorName, actorRole, note }) {
  const profile = await getOrCreateProfile(userId);
  const now = new Date();
  profile.restricted = false;
  profile.restrictionType = "none";
  profile.restrictionStartAt = null;
  profile.restrictionEndAt = null;
  profile.history.push({
    action: "restriction_removed",
    byId: actorId,
    byName: actorName,
    byRole: actorRole,
    at: now,
    note: note || "Restriction manually removed by admin",
  });
  await profile.save();
  return profile;
}
