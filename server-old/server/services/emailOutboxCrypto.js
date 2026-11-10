const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");

const getEncryptionKey = () => {
  const encoded = process.env.EMAIL_OUTBOX_ENCRYPTION_KEY || "";
  let key;
  try { key = Buffer.from(encoded, "base64"); } catch { key = null; }
  if (!key || key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("EMAIL_OUTBOX_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key when SMTP is configured.");
  }
  return key;
};

const encryptPayload = (payload, recordId, messageType) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${recordId}:${messageType}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { encryptedPayload: encrypted.toString("base64"), payloadIv: iv.toString("base64"), payloadTag: cipher.getAuthTag().toString("base64") };
};

const decryptPayload = (record) => {
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(record.payloadIv, "base64"));
  decipher.setAAD(Buffer.from(`${record._id}:${record.messageType}`));
  decipher.setAuthTag(Buffer.from(record.payloadTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.encryptedPayload, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
};

module.exports = { encryptPayload, decryptPayload, getEncryptionKey };
