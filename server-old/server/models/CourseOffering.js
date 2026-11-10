const mongoose = require("mongoose");

const courseOfferingSchema = new mongoose.Schema({
  courseCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
  courseName: { type: String, required: true, trim: true, maxlength: 120 },
  term: { type: String, required: true, trim: true, maxlength: 60 },
  section: { type: String, required: true, trim: true, maxlength: 30 },
  startDate: { type: Date },
  endDate: { type: Date },
  status: { type: String, enum: ["active", "archived"], default: "active", index: true },
  // Incremented by roster mutations and transactions that publish a roster
  // snapshot, so MongoDB detects concurrent enrollment/state transitions.
  rosterLockVersion: { type: Number, default: 0, min: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

courseOfferingSchema.index({ courseCode: 1, term: 1, section: 1 }, { unique: true, name: "course_offering_identity_unique" });

module.exports = mongoose.model("CourseOffering", courseOfferingSchema);
