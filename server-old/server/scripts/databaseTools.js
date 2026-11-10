const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const getDatabaseConfig = () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is required in server-old/server/.env.");
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error("MONGO_URI must be a valid MongoDB URI."); }
  if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) throw new Error("MONGO_URI must use mongodb:// or mongodb+srv://.");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database || ["admin", "config", "local"].includes(database)) throw new Error("MONGO_URI must select an application database, not an administrative database.");
  return { uri, database };
};

const runDatabaseTool = (tool, args, uri) => new Promise((resolve, reject) => {
  const tempDirectory = path.join(os.tmpdir(), `studenthub-${randomUUID()}`);
  const tempFile = path.join(tempDirectory, "mongodb-tools.yaml");
  const safeUri = uri.replace(/[\r\n]/g, "");
  const config = `uri: ${JSON.stringify(safeUri)}\n`;
  fs.mkdir(tempDirectory, { mode: 0o700 }).then(() => fs.writeFile(tempFile, config, { mode: 0o600, flag: "wx" })).then(() => {
    const child = spawn(tool, [...args, `--config=${tempFile}`], { stdio: "ignore", windowsHide: true });
    child.once("error", (error) => {
      fs.rm(tempDirectory, { recursive: true, force: true }).finally(() => reject(error.code === "ENOENT"
        ? new Error(`${tool} was not found. Install MongoDB Database Tools and ensure ${tool} is on PATH.`)
        : error));
    });
    child.once("close", (code) => {
      fs.rm(tempDirectory, { recursive: true, force: true }).then(() => {
        if (code !== 0) return reject(new Error(`${tool} failed (exit ${code}). Review the database connection, backup path, and Database Tools version; record data is not included in this error.`));
        resolve();
      }, reject);
    });
  }, reject);
});

const listFiles = async (root, relative = "") => {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("Backup contains a symbolic link, which is not allowed.");
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, childRelative));
    else if (entry.isFile()) files.push(childRelative);
    else throw new Error("Backup contains an unsupported filesystem entry.");
  }
  return files;
};

const hashFile = async (filePath) => {
  const hash = createHash("sha256");
  const stream = require("node:fs").createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
};

module.exports = { getDatabaseConfig, runDatabaseTool, listFiles, hashFile };
