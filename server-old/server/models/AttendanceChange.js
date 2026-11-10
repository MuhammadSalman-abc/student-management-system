const mongoose = require("mongoose");

const attendanceChangeSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceSession", required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  previousStatus: { type: String, enum: ["present", "absent", "late", "excused", null], default: null },
  newStatus: { type: String, enum: ["present", "absent", "late", "excused"], required: true },
  reason: { type: String, required: true, maxlength: 500 },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("AttendanceChange", attendanceChangeSchema);
