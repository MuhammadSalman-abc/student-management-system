const mongoose = require("mongoose");

const auditEventSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  eventType: { type: String, enum: ["academic_export", "account_password_changed", "student_created", "student_updated", "student_archived", "student_restored", "student_invitation_created", "student_password_reset_issued", "student_password_reset_completed", "student_account_disabled", "student_account_reactivated", "student_account_linked", "students_imported", "offering_archived", "offering_restored", "enrollment_created", "legacy_enrollment_created", "enrollment_reactivated", "enrollment_withdrawn", "assessment_published", "attendance_finalized"], required: true, immutable: true },
  reportType: { type: String, enum: ["attendance", "results"], immutable: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", immutable: true },
  offeringId: { type: mongoose.Schema.Types.ObjectId, ref: "CourseOffering", default: null, immutable: true },
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", default: null, immutable: true },
  attendanceSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceSession", default: null, immutable: true },
  changedFields: { type: [{ type: String, enum: ["name", "email", "studentNumber", "course", "batch", "attendance", "assignmentScore", "finalScore", "accountLink"] }], default: undefined, immutable: true },
  from: { type: String, default: null, immutable: true },
  to: { type: String, default: null, immutable: true },
  rowCount: { type: Number, min: 0, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, strict: "throw" });

auditEventSchema.index({ eventType: 1, createdAt: -1 });
auditEventSchema.index({ actorId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditEvent", auditEventSchema);
