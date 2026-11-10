const mongoose = require("mongoose");

const attendanceSessionSchema = new mongoose.Schema({
  offeringId: { type: mongoose.Schema.Types.ObjectId, ref: "CourseOffering", required: true, index: true },
  sessionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  status: { type: String, enum: ["draft", "finalized"], default: "draft", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  finalizedAt: { type: Date },
  revision: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

attendanceSessionSchema.index({ offeringId: 1, sessionDate: 1 }, { unique: true, name: "attendance_offering_date_unique" });
attendanceSessionSchema.index({ status: 1, sessionDate: 1, offeringId: 1 });

module.exports = mongoose.model("AttendanceSession", attendanceSessionSchema);
