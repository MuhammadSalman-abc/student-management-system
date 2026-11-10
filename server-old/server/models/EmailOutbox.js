const mongoose = require("mongoose");

const emailOutboxSchema = new mongoose.Schema({
  messageType: { type: String, enum: ["invitation", "password_reset"], required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
  invitationId: { type: mongoose.Schema.Types.ObjectId, ref: "StudentInvitation", default: null },
  passwordResetId: { type: mongoose.Schema.Types.ObjectId, ref: "StudentPasswordReset", default: null },
  encryptedPayload: { type: String, required: true, select: false },
  payloadIv: { type: String, required: true, select: false },
  payloadTag: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ["pending", "sent", "dead"], default: "pending", required: true },
  attempts: { type: Number, default: 0, min: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  lastErrorCode: { type: String, default: null, maxlength: 80 },
}, { timestamps: true, versionKey: false });

emailOutboxSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1, createdAt: 1 }, { name: "email_outbox_claim" });
emailOutboxSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 2592000, name: "email_outbox_expiry_ttl" });

module.exports = mongoose.model("EmailOutbox", emailOutboxSchema);
