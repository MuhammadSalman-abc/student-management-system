const mongoose = require("mongoose");

const studentInvitationSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  tokenHash: { type: String, required: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true, index: true },
  deliveryStatus: { type: String, enum: ["pending", "sent", "failed", "not_configured"], default: "pending" },
  usedAt: { type: Date, default: null },
  invalidatedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

studentInvitationSchema.index({ studentId: 1, createdAt: -1 });
studentInvitationSchema.index({ tokenHash: 1 }, { unique: true, name: "student_invitation_token_unique" });

module.exports = mongoose.model("StudentInvitation", studentInvitationSchema);
