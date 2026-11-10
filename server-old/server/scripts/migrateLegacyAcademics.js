const path = require("node:path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const { createHash } = require("node:crypto");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });
mongoose.set("autoIndex", false);

const connectDB = require("../config/db");
const Student = require("../models/Student");
const User = require("../models/User");
const CourseOffering = require("../models/CourseOffering");
const Enrollment = require("../models/Enrollment");
const DataMigration = require("../models/DataMigration");
const AuditEvent = require("../models/AuditEvent");

const BATCH_SIZE = 100;
const normalizeLabel = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const pairKey = (course, batch) => JSON.stringify([normalizeLabel(course), normalizeLabel(batch)]);

const parseArguments = (args) => {
  const options = { apply: false, mappingPath: null, actorId: null, actorEmail: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--apply") options.apply = true;
    else if (args[index] === "--help") options.help = true;
    else if (args[index] === "--mapping" && args[index + 1]) options.mappingPath = path.resolve(process.cwd(), args[++index]);
    else if (args[index] === "--actor-id" && args[index + 1]) options.actorId = args[++index];
    else if (args[index] === "--actor-email" && args[index + 1]) options.actorEmail = args[++index].trim().toLowerCase();
    else throw new Error("Usage: npm run migrate:legacy-academics -- [--mapping <json-file>] [--apply (--actor-email <email> | --actor-id <id>)]");
  }
  if (options.apply && (!options.mappingPath || Boolean(options.actorId) === Boolean(options.actorEmail))) {
    throw new Error("Applying a migration requires --mapping <json-file> and exactly one of --actor-id or --actor-email.");
  }
  if (!options.apply && (options.actorId || options.actorEmail)) throw new Error("An actor option is accepted only with --apply.");
  return options;
};

const loadMappings = async (mappingPath) => {
  if (!mappingPath) return new Map();
  const raw = JSON.parse(await require("node:fs/promises").readFile(mappingPath, "utf8"));
  if (!raw || !Array.isArray(raw.mappings)) throw new Error("Mapping file must contain a mappings array.");
  const mappings = new Map();
  for (const [index, item] of raw.mappings.entries()) {
    if (!item || typeof item !== "object") throw new Error(`Mapping ${index + 1} must be an object.`);
    const legacyCourse = typeof item.legacyCourse === "string" ? item.legacyCourse.trim() : "";
    const legacyBatch = typeof item.legacyBatch === "string" ? item.legacyBatch.trim() : "";
    const courseCode = typeof item.courseCode === "string" ? item.courseCode.trim().toUpperCase() : "";
    const courseName = typeof item.courseName === "string" ? item.courseName.trim() : "";
    const term = typeof item.term === "string" ? item.term.trim() : "";
    const section = typeof item.section === "string" ? item.section.trim() : "";
    if (!legacyCourse || !legacyBatch || !courseName || !term || !section
      || courseName.length > 120 || term.length > 60 || section.length > 30
      || courseCode.length > 24 || !/^[A-Z0-9][A-Z0-9_-]*$/.test(courseCode)) {
      throw new Error(`Mapping ${index + 1} has a missing or invalid legacy label or target offering field.`);
    }
    const key = pairKey(legacyCourse, legacyBatch);
    if (mappings.has(key)) throw new Error(`Mapping ${index + 1} repeats a legacy course/batch pair.`);
    mappings.set(key, { legacyCourse, legacyBatch, courseCode, courseName, term, section });
  }
  return mappings;
};

const collectLegacyGroups = async () => {
  const aggregates = await Student.aggregate([
    { $group: {
      _id: { course: "$course", batch: "$batch" },
      studentCount: { $sum: 1 },
      activeStudentCount: { $sum: { $cond: [{ $ne: ["$status", "archived"] }, 1, 0] } },
      archivedStudentCount: { $sum: { $cond: [{ $eq: ["$status", "archived"] }, 1, 0] } },
    } },
  ]);
  const groups = new Map();
  for (const row of aggregates) {
    const course = typeof row._id?.course === "string" ? row._id.course : "";
    const batch = typeof row._id?.batch === "string" ? row._id.batch : "";
    if (!course.trim() || !batch.trim()) continue;
    const key = pairKey(course, batch);
    if (!groups.has(key)) groups.set(key, {
      key,
      legacyCourse: course.trim(),
      legacyBatch: batch.trim(),
      rawPairs: [],
      studentCount: 0,
      activeStudentCount: 0,
      archivedStudentCount: 0,
    });
    const group = groups.get(key);
    group.rawPairs.push({ course, batch });
    group.studentCount += row.studentCount;
    group.activeStudentCount += row.activeStudentCount;
    group.archivedStudentCount += row.archivedStudentCount;
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
};

const makeStudentQuery = (group) => ({
  status: { $ne: "archived" },
  $or: group.rawPairs.map(({ course, batch }) => ({ course, batch })),
});

const inspectTarget = async (mapping) => {
  const offering = await CourseOffering.findOne({ courseCode: mapping.courseCode, term: mapping.term, section: mapping.section }).lean();
  if (offering && normalizeLabel(offering.courseName) !== normalizeLabel(mapping.courseName)) {
    throw new Error(`Target offering ${mapping.courseCode}/${mapping.term}/${mapping.section} already exists with a different course name.`);
  }
  return offering;
};

const buildPreview = async (groups, mappings) => {
  const missingMappings = [];
  const preview = [];
  for (const group of groups) {
    const mapping = mappings.get(group.key);
    if (!mapping) {
      missingMappings.push({ legacyCourse: group.legacyCourse, legacyBatch: group.legacyBatch, studentCount: group.studentCount });
      continue;
    }
    if (!group.activeStudentCount) {
      preview.push({ legacyCourse: group.legacyCourse, legacyBatch: group.legacyBatch, activeStudentCount: 0, skipped: "no active students" });
      continue;
    }
    const offering = await inspectTarget(mapping);
    const enrollmentCounts = offering ? await Enrollment.aggregate([
      { $match: { offeringId: offering._id } },
      { $lookup: { from: Student.collection.name, localField: "studentId", foreignField: "_id", as: "student" } },
      { $unwind: "$student" },
      { $match: {
        "student.status": { $ne: "archived" },
        $or: group.rawPairs.map(({ course, batch }) => ({ "student.course": course, "student.batch": batch })),
      } },
      { $count: "count" },
    ]) : [];
    const existingEnrollmentCount = enrollmentCounts[0]?.count || 0;
    preview.push({
      legacyCourse: group.legacyCourse,
      legacyBatch: group.legacyBatch,
      studentCount: group.studentCount,
      activeStudentCount: group.activeStudentCount,
      archivedStudentCount: group.archivedStudentCount,
      target: { courseCode: mapping.courseCode, courseName: mapping.courseName, term: mapping.term, section: mapping.section },
      offeringExists: Boolean(offering),
      existingEnrollmentCount,
      enrollmentRowsToAdd: Math.max(0, group.activeStudentCount - existingEnrollmentCount),
    });
  }
  return { preview, missingMappings };
};

const applyGroup = async (group, mapping, actorId) => {
  const cursor = Student.find(makeStudentQuery(group)).select("_id").sort({ _id: 1 }).lean().cursor({ batchSize: BATCH_SIZE });
  let chunk = [];
  let insertedCount = 0;
  const commitChunk = async (studentIds) => {
    if (!studentIds.length) return;
    const session = await mongoose.startSession();
    try {
      const inserted = await session.withTransaction(async () => {
        let offering = await CourseOffering.findOne({ courseCode: mapping.courseCode, term: mapping.term, section: mapping.section }).session(session);
        if (!offering) {
          offering = new CourseOffering({
            courseCode: mapping.courseCode,
            courseName: mapping.courseName,
            term: mapping.term,
            section: mapping.section,
            createdBy: actorId,
          });
          await offering.save({ session });
        } else if (normalizeLabel(offering.courseName) !== normalizeLabel(mapping.courseName)) {
          throw new Error(`Target offering ${mapping.courseCode}/${mapping.term}/${mapping.section} changed during migration.`);
        }
        const existing = await Enrollment.find({ studentId: { $in: studentIds }, offeringId: offering._id }).select("studentId").session(session).lean();
        const existingIds = new Set(existing.map((record) => record.studentId.toString()));
        const newRecords = studentIds.filter((id) => !existingIds.has(id.toString())).map((studentId) => ({
          studentId,
          offeringId: offering._id,
          status: "active",
          createdBy: actorId,
        }));
        if (newRecords.length) {
          await Enrollment.insertMany(newRecords, { session, ordered: true });
          await AuditEvent.create(newRecords.map((record) => ({
            actorId,
            eventType: "legacy_enrollment_created",
            studentId: record.studentId,
            offeringId: offering._id,
          })), { session });
          await CourseOffering.updateOne({ _id: offering._id }, { $inc: { rosterLockVersion: 1 } }, { session });
        }
        return newRecords.length;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      insertedCount += inserted || 0;
    } finally {
      await session.endSession();
    }
  };

  try {
    for await (const student of cursor) {
      chunk.push(student._id);
      if (chunk.length >= BATCH_SIZE) {
        await commitChunk(chunk);
        chunk = [];
      }
    }
    await commitChunk(chunk);
  } finally {
    await cursor.close();
  }
  return insertedCount;
};

const main = async (args = process.argv.slice(2)) => {
  const options = parseArguments(args);
  if (options.help) {
    console.log("Usage: npm run migrate:legacy-academics -- [--mapping <json-file>] [--apply (--actor-email <active-admin-email> | --actor-id <active-admin-id>)]");
    console.log("Defaults to a read-only inventory/preview. Applying requires a complete reviewed mapping and active admin actor.");
    return;
  }
  const mappings = await loadMappings(options.mappingPath);
  await connectDB();
  try {
    const groups = await collectLegacyGroups();
    const { preview, missingMappings } = await buildPreview(groups, mappings);
    const summary = {
      mode: options.apply ? "apply" : "dry_run",
      legacyGroups: groups.length,
      mappedGroups: preview.length,
      unmappedGroups: missingMappings.length,
      preview,
      missingMappings,
    };
    if (!options.apply) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (missingMappings.length) throw new Error("Apply refused: every legacy course/batch pair must be mapped. No records were changed.");
    if (options.actorId && !mongoose.isValidObjectId(options.actorId)) throw new Error("--actor-id must be a valid administrator ID.");
    if (options.actorEmail && (options.actorEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.actorEmail))) {
      throw new Error("--actor-email must be a valid administrator email address.");
    }
    const actorQuery = options.actorId ? { _id: options.actorId } : { email: options.actorEmail };
    const actor = await User.findOne({ ...actorQuery, role: "admin", active: true }).select("_id").lean();
    if (!actor) throw new Error("The selected actor must identify an active administrator.");

    const canonicalMappings = [...mappings.values()].sort((a, b) => pairKey(a.legacyCourse, a.legacyBatch).localeCompare(pairKey(b.legacyCourse, b.legacyBatch)));
    const mappingHash = createHash("sha256").update(JSON.stringify(canonicalMappings)).digest("hex");
    const migrationKey = "legacy_academic_enrollment_v1";
    let migration = await DataMigration.findOne({ migrationKey });
    if (migration && migration.mappingHash !== mappingHash) {
      throw new Error("The prior migration used a different mapping file. Resume only with the original mappings; no new records were changed.");
    }
    if (migration?.status === "completed") {
      console.log(JSON.stringify({ ...summary, migrationKey, result: "already completed; no changes made" }, null, 2));
      return;
    }
    if (!migration) {
      migration = new DataMigration({ migrationKey, mappingHash, startedBy: actor._id });
      await migration.save();
    } else {
      migration.status = "running";
      migration.completedAt = null;
      migration.lastErrorCode = null;
      await migration.save();
    }

    try {
      let newEnrollments = 0;
      let skippedArchivedGroups = 0;
      for (const group of groups) {
        const mapping = mappings.get(group.key);
        if (!mapping || !group.activeStudentCount) {
          if (mapping && !group.activeStudentCount) skippedArchivedGroups += 1;
          continue;
        }
        newEnrollments += await applyGroup(group, mapping, actor._id);
      }
      migration.status = "completed";
      migration.completedAt = new Date();
      await migration.save();
      console.log(JSON.stringify({ ...summary, migrationKey, newEnrollments, skippedArchivedGroups, result: "completed; rerunning is safe" }, null, 2));
    } catch (error) {
      const code = typeof error.code === "string" && /^[A-Z0-9_-]{1,80}$/i.test(error.code) ? error.code : "MIGRATION_FAILED";
      await DataMigration.updateOne({ _id: migration._id }, { $set: { status: "failed", lastErrorCode: code } }).catch(() => {});
      throw error;
    }
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Legacy academic migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArguments, loadMappings, collectLegacyGroups, buildPreview, applyGroup };
