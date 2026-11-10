const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const { pipeline } = require("node:stream/promises");

const ALGORITHM = "aes-256-gcm";
const FORMAT = "studenthub-mongodump-aes-256-gcm-v2";

const createBackupAad = ({ database, collections, file }) => Buffer.from(JSON.stringify({ format: FORMAT, database, collections, file }));

const getBackupKey = () => {
  const encoded = process.env.BACKUP_ENCRYPTION_KEY;
  if (typeof encoded !== "string" || !encoded) {
    throw new Error("BACKUP_ENCRYPTION_KEY is required. Generate a random 32-byte key and store it in a secrets manager.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a canonical base64 encoding of exactly 32 random bytes.");
  }
  return key;
};

const encryptFile = async (sourcePath, destinationPath, aad) => {
  const key = getBackupKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  await pipeline(
    createReadStream(sourcePath),
    cipher,
    createWriteStream(destinationPath, { flags: "wx", mode: 0o600 })
  );
  return { algorithm: ALGORITHM, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
};

const decryptFile = async (sourcePath, destinationPath, encryption, aad) => {
  if (encryption?.algorithm !== ALGORITHM) throw new Error("Backup encryption algorithm is unsupported.");
  const iv = Buffer.from(encryption.iv || "", "base64");
  const authTag = Buffer.from(encryption.authTag || "", "base64");
  if (iv.length !== 12 || authTag.length !== 16
    || iv.toString("base64") !== encryption.iv || authTag.toString("base64") !== encryption.authTag) {
    throw new Error("Backup encryption metadata is invalid.");
  }
  const decipher = createDecipheriv(ALGORITHM, getBackupKey(), iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  await pipeline(
    createReadStream(sourcePath),
    decipher,
    createWriteStream(destinationPath, { flags: "wx", mode: 0o600 })
  );
};

module.exports = { ALGORITHM, FORMAT, createBackupAad, getBackupKey, encryptFile, decryptFile };
