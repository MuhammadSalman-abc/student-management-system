const dotenv = require("dotenv");
const mongoose = require("mongoose");
const connectDB = require("../config/db");

dotenv.config();
mongoose.set("autoIndex", false);

// Register every model before connecting so the installer has the complete schema index catalogue.
for (const modelName of ["User", "Student", "StudentInvitation", "StudentPasswordReset", "EmailOutbox", "DataMigration", "AuthRateWindow", "CourseOffering", "Enrollment", "AttendanceSession", "AttendanceMark", "AttendanceChange", "Assessment", "AssessmentResult", "AssessmentChange", "AuditEvent", "Assignment"]) {
  require(`../models/${modelName}`);
}

const MODEL_NAMES = ["User", "Student", "StudentInvitation", "StudentPasswordReset", "EmailOutbox", "DataMigration", "AuthRateWindow", "CourseOffering", "Enrollment", "AttendanceSession", "AttendanceMark", "AttendanceChange", "Assessment", "AssessmentResult", "AssessmentChange", "AuditEvent", "Assignment"];

const sameIndexKeys = (index, keys) => JSON.stringify(index.key) === JSON.stringify(keys);
const indexMatches = (index, keys, options) => sameIndexKeys(index, keys)
  && Boolean(index.unique) === Boolean(options.unique)
  && Boolean(index.sparse) === Boolean(options.sparse)
  && (options.expireAfterSeconds ?? null) === (index.expireAfterSeconds ?? null)
  && (!options.name || index.name === options.name);

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required in server-old/server/.env.");
  await connectDB();
  const report = [];
  const collections = new Set((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name));

  for (const modelName of MODEL_NAMES) {
    const model = mongoose.model(modelName);
    const indexes = model.schema.indexes().filter(([, options]) => options.unique);
    if (!indexes.length || !collections.has(model.collection.name) || await model.collection.countDocuments() === 0) continue;
    const existingIndexes = await model.collection.indexes();
    for (const [keys, options] of indexes) {
      const sameKeyIndexes = existingIndexes.filter((index) => sameIndexKeys(index, keys));
      if (sameKeyIndexes.some((index) => indexMatches(index, keys, options))) continue;
      const groups = await model.aggregate([
        { $match: options.sparse ? { [Object.keys(keys)[0]]: { $exists: true, $ne: null } } : {} },
        { $group: { _id: Object.fromEntries(Object.keys(keys).map((field) => [field, `$${field}`])), count: { $sum: 1 }, sampleIds: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
        { $project: { _id: 0, key: "$_id", count: 1, sampleIds: { $slice: ["$sampleIds", 5] } } },
        { $limit: 50 },
      ]);
      if (groups.length) report.push({ model: modelName, index: options.name || keys, duplicates: groups });
    }
  }

  if (report.length) {
    console.error("Unique index preflight found existing duplicate records. No indexes were created and no data was changed.");
    for (const item of report) console.error(JSON.stringify(item));
    process.exitCode = 2;
    return;
  }

  for (const modelName of MODEL_NAMES) {
    const model = mongoose.model(modelName);
    let existingIndexes = collections.has(model.collection.name) ? await model.collection.indexes() : [];
    const desiredIndexes = model.schema.indexes();
    for (const [keys, options] of desiredIndexes) {
      const sameKeyIndexes = existingIndexes.filter((index) => sameIndexKeys(index, keys));
      if (sameKeyIndexes.some((index) => indexMatches(index, keys, options))) continue;
      for (const staleIndex of sameKeyIndexes) {
        await model.collection.dropIndex(staleIndex.name);
        console.log(`Rebuilding index metadata: ${modelName}.${staleIndex.name}`);
      }
      await model.collection.createIndex(keys, options);
      collections.add(model.collection.name);
      existingIndexes = await model.collection.indexes();
    }
    console.log(`Indexes ensured: ${modelName}`);
  }

  for (const modelName of MODEL_NAMES) {
    const model = mongoose.model(modelName);
    const existingIndexes = collections.has(model.collection.name) ? await model.collection.indexes() : [];
    for (const [keys, options] of model.schema.indexes()) {
      if (existingIndexes.some((index) => indexMatches(index, keys, options))) continue;
      const found = existingIndexes.filter((index) => sameIndexKeys(index, keys)).map((index) => index.name);
      throw new Error(`Index verification failed for ${modelName}.${options.name || JSON.stringify(keys)}. Stale indexes: ${JSON.stringify(found)}.`);
    }
  }
  console.log("All declared indexes are present. Existing application records were preserved.");
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Index installation failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
}

module.exports = { main, MODEL_NAMES, indexMatches };
