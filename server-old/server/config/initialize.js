const mongoose = require("mongoose");
const connectDB = require("./db");
const getDbSettings = require("./dbSettings");
const getSessionSettings = require("./session");
const getEmailSettings = require("./emailSettings");
const { getEncryptionKey } = require("../services/emailOutboxCrypto");

const modelNames = ["User", "Student", "StudentInvitation", "StudentPasswordReset", "EmailOutbox", "DataMigration", "AuthRateWindow", "CourseOffering", "Enrollment", "AttendanceSession", "AttendanceMark", "AttendanceChange", "Assessment", "AssessmentResult", "AssessmentChange", "AuditEvent", "Assignment"];
let initializationPromise;

const validateEnvironment = (allowedOrigins) => {
  getDbSettings();
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32
    || process.env.JWT_SECRET === "replace-with-a-random-secret-of-at-least-32-characters") {
    throw new Error("JWT_SECRET must be set to a secret of at least 32 characters.");
  }
  getSessionSettings();
  const emailSettings = getEmailSettings();
  if (process.env.NODE_ENV === "production" && !emailSettings.configured) {
    throw new Error("SMTP_HOST and SMTP_FROM are required for production student account email delivery.");
  }
  if (emailSettings.configured) getEncryptionKey();
  if (!process.env.CLIENT_APP_URL) throw new Error("CLIENT_APP_URL is required for student invitations.");
  if (!allowedOrigins.length) throw new Error("CLIENT_ORIGINS must contain at least one frontend origin.");
  const isProductionHost = (hostname) => hostname.includes(".")
    && !hostname.endsWith(".localhost") && hostname !== "localhost"
    && !hostname.startsWith("[") && !/^\d+(?:\.\d+){3}$/.test(hostname);
  for (const origin of allowedOrigins) {
    let parsedOrigin;
    try { parsedOrigin = new URL(origin); } catch { throw new Error("Each CLIENT_ORIGINS entry must be a valid origin URL."); }
    if (!["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin || parsedOrigin.username || parsedOrigin.password) {
      throw new Error("Each CLIENT_ORIGINS entry must be an exact HTTP(S) origin without a path or credentials.");
    }
    if (process.env.NODE_ENV === "production" && (parsedOrigin.protocol !== "https:" || !isProductionHost(parsedOrigin.hostname))) {
      throw new Error("Every CLIENT_ORIGINS entry must use HTTPS and a DNS hostname in production.");
    }
  }
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be a whole number between 0 and 10.");
  }
  const port = process.env.PORT === undefined || process.env.PORT.trim() === "" ? 5000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  const clientAppUrl = new URL(process.env.CLIENT_APP_URL);
  if (!["http:", "https:"].includes(clientAppUrl.protocol) || clientAppUrl.username || clientAppUrl.password || clientAppUrl.search || clientAppUrl.hash) {
    throw new Error("CLIENT_APP_URL must be a plain HTTP(S) URL without credentials, query, or fragment.");
  }
  if (!allowedOrigins.includes(clientAppUrl.origin)) throw new Error("CLIENT_APP_URL must use an origin listed in CLIENT_ORIGINS.");
  if (process.env.NODE_ENV === "production" && (clientAppUrl.protocol !== "https:" || !isProductionHost(clientAppUrl.hostname))) {
    throw new Error("CLIENT_APP_URL must use HTTPS and a DNS hostname in production.");
  }
  return { emailSettings, port, trustProxyHops };
};

const ensureIndexes = async () => {
  for (const name of modelNames) {
    const model = mongoose.model(name);
    const existing = await model.collection.indexes();
    for (const [keys, options] of model.schema.indexes()) {
      const candidates = existing.filter((item) => JSON.stringify(item.key) === JSON.stringify(keys));
      const index = (options.name && candidates.find((item) => item.name === options.name)) || candidates[0];
      const ttlMatches = (options.expireAfterSeconds ?? null) === (index?.expireAfterSeconds ?? null);
      const uniquenessMatches = Boolean(index?.unique) === Boolean(options.unique);
      const sparsityMatches = Boolean(index?.sparse) === Boolean(options.sparse);
      if (!index || !uniquenessMatches || !sparsityMatches || !ttlMatches || (options.name && index.name !== options.name)) {
        throw new Error(`Required database index is missing or outdated for ${name}.${options.name || JSON.stringify(keys)}. Run npm run ensure:indexes against this database, then restart the API.`);
      }
    }
  }
};

const initialize = async ({ allowedOrigins }) => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const settings = validateEnvironment(allowedOrigins);
      if (mongoose.connection.readyState !== 1) await connectDB();
      await ensureIndexes();
      return settings;
    })().catch((error) => {
      initializationPromise = undefined;
      throw error;
    });
  }
  return initializationPromise;
};

module.exports = initialize;
