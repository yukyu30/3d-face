import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import {
  createDb,
  getAllPersons,
  addPerson,
  deletePerson,
  addDescriptorToPerson,
  addModel,
  getAllModels,
  getModel,
  deleteModel,
} from "../src/db";
import type Database from "better-sqlite3";

let db: Database.Database;
let modelsDir: string;

function initDatabase(): void {
  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, "face3d.db");
  db = createDb(dbPath);

  modelsDir = path.join(userDataPath, "models");
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  const htmlPath = path.join(__dirname, "../../dist/index.html");

  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(htmlPath).catch((err) => {
      console.error("Failed to load HTML:", err);
    });
  }
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  // --- 人物管理 IPC ---
  ipcMain.handle("db:getAllPersons", () => getAllPersons(db));

  ipcMain.handle("db:addPerson", (_event, name: string, modelUrl: string, descriptors: { embedding: number[] }[]) =>
    addPerson(db, name, modelUrl, descriptors)
  );

  ipcMain.handle("db:deletePerson", (_event, id: string) => deletePerson(db, id));

  ipcMain.handle("db:addDescriptor", (_event, personId: string, descriptor: { embedding: number[] }) =>
    addDescriptorToPerson(db, personId, descriptor)
  );

  // --- 3Dモデル管理 IPC ---
  ipcMain.handle("model:getAll", () => getAllModels(db));

  ipcMain.handle("model:get", (_event, id: string) => getModel(db, id));

  ipcMain.handle("model:import", async () => {
    const result = await dialog.showOpenDialog({
      title: "3Dモデルをインポート",
      filters: [
        { name: "3D Models", extensions: ["glb", "gltf", "obj", "fbx"] },
      ],
      properties: ["openFile"],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const srcPath = result.filePaths[0];
    const originalName = path.basename(srcPath);
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const timestamp = Date.now();
    const storedName = `${baseName}_${timestamp}${ext}`;
    const storedPath = path.join(modelsDir, storedName);

    fs.copyFileSync(srcPath, storedPath);

    const model = addModel(db, baseName, originalName, storedPath, "model3d");
    return model;
  });

  ipcMain.handle("model:importImage", async () => {
    const result = await dialog.showOpenDialog({
      title: "画像をインポート",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] },
      ],
      properties: ["openFile"],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const srcPath = result.filePaths[0];
    const originalName = path.basename(srcPath);
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const timestamp = Date.now();
    const storedName = `${baseName}_${timestamp}${ext}`;
    const storedPath = path.join(modelsDir, storedName);

    fs.copyFileSync(srcPath, storedPath);

    const model = addModel(db, baseName, originalName, storedPath, "image");
    return model;
  });

  ipcMain.handle("model:delete", (_event, id: string) => {
    const model = getModel(db, id);
    if (model && fs.existsSync(model.storedPath)) {
      fs.unlinkSync(model.storedPath);
    }
    deleteModel(db, id);
  });

  ipcMain.handle("model:readFile", (_event, storedPath: string) => {
    if (!fs.existsSync(storedPath)) return null;
    // Uint8Arrayで返す（Electron IPCでの安全な転送のため）
    const buffer = fs.readFileSync(storedPath);
    return new Uint8Array(buffer);
  });

  // --- ファイル保存 ---
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
