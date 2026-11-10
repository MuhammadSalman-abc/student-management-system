const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const ignoredDirectories = new Set(["node_modules", "dist", "coverage"]);
const sourceFiles = [];

const collectJavaScript = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) collectJavaScript(path.join(directory, entry.name));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) sourceFiles.push(path.join(directory, entry.name));
  }
};

collectJavaScript(projectRoot);
let failed = false;
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status === 0) continue;
  failed = true;
  process.stderr.write(`Syntax check failed: ${path.relative(projectRoot, file)}\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

if (failed) process.exitCode = 1;
else console.log(`JavaScript syntax OK (${sourceFiles.length} files).`);
