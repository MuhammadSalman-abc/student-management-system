const nodemailer = require("nodemailer");
const getEmailSettings = require("../config/emailSettings");

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

const sendStudentAccessEmail = async ({ kind, recipient, studentName, link, expiresAt }) => {
  const settings = getEmailSettings();
  if (!settings.configured) return { status: "not_configured" };
  if (!["invitation", "password_reset"].includes(kind)) throw new Error("Unsupported student email type.");

  const invitation = kind === "invitation";
  const action = invitation ? "activate your StudentHub account" : "reset your StudentHub password";
  const subject = invitation ? "Activate your StudentHub account" : "Reset your StudentHub password";
  const safeName = escapeHtml(studentName || "Student");
  const safeLink = escapeHtml(link);
  const safeExpiry = new Date(expiresAt).toUTCString();
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    auth: settings.auth,
    connectionTimeout: 8_000,
    greetingTimeout: 5_000,
    socketTimeout: 15_000,
  });

  try {
    await transport.sendMail({
      from: settings.from,
      to: recipient,
      subject,
      text: `Hello ${studentName || "Student"},\n\nUse this one-time link to ${action}:\n${link}\n\nIt expires ${safeExpiry}. If you were not expecting this email, contact your institution administrator.`,
      html: `<p>Hello ${safeName},</p><p>Use this one-time link to ${action}:</p><p><a href="${safeLink}">${subject}</a></p><p>This link expires ${escapeHtml(safeExpiry)}. If you were not expecting this email, contact your institution administrator.</p>`,
    });
    return { status: "sent" };
  } finally {
    transport.close();
  }
};

module.exports = { sendStudentAccessEmail };
