const EmailOutbox = require("../models/EmailOutbox");
const StudentInvitation = require("../models/StudentInvitation");
const StudentPasswordReset = require("../models/StudentPasswordReset");
const { sendStudentAccessEmail } = require("./emailService");
const { decryptPayload } = require("./emailOutboxCrypto");

const MAX_ATTEMPTS = 10;
const LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

const createEmailOutboxWorker = ({ pollIntervalMs = 1_000 } = {}) => {
  let stopped = true;
  let timer;
  let inFlight = Promise.resolve();

  const updateSourceStatus = async (record, status) => {
    const Model = record.messageType === "invitation" ? StudentInvitation : StudentPasswordReset;
    const id = record.messageType === "invitation" ? record.invitationId : record.passwordResetId;
    if (id) await Model.updateOne({ _id: id }, { $set: { deliveryStatus: status } });
  };

  const processOne = async () => {
    const now = new Date();
    await EmailOutbox.updateMany({ status: "pending", expiresAt: { $lte: now } }, {
      $set: { status: "dead", leaseUntil: null, lastErrorCode: "LINK_EXPIRED" },
      $unset: { encryptedPayload: 1, payloadIv: 1, payloadTag: 1 },
    });
    const record = await EmailOutbox.findOneAndUpdate({
      status: "pending",
      nextAttemptAt: { $lte: now },
      expiresAt: { $gt: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    }, {
      $inc: { attempts: 1 },
      $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
    }, { sort: { nextAttemptAt: 1, createdAt: 1 }, new: true }).select("+encryptedPayload +payloadIv +payloadTag");
    if (!record) return false;

    const sourceModel = record.messageType === "invitation" ? StudentInvitation : StudentPasswordReset;
    const sourceId = record.messageType === "invitation" ? record.invitationId : record.passwordResetId;
    const source = sourceId ? await sourceModel.findById(sourceId).select("usedAt invalidatedAt expiresAt") : null;
    if (!source || source.usedAt || source.invalidatedAt || source.expiresAt <= now) {
      await EmailOutbox.updateOne({ _id: record._id, status: "pending" }, {
        $set: { status: "dead", leaseUntil: null, lastErrorCode: "LINK_NO_LONGER_VALID" },
        $unset: { encryptedPayload: 1, payloadIv: 1, payloadTag: 1 },
      });
      return true;
    }

    try {
      const payload = decryptPayload(record);
      await sendStudentAccessEmail({
        kind: record.messageType,
        recipient: payload.recipient,
        studentName: payload.studentName,
        link: payload.link,
        expiresAt: payload.expiresAt,
      });
    } catch (error) {
      const terminal = record.attempts >= MAX_ATTEMPTS || record.expiresAt <= new Date();
      const retryDelay = Math.min(MAX_RETRY_DELAY_MS, 30_000 * (2 ** Math.max(0, record.attempts - 1)));
      const safeCode = typeof error.code === "string" && /^[A-Z0-9_-]{1,80}$/i.test(error.code) ? error.code : "EMAIL_DELIVERY_ERROR";
      await EmailOutbox.updateOne({ _id: record._id, status: "pending" }, terminal ? {
        $set: { status: "dead", leaseUntil: null, lastErrorCode: safeCode },
        $unset: { encryptedPayload: 1, payloadIv: 1, payloadTag: 1 },
      } : {
        $set: { leaseUntil: null, nextAttemptAt: new Date(Date.now() + retryDelay), lastErrorCode: safeCode },
      });
      if (terminal) await updateSourceStatus(record, "failed");
      console.error(JSON.stringify({ level: "error", event: "student_email_delivery_attempt_failed", outboxId: record._id.toString(), messageType: record.messageType, terminal, errorCode: safeCode }));
      return true;
    }

    await EmailOutbox.updateOne({ _id: record._id, status: "pending" }, {
      $set: { status: "sent", sentAt: new Date(), leaseUntil: null, lastErrorCode: null },
      $unset: { encryptedPayload: 1, payloadIv: 1, payloadTag: 1 },
    });
    try { await updateSourceStatus(record, "sent"); } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "student_email_status_persist_failed", outboxId: record._id.toString(), errorCode: error.code || "DATABASE_ERROR" }));
    }
    return true;
  };

  const schedule = (delay = pollIntervalMs) => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = processOne()
        .catch((error) => console.error(JSON.stringify({ level: "error", event: "email_outbox_worker_failed", errorType: error.name || "Error" })))
        .finally(() => schedule());
    }, delay);
    timer.unref?.();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule(0);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
};

module.exports = { createEmailOutboxWorker };
