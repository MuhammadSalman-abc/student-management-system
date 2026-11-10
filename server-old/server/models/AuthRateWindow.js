const mongoose = require("mongoose");

const authRateWindowSchema = new mongoose.Schema({
  key: { type: String, required: true },
  count: { type: Number, required: true, default: 0 },
  resetAt: { type: Date, required: true },
}, { versionKey: false });

// Expire old windows after the fixed window closes; never expire active limits.
authRateWindowSchema.index({ key: 1 }, { unique: true, name: "auth_rate_key_unique" });
authRateWindowSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0, name: "auth_rate_reset_ttl" });

module.exports = mongoose.model("AuthRateWindow", authRateWindowSchema);
