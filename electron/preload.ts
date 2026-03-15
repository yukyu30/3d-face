import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getAllPersons: () => ipcRenderer.invoke("db:getAllPersons"),
  addPerson: (name: string, modelUrl: string, descriptors: { embedding: number[] }[]) =>
    ipcRenderer.invoke("db:addPerson", name, modelUrl, descriptors),
  deletePerson: (id: string) => ipcRenderer.invoke("db:deletePerson", id),
  addDescriptor: (personId: string, descriptor: { embedding: number[] }) =>
    ipcRenderer.invoke("db:addDescriptor", personId, descriptor),
  saveFile: (defaultName: string, dataUrl: string) =>
    ipcRenderer.invoke("dialog:saveFile", defaultName, dataUrl),
});
