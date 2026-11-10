const mongoose = require("mongoose");

const studentPasswordResetSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  tokenHash: { type: String, required: true },
  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
  deliveryStatus: { type: String, enum: ["pending", "sent", "failed", "not_configured"], default: "pending" },
  usedAt: { type: Date, default: null },
  invalidatedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

studentPasswordResetSchema.index({ tokenHash: 1 }, { unique: true, name: "student_password_reset_token_unique" });
studentPasswordResetSchema.index({ studentId: 1, createdAt: -1 }, { name: "student_password_reset_student_created" });
studentPasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 2592000, name: "student_password_reset_ttl" });

module.exports = mongoose.model("StudentPasswordReset", studentPasswordResetSchema);
