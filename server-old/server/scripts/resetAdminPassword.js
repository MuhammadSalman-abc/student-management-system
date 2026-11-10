const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");

dotenv.config({ path: require("node:path").join(__dirname, "..", ".env"), quiet: true });

const askSecret = (prompt) => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return reject(new Error("Password reset requires an interactive terminal."));
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  const cleanup = () => {
    stdin.removeListener("data", onData);
    stdin.setRawMode(false);
    stdin.pause();
  };
  const onData = (chunk) => {
    const key = chunk.toString("utf8");
    if (key === "\u0003") {
      cleanup();
      reject(new Error("Password reset cancelled."));
    } else if (key === "\r" || key === "\n") {
      cleanup();
      stdout.write("\n");
      resolve(value);
    } else if (key === "\u007f" || key === "\b") {
      if (value.length) {
        value = value.slice(0, -1);
        stdout.write("\b \b");
      }
    } else if (key >= " " && key.length === 1) {
      value += key;
      stdout.write("*");
    }
  };
  stdin.on("data", onData);
});

const parseEmail = (args) => {
  if (args.length !== 2 || args[0] !== "--email" || !args[1]) {
    throw new Error("Usage: npm run reset-admin-password -- --email <admin-email>");
  }
  const email = args[1].trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid admin email address.");
  return email;
};

const main = async () => {
  const email = parseEmail(process.argv.slice(2));
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required in server-old/server/.env.");
  await connectDB();
  const user = await User.findOne({ email, role: "admin" });
  if (!user) throw new Error("No admin account exists for that email address.");
  if (user.active === false) throw new Error("This admin account is disabled. Restore access through the authorized account workflow first.");

  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`Reset password for admin: ${user.email}\n`);
    const password = await askSecret("New password (min 12 chars, hidden): ");
    const confirmation = await askSecret("Confirm new password (hidden): ");
    if (password.length < 12 || password.length > 128) throw new Error("Password must be between 12 and 128 characters.");
    if (password !== confirmation) throw new Error("Passwords do not match.");
    user.password = await bcrypt.hash(password, 12);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    console.log(`Admin password updated for ${user.email}. Previous sessions have been revoked.`);
  } finally {
    terminal.close();
  }
};

main().catch((error) => {
  console.error(`Admin password reset failed: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => {});
});
