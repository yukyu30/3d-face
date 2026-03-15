import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { createDb, getAllPersons, addPerson, deletePerson, addDescriptorToPerson } from "../src/db";
import type Database from "better-sqlite3";

let db: Database.Database;

function initDatabase(): void {
  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, "face3d.db");
  db = createDb(dbPath);
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 開発時はViteサーバー、本番時はビルド済みファイルを読み込み
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  // IPC ハンドラー
  ipcMain.handle("db:getAllPersons", () => {
    return getAllPersons(db);
  });

  ipcMain.handle("db:addPerson", (_event, name: string, modelUrl: string, descriptors: { embedding: number[] }[]) => {
    return addPerson(db, name, modelUrl, descriptors);
  });

  ipcMain.handle("db:deletePerson", (_event, id: string) => {
    deletePerson(db, id);
  });

  ipcMain.handle("db:addDescriptor", (_event, personId: string, descriptor: { embedding: number[] }) => {
    addDescriptorToPerson(db, personId, descriptor);
  });

  // ファイル保存ダイアログ
  ipcMain.handle("dialog:saveFile", async (_event, defaultName: string, dataUrl: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: "Images", extensions: ["png"] }],
    });

    if (!result.canceled && result.filePath) {
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      fs.writeFileSync(result.filePath, buffer);
      return result.filePath;
    }
    return null;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (db) db.close();
  if (process.platform !== "darwin") app.quit();
});
