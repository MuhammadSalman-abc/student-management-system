const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const User = require("../models/User");

dotenv.config();

const askSecret = (prompt) => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return reject(new Error("Admin setup requires an interactive terminal."));
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  const onData = (chunk) => {
    const key = chunk.toString("utf8");
    if (key === "\u0003") {
      cleanup();
      reject(new Error("Admin setup cancelled."));
    } else if (key === "\r" || key === "\n") {
      cleanup();
      stdout.write("\n");
      resolve(value);
    } else if (key === "\u007f" || key === "\b") {
      if (value.length > 0) {
        value = value.slice(0, -1);
        stdout.write("\b \b");
      }
    } else if (key >= " " && key.length === 1) {
      value += key;
      stdout.write("*");
    }
  };
  const cleanup = () => {
    stdin.removeListener("data", onData);
    stdin.setRawMode(false);
    stdin.pause();
  };
  stdin.on("data", onData);
});

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required in server-old/server/.env.");
  await connectDB();
  if (await User.exists({ role: "admin" })) {
    throw new Error("An admin account already exists. Use the authorized admin account workflow instead.");
  }

  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const name = (await terminal.question("Admin full name: ")).trim();
    const email = (await terminal.question("Admin email: ")).trim().toLowerCase();
    const password = await askSecret("Password (min 12 chars, hidden): ");
    const confirmation = await askSecret("Confirm password (hidden): ");
    if (!name || name.length > 100) throw new Error("Name is required and must be 100 characters or fewer.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
    if (password.length < 12 || password.length > 128) throw new Error("Password must be between 12 and 128 characters.");
    if (password !== confirmation) throw new Error("Passwords do not match.");
    if (await User.exists({ email })) throw new Error("An account with that email already exists.");

    await User.create({ name, email, password: await bcrypt.hash(password, 12), role: "admin" });
    console.log(`Admin account created for ${email}. Store the password in your approved password manager.`);
  } finally {
    terminal.close();
  }
};

main()
  .catch((error) => {
    console.error(`Admin setup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = require("mongoose");
    await mongoose.disconnect().catch(() => {});
  });
