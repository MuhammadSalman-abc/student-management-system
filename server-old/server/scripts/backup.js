const dotenv = require("dotenv");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { getDatabaseConfig, runDatabaseTool, hashFile } = require("./databaseTools");
const { FORMAT, createBackupAad, getBackupKey, encryptFile } = require("./backupCrypto");
const getDbSettings = require("../config/dbSettings");
const mongoose = require("mongoose");

dotenv.config();

const main = async () => {
  getBackupKey();
  const { uri, database } = getDatabaseConfig();
  const { serverSelectionTimeoutMS } = getDbSettings();
  const backupRoot = path.resolve(process.cwd(), process.env.BACKUP_DIR || "./backups");
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `studenthub-${stamp}`;
  const partial = path.join(backupRoot, `.${name}.partial-${randomUUID()}`);
  const final = path.join(backupRoot, name);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "studenthub-backup-"));
  const plainArchive = path.join(temporaryDirectory, "database.archive.gz");
  try {
    let collections;
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS, autoIndex: false });
      collections = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
        .map((item) => item.name).sort();
    } finally {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    }
    if (!collections.length) throw new Error("The selected database contains no collections; refusing to create an empty backup.");

    await fs.mkdir(partial, { mode: 0o700 });
    await runDatabaseTool("mongodump", ["--db", database, "--gzip", `--archive=${plainArchive}`], uri);
    const archiveFile = "studenthub.archive.enc";
    const archivePath = path.join(partial, archiveFile);
    const aad = createBackupAad({ database, collections, file: archiveFile });
    const encryption = await encryptFile(plainArchive, archivePath, aad);
    const manifest = {
      format: FORMAT,
      database,
      createdAt: new Date().toISOString(),
      collections,
      archive: {
        file: archiveFile,
        bytes: (await fs.stat(archivePath)).size,
        sha256: await hashFile(archivePath),
      },
      encryption,
    };
    await fs.writeFile(path.join(partial, "studenthub-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(partial, final);
    console.log(`Backup created: ${final}`);
    console.log(`Database: ${database}; collections: ${collections.length}; encryption: AES-256-GCM; SHA-256: verified on restore.`);
    console.log("Store this backup and its encryption key separately in approved secure storage.");
  } catch (error) {
    await fs.rm(partial, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Database backup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
