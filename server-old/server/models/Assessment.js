const mongoose = require("mongoose");

const assessmentSchema = new mongoose.Schema({
  offeringId: { type: mongoose.Schema.Types.ObjectId, ref: "CourseOffering", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  type: { type: String, enum: ["assignment", "quiz", "midterm", "final", "project", "other"], default: "assignment" },
  maxScore: { type: Number, required: true, min: 0.01, max: 100000 },
  weight: { type: Number, min: 0, max: 100 },
  dueDate: { type: Date },
  status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
  publishedAt: { type: Date },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  revision: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

assessmentSchema.index({ offeringId: 1, status: 1, dueDate: 1 });
assessmentSchema.index({ status: 1, publishedAt: 1, offeringId: 1 });

module.exports = mongoose.model("Assessment", assessmentSchema);
