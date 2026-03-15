import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // 人物管理
  getAllPersons: () => ipcRenderer.invoke("db:getAllPersons"),
  addPerson: (name: string, modelUrl: string, descriptors: { embedding: number[] }[]) =>
    ipcRenderer.invoke("db:addPerson", name, modelUrl, descriptors),
  deletePerson: (id: string) => ipcRenderer.invoke("db:deletePerson", id),
  addDescriptor: (personId: string, descriptor: { embedding: number[] }) =>
    ipcRenderer.invoke("db:addDescriptor", personId, descriptor),

  // 3Dモデル管理
  getAllModels: () => ipcRenderer.invoke("model:getAll"),
  getModel: (id: string) => ipcRenderer.invoke("model:get", id),
  importModel: () => ipcRenderer.invoke("model:import"),
  importImage: () => ipcRenderer.invoke("model:importImage"),
  deleteModel: (id: string) => ipcRenderer.invoke("model:delete", id),
  readModelFile: (storedPath: string) => ipcRenderer.invoke("model:readFile", storedPath),

  // ファイル保存
  saveFile: (defaultName: string, dataUrl: string) =>
    ipcRenderer.invoke("dialog:saveFile", defaultName, dataUrl),
});
