const mongoose = require("mongoose");

const assessmentResultSchema = new mongoose.Schema({
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  score: { type: Number, required: true, min: 0, max: 100000 },
  feedback: { type: String, maxlength: 500 },
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  gradedAt: { type: Date, default: Date.now },
}, { timestamps: true });

assessmentResultSchema.index({ assessmentId: 1, studentId: 1 }, { unique: true, name: "assessment_result_student_unique" });

module.exports = mongoose.model("AssessmentResult", assessmentResultSchema);
