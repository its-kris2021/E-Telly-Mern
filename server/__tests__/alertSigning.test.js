import crypto from "crypto";

// Self-contained test keypair (not the real ALERT_SIGNING_PRIVATE_KEY) so
// this test never depends on ambient .env state. Ed25519 raw 32-byte seed.
process.env.ALERT_SIGNING_PRIVATE_KEY = "xHXPumUWSQkf4GxoNuGIll5ivteRY1yJfT2kVRxJEeo=";
const TEST_PUBLIC_KEY_B64 = "+f51hJr/rFxgzijhNBbBIcmAgVkq22MBo0nJP4Nspdo=";

const { canonicalAlertString, signAlert, ALERT_SIGNING_KEY_ID } = await import(
  "../services/alertSigning.js"
);

function verifyRaw(canonical, signatureB64, publicKeyB64) {
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(publicKeyB64, "base64"),
  ]);
  const pubKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  return crypto.verify(null, Buffer.from(canonical, "utf8"), pubKey, Buffer.from(signatureB64, "base64"));
}

function baseAlert() {
  return {
    _id: "65f1a2b3c4d5e6f7a8b9c0d1",
    type: "flood",
    severity: "evacuate",
    title: "Test Flood Alert",
    description: "Water rising fast near the river.",
    location: "Antipolo City, Rizal",
    barangays: ["San Roque", "Dela Paz"],
    createdAt: new Date("2026-08-19T10:00:00.000Z"),
    expiresAt: null,
    isActive: true,
  };
}

describe("canonicalAlertString", () => {
  it("joins fields in the fixed pipe-delimited order the mobile app expects", () => {
    expect(canonicalAlertString(baseAlert())).toBe(
      "65f1a2b3c4d5e6f7a8b9c0d1|flood|evacuate|Test Flood Alert|" +
        "Water rising fast near the river.|Antipolo City, Rizal|" +
        "San Roque,Dela Paz|2026-08-19T10:00:00.000Z||true",
    );
  });

  it("treats a missing isActive as active (matches the schema default)", () => {
    const alert = baseAlert();
    delete alert.isActive;
    expect(canonicalAlertString(alert)).toContain("|true");
  });

  it("renders isActive:false explicitly", () => {
    const alert = { ...baseAlert(), isActive: false };
    expect(canonicalAlertString(alert)).toContain("|false");
  });
});

describe("signAlert", () => {
  it("produces a signature verifiable with the matching public key", () => {
    const signed = signAlert(baseAlert());
    expect(signed).not.toBeNull();
    expect(signed.keyId).toBe(ALERT_SIGNING_KEY_ID);
    expect(
      verifyRaw(canonicalAlertString(baseAlert()), signed.signature, TEST_PUBLIC_KEY_B64),
    ).toBe(true);
  });

  it("produces a signature that fails verification if any field changes after signing", () => {
    const alert = baseAlert();
    const signed = signAlert(alert);
    const tampered = { ...alert, severity: "watch" };
    expect(
      verifyRaw(canonicalAlertString(tampered), signed.signature, TEST_PUBLIC_KEY_B64),
    ).toBe(false);
  });

  it("returns null when no signing key is configured", () => {
    // loadPrivateKey() checks process.env before ever consulting its
    // module-level key cache (see services/alertSigning.js), so this is
    // safe to assert even after earlier tests in this file have already
    // triggered a successful, cached key load.
    const original = process.env.ALERT_SIGNING_PRIVATE_KEY;
    delete process.env.ALERT_SIGNING_PRIVATE_KEY;
    try {
      expect(signAlert(baseAlert())).toBeNull();
    } finally {
      process.env.ALERT_SIGNING_PRIVATE_KEY = original;
    }
  });
});
