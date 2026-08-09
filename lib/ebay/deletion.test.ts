import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  computeChallengeResponse,
  hashUserRef,
  isValidVerificationToken,
  parseNotification,
  parseSignatureHeader,
  toPem,
  verifySignature,
} from "./deletion";

/**
 * The challenge hash is the highest-stakes thing here: if it's wrong, eBay
 * silently refuses to validate the endpoint and the keyset stays disabled with
 * no useful error. So it's pinned to a fixed vector rather than only tested for
 * self-consistency.
 */

const CHALLENGE = "challenge-abc-123";
const TOKEN = "MyVerificationToken1234567890abcd";
const ENDPOINT = "https://example.test/api/ebay/account-deletion";

describe("computeChallengeResponse", () => {
  it("matches a known vector", () => {
    assert.equal(
      computeChallengeResponse(CHALLENGE, TOKEN, ENDPOINT),
      "d880cd09f4647d9aefb6d6ea9f7c834b7965c04742649344ee0d915f8633bb92",
    );
  });

  it("returns a 64-character hex digest", () => {
    const result = computeChallengeResponse(CHALLENGE, TOKEN, ENDPOINT);
    assert.match(result, /^[0-9a-f]{64}$/);
  });

  it("depends on the order of its inputs", () => {
    // eBay hashes challengeCode + token + endpoint. Swapping any two is the
    // single most common way this gets implemented wrong.
    const correct = computeChallengeResponse(CHALLENGE, TOKEN, ENDPOINT);
    const swapped = computeChallengeResponse(TOKEN, CHALLENGE, ENDPOINT);
    assert.notEqual(correct, swapped);
  });

  it("changes when the endpoint differs by a trailing slash", () => {
    assert.notEqual(
      computeChallengeResponse(CHALLENGE, TOKEN, ENDPOINT),
      computeChallengeResponse(CHALLENGE, TOKEN, `${ENDPOINT}/`),
    );
  });

  it("is stable across calls", () => {
    assert.equal(
      computeChallengeResponse(CHALLENGE, TOKEN, ENDPOINT),
      computeChallengeResponse(CHALLENGE, TOKEN, ENDPOINT),
    );
  });
});

describe("isValidVerificationToken", () => {
  it("accepts a token meeting eBay's rules", () => {
    assert.equal(isValidVerificationToken("a".repeat(32)), true);
    assert.equal(isValidVerificationToken("Abc-123_xyz".padEnd(40, "q")), true);
  });

  it("rejects tokens that are too short or too long", () => {
    assert.equal(isValidVerificationToken("a".repeat(31)), false);
    assert.equal(isValidVerificationToken("a".repeat(81)), false);
  });

  it("rejects characters eBay doesn't allow", () => {
    assert.equal(isValidVerificationToken(`${"a".repeat(31)}!`), false);
    assert.equal(isValidVerificationToken(`${"a".repeat(31)}+`), false);
    assert.equal(isValidVerificationToken(`${"a".repeat(31)} `), false);
  });
});

describe("parseSignatureHeader", () => {
  function encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  }

  it("decodes a well-formed header", () => {
    const parsed = parseSignatureHeader(
      encode({ alg: "ecdsa", kid: "key-1", signature: "c2ln", digest: "SHA1" }),
    );
    assert.equal(parsed?.kid, "key-1");
    assert.equal(parsed?.signature, "c2ln");
  });

  it("defaults alg and digest when eBay omits them", () => {
    const parsed = parseSignatureHeader(encode({ kid: "key-1", signature: "c2ln" }));
    assert.equal(parsed?.alg, "ecdsa");
    assert.equal(parsed?.digest, "SHA1");
  });

  it("returns null rather than throwing on junk", () => {
    assert.equal(parseSignatureHeader(null), null);
    assert.equal(parseSignatureHeader(""), null);
    assert.equal(parseSignatureHeader("not-base64-at-all!!"), null);
    assert.equal(parseSignatureHeader(encode({ kid: "key-1" })), null); // no signature
    assert.equal(parseSignatureHeader(encode({ signature: "c2ln" })), null); // no kid
  });
});

describe("toPem", () => {
  it("wraps bare base64 in PEM armour", () => {
    const pem = toPem("QUJDREVG");
    assert.match(pem, /^-----BEGIN PUBLIC KEY-----\n/);
    assert.match(pem, /-----END PUBLIC KEY-----\n$/);
  });

  it("leaves an existing PEM alone", () => {
    const original = "-----BEGIN PUBLIC KEY-----\nQUJD\n-----END PUBLIC KEY-----";
    assert.equal(toPem(original).trim(), original.trim());
  });

  it("repairs escaped newlines", () => {
    const escaped = "-----BEGIN PUBLIC KEY-----\\nQUJD\\n-----END PUBLIC KEY-----";
    assert.ok(toPem(escaped).includes("\n"));
    assert.ok(!toPem(escaped).includes("\\n"));
  });

  it("splits long base64 into 64-character lines", () => {
    const lines = toPem("A".repeat(200)).split("\n").slice(1, -2);
    assert.ok(lines.every((l) => l.length <= 64));
  });
});

describe("verifySignature", () => {
  // eBay signs with ECDSA over a SHA1 digest, so mirror that here.
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const body = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" } });

  function sign(payload: string): string {
    const signer = createSign("SHA1");
    signer.update(payload, "utf8");
    signer.end();
    return signer.sign(privateKey).toString("base64");
  }

  const header = { alg: "ecdsa", kid: "k", digest: "SHA1", signature: sign(body) };

  it("accepts a genuine signature", () => {
    assert.equal(verifySignature(body, header, publicPem), true);
  });

  it("accepts a key supplied as bare base64", () => {
    const bare = publicPem
      .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
      .replace(/\s+/g, "");
    assert.equal(verifySignature(body, header, bare), true);
  });

  it("rejects a tampered body", () => {
    const tampered = JSON.stringify({ metadata: { topic: "SOMETHING_ELSE" } });
    assert.equal(verifySignature(tampered, header, publicPem), false);
  });

  it("rejects a signature from a different key", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const otherPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();
    assert.equal(verifySignature(body, header, otherPem), false);
  });

  it("returns false rather than throwing on a malformed key", () => {
    assert.equal(verifySignature(body, header, "not a key"), false);
  });

  it("returns false rather than throwing on a malformed signature", () => {
    assert.equal(
      verifySignature(body, { ...header, signature: "!!!not-base64!!!" }, publicPem),
      false,
    );
  });
});

describe("parseNotification", () => {
  const valid = {
    metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0" },
    notification: {
      notificationId: "notif-1",
      eventDate: "2026-08-09T20:50:00.000Z",
      data: { username: "someuser", userId: "ma8vp1jySJC", eiasToken: "nY+sHZ2P" },
    },
  };

  it("extracts the fields we need", () => {
    const parsed = parseNotification(valid);
    assert.equal(parsed?.notificationId, "notif-1");
    assert.equal(parsed?.ebayUserId, "ma8vp1jySJC");
    assert.equal(parsed?.eventDate?.toISOString(), "2026-08-09T20:50:00.000Z");
  });

  it("does not carry the username or eiasToken forward", () => {
    // Nothing downstream should be able to accidentally persist these.
    const parsed = parseNotification(valid) as Record<string, unknown> | null;
    assert.ok(parsed);
    assert.equal("username" in parsed, false);
    assert.equal("eiasToken" in parsed, false);
  });

  it("ignores notifications for other topics", () => {
    const other = { ...valid, metadata: { topic: "ITEM_SOLD" } };
    assert.equal(parseNotification(other), null);
  });

  it("rejects payloads missing required fields", () => {
    assert.equal(parseNotification({}), null);
    assert.equal(parseNotification(null), null);
    assert.equal(
      parseNotification({ ...valid, notification: { notificationId: "x", data: {} } }),
      null,
    );
  });

  it("tolerates a missing or unparseable event date", () => {
    const noDate = {
      ...valid,
      notification: { ...valid.notification, eventDate: undefined },
    };
    assert.equal(parseNotification(noDate)?.eventDate, null);

    const badDate = {
      ...valid,
      notification: { ...valid.notification, eventDate: "not a date" },
    };
    assert.equal(parseNotification(badDate)?.eventDate, null);
  });
});

describe("hashUserRef", () => {
  it("is deterministic", () => {
    assert.equal(hashUserRef("user-1", "salt"), hashUserRef("user-1", "salt"));
  });

  it("differs per user", () => {
    assert.notEqual(hashUserRef("user-1", "salt"), hashUserRef("user-2", "salt"));
  });

  it("differs per salt, so the hash isn't a global identifier", () => {
    assert.notEqual(hashUserRef("user-1", "salt-a"), hashUserRef("user-1", "salt-b"));
  });

  it("does not contain the original id", () => {
    assert.ok(!hashUserRef("ma8vp1jySJC", "salt").includes("ma8vp1jySJC"));
  });
});
