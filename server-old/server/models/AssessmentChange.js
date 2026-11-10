const mongoose = require("mongoose");

const assessmentChangeSchema = new mongoose.Schema({
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  previousScore: { type: Number, required: true },
  newScore: { type: Number, required: true },
  previousFeedback: { type: String, maxlength: 500 },
  newFeedback: { type: String, maxlength: 500 },
  reason: { type: String, required: true, maxlength: 500 },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("AssessmentChange", assessmentChangeSchema);
