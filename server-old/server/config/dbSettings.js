const getDbSettings = (env = process.env) => {
  if (!env.MONGO_URI || !env.MONGO_URI.trim()) throw new Error("MONGO_URI is required.");
  const serverSelectionTimeoutMS = env.DB_CONNECT_TIMEOUT_MS === undefined
    ? 10_000
    : Number(env.DB_CONNECT_TIMEOUT_MS);
  if (!Number.isSafeInteger(serverSelectionTimeoutMS)
    || serverSelectionTimeoutMS < 1_000
    || serverSelectionTimeoutMS > 120_000) {
    throw new Error("DB_CONNECT_TIMEOUT_MS must be a whole number between 1000 and 120000.");
  }
  return { mongoUri: env.MONGO_URI, serverSelectionTimeoutMS };
};

module.exports = getDbSettings;
