const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    // A bounded JPEG uploaded by the account owner. Kept out of normal user
    // queries and served only through the authenticated photo route.
    profilePhoto: {
      type: Buffer,
      select: false,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 8,
    },

    role: {
      type: String,
      enum: ["student", "admin"],
      default: "student",
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ email: 1 }, { unique: true, name: "user_email_unique" });

module.exports = mongoose.model("User", userSchema);
