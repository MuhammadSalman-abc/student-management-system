const {
  app,
  BrowserWindow,
  dialog,
} = require("electron");

const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexPath = path.join(
    __dirname,
    "dist",
    "index.html"
  );

  console.log("Loading:", indexPath);

  win.loadFile(indexPath).catch((error) => {
    console.error(
      "Failed to load application:",
      error
    );

    dialog.showErrorBox(
      "StudentHub failed to start",
      error.message
    );
  });

  win.webContents.on(
    "did-fail-load",
    (
      event,
      errorCode,
      errorDescription,
      validatedURL
    ) => {
      console.error(
        "Page failed to load:",
        errorCode,
        errorDescription,
        validatedURL
      );
    }
  );
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (
      BrowserWindow.getAllWindows().length === 0
    ) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});