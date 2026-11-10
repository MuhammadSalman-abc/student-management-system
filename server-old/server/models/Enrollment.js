const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  offeringId: { type: mongoose.Schema.Types.ObjectId, ref: "CourseOffering", required: true, index: true },
  status: { type: String, enum: ["active", "withdrawn"], default: "active", index: true },
  enrolledAt: { type: Date, default: Date.now },
  withdrawnAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

enrollmentSchema.index({ studentId: 1, offeringId: 1 }, { unique: true, name: "enrollment_student_offering_unique" });

module.exports = mongoose.model("Enrollment", enrollmentSchema);
