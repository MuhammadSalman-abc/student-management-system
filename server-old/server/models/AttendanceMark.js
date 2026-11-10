const mongoose = require("mongoose");

const attendanceMarkSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceSession", required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  status: { type: String, enum: ["present", "absent", "late", "excused"], required: true },
  note: { type: String, maxlength: 300 },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  markedAt: { type: Date, default: Date.now },
}, { timestamps: true });

attendanceMarkSchema.index({ sessionId: 1, studentId: 1 }, { unique: true, name: "attendance_mark_session_student_unique" });

module.exports = mongoose.model("AttendanceMark", attendanceMarkSchema);
