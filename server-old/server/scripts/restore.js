const dotenv = require("dotenv");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const mongoose = require("mongoose");
const { getDatabaseConfig, runDatabaseTool, listFiles, hashFile } = require("./databaseTools");
const { FORMAT, createBackupAad, decryptFile } = require("./backupCrypto");
const getDbSettings = require("../config/dbSettings");

dotenv.config();

const readAndVerifyBackup = async (backupPath, targetDatabase) => {
  const manifestPath = path.join(backupPath, "studenthub-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const legacy = manifest.format === "studenthub-mongodump-directory-gzip-v1";
  const encrypted = manifest.format === FORMAT;
  if ((!legacy && !encrypted) || typeof manifest.database !== "string") {
    throw new Error("Backup manifest is missing or has an unsupported format.");
  }
  if (manifest.database !== targetDatabase) throw new Error(`Backup is for database '${manifest.database}', but MONGO_URI targets '${targetDatabase}'. Point MONGO_URI at an empty restore database with the matching name.`);
  const actualFiles = (await listFiles(backupPath)).filter((file) => file !== "studenthub-manifest.json");
  let expectedFiles;
  if (legacy) {
    if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("Backup manifest file list is invalid.");
    expectedFiles = Object.keys(manifest.files).sort();
  } else {
    if (!Array.isArray(manifest.collections) || manifest.collections.length < 1
      || manifest.collections.some((name) => typeof name !== "string" || !name)
      || manifest.archive?.file !== "studenthub.archive.enc"
      || !Number.isSafeInteger(manifest.archive?.bytes) || manifest.archive.bytes < 1
      || !/^[a-f0-9]{64}$/.test(manifest.archive?.sha256 || "")) {
      throw new Error("Encrypted backup manifest is invalid.");
    }
    expectedFiles = [manifest.archive.file];
  }
  const normalizedActual = actualFiles.map((file) => file.split(path.sep).join("/")).sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(expectedFiles)) throw new Error("Backup files do not match the manifest; refusing to restore.");
  for (const relativePath of expectedFiles) {
    const resolved = path.resolve(backupPath, relativePath);
    if (!resolved.startsWith(`${path.resolve(backupPath)}${path.sep}`)) throw new Error("Backup manifest contains a path outside its directory.");
    const info = await fs.stat(resolved);
    const expected = legacy ? manifest.files[relativePath] : manifest.archive;
    if (info.size !== expected.bytes || await hashFile(resolved) !== expected.sha256) throw new Error(`Backup checksum mismatch: ${relativePath}`);
  }
  const bsonCollections = legacy ? expectedFiles.filter((file) => file.endsWith(".bson.gz")) : [];
  if (legacy && !bsonCollections.length) throw new Error("Backup does not contain any collection data.");
  return { manifest, bsonCollections, legacy };
};

const main = async () => {
  const backupArgument = process.argv[2];
  if (!backupArgument || process.argv.length > 3) throw new Error("Usage: npm run restore:data -- <backup-directory>");
  const backupPath = path.resolve(process.cwd(), backupArgument);
  const { uri, database } = getDatabaseConfig();
  const { serverSelectionTimeoutMS } = getDbSettings();
  const { manifest, bsonCollections, legacy } = await readAndVerifyBackup(backupPath, database);

  await mongoose.connect(uri, { serverSelectionTimeoutMS, autoIndex: false });
  try {
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    if (collections.length) throw new Error(`Target database '${database}' already contains collections. Restore only to a new, empty database; existing data was not changed.`);
  } finally {
    await mongoose.disconnect();
  }

  let restoreArguments;
  let temporaryDirectory;
  try {
    if (legacy) {
      restoreArguments = ["--gzip", "--stopOnError", path.join(backupPath, "dump")];
    } else {
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "studenthub-restore-"));
      const plainArchive = path.join(temporaryDirectory, "database.archive.gz");
      const aad = createBackupAad({ database: manifest.database, collections: manifest.collections, file: manifest.archive.file });
      await decryptFile(path.join(backupPath, manifest.archive.file), plainArchive, manifest.encryption, aad);
      restoreArguments = ["--gzip", "--stopOnError", `--archive=${plainArchive}`];
    }
    await runDatabaseTool("mongorestore", restoreArguments, uri);
  } catch (error) {
    throw new Error(`${error.message} If restore began, keep the target isolated; retry against a new empty database.`);
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS, autoIndex: false });
  let restoredCollections;
  try {
    restoredCollections = new Set((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name));
  } finally {
    await mongoose.disconnect();
  }
  const expectedCollections = new Set(legacy
    ? bsonCollections.map((file) => path.basename(file, ".bson.gz"))
    : manifest.collections);
  const missingCollections = [...expectedCollections].filter((name) => !restoredCollections.has(name));
  if (missingCollections.length) throw new Error(`Restore finished but expected collections are missing: ${missingCollections.join(", ")}. Keep this database isolated and investigate before use.`);
  console.log(`Restore completed to empty database '${database}'.`);
  console.log(`Restored collections verified: ${expectedCollections.size}. Verify the restored database before pointing application traffic to it.`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Database restore failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, readAndVerifyBackup };
