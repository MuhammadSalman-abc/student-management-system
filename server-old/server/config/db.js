const mongoose = require("mongoose");
const getDbSettings = require("./dbSettings");

const connectDB = async () => {
  const { mongoUri, serverSelectionTimeoutMS } = getDbSettings();
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS });
  } catch (error) {
    let cause = error;
    let code = "";
    while (cause && !code) {
      code = typeof cause.code === "string" ? cause.code : "";
      cause = cause.cause;
    }
    const detail = code ? ` (${code})` : ` (${error.name || "connection error"})`;
    throw new Error(
      `MongoDB connection failed${detail}. Confirm the database is reachable, MONGO_URI is correct, and the replica set is initialized.`,
      { cause: error },
    );
  }
  console.log("MongoDB connected successfully");
  return mongoose.connection;
};

module.exports = connectDB;
module.exports.getDbSettings = getDbSettings;
