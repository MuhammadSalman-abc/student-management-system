const mongoose = require("mongoose");

const dataMigrationSchema = new mongoose.Schema({
  migrationKey: { type: String, required: true, immutable: true },
  mappingHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  status: { type: String, enum: ["running", "failed", "completed"], default: "running", required: true },
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  startedAt: { type: Date, default: Date.now, immutable: true },
  completedAt: { type: Date, default: null },
  lastErrorCode: { type: String, default: null, maxlength: 80 },
}, { timestamps: true, versionKey: false });

dataMigrationSchema.index({ migrationKey: 1 }, { unique: true, name: "data_migration_key_unique" });

module.exports = mongoose.model("DataMigration", dataMigrationSchema);
