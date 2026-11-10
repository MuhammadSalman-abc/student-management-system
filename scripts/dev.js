const { spawn } = require("node:child_process");
const path = require("node:path");

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this launcher with `npm run dev` from the workspace root.");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const scripts = ["dev:server", "dev:client"];
const children = scripts.map((script) => spawn(process.execPath, [npmCli, "run", script], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
}));

let stopping = false;
let exitCode = 0;

const stopChildren = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
};

for (const [index, child] of children.entries()) {
  child.on("error", (error) => {
    console.error(`Could not start ${scripts[index]}: ${error.message}`);
    exitCode = 1;
    stopChildren();
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    exitCode = code ?? (signal ? 1 : 0);
    stopChildren();
  });
}

process.on("SIGINT", () => {
  exitCode = 130;
  stopChildren();
});
process.on("SIGTERM", () => {
  exitCode = 143;
  stopChildren();
});

const finish = () => {
  if (children.every((child) => child.exitCode !== null || child.signalCode !== null)) {
    process.exitCode = exitCode;
  } else {
    setTimeout(finish, 50).unref();
  }
};

for (const child of children) {
  child.on("exit", () => finish());
  child.on("error", () => finish());
}
