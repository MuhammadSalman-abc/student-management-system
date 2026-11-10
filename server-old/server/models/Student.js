const mongoose = require("mongoose");
const { Schema } = mongoose;

const studentSchema = new mongoose.Schema(
  {
  userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    studentNumber: {
      type: String,
      trim: true,
      maxlength: 40,
    },

    course: {
      type: String,
      trim: true,
    },

    batch: {
      type: String,
      trim: true,
    },

    // Optional legacy snapshots; dated academic records are the source of truth.
    attendance: {
      type: Number,
      min: 0,
      max: 100,
    },

    assignmentScore: {
      type: Number,
      min: 0,
      max: 100,
    },

    finalScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },
    // Internal write token used to serialize enrollment/account lifecycle
    // transactions against archive and restore transitions.
    lifecycleLockVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

studentSchema.index({ userId: 1 }, { unique: true, sparse: true, name: "student_user_unique" });
studentSchema.index({ email: 1 }, { unique: true, name: "student_email_unique" });
studentSchema.index({ studentNumber: 1 }, { unique: true, sparse: true, name: "student_number_unique" });

module.exports = mongoose.model(
  "Student",
  studentSchema
);
