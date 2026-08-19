// server/services/alertSigning.js
//
// Signs each hazard alert with a fixed Ed25519 key so the E-Telly mobile app
// can spread alerts phone-to-phone over its offline P2P mesh (see
// etelly-mobile/lib/services/alert_gossip_service.dart) without a receiving
// phone being able to be tricked by a fabricated alert from another device
// in Bluetooth/WiFi range. The mobile app ships only the matching *public*
// key (etelly-mobile/lib/constants/alert_trust.dart) — this module is the
// only place that ever touches the private key.
//
// The canonical string built here MUST stay byte-for-byte identical to
// AlertSignatureService.canonicalString() on the mobile side (field order,
// separators). Any drift between the two makes every signature fail to
// verify.
import crypto from "crypto";

// Fixed 16-byte PKCS8 DER prefix for a raw 32-byte Ed25519 seed.
const PKCS8_ED25519_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

export const ALERT_SIGNING_KEY_ID = 1;

let cachedPrivateKey;
let warnedMissingKey = false;

function loadPrivateKey() {
  const b64 = process.env.ALERT_SIGNING_PRIVATE_KEY;
  if (!b64) return null;
  if (cachedPrivateKey) return cachedPrivateKey;

  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) {
    throw new Error(
      `ALERT_SIGNING_PRIVATE_KEY must decode to 32 raw bytes (got ${raw.length})`,
    );
  }
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, raw]);
  cachedPrivateKey = crypto.createPrivateKey({
    key: der,
    format: "der",
    type: "pkcs8",
  });
  return cachedPrivateKey;
}

// Field order/separators mirror AlertSignatureService.canonicalString() in
// the mobile app exactly.
export function canonicalAlertString(alert) {
  const id = String(alert._id ?? alert.id ?? "");
  const barangays = Array.isArray(alert.barangays)
    ? alert.barangays.join(",")
    : "";
  const toIso = (v) => {
    if (v == null) return "";
    return v instanceof Date ? v.toISOString() : String(v);
  };
  const isActive = alert.isActive !== false;

  return [
    id,
    alert.type ?? "",
    alert.severity ?? "",
    alert.title ?? "",
    alert.description ?? "",
    alert.location ?? "",
    barangays,
    toIso(alert.createdAt),
    toIso(alert.expiresAt),
    String(isActive),
  ].join("|");
}

/// Signs `alert` (must already have its final `_id`, since the id is part
/// of the signed string) and returns `{ signature, keyId }`, or `null` if
/// no signing key is configured on this server instance (e.g. local dev
/// without ALERT_SIGNING_PRIVATE_KEY set) — callers must treat `null` as
/// "this alert ships unsigned," not as an error, since the mobile app
/// already handles unsigned alerts gracefully (displayed normally, just
/// not gossip-eligible over the mesh).
export function signAlert(alert) {
  const key = loadPrivateKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "[AlertSigning] ALERT_SIGNING_PRIVATE_KEY not set — alerts will be created unsigned " +
          "and will not propagate over the mobile app's offline P2P mesh.",
      );
    }
    return null;
  }

  const message = Buffer.from(canonicalAlertString(alert), "utf8");
  const signature = crypto.sign(null, message, key);
  return { signature: signature.toString("base64"), keyId: ALERT_SIGNING_KEY_ID };
}
